import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resolveFabricMetadata,sealFabricMetadata,validateFabricMetadata,fetchFabricMetadata} from '../src/fabric-metadata.mjs';

const version='1.21.4',loader='0.20.1',profile={id:`fabric-loader-${loader}-${version}`,inheritsFrom:version,mainClass:'net.fabricmc.loader.impl.launch.knot.KnotClient',libraries:[{name:`net.fabricmc:fabric-loader:${loader}`,url:'https://maven.fabricmc.net/'}]};
const hash='a'.repeat(40),record=sealFabricMetadata({schema:1,version,loader,profile,libraries:[{name:profile.libraries[0].name,url:`https://maven.fabricmc.net/net/fabricmc/fabric-loader/${loader}/fabric-loader-${loader}.jar`,sha1:hash}]});
const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'fish-fabric-'));
test('完整内置Fabric清单不联网，运行缓存也可离线复用；版本或内容变化不能误复用',async()=>{
 const root=temporary();
 try{
  fs.writeFileSync(path.join(root,'fabric-lock.json'),JSON.stringify({versions:{[version]:record}}));
  const offline=async()=>{throw Error('must not request network');};
  const bundled=await resolveFabricMetadata({root,version,loader,fetchImpl:offline});assert.equal(bundled.source,'bundled');assert.equal(bundled.libraries[0].sha1,hash);
  assert.throws(()=>validateFabricMetadata(record,'1.21.11',loader));assert.throws(()=>validateFabricMetadata(record,version,'other-loader'));
  const cache=path.join(root,'runtime/versions',version,'fabric-metadata-'+loader+'.json');fs.mkdirSync(path.dirname(cache),{recursive:true});fs.writeFileSync(cache,JSON.stringify(record));fs.unlinkSync(path.join(root,'fabric-lock.json'));
  assert.equal((await resolveFabricMetadata({root,version,loader,fetchImpl:offline})).source,'cache');
  const broken=structuredClone(record);broken.data.libraries[0].sha1='b'.repeat(40);assert.throws(()=>validateFabricMetadata(broken,version,loader));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('临时断连及503自动重试，冷启动写完整缓存，下一次无需访问配置或sha1接口',async()=>{
 const root=temporary();let calls=0;const progress=[];
 try{
  const fetchImpl=async url=>{calls++;if(calls===1)throw Object.assign(Error('fetch failed'),{cause:{code:'ECONNRESET'}});if(calls===2)return new Response('',{status:503});return new Response(String(url).endsWith('.sha1')?hash:JSON.stringify(profile));};
  const r=await resolveFabricMetadata({root,version,loader,fetchImpl,retryDelayMs:0,onProgress:p=>progress.push(p)});
  assert.equal(calls,4);assert.equal(r.source,'network');assert.ok(progress.some(p=>p.attempt===3));
  assert.equal((await resolveFabricMetadata({root,version,loader,fetchImpl:async()=>{throw Error('offline');}})).source,'cache');
  assert.deepEqual(fs.readdirSync(path.join(root,'runtime/versions',version)),['fabric-metadata-'+loader+'.json']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('失败次数有限，保留具体断连原因；取消立即退出且不写半份缓存',async()=>{
 const root=temporary();let calls=0;
 try{
  await assert.rejects(resolveFabricMetadata({root,version,loader,retryDelayMs:0,fetchImpl:async()=>{calls++;throw Object.assign(Error('failed'),{cause:{code:'ECONNRESET'}});}}),e=>e.code==='FABRIC_PROFILE'&&e.detail.includes('ECONNRESET'));assert.equal(calls,3);assert.equal(fs.existsSync(path.join(root,'runtime')),false);
  const controller=new AbortController();calls=0;
  await assert.rejects(resolveFabricMetadata({root,version,loader,signal:controller.signal,retryDelayMs:0,fetchImpl:async()=>{calls++;controller.abort();throw Error('aborted');}}),e=>e.name==='AbortError');assert.equal(calls,1);
  calls=0;await assert.rejects(fetchFabricMetadata(version,loader,{retryDelayMs:0,fetchImpl:async()=>{calls++;return new Response('',{status:404});}}),e=>e.code==='FABRIC_PROFILE'&&e.detail.includes('404'));assert.equal(calls,1);
  calls=0;await assert.rejects(fetchFabricMetadata(version,loader,{retryDelayMs:0,timeoutMs:5,fetchImpl:async(_url,{signal})=>{calls++;return new Promise((resolve,reject)=>{const timer=setTimeout(resolve,1000);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});}}),e=>e.code==='FABRIC_PROFILE'&&e.detail.includes('请求超时')&&e.detail.includes('3次'));assert.equal(calls,3);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('损坏缓存重新补取；库校验失败不覆盖原缓存，避免把部分成功当成可离线准备',async()=>{
 const root=temporary(),cache=path.join(root,'runtime/versions',version,'fabric-metadata-'+loader+'.json');
 try{
  fs.mkdirSync(path.dirname(cache),{recursive:true});fs.writeFileSync(cache,'broken');
  let calls=0;await assert.rejects(resolveFabricMetadata({root,version,loader,retryDelayMs:0,fetchImpl:async url=>{calls++;return new Response(String(url).endsWith('.sha1')?'invalid':JSON.stringify(profile));}}),e=>e.code==='FABRIC_LIBRARY');assert.equal(calls,4);assert.equal(fs.readFileSync(cache,'utf8'),'broken');
  const r=await resolveFabricMetadata({root,version,loader,retryDelayMs:0,fetchImpl:async url=>new Response(String(url).endsWith('.sha1')?hash:JSON.stringify(profile))});assert.equal(r.source,'network');assert.equal(JSON.parse(fs.readFileSync(cache)).sha256,record.sha256);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
