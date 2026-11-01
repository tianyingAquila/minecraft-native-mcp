export class Body {
    bridge;
    constructor(bridge) {
        this.bridge = bridge;
    }
    session() {
        return this.bridge.call("session.info");
    }
    self() {
        return this.bridge.call("player.getState");
    }
    inventory() {
        return this.bridge.call("player.getInventory");
    }
    /** Item id → total count over hotbar and main inventory. */
    async itemCounts() {
        const inv = await this.inventory();
        const counts = {};
        for (const it of [...inv.hotbar, ...inv.main])
            counts[it.id] = (counts[it.id] ?? 0) + it.count;
        return counts;
    }
    scan(opts = {}) {
        return this.bridge.call("perception.scan", opts);
    }
    async blocks(positions, opts = {}) {
        const r = await this.bridge.call("perception.blocks", { positions, ...opts });
        return r.blocks;
    }
    /** Entities around the player, nearest first; `kinds` filters (item, hostile, passive, player). */
    async entities(radius, kinds = []) {
        const r = await this.bridge.call("perception.entities", { radius, kinds });
        return r.entities;
    }
    /** Attack an entity; ok is false when it was out of reach and nothing was sent. */
    attack(uuid) {
        return this.bridge.call("interact.attackEntity", { uuid });
    }
    pathTo(target, opts = {}) {
        return this.bridge.call("nav.pathTo", { ...target, ...opts });
    }
    navStatus() {
        return this.bridge.call("nav.status");
    }
    navStop() {
        return this.bridge.call("nav.stop");
    }
    lookAt(p) {
        return this.bridge.call("control.lookAt", { ...p });
    }
    breakBlock(p) {
        return this.bridge.call("interact.breakBlock", { ...p, mode: "survival" });
    }
    stopBreaking() {
        return this.bridge.call("interact.stopBreaking");
    }
    placeBlock(against, face) {
        return this.bridge.call("interact.placeBlock", { x: against.x, y: against.y, z: against.z, face });
    }
    selectHotbar(slot) {
        return this.bridge.call("inventory.selectHotbar", { slot });
    }
    /** Swap two player-inventory slots (0-8 hotbar, 9-35 main). */
    swapSlots(slotA, slotB) {
        return this.bridge.call("inventory.swapSlots", { slotA, slotB });
    }
    containerOpen(p) {
        return this.bridge.call("container.open", { ...p });
    }
    containerState() {
        return this.bridge.call("container.state");
    }
    containerClick(slot, mode, button = 0) {
        return this.bridge.call("container.click", { slot, mode, button });
    }
    containerTransfer(direction, item, count) {
        return this.bridge.call("container.transfer", { direction, item, count });
    }
    containerClose() {
        return this.bridge.call("container.close");
    }
    async recipes(items, includeUnknown = true) {
        const r = await this.bridge.call("recipes.query", { items, includeUnknown });
        return r.recipes;
    }
    placeRecipe(ref, all) {
        return this.bridge.call("craft.place", { ref, all });
    }
}
//# sourceMappingURL=body.js.map