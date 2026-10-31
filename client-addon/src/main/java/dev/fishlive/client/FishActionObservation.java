package dev.fishlive.client;

import com.google.gson.JsonObject;
import dev.mcpfabric.client.ClientMc;
import dev.mcpfabric.bridge.RpcException;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;

/** Observations only: never changes damage, targeting, movement, or game rules. */
final class FishActionObservation {
    private static boolean active, targetDeathObserved;
    private static float healthBefore, lowestHealth;
    private static LivingEntity watchedTarget;
    private static String targetUuid = "", targetType = "";

    static void initialize() {
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            if (!active) return;
            if (client.player == null || client.level == null) { active = false; watchedTarget = null; return; }
            lowestHealth = Math.min(lowestHealth, client.player.getHealth());
            if (watchedTarget != null && watchedTarget.isDeadOrDying()) targetDeathObserved = true;
        });
    }
    static JsonObject begin() throws RpcException {
        healthBefore = lowestHealth = ClientMc.player().getHealth();
        targetDeathObserved = false; watchedTarget = null; targetUuid = ""; targetType = ""; active = true;
        return new JsonObject();
    }
    static void watch(Entity entity) {
        if (!active || !(entity instanceof LivingEntity living)) return;
        watchedTarget = living; targetUuid = entity.getUUID().toString();
        targetType = BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString();
        if (living.isDeadOrDying()) targetDeathObserved = true;
    }
    static JsonObject finish() throws RpcException {
        JsonObject result = new JsonObject();
        if (!active) return result;
        float after = ClientMc.player().getHealth();
        lowestHealth = Math.min(lowestHealth, after);
        if (watchedTarget != null && watchedTarget.isDeadOrDying()) targetDeathObserved = true;
        result.addProperty("healthBefore", healthBefore);
        result.addProperty("lowestHealthObserved", lowestHealth);
        result.addProperty("healthAfter", after);
        result.addProperty("targetDeathObserved", targetDeathObserved);
        if (!targetUuid.isEmpty()) { result.addProperty("targetUuid", targetUuid); result.addProperty("targetType", targetType); }
        active = false; watchedTarget = null;
        return result;
    }
}
