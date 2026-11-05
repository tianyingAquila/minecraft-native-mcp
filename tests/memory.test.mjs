import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Agent} from '../src/agent.mjs';
import {Runtime} from '../src/runtime.mjs';
import {Store} from '../src/state.mjs';
import {contextSize,contextPressure,measureContext,splitHistory,summaryRequest,summaryText,CONTEXT_TRIGGER_TOKENS} from '../src/memory.mjs';

const group=(id,size=100)=>[{role:'assistant',tool_calls:[{id,type:'function',function:{name:'observe',arguments:'{}'}}]},{role:'tool',tool_call_id:id,content:'x'.repeat(size)}];
const bodyFor=history=>({model:'deepseek-flash',messages:[{role:'system',content:'游戏规则'},...history.flat(),{role:'user',content:'当前位置：主世界10,64,20；手动笔记：回家补食物'}],tools:[],max_tokens:4096});
const response=(content='已确认：主世界地狱门在10,64,20；下一步补食物。')=>({choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:200000,completion_tokens:30}});
function fixture(chatFn) {
  const store=new Store({persist:false});store.status='running';store.startClock();
  const events=[];
  const r={store,lifecycle:0,observe(){},mcp:{tools:()=>[],status:async()=>({health:20}),freeze:async()=>events.push('client-freeze'),resume:async()=>events.push('client-resume')},minecraft:{freeze:async()=>events.push('server-freeze'),resume:()=>events.push('server-resume')},async pause(code){this.lifecycle++;store.status='paused';store.stopClock();this.agent.abort();this.paused=code;}};
  r.withFrozenGame=work=>Runtime.prototype.withFrozenGame.call(r,work);
  const a=new Agent(r,{chatFn,balanceFn:async()=>({micros:20000000,currency:'CNY',available:true,checkedAt:Date.now()})});
  a.controller=new AbortController();a.save=()=>{};a.load=()=>{};r.agent=a;
  a.history=Array.from({length:6},(_,i)=>group('g'+i,120000));a.notes='回家补食物';a.memory='旧摘要：缺少食物';
  return {a,r,events};
}

test('上下文用API实报校准增长；无实报用UTF8保守上界，不把base64当token',()=>{
  assert.equal(CONTEXT_TRIGGER_TOKENS,500000);
  const body=bodyFor([group('a')]);
  body.messages.at(-1).content=[{type:'text',text:'图片待游戏决策查看'},{type:'image_url',image_url:{url:'data:image/png;base64,'+'A'.repeat(1000000)}}];
  const size=contextSize(body);assert.ok(size.textBytes<1000);assert.equal(size.imageTokens,1024);
  const meter=measureContext(body,{prompt_tokens:480000});
  assert.equal(contextPressure(body,meter).estimatedTokens,480000);
  body.messages[0].content+='x'.repeat(21000);
  assert.ok(contextPressure(body,meter).estimatedTokens>=500000);
  const summary=summaryRequest(body);assert.ok(!JSON.stringify(summary).includes('data:image/'));
  assert.equal(summary.tool_choice,'none');assert.ok(JSON.stringify(body).includes('data:image/'));
  const longBody=bodyFor([group('long',2500000)]),retainedBody=bodyFor([group('recent',500000)]);
  const afterCompaction={...measureContext(longBody,{prompt_tokens:500000}),afterCompaction:true};
  assert.equal(contextPressure(retainedBody,afterCompaction).basis,'density_after_compaction');
  assert.ok(contextPressure(retainedBody,afterCompaction).estimatedTokens<200000,'整理后不应因字节回退立即再次整理');
});

test('按完整工具组保留近期记录；摘要必须非空、非截断、无工具调用',()=>{
  const h=Array.from({length:6},(_,i)=>group(String(i),1000));
  const split=splitHistory(h,null,2500);assert.equal(split.recent.length,2);assert.equal(split.older.length,4);
  assert.equal(split.recent[0][0].tool_calls[0].id,split.recent[0][1].tool_call_id);
  for(const invalid of [response(''),{choices:[{finish_reason:'length',message:{content:'半截摘要'}}]},{choices:[{message:{content:'摘要',tool_calls:[{}]}}]}])assert.throws(()=>summaryText(invalid));
});

test('到阈值后先冻结整理再正常决策，整理计费计用量，摘要和近期记录进入下一轮',async()=>{
  let calls=0;const {a,r,events}=fixture(async body=>{
    calls++;
    if(calls===1){assert.equal(r.store.startedAt,null);assert.equal(r.store.overlayState().contextCompacting,true);assert.deepEqual(events,['client-freeze','server-freeze']);assert.equal(body.tool_choice,'none');return response();}
    assert.deepEqual(events,['client-freeze','server-freeze','client-resume','server-resume']);
    assert.ok(body.messages.at(-1).content.includes('地狱门在10,64,20'));assert.equal(a.history.length,1);
    return response('继续冒险');
  });
  await a.begin({maxRounds:1});
  assert.equal(calls,2);assert.equal(r.store.calls,2);assert.equal(r.store.usage.prompt,400000);
  assert.equal(r.store.contextCompaction.state,'complete');assert.equal(r.paused,'test_complete');
});

test('整理失败或空摘要保留原历史和记忆，不自动解冻',async()=>{
  for(const chat of [async()=>response(''),async()=>{throw new Error('模拟网络超时');}]){
    const {a,r,events}=fixture(chat),history=a.history,memory=a.memory;
    await assert.rejects(a.compactContext(bodyFor(a.history)));
    assert.equal(a.history,history);assert.equal(a.memory,memory);assert.ok(!events.includes('server-resume'));
    assert.equal(r.store.contextCompaction.state,'failed');assert.equal(r.store.startedAt,null);
  }
});

test('人工暂停发生在整理中时，晚返回的摘要不能覆盖记忆或恢复游戏',async()=>{
  const {a,r,events}=fixture(async()=>{await r.pause('operator');return response();});
  const history=a.history,memory=a.memory;
  await assert.rejects(a.compactContext(bodyFor(history)),e=>e.name==='AbortError');
  assert.equal(a.history,history);assert.equal(a.memory,memory);assert.ok(!events.includes('client-resume'));
  assert.equal(r.paused,'operator');assert.equal(r.store.overlayState().contextCompacting,false);
});

test('人工暂停发生在客户端解冻应答期间时，服务器不能被迟到恢复',async()=>{
  const {a,r,events}=fixture(async()=>response());
  r.mcp.resume=async()=>{events.push('client-resume');await r.pause('operator');};
  await assert.rejects(a.compactContext(bodyFor(a.history)),e=>e.name==='AbortError');
  assert.ok(!events.includes('server-resume'));assert.equal(r.store.startedAt,null);
});

test('整理前余额不足不发付费请求，保存失败不替换原历史',async()=>{
  let charged=0;const {a,events}=fixture(async()=>{charged++;return response();});
  const original=a.history;
  a.balanceFn=async()=>({micros:1000000,currency:'CNY',available:true,checkedAt:Date.now()});
  await assert.rejects(a.compactContext(bodyFor(original)));assert.equal(charged,0);assert.equal(a.history,original);
  a.balanceFn=async()=>({micros:20000000,currency:'CNY',available:true,checkedAt:Date.now()});
  a.save=()=>{throw new Error('磁盘写入失败');};
  await assert.rejects(a.compactContext(bodyFor(original)));assert.equal(a.history,original);assert.ok(!events.includes('server-resume'));
});

test('重开原子恢复自动摘要、手动笔记和完整历史，不再85KB直接裁剪',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fish-memory-'));
  try{
    const {a,r}=fixture(async()=>response());
    Object.defineProperty(a,'sessionFile',{value:path.join(dir,'agent.json')});
    a.contextMeter=measureContext(bodyFor(a.history),{prompt_tokens:200000});
    Agent.prototype.save.call(a);
    const b=new Agent(r);Object.defineProperty(b,'sessionFile',{value:a.sessionFile});b.load();
    assert.equal(b.history.length,6);assert.equal(b.memory,a.memory);assert.equal(b.notes,a.notes);assert.deepEqual(b.contextMeter,a.contextMeter);
    assert.equal(fs.existsSync(a.sessionFile+'.tmp'),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
