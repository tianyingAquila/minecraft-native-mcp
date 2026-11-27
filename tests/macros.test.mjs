import test from 'node:test';
import assert from 'node:assert/strict';
import {returnToSurface} from '../src/surface.mjs';
import {makeObsidian} from '../src/obsidian.mjs';
import {buildEnclosurePlan,farmBlazeSpawner} from '../src/blaze-farm.mjs';
import {recoverPosition} from '../src/recovery.mjs';
import {dropItemsSafe} from '../src/drop.mjs';
import {mineBlock} from '../src/mining.mjs';
import {digToPosition} from '../src/dig-to.mjs';
import {filterAgentTools} from '../src/agent.mjs';

test('returnToSurface 在露天位置直接返回成功；在地下自动选安全方向挖阶梯直到露天',async()=>{
  let y=30;
  const dirs=[];
  const call=async(method,args={})=>{
    if(method==='player.getState')return {x:10.5,y,z:20.5,dimension:'minecraft:overworld',health:20,inLava:false,air:300};
    if(method==='fish.probeBlocks'){
      return {blocks:args.positions.map(p=>{
        if(y>=64)return {...p,loaded:true,air:true,fluid:false,fullSupport:false,id:'minecraft:air'};
        // Make north have water so it picks another direction.
        if(p.z<20)return {...p,loaded:true,air:false,fluid:true,fullSupport:false,id:'minecraft:water'};
        return {...p,loaded:true,air:p.y>=64,fluid:false,fullSupport:p.y<64,id:p.y>=64?'minecraft:air':'minecraft:stone'};
      })};
    }
    return {};
  };
  const dig=async({direction,length})=>{
    dirs.push(direction);
    y+=length;
    return {status:'succeeded',completedSteps:length,advanced:length};
  };
  const res=await returnToSurface({maxHeight:40,seconds:30},{call,dig,sleep:async()=>{}});
  assert.equal(res.status,'succeeded');
  assert.equal(res.reason,'reached_surface');
  assert.equal(res.openSky,true);
  assert.ok(res.climbed>=34);
  assert.ok(!dirs.includes('north'));

  const already=await returnToSurface({},{call,dig,sleep:async()=>{}});
  assert.equal(already.status,'succeeded');
  assert.equal(already.reason,'already_on_surface');
});

test('makeObsidian 无钻石镐时拒绝并提示；有钻石镐与水桶时浇灌岩浆并采集黑曜石',async()=>{
  const ironCall=async method=>{
    if(method==='player.getState')return {x:0,y:11,z:0,dimension:'minecraft:overworld',health:20,inLava:false};
    if(method==='player.getInventory')return {hotbar:[{slot:0,id:'minecraft:iron_pickaxe',count:1,damage:0,maxDamage:250}],main:[]};
    return {};
  };
  await assert.rejects(makeObsidian({count:2},{call:ironCall,sleep:async()=>{}}),/钻石镐/);

  let lavaTurnedObsidian=false,obsMined=false,obsCount=0,hasWater=true,usedWater=0;
  const call=async(method,args={})=>{
    if(method==='player.getState')return {x:0.5,y:11,z:0.5,dimension:'minecraft:overworld',health:20,inLava:false};
    if(method==='player.getInventory')return {
      hotbar:[
        {slot:0,id:'minecraft:diamond_pickaxe',count:1,damage:5,maxDamage:1561},
        {slot:1,id:hasWater?'minecraft:water_bucket':'minecraft:bucket',count:1},
        ...(obsCount?[{slot:2,id:'minecraft:obsidian',count:obsCount}]:[]),
      ],
      main:[],
    };
    if(method==='fish.useBlock'){
      usedWater++;
      if(hasWater){hasWater=false;lavaTurnedObsidian=true;}
      else{hasWater=true;}
      return {result:'SUCCESS'};
    }
    if(method==='fish.probeBlocks'){
      return {blocks:args.positions.map(p=>{
        if(p.x===2&&p.y===11&&p.z===0){
          if(obsMined)return {...p,loaded:true,air:true,fluid:false,fullSupport:false,id:'minecraft:air'};
          return {...p,loaded:true,air:false,fluid:!lavaTurnedObsidian,fullSupport:lavaTurnedObsidian,id:lavaTurnedObsidian?'minecraft:obsidian':'minecraft:lava'};
        }
        if(p.x===1&&p.y===11&&p.z===0)return {...p,loaded:true,air:false,fluid:false,fullSupport:true,id:'minecraft:stone'};
        return {...p,loaded:true,air:p.y>10,fluid:false,fullSupport:p.y<=10,id:p.y>10?'minecraft:air':'minecraft:stone'};
      })};
    }
    return {};
  };
  const mine=async(_call,pos)=>{
    assert.deepEqual({x:pos.x,y:pos.y,z:pos.z},{x:2,y:11,z:0});
    obsMined=true;
    obsCount=1;
    return {broke:'minecraft:obsidian',position:pos};
  };
  const res=await makeObsidian({count:1,radius:4,seconds:30},{call,mine,sleep:async()=>{}});
  assert.equal(res.status,'succeeded');
  assert.equal(res.gained,1);
  assert.equal(res.castCount,1);
  assert.ok(usedWater>=2);
  assert.equal(hasWater,true);
});

test('farmBlazeSpawner 自动规划防飞封顶并留打怪口，封顶后击杀烈焰人并确认烈焰棒增量',async()=>{
  const plan=buildEnclosurePlan({x:100,y:60,z:50},{x:104,y:60,z:50});
  assert.equal(plan.openDir,'east');
  assert.ok(plan.plan.some(c=>c.x===100&&c.y===62&&c.z===50&&c.role==='roof'));
  assert.ok(!plan.plan.some(c=>c.x===102&&c.y===61&&c.z===50));

  let rods=0,blazesAlive=2;
  const placed=[];
  const call=async(method,args={})=>{
    if(method==='player.getState')return {x:104.5,y:60,z:50.5,dimension:'minecraft:the_nether',health:20,food:20,inLava:false};
    if(method==='player.getInventory')return {
      hotbar:[
        {slot:0,id:'minecraft:iron_sword',count:1,damage:0,maxDamage:250},
        {slot:1,id:'minecraft:cobblestone',count:32},
        ...(rods?[{slot:2,id:'minecraft:blaze_rod',count:rods}]:[]),
      ],
      main:[],
    };
    if(method==='fish.probeBlocks'){
      return {blocks:args.positions.map(p=>{
        if(p.x===100&&p.y===60&&p.z===50)return {...p,loaded:true,air:false,id:'minecraft:spawner'};
        return {...p,loaded:true,air:true,id:'minecraft:air'};
      })};
    }
    if(method==='perception.entities'){
      return {entities:blazesAlive>0?[{uuid:'00000000-0000-0000-0000-000000000099',type:'minecraft:blaze',x:101,y:60,z:50,distance:3.5}]:[]};
    }
    return {};
  };
  const place=async pos=>{placed.push(pos);return {block:pos.item};};
  const fight=async()=>{blazesAlive--;rods++;return {status:'succeeded',deathObserved:true};};
  let clock=0;
  const res=await farmBlazeSpawner(
    {x:100,y:60,z:50,targetRods:2,seconds:40},
    {call,place,fight,now:()=>clock,sleep:async ms=>{clock+=ms;}},
  );
  assert.equal(res.status,'succeeded');
  assert.equal(res.rodsGained,2);
  assert.equal(res.killedBlazes,2);
  assert.ok(placed.length>0);
});

test('filterAgentTools 按维度过滤无关工具并移除冗余上游记忆/目标工具',()=>{
  const mk=name=>({type:'function',function:{name,parameters:{type:'object',properties:{}}}});
  const all=['travel_to','remember','recall','goal_add','place_block','return_to_surface','make_obsidian','barter_piglins','farm_blaze_spawner','fight_dragon'].map(mk);
  const ow=filterAgentTools(all,'minecraft:overworld').map(t=>t.function.name);
  assert.deepEqual(ow,['travel_to','return_to_surface','make_obsidian']);
  const nether=filterAgentTools(all,'minecraft:the_nether').map(t=>t.function.name);
  assert.deepEqual(nether,['travel_to','make_obsidian','barter_piglins','farm_blaze_spawner']);
  const end=filterAgentTools(all,'minecraft:the_end').map(t=>t.function.name);
  assert.deepEqual(end,['travel_to','fight_dragon']);
});

test('recoverPosition 水下低血时持续按住跳跃上浮直到水面换气或上岸',async()=>{
  let y=28,air=40,clock=0,inWater=true,jumpCalls=0;
  const call=async(method,args={})=>{
    if(method==='player.getState')return {x:0.5,y,z:0.5,dimension:'minecraft:overworld',health:4,inWater,inLava:false,onGround:false,air};
    if(method==='fish.probeBlocks'){
      return {blocks:args.positions.map(p=>({...p,loaded:true,air:p.y>=31,fluid:p.y<31,collision:false,fullSupport:false,id:p.y>=31?'minecraft:air':'minecraft:water'}))};
    }
    if(method==='control.setInput'&&args.jump){
      jumpCalls++;
      y+=1;
      if(y>=30){air=300;}
    }
    return {};
  };
  const res=await recoverPosition({call,now:()=>clock,sleep:async ms=>{clock+=ms;}});
  assert.equal(res.status,'succeeded');
  assert.equal(res.reason,'surfaced_for_air');
  assert.ok(jumpCalls>=2);
  assert.equal(res.airAfter,300);
});

test('dropItemsSafe 在封闭窄矿道自动侧边挖2格深垃圾坑并定向精准丢入，且二次丢弃复用现成坑',async()=>{
  let cobble=64;
  const dug=[];
  let aimedDropCalls=0;
  const pitDug=new Set();
  const key=p=>`${p.x},${p.y},${p.z}`;
  const call=async(method,args={})=>{
    if(method==='player.getState')return {x:0.5,y:10,z:0.5,dimension:'minecraft:overworld',health:20,inWater:false,inLava:false,onGround:true};
    if(method==='player.getInventory')return {hotbar:cobble>0?[{slot:0,id:'minecraft:cobblestone',count:cobble}]:[],main:[]};
    if(method==='fish.probeBlocks'){
      return {blocks:args.positions.map(p=>{
        const isAir=pitDug.has(key(p));
        return {...p,loaded:true,air:isAir,fluid:false,blockEntity:false,falling:false,hardness:isAir?0:1.5,fullSupport:!isAir,id:isAir?'minecraft:air':'minecraft:stone'};
      })};
    }
    if(method==='fish.dropAimed'){
      aimedDropCalls++;
      cobble=0;
      return {dropped:64};
    }
    return {};
  };
  const mine=async(_call,pos)=>{dug.push(pos);pitDug.add(key(pos));return {broke:'minecraft:stone',position:pos};};
  const first=await dropItemsSafe({slot:0,wholeStack:true},{call,mine,sleep:async()=>{}});
  assert.equal(first.dropped,64);
  assert.equal(first.method,'dug_pit');
  assert.equal(dug.length,3);
  assert.equal(aimedDropCalls,1);

  // Second drop reuses the existing pit without digging again
  cobble=32;
  const second=await dropItemsSafe({slot:0,wholeStack:true},{call,mine,sleep:async()=>{}});
  assert.equal(second.dropped,32);
  assert.equal(second.method,'existing_pit');
  assert.equal(dug.length,3);
});

test('dropItemsSafe 挖侧坑遇到已变空气的方块时跳过而不中断丢弃',async()=>{
  let cobble=32;
  let aimed=0;
  const call=async(method,args={})=>{
    if(method==='player.getState')return {x:0.5,y:10,z:0.5,dimension:'minecraft:overworld',health:20,inWater:false,inLava:false,onGround:true};
    if(method==='player.getInventory')return {hotbar:cobble>0?[{slot:0,id:'minecraft:cobblestone',count:cobble}]:[],main:[]};
    if(method==='fish.probeBlocks'){
      return {blocks:args.positions.map(p=>({...p,loaded:true,air:false,fluid:false,blockEntity:false,falling:false,hardness:1.5,fullSupport:true,id:'minecraft:stone'}))};
    }
    if(method==='fish.dropAimed'){aimed++;cobble=0;return {dropped:32};}
    return {};
  };
  let calls=0;
  const mine=async(_c,pos)=>{
    calls++;
    if(calls===2)throw new Error('指定位置没有已加载的可挖方块');
    return {broke:'minecraft:stone',position:pos};
  };
  const res=await dropItemsSafe({slot:0,wholeStack:true},{call,mine,sleep:async()=>{}});
  assert.equal(res.dropped,32);
  assert.equal(res.method,'dug_pit');
  assert.equal(aimed,1);
});

test('mineBlock 挖普通石头/深板岩时优先用石镐保护铁镐和钻石镐，挖钻石矿时切回高阶镐',async()=>{
  const equipped=[];
  let broken=false;
  const runFor=async(blockId)=>{
    broken=false;
    equipped.length=0;
    const call=async(method,args={})=>{
      if(method==='perception.blocks'){
        return {blocks:[{...args.positions[0],loaded:true,air:broken,id:broken?'minecraft:air':blockId,hardness:3,canHarvest:true,bestSlot:0}]};
      }
      if(method==='player.getInventory'){
        return {hotbar:[{slot:0,id:'minecraft:iron_pickaxe',maxDamage:250,damage:20},{slot:1,id:'minecraft:stone_pickaxe',maxDamage:131,damage:10}],main:[]};
      }
      if(method==='fish.equip')equipped.push(args.slot);
      if(method==='interact.breakBlock')broken=true;
      return {};
    };
    await mineBlock(call,{x:1,y:10,z:1},{sleep:async()=>{}});
    return equipped.at(-1);
  };
  assert.equal(await runFor('minecraft:deepslate'),1);
  assert.equal(await runFor('minecraft:stone'),1);
  assert.equal(await runFor('minecraft:deepslate_diamond_ore'),0);
  assert.equal(await runFor('minecraft:obsidian'),0);
});

test('digToPosition 自动沿阶梯定点抵达目标，避开岩浆障碍并按 mineTarget 采掉整条相连钻石矿脉',async()=>{
  let self={x:0.5,y:10,z:0.5,dimension:'minecraft:overworld',health:20,inWater:false,inLava:false,onGround:true};
  let diamonds=0;
  const veinKeys=new Set(['6,4,0','7,4,0','7,3,0']);
  const mined=[];
  const digCalls=[];
  let blockedFirst=false;
  const call=async(method,args={})=>{
    if(method==='player.getState')return {...self};
    if(method==='player.getInventory')return {hotbar:diamonds>0?[{slot:0,id:'minecraft:diamond',count:diamonds}]:[],main:[]};
    if(method==='fish.probeBlocks'){
      return {blocks:args.positions.map(p=>{
        const k=`${p.x},${p.y},${p.z}`;
        if(veinKeys.has(k))return {...p,loaded:true,air:false,fluid:false,hardness:3,id:'minecraft:deepslate_diamond_ore'};
        return {...p,loaded:true,air:false,fluid:false,hardness:1.5,id:'minecraft:deepslate'};
      })};
    }
    return {};
  };
  const dig=async({direction,slope,length})=>{
    digCalls.push({direction,slope,length});
    if(!blockedFirst&&direction==='east'&&slope==='down'){
      blockedFirst=true;
      return {status:'interrupted',reason:'fluid_or_hazard',completedSteps:0,brokenBlocks:0};
    }
    const vec={north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]}[direction];
    self.x+=vec[0]*length;
    self.z+=vec[1]*length;
    if(slope==='down')self.y-=length;
    if(slope==='up')self.y+=length;
    return {status:'completed',reason:'requested_length_reached',completedSteps:length,brokenBlocks:length*3};
  };
  const mine=async(_c,pos)=>{
    mined.push(pos);
    veinKeys.delete(`${pos.x},${pos.y},${pos.z}`);
    diamonds++;
    return {broke:'minecraft:deepslate_diamond_ore',position:pos};
  };
  let clock=0;
  const res=await digToPosition({x:6,y:4,z:0,mineTarget:true},{call,dig,mine,now:()=>clock,sleep:async ms=>{clock+=ms;}});
  assert.equal(res.status,'succeeded');
  assert.equal(res.reason,'arrived_and_mined');
  assert.equal(res.reached,true);
  assert.equal(res.veinFound,3);
  assert.equal(res.minedBlocks,3);
  assert.equal(res.gainedItem,'minecraft:diamond');
  assert.equal(res.gainedCount,3);
  assert.ok(digCalls.length>=2);
  assert.equal(mined.length,3);
});

test('digToPosition 采矿遇到挡路石(first hit)时自动先清障再采目标矿石；dropItemsSafe 在直线通道中优先侧边挖坑而非往走廊扔',async()=>{
  let self={x:5.5,y:4,z:0.5,dimension:'minecraft:overworld',health:20,inWater:false,inLava:false,onGround:true};
  let diamonds=0, blockerBroken=false;
  const call=async(method,args={})=>{
    if(method==='player.getState')return {...self};
    if(method==='player.getInventory')return {hotbar:diamonds>0?[{slot:0,id:'minecraft:diamond',count:diamonds}]:[],main:[]};
    if(method==='fish.probeBlocks'){
      return {blocks:args.positions.map(p=>{
        if(p.x===6&&p.y===4&&p.z===0)return {...p,loaded:true,air:false,fluid:false,hardness:3,id:'minecraft:deepslate_diamond_ore'};
        return {...p,loaded:true,air:false,fluid:false,hardness:1.5,id:'minecraft:deepslate'};
      })};
    }
    return {};
  };
  const mine=async(_c,pos)=>{
    if(pos.x===6&&pos.y===4&&pos.z===0&&!blockerBroken){
      throw new Error('Block or requested face is obstructed; first hit minecraft:deepslate @ 6, 4, 1; target 6, 4, 0');
    }
    if(pos.x===6&&pos.y===4&&pos.z===1){blockerBroken=true;return {broke:'minecraft:deepslate',position:pos};}
    diamonds++;
    return {broke:'minecraft:deepslate_diamond_ore',position:pos};
  };
  const res=await digToPosition({x:6,y:4,z:0,mineTarget:true},{call,dig:async()=>({status:'completed',completedSteps:0}),mine,now:()=>0,sleep:async()=>{}});
  assert.equal(res.status,'succeeded');
  assert.equal(blockerBroken,true);
  assert.equal(res.minedBlocks,1);
  assert.equal(res.gainedCount,1);

  // Corridor open along east (dx=1), solid stone on north/south/west: must dig side pit instead of open_throw
  let cobble=32;
  const dug=[];
  const dropCall=async(method,args={})=>{
    if(method==='player.getState')return {x:0.5,y:10,z:0.5,dimension:'minecraft:overworld',health:20,inWater:false,inLava:false,onGround:true};
    if(method==='player.getInventory')return {hotbar:cobble>0?[{slot:0,id:'minecraft:cobblestone',count:cobble}]:[],main:[]};
    if(method==='fish.probeBlocks'){
      return {blocks:args.positions.map(p=>{
        const corridor=p.z===0&&p.x>=1&&(p.y===10||p.y===11);
        return {...p,loaded:true,air:corridor,fluid:false,blockEntity:false,falling:false,hardness:corridor?0:1.5,fullSupport:!corridor,id:corridor?'minecraft:air':'minecraft:stone'};
      })};
    }
    if(method==='fish.dropAimed'){cobble=0;return {dropped:32};}
    return {};
  };
  const dropRes=await dropItemsSafe({slot:0,wholeStack:true},{call:dropCall,mine:async(_c,p)=>{dug.push(p);return {broke:'minecraft:stone',position:p};},sleep:async()=>{}});
  assert.equal(dropRes.method,'dug_pit');
  assert.ok(dug.length>=2);
});
