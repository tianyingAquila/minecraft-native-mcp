// Preserve valid JSON and the spatial/vital context even in crowded scenes or large containers.
export function encodeObservation(snapshot,limit=24000) {
  const value=structuredClone(snapshot),s=value?.result?.situation;
  if(!s)return JSON.stringify(value);
  const omitted={};
  const size=()=>JSON.stringify(value).length;
  for(const [field,keep] of [['droppedItems',4],['mobs',8],['hostiles',6]]){
    if(size()<=limit)break;
    const list=s.nearby?.[field];
    if(list?.length>keep){omitted[field]=list.length-keep;s.nearby[field]=list.slice(0,keep);}
  }
  if(size()>limit&&s.openMenu?.slots?.length>12){omitted.containerSlots=s.openMenu.slots.length-12;s.openMenu.slots=s.openMenu.slots.slice(0,12);s.openMenu.note='容器摘要因长度仅列部分格子，需要精确操作时用get_container读取。';}
  if(size()>limit&&s.spatial?.directions){
    for(const d of s.spatial.directions){if(d.visible?.length>3)d.visible=d.visible.slice(0,3);delete d.candidate;}
    omitted.spatialDetail='更多地形细节可用inspect_space读取';
  }
  if(Object.keys(omitted).length)s.observationOmitted=omitted;
  // Bounded source fields normally fit comfortably. Never cut a JSON token in half.
  return JSON.stringify(value);
}

export function requestUsage(body,usage={}) {
  let images=0;
  const textForm=value=>JSON.stringify(value,(key,item)=>{
    if(key==='url'&&typeof item==='string'&&item.startsWith('data:image/')){images++;return '[image]';}
    return item;
  })??'';
  const messages=body.messages??[];
  const partsUtf8Bytes={system:Buffer.byteLength(textForm(messages[0]),'utf8'),tools:Buffer.byteLength(textForm(body.tools??[]),'utf8'),history:Buffer.byteLength(textForm(messages.slice(1,-1)),'utf8'),observation:Buffer.byteLength(textForm(messages.at(-1)),'utf8')};
  return {at:Date.now(),promptTokens:usage.prompt_tokens??null,completionTokens:usage.completion_tokens??null,cacheHitTokens:usage.prompt_cache_hit_tokens??null,partsUtf8Bytes,images,note:'token数来自本次API返回；各部分体量为UTF-8字节，不是分项token数。缓存命中包含在输入总数内。'};
}
