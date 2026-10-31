import test from 'node:test';
import assert from 'node:assert/strict';
import {withCommentary,shortCommentary,actionCommentary,actionFeedback,reactionAllowed} from '../src/commentary.mjs';
import {Store} from '../src/state.mjs';
test('主要动作在同一次工具调用里带短句，查询和转头不添加口播字段',()=>{
 const t={type:'function',function:{name:'collect_blocks',parameters:{type:'object',properties:{count:{type:'integer'}},required:['count'],additionalProperties:false}}};
 assert.deepEqual(withCommentary(t).function.parameters.required,['count','say']);assert.equal(t.function.parameters.properties.say,undefined);
 assert.equal(withCommentary(t,true),t);assert.equal(actionCommentary('look_at','这里有石头'), '');
});
test('长句安全收敛，观众只看到游戏短句而不包含运行计时和内部错误',()=>{
 const s=new Store({persist:false});s.say(shortCommentary('接下来\n去收集木头'),'collect_blocks');s.performance={modelMs:2000};s.reason='private-error';
 const p=s.overlayState();assert.equal(p.commentary.text,'接下来 去收集木头');assert.ok(!('performance'in p));assert.ok(!JSON.stringify(p).includes('private-error'));
 assert.equal([...shortCommentary('木'.repeat(200))].length,120);
});
test('游戏内挂件可单独关闭，浏览器备用数据仍然可读',()=>{
 const s=new Store({persist:false});s.settings.nativeHudEnabled=false;
 s.say('气泡测试：先找木头。','preview');
 assert.equal(s.overlayState().hudEnabled,false);
 assert.equal(s.overlayState().commentary.text,'气泡测试：先找木头。');
});
test('反应依据真实最低血量，目标消失不当作死亡，危急或过期不插感想',()=>{
 const previous={id:'event1',name:'attack_entity',at:1000,before:{health:20},result:{state:'succeeded',result:{missing:true,attacks:1},evidence:{healthBefore:20,lowestHealthObserved:16,healthAfter:19,targetDeathObserved:false,targetType:'minecraft:skeleton'}}};
 const current={result:{situation:{vitals:{health:20,airSupplyTicks:300},position:{inWater:false},nearby:{hostiles:[]}}}};
 const f=actionFeedback(previous,current,2000);assert.equal(f.health.observedDrop,4);assert.equal(f.health.now,20);assert.equal(f.target.deathObserved,false);assert.equal(f.target.missing,true);assert.equal(reactionAllowed(f,current),true);
 assert.equal(f.health.observedHeartsLost,2);
 assert.equal(reactionAllowed({...f,ageMs:31000},current),false);
 current.result.situation.position.inWater=true;current.result.situation.vitals.airSupplyTicks=0;assert.equal(reactionAllowed(f,current),false);
 assert.equal(actionFeedback({...previous,before:{},result:{state:'succeeded'}},{},2000).health.lowestObserved,null);
});
