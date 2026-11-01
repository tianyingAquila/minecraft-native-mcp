// Interpret only current client biome and ray-visible evidence, never server structure/seed data.
const BIOMES={'minecraft:lush_caves':'繁茂洞穴','minecraft:dripstone_caves':'溶洞（滴水石洞穴）','minecraft:deep_dark':'深暗之域','minecraft:plains':'平原','minecraft:forest':'森林','minecraft:desert':'沙漠','minecraft:badlands':'恶地','minecraft:nether_wastes':'下界荒地','minecraft:crimson_forest':'绯红森林','minecraft:warped_forest':'诡异森林','minecraft:soul_sand_valley':'灵魂沙峡谷','minecraft:basalt_deltas':'玄武岩三角洲','minecraft:the_end':'末地'};
const CAVE_BIOMES=new Set(['minecraft:lush_caves','minecraft:dripstone_caves','minecraft:deep_dark']);
const short=id=>id.replace(/^minecraft:/,'');
const RAIL=/_rail$|^rail$/;
export function describeEnvironment({biome,dimension,player,openSky,blocks}){
 const counts=new Map();for(const b of blocks){const id=short(b.id);if(!counts.has(id))counts.set(id,[]);counts.get(id).push(b);}
 const matching=pattern=>[...counts].filter(([id])=>typeof pattern==='string'?id===pattern:pattern.test(id)).flatMap(([,v])=>v);
 const evidence=patterns=>patterns.flatMap(p=>matching(p).sort((a,b)=>a.distance-b.distance).slice(0,1)).slice(0,4).map(b=>({id:b.id,at:[b.x,b.y,b.z],distance:Math.round(b.distance*10)/10}));
 const has=p=>matching(p).length>0,candidates=[];
 const add=(id,label,patterns,note)=>{candidates.push({id,label,certainty:'possible',evidence:evidence(patterns),note});};
 if(has(RAIL)&&(has('cobweb')||matching(/_fence$|_planks$/).length>=2)||has('cobweb')&&has(/_fence$/)&&matching(/_planks$/).length>=2)add('mineshaft','疑似废弃矿井',[RAIL,'cobweb',/_fence$|_planks$/],'可见铁轨或蛛网与木质支护组合，也可能是人工矿道；先确认，不当作生成结构已证实。');
 if(biome!=='minecraft:lush_caves'&&has('moss_block')&&has(/cave_vines|spore_blossom|dripleaf/))add('lush_cave_features','繁茂洞穴植被线索',['moss_block',/cave_vines|spore_blossom|dripleaf/],'看到了洞穴植被组合，但当前位置群系不一定已进入繁茂洞穴。');
 if(biome!=='minecraft:dripstone_caves'&&has('pointed_dripstone')&&has('dripstone_block'))add('dripstone_features','滴水石洞穴线索',['pointed_dripstone','dripstone_block'],'可见钟乳石/石笋相关方块，当前位置群系仍以客户端数据为准。');
 if(biome!=='minecraft:deep_dark'&&has('sculk')&&has(/sculk_sensor|sculk_shrieker/))add('sculk_features','幽匿环境线索',['sculk',/sculk_sensor|sculk_shrieker/],'有幽匿相关方块，注意声音和危险；不等于已发现远古城市。');
 if(has('end_portal_frame'))add('stronghold','疑似要塞',['end_portal_frame'],'直接观察到末地传送门框架；附近结构仍需探索确认。');
 else if(has(/^(mossy_|cracked_)?stone_bricks$/)&&(has('iron_bars')||has('bookshelf')))add('stronghold','疑似要塞遗迹',[/^(mossy_|cracked_)?stone_bricks$/,'iron_bars','bookshelf'],'石砖与铁栏/书架组合是线索，也可能是人工建筑。');
 if(has('budding_amethyst')||has('amethyst_block')&&has('calcite'))add('geode','疑似紫晶洞',['budding_amethyst','amethyst_block','calcite'],'可见紫晶相关方块，留意完整空间与资源。');
 if(has('reinforced_deepslate'))add('ancient_city','疑似远古城市',['reinforced_deepslate'],'可见强化深板岩；不要把普通深暗群系等同于已发现城市。');
 if(dimension==='minecraft:the_nether'&&has('nether_bricks')&&has(/nether_brick_fence|nether_brick_stairs/))add('nether_fortress','疑似下界要塞',['nether_bricks',/nether_brick_fence|nether_brick_stairs/],'由可见建筑材料推断，尚未确认完整结构。');
 if(has('gilded_blackstone')&&has(/blackstone/))add('bastion','疑似堡垒遗迹',['gilded_blackstone',/polished_blackstone_bricks/],'可见镶金黑石等建筑线索，先评估猪灵和地形危险。');
 if(has('trial_spawner')||has('vault'))add('trial_chambers','试炼建筑线索',['trial_spawner','vault'],'直接看到试炼刷怪笼或宝库，但不代表已清理或可安全开启。');
 if(has('crying_obsidian')&&(has('obsidian')||has('gold_block')))add('ruined_portal','疑似废弃传送门',['crying_obsidian','obsidian','gold_block'],'由可见材料判断，完整性与修复条件未知。');
 if(has('spawner')&&has('mossy_cobblestone'))add('dungeon','疑似刷怪地牢',['spawner','mossy_cobblestone'],'可见刷怪笼与苔石，先查看敌人与安全位置。');
 const landmarks=[['container',/^(chest|trapped_chest|barrel)$/,'可见容器'],['spawner',/^(spawner|trial_spawner)$/,'可见刷怪笼'],['portal',/^(end_portal_frame|nether_portal)$/,'可见传送门相关方块']].flatMap(([id,pattern,label])=>has(pattern)?[{id,label,evidence:evidence([pattern])}]:[]);
 return {biome:biome&&biome!=='unknown'?{id:biome,name:BIOMES[biome]||biome,source:'client_biome_registry'}:null,
  dimension,underground:!openSky&&player.y<63,candidates,landmarks,
  note:'群系是角色当前位置的真实客户端数据；结构名称仅为可见特征推断，不能据此宣布结构已完整确认。隔墙和未加载区域不参与判断。'};
}

export class DiscoveryTracker{
 constructor(){this.sequence=0;this.seen=[];this.events=[];this.biome=null;}
 observe(environment,position,now=Date.now()){
  const dimension=environment.dimension||'unknown';
  const emit=(kind,id,label,at,detail)=>{
   if(this.seen.some(s=>s.dimension===dimension&&s.kind===kind&&s.id===id&&Math.hypot(s.at[0]-at[0],s.at[1]-at[1],s.at[2]-at[2])<48))return;
   this.seen.push({dimension,kind,id,at});if(this.seen.length>128)this.seen.shift();
   const seq=++this.sequence;this.events.push({id:`discovery:${now}:${seq}`,sequence:seq,at:now,kind,label,position:at,detail,salient:true});
  };
  if(this.dimension&&this.dimension!==dimension)emit('dimension',dimension,'进入'+({'minecraft:overworld':'主世界','minecraft:the_nether':'下界','minecraft:the_end':'末地'}[dimension]||dimension),position,{id:dimension,source:'client_dimension_registry'});
  this.dimension=dimension;
  if(environment.biome?.id!==this.biome){this.biome=environment.biome?.id||null;if(CAVE_BIOMES.has(this.biome))emit('biome',this.biome,'进入'+environment.biome.name,position,environment.biome);}
  for(const c of [...environment.candidates,...environment.landmarks]){const at=c.evidence[0]?.at;if(at)emit('feature',c.id,c.label,at,c);}
  this.events=this.events.filter(e=>now-e.at<90000).slice(-8);
 }
 since(sequence=-1){return this.events.filter(e=>e.sequence>sequence);}
}
