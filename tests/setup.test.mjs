import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {SetupState,SetupError} from '../src/setup-state.mjs';
import {downloadVerified} from '../src/downloads.mjs';
import {platformCheck} from '../src/game-setup.mjs';
import {SUPPORTED_VERSIONS,chooseGame,gameWorldName} from '../src/versions.mjs';
import {portAvailable,checkGamePorts} from '../src/ports.mjs';
test('准备进度保留实际失败步骤、恢复建议和取消状态，不冒报全部完成',()=>{
 const s=new SetupState();s.begin();s.update('check');s.update('java',{message:'下载Java'});assert.equal(s.steps[0].state,'done');s.fail(new SetupError('NETWORK','libraries','连接失败','host','检查网络'));
 assert.equal(s.snapshot().error.step,'java');assert.equal(s.steps[1].state,'failed');assert.equal(s.steps[2].state,'pending');assert.equal(s.error.hint,'检查网络');
 s.begin();s.update('libraries');s.fail(new DOMException('cancelled','AbortError'));assert.equal(s.error.code,'CANCELLED');assert.equal(s.steps.find(x=>x.id==='libraries').state,'cancelled');
});
test('1.21系列按完整版本匹配，自动选择尊重用户目录，其他版本的世界相互隔离',()=>{
 assert.equal(SUPPORTED_VERSIONS.length,12);assert.ok(SUPPORTED_VERSIONS.includes('1.21'));assert.ok(SUPPORTED_VERSIONS.includes('1.21.11'));
 const games=[{version:'1.21.11',origin:'default'},{version:'1.21.4',origin:'selected'}];assert.equal(chooseGame(games,{minecraftVersion:'auto'}).version,'1.21.4');assert.equal(chooseGame(games,{minecraftVersion:'1.21.11'}).version,'1.21.11');assert.throws(()=>chooseGame(games,{minecraftVersion:'1.21.12'}));
 assert.equal(gameWorldName({world:'live',resolvedVersion:'1.21.4'}),'live');assert.equal(gameWorldName({world:'live',resolvedVersion:'1.21.11'}),'live-1.21.11');
 assert.throws(()=>platformCheck('linux','x64'),e=>e.code==='PLATFORM'&&!e.retryable);assert.doesNotThrow(()=>platformCheck('win32','x64'));
});
test('下载校验失败后重取，完整缓存不联网，取消后不保留半个文件',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fish-download-'));const target=path.join(root,'runtime.jar'),bytes=Buffer.from('verified-runtime'),hash=createHash('sha256').update(bytes).digest('hex');let calls=0;
 const spec={url:'https://example.invalid/runtime.jar',algorithm:'sha256',hash};
 try{
  await downloadVerified(spec,target,{fetchImpl:async()=>new Response(++calls===1?'broken':bytes)});assert.equal(calls,2);assert.deepEqual(fs.readFileSync(target),bytes);
  await downloadVerified(spec,target,{fetchImpl:async()=>{throw Error('must use cache');}});
  const controller=new AbortController();await assert.rejects(downloadVerified(spec,path.join(root,'cancel.jar'),{signal:controller.signal,fetchImpl:async()=>{controller.abort();return new Response(bytes);}}),e=>e.name==='AbortError');assert.equal(fs.existsSync(path.join(root,'cancel.jar.download')),false);
  await assert.rejects(downloadVerified({...spec,hash:'invalid'},target),e=>e.code==='DOWNLOAD_MANIFEST'&&!e.retryable);
 }finally{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});
test('被占用的游戏端口给出可恢复错误，不终止占用者',async()=>{
 const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 try{assert.equal((await portAvailable(port)).available,false);await assert.rejects(checkGamePorts({minecraftPort:port,mcpPort:port}),e=>e.code==='PORT_BUSY'&&e.detail.includes(String(port)));assert.equal(server.listening,true);}finally{await new Promise(resolve=>server.close(resolve));}
});
