import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {stopChildTree} from '../src/minecraft.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PARTS=['src','web','scripts','prompts','assets','client-addon','server-addon','vendor-lock.json','package.json'];
export class Launcher {
  constructor({workspace=path.join(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),'minecraft-native-mcp'),fetchImpl=fetch,spawnImpl=spawn}={}){this.workspace=workspace;this.fetch=fetchImpl;this.spawn=spawnImpl;this.child=null;this.setup=null;this.error='';}
  async ping(){try{const r=await this.fetch('http://127.0.0.1:21940/api/ping',{signal:AbortSignal.timeout(1200)});const p=await r.json();return p.app==='deepseek-minecraft-live';}catch{return false;}}
  seed(){
    fs.mkdirSync(this.workspace,{recursive:true});
    if(fs.existsSync(path.join(this.workspace,'package.json')))return;
    for(const name of PARTS)fs.cpSync(path.join(ROOT,name),path.join(this.workspace,name),{recursive:true,filter:src=>!['build','.gradle'].includes(path.basename(src))});
    fs.copyFileSync(path.join(ROOT,'scripts/control-package-lock.json'),path.join(this.workspace,'package-lock.json'));
  }
  ready(){return fs.existsSync(path.join(this.workspace,'node_modules/@modelcontextprotocol/sdk/package.json'))&&fs.existsSync(path.join(this.workspace,'runtime/native-client/launch.json'))&&fs.existsSync(path.join(this.workspace,'runtime/native-server/fish-pause-server.jar'));}
  async status(){return {running:await this.ping(),ready:this.ready(),preparing:Boolean(this.setup),owned:Boolean(this.child),error:this.error,workspace:this.workspace,url:'http://127.0.0.1:21940'};}
  prepare(){
    if(this.setup)return;
    if(this.child)throw Error('先停止插件启动的控制台，再准备依赖。');
    this.seed();fs.mkdirSync(path.join(this.workspace,'logs'),{recursive:true});
    const output=fs.openSync(path.join(this.workspace,'logs/setup.log'),'a');
    this.error='';
    this.setup=this.spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(this.workspace,'scripts/setup_native.ps1')],{cwd:this.workspace,windowsHide:true,stdio:['ignore',output,output],env:process.env});fs.closeSync(output);
    this.setup.once('error',e=>{this.error=e.message;this.setup=null;});
    this.setup.once('exit',code=>{if(code!==0)this.error='准备失败，请查看工作目录 logs/setup.log（需要 Git、Python、JDK21 和联网）。';this.setup=null;});
  }
  async start(){
    if(await this.ping())return;
    if(this.setup)throw Error('依赖仍在准备，请稍候。');
    if(!this.ready())throw Error('首次使用请先准备依赖。');
    if(this.child)throw Error('控制台正在启动，请稍候。');
    const output=fs.openSync(path.join(this.workspace,'logs/control.log'),'a');
    this.child=this.spawn(process.execPath,['src/server.mjs'],{cwd:this.workspace,windowsHide:true,stdio:['ignore',output,output],env:process.env});fs.closeSync(output);
    this.child.once('exit',()=>{this.child=null;});this.child.once('error',e=>{this.error=e.message;this.child=null;});
    for(let i=0;i<50;i++){if(await this.ping())return;await new Promise(r=>setTimeout(r,200));}
    throw Error('控制台未能启动，请查看 logs/control.log。');
  }
  async stop(){
    if(!this.child)return; // Never stop an existing independently-started console.
    await this.fetch('http://127.0.0.1:21940/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'exit'}),signal:AbortSignal.timeout(20000)}).catch(()=>{});
  }
  async open(){await this.start();const p=this.spawn('explorer.exe',['http://127.0.0.1:21940'],{windowsHide:true,stdio:'ignore'});p.on('error',e=>{this.error=e.message;});}
  async dispose(){
    if(this.setup)await stopChildTree(this.setup);
    const owned=this.child;await this.stop();
    if(owned){for(let n=0;n<60&&owned.exitCode===null;n++)await new Promise(r=>setTimeout(r,200));if(owned.exitCode===null)await stopChildTree(owned);}
  }
}
