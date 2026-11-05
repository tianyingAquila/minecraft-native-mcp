package dev.fishlive.server;

import net.minecraft.server.MinecraftServer;
import dev.fishlive.assistance.FishAssistance;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import java.util.function.BooleanSupplier;

@Mixin(MinecraftServer.class)
public abstract class AssistanceTickMixin {
    @Inject(method="tickServer",at=@At("HEAD"))
    private void fish$assistance(BooleanSupplier budget, CallbackInfo ci) {
        FishAssistance.tick((MinecraftServer)(Object)this);
    }
}
