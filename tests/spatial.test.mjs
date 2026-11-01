import test from 'node:test';
import assert from 'node:assert/strict';
import {spatialOverview} from '../src/spatial.mjs';
import {encodeObservation,requestUsage} from '../src/observation.mjs';

const AIR={id:'minecraft:air',flags:0},STONE={id:'minecraft:stone',flags:3};
function terrain(block,{yaw=180,inWater=false,openSky=false}={}) {
  const size=[33,25,33],origin=[-16,52,-16],palette=[{}],indices=new Map(),data=Buffer.alloc(33*25*33*2);let knownCells=0;
  for(let y=0;y<25;y++)for(let z=0;z<33;z++)for(let x=0;x<33;x++){
    const b=block(x-16,y+52,z-16);if(!b)continue;knownCells++;
    const key=b.id+':'+b.flags;if(!indices.has(key)){indices.set(key,palette.length);palette.push(b);}
    data.writeUInt16LE(indices.get(key),((y*33+z)*33+x)*2);
  }
  return {version:1,origin,size,palette,cells:data.toString('base64'),knownCells,at:1000,openSkyAtPlayer:openSky,player:{x:.5,y:64,z:.5,eyeY:65.62,yaw,inWater}};
}
test('隐藏在石墙后的矿井方块不进入环境推断，当前群系可直接保留',()=>{
 const scan=terrain((x,y,z)=>x===3?STONE:x===4&&y===65&&z===0?{id:'minecraft:cobweb',flags:0}:x===4&&y===64&&z===0?{id:'minecraft:rail',flags:0}:y<64?STONE:AIR);
 scan.biome='minecraft:lush_caves';scan.dimension='minecraft:overworld';
 const s=spatialOverview(scan);assert.equal(s.environment.biome.id,'minecraft:lush_caves');assert.equal(s.environment.candidates.some(c=>c.id==='mineshaft'),false);
});
const front=s=>s.directions.find(d=>d.relative==='前方');
test('平地空间全方向开阔，朝向旋转使左右跟着改变，详细切片尺寸有界',()=>{
  const scan=terrain((x,y,z)=>y<64?STONE:AIR,{openSky:true}),s=spatialOverview(scan,{detail:true});
  assert.equal(s.local.openSky,true);assert.equal(front(s).compass,'北');assert.equal(front(s).widthAt2_6_12[1],9);assert.ok(s.coverage.connectedFloorCells>600);
  scan.player.yaw=270;assert.equal(front(spatialOverview(scan)).compass,'东');
  assert.equal(s.slices.length,5);assert.ok(s.slices.every(l=>l.rows.length===33&&l.rows.every(row=>row.length===33)));
  assert.ok(JSON.stringify(s).length<16000);
});
test('窄入口接宽房间可描述变宽，封闭墙后的矿物不进入可见清单',()=>{
  const scan=terrain((x,y,z)=>{
    if(x===4&&y===65&&z===0)return {id:'minecraft:diamond_ore',flags:259};
    return (y===64||y===65)&&((x===0&&z<=0)||(z<=-4&&Math.abs(x)<=5))?AIR:STONE;
  });
  const s=spatialOverview(scan);assert.equal(front(s).widthAt2_6_12[0],1);assert.equal(front(s).widthAt2_6_12[1],9);assert.ok(front(s).shape);
  assert.match(s.directions.find(d=>d.relative==='右侧').view,/近处/);
  assert.equal(s.directions.flatMap(d=>d.visible).some(v=>v.id==='minecraft:diamond_ore'),false);
});
test('地面连通包含逐级下行，隔层封闭房间不被当作候选通道',()=>{
  const scan=terrain((x,y,z)=>{
    if(x===0&&z===0&&y>=64&&y<=65)return AIR;
    if(x===0&&z===-1&&y>=63&&y<=65)return AIR;
    if(x===0&&z===-2&&y>=62&&y<=64)return AIR;
    if(Math.abs(x)<=2&&z<=-3&&z>=-6&&y>=62&&y<=63)return AIR;
    if(x>=4&&x<=8&&Math.abs(z)<=3&&y>=58&&y<=60)return AIR;
    return STONE;
  });
  const s=spatialOverview(scan);assert.equal(Math.min(...s.directions.flatMap(d=>d.connectedFloorDelta??[])),-2);
  assert.equal(s.directions.some(d=>d.candidate?.at[1]===58),false);
});
test('断崖与未加载边界保留不确定性，不输出跨深坑的可达候选',()=>{
  const scan=terrain((x,y,z)=>x>6?null:(y<60||(x<=0&&y<64)?STONE:AIR));
  const s=spatialOverview(scan),east=s.directions.find(d=>d.compass==='东');
  assert.equal(east.entry.drop,4);assert.equal(east.candidate,undefined);assert.ok(s.coverage.knownRatio<100);
  assert.ok(s.directions.some(d=>d.view.includes('未探清')));
});
test('可见水面与木叶归纳为测量特征，不把水下当步行或给水域强行命名',()=>{
  const scan=terrain((x,y,z)=>{
    if(y<63)return STONE;
    if(y===63)return z>=3?{id:'minecraft:water',flags:4}:STONE;
    if(x>=-7&&x<=-4&&z>=-3&&z<=3&&y>=64&&y<=66)return {id:'minecraft:oak_log',flags:65};
    if(x>=-8&&x<=-3&&z>=-4&&z<=4&&y===67)return {id:'minecraft:oak_leaves',flags:129};
    return AIR;
  },{openSky:true});
  const s=spatialOverview(scan),features=s.directions.flatMap(d=>d.visible);
  assert.ok(features.some(v=>v.type==='水面'));assert.ok(features.some(v=>v.type.includes('树')));assert.equal(JSON.stringify(s).includes('河流'),false);
  const underwater=spatialOverview(terrain((x,y,z)=>y<63?STONE:{id:'minecraft:water',flags:4},{inWater:true}));
  assert.equal(underwater.local.inWater,true);assert.equal(underwater.coverage.connectedFloorCells,0);
});
test('复杂碰撞与观测缺失不硬推可行走，拥挤观察消息仍是完整JSON',()=>{
  const partial=spatialOverview(terrain((x,y,z)=>y===63?{id:'minecraft:stone_slab',flags:1027}:AIR));assert.equal(partial.local.gridOriginWalkable,false);
  const snapshot={result:{situation:{spatial:partial,vitals:{health:20},inventory:{stacks:[{name:'stone',count:64}]},nearby:{droppedItems:Array.from({length:16},()=>({name:'x'.repeat(1500)}))},openMenu:{slots:Array.from({length:54},()=>({name:'x'.repeat(200)}))}}}};
  const decoded=JSON.parse(encodeObservation(snapshot));assert.equal(decoded.result.situation.vitals.health,20);assert.ok(decoded.result.situation.spatial.available);assert.ok(decoded.result.situation.observationOmitted);assert.equal(snapshot.result.situation.nearby.droppedItems.length,16);
});
test('单次token统计使用API返回，图片base64不混入文字分项，观众接口不暴露控制数据',async()=>{
  const {Store}=await import('../src/state.mjs');
  const stats=requestUsage({tools:[],messages:[{role:'system',content:'规则'},{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,'+'A'.repeat(10000)}}]}]},{prompt_tokens:12345,completion_tokens:80,prompt_cache_hit_tokens:9000});
  assert.equal(stats.promptTokens,12345);assert.equal(stats.cacheHitTokens,9000);assert.equal(stats.images,1);assert.ok(stats.partsUtf8Bytes.observation<300);
  const s=new Store({persist:false});s.lastRequest=stats;s.spatial={available:true};assert.equal(s.publicState().lastRequest.promptTokens,12345);assert.equal(s.overlayState().lastRequest,undefined);assert.equal(s.overlayState().spatial,undefined);
});
test('身体搭在完整方块边缘时可从重叠支撑格估计连通，不把脚格正下方空气当绝路',()=>{
  const scan=terrain((x,y,z)=>y<64&&x>=1?STONE:AIR);scan.player.x=.8;scan.player.onGround=true;scan.player.halfWidth=.3;
  const summary=spatialOverview(scan);assert.equal(summary.local.gridOriginWalkable,false);assert.ok(summary.coverage.connectedFloorCells>100);assert.match(summary.local.connectionStart,/边缘/);
  scan.player.onGround=false;assert.equal(spatialOverview(scan).coverage.connectedFloorCells,0);
});
