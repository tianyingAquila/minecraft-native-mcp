import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {Runtime} from '../src/runtime.mjs';
import {Store} from '../src/state.mjs';
import {findMinecraft,toolsReady,toolEnvironment,powerShellEnvironment} from '../src/environment.mjs';
import {frontendScript} from '../dsh/index.mjs';

function fakeRuntime(){
 const r=new Runtime();clearInterval(r.timer);r.store=new Store({persist:false});r.environmentPrepare=async()=>{};r.refreshBalance=async()=>({available:true,micros:5000000});
 r.minecraft={start:async()=>{},freeze:async()=>{},command:()=>{}};
 r.mcp={connect:async()=>{},status:async()=>({result:{situation:{vitals:{health:20,food:20}}}}),freeze:async()=>{},close:async()=>{},cancel:async()=>{}};
 return r;
}
test('准备必须经过模型检查、环境准备及真实游戏连接，失败不展示ready；纯MCP不要求模型密钥',async()=>{
 const r=fakeRuntime(),steps=[];r.refreshBalance=async()=>{steps.push('credentials');throw Error('missing credential');};r.environmentPrepare=async()=>steps.push('environment');
 await assert.rejects(r.prepare(),/missing credential/);assert.equal(r.store.status,'error');assert.deepEqual(steps,['credentials']);
 await r.prepare({requireModel:false});assert.equal(r.store.status,'ready');assert.deepEqual(steps,['credentials','environment']);
 const failed=fakeRuntime();failed.environmentPrepare=async()=>{throw Error('missing game');};await assert.rejects(failed.prepare(),/missing game/);assert.equal(failed.store.status,'error');
});
test('取消准备会取消环境任务，任务未完成时不启动游戏',async()=>{
 const r=fakeRuntime();let started=false;r.minecraft.start=async()=>{started=true;};r.environmentPrepare=(_,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError'))));
 const preparing=r.prepare().catch(()=>{});await new Promise(resolve=>setTimeout(resolve,0));await r.pause();await preparing;assert.equal(started,false);assert.equal(r.store.status,'paused');
});
test('双注入且模式栏尚未出现时只创建一个入口观察器，避免两个按钮互相移动',()=>{
 let observers=0,panels=0;
 const context={window:{},document:{getElementById:()=>null,querySelectorAll:()=>[],createElement:tag=>({style:{},querySelector:()=>({}),querySelectorAll:()=>[],hidden:false}),body:{append:()=>panels++}},MutationObserver:class{constructor(){observers++;}observe(){}},setTimeout:()=>{}};
 vm.runInNewContext(frontendScript,context);vm.runInNewContext(frontendScript,context);assert.equal(observers,1);assert.equal(panels,1);
});
test('游戏本体按固定SHA1识别，错误版本不接受；缺失工具不靠旧manifest冒充齐全',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'minecraft-preparation-'));
 try{
  const home=path.join(root,'game');fs.mkdirSync(home);const bytes=Buffer.from('fixture-game'),sha=createHash('sha1').update(bytes).digest('hex');fs.writeFileSync(path.join(home,'client.jar'),'wrong');assert.equal(findMinecraft(home,root,sha),null);fs.writeFileSync(path.join(home,'client.jar'),bytes);assert.equal(findMinecraft(home,root,sha),home);
  fs.mkdirSync(path.join(root,'runtime'));fs.writeFileSync(path.join(root,'runtime/tools.json'),'\ufeff'+JSON.stringify({java:'missing.exe',javaHome:'missing',node:'missing',python:'missing',git:'missing'}));assert.equal(toolsReady(root),false);assert.equal(toolEnvironment(root,{PATH:'previous'}).FISH_JAVA,'missing.exe');
  if(process.platform==='win32')assert.match(powerShellEnvironment({PSModulePath:'PowerShell7',SystemRoot:'C:\\Windows'}).PSModulePath,/WindowsPowerShell/);
 }finally{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});
test('普通版默认关闭挂件，直播扩展显式启用后才绘制',()=>{
 const store=new Store({persist:false});store.settings.streamingEnabled=false;store.settings.nativeHudEnabled=true;assert.equal(store.overlayState().hudEnabled,false);store.settings.streamingEnabled=true;assert.equal(store.overlayState().hudEnabled,true);
});
