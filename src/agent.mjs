import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ROOT, DATA } from "./config.mjs";
import {gameWorldName} from './versions.mjs';
import {
  fetchBalance,
  canSpend,
  reserveFor,
  chatCompletion,
  ServiceError,
} from "./deepseek.mjs";
import { unwrap } from "./mcp.mjs";
import { VISION_TOOL } from "./vision.mjs";
import { ProgressGuard } from './progress.mjs';
import {encodeObservation,requestUsage} from './observation.mjs';
import {withCommentary,shortCommentary,actionCommentary,failureCommentary,actionFeedback,reactionAllowed,reactionEventKey,situationOf} from './commentary.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PASSIVE=new Set(['wait_for_game','look_at','close_container','close_game_screen','set_goal','inspect_game_screen']);
const localTools = [
  {
    type: "function",
    function: {
      name: "set_goal",
      description:
        "goal是目标板常驻的阶段成果，不随每个动作改写；完成或策略改变后才更新。重要地点/资源改变、死亡或切换维度后更新已确认记忆。notes省略时保留旧摘要；提供时完整替换，须保留仍有效的事实，不要只提交增量。",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", maxLength: 100 },
          notes: { type: "string", maxLength: 2400, description: "完整更新后的长期记忆摘要；保留有效地点/事实，去掉过期状态与未经确认的推测。" },
        },
        required: ["goal"],
        additionalProperties: false,
      },
    },
  },
];
export function compactHistory(history, maxBytes = 85000) {
  const out = [...history];
  while (out.length > 1 && Buffer.byteLength(JSON.stringify(out)) > maxBytes)
    out.shift();
  return out;
}
export class Agent {
  constructor(
    runtime,
    { balanceFn = fetchBalance, chatFn = chatCompletion } = {},
  ) {
    this.runtime = runtime;
    this.store = runtime.store;
    this.mcp = runtime.mcp;
    this.balanceFn = balanceFn;
    this.chatFn = chatFn;
    this.history = [];
    this.notes = "";
    this.controller = null;
    this.task = null;
    this.emptyRounds = 0;
    this.progress = new ProgressGuard();
    this.visionUnavailableRequests=0;
    this.lastAction = null;
    this.feedback = null;
    this.reactedEvent = null;
    this.seenDiscoveries=new Set();
    this.idleRounds=0;this.waitStreak=0;this.forceAction=false;this.recoveryNote=null;
  }
  get sessionFile() {
    return path.join(DATA, "agent-" + gameWorldName(this.store.settings) + ".json");
  }
  load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.sessionFile, "utf8"));
      this.history = compactHistory(saved.history || []);
      this.notes = String(saved.notes || "").slice(0, 5000);
    } catch {
      this.history = [];
      this.notes = "";
    }
  }
  save() {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(
      this.sessionFile,
      JSON.stringify({
        history: this.history,
        notes: this.notes,
        updatedAt: Date.now(),
      }),
    );
  }
  begin(options = {}) {
    this.controller = new AbortController();
    this.progress.reset();
    this.lastAction = null; this.feedback = null; this.reactedEvent = null;
    this.visionUnavailableRequests=0;
    this.idleRounds=0;this.waitStreak=0;this.forceAction=false;this.recoveryNote=null;
    this.emptyRounds=0;
    this.load();
    this.task = this.run(options).catch(async (e) => {
      if (e.name !== "AbortError") {
        this.store.event(e.message || "游戏决策循环异常。");
        await this.runtime.pause(
          e.code || "agent_error",
          e.message || "决策异常，已暂停。",
        );
      }
    });
    return this.task;
  }
  abort() {
    this.controller?.abort();
  }
  async updateStatus() {
    const status = await this.mcp.status();
    this.runtime.observe(status);
    return status;
  }
  async run({ maxRounds = 0 } = {}) {
    let round = 0;
    while (!this.controller.signal.aborted && this.store.status === "running") {
      if (this.store.remaining() <= 0) {
        await this.runtime.pause(
          "duration",
          "本场时长已到，已保存并暂停游戏。",
        );
        return;
      }
      let phaseAt=Date.now();
      const snapshot = await this.updateStatus();
      const discoveries=snapshot?.result?.situation?.spatial?.environment?.updates;
      if(discoveries)snapshot.result.situation.spatial.environment.updates=discoveries.filter(e=>!this.seenDiscoveries.has(e.id));
      this.currentSnapshot = snapshot;
      this.feedback = actionFeedback(this.lastAction,snapshot);
      this.store.performance.stateMs=Date.now()-phaseAt;
      this.progress.observe(snapshot);
      const system = fs.readFileSync(
        path.join(ROOT, "prompts", "game.md"),
        "utf8",
      );
      const visionAvailable=this.runtime.vision?.availability();
      if(visionAvailable?.available)this.visionUnavailableRequests=0;
      const requireAction=this.forceAction||this.emptyRounds>0||this.idleRounds>=2||this.waitStreak>=2||this.progress.advice().stalled;
      let tools = [
        ...this.mcp.tools().map(t=>withCommentary(t,this.mcp.isReadOnly?.(t.function.name))),
        ...localTools,
        ...(this.runtime.vision && visionAvailable?.available!==false ? [VISION_TOOL] : []),
      ];
      if(requireAction){const active=tools.filter(t=>t.function.name==='inspect_game_screen'||!PASSIVE.has(t.function.name)&&!this.mcp.isReadOnly?.(t.function.name));if(active.length)tools=active;}
      const current =
        "当前阶段目标（直播目标板持续显示，阶段未改变时不要重写）：" + this.store.goal + "\n当前真实游戏状态：\n" +
        encodeObservation(snapshot) +
        '\n上一主要动作的真实反馈：'+JSON.stringify(this.feedback)+'\n当前是否适合轻量反应：'+reactionAllowed(this.feedback,snapshot)+
        "\n执行反馈（重复失败时必须先解决原因，不要重复开关同一容器）：" + JSON.stringify(this.progress.advice()) +
        "\n已保存游戏记忆：" +
        this.notes + '\n截图当前可用情况：'+JSON.stringify(visionAvailable||{available:false})+'\n持续推进：'+JSON.stringify({requireAction,consecutiveWaits:this.waitStreak,passiveRounds:this.idleRounds,recovery:this.recoveryNote})+'；夜晚也请选择可推进的采集、制作、探索、睡觉或战斗任务，不连续原地等天亮。脚边实心与树冠不能证明封闭安全屋。';
      const image = this.runtime.vision?.peek();
      const observation = image
        ? [
            {
              type: "text",
              text:
                current +
                "\n截图诊断 " +
                image.id +
                "，时间 " +
                new Date(image.at).toISOString() +
                "，问题：" +
                image.reason +
                (image.repeated ? "；画面与上次相同" : "") +
                "。请观察随附的实际游戏画面再决定下一步。",
            },
            {
              type: "image_url",
              image_url: {
                url: "data:" + image.mime + ";base64," + image.base64,
                detail: "original",
              },
            },
          ]
        : current;
      const body = {
        model: this.store.settings.model,
        messages: [
          { role: "system", content: system },
          ...this.history.flat(),
          { role: "user", content: observation },
        ],
        tools,
        tool_choice: requireAction&&tools.length ? "required" : "auto",
        max_tokens: this.store.settings.maxOutputTokens,
        thinking: { type: "disabled" },
        temperature: 0.7,
      };
      phaseAt=Date.now();
      const balance = await this.balanceFn();
      this.store.performance.balanceMs=Date.now()-phaseAt;
      this.store.balance = balance;
      this.store.balanceError = "";
      if (!canSpend(balance, reserveFor(body))) {
        await this.runtime.pause(
          "low_balance",
          "账户余额接近 1 元保留线，已保存暂停。充值后可继续。",
        );
        return;
      }
      if (this.controller.signal.aborted || this.store.status !== "running")
        return;
      if (image && this.runtime.vision.peek()?.id !== image.id) continue;
      await this.mcp.assertReady?.();
      if (this.controller.signal.aborted || this.store.status !== "running") return;
      phaseAt=Date.now();
      const response = await this.chatFn(body, {
        signal: this.controller.signal,
      });
      this.store.performance.modelMs=Date.now()-phaseAt;
      if (image) this.runtime.vision.consumed(image.id);
      this.store.calls++;
      const usage = response.usage || {};
      this.store.lastRequest=requestUsage(body,usage);
      this.store.usage.prompt += usage.prompt_tokens || 0;
      this.store.usage.completion += usage.completion_tokens || 0;
      this.store.usage.cached += usage.prompt_cache_hit_tokens || 0;
      const message = response.choices[0].message;
      for(const e of snapshot?.result?.situation?.spatial?.environment?.updates||[])this.seenDiscoveries.add(e.id);
      while(this.seenDiscoveries.size>128)this.seenDiscoveries.delete(this.seenDiscoveries.values().next().value);
      const group = [
        {
          role: "assistant",
          content: message.content || null,
          ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
        },
      ];
      const calls = message.tool_calls || [];
      if (!calls.length) {
        this.emptyRounds++;
      } else this.emptyRounds = 0;
      let needsObservation = false,
        majorActionTaken = false,activeAttempted=false;
      for (const call of calls) {
        if (this.controller.signal.aborted) break;
        let output;
        let parsedArgs;
        try {
          const {say,reaction,...rawArgs} = JSON.parse(call.function.arguments || "{}");
          const args=this.mcp.normalizeArgs?.(call.function.name,rawArgs)??rawArgs;
          parsedArgs = args;
          const name = call.function.name;
          const readOnly =
            this.mcp.isReadOnly?.(name) ||
            name === "set_goal";
          if (needsObservation && !readOnly)
            output = {
              state: "not_executed",
              error: "OBSERVATION_REQUIRED",
              message: "本轮已请求截图；请先观察下一条图片，再决定后续动作。",
            };
          else if (
            this.mcp.execute &&
            majorActionTaken &&
            !readOnly &&
            name !== "inspect_game_screen"
          )
            output = {
              state: "not_executed",
              error: "OBSERVATION_REQUIRED",
              message: "本轮主要任务已执行，请刷新状态后再决定下一任务。",
            };
          else {
            if (name === "inspect_game_screen") needsObservation = true;
            output = await this.execute(name, args, say, reaction);
            if(!readOnly&&!PASSIVE.has(name)){activeAttempted=true;this.forceAction=false;}
            if (!readOnly && name !== "inspect_game_screen")
              majorActionTaken = true;
          }
        } catch (e) {
          output = {
            state:this.controller.signal.aborted||e.name==='AbortError'?'cancelled':'failed',
            error: e.code || "ACTION_ERROR",
            message: e.message || "动作失败，请检查后重新规划。",
          };
        }
        if (parsedArgs) this.progress.record(call.function.name, parsedArgs, output);
        const text = JSON.stringify(output);
        group.push({
          role: "tool",
          tool_call_id: call.id,
          content:
            text.length > 16000
              ? text.slice(0, 16000) +
                "\n[结果较长，保留前部；请通过游戏状态或数据查询获取细节。]"
              : text,
        });
      }
      if (this.controller.signal.aborted) {
        this.save();
        return;
      }
      this.history = compactHistory([...this.history, group]);
      this.save();
      this.store.save();
      this.idleRounds=activeAttempted?0:this.idleRounds+1;
      if (this.progress.needsRecovery() || this.visionUnavailableRequests>=3 || this.emptyRounds>=3 || this.idleRounds>=4)await this.recoverActivity();
      round++;
      if (maxRounds && round >= maxRounds) {
        await this.runtime.pause(
          "test_complete",
          "短局验证轮数已完成，游戏已保存暂停。",
        );
        return;
      }
      await sleep(200);
    }
  }
  async execute(name, args, say, reaction) {
    const blocked=this.progress.blocked(name,args);if(blocked)return blocked;
    if (name === "inspect_game_screen") {
      if (!this.runtime.vision) throw new Error("游戏截图诊断尚未连接。");
      const availability=this.runtime.vision.availability();
      if(!availability.available){this.visionUnavailableRequests++;return {state:'not_executed',error:'VISION_NOT_AVAILABLE',...availability,message:'截图当前不可用，请读取已提供的context或短暂等待，不要重复申请。'};}
      this.visionUnavailableRequests=0;
      const metadata = await this.runtime.vision.request(args, {
        signal: this.controller?.signal,
      });
      this.store.event("截图诊断：" + metadata.reason);
      return metadata;
    }
    if (name === "set_goal") {
      if(typeof args.goal!=='string'||!args.goal.trim())throw Error('阶段目标不能为空。');
      if(args.notes!==undefined&&typeof args.notes!=='string')throw Error('游戏记忆必须是文字；不传notes则保留已有记忆。');
      this.store.goal = args.goal.slice(0, 100);
      if(args.notes!==undefined)this.notes = args.notes.slice(0, 5000);
      this.save();
      return { saved: true };
    }
    if(name==='wait_for_game'){
      if(this.waitStreak>=2)return {state:'not_executed',error:'ACTIVE_TASK_REQUIRED',message:'已经连续短等两次。请选择真正可推进的任务，不继续等天亮或重复查询。'};
      this.waitStreak++;
    }else if(!this.mcp.isReadOnly?.(name)&&!PASSIVE.has(name))this.waitStreak=0;
    return this.gameAction(name, args, say, reaction);
  }
  async recoverActivity(){
    this.controller.signal.throwIfAborted();if(this.store.status!=='running')return;
    this.forceAction=true;this.emptyRounds=0;this.idleRounds=0;this.visionUnavailableRequests=0;this.progress.recoveryStarted();
    this.store.event('正在主动诊断无进展状态；继续重新规划，不自动结束冒险。');
    const pending=this.runtime.vision?.peek?.();if(pending){this.recoveryNote={awaitingScreenshot:pending.id};return;}
    const s=situationOf(this.currentSnapshot),v=s.vitals||s,urgent=(v.health??20)<=10||s.position?.inLava||(v.airSupplyTicks??300)<100||s.nearby?.hostiles?.some(e=>e.distance<5);
    if(this.runtime.vision?.availability?.()?.available&&!urgent){
      try{this.recoveryNote=await this.runtime.vision.request({reason:'当前反复等待或行动没有进展，需要核对实际出口与地形，再选择可推进的任务。',symptom:'stuck'},{signal:this.controller.signal});return;}catch(e){this.controller.signal.throwIfAborted();this.recoveryNote={error:e.code||e.message};}
    }
    if(this.mcp.tools().some(t=>t.function.name==='recover_position')){
      try{this.recoveryNote=await this.gameAction('recover_position',{},'先挪出卡住的位置，再重新找路线。');}catch(e){this.controller.signal.throwIfAborted();this.recoveryNote={error:e.code||e.message};}
    }else this.recoveryNote={message:'请依据当前状态换一个实际可推进的任务，不能只说话或持续等待。'};
  }
  async gameAction(name, args, say, reaction) {
    if (this.mcp.execute) {
      const spoken=!this.mcp.isReadOnly?.(name)?actionCommentary(name,say):'';
      const response=shortCommentary(reaction);
      const reactionKey=reactionEventKey(this.feedback,this.currentSnapshot);
      if(spoken && response && reactionAllowed(this.feedback,this.currentSnapshot) && this.reactedEvent!==reactionKey) {
        this.store.sayReaction(response,reactionKey);
        this.reactedEvent=reactionKey;
      }
      this.store.say(spoken,name);
      this.store.event("游戏动作：" + name);
      const started=Date.now();
      let result;
      try { result = await this.mcp.execute(name, args, {
        signal: this.controller.signal,
        remainingMs: () => this.store.remaining(),
      }); }
      catch(e){const cancelled=this.controller.signal.aborted||e.name==='AbortError';if(spoken){if(!cancelled)this.store.say(failureCommentary({message:e.message}),name);this.lastAction={id:randomUUID(),name,before:this.currentSnapshot,result:{state:cancelled?'cancelled':'failed',result:e.message,evidence:e.gameEvidence},at:Date.now()};}this.store.event('游戏结果：'+name+(cancelled?' cancelled':' failed'));throw e;}
      finally {this.store.performance.actionMs=Date.now()-started;this.store.performance.action=name;}
      if(spoken)this.lastAction={id:randomUUID(),name,before:this.currentSnapshot,result,at:Date.now()};
      if(result.state==='failed'&&spoken)this.store.say(failureCommentary(result),name);
      if (name === "goal_add" && args.activate && args.title)
        this.store.goal = String(args.title).slice(0, 100);
      this.store.event("游戏结果：" + name + " " + result.state);
      return result;
    }
    const spec = this.mcp.catalogue.find((x) => x.name === name);
    if (!spec) throw new Error("未开放该游戏工具。");
    const input = { ...args };
    if (spec.inputSchema.properties?.submission_id && !input.submission_id)
      input.submission_id = randomUUID();
    if (spec.inputSchema.properties?.wait_timeout_ms)
      input.wait_timeout_ms = 1000;
    if (spec.inputSchema.properties?.response_format)
      input.response_format = "json";
    const started = Date.now();
    let result = unwrap(await this.mcp.call(name, input));
    this.store.event("游戏动作：" + name);
    while (
      ["pending", "accepted"].includes(result.state) &&
      !this.controller.signal.aborted
    ) {
      if (this.store.remaining() <= 0 || Date.now() - started > 300000) {
        await this.mcp.cancel();
        break;
      }
      result = unwrap(
        await this.mcp.call("wait_for_action", {
          action_id: result.actionId,
          timeout_ms: 5000,
          rationale: "等待真实动作结果，避免把接受请求当作完成。",
          response_format: "json",
        }),
      );
    }
    return result;
  }
}
