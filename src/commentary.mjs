const QUIET=new Set(['look_at','close_container','close_game_screen']);
const LABELS={travel_to:'换个地方继续探索。',explore:'到前面探探路。',collect_blocks:'先收集一些材料。',craft_item:'准备做点装备。',open_container:'看看容器里有什么。',container_transfer:'整理一下需要的材料。',equip_item:'先换好装备。',eat_food:'先吃点东西。',attack_entity:'先应付眼前的敌人。',use_block:'试试这里的交互。',use_item:'用一下手里的物品。',place_block:'在这里放一块方块。',place_block_at:'在这里搭一块方块。',mine_block:'先挖开这块障碍。',drop_items:'整理一下手里的物品。',wait_for_game:'等一小会儿再继续。'};
export function shortCommentary(text){return typeof text==='string'?[...text.replace(/\s+/g,' ').trim()].slice(0,120).join(''):'';}
export function withCommentary(tool,readOnly=false){
 if(readOnly||QUIET.has(tool.function.name))return tool;
 const t=structuredClone(tool),p=t.function.parameters;
 p.properties={...p.properties,say:{type:'string',maxLength:80,description:'给观众的下一步打算，通常6–30个字，自然说明眼下准备做什么。可以表达明确标为猜测的探索想法；只谈游戏，和本动作一起提交，不另开一次请求。'}};
 p.properties.reaction={type:'string',maxLength:80,description:'可省略。上一动作有真实事件或environment.updates有新环境线索时，可表达自然感受/好奇，通常6–30字。结构候选要说“像/可能”，不把线索当成已确认结构。依据真实血量、死亡/收获；普通动作不强行反应，危急时只写脱险打算。'};
 p.required=[...new Set([...(p.required||[]),'say'])];return t;
}
export function actionCommentary(name,text){return QUIET.has(name)?'':shortCommentary(text)||LABELS[name]||(name==='dig_tunnel'?'继续开一小段矿道。':'');}
export function failureCommentary(result){const text=String(result?.message||result?.result||'');return /missing materials|材料不足/.test(text)?'材料还不够，先补齐。':/out of.*reach|too far|距离.*不足|超出.*距离/.test(text)?'还没靠近目标，先调整距离。':/obstructed|line of sight|视线/.test(text)?'视线被挡住了，换个接近的位置。':/目标格必须是空气|已有方块/.test(text)?'这个位置已有方块，换个空位。':'这一步没完成，先核对一下。';}

export function situationOf(value) {
 const body=value?.response?.data||value?.output||value||{};
 return body.result?.situation||body.situation||body.status||body;
}
export function actionFeedback(record,current,now=Date.now()) {
 if(!record)return null;
 const before=situationOf(record.before),after=situationOf(current),e=record.result?.evidence||{};
 const beforeHealth=e.healthBefore??before.vitals?.health??before.health??null;
 const afterHealth=after.vitals?.health??after.health??e.healthAfter??null;
 const lowest=e.lowestHealthObserved??(beforeHealth!==null&&afterHealth!==null?Math.min(beforeHealth,afterHealth):null);
 const drop=beforeHealth===null||lowest===null?null:Math.round(Math.max(0,beforeHealth-lowest)*100)/100;
 const count=state=>{const totals=new Map();for(const stack of state.inventory?.stacks||[]){totals.set(stack.name,(totals.get(stack.name)||0)+stack.count);}return totals;};
 const previous=count(before),present=count(after);
 const gains=[...present].filter(([name,n])=>n>(previous.get(name)||0)).slice(0,6).map(([name,n])=>({name,count:n-(previous.get(name)||0)}));
 return {
  id:record.id,ageMs:Math.max(0,now-record.at),action:record.name,state:record.result?.state||'unknown',
  result:typeof record.result?.result==='string'?record.result.result.slice(0,300):undefined,
  health:{before:beforeHealth,lowestObserved:lowest,afterAction:e.healthAfter??null,now:afterHealth,observedDrop:drop,observedHeartsLost:drop===null?null:Math.round(drop/2*100)/100,unit:'生命点；2点=血条的1颗心'},
  target:{type:e.targetType||null,deathObserved:e.targetDeathObserved===true,missing:record.result?.result?.missing===true,attacksPerformed:record.result?.result?.attacks??null},
  gained:gains,
  dimensionChanged:Boolean(before.dimension&&after.dimension&&before.dimension!==after.dimension),
  note:'血量最低值是客户端动作期间的观测；目标暂时消失不能推断死亡。没有确认的数据不要编造。',
 };
}
export function reactionAllowed(feedback,snapshot) {
 const discovery=situationOf(snapshot).spatial?.environment?.updates?.some(e=>e.salient&&Date.now()-e.at<=90000);
 if(!discovery&&(!feedback||feedback.ageMs>30000||feedback.state==='cancelled'))return false;
 const s=situationOf(snapshot),v=s.vitals||s;
 return !((v.health??20)<=10 || (s.position?.inWater&& (v.airSupplyTicks??300)<100) || s.position?.inLava || s.nearby?.hostiles?.some(e=>e.distance<5));
}
export function reactionEventKey(feedback,snapshot){const event=situationOf(snapshot).spatial?.environment?.updates?.find(e=>e.salient);return event?.id||feedback?.id;}
