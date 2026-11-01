package dev.fishlive.client.mixin;
import dev.fishlive.client.FishHud;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.DeltaTracker;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Gui.class)
public abstract class GameHudMixin {
    @Inject(method="render",at=@At("TAIL"))
    private void fish$render(GuiGraphics graphics,DeltaTracker delta,CallbackInfo ci){FishHud.render(graphics,delta);}
}
