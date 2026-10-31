import test from "node:test";
import assert from "node:assert/strict";
import { Agent, compactHistory } from "../src/agent.mjs";
import { Store } from "../src/state.mjs";
import { VisionDiagnostics } from "../src/vision.mjs";
function fakeRuntime() {
  const store = new Store({ persist: false });
  store.status = "running";
  return {
    store,
    mcp: {
      status: async () => ({ health: 20 }),
      tools: () => [],
      catalogue: [],
    },
    observe() {},
    async pause(code) {
      store.status = "paused";
      this.paused = code;
      this.agent.abort();
    },
  };
}
test("余额等待期间客户端断线，不再发送计费请求", async () => {
  const r = fakeRuntime();
  let connected = true, charged = 0;
  r.mcp.assertReady = async () => { if (!connected) throw new Error("客户端已断线"); };
  const a = new Agent(r, {
    balanceFn: async () => { connected = false; return {micros: 20000000, currency: "CNY", available: true, checkedAt: Date.now()}; },
    chatFn: async () => { charged++; return {choices: [{message: {content: "waiting"}}]}; },
  });
  r.agent = a;
  await a.begin({maxRounds: 1});
  assert.equal(charged, 0);
  assert.equal(r.store.status, "paused");
});
test('动作短句与动作共用一次模型请求，say不泄漏给严格游戏参数',async()=>{
 const r=fakeRuntime();let charged=0;
 r.mcp.tools=()=>[{type:'function',function:{name:'collect_blocks',parameters:{type:'object',properties:{count:{type:'integer'}},required:['count'],additionalProperties:false}}}];
 r.mcp.execute=async(name,args)=>{assert.deepEqual(args,{count:1});return {state:'succeeded',result:'picked up'};};
 const a=new Agent(r,{balanceFn:async()=>({micros:20000000,currency:'CNY',available:true,checkedAt:Date.now()}),chatFn:async body=>{charged++;assert.ok(body.tools[0].function.parameters.required.includes('say'));return {choices:[{message:{tool_calls:[{id:'action',type:'function',function:{name:'collect_blocks',arguments:'{"count":1,"say":"先去收集一些木头。"}'}}]}}]};}});
 a.load=()=>{};a.save=()=>{};r.agent=a;await a.begin({maxRounds:1});assert.equal(charged,1);assert.equal(r.store.overlayState().commentary.text,'先去收集一些木头。');
});
test('真实事件反应与下一步行动共用决策，元数据不传给严格游戏工具',async()=>{
 const r=fakeRuntime();let calls=0,executed=0;
 r.mcp.tools=()=>[{type:'function',function:{name:'attack_entity',parameters:{type:'object',properties:{uuid:{type:'string'}},required:['uuid'],additionalProperties:false}}}];
 r.mcp.status=async()=>({result:{situation:{vitals:{health:calls?19:20,airSupplyTicks:300},position:{inWater:false},nearby:{hostiles:[]}}}});
 r.mcp.execute=async(name,args)=>{executed++;assert.deepEqual(args,{uuid:'target'});if(executed===2){assert.equal(r.store.reaction.text,'刚才吓我一跳，还好血量撑住了。');assert.equal(r.store.commentary.text,'继续往下面探索。');}return {state:'succeeded',result:{missing:true,attacks:1},evidence:{healthBefore:20,lowestHealthObserved:18,healthAfter:19,targetType:'minecraft:skeleton',targetDeathObserved:false}};};
 const a=new Agent(r,{balanceFn:async()=>({micros:20000000,currency:'CNY',available:true,checkedAt:Date.now()}),chatFn:async body=>{calls++;if(calls===2){assert.ok(body.messages.at(-1).content.includes('"lowestObserved":18'));assert.ok(body.messages.at(-1).content.includes('"deathObserved":false'));}return {choices:[{message:{tool_calls:[{id:'event-'+calls,type:'function',function:{name:'attack_entity',arguments:JSON.stringify({uuid:'target',say:calls===1?'先应付眼前的敌人。':'继续往下面探索。',...(calls===2?{reaction:'刚才吓我一跳，还好血量撑住了。'}:{})})}}]}}]};}});
 a.load=()=>{};a.save=()=>{};r.agent=a;await a.begin({maxRounds:2});assert.equal(calls,2);assert.equal(executed,2);assert.equal(r.store.reactionSeq,1);
});

test("低余额时不请求模型且只在控制侧暂停", async () => {
  const r = fakeRuntime();
  let calls = 0;
  const a = new Agent(r, {
    balanceFn: async () => ({
      total: "0.99",
      micros: 990000,
      currency: "CNY",
      available: true,
      checkedAt: Date.now(),
    }),
    chatFn: async () => {
      calls++;
    },
  });
  r.agent = a;
  await a.begin();
  assert.equal(calls, 0);
  assert.equal(r.paused, "low_balance");
  assert.ok(!JSON.stringify(r.store.overlayState()).includes("low_balance"));
});
test("余额查询失败不会进入计费请求", async () => {
  const r = fakeRuntime();
  let calls = 0;
  const a = new Agent(r, {
    balanceFn: async () => {
      throw new Error("余额查询失败");
    },
    chatFn: async () => {
      calls++;
    },
  });
  r.agent = a;
  await a.begin();
  assert.equal(calls, 0);
  assert.equal(r.paused, "agent_error");
});
test("时长到期在读取余额与模型调用前停止", async () => {
  const r = fakeRuntime();
  r.store.runningMs = r.store.settings.durationMinutes * 60000;
  const a = new Agent(r, {
    balanceFn: async () => {
      throw new Error("不应执行");
    },
    chatFn: async () => {
      throw new Error("不应执行");
    },
  });
  r.agent = a;
  await a.begin();
  assert.equal(r.paused, "duration");
});
test("裁剪按完整动作组进行，不拆散工具调用和结果", () => {
  const h = [
    [
      { role: "assistant", tool_calls: [{ id: "old" }] },
      { role: "tool", tool_call_id: "old", content: "x".repeat(200) },
    ],
    [
      { role: "assistant", tool_calls: [{ id: "new" }] },
      { role: "tool", tool_call_id: "new", content: "ok" },
    ],
  ];
  const c = compactHistory(h, 170);
  assert.equal(c.length, 1);
  assert.equal(c[0][1].tool_call_id, "new");
});
test("截图后先把图像交给模型，阻止同批后续行动且不重复上传或持久化图像", async () => {
  const r = fakeRuntime();
  let moves = 0;
  r.mcp.catalogue = [
    { name: "move", inputSchema: { type: "object", properties: {} } },
  ];
  r.mcp.execute = async () => {
    moves++;
    return { state: "succeeded" };
  };
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=";
  r.vision = new VisionDiagnostics({
    capture: async () => ({ format: "png", width: 1, height: 1, base64: png }),
  });
  const requests = [];
  const a = new Agent(r, {
    balanceFn: async () => ({
      total: "20",
      micros: 20000000,
      currency: "CNY",
      available: true,
      checkedAt: Date.now(),
    }),
    chatFn: async (body) => {
      requests.push(structuredClone(body));
      return {
        choices: [
          {
            message:
              requests.length === 1
                ? {
                    content: null,
                    tool_calls: [
                      {
                        id: "photo",
                        type: "function",
                        function: {
                          name: "inspect_game_screen",
                          arguments: JSON.stringify({
                            reason:
                              "游戏动作连续失败，需要观察当前是不是被界面遮挡",
                            symptom: "unexpected_failure",
                          }),
                        },
                      },
                      {
                        id: "after",
                        type: "function",
                        function: { name: "move", arguments: "{}" },
                      },
                    ],
                  }
                : { content: "已经观察诊断画面。" },
          },
        ],
      };
    },
  });
  a.load = () => {};
  let persisted = "";
  a.save = () => {
    persisted = JSON.stringify(a.history);
  };
  r.agent = a;
  await a.begin({ maxRounds: 3 });
  assert.equal(moves, 0);
  const second = requests[1].messages;
  assert.equal(second.at(-1).role, "user");
  assert.equal(
    second.at(-1).content.filter((x) => x.type === "image_url").length,
    1,
  );
  assert.match(
    second.find((x) => x.tool_call_id === "after").content,
    /OBSERVATION_REQUIRED/,
  );
  assert.ok(!JSON.stringify(requests[2]).includes("data:image/"));
  assert.ok(!persisted.includes(png));
});
