import { ServiceError } from "./deepseek.mjs";
export class ClientBridge {
  constructor({ url, token, fetchImpl = fetch }) {
    const address = new URL(url);
    if (
      address.protocol !== "http:" ||
      address.hostname !== "127.0.0.1" ||
      address.username ||
      address.password ||
      address.pathname !== "/"
    )
      throw new Error("桥必须使用固定本机地址。");
    this.url = address.origin;
    this.token = token;
    this.fetch = fetchImpl;
  }
  async call(method, params = {}, { signal } = {}) {
    let response;
    try {
      response = await this.fetch(this.url + "/rpc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + this.token,
        },
        body: JSON.stringify({ method, params }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
        redirect: "error",
      });
    } catch (e) {
      if (signal?.aborted)
        throw signal.reason || new DOMException("Aborted", "AbortError");
      throw new ServiceError("BRIDGE_OFFLINE", "游戏客户端连接中断或超时。");
    }
    if ([401, 403].includes(response.status))
      throw new ServiceError("BRIDGE_AUTH", "游戏桥认证未通过。");
    let body;
    try {
      body = await response.json();
    } catch {
      throw new ServiceError("BRIDGE_SHAPE", "游戏桥没有返回有效数据。");
    }
    if (!response.ok || body.ok !== true)
      throw new ServiceError(
        "GAME_" +
          String(body?.error?.code || response.status).replace(
            /[^A-Za-z0-9_]/g,
            "",
          ),
        "游戏动作未完成：" +
          String(body?.error?.message || "接口拒绝请求")
            .replaceAll(this.token, "[redacted]")
            .slice(0, 220),
      );
    return body.result;
  }
}
