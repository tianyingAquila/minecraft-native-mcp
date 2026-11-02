// Counts real resource/position changes, not head turns or opening the same menu.
export class ProgressGuard {
  constructor() { this.reset(); }
  reset() { this.key = null; this.changedAt = 0; this.rounds = 0; this.failures = new Map(); this.blocks = 0; this.menus = new Map(); }
  observe(snapshot, now = Date.now()) {
    const s = snapshot?.result?.situation || snapshot?.situation || snapshot;
    const p = s.position || {};
    const counts = new Map();
    for (const i of s.inventory?.stacks || []) {
      const item = counts.get(i.name) || {name:i.name,count:0,remaining:0};
      item.count += i.count; item.remaining += i.durability?.remaining || 0; counts.set(i.name,item);
    }
    if(s.openMenu?.open) this.menus.set(JSON.stringify([s.openMenu.type,s.openMenu.position]),JSON.stringify(s.openMenu.slots));
    if(this.menus.size>8)this.menus.delete(this.menus.keys().next().value);
    const key = JSON.stringify({dimension: s.dimension, pos: [p.x,p.y,p.z].map(v => Number.isFinite(v) ? Math.round(v) : null), health:s.vitals?.health??s.health, food:s.vitals?.food, items:[...counts.values()].sort((a,b)=>a.name.localeCompare(b.name)), menus:[...this.menus.entries()].sort()});
    if (key !== this.key) { this.key = key; this.changedAt = now; this.rounds = 0; this.failures.clear(); this.blocks = 0; }
    this.rounds++;
  }
  actionKey(name, args) {
    if(name==='inspect_game_screen')return name;
    return name + ':' + JSON.stringify(Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'waitSeconds').sort(([a],[b]) => a.localeCompare(b))));
  }
  blocked(name, args) {
    if(name==='inspect_game_screen')return null;
    const failure = this.failures.get(this.actionKey(name,args));
    if (!failure || failure.count < 2) return null;
    this.blocks++;
    return {state: 'not_executed', error: 'REPLAN_REQUIRED', message: '真实资源和位置尚未改变，同一操作已失败两次，不再重复执行。先解决失败原因、换有依据的方案，或在困惑时截图。', previousFailure: failure.message};
  }
  record(name, args, result) {
    if(result?.state==='cancelled')return;
    if (name==='inspect_game_screen'||['REPLAN_REQUIRED','OBSERVATION_REQUIRED'].includes(result?.error)) return;
    if (result?.state !== 'failed' && !result?.error) return;
    const key = this.actionKey(name,args), previous = this.failures.get(key);
    this.failures.set(key,{count:(previous?.count || 0)+1, action:name, message:String(result.message || result.result || result.error).slice(0,1500)});
  }
  advice(now = Date.now()) {
    return {recentFailures: [...this.failures.values()].slice(-3), stalled: this.rounds >= 8 && now-this.changedAt >= 45000};
  }
  needsRecovery(now = Date.now()) { return this.blocks >= 3 || (this.rounds >= 16 && now-this.changedAt >= 120000); }
  recoveryStarted(now=Date.now()){this.blocks=0;this.rounds=0;this.changedAt=now;}
}
