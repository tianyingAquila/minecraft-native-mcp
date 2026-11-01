import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ROOT, DATA } from "./config.mjs";
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
import {withCommentary,shortCommentary,actionCommentary,failureCommentary,actionFeedback,reactionAllowed} from './commentary.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const localTools = [
  {
    type: "function",
    function: {
      name: "set_goal",
      description:
        "在重要目标/地点/资源改变、死亡或切换维度后更新目标和已确认的长期游戏记忆；没有重要变化时不重复调用。notes会完整替换旧摘要，须保留仍有效的重要事实，不要只提交增量。",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", maxLength: 100 },
          notes: { type: "string", maxLength: 2400, description: "完整更新后的长期记忆摘要；保留有效地点/事实，去掉过期状态与未经确认的推测。" },
        },
        required: ["goal", "notes"],
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
  }
  get sessionFile() {
    const version=this.store.settings.resolvedVersion||'1.21.4';
    return path.join(DATA, "agent-" + this.store.settings.world+(version==='1.21.4'?'':'-'+version) + ".json");
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
      const tools = [
        ...this.mcp.tools().map(t=>withCommentary(t,this.mcp.isReadOnly?.(t.function.name))),
        ...localTools,
        ...(this.runtime.vision && visionAvailable?.available!==false ? [VISION_TOOL] : []),
      ];
      const current =
        "当前真实游戏状态：\n" +
        encodeObservation(snapshot) +
        '\n上一主要动作的真实反馈：'+JSON.stringify(this.feedback)+'\n当前是否适合轻量反应：'+reactionAllowed(this.feedback,snapshot)+
        "\n执行反馈（重复失败时必须先解决原因，不要重复开关同一容器）：" + JSON.stringify(this.progress.advice()) +
        "\n已保存游戏记忆：" +
        this.notes + '\n截图当前可用情况：'+JSON.stringify(visionAvailable||{available:false});
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
        tool_choice: "auto",
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
        if (this.emptyRounds >= 4)
          throw new ServiceError(
            "NO_ACTION",
            "模型连续没有选择游戏动作，已暂停等待检查。",
          );
      } else this.emptyRounds = 0;
      let needsObservation = false,
        majorActionTaken = false;
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
            if (!readOnly && name !== "inspect_game_screen")
              majorActionTaken = true;
          }
        } catch (e) {
          output = {
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
      if (this.progress.shouldPause() || this.visionUnavailableRequests>=3) {
        await this.runtime.pause('game_stuck','同一状态下反复失败或长时间没有实际进展，已保存暂停，请检查游戏执行情况。');
        return;
      }
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
      this.store.goal = String(args.goal || "").slice(0, 100);
      this.notes = String(args.notes || "").slice(0, 5000);
      this.save();
      return { saved: true };
    }
    return this.gameAction(name, args, say, reaction);
  }
  async gameAction(name, args, say, reaction) {
    if (this.mcp.execute) {
      const spoken=!this.mcp.isReadOnly?.(name)?actionCommentary(name,say):'';
      const response=shortCommentary(reaction);
      if(spoken && response && reactionAllowed(this.feedback,this.currentSnapshot) && this.reactedEvent!==this.feedback.id) {
        this.store.sayReaction(response,this.feedback.id);
        this.reactedEvent=this.feedback.id;
      }
      this.store.say(spoken,name);
      this.store.event("游戏动作：" + name);
      const started=Date.now();
      let result;
      try { result = await this.mcp.execute(name, args, {
        signal: this.controller.signal,
        remainingMs: () => this.store.remaining(),
      }); }
      catch(e){if(spoken){this.store.say(failureCommentary({message:e.message}),name);this.lastAction={id:randomUUID(),name,before:this.currentSnapshot,result:{state:'failed',result:e.message,evidence:e.gameEvidence},at:Date.now()};}this.store.event('游戏结果：'+name+' failed');throw e;}
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
