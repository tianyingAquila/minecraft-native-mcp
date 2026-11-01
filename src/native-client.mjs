import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT, DATA, PORT } from "./config.mjs";
import { stopChildTree } from "./minecraft.mjs";
import { ClientBridge } from "./client-bridge.mjs";
import {readPrepared} from './versions.mjs';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class NativeClient {
  constructor({onDisconnect = () => {}} = {}) {
    this.onDisconnect = onDisconnect;
    this.child = null;
    this.bridge = null;
  }
  running() {
    return Boolean(this.child?.pid) && this.child.exitCode === null;
  }
  async start(settings,{signal}={}) {
    signal?.throwIfAborted();
    if (this.running()) return this.bridge;
    const prepared=readPrepared();
    const launch = prepared?.clientProfile||path.join(ROOT, "runtime/native-client/launch.json");
    if (!fs.existsSync(launch)) throw new Error("真正玩家客户端尚未准备。");
    const config = JSON.parse(
      fs.readFileSync(
        prepared?.configFile||path.join(DATA, "native-client/config/mcpfabric.config.json"),
        "utf8",
      ),
    );
    if (
      config.host !== "127.0.0.1" ||
      config.port !== settings.mcpPort ||
      !config.requireAuth
    )
      throw new Error("游戏桥设置与当前本机端口不符。");
    this.bridge = new ClientBridge({
      url: "http://127.0.0.1:" + config.port,
      token: config.token,
    });
    const { args } = JSON.parse(fs.readFileSync(launch, "utf8"));
    // Launch profiles are generated per workspace; do not reuse another workspace's game directory.
    const ownedArgs = [...args];
    ownedArgs.unshift(`-Dfishlive.controlUrl=${process.env.FISH_OVERLAY_URL||'http://127.0.0.1:'+PORT+'/api/overlay'}`);
    ownedArgs[ownedArgs.indexOf("--gameDir") + 1] = prepared?.gameDir||path.join(
      DATA,
      "native-client",
    );
    fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
    const log = fs.createWriteStream(
      path.join(ROOT, "logs/native-client.log"),
      { flags: "a" },
    );
    this.child = spawn(process.env.FISH_JAVA || "java", ownedArgs, {
      cwd: ROOT,
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child.stdout.pipe(log, { end: false });
    this.child.stderr.pipe(log, { end: false });
    this.child.once("exit", () => { log.end(); this.onDisconnect(); });
    this.child.once("error", () => log.end());
    let reason = "客户端未在期限内进入世界。";
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if(signal?.aborted){await this.close();throw signal.reason;}
      if (!this.running())
        throw new Error("真正玩家客户端启动失败，请查看本机游戏日志。");
      try {
        const session = await this.bridge.call("session.info",{},{signal});
        const self = await this.bridge.call("player.getState",{},{signal});
        if (session.player !== "DeepSeekFish")
          throw new Error("客户端玩家不是 DeepSeekFish。");
        if (self.gameMode !== "survival")
          throw new Error("客户端未处于生存模式。");
        return this.bridge;
      } catch (e) {
        reason = e.message;
        if (/不是 DeepSeekFish|未处于生存/.test(reason)) break;
      }
      await sleep(1000);
    }
    await this.close();
    throw new Error(reason);
  }
  async close() {
    await stopChildTree(this.child);
    this.child = null;
    this.bridge = null;
  }
}
