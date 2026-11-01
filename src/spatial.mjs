// Geometry measurements, not language-model guesses. All coordinates are world coordinates.
import {describeEnvironment} from './discovery.mjs';
const F={solid:1,support:2,water:4,lava:8,hazard:16,falling:32,log:64,leaves:128,ore:256,poi:512,partial:1024};
const REL=['前方','右前方','右侧','右后方','后方','左后方','左侧','左前方'];
const ABS=['南','西南','西','西北','北','东北','东','东南'];
const round=n=>Math.round(n*10)/10;
const norm=n=>(n%360+360)%360;
const sector=(dx,dz,yaw)=>Math.round(norm(Math.atan2(-dx,dz)*180/Math.PI-yaw)/45)%8;
const point=(x,y,z)=>[x,y,z];

export function spatialOverview(scan,{detail=false}={}) {
  const {origin:o,size:s,player:p,palette}=scan;
  if(scan.version!==1||!Array.isArray(s)||s.length!==3||s.some((n,i)=>!Number.isInteger(n)||n<1||n>[33,25,33][i])||!o?.every(Number.isFinite)||![p?.x,p?.y,p?.z,p?.yaw,p?.eyeY].every(Number.isFinite)||!palette?.length)throw Error('空间测量数据不完整');
  const count=s[0]*s[1]*s[2],data=Buffer.from(scan.cells,'base64');
  if(data.length!==count*2)throw Error('空间测量体素长度不符');
  const index=(x,y,z)=>x<o[0]||x>=o[0]+s[0]||y<o[1]||y>=o[1]+s[1]||z<o[2]||z>=o[2]+s[2]?-1:((y-o[1])*s[2]+z-o[2])*s[0]+x-o[0];
  const cell=(x,y,z)=>{const i=index(x,y,z);return i<0?0:data.readUInt16LE(i*2);};
  const flags=c=>palette[c]?.flags??0;
  const free=c=>c>0&&!(flags(c)&(F.solid|F.water|F.lava|F.hazard));
  const floorOK=c=>Boolean(c>0&&(flags(c)&F.support)&&!(flags(c)&(F.water|F.lava|F.hazard|F.partial)));
  const walk=(x,y,z)=>free(cell(x,y,z))&&free(cell(x,y+1,z))&&floorOK(cell(x,y-1,z));
  const bx=Math.floor(p.x),by=Math.floor(p.y),bz=Math.floor(p.z),radius=Math.min(16,Math.floor((s[0]-1)/2));
  const visible=new Set(),horizontal=Array.from({length:8},()=>[]),features=Array.from({length:8},()=>new Map());
  let unknownRays=0;
  // 128 horizontal bearings × 9 elevations; the first collision terminates every ray.
  for(let bearing=0;bearing<128;bearing++)for(const pitch of [-75,-55,-35,-15,0,15,35,55,75]) {
    const yaw=bearing*360/128,angle=yaw*Math.PI/180,elev=pitch*Math.PI/180;
    const dx=-Math.sin(angle)*Math.cos(elev),dz=Math.cos(angle)*Math.cos(elev),dy=Math.sin(elev);
    let distance=radius,kind='range',previous=-2;
    for(let d=.15;d<=radius;d+=.35){
      const x=Math.floor(p.x+dx*d),y=Math.floor(p.eyeY+dy*d),z=Math.floor(p.z+dz*d),i=index(x,y,z),c=cell(x,y,z);
      if(!c){distance=d;kind='unknown';unknownRays++;break;}
      if(i===previous)continue;previous=i;visible.add(i);
      const f=flags(c),which=sector(x+.5-p.x,z+.5-p.z,p.yaw);
      if(f&(F.water|F.lava|F.hazard|F.log|F.leaves|F.ore|F.poi|F.partial|F.falling))features[which].set(i,{x,y,z,id:palette[c].id,flags:f,distance:Math.hypot(x+.5-p.x,y+.5-p.eyeY,z+.5-p.z)});
      if(f&(F.solid|F.lava)){distance=d;kind='obstacle';break;}
    }
    if(pitch===0)horizontal[sector(-Math.sin(angle),Math.cos(angle),p.yaw)].push({distance,kind});
  }
  // Conservative full-block walking graph. No jumping, swimming, ladders or partial shapes.
  const nodes=new Map(),columns=new Map(),queue=[];let capped=false;
  const add=n=>{nodes.set(index(n.x,n.y,n.z),n);queue.push(n);const k=`${n.x},${n.z}`;if(!columns.has(k))columns.set(k,[]);columns.get(k).push(n);};
  const originWalkable=walk(bx,by,bz);
  if(originWalkable)add({x:bx,y:by,z:bz,steps:0,via:null});
  // Standing on a block edge can leave the feet's central cell unsupported while the
  // player's actual footprint already overlaps a supported neighbouring cell.
  if(!originWalkable&&p.onGround&&!p.inWater&&Math.abs(p.y-by)<.15&&free(cell(bx,by,bz))&&free(cell(bx,by+1,bz))){
    const half=Math.min(.5,p.halfWidth??.3);
    for(let x=bx-1;x<=bx+1;x++)for(let z=bz-1;z<=bz+1;z++){
      if(Math.min(p.x+half,x+1)<=Math.max(p.x-half,x)||Math.min(p.z+half,z+1)<=Math.max(p.z-half,z))continue;
      if(walk(x,by,z))add({x,y:by,z,steps:1,via:sector(x+.5-p.x,z+.5-p.z,p.yaw)});
    }
  }
  for(let q=0;q<queue.length;q++) {
    const a=queue[q];if(a.steps>=48)continue;
    for(const [dx,dz] of [[0,-1],[1,0],[0,1],[-1,0]])for(const dy of [0,1,-1]){
      const x=a.x+dx,y=a.y+dy,z=a.z+dz,i=index(x,y,z);
      if(Math.hypot(x-bx,z-bz)>radius||i<0||nodes.has(i)||!walk(x,y,z))continue;
      if(dy===1&&!free(cell(a.x,a.y+2,a.z)))continue;
      if(dy===-1&&!free(cell(x,a.y+1,z)))continue;
      if(nodes.size>=4096){capped=true;break;}
      add({x,y,z,steps:a.steps+1,via:a.via??sector(dx,dz,p.yaw)});
    }
  }
  const nodeAt=(x,z)=>columns.get(`${x},${z}`)?.filter(n=>n.steps<=Math.hypot(x-bx,z-bz)*1.8+3).sort((a,b)=>Math.abs(a.y-by)-Math.abs(b.y-by))[0];
  const directions=[];
  for(let k=0;k<8;k++) {
    const angle=(p.yaw+k*45)*Math.PI/180,dx=-Math.sin(angle),dz=Math.cos(angle);
    const samples=horizontal[k].sort((a,b)=>a.distance-b.distance),median=samples[Math.floor(samples.length/2)];
    const region=queue.filter(n=>n.steps>0&&sector(n.x+.5-p.x,n.z+.5-p.z,p.yaw)===k);
    const widths=[2,6,12].map(distance=>{
      const x=Math.floor(p.x+dx*distance),z=Math.floor(p.z+dz*distance),middle=nodeAt(x,z);
      if(!middle)return null;
      const keys=new Set([`${x},${z}`]);
      for(const sign of [-1,1])for(let offset=1;offset<=4;offset++){
        const xx=Math.floor(p.x+dx*distance+dz*offset*sign),zz=Math.floor(p.z+dz*distance-dx*offset*sign),side=nodeAt(xx,zz);
        if(!side||side.y!==middle.y)break;keys.add(`${xx},${zz}`);
      }
      return keys.size;
    });
    const entry={};
    for(const distance of [1,3,6,12]) {
      const x=Math.floor(p.x+dx*distance),z=Math.floor(p.z+dz*distance);
      if(!(visible.has(index(x,by,z))||visible.has(index(x,by+1,z))))continue;
      if(!free(cell(x,by,z))||!free(cell(x,by+1,z))||floorOK(cell(x,by-1,z)))continue;
      entry.distance=distance;
      let found=false;
      for(let drop=1;drop<=12;drop++){
        const c=cell(x,by-drop,z);
        if(!c){entry.ground='下方未探清';found=true;break;}
        if(flags(c)&(F.water|F.lava)){entry.ground=flags(c)&F.lava?'下方岩浆':'下方水域';entry.drop=drop-1;found=true;break;}
        if(flags(c)&F.solid){entry.drop=drop-1;entry.ground=drop>2?'近处落差，不能直接当作步行通路':'地面较低或形状复杂';found=true;break;}
      }
      if(!found)entry.ground='向下12格未见地面，更深未知';
      break;
    }
    const observed=[...features[k].values()].sort((a,b)=>a.distance-b.distance);
    const landmarks=[];
    for(const [label,mask] of [['水面',F.water],['岩浆',F.lava],['危险方块',F.hazard],['露出矿物',F.ore],['交互地点',F.poi]]){
      const hits=observed.filter(b=>b.flags&mask);if(!hits.length)continue;
      landmarks.push({type:label,id:hits[0].id,at:point(hits[0].x,hits[0].y,hits[0].z),distance:round(hits[0].distance)});
    }
    const logs=observed.filter(b=>b.flags&F.log),leaves=observed.filter(b=>b.flags&F.leaves);
    if(logs.length||leaves.length)landmarks.push({type:logs.length&&leaves.length?'树干与树叶':'木质/树叶方块',density:new Set([...logs,...leaves].map(b=>`${b.x},${b.z}`)).size>=6?'较密集':'零散',distance:round(Math.min(...[...logs,...leaves].map(b=>b.distance)))});
    const candidate=region.filter(n=>n.steps>=2).sort((a,b)=>Math.hypot(b.x-bx,b.z-bz)-Math.hypot(a.x-bx,a.z-bz)||a.steps-b.steps)[0];
    directions.push({relative:REL[k],compass:ABS[Math.round(norm(p.yaw+k*45)/45)%8],
      view:!median?'无采样':median.kind==='unknown'?`约${round(median.distance)}格后未探清`:median.kind==='range'?`视线采样至少${radius}格`:median.distance<2?`近处多为遮挡，约${round(median.distance)}格`:`约${round(median.distance)}格处有遮挡`,
      widthAt2_6_12:widths,
      ...(widths[0]!==null&&widths[1]!==null&&widths[1]>=widths[0]+3?{shape:'连通地面在较远处变宽'}:{}),
      ...(region.length?{connectedFloorDelta:[Math.min(...region.map(n=>n.y-by)),Math.max(...region.map(n=>n.y-by))]}:{}),
      ...(candidate?{candidate:{at:point(candidate.x,candidate.y,candidate.z),via:REL[candidate.via],gridSteps:candidate.steps}}:{}),
      ...(Object.keys(entry).length?{entry}:{}),visible:landmarks,
    });
  }
  let clearance=0,ceiling='未探清';
  for(let height=0;height<=12;height++){
    const c=cell(bx,by+height,bz);if(!c)break;
    if(flags(c)&F.solid){ceiling=`约${height}格高有碰撞方块`;break;}clearance=height+1;
  }
  const result={available:true,at:scan.at,origin:point(p.x,p.y,p.z).map(round),heading:round(norm(p.yaw)),range:{horizontal:radius,vertical:12},
    local:{openSky:scan.openSkyAtPlayer,inWater:p.inWater,ceiling:scan.openSkyAtPlayer?'当前位置可见天空':ceiling,clearanceAtLeast:clearance,gridOriginWalkable:originWalkable,connectionStart:originWalkable?'脚下完整格':queue.length?'身体已搭在相邻支撑格边缘':'起点支撑形状未确认'},
    directions,
    limits:'方位相对本次朝向；visible仅为射线可见表面。candidate是加载地形的保守连通估计，可能需绕行，不等于可直接走到；半砖/楼梯、跳跃、游泳、攀爬未做路径验证。宽度null=未确认，最大9为采样上限；范围外/未加载不推断封闭。',
    coverage:{knownRatio:round(scan.knownCells/count*100),unknownRays,connectedFloorCells:nodes.size,connectivityCapped:capped},
  };
  const seenBlocks=[...visible].flatMap(i=>{const c=data.readUInt16LE(i*2),entry=palette[c];if(!entry||entry.id==='minecraft:air')return [];const x=o[0]+i%s[0],z=o[2]+Math.floor(i/s[0])%s[2],y=o[1]+Math.floor(i/(s[0]*s[2]));return [{id:entry.id,x,y,z,distance:Math.hypot(x+.5-p.x,y+.5-p.eyeY,z+.5-p.z)}];});
  result.environment=describeEnvironment({biome:scan.biome,dimension:scan.dimension,player:p,openSky:scan.openSkyAtPlayer,blocks:seenBlocks});
  if(!scan.openSkyAtPlayer&&p.y<63&&clearance>=4&&directions.filter(d=>d.widthAt2_6_12[1]>=5).length>=2)result.environment.landmarks.push({id:'open_cavern',label:'地下空间明显变开阔',evidence:[{at:result.origin,source:'local_geometry'}],note:'由可见高度和地面连通宽度测量，不证明具体洞穴类型或安全。'});
  if(detail){
    const included=new Set(visible);
    for(const n of queue)for(const y of [n.y-1,n.y,n.y+1])included.add(index(n.x,y,n.z));
    const glyph=(x,y,z)=>{if(x===bx&&z===bz&&y===by)return '@';const i=index(x,y,z),c=cell(x,y,z);if(!c||!included.has(i))return '?';const f=flags(c);return f&F.lava?'L':f&F.hazard?'!':f&F.water?'~':f&F.ore?'O':f&F.poi?'P':f&(F.log|F.leaves)?'T':f&F.partial?'+':f&F.solid?'#':'.';};
    result.slices=[-4,-1,0,1,4].map(offset=>({y:by+offset,rows:Array.from({length:s[2]},(_,z)=>Array.from({length:s[0]},(_,x)=>glyph(o[0]+x,by+offset,o[2]+z)).join(''))}));
    result.legend='北上东右；@角色脚格 #碰撞 .无碰撞 ~水 L岩浆 !危险 O露出矿物 P交互地点 T木/叶 +复杂碰撞 ?未纳入本次可见/连通范围或未加载；切片不证明可通行';
  }
  return result;
}
