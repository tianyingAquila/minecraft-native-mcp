import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const COOKING_TYPES={'minecraft:furnace':'minecraft:smelting','minecraft:blast_furnace':'minecraft:blasting','minecraft:smoker':'minecraft:smoking'};
const range=(a,b)=>Array.from({length:b-a+1},(_,i)=>a+i);
const LAYOUTS={
 'minecraft:crafting':{output:0,crafting_input:range(1,9)},'player_inventory':{output:0,crafting_input:range(1,4)},
 'minecraft:furnace':{input:0,fuel:1,output:2},'minecraft:blast_furnace':{input:0,fuel:1,output:2},'minecraft:smoker':{input:0,fuel:1,output:2},
 'minecraft:brewing_stand':{bottle:[0,1,2],ingredient:3,fuel:4},
 'minecraft:anvil':{primary_input:0,secondary_input:1,output:2},'minecraft:grindstone':{primary_input:0,secondary_input:1,output:2},
 'minecraft:smithing':{template:0,base_item:1,addition:2,output:3},'minecraft:stonecutter':{input:0,output:1},
 'minecraft:cartography_table':{map:0,addition:1,output:2},'minecraft:loom':{banner:0,dye:1,pattern:2,output:3},
 'minecraft:enchantment':{item:0,lapis:1},'minecraft:merchant':{payment_a:0,payment_b:1,output:2},'minecraft:beacon':{payment:0},
 'minecraft:hopper':{storage:range(0,4)},'minecraft:shulker_box':{storage:range(0,26)},'minecraft:generic_3x3':{storage:range(0,8)},'minecraft:crafter_3x3':{crafting_input:range(0,8)},
 ...Object.fromEntries(range(1,6).map(n=>['minecraft:generic_9x'+n,{storage:range(0,n*9-1)}])),
};
export function loadCookingIndex(root,version){
 try{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'artifacts/helpers/manifest.json'))),entry=manifest.versions[version]?.cooking;
  if(!entry)return null;
  const bytes=fs.readFileSync(path.join(root,'artifacts/helpers',entry.path));
  if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)return null;
  const index=JSON.parse(bytes);return index.version===version?index:null;
 }catch{return null;}
}

// Preserve native slot numbers/non-empty slots. Add roles and explicit emptiness without inventing progress.
export function describeContainer(state,index){
 if(!state.open&&!state.screenVisible)return {...state,note:'当前没有打开容器界面；旧容器记录不是当前界面。'};
 const menu={...state,slots:state.slots.map(s=>({...s}))};
 menu.layoutKnown=Boolean(LAYOUTS[menu.type]);menu.slotRoles=LAYOUTS[menu.type]||{};menu.blockers=[];
 const role=slot=>Object.entries(menu.slotRoles).find(([,value])=>Array.isArray(value)?value.includes(slot):value===slot)?.[0]||'unknown';
 for(const s of menu.slots)s.role=role(s.slot);
 menu.emptySlots=state.slotDetails?state.slotDetails.filter(s=>s.empty).map(s=>s.slot):range(0,Math.min(54,state.size)-1).filter(i=>!menu.slots.some(s=>s.slot===i&&s.count>0));
 if(state.slotDetails){
  const groups=new Map();
  for(const s of state.slotDetails){const rule={active:s.active,canTake:s.canTake,slotLimit:s.limit,acceptsCarried:s.acceptsCarried,acceptsInventoryItems:s.acceptsInventoryItems};const key=JSON.stringify(rule);if(!groups.has(key))groups.set(key,{slots:[],...rule});groups.get(key).slots.push(s.slot);
   if(!s.empty&&role(s.slot)==='output'&&!s.canTake)menu.blockers.push({code:'NATIVE_PICKUP_DENIED',slot:s.slot,message:'当前原生规则不允许取出此产物；检查材料、经验或交易条件，不要把取出请求当成功。'});
   const occupied=menu.slots.find(x=>x.slot===s.slot);if(occupied){occupied.name=s.name;occupied.maxStack=s.maxStack;}
  }
  menu.slotRules=[...groups.values()];delete menu.slotDetails;
 }
 if(menu.carried&&!menu.carried.empty)menu.blockers.push({code:'CURSOR_HOLDING_ITEM',message:'鼠标光标仍拿着物品；它不在背包或容器格里，先确认放回位置再安排取放。'});
 if(!menu.layoutKnown)menu.note='此窗口布局用途尚未映射；格子编号和原生取放条件仍是真实值，不推测它是普通箱子。';
 const cookingType=COOKING_TYPES[menu.type];
 if(cookingType){
  const read=slot=>{const s=menu.slots.find(s=>s.slot===slot&&s.count>0);return {slot,id:s?.id??null,count:s?.count??0};};
  const input=read(0),fuel=read(1),output=read(2);
  const recipe=index?.recipes.find(r=>r.type===cookingType&&r.inputs.includes(input.id));
  menu.fuelSlotEmpty=fuel.count===0;
  menu.furnace={input,fuel,output,recipe:recipe?{result:recipe.result,cookingTicks:recipe.cookingTicks,source:index.source,version:index.version}:null,
   burning:menu.properties?.length>=4?menu.properties[0]>0:'not_observed',progress:menu.properties?.length>=4?{cookedTicks:menu.properties[2],totalTicks:menu.properties[3],burnRemainingTicks:menu.properties[0]}:'not_observed',status:input.count?'not_confirmed':'input_empty',blockers:[],
   note:'燃料槽有煤不代表正在烧；槽空也可能仍有余火。开关界面不会改变熔炼。产物槽有物品不代表当前输入已烧好。'};
  if(input.count&&output.count&&recipe&&output.id!==recipe.result.id){
   menu.furnace.status='output_blocked';
   menu.furnace.blockers.push({code:'OUTPUT_ITEM_MISMATCH',message:`输出槽2是${output.id}×${output.count}，当前输入${input.id}的产物为${recipe.result.id}，不能混放；先用container_transfer take取出现有产物。补煤、等待或开关界面不能解除这个冲突。`});
  }else if(input.count&&recipe&&output.count+recipe.result.count>64){
   menu.furnace.status='output_full';menu.furnace.blockers.push({code:'OUTPUT_FULL',message:'输出槽没有足够空间容纳下一件默认配方产物，先取出产物。'});
  }else if(input.count&&!recipe){
   menu.furnace.note+=' 尚未确认当前输入的配方，不要宣称正在烧；可用get_recipes核实产物。';
  }
  menu.blockers.push(...menu.furnace.blockers);
 }else if(menu.type==='minecraft:brewing_stand'&&menu.properties?.length>=2)menu.brewing={remainingTicks:menu.properties[0],fuelUnits:menu.properties[1]};
 else if(menu.type==='minecraft:anvil'&&menu.properties?.length)menu.anvil={requiredLevels:menu.properties[0],playerLevel:menu.experienceLevel};
 menu.observationNote='这是当前窗口快照；动作后重新读取。实际堆叠上限还受物品maxStack限制；接受背包物品不等于有对应配方。未提供的进度/按钮功能不能当作已知或已完成。';
 return menu;
}
