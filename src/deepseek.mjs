import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { DSH_HOME } from "./config.mjs";
export class ServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
export function readDeepSeekKey() {
  if (process.env.DEEPSEEK_API_KEY?.trim())
    return process.env.DEEPSEEK_API_KEY.trim();
  try {
    const doc = YAML.parse(
      fs.readFileSync(path.join(DSH_HOME, ".credentials.yaml"), "utf8"),
    );
    const key = doc?.refs?.DEEPSEEK_API_KEY;
    if (typeof key === "string" && key.trim()) return key.trim();
  } catch {}
  throw new ServiceError(
    "NO_CREDENTIAL",
    "没有读到 DSH 的 DeepSeek 凭据，请在 DSH 设置中检查 API key。",
  );
}
export function amountMicros(value) {
  const text = String(value);
  if (!/^\d+(\.\d+)?$/.test(text))
    throw new ServiceError("BALANCE_SHAPE", "余额格式异常。");
  const [whole, fraction = ""] = text.split(".");
  const result =
    Number(whole) * 1e6 + Number(fraction.padEnd(6, "0").slice(0, 6));
  if (!Number.isSafeInteger(result))
    throw new ServiceError("BALANCE_SHAPE", "余额超出可处理范围。");
  return result;
}
export function canSpend(balance, reserveMicros = 0, now = Date.now()) {
  return (
    balance?.available === true &&
    balance.currency === "CNY" &&
    Number.isFinite(balance.checkedAt) &&
    now - balance.checkedAt >= 0 &&
    now - balance.checkedAt <= 20000 &&
    balance.micros >= 1e6 + reserveMicros
  );
}
export async function fetchBalance({
  fetchImpl = fetch,
  keyReader = readDeepSeekKey,
  signal,
} = {}) {
  let response;
  try {
    response = await fetchImpl("https://api.deepseek.com/user/balance", {
      headers: { Authorization: "Bearer " + keyReader() },
      redirect: "error",
      signal: signal || AbortSignal.timeout(12000),
    });
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError(
      "BALANCE_NETWORK",
      "余额查询失败，已停止新的模型请求。",
    );
  }
  if (!response.ok)
    throw new ServiceError(
      "BALANCE_HTTP_" + response.status,
      "余额查询返回 HTTP " + response.status + "。",
    );
  let info, body;
  try {
    body = await response.json();
    info = body.balance_infos?.find((x) => x.currency === "CNY");
    if (!info) throw 0;
    amountMicros(info.total_balance);
  } catch {
    throw new ServiceError("BALANCE_SHAPE", "没有取得有效的人民币余额。");
  }
  return {
    currency: "CNY",
    total: String(info.total_balance),
    micros: amountMicros(info.total_balance),
    available: body.is_available === true,
    checkedAt: Date.now(),
  };
}
export function reserveFor(body) {
  const pro = body.model === "deepseek-v4-pro";
  let imageCount = 0;
  const budgetBody = {
    ...body,
    messages: body.messages?.map((message) => {
      if (!Array.isArray(message.content)) return message;
      return {
        ...message,
        content: message.content.map((part) => {
          if (part.type === "text") return part;
          if (
            part.type !== "image_url" ||
            !/^data:image\/(png|jpeg);base64,/.test(part.image_url?.url || "")
          )
            throw new ServiceError("IMAGE_INPUT", "图像请求格式无效。");
          imageCount++;
          return {
            type: "image_url",
            image_url: { url: "[image]", detail: part.image_url.detail },
          };
        }),
      };
    }),
  };
  return (
    Math.ceil(
      (Buffer.byteLength(JSON.stringify(budgetBody), "utf8") +
        imageCount * 1024) *
        (pro ? 9 : 2) +
        Number(body.max_tokens || 4096) * (pro ? 27 : 8),
    ) + 10000
  );
}
export async function chatCompletion(
  body,
  {
    signal,
    fetchImpl = fetch,
    keyReader = readDeepSeekKey,
    timeoutMs = 120000,
  } = {},
) {
  let response;
  try {
    response = await fetchImpl("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + keyReader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    if (e.name === "TimeoutError")
      throw new ServiceError(
        "MODEL_TIMEOUT",
        "DeepSeek 响应超时，已停止本轮并暂停。",
      );
    if (e.name === "AbortError") throw e;
    throw new ServiceError(
      "MODEL_NETWORK",
      "DeepSeek 请求中断；已暂停，请检查网络后继续。",
    );
  }
  if (!response.ok)
    throw new ServiceError(
      "MODEL_HTTP_" + response.status,
      "DeepSeek 返回 HTTP " + response.status + "，已暂停。",
    );
  const data = await response.json();
  if (!data.choices?.[0]?.message)
    throw new ServiceError("MODEL_SHAPE", "DeepSeek 没有返回有效回复。");
  return data;
}
