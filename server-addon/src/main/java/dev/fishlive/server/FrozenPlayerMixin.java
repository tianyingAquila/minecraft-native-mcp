package dev.fishlive.server;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.damagesource.DamageSource;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Vanilla tick freeze exempts players; paused sessions must freeze this player too. */
@Mixin(ServerPlayer.class)
public abstract class FrozenPlayerMixin {
    @Unique private boolean fish$isPaused(){
        ServerPlayer p=(ServerPlayer)(Object)this;
        return p.server.tickRateManager().isFrozen()&&p.getGameProfile().getName().equals("DeepSeekFish");
    }
    @Inject(method="doTick",at=@At("HEAD"),cancellable=true)
    private void fish$freezePlayer(CallbackInfo ci){if(fish$isPaused())ci.cancel();}
    @Inject(method="hurtServer",at=@At("HEAD"),cancellable=true)
    private void fish$freezeDamage(ServerLevel level,DamageSource source,float amount,CallbackInfoReturnable<Boolean> cir){if(fish$isPaused())cir.setReturnValue(false);}
}
