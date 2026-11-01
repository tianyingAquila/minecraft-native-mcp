const $ = (id) => document.getElementById(id);
let pending = false,
  settingsLoaded = false;
let latestState=null,lastErrorShown='',checkBusy=false,directoryBusy=false;
let setupCollapsed=false,previousStatus='';
const escape=(text)=>String(text??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function currentSettings(){return {durationMinutes:Number($('duration').value),world:$('world-select').value,minecraftHome:$('minecraft-home').value,minecraftVersion:$('minecraft-version').value,nativeHudEnabled:$('native-hud').checked};}
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
      const settings=currentSettings();
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
  if(s.status==='ready'&&previousStatus!=='ready')setupCollapsed=true;
  if(s.status==='preparing'||s.status==='error')setupCollapsed=false;
  previousStatus=s.status;
  latestState=s;renderPreparation(s);
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
  $("start").disabled = !['ready','paused'].includes(s.status)||!(s.connected||s.setup?.steps?.every(row=>row.state==='done'));
  $("pause").disabled = !["running", "ready", "preparing"].includes(s.status);
  $('pause').textContent=s.status==='preparing'?'取消准备':'暂停整局';
  $("stop").disabled = ["idle", "stopped", "preparing"].includes(s.status);
  $("start").textContent = s.status === "paused" ? "继续冒险" : "开始冒险";
  if (!settingsLoaded) {
    $("duration").value = s.settings.durationMinutes;
    $("world-select").value = s.settings.world;
    $("native-hud").checked = s.settings.nativeHudEnabled !== false;
    $('minecraft-home').value=s.settings.minecraftHome||'';
    const option=document.createElement('option');option.value=s.settings.minecraftVersion||'auto';option.textContent=option.value;
    if(![...$('minecraft-version').options].some(x=>x.value===option.value))$('minecraft-version').append(option);
    $('minecraft-version').value=option.value;
    settingsLoaded = true;
  }
  for (const el of $("settings").elements)
    el.disabled = ["running", "preparing", "pausing"].includes(s.status);
  $('cancel-prepare').disabled=s.status!=='preparing';
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
    settings: currentSettings(),
  });
});
$('disable-streaming').onclick=()=>command('settings',{settings:{streamingEnabled:false,nativeHudEnabled:false}});
$("overlay-url").textContent = location.origin + "/overlay?key=green";
await refresh();
void checkEnvironment(false);
setInterval(refresh, 1000);

function renderPreparation(s){
 const setup=s.setup,env=s.environment,busy=['preparing','running','pausing'].includes(s.status);
 document.querySelector('.preparation').classList.toggle('collapsed',setupCollapsed);
 $('toggle-setup').hidden=!['ready','paused','running'].includes(s.status);$('toggle-setup').textContent=setupCollapsed?'展开准备详情':'收起准备详情';
 $('setup-title').textContent=setupCollapsed?'游戏环境已就绪':'先准备好这一局';
 $('setup-description').textContent=setupCollapsed?'Minecraft Java '+(s.settings.resolvedVersion||env?.preparedVersion||'')+' · 世界独立保存，可以开始冒险。':'先确认已有环境，仅缺失时下载；同一版本复用原目录和缓存。';
 $('check-environment').disabled=busy||checkBusy;$('choose-directory').disabled=busy||directoryBusy;$('cancel-prepare').hidden=s.status!=='preparing';
 if(env){
  const selected=$('minecraft-version').value;
  for(const v of env.versions){if(![...$('minecraft-version').options].some(x=>x.value===v.id)){const opt=document.createElement('option');opt.value=v.id;opt.textContent='Java '+v.id+(v.compiled?'':' · 当前包尚未包含');$('minecraft-version').append(opt);}}
  if([...$('minecraft-version').options].some(x=>x.value===selected))$('minecraft-version').value=selected;
  $('environment-checks').innerHTML=env.checks.map(c=>`<li class="check ${escape(c.state)}"><span class="check-symbol" aria-hidden="true">${c.state==='ready'?'✓':c.state==='installable'?'↓':'!'}</span><div><strong>${escape(c.title)}</strong><p>${escape(c.detail)}</p>${c.state==='missing'||c.state==='failed'?'<small>'+escape(c.hint)+'</small>':''}</div><span class="check-label">${({ready:'已就绪',installable:'自动准备',missing:'需要处理',failed:'不兼容'})[c.state]||c.state}</span></li>`).join('');
  $('setup-summary').textContent=env.selectedVersion?'将使用 Minecraft Java '+env.selectedVersion+'；其他版本使用独立世界。':'先安装游戏或选择已有文件夹，然后点准备游戏。';
  const unique=[...new Set(env.games.map(g=>g.version))];$('detected-games').replaceChildren(...unique.map(v=>{const b=document.createElement('button');b.type='button';b.className='game-chip';b.textContent='已找到 '+v;b.disabled=busy;b.onclick=()=>{$('minecraft-version').value=v;};return b;}));
 }
 if(!setup)return;
 const hasProgress=setup.steps.some(row=>row.state!=='pending');$('setup-progress').hidden=!hasProgress;
 const active=setup.steps.find(row=>row.id===setup.active);$('progress-title').textContent=active?.title||(s.status==='ready'?'游戏准备完成':setup.error?.code==='CANCELLED'?'准备已取消':'本次准备记录');
 const idle=Math.floor((Date.now()-setup.updatedAt)/1000);$('progress-time').textContent=setup.running?(idle>=15?'已有 '+idle+' 秒没有新进度':'正在处理'):'已结束';
 const p=setup.progress,bar=$('download-progress');if(p?.total>0)bar.value=Math.min(100,p.received/p.total*100);else if(p?.filesTotal>0)bar.value=p.filesDone/p.filesTotal*100;else if(setup.running)bar.removeAttribute('value');else bar.value=s.status==='ready'?100:0;
 const mb=n=>(n/1048576).toFixed(1)+' MB';$('download-detail').textContent=p?[p.file,p.total?mb(p.received||0)+' / '+mb(p.total):'',p.filesTotal?'文件 '+p.filesDone+' / '+p.filesTotal:'',p.retrying?'正在重试下载':''].filter(Boolean).join(' · '):active?.detail||'';
 if(setup.running&&idle>=45)$('download-detail').textContent+=' · 这一步耗时较长；仍可取消，重试会复用完整下载。';
 $('setup-steps').innerHTML=setup.steps.map((row,i)=>`<li class="${escape(row.state)}"><span>${row.state==='done'?'✓':row.state==='failed'?'!':i+1}</span><div><strong>${escape(row.title)}</strong>${row.state!=='pending'?'<p>'+escape(row.detail||'')+'</p>':''}</div><small>${({pending:'等待',running:'进行中',done:'完成',failed:'未完成',cancelled:'已取消'})[row.state]}</small></li>`).join('');
 const error=setup.error,blocking=error&&error.code!=='CANCELLED';$('setup-problem').hidden=!blocking;
 if(blocking){
  $('problem-title').textContent=error.title;$('problem-hint').textContent=error.hint;$('problem-detail').textContent=error.detail+'\n错误编号：'+error.code;
  $('retry-setup').hidden=!error.retryable;$('fix-directory').hidden=error.code!=='GAME_MISSING';
  const key=setup.startedAt+'|'+error.code;if(lastErrorShown!==key){lastErrorShown=key;$('dialog-title').textContent=error.title;$('dialog-hint').textContent=error.hint;$('dialog-step').textContent='发生在：'+(setup.steps.find(x=>x.id===error.step)?.title||error.step);$('dialog-retry').hidden=!error.retryable||error.code==='GAME_MISSING';$('dialog-directory').hidden=error.code!=='GAME_MISSING';if(!$('error-dialog').open)$('error-dialog').showModal();}
 }
}
async function checkEnvironment(save=true){
 if(checkBusy)return;checkBusy=true;$('check-environment').disabled=true;
 try{if(save){await command('settings',{settings:currentSettings()});}const r=await fetch('/api/environment',{cache:'no-store'});if(!r.ok)throw Error((await r.json()).error);const report=await r.json();if(latestState){latestState.environment=report;renderPreparation(latestState);}}
 catch(e){$('setup-summary').textContent='检查未完成：'+e.message;}finally{checkBusy=false;$('check-environment').disabled=false;}
}
$('check-environment').onclick=()=>checkEnvironment();
$('toggle-setup').onclick=()=>{setupCollapsed=!setupCollapsed;if(latestState)renderPreparation(latestState);};
$('choose-directory').onclick=async()=>{if(directoryBusy)return;directoryBusy=true;const b=$('choose-directory');b.disabled=true;b.textContent='等待选择…';try{const r=await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'choose_directory'})});const d=await r.json();if(!r.ok)throw Error(d.error);if(d.folder){$('minecraft-home').value=d.folder;await checkEnvironment();}}catch(e){$('setup-summary').textContent=e.message;}finally{directoryBusy=false;b.disabled=false;b.textContent='选择文件夹';}};
function focusDirectory(){$('error-dialog').close();$('settings').scrollIntoView({behavior:'smooth',block:'center'});$('minecraft-home').focus();}
$('fix-directory').onclick=focusDirectory;$('dialog-directory').onclick=focusDirectory;
$('retry-setup').onclick=()=>command('prepare');$('dialog-retry').onclick=()=>{$('error-dialog').close();void command('prepare');};$('dialog-dismiss').onclick=()=>$('error-dialog').close();
$('copy-diagnostics').onclick=async()=>{const s=latestState;const text=JSON.stringify({version:'0.3.1',status:s.status,game:s.settings.resolvedVersion||s.settings.minecraftVersion,environment:s.environment,setup:s.setup,events:s.events.slice(-8)},null,2);try{await navigator.clipboard.writeText(text);$('notice').textContent='诊断信息已复制，可发给维护者排查。';}catch{$('problem-detail').textContent=text;$('problem-detail').parentElement.open=true;}};
