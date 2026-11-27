import {setTimeout as delay} from 'node:timers/promises';

const stationType = {
  'minecraft:furnace': 'minecraft:smelting',
  'minecraft:blast_furnace': 'minecraft:blasting',
  'minecraft:smoker': 'minecraft:smoking',
};
const fuelTiers = [
  id => id === 'minecraft:coal' || id === 'minecraft:charcoal' || id === 'minecraft:coal_block' || id === 'minecraft:blaze_rod',
  id => id.endsWith('_planks'),
  id => /_(log|wood|stem|hyphae)$/.test(id),
  id => ['minecraft:stick', 'minecraft:bamboo', 'minecraft:crafting_table', 'minecraft:chest', 'minecraft:barrel', 'minecraft:ladder', 'minecraft:scaffolding', 'minecraft:wooden_pickaxe', 'minecraft:wooden_axe', 'minecraft:wooden_shovel', 'minecraft:wooden_sword', 'minecraft:wooden_hoe'].includes(id),
];
export function isFurnaceFuel(id) {
  const full = typeof id === 'string' && id.includes(':') ? id : `minecraft:${id || ''}`;
  return fuelTiers.some(match => match(full));
}
function pickFuel(inventory, avoidInput) {
  const stacks = stacksOf(inventory);
  for (const match of fuelTiers) {
    const preferred = stacks.find(stack => match(stack.id) && stack.id !== avoidInput);
    if (preferred) return preferred;
  }
  for (const match of fuelTiers) {
    const fallback = stacks.find(stack => match(stack.id));
    if (fallback) return fallback;
  }
  return null;
}
const stacksOf = inventory => [...inventory.hotbar, ...inventory.main];
const countOf = (inventory, item) => stacksOf(inventory).filter(stack => stack.id === item).reduce((sum, stack) => sum + stack.count, 0);

export async function cookBatch({x, y, z, item, count}, {call, open, close, readMenu, recipes, signal}) {
  if (![x, y, z].every(Number.isFinite) || !Number.isInteger(count) || count < 1 || count > 12 || typeof item !== 'string') {
    throw Error('批量烹饪需要熔炉坐标、原料物品和1–12份数量。');
  }
  const input = item.includes(':') ? item : `minecraft:${item}`;
  const position = {x: Math.floor(x), y: Math.floor(y), z: Math.floor(z)};
  const initial = await call('player.getState');
  const before = await call('player.getInventory');
  const click = (slot, button = 0) => call('container.click', {slot, button, mode: 'pickup'});
  const readInventory = () => call('player.getInventory');
  let opened = false;
  let outputItem, previousOutput = 0;
  try {
    await call('screen.close');
    await open(position);
    opened = true;
    let menu = await readMenu();
    const recipe = recipes?.recipes.find(entry => entry.type === stationType[menu.type] && entry.inputs.includes(input));
    if (!menu.open || !menu.furnace || !recipe) throw Error('该位置没有可用熔炉，或原料没有该炉型的已确认配方。');
    const menuId = menu.containerId;
    outputItem = recipe.result.id;
    previousOutput = countOf(before, outputItem);
    const refresh = async () => {
      menu = await readMenu();
      if (!menu.open || menu.containerId !== menuId || !menu.furnace) throw Error('熔炉窗口已关闭或改变。');
      return menu.furnace;
    };
    const move = async (sourceItem, destination, quantity) => {
      let remaining = quantity;
      for (const stack of stacksOf(await readInventory()).filter(entry => entry.id === sourceItem)) {
        if (remaining <= 0) break;
        signal?.throwIfAborted();
        const source = menu.playerMenuSlots?.find(entry => entry.inventorySlot === stack.slot)?.menuSlot;
        if (!Number.isInteger(source) || !menu.carried?.empty) throw Error('无法安全确认玩家槽位或光标状态。');
        const moved = Math.min(remaining, stack.count);
        await click(source);
        if (moved === stack.count) await click(destination);
        else for (let i = 0; i < moved; i++) await click(destination, 1);
        await refresh();
        if (!menu.carried?.empty) { await click(source); await refresh(); }
        if (!menu.carried?.empty) throw Error('光标物品未能归位。');
        remaining -= moved;
      }
      if (remaining > 0) throw Error('背包里的原料或燃料数量不足。');
    };
    const wanted = count * recipe.result.count;
    const furnace = menu.furnace;
    if ((furnace.input.count && furnace.input.id !== input) || (furnace.output.count && furnace.output.id !== outputItem)) {
      throw Error('熔炉有其他原料或产物，请先腾空相关槽位。');
    }
    const needed = Math.max(0, count - furnace.input.count - Math.floor(furnace.output.count / recipe.result.count));
    if (countOf(before, input) < needed) throw Error('背包没有足够的指定原料。');
    if (needed) {
      await move(input, 0, needed);
      if (countOf(before, input) - countOf(await readInventory(), input) !== needed) throw Error('原料装入数量未核对一致。');
    }
    const deadline = Date.now() + Math.min(170000, Math.max(15000, count * recipe.cookingTicks * 60 + 10000));
    let reason = 'time_limit';
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const state = await call('player.getState');
      if (state.dimension !== initial.dimension || state.health <= 10 || state.health < initial.health - 2 || state.inLava) {
        return {status: 'interrupted', reason: 'player_danger', gained: 0};
      }
      const current = await refresh();
      if (current.output.count >= wanted) { reason = 'completed'; break; }
      if (!current.input.count || current.blockers.length) { reason = 'furnace_blocked'; break; }
      if (current.burning === false && !current.fuel.count) {
        const fuel = pickFuel(await readInventory(), input);
        if (!fuel) { reason = 'no_fuel'; break; }
        await move(fuel.id, 1, 1);
      }
      await delay(750, undefined, {signal});
    }
    if (menu.furnace.output.id === outputItem && menu.furnace.output.count > 0) {
      await call('container.transfer', {direction: 'take', item: outputItem, count: wanted});
      await delay(200, undefined, {signal});
    }
    const gained = countOf(await readInventory(), outputItem) - previousOutput;
    return {status: gained >= wanted ? 'succeeded' : 'interrupted', reason: gained >= wanted ? 'completed' : reason === 'completed' ? 'pickup_not_confirmed' : reason, item: outputItem, gained, wanted};
  } finally {
    if (opened) await close().catch(() => {});
  }
}
