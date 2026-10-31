import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {ROOT} from './config.mjs';
import {stopChildTree} from './minecraft.mjs';

export function toolEnvironment(root=ROOT,base=process.env){
  const env={...base,ELECTRON_RUN_AS_NODE:'1'};
  const file=path.join(root,'runtime/tools.json');
  if(fs.existsSync(file)){
    const tools=JSON.parse(fs.readFileSync(file,'utf8').trimStart());
    env.FISH_JAVA=tools.java;env.JAVA_HOME=tools.javaHome;env.FISH_PYTHON=tools.python;
    env.PATH=[...new Set([tools.node,tools.python,tools.git,tools.java].filter(Boolean).map(p=>path.dirname(p))),env.PATH||env.Path||''].join(path.delimiter);
    delete env.Path;
  }
  return env;
}
export function powerShellEnvironment(env=process.env){
  const result={...env};
  // Windows PowerShell 5 must not auto-load PowerShell 7 modules inherited from a host.
  if(process.platform==='win32')result.PSModulePath=path.join(env.SystemRoot||env.WINDIR||'C:\\Windows','System32/WindowsPowerShell/v1.0/Modules');
  return result;
}
export function toolsReady(root=ROOT){
  try{const p=JSON.parse(fs.readFileSync(path.join(root,'runtime/tools.json'),'utf8').trimStart());return [p.node,p.python,p.git,p.java,path.join(p.javaHome,'bin/javac.exe'),path.join(root,'node_modules/@modelcontextprotocol/sdk/package.json'),path.join(root,'node_modules/yaml/package.json')].every(f=>typeof f==='string'&&fs.existsSync(f));}catch{return false;}
}
const CLIENT_SHA1=JSON.parse(fs.readFileSync(path.join(ROOT,'vendor-lock.json'),'utf8')).minecraft.clientSha1;
export function findMinecraft(home,root=ROOT,expectedHash=CLIENT_SHA1){
  const homes=[home,process.env.FISH_MINECRAFT_HOME,path.join(process.env.APPDATA||os.homedir(),'.minecraft')].filter(Boolean);
  for(const folder of homes)for(const relative of ['versions/1.21.4/1.21.4.jar','1.21.4.jar','client.jar']){
    const jar=path.join(folder,relative);
    if(fs.existsSync(jar)&&createHash('sha1').update(fs.readFileSync(jar)).digest('hex')===expectedHash)return folder;
  }
  const cached=path.join(root,'runtime/client/client.jar');
  if(fs.existsSync(cached)&&createHash('sha1').update(fs.readFileSync(cached)).digest('hex')===expectedHash)return path.join(root,'runtime/client');
  return null;
}
export function gameEnvironmentReady(root=ROOT){
  return ['runtime/native-client/launch.json','runtime/native-server/launch.json','runtime/native-server/fish-pause-server.jar','data/native-client/mods/fish-live-client-0.1.0.jar','vendor/mcpfabric/mcp-server/dist/agent/runtime.js'].every(p=>fs.existsSync(path.join(root,p)));
}
export async function runPreparation(script,{root=ROOT,env=process.env,signal,onPhase=()=>{}}={}){
  signal?.throwIfAborted();fs.mkdirSync(path.join(root,'logs'),{recursive:true});
  const log=fs.createWriteStream(path.join(root,'logs/setup.log'),{flags:'a'});
  const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts',script)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:powerShellEnvironment(env)});
  let buffer='';
  child.stdout.on('data',chunk=>{log.write(chunk);buffer+=chunk.toString();const lines=buffer.split(/\r?\n/);buffer=lines.pop();for(const line of lines)if(line.startsWith('PHASE:'))onPhase(line.slice(6));});
  child.stderr.on('data',chunk=>log.write(chunk));
  const cancel=()=>{void stopChildTree(child);};signal?.addEventListener('abort',cancel,{once:true});
  try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('环境准备失败，请查看 logs/setup.log；检查下载连接和已有游戏目录。')));});signal?.throwIfAborted();}
  finally{signal?.removeEventListener('abort',cancel);if(signal?.aborted)await stopChildTree(child);log.end();}
}
export async function prepareEnvironment(settings,{signal,onPhase=()=>{}}={}){
  if(!toolsReady())await runPreparation('bootstrap_tools.ps1',{signal,onPhase});
  const env=toolEnvironment();
  process.env.FISH_JAVA=env.FISH_JAVA;process.env.JAVA_HOME=env.JAVA_HOME;
  if(gameEnvironmentReady())return;
  const home=findMinecraft(settings.minecraftHome);
  if(!home)throw new Error('未找到 Minecraft Java 1.21.4。请先在启动器安装并启动一次，或填写游戏目录后再准备；插件不下载客户端本体。');
  onPhase('game-dependencies');
  await runPreparation('setup_native.ps1',{signal,onPhase,env:{...env,FISH_MINECRAFT_HOME:home}});
  if(!gameEnvironmentReady())throw new Error('游戏依赖准备未完整完成，请重试并检查日志。');
}
