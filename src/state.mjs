import fs from "node:fs";
import path from "node:path";
import { DATA, FIXED_NOTE, readSettings, saveSettings } from "./config.mjs";
import {SetupState} from './setup-state.mjs';
import {SUPPORTED_VERSIONS,validateWorldId} from './versions.mjs';
export class Store {
  constructor({ persist = true } = {}) {
    this.persist = persist;
    this.settings = readSettings();
    this.status = "idle";
    this.setup=new SetupState();this.environment=null;
    this.reason = "";
    this.balance = null;
    this.balanceError = "";
    this.goal = "准备踏上击杀末影龙的旅程";
    this.health = null;
    this.hunger = null;
    this.position = null;
    this.inventory = [];
    this.deaths = 0;
    this.runningMs = 0;
    this.startedAt = null;
    this.events = [];
    this.reply = null;
    this.replySeq = 0;
    this.commentary = null;
    this.commentarySeq = 0;
    this.reaction = null;
    this.reactionSeq = 0;
    this.performance = {};
    this.tools = 0;
    this.calls = 0;
    this.usage = { prompt: 0, completion: 0, cached: 0 };
    this.connected = false;
    if (persist) {
      try {
        const saved = JSON.parse(
          fs.readFileSync(path.join(DATA, "run-state.json"), "utf8"),
        );
        if (saved.settings?.world === this.settings.world && (saved.settings?.resolvedVersion||'1.21.4')===(this.settings.resolvedVersion||'1.21.4')) {
          this.goal = saved.goal || this.goal;
          if (saved.status !== "stopped")
            this.runningMs = Number(saved.runningMs) || 0;
          this.usage = saved.usage || this.usage;
        }
      } catch {}
    }
  }
  elapsed(now = Date.now()) {
    return this.runningMs + (this.startedAt ? now - this.startedAt : 0);
  }
  remaining(now = Date.now()) {
    return Math.max(
      0,
      this.settings.durationMinutes * 60000 - this.elapsed(now),
    );
  }
  startClock() {
    if (!this.startedAt) this.startedAt = Date.now();
  }
  stopClock() {
    if (this.startedAt) {
      this.runningMs += Date.now() - this.startedAt;
      this.startedAt = null;
    }
  }
  event(text) {
    this.events.push({ at: Date.now(), text: String(text).slice(0, 220) });
    this.events = this.events.slice(-80);
    this.save();
  }
  say(text,action){
    if(!text)return;
    this.commentary={seq:++this.commentarySeq,text,action,at:Date.now()};
  }
  sayReaction(text,eventId){
    if(text)this.reaction={seq:++this.reactionSeq,text,eventId,at:Date.now()};
  }
  save() {
    if (!this.persist) return;
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(
      path.join(DATA, "run-state.json"),
      JSON.stringify(
        {
          status: this.status,
          runningMs: this.elapsed(),
          settings: this.settings,
          goal: this.goal,
          usage: this.usage,
          updatedAt: Date.now(),
        },
        null,
        2,
      ),
    );
  }
  configure(patch) {
    if (["running","preparing","pausing"].includes(this.status))
      throw new Error("请先暂停，再修改时长或世界。");
    if(patch.streamingEnabled!==undefined){if(typeof patch.streamingEnabled!=='boolean')throw new Error('直播扩展开关无效');this.settings.streamingEnabled=patch.streamingEnabled;}
    if(patch.minecraftHome!==undefined){if(typeof patch.minecraftHome!=='string'||patch.minecraftHome.length>1024)throw new Error('游戏目录无效');this.settings.minecraftHome=patch.minecraftHome.trim();}
    if(patch.minecraftVersion!==undefined){if(patch.minecraftVersion!=='auto'&&!SUPPORTED_VERSIONS.includes(patch.minecraftVersion))throw new Error('请选择支持的1.21系列正式版本。');this.settings.minecraftVersion=patch.minecraftVersion;}
    if (patch.nativeHudEnabled !== undefined) {
      if (typeof patch.nativeHudEnabled !== "boolean") throw new Error("游戏内挂件开关无效。");
      this.settings.nativeHudEnabled = patch.nativeHudEnabled;
    }
    if (patch.durationMinutes !== undefined) {
      const n = Number(patch.durationMinutes);
      if (!Number.isInteger(n) || n < 1 || n > 720)
        throw new Error("每场时长可设为 1–720 分钟。");
      this.settings.durationMinutes = n;
    }
    if (patch.world !== undefined) {
      this.settings.world = validateWorldId(patch.world);
    }
    saveSettings(this.settings);
    this.save();
  }
  publicState() {
    return {
      status: this.status,
      reason: this.reason,
      balance: this.balance
        ? {
            total: this.balance.total,
            currency: this.balance.currency,
            checkedAt: this.balance.checkedAt,
          }
        : null,
      balanceError: this.balanceError,
      goal: this.goal,
      health: this.health,
      hunger: this.hunger,
      position: this.position,
      actionPlan:this.commentary?.text??'',
      setup:this.setup.snapshot(),environment:this.environment,
      inventory: this.inventory,
      deaths: this.deaths,
      remainingMs: this.remaining(),
      elapsedMs: this.elapsed(),
      settings: this.settings,
      events: this.events,
      tools: this.tools,
      calls: this.calls,
      usage: this.usage,
      performance: this.performance,
      lastRequest: this.lastRequest??null,
      contextPressure:this.contextPressure??null,
      contextCompaction:this.contextCompaction??null,
      spatial: this.spatial??null,
      connected: this.connected,
      diagnostics: this.diagnostics || {
        captured: 0,
        delivered: 0,
        last: null,
      },
    };
  }
  overlayState() {
    return {
      hudEnabled: this.settings.streamingEnabled === true && this.settings.nativeHudEnabled !== false,
      streamingEnabled:this.settings.streamingEnabled===true,
      contextCompacting:this.contextCompaction?.state==='running',
      note: FIXED_NOTE,
      goal: this.goal,
      balance:
        this.balance && Date.now() - this.balance.checkedAt < 120000
          ? { total: this.balance.total, checkedAt: this.balance.checkedAt }
          : null,
      commentary:
        this.commentary && Date.now()-this.commentary.at<20000?this.commentary:null,
      reaction: this.reaction && Date.now()-this.reaction.at<16000?this.reaction:null,
      bubble: {
        minSeconds: this.settings.bubbleMinSeconds,
        maxSeconds: this.settings.bubbleMaxSeconds,
        durationSeconds: this.settings.bubbleDurationSeconds,
      },
    };
  }
}
