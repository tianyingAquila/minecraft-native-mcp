const $ = (id) => document.getElementById(id);
let pending = false,
  settingsLoaded = false;
const names = {
  idle: "尚未开始",
  preparing: "正在准备",
  ready: "准备完成",
  running: "自主游玩中",
  pausing: "正在保存暂停",
  paused: "已暂停",
  stopped: "已保存停止",
  error: "需要检查",
};
function clock(ms) {
  let n = Math.ceil(ms / 1000);
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
}
async function command(action, extra = {}) {
  if (pending) return;
  pending = true;
  $("notice").textContent = "正在处理…";
  try {
    if(action==='prepare'){
      const settings={durationMinutes:Number($('duration').value),world:$('world-select').value,minecraftHome:$('minecraft-home').value,nativeHudEnabled:$('native-hud').checked};
      const saved=await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'settings',settings})});
      if(!saved.ok)throw new Error((await saved.json()).error);
    }
    const r = await fetch("/api/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    $("notice").textContent = "操作已完成。";
    await refresh();
  } catch (e) {
    $("notice").textContent = e.message;
  } finally {
    pending = false;
  }
}
function render(s) {
  const streaming=s.settings.streamingEnabled===true;
  document.body.dataset.streaming=String(streaming);
  for(const el of document.querySelectorAll('.stream-only'))el.hidden=!streaming;
  const frame=$('stream-preview');if(streaming&&!frame.hasAttribute('src'))frame.src=frame.dataset.src;if(!streaming&&frame.hasAttribute('src'))frame.removeAttribute('src');
  $('display-mode').textContent=streaming?'直播扩展已启用':'普通游玩模式';
  $('action-plan').textContent=s.actionPlan?'当前打算：'+s.actionPlan:'';
  $("status").textContent = names[s.status] || s.status;
  $("status").className = "status " + s.status;
  $("goal").textContent = s.goal;
  $("reason").textContent = s.reason || "大肥鱼正在自己决定下一步。";
  $("world").textContent =
    s.settings.world === "live" ? "正式世界" : "排练世界";
  $("remaining").textContent = clock(s.remainingMs);
  $("balance").textContent = s.balance
    ? "¥" + Number(s.balance.total).toFixed(2)
    : "—";
  $("balance-error").textContent = s.balanceError;
  const diag = s.diagnostics;
  $("vision-state").textContent = diag?.last
    ? `截图诊断：${diag.captured} 次，已送达 ${diag.delivered} 次 · ${diag.last.status} · ${diag.last.reason}`
    : "截图诊断：本次启动尚未调用";
  const timing=s.performance||{};
  $("performance-state").textContent=timing.modelMs===undefined?'':`最近一轮：模型 ${(timing.modelMs/1000).toFixed(1)}秒 · 余额检查 ${((timing.balanceMs||0)/1000).toFixed(1)}秒 · 游戏动作 ${((timing.actionMs||0)/1000).toFixed(1)}秒`;
  const request=s.lastRequest;
  $("request-usage").textContent=request?`最近一次模型请求：输入 ${request.promptTokens??'未返回'} token（其中缓存 ${request.cacheHitTokens??'未返回'}）· 输出 ${request.completionTokens??'未返回'} token`:'本次启动尚无模型请求。';
  const space=s.spatial;
  $("spatial-summary").textContent=space?.available?[
    `范围：周围${space.range.horizontal}格，上下${space.range.vertical}格；朝向${space.heading}°。${space.local.ceiling}。`,
    ...space.directions.map(d=>`${d.relative}（${d.compass}）：${d.view}；2/6/12格处宽度 ${d.widthAt2_6_12.map(n=>n??'?').join('/')}。${d.shape??''}${d.entry?d.entry.distance+'格外'+d.entry.ground+(d.entry.drop!==undefined?'，落差约'+d.entry.drop+'格':'')+'。':''}${d.visible.map(v=>v.type+(v.density?' '+v.density:'')+' 约'+v.distance+'格').join('；')}`),
    '候选通路来自地形计算，尚未验证实际能走；?代表未确认。数据仅对应本轮朝向和位置。',
  ].join('\n'):space?.reason??'准备游戏后显示。';
  $("vitals").textContent = (s.health ?? "—") + " / " + (s.hunger ?? "—");
  $("tools").textContent = s.connected
    ? s.tools + " 个游戏工具 · " + s.calls + " 次模型请求"
    : "游戏工具尚未连接";
  $("prepare").disabled = ["running", "preparing", "pausing"].includes(
    s.status,
  );
  $("start").disabled = !['ready','paused'].includes(s.status);
  $("pause").disabled = !["running", "ready", "preparing"].includes(s.status);
  $('pause').textContent=s.status==='preparing'?'取消准备':'暂停整局';
  $("stop").disabled = ["idle", "stopped", "preparing"].includes(s.status);
  $("start").textContent = s.status === "paused" ? "继续冒险" : "开始冒险";
  if (!settingsLoaded) {
    $("duration").value = s.settings.durationMinutes;
    $("world-select").value = s.settings.world;
    $("native-hud").checked = s.settings.nativeHudEnabled !== false;
    $('minecraft-home').value=s.settings.minecraftHome||'';
    settingsLoaded = true;
  }
  for (const el of $("settings").elements)
    el.disabled = ["running", "preparing", "pausing"].includes(s.status);
  $("events").replaceChildren(
    ...s.events
      .slice(-10)
      .reverse()
      .map((e) => {
        const li = document.createElement("li"),
          time = document.createElement("time");
        time.textContent = new Date(e.at).toLocaleTimeString("zh-CN", {
          hour12: false,
          timeZone: "Asia/Shanghai",
        });
        li.append(time, document.createTextNode(e.text));
        return li;
      }),
  );
}
async function refresh() {
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    render(await r.json());
  } catch {
    $("reason").textContent = "控制进程连接中断，请从桌面入口重新打开。";
  }
}
document
  .querySelectorAll("[data-action]")
  .forEach((b) => b.addEventListener("click", () => command(b.dataset.action)));
$("settings").addEventListener("submit", (e) => {
  e.preventDefault();
  void command("settings", {
    settings: {
      durationMinutes: Number($("duration").value),
      world: $("world-select").value,
        nativeHudEnabled: $("native-hud").checked,
        minecraftHome:$('minecraft-home').value,
    },
  });
});
$('disable-streaming').onclick=()=>command('settings',{settings:{streamingEnabled:false,nativeHudEnabled:false}});
$("overlay-url").textContent = location.origin + "/overlay?key=green";
await refresh();
setInterval(refresh, 1000);
