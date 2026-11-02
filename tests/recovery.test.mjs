import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverPosition} from '../src/recovery.mjs';
function fixture({unsupported=false,hostile=false}={}){
 let time=0,nav=null;const calls=[],self={x:.5,y:64,z:.5,yaw:0,health:20,onGround:true};
 const call=async(method,args={})=>{calls.push(method);if(method==='player.getState')return {...self};if(method==='perception.entities')return {entities:hostile?[{distance:4}]:[]};
 if(method==='fish.probeBlocks')return {blocks:args.positions.map(p=>({...p,loaded:true,id:p.y===63?'minecraft:stone':'minecraft:air',collision:p.y===63,fullSupport:!unsupported&&p.y===63,fluid:false,falling:false}))};
 if(method==='fish.navigate'){nav=args;return {};}
 if(method==='fish.cancel'){nav=null;return {};}
 return {};};
 return {call,calls,now:()=>time,sleep:async ms=>{time+=ms;if(nav)Object.assign(self,{x:nav.x,y:nav.y,z:nav.z});}};
}
test('仅在实际验证有支撑和身体空间后局部挪动，完成后停止寻路',async()=>{
 const f=fixture(),r=await recoverPosition(f);assert.equal(r.status,'succeeded');assert.equal(r.reason,'position_recovered');assert.ok(f.calls.includes('fish.probeBlocks'));assert.equal(f.calls.at(-1),'fish.cancel');
});
test('无可靠地面或近处有敌人时不瞎走，返回明确重新规划原因',async()=>{
 for(const [options,reason] of [[{unsupported:true},'no_verified_exit'],[{hostile:true},'enemy_nearby']]){const f=fixture(options),r=await recoverPosition(f);assert.equal(r.reason,reason);assert.ok(!f.calls.includes('fish.navigate'));}
});
