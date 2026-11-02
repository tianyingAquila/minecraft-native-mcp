import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { ServiceError } from "./deepseek.mjs";
export const VISION_COOLDOWN_MS = 15000;
export const VISION_TOOL = {
  type: "function",
  function: {
    name: "inspect_game_screen",
    description:
      `截取一张当前 Minecraft 游戏画面，可在探索时主动观察远处地形、疑似建筑和路线，也可诊断明显困惑、动作莫名失败、卡住或界面异常。说明具体观察目的或问题；不必等到失败才使用，但不要无目的刷图。成功截图至少间隔${VISION_COOLDOWN_MS / 1000}秒，无每小时张数限制。先观察图片再决定下一步；危急时优先脱险。`,
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", minLength: 10, maxLength: 240 },
        symptom: {
          type: "string",
          enum: ["exploration", "confused", "unexpected_failure", "stuck", "ui_problem"],
        },
      },
      required: ["reason", "symptom"],
      additionalProperties: false,
    },
  },
};
const fail = (code, message) => new ServiceError("VISION_" + code, message);
export class VisionDiagnostics {
  constructor({
    capture,
    now = Date.now,
    stateFile = null,
    onChange = () => {},
  }) {
    this.capture = capture;
    this.now = now;
    this.stateFile = stateFile;
    this.onChange = onChange;
    this.lastSuccessAt = null;
    this.pending = null;
    this.busy = false;
    this.generation = 0;
    this.lastHash = null;
    this.capturedCount = 0;
    this.deliveredCount = 0;
    this.last = null;
    if (stateFile && fs.existsSync(stateFile)) {
      const values = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      if (
        !Array.isArray(values) ||
        values.some((t) => !Number.isSafeInteger(t))
      )
        throw fail("RATE_STATE", "截图频率记录无效，请检查本机记录后继续。");
      // Older versions kept an hourly list. Only the latest capture now matters.
      for (const at of values)
        if (this.lastSuccessAt === null || at > this.lastSuccessAt) this.lastSuccessAt = at;
    }
  }
  report() {
    this.onChange({
      captured: this.capturedCount,
      delivered: this.deliveredCount,
      last: this.last,
    });
  }
  availability() {
    const cooldown = this.lastSuccessAt === null ? 0 : Math.max(0, VISION_COOLDOWN_MS - (this.now() - this.lastSuccessAt));
    return {
      available: !this.busy && !this.peek() && cooldown === 0,
      cooldownSeconds: Math.ceil(cooldown / 1000),
    };
  }
  async request(args, { signal } = {}) {
    if (
      !args ||
      typeof args.reason !== "string" ||
      args.reason.trim().length < 10 ||
      args.reason.length > 240 ||
      !["exploration", "confused", "unexpected_failure", "stuck", "ui_problem"].includes(
        args.symptom,
      ) ||
      Object.keys(args).some((k) => !["reason", "symptom"].includes(k))
    )
      throw fail("ARGUMENT", "请说明10–240字的具体游戏诊断理由。");
    if (signal?.aborted)
      throw signal.reason || fail("CANCELLED", "截图请求已取消。");
    const now = this.now();
    const latest = this.lastSuccessAt;
    if (latest !== null && now - latest < VISION_COOLDOWN_MS)
      throw fail(
        "COOLDOWN",
        `截图冷却中，约${Math.ceil((VISION_COOLDOWN_MS - now + latest) / 1000)}秒后可再次诊断。请先查询游戏状态。`,
      );
    if (this.busy) throw fail("BUSY", "已有截图请求正在执行。");
    if (this.peek()) throw fail("PENDING", "已有截图等待观察，请先查看该图片再申请新图。");
    const generation = this.generation;
    this.busy = true;
    try {
      const shot = await this.capture({ signal });
      if (generation !== this.generation || signal?.aborted)
        throw fail("CANCELLED", "截图期间已暂停或更换会话，图片已丢弃。");
      const bytes = Buffer.from(
        typeof shot?.base64 === "string" ? shot.base64 : "",
        "base64",
      );
      const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      if (
        shot?.format !== "png" ||
        bytes.length < 45 ||
        bytes.length > 2 * 1024 * 1024 ||
        !bytes.subarray(0, 8).equals(png) ||
        bytes.toString("ascii", 12, 16) !== "IHDR" ||
        bytes.toString("ascii", bytes.length - 8, bytes.length - 4) !== "IEND"
      )
        throw fail("IMAGE", "游戏截图无效、格式不符或超过2MiB。");
      const width = bytes.readUInt32BE(16),
        height = bytes.readUInt32BE(20);
      if (
        !width ||
        !height ||
        Math.max(width, height) > 1280 ||
        shot.width !== width ||
        shot.height !== height
      )
        throw fail("IMAGE", "游戏截图尺寸无效或未限制到1280以内。");
      const at = this.now(),
        hash = createHash("sha256").update(bytes).digest("hex");
      this.pending = {
        id: randomUUID(),
        at,
        mime: "image/png",
        base64: bytes.toString("base64"),
        width,
        height,
        reason: args.reason.trim(),
        symptom: args.symptom,
        repeated: hash === this.lastHash,
      };
      this.lastHash = hash;
      this.lastSuccessAt = at;
      if (this.stateFile) {
        const temporary = this.stateFile + ".tmp";
        try {
          fs.writeFileSync(temporary, JSON.stringify([at]));
          fs.renameSync(temporary, this.stateFile);
        } finally {
          if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
      }
      this.capturedCount++;
      this.last = { at, reason: args.reason.trim(), status: "等待看图" };
      this.report();
      return this.metadata();
    } catch (e) {
      this.pending = null;
      this.last = {
        at: this.now(),
        reason: args.reason.trim(),
        status: "截图失败",
      };
      this.report();
      throw e;
    } finally {
      this.busy = false;
    }
  }
  metadata() {
    const p = this.peek();
    if (!p) return { captured: false };
    const { base64, mime, ...meta } = p;
    return {
      captured: true,
      ...meta,
      note: p.repeated
        ? "画面与上次相同；先观察随附图片，不要重复旧操作。"
        : "图片将在下一条观察消息中提供，请看图后再行动。",
    };
  }
  peek() {
    if (
      this.pending &&
      (this.now() - this.pending.at > 60000 || this.now() < this.pending.at)
    ) {
      this.pending = null;
      if (this.last) this.last.status = "图片已过期，未发送";
      this.report();
    }
    return this.pending;
  }
  consumed(id) {
    if (this.pending?.id === id) {
      this.pending = null;
      this.deliveredCount++;
      if (this.last) this.last.status = "已送达模型";
      this.report();
    }
  }
  clear() {
    this.generation++;
    if (this.pending && this.last) this.last.status = "已取消待发送图像";
    this.pending = null;
    this.report();
  }
}
