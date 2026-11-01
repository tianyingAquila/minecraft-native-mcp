import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {stopChildTree} from '../src/minecraft.mjs';
import {toolEnvironment,powerShellEnvironment,toolsReady} from '../src/environment.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PARTS=['src','web','scripts','prompts','assets','bundled','artifacts','versions.json','vendor-lock.json','package.json'];
const require=createRequire(import.meta.url);
export class Launcher {
  constructor({workspace=path.join(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),'minecraft-native-mcp'),managed=true,fetchImpl=fetch,spawnImpl=spawn}={}){this.workspace=workspace;this.managed=managed;this.fetch=fetchImpl;this.spawn=spawnImpl;this.child=null;this.setup=null;this.error='';}
  async ping(){try{const r=await this.fetch('http://127.0.0.1:21940/api/ping',{signal:AbortSignal.timeout(1200)});const p=await r.json();return p.app==='deepseek-minecraft-live';}catch{return false;}}
  seed(){
    fs.mkdirSync(this.workspace,{recursive:true});
    const manifest=path.join(this.workspace,'package.json');
    const current=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
    if(fs.existsSync(manifest)){
      const previous=JSON.parse(fs.readFileSync(manifest,'utf8'));
      if(!this.managed||path.resolve(this.workspace)===ROOT||previous.name!==current.name||previous.version===current.version)return;
      // Only managed source files are replaced; runtime, dependencies, credentials and worlds stay in place.
      const backup=path.join(this.workspace,'data/backups','plugin-'+previous.version+'-'+Date.now());
      for(const name of PARTS)if(fs.existsSync(path.join(this.workspace,name)))fs.cpSync(path.join(this.workspace,name),path.join(backup,name),{recursive:true,filter:src=>!['build','.gradle'].includes(path.basename(src))});
    }
    for(const name of PARTS)fs.cpSync(path.join(ROOT,name),path.join(this.workspace,name),{recursive:true,filter:src=>!['build','.gradle'].includes(path.basename(src))});
    fs.copyFileSync(path.join(ROOT,'scripts/control-package-lock.json'),path.join(this.workspace,'package-lock.json'));
  }
  ready(){return toolsReady(this.workspace);}
  async status(){return {running:await this.ping(),ready:this.ready(),preparing:Boolean(this.setup),pendingOpen:Boolean(this.pendingOpen),owned:Boolean(this.child),error:this.error,workspace:this.workspace,url:'http://127.0.0.1:21940'};}
  linkDependencies(){
    // DSH already installed these package dependencies. Reuse them instead of installing a second copy.
    for(const name of ['@modelcontextprotocol/sdk','yaml','zod']){
      let dir=path.dirname(require.resolve(name+'/package.json'));
      while(dir!==path.dirname(dir)){
        const file=path.join(dir,'package.json');if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file,'utf8')).name===name)break;dir=path.dirname(dir);
      }
      const target=path.join(this.workspace,'node_modules',...name.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});
      let stat;try{stat=fs.lstatSync(target);}catch{}
      if(stat?.isSymbolicLink()&&!fs.existsSync(path.join(target,'package.json')))fs.rmdirSync(target);
      if(!fs.existsSync(target))fs.symlinkSync(dir,target,'junction');
    }
    const file=path.join(this.workspace,'runtime/tools.json');fs.mkdirSync(path.dirname(file),{recursive:true});
    const tools=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8').trimStart()):{};
    fs.writeFileSync(file,JSON.stringify({...tools,node:process.execPath},null,2));
  }
  async initialize(){if(await this.ping())return;this.seed();try{this.linkDependencies();}catch{}if(!this.ready())await this.prepare();}
  prepare(){
    if(this.disposed)throw Error('插件已停用');
    if(this.setup)return this.setupDone;
    if(this.child)throw Error('先停止插件启动的控制台，再准备依赖。');
    this.seed();fs.mkdirSync(path.join(this.workspace,'logs'),{recursive:true});
    const output=fs.openSync(path.join(this.workspace,'logs/setup.log'),'a');
    this.error='';
    this.setup=this.spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(this.workspace,'scripts/bootstrap_tools.ps1')],{cwd:this.workspace,windowsHide:true,stdio:['ignore',output,output],env:powerShellEnvironment()});fs.closeSync(output);
    this.setupDone=new Promise((resolve,reject)=>{
      this.setup.once('error',e=>{this.error=e.message;this.setup=null;reject(e);});
      this.setup.once('exit',code=>{this.setup=null;if(code!==0){this.error='基础依赖自动准备失败，请查看工作目录 logs/setup.log，并检查网络或 DSH 安装。';reject(new Error(this.error));}else resolve();});
    });
    return this.setupDone;
  }
  async start(){
    if(this.disposed)throw Error('插件已停用');
    if(await this.ping())return;
    this.seed();
    try{this.linkDependencies();}catch{}
    if(this.setup)await this.setupDone;
    if(!this.ready())await this.prepare();
    if(this.child)throw Error('控制台正在启动，请稍候。');
    const env=toolEnvironment(this.workspace);
    const key=await this.resolveKey?.();if(typeof key==='string'&&key.trim())env.DEEPSEEK_API_KEY=key.trim();
    if(this.disposed)throw Error('插件已停用');
    fs.mkdirSync(path.join(this.workspace,'logs'),{recursive:true});
    const output=fs.openSync(path.join(this.workspace,'logs/control.log'),'a');
    this.child=this.spawn(process.execPath,['src/server.mjs'],{cwd:this.workspace,windowsHide:true,stdio:['ignore',output,output],env});fs.closeSync(output);
    this.child.once('exit',()=>{this.child=null;});this.child.once('error',e=>{this.error=e.message;this.child=null;});
    for(let i=0;i<50;i++){if(await this.ping())return;await new Promise(r=>setTimeout(r,200));}
    throw Error('控制台未能启动，请查看 logs/control.log。');
  }
  async stop(){
    if(!this.child)return; // Never stop an existing independently-started console.
    await this.fetch('http://127.0.0.1:21940/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'exit'}),signal:AbortSignal.timeout(20000)}).catch(()=>{});
  }
  async open(){
    if(this.pendingOpen)return;
    const perform=async()=>{await this.start();if(this.disposed)return;const p=this.spawn('explorer.exe',['http://127.0.0.1:21940'],{windowsHide:true,stdio:'ignore'});p.on('error',e=>{this.error=e.message;});};
    if(!this.ready()&&!await this.ping()){
      this.pendingOpen=true;void perform().catch(e=>{this.error=e.message;}).finally(()=>{this.pendingOpen=false;});return;
    }
    await perform();
  }
  async streaming(enabled){
    const running=await this.ping();if(!running)this.seed();
    const file=path.join(this.workspace,'data/settings.json');fs.mkdirSync(path.dirname(file),{recursive:true});
    if(running){
      const response=await this.fetch('http://127.0.0.1:21940/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'settings',settings:{streamingEnabled:enabled,nativeHudEnabled:enabled}})});
      if(!response.ok)throw Error('请先暂停游戏，再切换直播扩展。');
    }else{const settings=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};fs.writeFileSync(file,JSON.stringify({...settings,streamingEnabled:enabled,nativeHudEnabled:enabled},null,2));}
    await this.open();
  }
  async dispose(){
    this.disposed=true;
    if(this.setup)await stopChildTree(this.setup);
    const owned=this.child;await this.stop();
    if(owned){for(let n=0;n<60&&owned.exitCode===null;n++)await new Promise(r=>setTimeout(r,200));if(owned.exitCode===null)await stopChildTree(owned);}
  }
}
