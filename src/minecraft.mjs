import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, DATA } from "./config.mjs";
import {readPrepared,gameWorldName,versionEntry} from './versions.mjs';
import {worldInfo} from './worlds.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function stopChildTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((r) => {
      const p = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      p.once("exit", r);
      p.once("error", r);
    });
    return;
  }
  child.kill();
  await Promise.race([new Promise((r) => child.once("exit", r)), sleep(2500)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
export function createWorldFiles(worldDir, settings) {
  const modernRules=(settings.resolvedVersion||'1.21.4')==='1.21.11';
  fs.mkdirSync(worldDir, { recursive: true });
  fs.writeFileSync(path.join(worldDir, "eula.txt"), "eula=true\n");
  fs.writeFileSync(
    path.join(worldDir, "server.properties"),
    [
      "server-ip=127.0.0.1",
      "server-port=" + settings.minecraftPort,
      "online-mode=false",
      "gamemode=survival",
      "difficulty=normal",
      "max-players=4",
      "spawn-protection=0",
      "view-distance=8",
      "simulation-distance=6",
      "enable-rcon=false",
      "enable-query=false",
      "level-name=world",
      ...(settings.worldSeed?['level-seed='+settings.worldSeed]:[]),
      "motd=DeepSeek Minecraft Live",
      "sync-chunk-writes=true",
      "enable-command-block=false",
      "pause-when-empty-seconds=0",
    ].join("\n") + "\n",
  );
  const pack = path.join(worldDir, "world", "datapacks", "fish-rules");
  const write = (name, value) => {
    const dest = path.join(pack, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, value);
  };
  write(
    "pack.mcmeta",
    JSON.stringify({
      pack: {
        pack_format: versionEntry(settings.resolvedVersion||'1.21.4').dataPackVersion?.major||61,
        ...(versionEntry(settings.resolvedVersion||'1.21.4').dataPackVersion?.minor!==undefined?{min_format:[versionEntry(settings.resolvedVersion||'1.21.4').dataPackVersion.major,versionEntry(settings.resolvedVersion||'1.21.4').dataPackVersion.minor],max_format:[versionEntry(settings.resolvedVersion||'1.21.4').dataPackVersion.major,versionEntry(settings.resolvedVersion||'1.21.4').dataPackVersion.minor]}:{}),
        description:
          "DeepSeekFish: regeneration I, resistance I, night vision I, keepInventory",
      },
    }),
  );
  write(
    "data/minecraft/tags/function/load.json",
    JSON.stringify({ values: ["fish:load"] }),
  );
  write(
    "data/minecraft/tags/function/tick.json",
    JSON.stringify({ values: ["fish:tick"] }),
  );
  write(
    "data/fish/function/load.mcfunction",
    'gamerule '+(modernRules?'minecraft:keep_inventory':'keepInventory')+" true\nscoreboard objectives add fish_clock dummy\nscoreboard players set #clock fish_clock 0\n",
  );
  write(
    "data/fish/function/tick.mcfunction",
    "scoreboard players add #clock fish_clock 1\nexecute if score #clock fish_clock matches 20.. run function fish:effects\nexecute if score #clock fish_clock matches 20.. run function fish:camera\nexecute if score #clock fish_clock matches 20.. run scoreboard players set #clock fish_clock 0\n",
  );
  write(
    "data/fish/function/camera.mcfunction",
    "gamemode spectator @a[name=FishCamera,gamemode=!spectator]\nexecute as @a[name=FishCamera] at @s unless entity @a[name=DeepSeekFish,distance=..128] at @a[name=DeepSeekFish,limit=1] run tp @s ~ ~ ~\nexecute as @a[name=FishCamera] run spectate @a[name=DeepSeekFish,limit=1] @s\n",
  );
  write(
    "data/fish/function/effects.mcfunction",
    'execute as @a[name=DeepSeekFish] unless data entity @s active_effects[{id:"minecraft:regeneration"}] run effect give @s minecraft:regeneration infinite 0 true\nexecute as @a[name=DeepSeekFish] unless data entity @s active_effects[{id:"minecraft:resistance"}] run effect give @s minecraft:resistance infinite 0 true\nexecute as @a[name=DeepSeekFish] unless data entity @s active_effects[{id:"minecraft:night_vision"}] run effect give @s minecraft:night_vision infinite 0 true\n',
  );
}
export class Minecraft {
  constructor(store,{onDisconnect=()=>{}}={}) {
    this.store = store;
    this.onDisconnect=onDisconnect;
    this.child = null;
    this.lines = [];
    this.world = null;
  }
  command(text) {
    if (!this.child || this.child.exitCode !== null)
      throw new Error("Minecraft 服务端尚未运行。");
    this.child.stdin.write(text + "\n");
  }
  async start({signal}={}) {
    signal?.throwIfAborted();
    if (this.child?.exitCode === null) {
      if (this.world !== this.store.settings.world)
        throw new Error("请先保存停止，再切换世界。");
      return;
    }
    const prepared=readPrepared();
    const jar = prepared?.serverJar||path.join(ROOT, "runtime", "server-1.21.4.jar");
    if (!fs.existsSync(jar))
      throw new Error("缺少 Minecraft 服务端，请先运行准备环境。");
    this.world = this.store.settings.world;
    const cwd = path.join(DATA, "worlds", gameWorldName(this.store.settings));
    const info=worldInfo(this.store.settings);
    createWorldFiles(cwd, {...this.store.settings,worldSeed:info.seed});
    const nativeProfile = prepared?.serverProfile||path.join(ROOT, "runtime/native-server/launch.json");
    let javaArgs = [
      "-Xms512M",
      "-Xmx2G",
      "-Dfile.encoding=UTF-8",
      "-jar",
      jar,
      "nogui",
    ];
    if (process.env.FISH_GAME_BACKEND !== "legacy") {
      const pauseMod = prepared?.pauseMod||path.join(
        ROOT,
        "runtime/native-server/fish-pause-server.jar",
      );
      if (!fs.existsSync(nativeProfile) || !fs.existsSync(pauseMod))
        throw new Error("真正客户端的暂停服务端尚未准备。");
      javaArgs = JSON.parse(fs.readFileSync(nativeProfile, "utf8")).args;
      fs.mkdirSync(path.join(cwd, "mods"), { recursive: true });
      fs.copyFileSync(pauseMod, path.join(cwd, "mods/fish-pause-server.jar"));
    }
    const logDir = path.join(ROOT, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const log = fs.createWriteStream(path.join(logDir, "minecraft.log"), {
      flags: "a",
    });
    const child = spawn(process.env.FISH_JAVA || "java", javaArgs, {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    let pending = "";
    const ready = new Promise((resolve, reject) => {
      const abort=()=>{void stopChildTree(child);reject(signal.reason);};signal?.addEventListener('abort',abort,{once:true});
      const timeout = setTimeout(
        () => reject(new Error("Minecraft 启动超时，请查看运行日志。")),
        120000,
      );
      const handle = (data) => {
        const text = data.toString("utf8");
        log.write(text);
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        for (const line of lines) {
          this.lines.push(line);
          this.lines = this.lines.slice(-120);
          if (line.includes("Done (")) {
            clearTimeout(timeout);
            signal?.removeEventListener('abort',abort);
            resolve();
          }
          if (
            /DeepSeekFish.*(was slain|was blown|fell|drowned|burned|tried to|hit the ground|died)/.test(
              line,
            )
          ) {
            this.store.deaths++;
            this.store.event("大肥鱼死亡，已保留背包；复活后会恢复辅助效果。");
          }
        }
      };
      child.stdout.on("data", handle);
      child.stderr.on("data", handle);
      child.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("Java 启动失败，请检查 Java 21。"));
      });
      child.once("exit", (code) => {
        signal?.removeEventListener('abort',abort);
        clearTimeout(timeout);
        log.end();
        reject(new Error("Minecraft 服务端退出，代码 " + code));
        if(this.child===child)this.onDisconnect();
      });
    });
    try {
      await ready;
      const modern=this.store.settings.resolvedVersion==='1.21.11';
      this.command('gamerule '+(modern?'minecraft:keep_inventory':'keepInventory')+' true');
      this.command('gamerule '+(modern?'minecraft:send_command_feedback':'sendCommandFeedback')+' false');
      this.command('gamerule '+(modern?'minecraft:log_admin_commands':'logAdminCommands')+' false');
      this.store.event("Minecraft " + info.name + " 世界已准备。");
    } catch (e) {
      await stopChildTree(child);
      this.child = null;
      throw e;
    }
  }
  async freeze() {
    if (this.child?.exitCode === null) {
      this.command("tick freeze");
      this.command("save-all flush");
    }
  }
  resume() {
    this.command("tick unfreeze");
  }
  async stop() {
    const child = this.child;
    if (!child || child.exitCode !== null) {
      this.child = null;
      return;
    }
    try {
      this.command("tick unfreeze");
      this.command("save-all flush");
      this.command("stop");
      await Promise.race([
        new Promise((r) => child.once("exit", r)),
        sleep(20000),
      ]);
    } finally {
      await stopChildTree(child);
      this.child = null;
    }
  }
}
