import {setTimeout as delay} from 'node:timers/promises';

// A short, locally verified way out of a stuck position, not an exploration route.
export async function recoverPosition({call,signal,now=Date.now,sleep=ms=>delay(ms,undefined,{signal})}){
 let start;
 try{
  await call('fish.cancel');await call('screen.close');start=await call('player.getState');
  if(!start.onGround||start.inWater||start.inLava||start.health<=10||Math.abs(start.y-Math.round(start.y))>.1)return {status:'interrupted',reason:'need_manual_escape',message:'当前不适合自动挪动，请依据真实状态选择脱险动作。'};
  const nearby=(await call('perception.entities',{radius:6,kinds:['hostile']})).entities;
  if(nearby.some(e=>e.distance<6))return {status:'interrupted',reason:'enemy_nearby',message:'近处有敌人，优先战斗或有依据地撤离，不能原地等天亮。'};
  const y=Math.round(start.y),x=Math.floor(start.x),z=Math.floor(start.z),yaw=(start.yaw||0)*Math.PI/180;
  const directions=[[0,1],[-1,0],[0,-1],[1,0]].sort((a,b)=>(-b[0]*Math.sin(yaw)+b[1]*Math.cos(yaw))-(-a[0]*Math.sin(yaw)+a[1]*Math.cos(yaw)));
  const positions=directions.flatMap(([dx,dz])=>[1,2].flatMap(step=>[-2,-1,0,1,2,3].map(dy=>({x:x+dx*step,y:y+dy,z:z+dz*step}))));
  const blocks=(await call('fish.probeBlocks',{positions})).blocks,map=new Map(blocks.map(b=>[`${b.x},${b.y},${b.z}`,b]));
  const at=(px,py,pz)=>map.get(`${px},${py},${pz}`),danger=b=>!b?.loaded||b.fluid||/lava|fire|magma|cactus|campfire|powder_snow|sweet_berry_bush/.test(b.id);
  let target;
  for(const [dx,dz] of directions){let previous=y,valid=true;
   for(const step of [1,2]){const px=x+dx*step,pz=z+dz*step,py=[y,y+1,y-1].find(level=>{
    const floor=at(px,level-1,pz),feet=at(px,level,pz),head=at(px,level+1,pz);
    return Math.abs(level-previous)<=1&&!danger(floor)&&floor.fullSupport&&!floor.falling&&!danger(feet)&&!feet.collision&&!danger(head)&&!head.collision;
   });if(py===undefined){valid=false;break;}previous=py;target={x:px+.5,y:py,z:pz+.5};}
   if(valid)break;target=null;
  }
  if(!target)return {status:'interrupted',reason:'no_verified_exit',message:'附近两格未找到已验证通路。查看具体障碍、截图或有目标地清障，不把脚边方块当成封闭房间。'};
  await call('fish.navigate',{...target,reach:.6});const deadline=now()+4500;
  while(now()<deadline){signal?.throwIfAborted();const self=await call('player.getState');
   if(self.health<start.health||self.inLava||(self.air??300)<100)return {status:'interrupted',reason:'player_danger'};
   if(Math.hypot(self.x-target.x,self.y-target.y,self.z-target.z)<.7)return {status:'succeeded',reason:'position_recovered',from:{x:start.x,y:start.y,z:start.z},to:{x:self.x,y:self.y,z:self.z}};
   await sleep(150);
  }
  return {status:'interrupted',reason:'recovery_route_failed',message:'局部挪动未到达，请重新检查地形或选择其他任务。'};
 }finally{await call('fish.cancel').catch(()=>{});}
}
