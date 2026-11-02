import test from "node:test";
import assert from "node:assert/strict";
import {
  amountMicros,
  canSpend,
  fetchBalance,
  reserveFor,
  chatCompletion,
} from "../src/deepseek.mjs";
import { Store } from "../src/state.mjs";
test("模型请求带用户取消信号时，仍然受独立请求超时限制", async () => {
  let remoteTimer;
  try {
    await assert.rejects(
      chatCompletion(
        { model: "deepseek-flash", messages: [] },
        {
          keyReader: () => "test-only",
          signal: new AbortController().signal,
          timeoutMs: 20,
          fetchImpl: async (url, opt) =>
            new Promise((resolve, reject) => {
              remoteTimer = setTimeout(
                () =>
                  resolve({
                    ok: true,
                    json: async () => ({
                      choices: [{ message: { content: "late" } }],
                    }),
                  }),
                80,
              );
              opt.signal.addEventListener(
                "abort",
                () => reject(opt.signal.reason),
                { once: true },
              );
            }),
        },
      ),
      (e) => e.code === "MODEL_TIMEOUT",
    );
  } finally {
    clearTimeout(remoteTimer);
  }
});
test("图像按图像token预留，不把base64长度误算成巨额文字", () => {
  const reserve = reserveFor({
    model: "deepseek-flash",
    max_tokens: 64,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "诊断游戏卡住" },
          {
            type: "image_url",
            image_url: {
              url: "data:image/png;base64," + "A".repeat(1024 * 1024),
            },
          },
        ],
      },
    ],
  });
  assert.ok(reserve > 12000);
  assert.ok(reserve < 100000);
});
test("余额按人民币总额、新鲜度及预留额控制", () => {
  const now = Date.now();
  assert.equal(amountMicros("1.0000009"), 1000000);
  assert.equal(
    canSpend(
      { micros: 990000, available: true, currency: "CNY", checkedAt: now },
      0,
      now,
    ),
    false,
  );
  assert.equal(
    canSpend(
      { micros: 1000000, available: true, currency: "CNY", checkedAt: now },
      0,
      now,
    ),
    true,
  );
  assert.equal(
    canSpend(
      { micros: 1100000, available: true, currency: "USD", checkedAt: now },
      0,
      now,
    ),
    false,
  );
  assert.equal(
    canSpend(
      {
        micros: 5000000,
        available: true,
        currency: "CNY",
        checkedAt: now - 30000,
      },
      0,
      now,
    ),
    false,
  );
  assert.ok(reserveFor({ max_tokens: 4096 }) > 40000);
});
test("查询只发送到官方接口，错误余额不放行", async () => {
  const seen = [];
  const balance = await fetchBalance({
    keyReader: () => "test-only",
    fetchImpl: async (url, opt) => {
      seen.push(url, opt.headers.Authorization);
      return {
        ok: true,
        json: async () => ({
          is_available: true,
          balance_infos: [{ currency: "CNY", total_balance: "18.09" }],
        }),
      };
    },
  });
  assert.equal(balance.micros, 18090000);
  assert.equal(seen[0], "https://api.deepseek.com/user/balance");
  await assert.rejects(
    fetchBalance({
      keyReader: () => "test-only",
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          is_available: true,
          balance_infos: [{ currency: "USD", total_balance: "9" }],
        }),
      }),
    }),
    /人民币/,
  );
});
test("观众接口不泄露低余额暂停、错误或控制状态", () => {
  const s = new Store({ persist: false });
  s.status = "paused";
  s.reason = "low_balance";
  s.balanceError = "内部凭据错误";
  s.balance = { total: "0.99", checkedAt: Date.now() };
  const data = s.overlayState();
  assert.equal(data.balance.total, "0.99");
  assert.ok(!JSON.stringify(data).includes("low_balance"));
  assert.ok(!JSON.stringify(data).includes("凭据"));
  assert.ok(!("status" in data));
});

test('阶段目标持续独立展示，不被每步气泡覆盖',()=>{
 const s=new Store();s.persist=false;s.goal='收集一组铁锭，制作全套铁装备';
 s.say('先把前面的铁矿挖下来。','mine_block');
 assert.equal(s.overlayState().goal,'收集一组铁锭，制作全套铁装备');
 assert.equal(s.overlayState().commentary.text,'先把前面的铁矿挖下来。');
});
