/**
 * SQLite storage for the agent runtime (memories, goals, the chunk map).
 *
 * Uses Node's built-in `node:sqlite` so the server keeps zero native dependencies. Every table is
 * keyed by a world id, so a single database file holds the memory of every world the agent plays.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
const require = createRequire(import.meta.url);
let sqlite;
/**
 * Load `node:sqlite` without its one-time ExperimentalWarning: the module is stable enough for this
 * use, and the warning would otherwise show up in every MCP client's server log.
 */
function loadSqlite() {
    if (sqlite)
        return sqlite;
    const original = process.emitWarning;
    process.emitWarning = ((warning, ...rest) => {
        const text = typeof warning === "string" ? warning : warning.message;
        if (/sqlite/i.test(text))
            return;
        original.call(process, warning, ...rest);
    });
    try {
        sqlite = require("node:sqlite");
    }
    finally {
        process.emitWarning = original;
    }
    return sqlite;
}
/** Ordered schema migrations; index + 1 is the resulting `user_version`. */
const MIGRATIONS = [
    `
  CREATE TABLE memories (
    id           INTEGER PRIMARY KEY,
    world        TEXT    NOT NULL,
    kind         TEXT    NOT NULL,
    title        TEXT    NOT NULL,
    body         TEXT    NOT NULL DEFAULT '',
    tags         TEXT    NOT NULL DEFAULT '',
    dim          TEXT,
    x            INTEGER,
    y            INTEGER,
    z            INTEGER,
    data         TEXT,
    fingerprint  TEXT,
    importance   REAL    NOT NULL DEFAULT 0.5,
    status       TEXT    NOT NULL DEFAULT 'valid',
    auto         INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    observed_at  INTEGER NOT NULL
  );
  CREATE INDEX memories_world_kind ON memories(world, kind);
  CREATE INDEX memories_world_pos ON memories(world, dim, x, z);

  CREATE VIRTUAL TABLE memories_fts USING fts5(
    title, body, tags,
    content='memories', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, title, body, tags) VALUES (new.id, new.title, new.body, new.tags);
  END;
  CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, title, body, tags) VALUES ('delete', old.id, old.title, old.body, old.tags);
  END;
  CREATE TRIGGER memories_au AFTER UPDATE OF title, body, tags ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, title, body, tags) VALUES ('delete', old.id, old.title, old.body, old.tags);
    INSERT INTO memories_fts(rowid, title, body, tags) VALUES (new.id, new.title, new.body, new.tags);
  END;

  CREATE TABLE goals (
    id          INTEGER PRIMARY KEY,
    world       TEXT    NOT NULL,
    parent_id   INTEGER REFERENCES goals(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    detail      TEXT    NOT NULL DEFAULT '',
    done_when   TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'pending',
    priority    INTEGER NOT NULL DEFAULT 0,
    outcome     TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX goals_world ON goals(world, parent_id);

  CREATE TABLE chunks (
    world       TEXT    NOT NULL,
    dim         TEXT    NOT NULL,
    cx          INTEGER NOT NULL,
    cz          INTEGER NOT NULL,
    surface_y   INTEGER,
    biome       TEXT,
    counts      TEXT    NOT NULL DEFAULT '{}',
    first_seen  INTEGER NOT NULL,
    seen_at     INTEGER NOT NULL,
    PRIMARY KEY (world, dim, cx, cz)
  ) WITHOUT ROWID;

  CREATE TABLE kv (
    world  TEXT NOT NULL,
    key    TEXT NOT NULL,
    value  TEXT NOT NULL,
    PRIMARY KEY (world, key)
  ) WITHOUT ROWID;
  `,
];
/** Throws when this Node build has no `node:sqlite`; touches no file. */
export function requireSqlite() {
    loadSqlite();
}
/** Open (creating if needed) the agent database and bring its schema up to date. */
export function openDatabase(path) {
    if (path !== ":memory:")
        mkdirSync(dirname(path), { recursive: true });
    const { DatabaseSync } = loadSqlite();
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
    migrate(db);
    return db;
}
function migrate(db) {
    const row = db.prepare("PRAGMA user_version").get();
    for (let v = row.user_version; v < MIGRATIONS.length; v++) {
        db.exec("BEGIN");
        try {
            db.exec(MIGRATIONS[v]);
            db.exec(`PRAGMA user_version = ${v + 1}`);
            db.exec("COMMIT");
        }
        catch (err) {
            db.exec("ROLLBACK");
            throw err;
        }
    }
}
/** Run `fn` inside a transaction. */
export function transaction(db, fn) {
    db.exec("BEGIN");
    try {
        const out = fn();
        db.exec("COMMIT");
        return out;
    }
    catch (err) {
        db.exec("ROLLBACK");
        throw err;
    }
}
/** Small per-world key/value store for runtime state (exploration heading, event cursor, ...). */
export class KeyValue {
    db;
    constructor(db) {
        this.db = db;
    }
    get(world, key) {
        const row = this.db.prepare("SELECT value FROM kv WHERE world = ? AND key = ?").get(world, key);
        return row ? JSON.parse(row.value) : undefined;
    }
    set(world, key, value) {
        this.db
            .prepare("INSERT INTO kv(world, key, value) VALUES (?, ?, ?) ON CONFLICT(world, key) DO UPDATE SET value = excluded.value")
            .run(world, key, JSON.stringify(value));
    }
}
//# sourceMappingURL=db.js.map