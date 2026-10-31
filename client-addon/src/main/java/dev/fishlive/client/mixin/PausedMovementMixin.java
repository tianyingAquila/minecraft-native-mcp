package dev.fishlive.client.mixin;
import dev.fishlive.client.FishLiveClient;
import net.minecraft.client.player.LocalPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(LocalPlayer.class)
public abstract class PausedMovementMixin {
    @Inject(method="aiStep",at=@At("HEAD"),cancellable=true)
    private void fish$pauseMovement(CallbackInfo ci){if(FishLiveClient.paused)ci.cancel();}
}
