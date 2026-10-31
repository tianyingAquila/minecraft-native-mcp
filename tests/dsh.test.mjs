import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import plugin from '../dsh/index.mjs';
import {Launcher} from '../dsh/manager.mjs';
test('DSH插件注册bundle对应的启动、准备、状态、停止路由及桌面注入，并完整撤销',async()=>{
 const listeners=[],routes=[],effects=[];let removed=0;
 plugin.apply({on:(event,fn)=>{listeners.push([event,fn]);return ()=>removed++;},inject:(services,fn)=>fn({webServer:{register:route=>{routes.push(route);return ()=>removed++;},tapIndex:()=>()=>removed++},get:()=>null}),effect:fn=>effects.push(fn())});
 const rows=[];listeners[0][1](rows);listeners[0][1](rows);assert.equal(rows.length,1);assert.match(rows[0].text,/Minecraft 控制台/);assert.equal(routes.length,5);assert.ok(routes.some(r=>r.path==='/minecraft-native/prepare'));
 await effects[0]();assert.equal(removed,7);
});
test('已有外部控制台只连接打开，不冒领进程或停止原有游戏；种子不覆盖存档',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'minecraft-plugin-'));
 const calls=[];
 const launcher=new Launcher({workspace,fetchImpl:async(url)=>({json:async()=>({app:'deepseek-minecraft-live'})}),spawnImpl:(name,args)=>{calls.push([name,args]);return new EventEmitter();}});
 try{
  launcher.seed();assert.ok(fs.existsSync(path.join(workspace,'package-lock.json')));assert.ok(fs.existsSync(path.join(workspace,'src/server.mjs')));assert.equal(launcher.ready(),false);
  fs.mkdirSync(path.join(workspace,'data'),{recursive:true});fs.writeFileSync(path.join(workspace,'data/keep.txt'),'saved world');launcher.seed();assert.equal(fs.readFileSync(path.join(workspace,'data/keep.txt'),'utf8'),'saved world');
  await launcher.open();assert.equal(calls.length,1);assert.equal(calls[0][0],'explorer.exe');assert.equal(launcher.child,null);await launcher.stop();assert.equal(calls.length,1);
 }finally{assert.ok(path.resolve(workspace).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(workspace,{recursive:true,force:true});}
});
