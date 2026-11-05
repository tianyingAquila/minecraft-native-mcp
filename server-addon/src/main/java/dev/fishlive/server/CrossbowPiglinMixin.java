package dev.fishlive.server;

import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.monster.piglin.Piglin;
import net.minecraft.world.entity.monster.piglin.PiglinAi;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Items;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import java.util.Optional;

/** An explicit assistance rule, enabled only for the managed local server. */
@Mixin(PiglinAi.class)
public abstract class CrossbowPiglinMixin {
    private static boolean fish$ignore(Piglin piglin,LivingEntity target) {
        return System.getProperty("fish.assistDirectory")!=null
            && piglin.getMainHandItem().is(Items.CROSSBOW)
            && target instanceof Player && target.getName().getString().equals("DeepSeekFish");
    }
    @Inject(method="findNearestValidAttackTarget",at=@At("RETURN"),cancellable=true)
    private static void fish$filter(ServerLevel level,Piglin piglin,CallbackInfoReturnable<Optional<? extends LivingEntity>> cir) {
        if(cir.getReturnValue().isPresent()&&fish$ignore(piglin,cir.getReturnValue().get()))cir.setReturnValue(Optional.empty());
    }
    @Inject(method="isNearestValidAttackTarget",at=@At("HEAD"),cancellable=true)
    private static void fish$invalid(ServerLevel level,Piglin piglin,LivingEntity target,CallbackInfoReturnable<Boolean> cir) {
        if(fish$ignore(piglin,target))cir.setReturnValue(false);
    }
}
