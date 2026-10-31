package dev.fishlive.client;

import baritone.api.BaritoneAPI;
import baritone.api.pathing.goals.GoalNear;
import com.google.gson.JsonObject;
import com.google.gson.JsonArray;
import com.mojang.blaze3d.platform.NativeImage;
import dev.mcpfabric.McpFabric;
import dev.mcpfabric.bridge.RpcException;
import dev.mcpfabric.client.BotController;
import dev.mcpfabric.client.ClientMc;
import dev.mcpfabric.handlers.support.Gates;
import net.fabricmc.api.ClientModInitializer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.core.component.DataComponents;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.projectile.ProjectileUtil;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import org.lwjgl.glfw.GLFW;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;

/** Narrow client actions share mcpfabric's authenticated bridge and game thread. */
public final class FishLiveClient implements ClientModInitializer {
    public static volatile boolean paused;
    private static BlockPos target;
    private static double reach;
    private static Vec3 exactTarget;
    private static long navigationStarted;

    @Override public void onInitializeClient() {
        FishHud.initialize();
        FishActionObservation.initialize();
        var router=McpFabric.router();
        router.register("fish.hudStatus",ctx->ClientMc.call(FishHud::status));
        router.register("fish.actionStart",ctx->ClientMc.call(FishActionObservation::begin));
        router.register("fish.actionFinish",ctx->ClientMc.call(FishActionObservation::finish));
        router.register("fish.context",ctx->ClientMc.call(FishLiveClient::context));
        router.register("fish.spatialScan",ctx->ClientMc.call(FishSpatialScan::scan));
        router.register("fish.probeBlocks",ctx->ClientMc.call(()->{
            Gates.vision();JsonArray blocks=new JsonArray();
            for(double[] p:ctx.getVec3List("positions",64))blocks.add(blockInfo(BlockPos.containing(p[0],p[1],p[2])));
            JsonObject result=new JsonObject();result.add("blocks",blocks);return result;
        }));
        router.register("fish.pause",ctx->ClientMc.call(()->{Gates.playerControl();cancel();paused=true;JsonObject o=new JsonObject();o.addProperty("paused",true);return o;}));
        router.register("fish.resume",ctx->ClientMc.call(()->{Gates.playerControl();paused=false;JsonObject o=new JsonObject();o.addProperty("paused",false);return o;}));
        router.register("fish.stopUsing",ctx->ClientMc.call(()->{Gates.playerControl();var mc=ClientMc.mc();if(mc.player!=null&&mc.gameMode!=null&&mc.player.isUsingItem())mc.gameMode.releaseUsingItem(mc.player);mc.options.keyUse.setDown(false);JsonObject o=new JsonObject();o.addProperty("released",true);return o;}));
        router.register("fish.navigate",ctx->ClientMc.call(()->{
            Gates.playerControl();cancel();
            target=BlockPos.containing(ctx.getDouble("x"),ctx.getDouble("y"),ctx.getDouble("z"));
            exactTarget=new Vec3(ctx.getDouble("x"),ctx.getDouble("y"),ctx.getDouble("z"));
            reach=Math.max(0.3,Math.min(8,ctx.has("reach")?ctx.getDouble("reach"):2));
            navigationStarted=System.currentTimeMillis();
            BaritoneAPI.getSettings().allowInventory.value=true;
            BaritoneAPI.getSettings().chatControl.value=false;
            BaritoneAPI.getSettings().echoCommands.value=false;
            BaritoneAPI.getProvider().getPrimaryBaritone().getCustomGoalProcess().setGoalAndPath(new GoalNear(target,Math.max(0,(int)Math.floor(reach-0.75))));
            JsonObject o=new JsonObject();o.addProperty("started",true);return o;
        }));
        router.register("fish.navigationStatus",ctx->ClientMc.call(()->{
            Gates.playerControl();var p=ClientMc.player();var b=BaritoneAPI.getProvider().getPrimaryBaritone();
            JsonObject o=new JsonObject();boolean reached=exactTarget!=null&&p.position().distanceTo(exactTarget)<=reach;
            boolean active=b.getCustomGoalProcess().isActive()||b.getPathingBehavior().isPathing();
            boolean planning=exactTarget!=null&&System.currentTimeMillis()-navigationStarted<1500;
            o.addProperty("active",(active||planning)&&!reached);o.addProperty("state",reached?"reached":active?"navigating":planning?"planning":"stopped");
            if(exactTarget!=null)o.addProperty("distance",p.position().distanceTo(exactTarget));
            return o;
        }));
        router.register("fish.cancel",ctx->ClientMc.call(()->{Gates.playerControl();cancel();JsonObject o=new JsonObject();o.addProperty("stopped",true);return o;}));
        router.register("fish.equip",ctx->ClientMc.call(()->{
            Gates.playerControl();equip(ctx.getInt("slot"),ctx.optInt("hotbarSlot",0));
            JsonObject o=new JsonObject();o.addProperty("selected",true);return o;
        }));
        router.register("fish.eat",ctx->ClientMc.call(()->{
            Gates.playerControl();var p=ClientMc.player();JsonObject o=new JsonObject();
            if(!p.canEat(false)){o.addProperty("alreadyFull",true);return o;}
            int slot=-1;for(int i=0;i<36;i++)if(p.getInventory().getItem(i).get(DataComponents.FOOD)!=null){slot=i;break;}
            if(slot<0)throw RpcException.badRequest("No food in inventory.");
            equip(slot,0);ClientMc.mc().options.keyUse.setDown(true);ClientMc.gameMode().useItem(p,InteractionHand.MAIN_HAND);
            o.addProperty("started",true);return o;
        }));
        router.register("fish.attack",ctx->ClientMc.call(()->{
            Gates.playerControl();var p=ClientMc.player();UUID uuid=UUID.fromString(ctx.getString("uuid"));
            Entity targetEntity=null;for(Entity e:ClientMc.level().entitiesForRendering())if(e.getUUID().equals(uuid)){targetEntity=e;break;}
            JsonObject o=new JsonObject();
            if(targetEntity==null){o.addProperty("missing",true);return o;}
            FishActionObservation.watch(targetEntity);
            if(targetEntity instanceof net.minecraft.world.entity.LivingEntity living && living.isDeadOrDying()) {
                o.addProperty("deathObserved",true); return o;
            }
            if(!p.canInteractWithEntity(targetEntity,0))throw RpcException.badRequest("Target is out of melee reach.");
            Vec3 eye=p.getEyePosition(),aim=targetEntity.getBoundingBox().getCenter();
            lookAt(aim);
            var entityHit=ProjectileUtil.getEntityHitResult(p,eye,aim,p.getBoundingBox().expandTowards(aim.subtract(eye)).inflate(1),e->!e.isSpectator()&&e.isPickable(),p.entityInteractionRange()*p.entityInteractionRange());
            var blockHit=ClientMc.level().clip(new ClipContext(eye,aim,ClipContext.Block.COLLIDER,ClipContext.Fluid.NONE,p));
            if(entityHit==null||entityHit.getEntity()!=targetEntity||(blockHit.getType()==HitResult.Type.BLOCK&&eye.distanceToSqr(blockHit.getLocation())<eye.distanceToSqr(entityHit.getLocation())))throw RpcException.badRequest("Target is obstructed; move to a clear line of sight.");
            if(p.getAttackStrengthScale(0.5f)<0.9f){o.addProperty("cooldown",true);return o;}
            ClientMc.gameMode().attack(p,targetEntity);p.swing(InteractionHand.MAIN_HAND);o.addProperty("attacked",true);return o;
        }));
        router.register("fish.useBlock",ctx->ClientMc.call(()->{
            Gates.playerControl();BlockPos pos=BlockPos.containing(ctx.getDouble("x"),ctx.getDouble("y"),ctx.getDouble("z"));
            var p=ClientMc.player();
            var result=ClientMc.gameMode().useItemOn(p,InteractionHand.MAIN_HAND,visibleBlock(pos,null));
            JsonObject o=new JsonObject();o.addProperty("result",result.toString());return o;
        }));
        router.register("fish.checkBlock",ctx->ClientMc.call(()->{
            Gates.playerControl();var pos=BlockPos.containing(ctx.getDouble("x"),ctx.getDouble("y"),ctx.getDouble("z"));
            String name=ctx.optString("face","");Direction face=name.isEmpty()?null:Direction.byName(name);
            visibleBlock(pos,face,false);JsonObject o=new JsonObject();o.addProperty("visible",true);return o;
        }));
        router.register("fish.placeBlock",ctx->ClientMc.call(()->{
            Gates.playerControl();var pos=BlockPos.containing(ctx.getDouble("x"),ctx.getDouble("y"),ctx.getDouble("z"));
            Direction face=Direction.byName(ctx.getString("face"));if(face==null)throw RpcException.badRequest("Invalid block face.");
            if(!(ClientMc.player().getMainHandItem().getItem() instanceof BlockItem))throw RpcException.badRequest("Held item is not a block. Equip an actual block before placing.");
            var result=ClientMc.gameMode().useItemOn(ClientMc.player(),InteractionHand.MAIN_HAND,visibleBlock(pos,face));
            JsonObject o=new JsonObject();o.addProperty("result",result.toString());return o;
        }));
        router.register("fish.screenshot",ctx->{
            Gates.vision();CompletableFuture<JsonObject> future=new CompletableFuture<>();
            Minecraft.getInstance().execute(()->{
                try{future.complete(capture());}catch(Exception e){future.completeExceptionally(e);}
            });
            try{return future.get(8,TimeUnit.SECONDS);}
            catch(InterruptedException e){Thread.currentThread().interrupt();throw RpcException.unavailable("Game frame request was interrupted.");}
            catch(Exception e){throw RpcException.unavailable("Game frame could not be captured before timeout.");}
        });
    }

    private static void lookAt(Vec3 aim) throws RpcException {
        var p=ClientMc.player();Vec3 d=aim.subtract(p.getEyePosition());
        p.setYRot((float)(Math.toDegrees(Math.atan2(d.z,d.x))-90));
        p.setXRot((float)-Math.toDegrees(Math.atan2(d.y,Math.sqrt(d.x*d.x+d.z*d.z))));
    }

    private static BlockHitResult visibleBlock(BlockPos pos,Direction face) throws RpcException {
        return visibleBlock(pos,face,true);
    }
    private static BlockHitResult visibleBlock(BlockPos pos,Direction face,boolean turn) throws RpcException {
        var p=ClientMc.player();if(!p.canInteractWithBlock(pos,0))throw RpcException.badRequest("Block is out of interaction reach.");
        if(ClientMc.level().getBlockState(pos).isAir())throw RpcException.badRequest("Support block is AIR at "+pos.toShortString()+"; use place_block_at for a target empty position, or choose a real supporting block.");
        Vec3 aim=Vec3.atCenterOf(pos);if(face!=null)aim=aim.add(face.getStepX()*0.499,face.getStepY()*0.499,face.getStepZ()*0.499);
        BlockHitResult hit=null;
        for(double u:new double[]{0,-0.3,0.3})for(double v:new double[]{0,-0.3,0.3}){
            Vec3 sample=face==null?aim.add(u,v,0):face.getAxis()==Direction.Axis.Y?aim.add(u,0,v):face.getAxis()==Direction.Axis.X?aim.add(0,u,v):aim.add(u,v,0);
            hit=ClientMc.level().clip(new ClipContext(p.getEyePosition(),sample,ClipContext.Block.OUTLINE,ClipContext.Fluid.NONE,p));
            if(hit.getType()==HitResult.Type.BLOCK&&hit.getBlockPos().equals(pos)&&(face==null||hit.getDirection()==face)){if(turn)lookAt(hit.getLocation());return hit;}
        }
        throw RpcException.badRequest("Block or requested face is obstructed; first hit "+(hit!=null&&hit.getType()==HitResult.Type.BLOCK?BuiltInRegistries.BLOCK.getKey(ClientMc.level().getBlockState(hit.getBlockPos()).getBlock())+" @ "+hit.getBlockPos().toShortString():"nothing")+"; target "+pos.toShortString()+". Query context, approach a visible face or mine the blocking block.");
    }

    private static JsonObject blockInfo(BlockPos pos) throws RpcException {
        var level=ClientMc.level();var state=level.getBlockState(pos);JsonObject o=new JsonObject();
        o.addProperty("x",pos.getX());o.addProperty("y",pos.getY());o.addProperty("z",pos.getZ());
        boolean loaded=level.hasChunkAt(pos)&&pos.getY()>=level.getMinY()&&pos.getY()<level.getMaxY();
        o.addProperty("loaded",loaded);if(!loaded)return o;
        o.addProperty("id",BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
        o.addProperty("air",state.isAir());o.addProperty("hardness",state.getDestroySpeed(level,pos));
        o.addProperty("fullSupport",state.isFaceSturdy(level,pos,Direction.UP));
        o.addProperty("falling",state.getBlock() instanceof net.minecraft.world.level.block.FallingBlock);
        o.addProperty("blockEntity",state.hasBlockEntity());
        o.addProperty("collision",!state.getCollisionShape(level,pos).isEmpty());o.addProperty("fluid",!state.getFluidState().isEmpty());return o;
    }
    private static JsonObject context() throws RpcException {
        var mc=ClientMc.mc();var p=ClientMc.player();var feet=p.blockPosition();var eye=BlockPos.containing(p.getEyePosition());JsonObject o=new JsonObject();
        o.add("feet",blockInfo(feet));o.add("head",blockInfo(eye));o.add("ground",blockInfo(feet.below()));
        o.addProperty("horizontalCollision",p.horizontalCollision);o.addProperty("verticalCollision",p.verticalCollision);
        o.addProperty("screen",mc.screen==null?"none":mc.screen instanceof AbstractContainerScreen?"container":mc.screen instanceof PauseScreen?"pause":"other");
        JsonObject sides=new JsonObject();
        for(Direction d:new Direction[]{Direction.NORTH,Direction.SOUTH,Direction.EAST,Direction.WEST}){
            JsonObject side=new JsonObject();side.add("feet",blockInfo(feet.relative(d)));side.add("head",blockInfo(eye.relative(d)));side.add("ground",blockInfo(feet.relative(d).below()));sides.add(d.getName(),side);
        }
        o.add("adjacent",sides);var hit=p.pick(p.blockInteractionRange(),1,false);
        if(hit instanceof BlockHitResult b&&hit.getType()==HitResult.Type.BLOCK){JsonObject target=blockInfo(b.getBlockPos());target.addProperty("face",b.getDirection().getName());target.addProperty("distance",p.getEyePosition().distanceTo(b.getLocation()));o.add("crosshair",target);}
        return o;
    }

    private static void equip(int slot,int hotbar) throws RpcException {
        if(slot<0||slot>35||hotbar<0||hotbar>8)throw RpcException.badRequest("Invalid inventory slot.");
        var p=ClientMc.player();
        if(slot>8){ClientMc.gameMode().handleInventoryMouseClick(p.inventoryMenu.containerId,slot,hotbar,ClickType.SWAP,p);slot=hotbar;}
        p.getInventory().selected=slot;
        p.connection.send(new net.minecraft.network.protocol.game.ServerboundSetCarriedItemPacket(slot));
    }

    private static void cancel() throws RpcException {
        target=null;exactTarget=null;navigationStarted=0;
        BaritoneAPI.getProvider().getPrimaryBaritone().getPathingBehavior().forceCancel();
        BotController.get().stopNavigation("cancelled");BotController.get().stopMining();BotController.get().stopAllMovement();
        var mc=ClientMc.mc();
        mc.options.keyUp.setDown(false);mc.options.keyDown.setDown(false);mc.options.keyLeft.setDown(false);mc.options.keyRight.setDown(false);
        mc.options.keyJump.setDown(false);mc.options.keyShift.setDown(false);mc.options.keySprint.setDown(false);mc.options.keyAttack.setDown(false);mc.options.keyUse.setDown(false);
        if(mc.player!=null&&mc.gameMode!=null&&mc.player.isUsingItem())mc.gameMode.releaseUsingItem(mc.player);
        if(mc.gameMode!=null)mc.gameMode.stopDestroyBlock();
    }

    private static JsonObject capture() throws Exception {
        var mc=ClientMc.mc();ClientMc.player();ClientMc.level();
        if(GLFW.glfwGetWindowAttrib(mc.getWindow().getWindow(),GLFW.GLFW_ICONIFIED)!=0)throw RpcException.unavailable("Game window is minimized; no fresh render frame.");
        Path tmp=Files.createTempFile("fish-game-frame-",".png");
        try(NativeImage image=Screenshot.takeScreenshot(mc.getMainRenderTarget())){
            image.writeToFile(tmp);
            BufferedImage original=ImageIO.read(tmp.toFile());
            int longest=Math.min(1280,Math.max(original.getWidth(),original.getHeight()));
            byte[] bytes;BufferedImage scaled;
            do{
                double scale=Math.min(1.0,(double)longest/Math.max(original.getWidth(),original.getHeight()));
                int width=Math.max(1,(int)Math.round(original.getWidth()*scale)),height=Math.max(1,(int)Math.round(original.getHeight()*scale));
                scaled=new BufferedImage(width,height,BufferedImage.TYPE_INT_RGB);
                Graphics2D graphics=scaled.createGraphics();
                try{graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION,RenderingHints.VALUE_INTERPOLATION_BILINEAR);graphics.drawImage(original,0,0,width,height,null);}finally{graphics.dispose();}
                ByteArrayOutputStream out=new ByteArrayOutputStream();ImageIO.write(scaled,"png",out);bytes=out.toByteArray();longest=longest*3/4;
            }while(bytes.length>2*1024*1024&&longest>=320);
            if(bytes.length>2*1024*1024)throw RpcException.unavailable("Game frame exceeds image size limit.");
            JsonObject o=new JsonObject();o.addProperty("format","png");o.addProperty("width",scaled.getWidth());o.addProperty("height",scaled.getHeight());
            o.addProperty("bytes",bytes.length);o.addProperty("base64",Base64.getEncoder().encodeToString(bytes));return o;
        }finally{Files.deleteIfExists(tmp);}
    }
}
