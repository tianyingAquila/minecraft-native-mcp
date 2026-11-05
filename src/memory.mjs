// The API reports exact usage only after a request. Growth is bounded by UTF-8
// bytes, not mislabeled as exact tokens; image base64 is never counted as text.
export const CONTEXT_TRIGGER_TOKENS = 500000;
export const RECENT_TOKENS = 100000;
export const MEMORY_MAX_CHARS = 16000;

export function contextSize(body) {
  let images = 0;
  const text = JSON.stringify({messages:body.messages, tools:body.tools ?? []}, (key, value) => {
    if (key === 'url' && typeof value === 'string' && value.startsWith('data:image/')) {
      images++;
      return '[image]';
    }
    return value;
  });
  return {textBytes:Buffer.byteLength(text), imageTokens:images * 1024};
}

export function validMeter(meter) {
  return Number.isFinite(meter?.promptTokens) && meter.promptTokens > 0 &&
    Number.isFinite(meter.textBytes) && meter.textBytes > 0 &&
    Number.isFinite(meter.imageTokens) && meter.imageTokens >= 0;
}

export function measureContext(body, usage) {
  const meter = {...contextSize(body), promptTokens:usage?.prompt_tokens};
  return validMeter(meter) ? meter : null;
}

export function contextPressure(body, meter) {
  const size = contextSize(body);
  if (!validMeter(meter)) return {...size, estimatedTokens:size.textBytes + size.imageTokens, basis:'utf8_upper_bound'};
  if (meter.afterCompaction) {
    const density = Math.min(1,Math.max(0.05,(meter.promptTokens-meter.imageTokens)/meter.textBytes));
    return {...size,estimatedTokens:Math.ceil(size.textBytes*density*1.2)+size.imageTokens,basis:'density_after_compaction'};
  }
  return {...size, estimatedTokens:Math.ceil(meter.promptTokens + Math.max(0,size.textBytes-meter.textBytes) + Math.max(0,size.imageTokens-meter.imageTokens)), basis:'api_calibrated_growth'};
}

export function splitHistory(history, meter, retainTokens = RECENT_TOKENS) {
  const ratio = validMeter(meter) ? Math.min(1, Math.max(0.05, (meter.promptTokens-meter.imageTokens)/meter.textBytes) * 1.2) : 1;
  let index = history.length, tokens = 0;
  while (index > 0) {
    const next = Math.ceil(Buffer.byteLength(JSON.stringify(history[index-1])) * ratio);
    if (index < history.length && tokens + next > retainTokens) break;
    tokens += next;
    index--;
  }
  return {older:history.slice(0,index), recent:history.slice(index), retainedEstimatedTokens:tokens};
}

export function summaryRequest(body) {
  // Preserve the warm text prefix, but leave the pending image for the actual
  // game decision. Summarization must never consume or persist it.
  const messages = body.messages.map(message => Array.isArray(message.content)
    ? {...message,content:message.content.filter(p=>p.type==='text').map(p=>p.text).join('\n')}
    : message);
  messages.push({role:'user', content:`现在只整理游戏长期记忆，不执行游戏动作，也不调用工具。输出中文交接摘要，最多${MEMORY_MAX_CHARS}字符。
合并已有自动摘要、手动笔记及此后的真实工具结果，保留仍有效的事实，删除过期或重复内容。当前真实状态优先于旧笔记。
分段记录：当前阶段与已完成成果；带维度和坐标的重要地点（家、床、箱子、地狱门、堡垒、资源）；已确认的物品与交易成果；未完成任务和下一步；失败尝试、原因和避免重复的教训；用户明确要求与辅助规则。
明确区分已确认事实、猜测、失效信息；死亡或切维度后不要沿用旧位置。工具没执行成功不算取得成果，没获得的珍珠不要写成已有。没有记录不等于不存在或从未做过，不凭空断言周围没有树木等资源。下一步只保留已制定的计划，未制定则标记待决策，不临时发明路线。
无需复制每轮会刷新的血条、附近实体清单、地形采样、常驻工具说明、原始JSON或闲聊；保留重要危险和长期有用地点。摘要覆盖全部历史，用于之后继续游戏。只输出摘要正文。`});
  return {...body,messages,tool_choice:'none',max_tokens:8192,temperature:0.2};
}

export function summaryText(response) {
  const choice = response.choices?.[0], message = choice?.message;
  const text = typeof message?.content === 'string' ? message.content.trim() : '';
  if (!text || text.length > MEMORY_MAX_CHARS || message.tool_calls?.length || (choice.finish_reason && choice.finish_reason !== 'stop'))
    throw new Error('上下文整理未得到完整有效摘要；保留原历史，已暂停。');
  return text;
}
