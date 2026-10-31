import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { ROOT, PORT } from "./config.mjs";
import { Runtime } from "./runtime.mjs";
export const runtime = new Runtime();
let balanceBubbleSeq = 0;
const overlayVersion = createHash("sha256")
  .update(fs.readFileSync(path.join(ROOT, "web", "overlay.mjs")))
  .update(fs.readFileSync(path.join(ROOT, "web", "overlay.css")))
  .digest("hex").slice(0, 12);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};
function json(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let text = "";
  for await (const piece of req) {
    text += piece;
    if (text.length > 12000) throw new Error("请求内容过长。");
  }
  return JSON.parse(text || "{}");
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1:" + PORT);
    if (!["127.0.0.1:" + PORT, "localhost:" + PORT].includes(req.headers.host))
      return json(res, 403, { error: "本机入口无效。" });
    if (
      req.method === "POST" &&
      req.headers.origin &&
      !["http://127.0.0.1:" + PORT, "http://localhost:" + PORT].includes(
        req.headers.origin,
      )
    )
      return json(res, 403, { error: "请在本机控制页操作。" });
    if (url.pathname === "/api/ping")
      return json(res, 200, {
        app: "deepseek-minecraft-live",
        pid: process.pid,
      });
    if (url.pathname === "/api/state")
      return json(res, 200, runtime.store.publicState());
    if (url.pathname === "/api/overlay") {
      return json(res, 200, {
        ...runtime.store.overlayState(),
        balanceBubbleSeq,
        overlayVersion,
      });
    }
    if (url.pathname === "/api/control" && req.method === "POST") {
      const value = await body(req);
      switch (value.action) {
        case "prepare":
          void runtime.prepare().catch(() => {});
          break;
        case "start":
          await runtime.start();
          break;
        case "pause":
          await runtime.pause();
          break;
        case "stop":
          await runtime.stop();
          break;
        case "settings":
          if (
            value.settings?.world &&
            value.settings.world !== runtime.store.settings.world &&
            runtime.minecraft.child?.exitCode === null
          )
            throw new Error("切换世界前请先保存并停止。");
          runtime.store.configure(value.settings || {});
          break;
        case "balance":
          await runtime.refreshBalance();
          break;
        case "show_balance":
          await runtime.refreshBalance();
          balanceBubbleSeq++;
          break;
        case "show_commentary":
          runtime.store.say("气泡测试：接下来去收集木头。", "preview");
          break;
        case "observer":
          if (runtime.minecraft.child?.exitCode !== null)
            throw new Error("请先准备游戏。");
          if (runtime.legacy) runtime.observer.start();
          else await runtime.observer.start(runtime.store.settings);
          break;
        case "companion": {
          const p = spawn(process.env.FISH_COMPANION_PATH || (()=>{throw new Error("Set FISH_COMPANION_PATH to the companion executable.");})(), [], {
            detached: true,
            stdio: "ignore",
            windowsHide: false,
          });
          p.unref();
          break;
        }
        case "exit":
          setTimeout(() => void close(), 150);
          break;
        default:
          return json(res, 400, { error: "未知操作。" });
      }
      return json(res, 200, { ok: true, state: runtime.store.publicState() });
    }
    let file;
    if (url.pathname === "/") file = path.join(ROOT, "web", "index.html");
    else if (url.pathname === "/overlay")
      file = path.join(ROOT, "web", "overlay.html");
    else if (url.pathname.startsWith("/web/"))
      file = path.resolve(ROOT, "." + url.pathname);
    else if (url.pathname.startsWith("/assets/"))
      file = path.resolve(ROOT, "." + url.pathname);
    if (
      !file ||
      (!file.startsWith(path.join(ROOT, "web") + path.sep) &&
        !file.startsWith(path.join(ROOT, "assets") + path.sep))
    )
      return json(res, 404, { error: "页面不存在。" });
    if (!fs.existsSync(file)) return json(res, 404, { error: "文件不存在。" });
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    json(res, 400, { error: e.message || "操作失败。" });
  }
});
server.listen(PORT, "127.0.0.1", () => {
  console.log("DeepSeek Minecraft control: http://127.0.0.1:" + PORT);
  void runtime.refreshBalance().catch(() => {});
});
const balanceTimer = setInterval(() => {
  void runtime
    .refreshBalance()
    .then((balance) => {
      if (runtime.store.status === "running" && balance.micros < 1e6)
        void runtime.pause("low_balance", "账户余额低于 1 元，已保存暂停。");
    })
    .catch(() => {
      if (runtime.store.status === "running")
        void runtime.pause("balance_error", "余额查询失败，已保存暂停。");
    });
}, 60000);
balanceTimer.unref();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearInterval(balanceTimer);
  await runtime.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
