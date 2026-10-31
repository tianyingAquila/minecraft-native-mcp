import test from "node:test";
import assert from "node:assert/strict";
import { Runtime } from "../src/runtime.mjs";
import { Store } from "../src/state.mjs";
test("重复暂停共用一次清理，取消动作后冻结并断开机器人", async () => {
  const r = new Runtime();
  clearInterval(r.timer);
  r.store = new Store({ persist: false });
  r.store.status = "running";
  r.store.startClock();
  const calls = [];
  r.agent = {
    abort() {
      calls.push("abort");
    },
  };
  r.mcp = {
    async cancel() {
      calls.push("cancel");
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    async close() {
      calls.push("disconnect");
    },
  };
  r.minecraft = {
    async freeze() {
      calls.push("freeze");
    },
  };
  await Promise.all([r.pause(), r.pause()]);
  assert.deepEqual(calls, ["abort", "cancel", "freeze", "disconnect"]);
  assert.equal(r.store.status, "paused");
  assert.equal(r.store.startedAt, null);
});
test("原生客户端暂停清除等待图片，同时取消动作并保存冻结世界", async () => {
  const r = new Runtime();
  clearInterval(r.timer);
  r.store = new Store({ persist: false });
  r.store.status = "running";
  const calls = [];
  r.agent = {
    abort() {
      calls.push("abort");
    },
  };
  r.vision = {
    clear() {
      calls.push("clear-image");
    },
  };
  r.mcp = {
    kind: "native",
    async cancel() {
      calls.push("release-input");
    },
    async close() {
      calls.push("close-jobs");
    },
  };
  r.minecraft = {
    async freeze() {
      calls.push("save-freeze");
    },
  };
  await r.pause();
  assert.deepEqual(calls, [
    "abort",
    "clear-image",
    "release-input",
    "save-freeze",
    "close-jobs",
  ]);
});
test("两个开始请求只启动一次模型循环", async () => {
  const r = new Runtime();
  clearInterval(r.timer);
  r.store = new Store({ persist: false });
  r.store.status = "ready";
  let begins = 0;
  r.agent = {
    begin() {
      begins++;
    },
  };
  r.mcp = { client: true, resume: async () => {} };
  r.minecraft = { resume() {} };
  r.refreshBalance = async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    r.store.balance = { micros: 20000000 };
  };
  await Promise.all([r.start(), r.start()]);
  assert.equal(begins, 1);
});
test("开始查询余额期间暂停，不得随后重新解冻和请求模型", async () => {
  const r = new Runtime();
  clearInterval(r.timer);
  r.store = new Store({ persist: false });
  r.store.status = "ready";
  let begins = 0,
    resumes = 0;
  r.agent = {
    abort() {},
    begin() {
      begins++;
    },
  };
  r.mcp = {
    client: true,
    resume: async () => {
      resumes++;
    },
    cancel: async () => {},
    close: async () => {},
  };
  r.minecraft = {
    resume() {
      resumes++;
    },
    freeze: async () => {},
  };
  r.refreshBalance = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    r.store.balance = { micros: 20000000 };
  };
  const start = r.start();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await r.pause();
  await start;
  assert.equal(begins, 0);
  assert.equal(resumes, 0);
  assert.equal(r.store.status, "paused");
});
