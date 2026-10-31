export function summarizeClient(
  self,
  inventory,
  entities,
  activity = { owner: "idle", activeAction: null },
) {
  const stacks = [...(inventory.hotbar || []), ...(inventory.main || [])].map(
    (i) => ({
      slot: i.slot,
      location: i.slot < 9 ? "hotbar" : "main",
      name: i.id.replace(/^minecraft:/, ""),
      count: i.count,
      held: i.slot === inventory.selectedSlot,
      durability: i.maxDamage
        ? { remaining: i.maxDamage - (i.damage || 0), maximum: i.maxDamage }
        : null,
    }),
  );
  const hostile = entities
    .filter((e) => e.kind === "hostile")
    .sort((a, b) => a.distance - b.distance);
  const groups = new Map();
  for (const e of entities.filter(
    (x) => x.kind === "hostile" || x.kind === "passive",
  )) {
    let group = groups.get(e.type);
    if (!group) {
      group = {
        name: e.type,
        count: 0,
        nearest: {
          distance: e.distance,
          position: { x: e.x, y: e.y, z: e.z },
          uuid: e.uuid,
        },
      };
      groups.set(e.type, group);
    }
    group.count++;
    if (e.distance < group.nearest.distance)
      group.nearest = {
        distance: e.distance,
        position: { x: e.x, y: e.y, z: e.z },
        uuid: e.uuid,
      };
  }
  return {
    result: {
      situation: {
        gameMode: self.gameMode,
        dimension: self.dimension,
        vitals: {
          health: self.health,
          food: self.food,
          saturation: self.saturation,
          airSupplyTicks: self.air,
        },
        position: {
          x: self.x,
          y: self.y,
          z: self.z,
          headingDegrees: ((self.yaw % 360) + 360) % 360,
          onGround: self.onGround,
          inWater: self.inWater,
          inLava: self.inLava ?? null,
        },
        inventory: {
          usedSlots: stacks.length,
          freeSlots: 36 - stacks.length,
          stacks,
          armor: inventory.armor || [],
          offhand: inventory.offhand,
        },
        activity,
        nearby: {
          rangeBlocks: 32,
          hostiles: hostile
            .slice(0, 12)
            .map((e) => ({
              name: e.type,
              uuid: e.uuid,
              distance: e.distance,
              position: { x: e.x, y: e.y, z: e.z },
            })),
          mobs: [...groups.values()]
            .sort((a, b) => a.nearest.distance - b.nearest.distance)
            .slice(0, 16),
          droppedItems: entities.filter((e) => e.kind === "item").slice(0, 16),
        },
        omitted: {
          hostiles: Math.max(0, hostile.length - 12),
          mobGroups: Math.max(0, groups.size - 16),
        },
        observedAt: Date.now(),
      },
    },
  };
}
