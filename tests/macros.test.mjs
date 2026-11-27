import test from 'node:test';
import assert from 'node:assert/strict';
import {returnToSurface} from '../src/surface.mjs';
import {makeObsidian} from '../src/obsidian.mjs';
import {buildEnclosurePlan,farmBlazeSpawner} from '../src/blaze-farm.mjs';

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
