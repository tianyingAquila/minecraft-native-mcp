/**
 * The agent runtime: long-term state (memory, goals, chunk map) plus the body and job manager,
 * shared by every MCP session of this server process.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { BridgeError } from "../bridge.js";
import { Body } from "./body.js";
import { KeyValue, openDatabase, requireSqlite } from "./db.js";
import { GoalStore } from "./goals.js";
import { JobManager } from "./jobs.js";
import { MemoryStore } from "./memory.js";
import { ingestScan } from "./observe.js";
import { WorldMap } from "./worldmap.js";
export function defaultDbPath(env = process.env) {
    const dir = env.MCPFABRIC_DATA_DIR || join(homedir(), ".mcpfabric");
    return join(dir, "agent.db");
}
const WORLD_TTL_MS = 15_000;
export class AgentRuntime {
    opts;
    body;
    jobs;
    worldCache;
    /** The container the runtime opened last, so transfers can refresh its memory. */
    openContainer;
    /** Opened on first use, so a server whose agent tools are never called writes no file. */
    stores;
    constructor(bridge, opts) {
        this.opts = opts;
        requireSqlite();
        this.body = new Body(bridge);
        this.jobs = new JobManager((job) => this.recordJob(job), async () => {
            // Release the body whatever the job was doing: walking or mining.
            await this.body.navStop().catch(() => undefined);
            await this.body.stopBreaking().catch(() => undefined);
        });
    }
    open() {
        if (!this.stores) {
            const db = openDatabase(this.opts.dbPath);
            this.stores = { db, memory: new MemoryStore(db), goals: new GoalStore(db), map: new WorldMap(db), kv: new KeyValue(db) };
        }
        return this.stores;
    }
    get db() {
        return this.open().db;
    }
    get memory() {
        return this.open().memory;
    }
    get goals() {
        return this.open().goals;
    }
    get map() {
        return this.open().map;
    }
    get kv() {
        return this.open().kv;
    }
    /** Id of the world being played; all memory is scoped to it. */
    async world() {
        if (this.opts.worldOverride)
            return this.opts.worldOverride;
        const now = Date.now();
        if (this.worldCache && now - this.worldCache.at < WORLD_TTL_MS)
            return this.worldCache.id;
        try {
            const info = await this.body.session();
            this.worldCache = { id: info.worldId, at: now };
        }
        catch (err) {
            if (err instanceof BridgeError && err.code === "unknown_method") {
                this.worldCache = { id: "default", at: now }; // mod without session.info
            }
            else if (this.worldCache) {
                return this.worldCache.id; // bridge hiccup: keep using the last world
            }
            else {
                throw err;
            }
        }
        return this.worldCache.id;
    }
    /** Forget the cached world id (e.g. after the player switched worlds). */
    resetWorld() {
        this.worldCache = undefined;
    }
    async here() {
        const self = await this.body.self();
        return { self, at: { dim: self.dimension, x: self.x, y: self.y, z: self.z } };
    }
    /** Scan the loaded area and fold it into the map and memory. */
    async observe(opts = {}) {
        const world = await this.world();
        const scan = await this.body.scan(opts);
        const report = ingestScan(world, scan, this.map, this.memory);
        const at = { dim: scan.dimension, ...scan.player };
        return { world, scan, report, at };
    }
    /** Episodic log: every finished job becomes an event memory, so failures inform later plans. */
    recordJob(job) {
        const world = this.worldCache?.id ?? this.opts.worldOverride;
        if (!world)
            return;
        this.memory.add(world, {
            kind: "event",
            title: `${job.kind} ${job.state}: ${job.summary}`,
            body: job.result ?? "",
            tags: ["job", job.kind, job.state],
            importance: job.state === "failed" ? 0.5 : 0.3,
        });
    }
    close() {
        this.stores?.db.close();
        this.stores = undefined;
    }
}
//# sourceMappingURL=runtime.js.map