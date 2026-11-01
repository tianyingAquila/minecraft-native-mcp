import { shortId } from "./format.js";
const SMELT_TYPES = new Set(["smelting", "blasting", "smoking", "campfire_cooking"]);
export function stepKind(recipe) {
    if (recipe.type === "crafting")
        return "craft";
    if (SMELT_TYPES.has(recipe.type))
        return "smelt";
    return "other";
}
export function needsTable(recipe) {
    if (recipe.type !== "crafting")
        return false;
    if (recipe.width !== undefined && recipe.height !== undefined)
        return recipe.width > 2 || recipe.height > 2;
    return recipe.ingredients.length > 4;
}
/** Items obtained by gathering in vanilla are never worth crafting back from storage blocks. */
const RAW_COST = 3;
const PREFER_RAW = /(_log|_wood|_stem|_hyphae|cobblestone|dirt|sand|gravel|clay_ball|string|feather|leather)$/;
/**
 * Plan how to obtain `count` × `target`.
 *
 * @param recipesFor recipes producing an item (empty when it has none) — typically a cache over
 *   `recipes.query` filled before planning via {@link collectRecipes}.
 */
export function plan(target, count, inventory, recipesFor, opts = {}) {
    const maxDepth = opts.maxDepth ?? 12;
    const stock = new Map(Object.entries(inventory).filter(([, n]) => n > 0));
    const steps = [];
    const gather = {};
    const uses = {};
    const locked = new Set();
    const initial = new Map(stock);
    /** Recipes to consider for `id`; `record` notes items whose only recipes are still locked. */
    const usable = (id, record = false) => {
        const all = recipesFor(id).filter((r) => r.result.id === id && r.result.count > 0 && r.ingredients.length > 0);
        const byKind = all.filter((r) => stepKind(r) !== "other" || all.every((o) => stepKind(o) === "other"));
        const known = byKind.filter((r) => r.known);
        if (known.length === 0 && byKind.length > 0 && record)
            locked.add(id);
        return opts.knownOnly || known.length > 0 ? known : byKind;
    };
    /**
     * Rough cost of making one `id` (raw leaves cost {@link RAW_COST}), for choosing recipes and
     * alternatives. Paths back into an item being made are infinitely expensive (ingot → block →
     * ingot); results that depended on such a cut are not memoised, since they depend on the path.
     */
    const costMemo = new Map();
    const cost = (id, depth, visiting) => {
        if ((stock.get(id) ?? 0) > 0)
            return [0, true];
        const memo = costMemo.get(id);
        if (memo !== undefined)
            return [memo, true];
        if (visiting.has(id))
            return [Infinity, false];
        if (depth > maxDepth || PREFER_RAW.test(id))
            return [RAW_COST, true];
        const recipes = usable(id);
        // Items with recipes are made, not found: only recipe-less leaves are gathered. When every
        // recipe loops back (ingot → block → ingot) the cost is infinite along this path.
        if (recipes.length === 0)
            return [RAW_COST, true];
        visiting.add(id);
        let best = Infinity;
        let clean = true;
        for (const r of recipes) {
            let c = 0.1;
            for (const alts of r.ingredients) {
                let slot = Infinity;
                for (const a of alts) {
                    const [v, ok] = cost(a, depth + 1, visiting);
                    if (!ok)
                        clean = false;
                    slot = Math.min(slot, v);
                }
                c += slot;
            }
            best = Math.min(best, c / r.result.count);
        }
        visiting.delete(id);
        if (clean)
            costMemo.set(id, best);
        return [best, clean];
    };
    const take = (id, n) => {
        const have = stock.get(id) ?? 0;
        const used = Math.min(have, n);
        if (used > 0) {
            stock.set(id, have - used);
            if ((initial.get(id) ?? 0) > 0) {
                const fromInitial = Math.min(used, Math.max(0, (initial.get(id) ?? 0) - (uses[id] ?? 0)));
                if (fromInitial > 0)
                    uses[id] = (uses[id] ?? 0) + fromInitial;
            }
        }
        return n - used;
    };
    const obtain = (id, n, depth, path) => {
        let missing = take(id, n);
        if (missing <= 0)
            return;
        const recipes = depth >= maxDepth || path.has(id) || PREFER_RAW.test(id) ? [] : usable(id, true);
        const next = new Set(path).add(id);
        const slotCost = (a) => cost(a, depth + 1, new Set(next))[0];
        const recipe = chooseRecipe(recipes, (alts) => Math.min(...alts.map(slotCost)));
        if (!recipe) {
            gather[id] = (gather[id] ?? 0) + missing;
            return;
        }
        const times = Math.ceil(missing / recipe.result.count);
        const inputs = {};
        for (const alts of recipe.ingredients) {
            const pick = chooseAlternative(alts, stock, slotCost);
            inputs[pick] = (inputs[pick] ?? 0) + times;
        }
        for (const [input, need] of Object.entries(inputs))
            obtain(input, need, depth + 1, next);
        const produced = times * recipe.result.count;
        steps.push({
            kind: stepKind(recipe),
            recipe,
            times,
            output: { id, count: produced },
            inputs,
            needsTable: needsTable(recipe),
        });
        stock.set(id, (stock.get(id) ?? 0) + produced - missing);
        missing = 0;
    };
    obtain(target, count, 0, new Set());
    const leftovers = {};
    for (const [id, n] of stock) {
        const extra = n - (initial.get(id) ?? 0);
        if (extra > 0)
            leftovers[id] = extra;
    }
    return { target: { id: target, count }, steps, gather, uses, locked: [...locked], leftovers };
}
/** The cheapest recipe, or undefined when every one of them loops back into what is being made. */
function chooseRecipe(recipes, slotCost) {
    let best;
    let bestCost = Infinity;
    for (const r of recipes) {
        const c = r.ingredients.reduce((sum, alts) => sum + slotCost(alts), 0) / r.result.count;
        if (c < bestCost) {
            best = r;
            bestCost = c;
        }
    }
    return best;
}
/** Prefer an alternative already in stock (most first), else the cheapest to make. */
function chooseAlternative(alts, stock, cost) {
    let best = alts[0];
    let bestHave = stock.get(best) ?? 0;
    for (const a of alts) {
        const have = stock.get(a) ?? 0;
        if (have > bestHave) {
            best = a;
            bestHave = have;
        }
    }
    if (bestHave > 0)
        return best;
    let bestCost = Infinity;
    for (const a of alts) {
        const c = cost(a);
        if (c < bestCost) {
            best = a;
            bestCost = c;
        }
    }
    return best;
}
/**
 * Breadth-first fetch of every recipe reachable from `target`, batching lookups per depth level.
 * Returns a map item id → recipes producing it (empty array when it has none). Use a fresh cache
 * per planning run: unlocking recipes during play changes the answers.
 */
export async function collectRecipes(target, fetch, cache, maxItems = 200) {
    let frontier = [target];
    const seen = new Set();
    while (frontier.length > 0 && seen.size < maxItems) {
        const want = frontier.filter((id) => !seen.has(id));
        want.forEach((id) => seen.add(id));
        const missing = want.filter((id) => !cache.has(id));
        if (missing.length > 0) {
            const recipes = await fetch(missing);
            for (const id of missing)
                cache.set(id, []);
            for (const r of recipes) {
                const list = cache.get(r.result.id) ?? [];
                list.push(r);
                cache.set(r.result.id, list);
            }
        }
        const next = new Set();
        for (const id of want) {
            if (PREFER_RAW.test(id))
                continue;
            for (const r of cache.get(id) ?? []) {
                // Follow every alternative (the mod caps a slot at 16): holding only cherry logs must
                // still find cherry_planks for a #planks slot. One batched lookup per level keeps it cheap.
                for (const alts of r.ingredients)
                    for (const a of alts)
                        if (!seen.has(a))
                            next.add(a);
            }
        }
        frontier = [...next];
    }
    return cache;
}
/** Human-readable plan. */
export function formatPlan(p) {
    const lines = [];
    const gatherIds = Object.keys(p.gather);
    const verdict = p.steps.length === 0 && gatherIds.length === 0
        ? "already in inventory"
        : gatherIds.length === 0
            ? "craftable now from inventory"
            : "needs materials first";
    lines.push(`# plan ${shortId(p.target.id)} ×${p.target.count} — ${verdict}`);
    if (Object.keys(p.uses).length > 0)
        lines.push(`uses from inventory: ${fmtCounts(p.uses)}`);
    if (gatherIds.length > 0)
        lines.push(`gather: ${fmtCounts(p.gather)}`);
    if (p.locked.length > 0) {
        lines.push(`locked recipes (not unlocked yet, recipe book cannot place them): ${p.locked.map(shortId).join(", ")}`);
    }
    if (p.steps.length > 0) {
        lines.push("steps:");
        p.steps.forEach((s, i) => {
            const where = s.kind === "craft" ? (s.needsTable ? "crafting table" : "inventory 2×2") : s.kind === "smelt" ? s.recipe.type : s.recipe.station ? shortId(s.recipe.station) : s.recipe.type;
            lines.push(`${i + 1}. ${s.kind} ${shortId(s.output.id)} ×${s.output.count} ← ${fmtCounts(s.inputs)} [${where}]${s.times > 1 ? ` (${s.times} crafts)` : ""}`);
        });
    }
    const smelts = p.steps.filter((s) => s.kind === "smelt").reduce((n, s) => n + s.times, 0);
    if (smelts > 0)
        lines.push(`fuel: ${smelts} smelt${smelts === 1 ? "" : "s"} (1 coal or charcoal smelts 8, 1 plank 1.5)`);
    if (Object.keys(p.leftovers).length > 0)
        lines.push(`leftovers: ${fmtCounts(p.leftovers)}`);
    return lines.join("\n");
}
function fmtCounts(c) {
    return Object.entries(c)
        .map(([id, n]) => `${shortId(id)}×${n}`)
        .join(" ");
}
//# sourceMappingURL=planner.js.map