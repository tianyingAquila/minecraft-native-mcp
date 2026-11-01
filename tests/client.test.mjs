import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { ClientBridge } from "../src/client-bridge.mjs";
import { ClientActions } from "../src/client-actions.mjs";
test('寻路关闭挡住操作的菜单，并保留模型要求的小数接近距离',async()=>{
 const calls=[];const a=new ClientActions({bridge:{call:async(method,args)=>{calls.push([method,args]);return method==='screen.get'?{screen:'container'}:{};}}});
 await a.upstreamCall('nav.pathTo',{x:1,y:65,z:2,reachRadius:.5});
 assert.equal(calls[1][0],'screen.close');assert.equal(calls.find(x=>x[0]==='fish.navigate')[1].reach,.5);
});
test('容器传输没有移动物品时不能报告成功',async()=>{
 const a=new ClientActions({bridge:{call:async()=>({})}});a.client=true;a.catalogue=[{name:'container_transfer'}];a.definitions=new Map([['container_transfer',{validator:{parse:x=>x},run:async()=> 'put nothing · memory updated'}]]);
 const result=await a.execute('container_transfer',{direction:'put',item:'oak_log'});assert.equal(result.state,'failed');
});
test('原生攻击返回观测事实，目标缺失与确认死亡分别处理',async()=>{
 const methods=[];let dead=false;
 const a=new ClientActions({bridge:{call:async method=>{methods.push(method);if(method==='fish.attack')return dead?{deathObserved:true}:{missing:true};if(method==='fish.actionFinish')return {healthBefore:20,lowestHealthObserved:18,healthAfter:19,targetDeathObserved:dead};return {};}}});
 a.client=true;a.catalogue=[{name:'attack_entity'}];a.definitions=new Map();
 const args={uuid:'00000000-0000-0000-0000-000000000001',seconds:1};
 const missing=await a.execute('attack_entity',args);assert.equal(missing.result.missing,true);assert.equal(missing.evidence.targetDeathObserved,false);
 dead=true;const killed=await a.execute('attack_entity',args);assert.equal(killed.result.deathObserved,true);assert.equal(killed.evidence.targetDeathObserved,true);assert.equal(killed.evidence.lowestHealthObserved,18);assert.ok(methods.indexOf('fish.actionStart')<methods.indexOf('fish.attack'));
});

test("容器刚打开暂时为空时，等待真实物品同步后再报告", async () => {
  let reads=0;
  const a=new ClientActions({bridge:{call:async method=>method==='container.state'?{open:true,containerId:1,type:'minecraft:furnace',size:3,slots:++reads<3?[]:[{slot:0,id:'minecraft:raw_iron',count:9}]}:{}}});
  await a.upstreamCall('container.open',{x:0,y:64,z:0});
  const state=await a.upstreamCall('container.state');
  assert.equal(state.slots[0]?.count,9);
});
test("取消发生在上游创建job之前，晚创建job也必须终止", async () => {
  const { JobManager } = await import("../bundled/mcpfabric/dist/agent/jobs.js");
  let release;
  let entered;
  const ready=new Promise(r=>{entered=r;});
  const gate = new Promise(r => { release = r; });
  let moves = 0;
  const actions = new ClientActions({bridge: {call: async () => { moves++; return {}; }}});
  const jobs = new JobManager(async () => {}, () => {});
  actions.client = true;
  actions.session = {id: "cancel-race"};
  actions.rt = {jobs};
  actions.catalogue = [{name: "travel_to"}];
  actions.definitions = new Map([["travel_to", {validator: {parse: x => x}, run: async () => {
    entered();
    await gate;
    jobs.start("travel", "late", async ctx => {
      await ctx.sleep(30);
      await actions.bridge.call("nav.pathTo", {x: 1, y: 64, z: 0});
      return "moved";
    }, actions.session.id);
  }}]]);
  const pending = actions.execute("travel_to").catch(() => {});
  await ready;
  const cancelled = actions.cancel();
  await new Promise(r => setTimeout(r, 5));
  release();
  await cancelled;
  const afterCancel = moves;
  await pending;
  await new Promise(r => setTimeout(r, 60));
  assert.equal(jobs.get(undefined, actions.session.id)?.state, "cancelled");
  assert.equal(moves, afterCancel);
});
test("已有任务时第二个任务不得抢占角色", async () => {
  const actions = new ClientActions({ bridge: { call: async () => ({}) } });
  actions.active = { id: "first" };
  await assert.rejects(
    actions.execute("travel_to", { x: 0, y: 64, z: 0 }, {}),
    (e) => e.code === "GAME_BUSY",
  );
});
test("客户端预测放置成功，但世界方块未变时不得报告成功", async () => {
  const actions = new ClientActions({
    bridge: {
      call: async (method) =>
        method === "perception.blocks"
          ? { blocks: [{ loaded: true, id: "minecraft:air", air: true }] }
          : { result: "client prediction" },
    },
  });
  await assert.rejects(
    actions.custom(
      "place_block",
      { x: 0, y: 64, z: 0, face: "up" },
      new AbortController().signal,
    ),
    (e) => e.code === "PLACE_NOT_CONFIRMED",
  );
});
test("取消触发abort回调时仍然只执行一次按键清理", async () => {
  let stops = 0;
  const actions = new ClientActions({
    bridge: {
      call: async (method) => {
        if (method === "fish.cancel") stops++;
        return {};
      },
    },
  });
  const controller = new AbortController();
  actions.active = { controller };
  controller.signal.addEventListener(
    "abort",
    () => {
      void actions.cancel();
    },
    { once: true },
  );
  await actions.cancel();
  assert.equal(stops, 1);
});
test("取消完成后当前原生动作的finally清理已经结束", async () => {
  let stops = 0;
  const actions = new ClientActions({
    bridge: {
      call: async (method) => {
        if (method === "fish.cancel" && ++stops === 1)
          await new Promise((r) => setTimeout(r, 50));
        return {};
      },
    },
  });
  actions.client = true;
  actions.catalogue = [{ name: "use_item" }];
  let ended = false;
  const pending = actions
    .execute("use_item", { ticks: 100 })
    .catch(() => {})
    .finally(() => {
      ended = true;
    });
  await new Promise((r) => setTimeout(r, 5));
  await actions.cancel();
  assert.equal(ended, true);
  await pending;
});
test("桥拒绝认证失败和非JSON回复，不把令牌写进错误", async () => {
  let mode = "unauthorized";
  const server = http.createServer((req, res) => {
    if (mode === "unauthorized") {
      res.writeHead(401);
      res.end("private-server-detail");
    } else {
      res.writeHead(200);
      res.end("not-json");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const bridge = new ClientBridge({
      url: `http://127.0.0.1:${server.address().port}`,
      token: "private-test-value",
    });
    await assert.rejects(
      bridge.call("player.getState"),
      (e) => e.code === "BRIDGE_AUTH" && !e.message.includes("private"),
    );
    mode = "bad-json";
    await assert.rejects(
      bridge.call("player.getState"),
      (e) => e.code === "BRIDGE_SHAPE",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
