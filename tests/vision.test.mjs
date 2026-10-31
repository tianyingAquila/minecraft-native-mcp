import test from "node:test";
import assert from "node:assert/strict";
import { VisionDiagnostics } from "../src/vision.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=";
const reason = {
  reason: "持续采集却没有物品增加，需要检查游戏是否被界面挡住",
  symptom: "unexpected_failure",
};
test('截图冷却时主动告知不可用，而不是让模型每轮再请求一次',async()=>{
 let now=1000;const v=new VisionDiagnostics({now:()=>now,capture:async()=>({format:'png',width:1,height:1,base64:PNG})});
 assert.equal(v.availability().available,true);await v.request(reason);v.consumed(v.peek().id);
 assert.equal(v.availability().available,false);assert.equal(v.availability().cooldownSeconds,30);
 now+=29999;assert.equal(v.availability().available,false);assert.equal(v.availability().cooldownSeconds,1);
 await assert.rejects(v.request(reason),e=>e.code==='VISION_COOLDOWN');
 now++;assert.equal(v.availability().available,true);await v.request(reason);
});
test("重启仍保留截图冷却记录，磁盘不保存图片", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fish-vision-test-"));
  const stateFile = path.join(dir, "rate.json");
  try {
    const options = {
      stateFile,
      now: () => 1000000,
      capture: async () => ({
        format: "png",
        width: 1,
        height: 1,
        base64: PNG,
      }),
    };
    await new VisionDiagnostics(options).request(reason, {});
    await assert.rejects(
      new VisionDiagnostics(options).request(reason, {}),
      (e) => e.code === "VISION_COOLDOWN",
    );
    assert.ok(!fs.readFileSync(stateFile, "utf8").includes(PNG));
  } finally {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    fs.rmdirSync(dir);
  }
});
test("30秒冷却保留、超过12张仍可截图，图片过期仍生效", async () => {
  let now = 1000,
    captures = 0;
  const v = new VisionDiagnostics({
    now: () => now,
    capture: async () => {
      captures++;
      return { format: "png", width: 1, height: 1, base64: PNG };
    },
  });
  const m = await v.request(reason, {});
  assert.ok(v.peek());
  assert.ok(!JSON.stringify(m).includes(PNG));
  await assert.rejects(
    v.request(reason, {}),
    (e) => e.code === "VISION_COOLDOWN",
  );
  now += 60001;
  assert.equal(v.peek(), null);
  for (let n = 0; n < 14; n++) {
    await v.request(reason, {});
    v.consumed(v.peek().id);
    now += 30000;
  }
  await v.request(reason, {});
  assert.equal(captures, 16);
});
test("截图等待中清理不允许旧图进入新会话，失败不触发成功冷却", async () => {
  let finish;
  const v = new VisionDiagnostics({
    capture: () =>
      new Promise((r) => {
        finish = r;
      }),
  });
  const pending = v.request(reason, {});
  v.clear();
  finish({ format: "png", width: 1, height: 1, base64: PNG });
  await assert.rejects(pending, (e) => e.code === "VISION_CANCELLED");
  assert.equal(v.peek(), null);
  v.capture = async () => ({
    format: "png",
    width: 1,
    height: 1,
    base64: "bm90LWltYWdl",
  });
  await assert.rejects(v.request(reason, {}), (e) => e.code === "VISION_IMAGE");
  assert.equal(v.lastSuccessAt, null);
});

test('30秒后仍有未查看图片时不覆盖它，旧小时记录只保留最后冷却',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fish-vision-migrate-'));
 const stateFile=path.join(dir,'rate.json');let now=400000;
 try {
  fs.writeFileSync(stateFile,JSON.stringify(Array.from({length:12},(_,i)=>1000+i*30000)));
  const v=new VisionDiagnostics({stateFile,now:()=>now,capture:async()=>({format:'png',width:1,height:1,base64:PNG})});
  assert.equal(v.availability().available,true);await v.request(reason);const id=v.peek().id;
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile,'utf8')),[now]);
  now+=30000;await assert.rejects(v.request(reason),e=>e.code==='VISION_PENDING');assert.equal(v.peek().id,id);
  v.consumed(id);await v.request(reason);
 } finally {if(fs.existsSync(stateFile))fs.unlinkSync(stateFile);fs.rmdirSync(dir);}
});
