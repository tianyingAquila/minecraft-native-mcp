import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const DATA = path.join(ROOT, "data");
export const PORT = Number(process.env.FISH_CONTROL_PORT || 21940);
export const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
export const DEFAULTS = {
  durationMinutes: 120,
  world: "rehearsal",
  model: "deepseek-flash",
  maxOutputTokens: 4096,
  minecraftPort: 25586,
  mcpPort: 25587,
  bubbleMinSeconds: 180,
  bubbleMaxSeconds: 300,
  bubbleDurationSeconds: 8,
  nativeHudEnabled: false,
  streamingEnabled:false,
  minecraftHome:'',
};
export function readSettings() {
  try {
    return {
      ...DEFAULTS,
      ...JSON.parse(fs.readFileSync(path.join(DATA, "settings.json"), "utf8")),
    };
  } catch {
    return { ...DEFAULTS };
  }
}
export function saveSettings(settings) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(
    path.join(DATA, "settings.json"),
    JSON.stringify(settings, null, 2),
  );
}
export const FIXED_NOTE =
  "大肥鱼的Minecraft直播，有一级生命回复怕她一直死";
