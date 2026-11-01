/** Shared value types and compact text formatting for agent tool output. */
export function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
export function horizontalDistance(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
}
/** `minecraft:iron_ore` → `iron_ore`; modded ids keep their namespace. */
export function shortId(id) {
    return id.startsWith("minecraft:") ? id.slice("minecraft:".length) : id;
}
/** Accepts `iron_ore` or `minecraft:iron_ore` and returns the namespaced id. */
export function fullId(id) {
    const trimmed = id.trim().toLowerCase();
    return trimmed.includes(":") ? trimmed : `minecraft:${trimmed}`;
}
export function shortDim(dim) {
    return shortId(dim).replace(/^the_/, "");
}
export function fmtPos(p) {
    return `${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}`;
}
export function fmtDistance(meters) {
    return meters >= 10_000 ? `${(meters / 1000).toFixed(1)}km` : `${Math.round(meters)}m`;
}
/** Age of a timestamp relative to `now`: `now`, `40s`, `12m`, `3h`, `5d`. */
export function fmtAge(then, now = Date.now()) {
    const s = Math.max(0, Math.round((now - then) / 1000));
    if (s < 5)
        return "now";
    if (s < 60)
        return `${s}s`;
    if (s < 3600)
        return `${Math.round(s / 60)}m`;
    if (s < 86_400)
        return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86_400)}d`;
}
/** `seen just now` / `seen 12m ago`. */
export function fmtSeen(then, now = Date.now()) {
    const age = fmtAge(then, now);
    return age === "now" ? "seen just now" : `seen ${age} ago`;
}
export function truncate(text, max) {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
/** `{"minecraft:coal": 3, "create:zinc_ingot": 2}` → `coal×3 create:zinc_ingot×2`. */
export function fmtItems(items, limit = 24) {
    const entries = Object.entries(items)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]);
    const shown = entries.slice(0, limit).map(([id, n]) => `${shortId(id)}×${n}`);
    if (entries.length > limit)
        shown.push(`+${entries.length - limit} more`);
    return shown.join(" ");
}
//# sourceMappingURL=format.js.map