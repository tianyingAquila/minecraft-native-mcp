import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorld,listWorlds,worldInfo,selectWorldInfo,saveWorldSession,readWorldSession,trashWorld} from '../src/worlds.mjs';
import {gameWorldName} from '../src/versions.mjs';
import {createWorldFiles} from '../src/minecraft.mjs';
import {Runtime} from '../src/runtime.mjs';
import {worldClientDirectory} from '../src/native-client.mjs';

test('新建世界使用独立标识和版本，重名不覆盖，旧存档与记忆保持原路径',()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'fish-worlds-')),options={data},old={world:'rehearsal',resolvedVersion:'1.21.4'};
 try{
  assert.equal(listWorlds(old,options).length,1);
  const oldDir=path.join(data,'worlds/rehearsal/world');fs.mkdirSync(oldDir,{recursive:true});fs.writeFileSync(path.join(oldDir,'level.dat'),'existing-world');
  const a=createWorld({name:'新冒险',version:'1.21.4',seed:'1234'},options),b=createWorld({name:'新冒险',version:'1.21.4'},options);
  assert.notEqual(a.id,b.id);assert.equal(a.generated,false);assert.equal(a.seed,'1234');
  const rows=listWorlds(old,options);assert.equal(rows.length,3);assert.ok(rows.find(w=>w.id==='rehearsal').generated);assert.ok(rows.every(w=>!('seed' in w)));
  assert.equal(selectWorldInfo(a.id,a.version,old,options).name,'新冒险');assert.throws(()=>selectWorldInfo(a.id,'1.21.11',old,options));
  assert.equal(fs.readFileSync(path.join(oldDir,'level.dat'),'utf8'),'existing-world');
  assert.equal(gameWorldName(old),'rehearsal');assert.throws(()=>gameWorldName({world:'../world',resolvedVersion:'1.21.4'}));
  const modern=createWorld({name:'另一个版本',version:'1.21.11'},options);assert.match(gameWorldName({world:modern.id,resolvedVersion:modern.version}),/-1\.21\.11$/);
  assert.throws(()=>createWorld({name:' ',version:'1.21.4'},options));assert.throws(()=>createWorld({name:'x',version:'1.19.4'},options));assert.throws(()=>createWorld({name:'x',version:'1.21.4',seed:'1\nlevel-type=flat'},options));
 }finally{fs.rmSync(data,{recursive:true,force:true});}
});
test('世界目标与计时分开保存，种子仅写入对应新世界启动配置',()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'fish-world-session-')),options={data},old={world:'rehearsal',resolvedVersion:'1.21.4'};
 try{
  saveWorldSession(old,{goal:'找烈焰棒',elapsed:()=>123,deaths:2,usage:{prompt:10}},options);
  const a=createWorld({name:'开始',version:'1.21.4',seed:'测试种子'},options),settings={world:a.id,resolvedVersion:a.version};
  assert.deepEqual(readWorldSession(settings,options),{});assert.equal(readWorldSession(old,options).goal,'找烈焰棒');
  const dir=path.join(data,'worlds',gameWorldName(settings));createWorldFiles(dir,{...settings,minecraftPort:25586,worldSeed:worldInfo(settings,options).seed});
  const props=fs.readFileSync(path.join(dir,'server.properties'),'utf8');assert.match(props,/gamemode=survival/);assert.match(props,/difficulty=normal/);assert.match(props,/level-seed=测试种子/);
 }finally{fs.rmSync(data,{recursive:true,force:true});}
});
test('仍有游戏进程、准备或开始任务时，不允许创建或切换世界',()=>{
 const clean={busy:false,startTask:null,pauseTask:null,agent:{task:null},store:{status:'stopped'},minecraft:{child:null},observer:{running:()=>false}};
 assert.doesNotThrow(()=>Runtime.prototype.assertWorldChange.call(clean));
 for(const patch of [{busy:true},{startTask:Promise.resolve()},{pauseTask:Promise.resolve()},{minecraft:{child:{exitCode:null}}},{observer:{running:()=>true}}]){
  const context={...clean,...patch};assert.throws(()=>Runtime.prototype.assertWorldChange.call(context),/保存并停止/);
  assert.throws(()=>Runtime.prototype.createWorld.call({...context,assertWorldChange:()=>Runtime.prototype.assertWorldChange.call(context)},{name:'不应创建',version:'1.21.4'}),/保存并停止/);
 }
});
test('新世界的寻路缓存与身份独立，重进同一世界保持身份，游戏本体不复制',()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'fish-world-client-')),base=path.join(data,'shared');
 try{
  fs.mkdirSync(path.join(base,'config'),{recursive:true});fs.mkdirSync(path.join(base,'mods'));fs.writeFileSync(path.join(base,'mods/tool.jar'),'mod');
  const configFile=path.join(base,'config/mcpfabric.config.json');fs.writeFileSync(configFile,JSON.stringify({token:'local-test-token',worldIdKey:'legacy'}));
  const prepared={gameDir:base,configFile},a={world:'world-a',resolvedVersion:'1.21.4'},b={world:'world-b',resolvedVersion:'1.21.4'};
  const dirA=worldClientDirectory(a,prepared,{data}),dirB=worldClientDirectory(b,prepared,{data});assert.notEqual(dirA,dirB);
  const key=d=>JSON.parse(fs.readFileSync(path.join(d,'config/mcpfabric.config.json'))).worldIdKey;
  const first=key(dirA);assert.notEqual(first,key(dirB));worldClientDirectory(a,prepared,{data});assert.equal(first,key(dirA));
  assert.equal(worldClientDirectory({world:'rehearsal',resolvedVersion:'1.21.4'},prepared,{data}),base);
  assert.equal(fs.existsSync(path.join(dirA,'client.jar')),false);assert.ok(fs.existsSync(path.join(dirA,'mods/tool.jar')));
 }finally{fs.rmSync(data,{recursive:true,force:true});}
});
test('删除只打包所选世界及记忆缓存，回收失败恢复原文件',async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'fish-world-trash-')),options={data},other={world:'rehearsal',resolvedVersion:'1.21.4'};
 try{
  const a=createWorld({name:'只删这个',version:'1.21.4'},options);fs.mkdirSync(path.join(data,'worlds/rehearsal'),{recursive:true});fs.writeFileSync(path.join(data,'worlds/rehearsal/keep.txt'),'old');
  fs.writeFileSync(path.join(data,'agent-'+a.id+'.json'),'memory');
  await assert.rejects(trashWorld(a,{data,recycle:async()=>{throw Error('test failure');}}),/已恢复/);assert.ok(fs.existsSync(path.join(data,'agent-'+a.id+'.json')));assert.ok(worldInfo({world:a.id,resolvedVersion:a.version},options).deletable);
  await trashWorld(a,{data,recycle:async stage=>{assert.ok(fs.existsSync(path.join(stage,'agent-'+a.id+'.json')));assert.ok(fs.existsSync(path.join(stage,'恢复说明.txt')));fs.renameSync(stage,path.join(data,'recycled-test'));}});
  assert.equal(fs.existsSync(path.join(data,'agent-'+a.id+'.json')),false);assert.equal(listWorlds(other,options).some(w=>w.id===a.id),false);assert.equal(fs.readFileSync(path.join(data,'worlds/rehearsal/keep.txt'),'utf8'),'old');
 }finally{fs.rmSync(data,{recursive:true,force:true});}
});
