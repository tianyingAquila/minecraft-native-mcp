import test from 'node:test';
import assert from 'node:assert/strict';
import {describeContainer} from '../src/container-state.mjs';
import {ClientActions} from '../src/client-actions.mjs';
import {ProgressGuard} from '../src/progress.mjs';
const index={version:'1.21.4',source:'official-client-default-recipes',recipes:[{type:'minecraft:smelting',inputs:['minecraft:raw_iron'],result:{id:'minecraft:iron_ingot',count:1},cookingTicks:200}]};
const furnace=(output='minecraft:copper_ingot',count=22)=>({open:true,type:'minecraft:furnace',size:3,containerId:1,slots:[{slot:0,id:'minecraft:raw_iron',count:10},{slot:1,id:'minecraft:coal',count:8},...count?[{slot:2,id:output,count}]:[]]});

test('熔炉分清三槽，并指出旧铜产物阻止粗铁产铁，不虚构燃烧进度',()=>{
 const raw=furnace(),menu=describeContainer(raw,index);
 assert.equal(menu.slots[2].role,'output');assert.equal(menu.furnace.input.id,'minecraft:raw_iron');
 assert.equal(menu.furnace.status,'output_blocked');assert.equal(menu.furnace.blockers[0].code,'OUTPUT_ITEM_MISMATCH');
 assert.equal(menu.furnace.recipe.result.id,'minecraft:iron_ingot');assert.equal(menu.furnace.burning,'not_observed');assert.equal(raw.slots[2].role,undefined);
});
test('输出空位、同类未满、满槽、燃料空与未知配方分别报告，不把空煤槽当成熄火',()=>{
 const empty=describeContainer(furnace(undefined,0),index);assert.deepEqual(empty.emptySlots,[2]);assert.equal(empty.furnace.output.id,null);
 assert.equal(describeContainer(furnace('minecraft:iron_ingot',3),index).furnace.blockers.length,0);
 assert.equal(describeContainer(furnace('minecraft:iron_ingot',64),index).furnace.status,'output_full');
 const fuelEmpty=furnace();fuelEmpty.slots=fuelEmpty.slots.filter(s=>s.slot!==1);assert.equal(describeContainer(fuelEmpty,index).furnace.burning,'not_observed');
 const unknown=describeContainer(furnace(),null);assert.equal(unknown.furnace.recipe,null);assert.equal(unknown.furnace.status,'not_confirmed');
});
test('已经关闭的界面不再伪报新动作成功，重复请求进入原有重规划保护',async()=>{
 let closes=0;const a=new ClientActions({bridge:{call:async m=>m==='screen.get'?{screen:'none'}:{}}});
 a.client=true;a.catalogue=[{name:'close_container'},{name:'close_game_screen'}];a.definitions=new Map([['close_container',{validator:{parse:x=>x},run:async()=>{closes++;return 'closed';}}]]);
 const result=await a.execute('close_container');assert.equal(result.error,'SCREEN_ALREADY_CLOSED');assert.equal(closes,0);
 assert.equal((await a.execute('close_game_screen')).error,'SCREEN_ALREADY_CLOSED');
 const guard=new ProgressGuard();guard.record('close_container',{},result);guard.record('close_container',{},result);assert.equal(guard.blocked('close_container',{}).error,'REPLAN_REQUIRED');
});
test('关闭容器要确认最终界面状态，仍开着不能返回closed',async()=>{
 let open=true,broken=false;const a=new ClientActions({bridge:{call:async m=>m==='screen.get'?{screen:open?'container':'none'}:m==='container.state'?{open,slots:[],size:3,type:'minecraft:furnace'}:{}}});
 a.client=true;a.catalogue=[{name:'close_container'}];a.definitions=new Map([['close_container',{validator:{parse:x=>x},run:async()=>{if(!broken)open=false;return 'closed';}}]]);
 const result=await a.execute('close_container');assert.deepEqual(result.result,{closed:true,screen:'none',externalContainerOpen:false});
 broken=true;open=true;await assert.rejects(a.execute('close_container'),e=>e.code==='SCREEN_CLOSE_NOT_CONFIRMED');
});
test('工作台、酿造台、铁砧、交易与未知窗口共用真实槽位和取放条件，不按箱子猜',()=>{
 const make=(type,size)=>({open:true,type,size,slots:[{slot:2,id:'minecraft:iron_sword',count:1}],slotDetails:[{slot:0,empty:true,active:true,canTake:false,acceptsCarried:false,acceptsInventoryItems:['minecraft:iron_ingot']},{slot:2,empty:false,active:true,canTake:false,acceptsCarried:false,acceptsInventoryItems:[]}],carried:{empty:true},properties:[5,7],experienceLevel:2});
 assert.equal(describeContainer(make('minecraft:crafting',10),null).slotRoles.output,0);
 assert.equal(describeContainer(make('minecraft:brewing_stand',5),null).slotRoles.ingredient,3);
 const anvil=describeContainer(make('minecraft:anvil',3),null);assert.equal(anvil.anvil.requiredLevels,5);assert.equal(anvil.blockers[0].code,'NATIVE_PICKUP_DENIED');assert.deepEqual(anvil.emptySlots,[0]);
 assert.equal(describeContainer(make('minecraft:merchant',3),null).slots[0].role,'output');
 const unknown=describeContainer(make('modded:machine',3),null);assert.equal(unknown.layoutKnown,false);assert.equal(unknown.slots[0].role,'unknown');assert.equal(unknown.slotRules[0].acceptsInventoryItems[0],'minecraft:iron_ingot');
});
test('真实余火与烹饪进度优先于煤槽是否为空，光标持物单独报告',()=>{
 const raw=furnace('minecraft:iron_ingot',3);raw.slots=raw.slots.filter(s=>s.slot!==1);raw.properties=[80,1600,40,200];raw.carried={empty:false,id:'minecraft:coal',count:3};
 const menu=describeContainer(raw,index);assert.equal(menu.furnace.burning,true);assert.equal(menu.furnace.progress.cookedTicks,40);assert.equal(menu.fuelSlotEmpty,true);assert.equal(menu.blockers[0].code,'CURSOR_HOLDING_ITEM');
});
