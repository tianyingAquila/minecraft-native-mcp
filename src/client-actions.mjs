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
import {mineBlock} from './mining.mjs';
import {collectBuriedBlocks} from './collect-buried.mjs';
import { digTunnel } from './tunnel.mjs';
import { spatialOverview } from './spatial.mjs';
import {gameWorldName,readPrepared} from './versions.mjs';
import {describeContainer,loadCookingIndex} from './container-state.mjs';
import {DiscoveryTracker} from './discovery.mjs';
import {fightEntity} from './combat.mjs';
import {recoverPosition} from './recovery.mjs';
import {assistanceQuery,locateResource} from './assistance.mjs';
import {barterPiglins} from './barter.mjs';
import {cookBatch,isFurnaceFuel} from './cook.mjs';
import {activateEndPortal,buildNetherPortal,crossPortal} from './portals.mjs';
import {fightDragon} from './dragon.mjs';
import {bridgeGap} from './bridge-gap.mjs';
import {pillar,breakCrystal} from './end-build.mjs';
import {returnToSurface} from './surface.mjs';
import {makeObsidian} from './obsidian.mjs';
import {farmBlazeSpawner} from './blaze-farm.mjs';
import {dropItemsSafe} from './drop.mjs';
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
  'locate_resource',
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
  {name:'activate_end_portal',description:'在已找到的末地门旁，指定一格门框或内部中心坐标。检查12格门框，安全靠近并补上实际缺少的眼睛，确认门已开启后返回入口。',inputSchema:schema(xyz,['x','y','z'])},
  {name:'pillar',description:'原地逐格跳放普通方块搭高，或逐格拆除连续普通柱子下降。检查净空、支撑、实际高度和危险，限48格。先走到计划起点中央。',inputSchema:schema({direction:{type:'string',enum:['up','down']},height:{type:'integer',minimum:1,maximum:48}},['direction','height'])},
  {name:'break_end_crystal',description:'拆一颗已观察的水晶。先走到与水晶水平相邻的稳固柱脚，程序可自动搭高到有遮挡的攻击高度、检查眼前栏杆并尝试原路下降。先只传uuid。bar与cover仅用于已确认的铁栏杆坐标或可放遮挡的空格。过远、遮挡不足时返回原因。',inputSchema:schema({uuid:{type:'string'},bar:schema(xyz,['x','y','z']),cover:schema(xyz,['x','y','z'])},['uuid'])},
  {name:'bridge_gap',description:'沿绝对方向搭一段同高度短桥，使用背包现有普通方块。潜行到边缘、确认每格支撑再走过去；遇阻、缺材料、失足或危险停止。用于有明确目的地的虚空/峡谷隔断。',inputSchema:schema({direction:{type:'string',enum:['north','south','east','west']},length:{type:'integer',minimum:1,maximum:16}},['direction','length'])},
  {name:'fight_dragon',description:'在末地中央附近从安全地面等待一轮末影龙落地，接近真实龙头并按冷却近战，起飞或遇危险后撤回出发点。返回实测扣血与撤离结果。weapon可用auto或已有近战武器。',inputSchema:schema({seconds:{type:'integer',minimum:10,maximum:120},weapon:{type:'string'}})},
  {name:'build_nether_portal',description:'在手边的四格平地建造并点燃地狱门。x/y/z是最下方转角，沿axis正方向展开四格。需10块普通黑曜石（需用钻石镐开采，铁镐不掉落黑曜石）、7块普通建筑块、镐和打火石，已有正确部分可续建。门框侧面留两格平地搭脚手。确认紫色门面后返回入口。',inputSchema:schema({...xyz,axis:{type:'string',enum:['x','z']}},['x','y','z','axis'])},
  {name:'cross_portal',description:'走进指定的已激活传送门并等待实际维度变化。传送成功后返回抵达坐标；用已观察到的传送门方块坐标，刚穿过门需注意冷却。',inputSchema:schema(xyz,['x','y','z'])},
  {name:'locate_resource',description:'辅助查找岩浆源簇、地狱堡垒、烈焰人刷怪笼、村庄、废弃传送门、末地要塞、末地传送门，或已加载的成年猪灵/烈焰人/末影人；返回来源、有限搜索范围和坐标，不保证安全可达。主世界找末地门先查stronghold接近后再查end_portal，无需丢末影之眼；下界找烈焰人先查nether_fortress接近后再查blaze_spawner。按需查询，不连续重查相同区域。',inputSchema:schema({target:{type:'string',enum:['lava_lake','nether_fortress','blaze_spawner','village','ruined_portal','stronghold','end_portal','piglin','blaze','enderman']},radius:{type:'integer',minimum:16,maximum:256},structureChunks:{type:'integer',minimum:1,maximum:64}},['target'])},
  {name:'return_to_surface',description:'在主世界地下洞穴或矿道一键安全返回地表露天处。程序自动检查头顶是否已露天，未露天则自动选择避开水/岩浆的安全方向连续向上挖阶梯（自动垫台阶）直到见天或达到上限，避免手工算负坐标卡死。',inputSchema:schema({maxHeight:{type:'integer',minimum:4,maximum:120},seconds:{type:'integer',minimum:15,maximum:150},direction:{type:'string',enum:['auto','north','south','east','west']}})},
  {name:'make_obsidian',description:'安全浇灌岩浆并开采黑曜石（需先拥有钻石镐或下界合金镐；若附近只有岩浆则需水桶）。自动避开或浇水防掉烧，逐块挖取并确认背包增量。默认采集10块（足够建造地狱门）。',inputSchema:schema({count:{type:'integer',minimum:1,maximum:20},radius:{type:'integer',minimum:3,maximum:16},x:{type:'number'},y:{type:'number'},z:{type:'number'},seconds:{type:'integer',minimum:20,maximum:240}})},
  {name:'farm_blaze_spawner',description:'针对下界烈焰人刷怪笼（可省略x/y/z自动查找64格内刷怪笼），先自动用背包防火方块给刷怪笼封顶围笼（防止烈焰人飞天打不到），再在激活范围内守候击杀烈焰人并拾取烈焰棒，直到达到目标数量或超时。',inputSchema:schema({x:{type:'number'},y:{type:'number'},z:{type:'number'},targetRods:{type:'integer',minimum:1,maximum:24},seconds:{type:'integer',minimum:20,maximum:180},encloseOnly:{type:'boolean'}})},
  {name:'barter_piglins',description:'地狱中选择会靠近的成年近战猪灵，用背包方块搭两格高台，向塔下逐枚投已有金锭并等待交换，下来捡产物。持弩猪灵不参与。只以背包新增量确认；预算/时限到或危险时返回部分结果。开始前留两空槽、至少两块普通建筑块。',inputSchema:schema({item:{type:'string'},count:{type:'integer',minimum:1,maximum:64},goldBudget:{type:'integer',minimum:1,maximum:64},seconds:{type:'integer',minimum:15,maximum:180},uuid:{type:'string'}},['item','count','goldBudget'])},
  {name:'inspect_space',description:'刷新以角色为中心16格、上下12格的空间简报，并读取北上东右的多高度ASCII切片。平时每轮已自动给空间摘要；遇到复杂洞穴、分岔、跨层或不清楚如何绕行时按需调用，非截图、不转头。仅射线可见表面与保守地面连通估计，?不等于墙；候选通路不保证可直接走到。',inputSchema:schema()},
  {name:'dig_tunnel',description:'连续开凿一小段1格宽、2格高矿道并实际走入，每次1–12格、最多90秒。direction为绝对方位north/south/east/west；slope为level水平、down每格下降一级、up每格上升一级（自行清理头顶并跳上台阶）。模型决定方向、长度与继续时机；程序逐格真实检查、挖掘和前进，不逐格请求模型。遇到水/岩浆、敌人、受伤、断崖、落沙、工具将坏、卡住或未加载时提前停止，结果包含实际推进格数和中断原因。用于普通实心地面的阶梯出入，不用于游泳、垂直井或自动找钻石；矿石批量采集用collect_blocks，单格精确清障用mine_block。',inputSchema:schema({direction:{type:'string',enum:['north','south','east','west']},length:{type:'integer',minimum:1,maximum:12},slope:{type:'string',enum:['level','down','up']}},['direction','length'])},
  {name:'place_block_at',description:'在指定空位放置方块；x/y/z是新方块最终占据的空气或可替换格（支持替换水、岩浆、草、薄雪等），不是承托方块。可选item指定背包中方块ID自动切到手中；不传则用当前手持方块。',inputSchema:schema({...xyz,item:{type:'string'}},['x','y','z'])},
  {name:'mine_block',description:'挖开指定的单个已观察方块，例如挡路石墙。正常生存挖掘、工具和距离限制生效，不保证掉落已捡到；不要向未观察坐标盲挖。',inputSchema:schema(xyz,['x','y','z'])},
  {name:'wait_for_game',description:'只在确有短时熔炼/冷却等需要时等待1–5秒，危险时提前结束。不能连续站着等天亮或用等待逃避任务；自主模式连续两次后必须选择实际任务。',inputSchema:schema({seconds:{type:'integer',minimum:1,maximum:5}},['seconds'])},
  {name:'recover_position',description:'卡在原地或水下溺水时脱困：若处于水中或氧气不足，程序会持续按住跳跃上浮换气并尝试上岸（低血也可用）；在陆地卡住时核验附近两格安全通路并短距离挪动。',inputSchema:schema()},
  {name:'drop_items',description:'丢出指定背包格的已有物品。清理多余圆石/泥土/杂石腾空槽时，传 wholeStack: true 或数量1–64；在窄矿道内会自动在侧边挖出2格深小垃圾坑并定向精准丢入，防止被吸回背包。不要丢主线工具和贵重物品。',inputSchema:schema({slot:{type:'integer',minimum:0,maximum:35},count:{type:'integer',minimum:1,maximum:64},wholeStack:{type:'boolean'}},['slot'])},
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
      "按需读取已加载实体，包括地上掉落物的种类和数量、末影之眼、投射物、水晶和龙的位置；不存在不等于已死亡。",
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
    name: 'organize_inventory',
    description: '合并背包中完全相同的零碎堆叠，腾出空格。保留所有物品，不丢弃、不放进箱子、不挪动已有快捷栏物品。请先关闭外部容器。',
    inputSchema: schema(),
  },
  {
    name: 'cook_batch',
    description: '在可够到的熔炉、烟熏炉或高炉里加工1–12份指定原料，自动使用已有煤、木炭、木板、原木、木棍或烈焰棒等燃料，等待实际产出并取回背包。遇危险、无燃料或阻塞时返回实际所得；已装入的原料留在炉内。item为输入物品。',
    inputSchema: schema({...xyz,item:{type:'string'},count:{type:'integer',minimum:1,maximum:12}},['x','y','z','item','count']),
  },
  {
    name: "eat_food",
    description: "从背包实际进食，饱食度已满时不消耗食物。",
    inputSchema: schema(),
  },
  {
    name:'fight_entity',
    description:'选择一个已观察目标和背包中的近战武器，程序连续追踪接近、按真实冷却挥击，最多60秒；不在每一步重新请求模型。适合普通动物、末影人、僵尸、骷髅。loot可指定击杀后尝试拾取的附近掉落物，如ender_pearl，以背包增量确认。weapon可为auto、held或已有剑/斧/重锤的物品ID。低血、爆炸威胁、追不上或失去目标会返回实际进展，不自动攻击其他生物；消失不等于击杀。弓箭/苦力怕等需其他战术。',
    inputSchema:schema({uuid:{type:'string'},weapon:{type:'string'},loot:{type:'string'},seconds:{type:'integer',minimum:1,maximum:60}},['uuid']),
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
      AGENT_TOOLS.filter((d) => ALLOWED.has(d.name)).map((d) => {
        const inputSchema={...d.inputSchema};
        if(d.name==='observe')inputSchema.radius=z.number().int().min(1).max(2).default(1).describe('按需扫描半径1–2个区块；默认1，避免无关地形挤占上下文。');
        return [d.name,{...d,inputSchema,validator:z.object(inputSchema).strict()}];
      }),
    );
    this.catalogue = [...this.definitions.values()]
      .map((d) => ({
        name: d.name,
        description: d.description,
        inputSchema: z.toJSONSchema(d.validator),
      }))
      .concat(CUSTOM);
    for(const tool of this.catalogue){
      if(tool.name==='observe')tool.description='按需扫描附近1–2区块，更新地图与资源记忆；每轮已有空间简报，不必重复扫描。找岩浆、结构或目标生物优先locate_resource。';
      if(tool.name==='collect_blocks')tool.description='采集指定方块（支持裸露与浅层埋藏矿石，找不到裸露方块时会自动利用寻路挖通到附近安全矿脉并拾取掉落）。优先用它采铁矿、煤矿、金矿、钻石矿和原木；不采集岩浆紧邻或工具等级不够的方块。';
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
    if(self.dimension==='minecraft:the_end'){
      try {
        const {clouds=[],...dragon}=await this.bridge.call('fish.dragonState');
        summary.result.situation.dragonBreath=clouds.slice(0,4);
        if(dragon.found)summary.result.situation.dragon=dragon;
      } catch(error) {if(error.code!=='GAME_unknown_method')throw error;}
    }
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
        let parsed = def.validator.parse(args);
        if (name === 'craft_item' && typeof parsed.item === 'string' && /_(pickaxe|sword|axe|shovel|hoe)$|^shield$|^flint_and_steel$/.test(parsed.item.replace(/^minecraft:/, ''))) {
          const inv = await this.bridge.call('player.getInventory', {}, { signal: combined });
          const targetId = parsed.item.includes(':') ? parsed.item : `minecraft:${parsed.item}`;
          const existing = [...(inv.hotbar || []), ...(inv.main || [])].filter(s => s.id === targetId);
          const allLow = existing.length > 0 && existing.every(s => s.maxDamage && (s.maxDamage - (s.damage ?? 0)) <= Math.max(15, Math.floor(s.maxDamage * 0.2)));
          if (allLow && (parsed.count ?? 1) <= existing.length) {
            parsed = { ...parsed, count: existing.length + (parsed.count ?? 1) };
          }
        }
        result = await this.execution.run(combined, () => def.run(this.rt, this.session, parsed));
        combined.throwIfAborted();
        if(['open_container','container_transfer'].includes(name)){
          let container=await this.containerState(combined);
          if(name==='open_container' && typeof result==='string' && !result.startsWith('opened '))return await withEvidence({state:'failed',result,container});
          if(name==='container_transfer' && typeof result==='string' && /^(put|took) nothing\b/.test(result)){
            if(parsed.direction==='put'&&container.open&&container.furnace&&isFurnaceFuel(parsed.item)){
              const moved=await this.putFurnaceFuel(container,parsed.item,parsed.count||1,combined);
              if(moved>0){
                container=await this.containerState(combined);
                return await withEvidence({state:'succeeded',result:`put ${parsed.item}×${moved} into furnace fuel slot`,container});
              }
            }
            return await withEvidence({state:'failed',result:'没有物品实际移动，请核对物品是否能放进当前容器格子。\n'+result,container});
          }
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
          if (job) {
            if (
              name === 'collect_blocks' &&
              job.state === 'failed' &&
              typeof job.result === 'string' &&
              job.result.includes('only buried ')
            ) {
              const buriedResult = await collectBuriedBlocks(this.rt, this.bridge, parsed, {
                signal: combined,
                remainingMs,
              });
              return await withEvidence(buriedResult);
            }
            let jobResult = job.result;
            if (name === 'travel_to' && typeof jobResult === 'string' && jobResult.includes('after 0 segments')) {
              try {
                const st = await this.bridge.call('player.getState', {}, { signal: combined });
                if (st.inWater && (st.air ?? 300) < 250) {
                  jobResult += '（注意：你仍在水中且氧气不足，原地到达不会让你上浮，请立即调用 recover_position 持续上浮换气/上岸！）';
                }
              } catch {}
            }
            return await withEvidence({
              state:
                job.state === "done"
                  ? "succeeded"
                  : job.state === "cancelled"
                    ? "cancelled"
                    : "failed",
              result: jobResult,
              progress: job.log.slice(-5),
            });
          }
        }
      } else result = await this.custom(name, args, combined);
      combined.throwIfAborted();
      if(result?.status==='interrupted')return await withEvidence({state:'interrupted',result});
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
    if(name==='locate_resource')return locateResource(args,{call,signal});
    if(name==='return_to_surface')return returnToSurface(args,{
      call,
      signal,
      dig: tunnelArgs => this.custom('dig_tunnel', tunnelArgs, signal),
    });
    if(name==='make_obsidian')return makeObsidian(args,{call,signal});
    if(name==='farm_blaze_spawner')return farmBlazeSpawner(args,{
      call,
      signal,
      place: position => this.custom('place_block_at', position, signal),
      locate: locArgs => locateResource(locArgs, {call, signal}),
      fight: fightArgs => fightEntity(fightArgs, {call, signal}),
      eat: () => this.custom('eat_food', {}, signal),
    });
    if(name==='barter_piglins')return barterPiglins(args,{call,signal});
    if(name==='build_nether_portal')return buildNetherPortal(args,{call,signal,place:position=>this.custom('place_block_at',position,signal)});
    if(name==='cross_portal')return crossPortal(args,{call,signal});
    if(name==='activate_end_portal')return activateEndPortal(args,{call,signal});
    if(name==='fight_dragon')return fightDragon(args,{call,signal});
    if(name==='bridge_gap')return bridgeGap(args,{call,signal});
    if(name==='pillar')return pillar(args,{call,signal});
    if(name==='break_end_crystal')return breakCrystal(args,{call,signal,place:position=>this.custom('place_block_at',position,signal)});
    if(name==='cook_batch')return cookBatch(args,{
      call, signal, recipes:this.cookingIndex, readMenu:()=>this.containerState(signal),
      open:position=>this.execution.run(signal,()=>this.upstreamCall('container.open',position)),
      close:()=>this.bridge.call('container.close',{}, {signal:AbortSignal.timeout(2000)}),
    });
    if(name==='fight_entity')return fightEntity(args,{call,signal});
    if(name==='recover_position')return recoverPosition({call,signal});
    if(name==='inspect_space')return this.spatialStatus(true,signal);
    if(name==='dig_tunnel') {
      const placeFloor = async position => {
        const inv = await call('player.getInventory');
        const buildingIds = ['minecraft:cobblestone','minecraft:cobbled_deepslate','minecraft:dirt','minecraft:stone','minecraft:andesite','minecraft:diorite','minecraft:granite','minecraft:netherrack','minecraft:end_stone','minecraft:deepslate','minecraft:tuff'];
        const stack = [...inv.hotbar,...inv.main].find(i => buildingIds.includes(i.id));
        if (!stack) throw new Error('背包没有普通实心建筑方块可垫台阶');
        return this.custom('place_block_at', {...position, item: stack.id}, signal);
      };
      const equip = slot => this.custom('equip_item', {slot}, signal);
      const mergeInventory = async () => {
        await call('fish.mergeInventory');
        await delay(250, undefined, { signal });
      };
      try{return await digTunnel(args,{call,signal,discover:since=>this.discoveryStatus(since,signal),placeFloor,equip,mergeInventory});}
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
      const replaceable=new Set(['minecraft:water','minecraft:lava','minecraft:short_grass','minecraft:tall_grass','minecraft:fern','minecraft:large_fern','minecraft:dead_bush','minecraft:snow','minecraft:vine','minecraft:seagrass','minecraft:tall_seagrass','minecraft:fire','minecraft:soul_fire','minecraft:bubble_column','minecraft:glow_lichen','minecraft:cave_air','minecraft:void_air','minecraft:hanging_roots','minecraft:crimson_roots','minecraft:warped_roots','minecraft:nether_sprouts']);
      if(args.item){
        const want=args.item.includes(':')?args.item:`minecraft:${args.item}`;
        const inv=await call('player.getInventory');
        const found=[...inv.hotbar,...inv.main].find(i=>i.id===want);
        if(!found)throw new Error('背包中没有指定方块：'+want);
        await this.custom('equip_item',{slot:found.slot},signal);
      }
      const target={x:Math.floor(args.x),y:Math.floor(args.y),z:Math.floor(args.z)};
      const candidates=[{x:target.x,y:target.y-1,z:target.z,face:'up'},{x:target.x-1,y:target.y,z:target.z,face:'east'},{x:target.x+1,y:target.y,z:target.z,face:'west'},{x:target.x,y:target.y,z:target.z-1,face:'south'},{x:target.x,y:target.y,z:target.z+1,face:'north'},{x:target.x,y:target.y+1,z:target.z,face:'down'}];
      const blocks=(await call('perception.blocks',{positions:[target,...candidates.map(({face,...p})=>p)]})).blocks;
      if(!blocks[0]?.loaded)throw new Error('目标区域尚未加载；等待客户端加载或走近后再放置');
      if(!blocks[0].air&&!replaceable.has(blocks[0].id))throw new Error('新方块的目标格必须是空气或可替换方块（水/草/雪等）；目标现在为'+blocks[0].id);
      await call('screen.close');await call('control.setInput',{sneak:true});await delay(100,undefined,{signal});
      let last='附近没有承托方块';
      try{for(let i=0;i<candidates.length;i++){
        const support=blocks[i+1];if(!support?.loaded||support.air||/water|lava/.test(support.id))continue;
        try{return await this.custom('place_block',candidates[i],signal);}catch(e){signal?.throwIfAborted();last=e.message;if(!['GAME_bad_request','PLACE_NOT_CONFIRMED'].includes(e.code))throw e;}
      }throw new ServiceError('PLACE_NO_VISIBLE_SUPPORT','无法在该空位正常放置：'+last);}
      finally{await this.bridge.call('control.stop').catch(()=>{});}
    }
    if(name==='drop_items') {
      return dropItemsSafe(args, {call, signal});
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
      const extra = (await call('perception.entities',{radius,kinds:['other']})).entities.filter(entity=>/^minecraft:(eye_of_ender|ender_eye|end_crystal|area_effect_cloud|dragon_fireball|arrow|spectral_arrow)$/.test(entity.type));
      const self = await call('player.getState');
      if(self.dimension==='minecraft:the_end'){
        try {
          const scene=await assistanceQuery(call,'entities',{radius:Math.max(16,radius),signal});
          for(const crystal of scene.entities.filter(entity=>entity.type==='minecraft:end_crystal'&&entity.distance<=radius)) {
            if(!extra.some(entity=>entity.uuid===crystal.uuid)) extra.push({...crystal,source:scene.source});
          }
        } catch(error) {signal?.throwIfAborted();}
      }
      const entities=[...extra,...result.entities];
      return {
        entities: entities.slice(0, 48),
        omitted: Math.max(0, entities.length - 48),
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
      const inventory = await call("player.getInventory");
      const wanted = [...inventory.hotbar, ...inventory.main].find(i => i.slot === args.slot);
      if (!wanted) throw new Error("指定背包格没有物品，请先刷新背包。");
      // Baritone's inventory manager reserves hotbar slot 0 for a pickaxe.
      await call("fish.equip", { slot: args.slot, hotbarSlot: 7 });
      await delay(150, undefined, { signal });
      const after = await call("player.getInventory");
      const held = after.hotbar.find(i => i.slot === after.selectedSlot);
      if (held?.id !== wanted.id || (held.damage || 0) !== (wanted.damage || 0))
        throw new Error("装备后实际手持物品与目标不符，请刷新背包后重新选择。");
      return { selected: true, slot: after.selectedSlot, item: held.id, count: held.count };
    }
    if (name === 'organize_inventory') {
      const read = async () => {
        const inventory = await call('player.getInventory');
        const stacks = [...inventory.hotbar, ...inventory.main];
        const counts = new Map();
        for (const stack of stacks) counts.set(stack.id, (counts.get(stack.id) ?? 0) + stack.count);
        return {usedSlots: stacks.length, counts};
      };
      const before = await read();
      const {merges} = await call('fish.mergeInventory');
      await delay(250, undefined, {signal});
      const after = await read();
      if (after.counts.size !== before.counts.size || [...before.counts].some(([item,count])=>after.counts.get(item)!==count)) {
        throw new ServiceError('INVENTORY_MERGE_UNCONFIRMED','整理后物品数量尚未核对一致，请刷新真实背包。');
      }
      return {merges, usedBefore:before.usedSlots, usedAfter:after.usedSlots, freedSlots:before.usedSlots-after.usedSlots};
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
  async putFurnaceFuel(menu, item, count, signal) {
    const full = item.includes(':') ? item : `minecraft:${item}`;
    if (menu.furnace.fuel.count > 0 && menu.furnace.fuel.id !== full) return 0;
    const inv = await this.bridge.call('player.getInventory', {}, { signal });
    const stacks = [...inv.hotbar, ...inv.main].filter(s => s.id === full);
    if (!stacks.length || !menu.carried?.empty) return 0;
    let remaining = Math.max(1, Math.min(64, Number(count) || 1));
    let totalMoved = 0;
    let currentMenu = menu;
    for (const stack of stacks) {
      if (remaining <= 0) break;
      signal?.throwIfAborted();
      const source = currentMenu.playerMenuSlots?.find(e => e.inventorySlot === stack.slot)?.menuSlot;
      if (!Number.isInteger(source)) continue;
      const moveCount = Math.min(remaining, stack.count);
      await this.bridge.call('container.click', { slot: source, button: 0, mode: 'pickup' }, { signal });
      if (moveCount === stack.count) {
        await this.bridge.call('container.click', { slot: 1, button: 0, mode: 'pickup' }, { signal });
      } else {
        for (let i = 0; i < moveCount; i++) {
          await this.bridge.call('container.click', { slot: 1, button: 1, mode: 'pickup' }, { signal });
        }
      }
      currentMenu = await this.containerState(signal);
      if (!currentMenu.carried?.empty) {
        await this.bridge.call('container.click', { slot: source, button: 0, mode: 'pickup' }, { signal });
        currentMenu = await this.containerState(signal);
      }
      const afterInv = await this.bridge.call('player.getInventory', {}, { signal });
      const leftInSlot = [...afterInv.hotbar, ...afterInv.main].find(s => s.slot === stack.slot && s.id === full)?.count || 0;
      const actuallyMoved = Math.max(0, stack.count - leftInSlot);
      totalMoved += actuallyMoved;
      remaining -= actuallyMoved;
    }
    return totalMoved;
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
