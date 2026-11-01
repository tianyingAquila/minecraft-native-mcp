function int(value, fallback) {
    const n = value === undefined ? NaN : Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
}
export function loadConfig(env = process.env) {
    const rawUrl = env.MCPFABRIC_URL ?? "http://127.0.0.1:25599";
    // Normalise: strip a trailing slash so we can append paths cleanly.
    const bridgeUrl = rawUrl.replace(/\/+$/, "");
    const transport = (env.MCPFABRIC_TRANSPORT ?? "stdio").toLowerCase();
    if (transport !== "stdio" && transport !== "http") {
        throw new Error(`MCPFABRIC_TRANSPORT must be "stdio" or "http", got "${transport}"`);
    }
    return {
        bridgeUrl,
        token: env.MCPFABRIC_TOKEN || undefined,
        timeoutMs: int(env.MCPFABRIC_TIMEOUT_MS, 15000),
        transport,
        httpPort: int(env.MCPFABRIC_HTTP_PORT, 25600),
        agent: !/^(0|false|off|no)$/i.test(env.MCPFABRIC_AGENT ?? ""),
        dataDir: env.MCPFABRIC_DATA_DIR || undefined,
        world: env.MCPFABRIC_WORLD || undefined,
    };
}
//# sourceMappingURL=config.js.map