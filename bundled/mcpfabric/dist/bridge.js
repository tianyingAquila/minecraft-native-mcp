/**
 * Thin HTTP client for the in-game bridge exposed by the mcpfabric Fabric mod.
 *
 * The mod exposes a single JSON-RPC-style endpoint `POST /rpc` taking `{ method, params }` and
 * returning either `{ ok: true, result }` or `{ ok: false, error: { code, message, data? } }`.
 * It also exposes `GET /health`, `GET /info`, and `GET /events` (SSE).
 */
/** Error thrown when the bridge is reachable but the call itself failed. */
export class BridgeError extends Error {
    code;
    data;
    constructor(body) {
        super(body.message);
        this.name = "BridgeError";
        this.code = body.code;
        this.data = body.data;
    }
}
/** Error thrown when the bridge could not be reached at all (mod not running, wrong port, etc.). */
export class BridgeUnreachableError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.name = "BridgeUnreachableError";
        this.cause = cause;
    }
}
export class BridgeClient {
    baseUrl;
    token;
    timeoutMs;
    constructor(baseUrl, token, timeoutMs) {
        this.baseUrl = baseUrl;
        this.token = token;
        this.timeoutMs = timeoutMs;
    }
    headers() {
        const h = { "content-type": "application/json" };
        if (this.token)
            h.authorization = `Bearer ${this.token}`;
        return h;
    }
    async fetchWithTimeout(path, init) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            return await fetch(this.baseUrl + path, { ...init, signal: controller.signal });
        }
        catch (err) {
            const reason = err instanceof Error && err.name === "AbortError"
                ? `timed out after ${this.timeoutMs}ms`
                : err?.message ?? String(err);
            throw new BridgeUnreachableError(`Could not reach the mcpfabric bridge at ${this.baseUrl} (${reason}). ` +
                `Is Minecraft running with the mod loaded, and is MCPFABRIC_URL correct?`, err);
        }
        finally {
            clearTimeout(timer);
        }
    }
    /** Invoke a bridge RPC method. Throws BridgeError / BridgeUnreachableError on failure. */
    async call(method, params = {}) {
        const res = await this.fetchWithTimeout("/rpc", {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({ method, params }),
        });
        if (res.status === 401 || res.status === 403) {
            throw new BridgeError({
                code: "unauthorized",
                message: "Bridge rejected the auth token. Set MCPFABRIC_TOKEN to the token the mod printed on startup " +
                    "(also stored in mcpfabric.config.json next to the world / in the run dir).",
            });
        }
        let body;
        try {
            body = (await res.json());
        }
        catch {
            throw new BridgeError({
                code: "bad_response",
                message: `Bridge returned a non-JSON response (HTTP ${res.status}).`,
            });
        }
        if (!body.ok) {
            throw new BridgeError(body.error ?? { code: "unknown", message: "Unknown bridge error" });
        }
        return body.result;
    }
    /** Lightweight liveness probe. Returns the parsed `/info` payload or throws if unreachable. */
    async info() {
        const res = await this.fetchWithTimeout("/info", { method: "GET", headers: this.headers() });
        return (await res.json());
    }
}
//# sourceMappingURL=bridge.js.map