export const GOAL_STATUSES = ["pending", "active", "blocked", "done", "failed", "dropped"];
const OPEN = new Set(["pending", "active", "blocked"]);
export function isOpen(status) {
    return OPEN.has(status);
}
function toGoal(r) {
    return {
        id: r.id,
        parentId: r.parent_id,
        title: r.title,
        detail: r.detail,
        doneWhen: r.done_when,
        status: r.status,
        priority: r.priority,
        outcome: r.outcome,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}
/** Sibling order: active first, then by priority (high first), then creation order. */
function siblingOrder(a, b) {
    const act = Number(b.status === "active") - Number(a.status === "active");
    if (act !== 0)
        return act;
    if (a.priority !== b.priority)
        return b.priority - a.priority;
    return a.id - b.id;
}
export class GoalStore {
    db;
    constructor(db) {
        this.db = db;
    }
    add(world, g, now = Date.now()) {
        if (g.parentId != null && !this.get(world, g.parentId)) {
            throw new Error(`No goal #${g.parentId} in this world.`);
        }
        const info = this.db
            .prepare(`INSERT INTO goals(world, parent_id, title, detail, done_when, status, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(world, g.parentId ?? null, g.title.trim(), (g.detail ?? "").trim(), (g.doneWhen ?? "").trim(), g.status ?? "pending", g.priority ?? 0, now, now);
        return this.get(world, Number(info.lastInsertRowid));
    }
    get(world, id) {
        const row = this.db.prepare("SELECT * FROM goals WHERE world = ? AND id = ?").get(world, id);
        return row ? toGoal(row) : undefined;
    }
    all(world) {
        return this.db.prepare("SELECT * FROM goals WHERE world = ? ORDER BY id").all(world).map(toGoal);
    }
    update(world, id, patch, now = Date.now()) {
        const goal = this.get(world, id);
        if (!goal)
            throw new Error(`No goal #${id} in this world.`);
        if (patch.parentId != null) {
            if (patch.parentId === id || this.ancestors(world, patch.parentId).some((a) => a.id === id)) {
                throw new Error(`Goal #${patch.parentId} is inside #${id}; that would create a cycle.`);
            }
            if (!this.get(world, patch.parentId))
                throw new Error(`No goal #${patch.parentId} in this world.`);
        }
        const sets = [];
        const args = [];
        const set = (col, v) => {
            sets.push(`${col} = ?`);
            args.push(v);
        };
        if (patch.title !== undefined)
            set("title", patch.title.trim());
        if (patch.detail !== undefined)
            set("detail", patch.detail.trim());
        if (patch.doneWhen !== undefined)
            set("done_when", patch.doneWhen.trim());
        if (patch.status !== undefined)
            set("status", patch.status);
        if (patch.priority !== undefined)
            set("priority", patch.priority);
        if (patch.outcome !== undefined)
            set("outcome", patch.outcome.trim());
        if (patch.parentId !== undefined)
            set("parent_id", patch.parentId);
        if (sets.length === 0)
            return goal;
        set("updated_at", now);
        args.push(world, id);
        this.db.prepare(`UPDATE goals SET ${sets.join(", ")} WHERE world = ? AND id = ?`).run(...args);
        return this.get(world, id);
    }
    delete(world, id) {
        return Number(this.db.prepare("DELETE FROM goals WHERE world = ? AND id = ?").run(world, id).changes) > 0;
    }
    /** Parents of `id` from the root down (excluding `id`). */
    ancestors(world, id) {
        const out = [];
        const seen = new Set();
        let cur = this.get(world, id);
        while (cur && cur.parentId != null && !seen.has(cur.parentId)) {
            seen.add(cur.parentId);
            cur = this.get(world, cur.parentId);
            if (cur)
                out.unshift(cur);
        }
        return out;
    }
    /**
     * The goal to work on now: the first open leaf (no open subgoals) in tree order, skipping blocked
     * goals and anything under a closed parent. Returns it with its ancestor path.
     */
    next(world) {
        const goals = this.all(world);
        const children = childMap(goals);
        const walk = (parentId, path) => {
            const kids = (children.get(parentId) ?? []).filter((g) => isOpen(g.status)).sort(siblingOrder);
            for (const g of kids) {
                if (g.status === "blocked")
                    continue;
                const deeper = walk(g.id, [...path, g]);
                if (deeper)
                    return deeper;
                const openKids = (children.get(g.id) ?? []).some((k) => isOpen(k.status));
                if (!openKids)
                    return { goal: g, path };
            }
            return undefined;
        };
        return walk(null, []);
    }
}
function childMap(goals) {
    const map = new Map();
    const ids = new Set(goals.map((g) => g.id));
    for (const g of goals) {
        const key = g.parentId !== null && ids.has(g.parentId) ? g.parentId : null;
        const list = map.get(key) ?? [];
        list.push(g);
        map.set(key, list);
    }
    return map;
}
/** Render the goal tree as indented lines. Closed subtrees collapse unless `all` is set. */
export function formatGoalTree(goals, opts = {}) {
    const children = childMap(goals);
    const lines = [];
    let hiddenClosed = 0;
    const walk = (parentId, depth) => {
        const kids = [...(children.get(parentId) ?? [])].sort(siblingOrder);
        for (const g of kids) {
            if (!opts.all && !isOpen(g.status)) {
                hiddenClosed++;
                continue;
            }
            const marker = g.id === opts.nextId ? " ◀ next" : "";
            let line = `${"  ".repeat(depth)}#${g.id} [${g.status}] ${g.title}`;
            if (g.priority !== 0)
                line += ` (p${g.priority})`;
            if (g.doneWhen)
                line += ` — done when: ${g.doneWhen}`;
            if (g.outcome && !isOpen(g.status))
                line += ` → ${g.outcome}`;
            else if (g.outcome)
                line += ` · note: ${g.outcome}`;
            lines.push(line + marker);
            walk(g.id, depth + 1);
        }
    };
    walk(null, 0);
    if (hiddenClosed > 0)
        lines.push(`(${hiddenClosed} closed goal${hiddenClosed === 1 ? "" : "s"} hidden; all=true shows them)`);
    return lines.join("\n");
}
//# sourceMappingURL=goals.js.map