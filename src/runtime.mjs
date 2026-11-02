import { Store } from "./state.mjs";
import { Minecraft } from "./minecraft.mjs";

import { Agent } from "./agent.mjs";
import { fetchBalance } from "./deepseek.mjs";

import { NativeClient } from "./native-client.mjs";
import { ClientActions } from "./client-actions.mjs";
import { VisionDiagnostics } from "./vision.mjs";
import path from "node:path";
import { DATA,saveSettings } from "./config.mjs";
import {prepareEnvironment,inspectEnvironment} from './environment.mjs';
import {checkGamePorts} from './ports.mjs';
import {SetupError} from './setup-state.mjs';
import {createWorld,listWorlds,selectWorldInfo,worldInfo,saveWorldSession,readWorldSession,trashWorld} from './worlds.mjs';
import {gameWorldName} from './versions.mjs';
export class Runtime {
  constructor() {
    this.store = new Store();
    this.minecraft = new Minecraft(this.store,{onDisconnect:()=>this.gameDisconnected('SERVER_CLOSED','游戏服务器已退出')});
    this.legacy = false;
    this.observer = new NativeClient({onDisconnect:()=>this.gameDisconnected('CLIENT_CLOSED','游戏窗口已关闭')});
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
    this.environmentPrepare=prepareEnvironment;
    this.portCheck=checkGamePorts;
    this.busy = false;
    this.lifecycle = 0;
    this.timer = setInterval(() => {
      if (this.store.status === "running" && this.store.remaining() <= 0)
        void this.pause("duration", "本场时长已到，已保存并暂停游戏。");
    }, 1000);
    this.timer.unref();
  }
  gameDisconnected(code,title) {
    if (!["running","ready"].includes(this.store.status)) return;
    this.store.connected=false;
    this.mcp.bridge=null;
    this.store.setup.fail(new SetupError(code,'bridge',title,'','点击准备游戏重新启动；已有存档会保留。'));
    void this.pause('game_offline',title+'，已暂停。').then(()=>{this.store.status='error';this.store.save();});
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
  async prepare({requireModel=true}={}) {
    if (this.busy) throw new Error("正在执行另一个操作。");
    if (["running", "pausing"].includes(this.store.status))
      throw new Error("请先暂停正在进行的冒险。");
    this.busy = true;
    const epoch = this.lifecycle;
    this.store.status = "preparing";
    this.store.setup.begin();this.store.setup.update('check',{message:'正在检查游戏版本与账户'});
    this.store.reason = "正在准备独立游戏世界和工具。";
    this.preparationController=new AbortController();
    this.prepareTask = (async () => {
      try {
        if(requireModel){
          this.store.reason='正在核对 DSH 的 DeepSeek API 配置与余额。';
          const balance=await this.refreshBalance();
          if(!balance.available||balance.micros<1000000)throw new Error('DeepSeek 账户不可用或余额不足 ¥1，请在 DSH 配置官方API凭据并充值。');
        }
        await this.observer.close();
        await this.mcp.close();
        if(this.minecraft.child?.exitCode===null)await this.minecraft.stop();
        await this.portCheck(this.store.settings);
        const prepared=await this.environmentPrepare(this.store.settings,{signal:this.preparationController.signal,onProgress:(step,detail)=>{
          this.store.setup.update(step,detail);this.store.reason=detail.message||'正在准备环境';
        },onPhase:phase=>{
          const labels={'control-dependencies':'正在补齐控制台依赖','python-git':'正在检查 Python 和 Git','java21':'正在检查或下载便携 Java21','tools-ready':'基础依赖已就绪','game-dependencies':'正在准备游戏环境','game-server':'正在准备独立游戏服务器','game-client':'正在复用已有游戏本体并补齐运行库','mcp-source':'正在获取固定版本 MCP','fabric-mods':'正在安装 Fabric 和动作辅助模组','mcp-runtime':'正在准备 MCP 运行依赖','java-build':'正在构建原生游戏辅助模组'};
          this.store.reason=labels[phase]||'正在准备环境';
        }});
        if(prepared?.version){
          if((this.store.settings.resolvedVersion||'1.21.4')!==prepared.version){this.store.goal='准备踏上击杀末影龙的旅程';this.store.runningMs=0;this.store.commentary=null;this.store.reaction=null;}
          this.store.settings.resolvedVersion=prepared.version;if(this.store.persist)saveSettings(this.store.settings);this.store.save();
        }
        this.preparationController.signal.throwIfAborted();
        this.store.setup.update('launch',{message:'首次加载可能需要一分钟，请保持游戏窗口打开'});
        await this.portCheck(this.store.settings);
        this.store.reason='正在启动并连接 Minecraft；完成后保存冻结。';
        await this.minecraft.start({signal:this.preparationController.signal});
        this.store.setup.update('bridge',{message:'正在确认真实玩家与游戏工具'});
        await this.mcp.connect({signal:this.preparationController.signal});
        this.observe(await this.mcp.status());
        this.minecraft.command("function fish:effects");
        this.store.setup.update('freeze',{message:'保存冻结世界，准备完成后由你开始'});
        await this.mcp.freeze?.();
        await this.minecraft.freeze();
        if (epoch === this.lifecycle) {
          this.store.status = "ready";
          this.store.reason = "准备完成，世界已暂停；点击开始冒险。";
        }
        this.store.setup.finish();
        this.store.save();
      } catch (e) {
        this.store.setup.fail(e);
        this.store.status = "error";
        this.store.reason = e.message;
        await this.minecraft.freeze().catch(() => {});
        await this.mcp.close();
        this.store.event(e.message+(e.code?.startsWith('FABRIC_')&&e.detail?'：'+e.detail:''));
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
  async checkEnvironment(){const report=await inspectEnvironment(this.store.settings);this.store.environment=report;return report;}
  worldList(){return {worlds:listWorlds(this.store.settings),selected:gameWorldName(this.store.settings)};}
  assertWorldChange(){
    if(this.busy||this.startTask||this.pauseTask||this.agent.task&&this.store.status==='running'||this.minecraft.child?.exitCode===null||this.observer.running())throw Error('请先点“保存并停止”，再新建或切换世界。');
  }
  selectWorld(id,version,{savePrevious=true}={}){
    this.assertWorldChange();
    const info=selectWorldInfo(id,version,this.store.settings);
    if(this.store.persist&&savePrevious)saveWorldSession(this.store.settings,this.store);
    this.store.settings={...this.store.settings,world:info.id,minecraftVersion:info.version,resolvedVersion:info.version};
    if(this.store.persist)saveSettings(this.store.settings);
    this.agent.load();this.agent.seenDiscoveries.clear();this.agent.currentSnapshot=null;
    const saved=readWorldSession(this.store.settings);
    Object.assign(this.store,{status:'stopped',goal:saved.goal||'准备踏上击杀末影龙的旅程',runningMs:Number(saved.runningMs)||0,startedAt:null,health:null,hunger:null,position:null,inventory:[],deaths:Number(saved.deaths)||0,usage:saved.usage||{prompt:0,completion:0,cached:0},spatial:null,connected:false,tools:0,calls:0,lastRequest:null,performance:{},commentary:null,reaction:null,reply:null});
    this.store.setup.reset();this.store.environment=null;this.vision?.clear();
    this.store.reason='已选择“'+info.name+'”，点击准备游戏'+(info.generated?'继续存档。':'生成新地图。');
    this.store.event(this.store.reason);return info;
  }
  createWorld(input){this.assertWorldChange();const row=createWorld(input);return this.selectWorld(row.id,row.version);}
  async deleteWorld(id,version){
    this.assertWorldChange();const info=selectWorldInfo(id,version,this.store.settings);
    const current=id===this.store.settings.world&&version===(this.store.settings.resolvedVersion||'1.21.4');
    const remaining=listWorlds(this.store.settings).filter(w=>w.id!==id||w.version!==version);
    this.busy=true;
    try{await trashWorld(info);}finally{this.busy=false;}
    if(current){const fallback=remaining[0]||{id:'rehearsal',version};if(!remaining.length)this.store.settings={...this.store.settings,world:fallback.id,resolvedVersion:fallback.version};this.selectWorld(fallback.id,fallback.version,{savePrevious:false});}
    this.store.reason='“'+info.name+'”及其AI记忆、寻路缓存已移到回收站。';this.store.event(this.store.reason);
  }
  configure(patch){
    // Worlds switch through their own lifecycle, so a settings save cannot silently redirect a running game or memory.
    if(patch.world!==undefined&&patch.world!==this.store.settings.world)throw Error('请使用世界列表中的“切换世界”。');
    const info=worldInfo(this.store.settings);
    if(info.id.startsWith('world-')&&patch.minecraftVersion!==undefined&&patch.minecraftVersion!==info.version)throw Error('这个存档使用 Java '+info.version+'；其他版本请新建一个世界。');
    this.store.configure(patch);
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
    this.preparationController?.abort();
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
    this.preparationController?.abort();
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
