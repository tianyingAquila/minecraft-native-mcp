import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './config.mjs';
export {inspectEnvironment} from './game-setup.mjs';
import {prepareGameEnvironment} from './game-setup.mjs';

export function toolEnvironment(root=ROOT,base=process.env){
  const env={...base,ELECTRON_RUN_AS_NODE:'1'};
  const file=path.join(root,'runtime/tools.json');
  if(fs.existsSync(file)){
    const tools=JSON.parse(fs.readFileSync(file,'utf8').trimStart());
    if(tools.java)env.FISH_JAVA=tools.java;if(tools.javaHome)env.JAVA_HOME=tools.javaHome;if(tools.python)env.FISH_PYTHON=tools.python;
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
  try{const p=JSON.parse(fs.readFileSync(path.join(root,'runtime/tools.json'),'utf8').trimStart());return [p.node,path.join(root,'node_modules/@modelcontextprotocol/sdk/package.json'),path.join(root,'node_modules/yaml/package.json'),path.join(root,'node_modules/zod/package.json')].every(f=>typeof f==='string'&&fs.existsSync(f));}catch{return false;}
}
export async function prepareEnvironment(settings,options={}){return prepareGameEnvironment(settings,options);}
