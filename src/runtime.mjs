import { Store } from "./state.mjs";
import { Minecraft } from "./minecraft.mjs";

import { Agent } from "./agent.mjs";
import { fetchBalance } from "./deepseek.mjs";

import { NativeClient } from "./native-client.mjs";
import { ClientActions } from "./client-actions.mjs";
import { VisionDiagnostics } from "./vision.mjs";
import path from "node:path";
import { DATA } from "./config.mjs";
export class Runtime {
  constructor() {
    this.store = new Store();
    this.minecraft = new Minecraft(this.store);
    this.legacy = false;
    this.observer = new NativeClient({onDisconnect: () => {
      if (this.store.status === "running") void this.pause("game_offline", "游戏客户端已退出，已保存暂停。");
    }});
    this.mcp = new ClientActions({ store: this.store, nativeClient: this.observer });
    this.vision = this.legacy
      ? null
      : new VisionDiagnostics({
          capture: ({ signal }) =>
            this.mcp.bridge.call("fish.screenshot", {}, { signal }),
          stateFile: path.join(DATA, "vision-rate.json"),
          onChange: (summary) => {
            this.store.diagnostics = summary;
          },
        });
    this.agent = new Agent(this);
    this.busy = false;
    this.lifecycle = 0;
    this.timer = setInterval(() => {
      if (this.store.status === "running" && this.store.remaining() <= 0)
        void this.pause("duration", "本场时长已到，已保存并暂停游戏。");
    }, 1000);
    this.timer.unref();
  }
  observe(value) {
    const body = value?.response?.data || value?.output || value;
    const situation =
      body?.result?.situation || body?.situation || body?.status || body;
    this.store.health =
      situation.vitals?.health ?? situation.health ?? this.store.health;
    this.store.hunger =
      situation.vitals?.food ??
      situation.hunger ??
      situation.food ??
      this.store.hunger;
    this.store.position = situation.position ?? this.store.position;
    this.store.spatial = situation.spatial ?? null;
    this.store.inventory =
      situation.inventory?.stacks ??
      situation.inventory ??
      this.store.inventory;
  }
  async refreshBalance() {
    try {
      this.store.balance = await fetchBalance();
      this.store.balanceError = "";
      return this.store.balance;
    } catch (e) {
      this.store.balanceError = e.message;
      throw e;
    }
  }
  async prepare() {
    if (this.busy) throw new Error("正在执行另一个操作。");
    if (["running", "pausing"].includes(this.store.status))
      throw new Error("请先暂停正在进行的冒险。");
    this.busy = true;
    const epoch = this.lifecycle;
    this.store.status = "preparing";
    this.store.reason = "正在准备独立游戏世界和工具。";
    this.prepareTask = (async () => {
      try {
        await this.minecraft.start();
        await this.mcp.connect();
        this.observe(await this.mcp.status());
        this.minecraft.command("function fish:effects");
        await this.mcp.freeze?.();
        await this.minecraft.freeze();
        if (epoch === this.lifecycle) {
          this.store.status = "ready";
          this.store.reason = "准备完成，世界已暂停；点击开始冒险。";
        }
        await this.refreshBalance();
        this.store.save();
      } catch (e) {
        this.store.status = "error";
        this.store.reason = e.message;
        await this.minecraft.freeze().catch(() => {});
        await this.mcp.close();
        this.store.event(e.message);
        throw e;
      } finally {
        this.busy = false;
      }
    })();
    try {
      await this.prepareTask;
    } finally {
      this.prepareTask = null;
    }
  }
  async start(options = {}) {
    if (this.startTask) return this.startTask;
    this.startTask = this.startInner(options);
    try {
      await this.startTask;
    } catch (e) {
      await this.pause("start_failed", e.message);
      throw e;
    } finally {
      this.startTask = null;
    }
  }
  async startInner(options = {}) {
    if (this.busy) throw new Error("正在执行另一个操作。");
    if (this.store.status === "running") return;
    const epoch = this.lifecycle;
    if (this.agent.task) await this.agent.task;
    if (this.pauseTask) await this.pauseTask;
    if (!this.mcp.client) await this.prepare();
    await this.refreshBalance();
    if (epoch !== this.lifecycle) return;
    if (this.store.balance.micros < 1e6)
      throw new Error("人民币总余额低于 1 元，请充值后再开始。");
    if (this.store.remaining() <= 0) this.store.runningMs = 0;
    if (epoch !== this.lifecycle) return;
    this.minecraft.resume();
    await this.mcp.resume?.();
    if (epoch !== this.lifecycle) {
      await this.mcp.freeze?.().catch(() => {});
      await this.minecraft.freeze().catch(() => {});
      return;
    }
    this.store.status = "running";
    this.store.reason = "";
    this.store.startClock();
    this.store.event("开始自主冒险。");
    void this.agent.begin(options);
  }
  async pause(code = "operator", message = "已暂停整局，世界已保存。") {
    if (this.pauseTask) return this.pauseTask;
    this.lifecycle++;
    if (this.store.status === "paused" || this.store.status === "stopped")
      return;
    this.pauseTask = (async () => {
      this.store.status = "pausing";
      this.agent.abort();
      this.vision?.clear();
      this.store.stopClock();
      if (this.prepareTask) await this.prepareTask.catch(() => {});
      await this.mcp.cancel();
      await this.mcp.freeze?.().catch(() => {});
      await this.minecraft.freeze().catch(() => {});
      await this.mcp.close();
      this.store.status = "paused";
      this.store.reason = message;
      this.store.event(message);
      this.store.save();
    })();
    try {
      await this.pauseTask;
    } finally {
      this.pauseTask = null;
    }
  }
  async stop() {
    if (this.busy) throw new Error("正在准备环境，请稍后停止。");
    this.busy = true;
    try {
      await this.pause();
      await this.observer.close();
      await this.mcp.close();
      await this.minecraft.stop();
      this.store.status = "stopped";
      this.store.reason = "游戏已保存，运行进程已停止。";
      this.store.stopClock();
      this.store.runningMs = 0;
      this.store.event(this.store.reason);
    } finally {
      this.busy = false;
    }
  }
  async close() {
    clearInterval(this.timer);
    this.lifecycle++;
    this.vision?.clear();
    if (this.prepareTask) {
      await this.observer.close().catch(() => {});
      await this.minecraft.stop().catch(() => {});
      await this.prepareTask.catch(() => {});
    }
    await this.stop();
  }
}
