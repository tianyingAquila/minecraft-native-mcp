import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { ROOT, DATA } from "./config.mjs";
import { ServiceError } from "./deepseek.mjs";
import { summarizeClient } from "./client-state.mjs";
import { normalizeToolArgs } from './tool-args.mjs';
import { mineBlock } from './mining.mjs';
import { digTunnel } from './tunnel.mjs';
import { spatialOverview } from './spatial.mjs';
import {gameWorldName,readPrepared} from './versions.mjs';
import {describeContainer,loadCookingIndex} from './container-state.mjs';
import {DiscoveryTracker} from './discovery.mjs';
import {fightEntity} from './combat.mjs';
import {recoverPosition} from './recovery.mjs';
const ALLOWED = new Set([
  "agent_brief",
  "observe",
  "map_view",
  "remember",
  "recall",
  "memory_update",
  "memory_verify",
  "goal_add",
  "goal_update",
  "goal_list",
  "plan_craft",
  "get_recipes",
  "explore_next",
  "travel_to",
  "explore",
  "collect_blocks",
  "craft_item",
  "open_container",
  "container_transfer",
  "close_container",
]);
const JOBS = new Set(["travel_to", "explore", "collect_blocks", "craft_item"]);
const READ = new Set([
  'inspect_space',
  "get_game_state",
  "get_inventory",
  "agent_brief",
  "observe",
  "map_view",
  "remember",
  "recall",
  "memory_update",
  "memory_verify",
  "goal_add",
  "goal_update",
  "goal_list",
  "plan_craft",
  "get_recipes",
  "explore_next",
  "inspect_blocks",
  "inspect_entities",
  "get_container",
]);
const schema = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const xyz = {
  x: { type: "number" },
  y: { type: "number" },
  z: { type: "number" },
};
const CUSTOM = [
  {name:'inspect_space',description:'刷新以角色为中心16格、上下12格的空间简报，并读取北上东右的多高度ASCII切片。平时每轮已自动给空间摘要；遇到复杂洞穴、分岔、跨层或不清楚如何绕行时按需调用，非截图、不转头。仅射线可见表面与保守地面连通估计，?不等于墙；候选通路不保证可直接走到。',inputSchema:schema()},
  {name:'dig_tunnel',description:'连续开凿一小段1格宽、2格高矿道并实际走入，每次1–12格、最多90秒。direction为绝对方位north/south/east/west；slope为level水平或down每格下降一级。模型决定方向、长度与继续时机；程序逐格真实检查、挖掘和前进，不逐格请求模型。遇到水/岩浆、敌人、受伤、断崖、落沙、工具将坏、卡住或未加载时提前停止，结果包含实际推进格数和中断原因。不能用于游泳、垂直井、向上挖或自动找钻石；矿石批量采集用collect_blocks，单格精确清障用mine_block。',inputSchema:schema({direction:{type:'string',enum:['north','south','east','west']},length:{type:'integer',minimum:1,maximum:12},slope:{type:'string',enum:['level','down']}},['direction','length'])},
  {name:'place_block_at',description:'在指定空位放置手中的方块；x/y/z是新方块最终占据的空气格，不是承托方块。程序会寻找真实相邻承托面并正常潜行放置，受距离和遮挡限制。先equip_item拿好方块。',inputSchema:schema(xyz,['x','y','z'])},
  {name:'mine_block',description:'挖开指定的单个已观察方块，例如挡路石墙。正常生存挖掘、工具和距离限制生效，不保证掉落已捡到；不要向未观察坐标盲挖。',inputSchema:schema(xyz,['x','y','z'])},
  {name:'wait_for_game',description:'只在确有短时熔炼/冷却等需要时等待1–5秒，危险时提前结束。不能连续站着等天亮或用等待逃避任务；自主模式连续两次后必须选择实际任务。',inputSchema:schema({seconds:{type:'integer',minimum:1,maximum:5}},['seconds'])},
  {name:'recover_position',description:'卡在原地时短距离脱困：先核验附近两格的身体空间、支撑与危险，再移动到可行位置。不是随机走动或探索路线；遇敌、危险地面或没有已核实出口时交回重新决策。',inputSchema:schema()},
  {name:'drop_items',description:'丢出指定背包格的少量已有物品。先核对格子和物品；观众建议由你判断是否轻松合理，不丢贵重或主线必需品。',inputSchema:schema({slot:{type:'integer',minimum:0,maximum:35},count:{type:'integer',minimum:1,maximum:8}},['slot','count'])},
  {
    name: "get_game_state",
    description: "读取当前真实血量、饱食度、位置、背包与附近生物。",
    inputSchema: schema(),
  },
  {
    name: "get_inventory",
    description: "读取完整非空背包格子、快捷栏、盔甲和副手。",
    inputSchema: schema(),
  },
  {
    name: "inspect_blocks",
    description: "按已加载位置精确读取少量方块，不改变世界。",
    inputSchema: schema(
      {
        positions: {
          type: "array",
          minItems: 1,
          maxItems: 32,
          items: schema(xyz, ["x", "y", "z"]),
        },
      },
      ["positions"],
    ),
  },
  {
    name: "get_container",
    description: "读取当前窗口类型、实际格子/用途/空槽、光标物品、原生取放条件与可用进度；支持工作台、熔炉、酿造台、铁砧、锻造台、交易等已知布局。slots是物品，emptySlots是空格，slotRules按相同原生条件分组；窗口menuSlot不同于背包inventorySlot。未知布局明确标未知。按blockers处理阻塞，不假设已产出或按钮已操作。",
    inputSchema: schema(),
  },
  {
    name: "inspect_entities",
    description:
      "按需读取已加载实体，包括末影之眼、投射物、水晶和龙的位置；不存在不等于已死亡。",
    inputSchema: schema({
      radius: { type: "integer", minimum: 1, maximum: 128 },
    }),
  },
  {
    name: "equip_item",
    description: "将指定背包格物品装备到手中或穿上防具。只使用实际已有物品。",
    inputSchema: schema(
      {
        slot: { type: "integer", minimum: 0, maximum: 35 },
        armor: { type: "boolean" },
      },
      ["slot"],
    ),
  },
  {
    name: "eat_food",
    description: "从背包实际进食，饱食度已满时不消耗食物。",
    inputSchema: schema(),
  },
  {
    name:'fight_entity',
    description:'选择一个已观察目标和背包中的近战武器，程序连续追踪接近、按真实冷却挥击，最多60秒；不在每一步重新请求模型。适合普通动物、僵尸、骷髅。weapon可为auto、held或已有剑/斧/重锤的物品ID。低血、爆炸威胁、追不上或失去目标会返回实际进展，不自动攻击其他生物；消失不等于击杀。弓箭/苦力怕等需其他战术。',
    inputSchema:schema({uuid:{type:'string'},weapon:{type:'string'},seconds:{type:'integer',minimum:1,maximum:60}},['uuid']),
  },
  {
    name: "attack_entity",
    description: "手动原地攻击指定实体，不自动追击；只在已经进入真实近战范围时使用。移动目标或需要靠近时优先fight_entity。真实冷却、距离、生命和超时限制生效。",
    inputSchema: schema(
      {
        uuid: { type: "string" },
        seconds: { type: "integer", minimum: 1, maximum: 20 },
      },
      ["uuid"],
    ),
  },
  {
    name: "use_block",
    description: "靠近后对指定方块进行原生右键交互，用于床、门等。",
    inputSchema: schema(xyz, ["x", "y", "z"]),
  },
  {
    name: "use_item",
    description:
      "使用当前手中物品，可短暂举盾、放水、点火、投掷末影之眼或蓄力射箭。",
    inputSchema: schema(
      { ticks: { type: "integer", minimum: 1, maximum: 100 } },
      ["ticks"],
    ),
  },
  {
    name: "place_block",
    description: "使用手中已有方块，指定相邻承托方块和放置面。",
    inputSchema: schema(
      {
        ...xyz,
        face: {
          type: "string",
          enum: ["up", "down", "north", "south", "east", "west"],
        },
      },
      ["x", "y", "z", "face"],
    ),
  },
  {
    name: "look_at",
    description: "朝向一个实际游戏位置。",
    inputSchema: schema(xyz, ["x", "y", "z"]),
  },
  {
    name: "close_game_screen",
    description: "关闭游戏内菜单、容器或在死亡界面复活，不操作系统界面。",
    inputSchema: schema(),
  },
];
export class ClientActions {
  constructor({ bridge = null, store = null, nativeClient = null } = {}) {
    this.kind = "native";
    this.bridge = bridge;
    this.store = store;
    this.nativeClient = nativeClient;
    this.client = null;
    this.catalogue = [];
    this.active = null;
    this.execution = new AsyncLocalStorage();
    this.discoveries=new DiscoveryTracker();
  }
  async connect({signal}={}) {
    if (this.client) return;
    this.nativeContainerCapability=undefined;
    if (this.nativeClient)
      this.bridge = await this.nativeClient.start(this.store.settings,{signal});
    const identity = await this.bridge.call("session.info");
    if (identity.player !== "DeepSeekFish")
      throw new ServiceError(
        "GAME_IDENTITY",
        "当前游戏玩家不是 DeepSeekFish。",
      );
    if(this.worldId&&this.worldId!==identity.worldId)this.discoveries=new DiscoveryTracker();
    this.worldId = identity.worldId;
    this.cookingIndex=loadCookingIndex(ROOT,this.store?.settings.resolvedVersion||readPrepared()?.version);
    await this.bridge.call("fish.navigationStatus");
    const base = path.join(ROOT, "bundled/mcpfabric");
    const [{ AgentRuntime }, { AGENT_TOOLS, AgentSession }] = await Promise.all(
      ["runtime", "tools"].map(
        (name) =>
          import(
            pathToFileURL(path.join(base, "dist/agent", name + ".js")).href
          ),
      ),
    );
    const z = createRequire(path.join(base, "package.json"))("zod").z;
    this.definitions = new Map(
      AGENT_TOOLS.filter((d) => ALLOWED.has(d.name)).map((d) => [
        d.name,
        { ...d, validator: z.object(d.inputSchema).strict() },
      ]),
    );
    this.catalogue = [...this.definitions.values()]
      .map((d) => ({
        name: d.name,
        description: d.description,
        inputSchema: z.toJSONSchema(d.validator),
      }))
      .concat(CUSTOM);
    for(const tool of this.catalogue){
      if(['travel_to','explore','collect_blocks','dig_tunnel'].includes(tool.name))tool.description+=' 途中出现本次尚未见过的重要环境线索时可提前中断并返回discovery，由你评估探索、绕开或记位置，不代表原任务完成。';
      if(tool.name==='container_transfer')tool.description+=' 返回实际移动后的结构化container格子与熔炉blockers。direction=take取出指定物品；输出槽阻塞应取出旧产物，补煤无效。';
      if(tool.name==='close_container')tool.description='关闭当前实际打开的容器；返回关闭后的真实界面状态。已经关闭时会返回SCREEN_ALREADY_CLOSED，不要重复关闭，更不会因此让熔炉开始烧。';
    }
    const proxy = { call: (method, args = {}) => this.upstreamCall(method, args) };
    fs.mkdirSync(DATA, { recursive: true });
    this.rt = new AgentRuntime(proxy, {
      dbPath: path.join(DATA, "client-agent-" + gameWorldName(this.store.settings) + ".sqlite"),
    });
    this.session = new AgentSession();
    this.client = true;
    if (this.store) {
      this.store.connected = true;
      this.store.tools = this.catalogue.length;
      this.store.event("真正玩家客户端已连接，开放 " + this.catalogue.length + " 个游戏工具。");
    }
  }
  async upstreamCall(method, args = {}) {
        const signal = this.execution.getStore();
        signal?.throwIfAborted();
        if (method === 'container.state') return this.containerState(signal);
        if (method === "nav.pathTo") {
          const screen=await this.bridge.call('screen.get',{}, {signal});
          if(['container','pause'].includes(screen.screen))await this.bridge.call('screen.close',{}, {signal});
          await this.bridge.call("fish.navigate", {
            x: args.x,
            y: args.y,
            z: args.z,
            reach: Math.max(0.3,Math.min(8,args.reachRadius ?? 2)),
          }, {signal});
          return { pathLength: 0 };
        }
        if (method === "nav.status")
          return this.bridge.call("fish.navigationStatus");
        if (method === "nav.stop") return this.bridge.call("fish.cancel");
        if (["container.open", "interact.placeBlock", "interact.breakBlock"].includes(method))
          await this.bridge.call("fish.checkBlock", args, {signal});
        if (method === "interact.breakBlock")
          await this.bridge.call("fish.cancel");
        signal?.throwIfAborted();
        const value = await this.bridge.call(method, args, {signal});
        if (method === 'container.open') this.menuOpenedAt = Date.now();
        if (method === 'container.close') this.menuOpenedAt = null;
        return value;
  }
  async containerState(signal) {
    const read=async()=>{
      if(this.nativeContainerCapability!==false){
        try{const result=await this.bridge.call('fish.containerState',{}, {signal});if(typeof result.open==='boolean')return result;this.nativeContainerCapability=false;}
        catch(error){if(error.code!=='GAME_unknown_method')throw error;this.nativeContainerCapability=false;}
      }
      return this.bridge.call('container.state',{}, {signal});
    };
    let state = await read();
    if (this.menuOpenedAt == null) return describeContainer(state,this.cookingIndex);
    const openedAt = this.menuOpenedAt;
    // An open menu can precede its item packets. Never treat that first empty frame as contents.
    let previous = '', stable = 0;
    while (Date.now()-openedAt < 1500) {
      const value = JSON.stringify([state.open,state.containerId,state.slots]);
      stable = value === previous ? stable+1 : 0;
      previous = value;
      const age = Date.now()-openedAt;
      if (state.open && stable >= 1 && age >= (state.slots?.length ? 200 : 750)) break;
      await delay(100,undefined,{signal});
      state = await read();
    }
    this.menuOpenedAt = null;
    return describeContainer(state,this.cookingIndex);
  }
  async assertReady() {
    if (this.nativeClient && !this.nativeClient.running())
      throw new ServiceError("GAME_OFFLINE", "真正玩家客户端已退出。");
    const [identity,self]=await Promise.all([this.bridge.call('session.info'),this.bridge.call('player.getState')]);
    if(identity.player!=='DeepSeekFish'||identity.worldId!==this.worldId||self.gameMode!=='survival')throw new ServiceError('GAME_IDENTITY','游戏玩家、世界或模式已变化，停止操作。');
  }
  tools() {
    return this.catalogue.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }
  isReadOnly(name) {
    return READ.has(name);
  }
  normalizeArgs(name,args) {
    return normalizeToolArgs(args,this.catalogue.find(t=>t.name===name)?.inputSchema);
  }
  async status() {
    const identity = await this.bridge.call("session.info");
    if (identity.player !== "DeepSeekFish" || identity.worldId !== this.worldId)
      throw new ServiceError(
        "GAME_IDENTITY",
        "游戏玩家或世界已经变化，已停止操作。",
      );
    const [self, inventory, nearby] = await Promise.all([
      this.bridge.call("player.getState"),
      this.bridge.call("player.getInventory"),
      this.bridge.call("perception.entities", { radius: 32, kinds: [] }),
    ]);
    if (self.gameMode !== "survival")
      throw new ServiceError("GAME_MODE", "游戏未处于生存模式，已停止操作。");
    const summary = summarizeClient(
      self,
      inventory,
      nearby.entities || [],
      this.active
        ? {
            owner: "foreground",
            activeAction: {
              action: this.active.name,
              startedAt: this.active.at,
            },
          }
        : { owner: "idle", activeAction: null },
    );
    const menu = await this.containerState();
    summary.result.situation.openMenu = menu.open||menu.screenVisible ? menu : null;
    summary.result.situation.context = await this.bridge.call('fish.context');
    const spatial=await this.spatialStatus(false);
    // Keep spatial information early in the observation rather than behind long entity lists.
    summary.result.situation={spatial,...summary.result.situation};
    if(menu.open && this.rt?.openContainer) summary.result.situation.openMenu.position = this.rt.openContainer.pos;
    return summary;
  }
  async spatialStatus(detail=false,signal) {
    try {
      const scan=await this.bridge.call('fish.spatialScan',{}, {signal});
      const started=performance.now(),overview=spatialOverview(scan,{detail});
      this.discoveries.observe(overview.environment,overview.origin);
      overview.environment.updates=this.discoveries.since();
      if(this.store)this.store.performance.spatial={scanMs:scan.scanMs,summaryMs:Math.round(performance.now()-started),chars:JSON.stringify(overview).length};
      return overview;
    } catch(error) {
      signal?.throwIfAborted();
      return {available:false,reason:'本轮空间测量不可用；不要推断为四周封闭，按需查具体方块或截图。'};
    }
  }
  async discoveryStatus(since=Infinity,signal){
    const overview=await this.spatialStatus(false,signal);
    return {sequence:this.discoveries.sequence,environment:overview.environment,updates:this.discoveries.since(since)};
  }
  async execute(name, args = {}, { signal, remainingMs = () => 300000 } = {}) {
    args=this.normalizeArgs(name,args);
    if (this.active && !this.isReadOnly(name))
      throw new ServiceError("GAME_BUSY", "GAME_BUSY：已有任务正在控制角色。");
    if (!this.client)
      throw new ServiceError("GAME_OFFLINE", "真正玩家客户端尚未连接。");
    if (!this.catalogue.some((t) => t.name === name))
      throw new ServiceError("GAME_TOOL", "游戏工具未开放。");
    const controller = new AbortController();
    const combined = AbortSignal.any([
      controller.signal,
      ...(signal ? [signal] : []),
      AbortSignal.timeout(Math.max(1, Math.min(300000, remainingMs()))),
    ]);
    const major = !this.isReadOnly(name);
    const observeAction = major && !['look_at','close_container','close_game_screen'].includes(name);
    let completed;
    const done = new Promise((resolve) => {
      completed = resolve;
    });
    if (major)
      this.active = {
        id: Date.now(),
        name,
        at: new Date().toISOString(),
        controller,
        done,
      };
    const stop = () => {
      void this.cancel();
    };
    combined.addEventListener("abort", stop, { once: true });
    try {
      combined.throwIfAborted();
      if (observeAction) await this.bridge.call('fish.actionStart', {}, {signal:combined});
      const withEvidence = async value => {
        if (!observeAction) return value;
        try {
          const evidence = await this.bridge.call('fish.actionFinish', {}, {signal:combined});
          if(name==='fight_entity'&&evidence.targetDeathObserved){value={...value,state:'succeeded',result:{...value.result,status:'succeeded',reason:'target_defeated',deathObserved:true}};}
          return {...value, evidence};
        } catch { return {...value, evidenceUnavailable:true}; }
      };
      if(['close_container','close_game_screen'].includes(name)){
        const before=await this.bridge.call('screen.get',{}, {signal:combined});
        if(before.screen==='none'){
          if(this.rt)this.rt.openContainer=undefined;
          return {state:'not_executed',error:'SCREEN_ALREADY_CLOSED',screen:'none',message:'当前容器界面已经关闭，本次没有执行新动作。不要再次关闭；以当前格子/配方和阻塞原因决定下一步。关闭界面不会改变熔炉产物冲突。'};
        }
      }
      let result;
      const watchDiscoveries=['travel_to','explore','collect_blocks'].includes(name);
      const discoveryStart=watchDiscoveries?(await this.discoveryStatus(undefined,combined)).sequence:0;
      let lastDiscoveryCheck=0;
      const def = this.definitions.get(name);
      if (def) {
        const parsed = def.validator.parse(args);
        result = await this.execution.run(combined, () => def.run(this.rt, this.session, parsed));
        combined.throwIfAborted();
        if(['open_container','container_transfer'].includes(name)){
          const container=await this.containerState(combined);
          if(name==='open_container' && typeof result==='string' && !result.startsWith('opened '))return await withEvidence({state:'failed',result,container});
          if(name==='container_transfer' && typeof result==='string' && /^(put|took) nothing\b/.test(result))return await withEvidence({state:'failed',result:'没有物品实际移动，请核对物品是否能放进当前容器格子。\n'+result,container});
          return await withEvidence({state:'succeeded',result,container});
        }
        if(name==='close_container'){
          const screen=await this.bridge.call('screen.get',{}, {signal:combined});
          const container=await this.containerState(combined);
          if(screen.screen==='container'||container.open)throw new ServiceError('SCREEN_CLOSE_NOT_CONFIRMED','关闭后仍检测到容器，不能报告已关闭；请检查实际界面。');
          return {state:'succeeded',result:{closed:true,screen:screen.screen,externalContainerOpen:false}};
        }
        if (JOBS.has(name)) {
          let job = this.rt.jobs.get(undefined, this.session.id);
          while (job?.state === "running") {
            combined.throwIfAborted();
            if (remainingMs() <= 0)
              throw new DOMException("本场时长已到", "AbortError");
            job = await this.rt.jobs.wait(job.id, 1000, this.session.id);
            if(watchDiscoveries&&job?.state==='running'&&Date.now()-lastDiscoveryCheck>=2000){
              lastDiscoveryCheck=Date.now();const found=await this.discoveryStatus(discoveryStart,combined);
              if(found.updates.some(e=>e.salient)){
                await this.rt.jobs.cancelOwnedBy(this.session.id);
                return await withEvidence({state:'interrupted',result:{reason:'new_environment',discovery:found,previousGoal:args,message:'出现新环境线索，机械任务已停止；先评估现场，不把原目标当作已完成。'},progress:job.log.slice(-5)});
              }
            }
          }
          if (job)
            return await withEvidence({
              state:
                job.state === "done"
                  ? "succeeded"
                  : job.state === "cancelled"
                    ? "cancelled"
                    : "failed",
              result: job.result,
              progress: job.log.slice(-5),
            });
        }
      } else result = await this.custom(name, args, combined);
      combined.throwIfAborted();
      if(['dig_tunnel','fight_entity','recover_position'].includes(name) && result.status==='interrupted')return await withEvidence({state:'interrupted',result});
      return await withEvidence({ state: "succeeded", result });
    } catch (error) {
      if (observeAction) {
        try { error.gameEvidence = await this.bridge.call('fish.actionFinish', {}, {signal:AbortSignal.timeout(1000)}); } catch {}
      }
      throw error;
    } finally {
      combined.removeEventListener("abort", stop);
      if (major) {
        await this.rt?.jobs.cancelOwnedBy(this.session.id).catch(() => {});
        await this.bridge.call("fish.cancel").catch(() => {});
        this.active = null;
      }
      completed();
    }
  }
  async custom(name, args, signal) {
    const call = (method, params = {}) =>
      this.bridge.call(method, params, { signal });
    if(name==='fight_entity')return fightEntity(args,{call,signal});
    if(name==='recover_position')return recoverPosition({call,signal});
    if(name==='inspect_space')return this.spatialStatus(true,signal);
    if(name==='dig_tunnel') {
      try{return await digTunnel(args,{call,signal,discover:since=>this.discoveryStatus(since,signal)});}
      finally{await this.bridge.call('fish.cancel').catch(()=>{});}
    }
    if(name==='wait_for_game'){
      if(!Number.isInteger(args.seconds)||args.seconds<1||args.seconds>5)throw new Error('短暂等待限1–5秒，请选择有实际进展的任务，不要原地等天亮');
      await call('screen.close');let waited=0;
      while(waited<args.seconds){await delay(1000,undefined,{signal});waited++;const self=await call('player.getState');if(self.health<10)return {waited,interrupted:'生命较低，提前结束等待'};if(waited%2===0){const nearby=await call('perception.entities',{radius:6,kinds:['hostile']});if(nearby.entities.some(e=>e.distance<5))return {waited,interrupted:'近处出现敌人，提前结束等待'};}}
      return {waited};
    }
    if(name==='mine_block'){
      try{return await mineBlock(call,args,{signal});}
      finally{await this.bridge.call('fish.cancel').catch(()=>{});}
    }
    if(name==='place_block_at'){
      if(![args.x,args.y,args.z].every(Number.isFinite))throw new Error('放置坐标无效');
      const target={x:Math.floor(args.x),y:Math.floor(args.y),z:Math.floor(args.z)};
      const candidates=[{x:target.x,y:target.y-1,z:target.z,face:'up'},{x:target.x-1,y:target.y,z:target.z,face:'east'},{x:target.x+1,y:target.y,z:target.z,face:'west'},{x:target.x,y:target.y,z:target.z-1,face:'south'},{x:target.x,y:target.y,z:target.z+1,face:'north'},{x:target.x,y:target.y+1,z:target.z,face:'down'}];
      const blocks=(await call('perception.blocks',{positions:[target,...candidates.map(({face,...p})=>p)]})).blocks;
      if(!blocks[0]?.loaded)throw new Error('目标区域尚未加载；等待客户端加载或走近后再放置');
      if(!blocks[0].air)throw new Error('新方块的目标格必须是空气；目标现在为'+blocks[0].id);
      await call('screen.close');await call('control.setInput',{sneak:true});await delay(100,undefined,{signal});
      let last='附近没有承托方块';
      try{for(let i=0;i<candidates.length;i++){
        const support=blocks[i+1];if(!support?.loaded||support.air||/water|lava/.test(support.id))continue;
        try{return await this.custom('place_block',candidates[i],signal);}catch(e){signal?.throwIfAborted();last=e.message;if(!['GAME_bad_request','PLACE_NOT_CONFIRMED'].includes(e.code))throw e;}
      }throw new ServiceError('PLACE_NO_VISIBLE_SUPPORT','无法在该空位正常放置：'+last);}
      finally{await this.bridge.call('control.stop').catch(()=>{});}
    }
    if(name==='drop_items') {
      if(!Number.isInteger(args.slot)||args.slot<0||args.slot>35||!Number.isInteger(args.count)||args.count<1||args.count>8)throw new Error('只可丢指定背包格1–8个已有物品');
      const inv=await call('player.getInventory');
      const stack=[...inv.hotbar,...inv.main].find(i=>i.slot===args.slot);
      if(!stack||stack.count<args.count)throw new Error('该格物品数量不足');
      await call('container.close');
      for(let i=0;i<args.count;i++){await call('inventory.dropSlot',{slot:args.slot,wholeStack:false});await delay(100,undefined,{signal});}
      const after=await call('player.getInventory');
      const left=[...after.hotbar,...after.main].find(i=>i.slot===args.slot)?.count||0;
      if(stack.count-left!==args.count)throw new Error('丢弃后的背包数量未确认，请重新查询');
      return {dropped:args.count,item:stack.id};
    }
    if (name === "get_game_state") return this.status();
    if (name === "get_inventory") return call("player.getInventory");
    if (name === "inspect_blocks") {
      if (
        !Array.isArray(args.positions) ||
        args.positions.length < 1 ||
        args.positions.length > 32
      )
        throw new Error("精确方块查询限1–32个位置。");
      return call("perception.blocks", {
        positions: args.positions,
        tool: true,
      });
    }
    if (name === "get_container") return this.containerState(signal);
    if (name === "inspect_entities") {
      const radius = args.radius ?? 64;
      if (!Number.isInteger(radius) || radius < 1 || radius > 128)
        throw new Error("实体查询半径限1–128。");
      const result = await call("perception.entities", { radius, kinds: [] });
      return {
        entities: result.entities.slice(0, 48),
        omitted: Math.max(0, result.entities.length - 48),
      };
    }
    if (name === "equip_item") {
      if (!Number.isInteger(args.slot) || args.slot < 0 || args.slot > 35)
        throw new Error("背包格必须为0–35。");
      if (args.armor)
        return call("container.click", {
          slot: args.slot < 9 ? args.slot + 36 : args.slot,
          button: 0,
          mode: "quick_move",
        });
      return call("fish.equip", { slot: args.slot, hotbarSlot: 0 });
    }
    if (name === "eat_food") {
      const before = await call("player.getState");
      const started = await call("fish.eat");
      if (started.alreadyFull) return started;
      await delay(2200, undefined, { signal });
      await call("fish.stopUsing");
      const after = await call("player.getState");
      if (after.food <= before.food)
        throw new Error("进食后饱食度没有增加，请核对食物和游戏界面。");
      return { foodBefore: before.food, foodAfter: after.food };
    }
    if (name === "attack_entity") {
      if (
        !/^[0-9a-f-]{36}$/i.test(args.uuid || "") ||
        !Number.isInteger(args.seconds ?? 5) ||
        (args.seconds ?? 5) < 1 ||
        (args.seconds ?? 5) > 20
      )
        throw new Error("攻击目标或时长无效。");
      const until = Date.now() + (args.seconds ?? 5) * 1000;
      let attacks = 0;
      while (Date.now() < until) {
        signal.throwIfAborted();
        const result = await call("fish.attack", { uuid: args.uuid });
        if (result.deathObserved) return {deathObserved:true,attacks};
        if (result.missing) return { missing: true, attacks };
        if (result.attacked) attacks++;
        await delay(500, undefined, { signal });
      }
      return { attacks };
    }
    if (name === "use_block") return call("fish.useBlock", args);
    if (name === "use_item") {
      if (!Number.isInteger(args.ticks) || args.ticks < 1 || args.ticks > 100)
        throw new Error("使用物品时长限1–100游戏刻。");
      await call("control.startUsing");
      await delay(args.ticks * 50, undefined, { signal });
      return call("fish.stopUsing");
    }
    if (name === "place_block") {
      const offset = {
        up: [0, 1, 0],
        down: [0, -1, 0],
        north: [0, 0, -1],
        south: [0, 0, 1],
        west: [-1, 0, 0],
        east: [1, 0, 0],
      }[args.face];
      if (!offset || ![args.x, args.y, args.z].every(Number.isFinite))
        throw new Error("放置位置或方向无效。");
      const target = {
        x: Math.floor(args.x) + offset[0],
        y: Math.floor(args.y) + offset[1],
        z: Math.floor(args.z) + offset[2],
      };
      const read = async () =>
        (await call("perception.blocks", { positions: [target] })).blocks[0];
      const before = await read();
      if (!before?.loaded) throw new Error("目标方块尚未加载。");
      await call("fish.placeBlock", args);
      for (let attempt = 0; attempt < 12; attempt++) {
        await delay(100, undefined, { signal });
        const after = await read();
        if (after?.loaded && after.id !== before.id && !after.air)
          return { placed: true, position: target, block: after.id };
      }
      throw new ServiceError(
        "PLACE_NOT_CONFIRMED",
        "放置后目标方块没有变化；检查手中是否拿着方块、承托方块是否真实存在、是否碰到了交互界面。",
      );
    }
    if (name === "look_at") return call("control.lookAt", args);
    if (name === "close_game_screen") return call("screen.close");
    throw new Error("未实现的游戏工具。");
  }
  async freeze() {
    await this.bridge.call("fish.pause");
  }
  async resume() {
    await this.bridge.call("fish.resume");
  }
  async cancel() {
    if (this.cancelling) return this.cancelling;
    this.cancelling = Promise.resolve().then(async () => {
      const active = this.active;
      active?.controller?.abort();
      await this.rt?.jobs.cancelOwnedBy(this.session.id).catch(() => {});
      await active?.done;
      await this.bridge?.call("fish.cancel").catch(() => {});
      this.active = null;
    });
    try {
      await this.cancelling;
    } finally {
      this.cancelling = null;
    }
  }
  async close() {
    await this.cancel();
    this.rt?.close();
    this.rt = null;
    this.client = null;
    if (this.store) this.store.connected = false;
  }
}
