package dev.fishlive.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.mcpfabric.client.ClientMc;
import dev.mcpfabric.bridge.RpcException;
import dev.mcpfabric.handlers.support.Gates;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.tags.BlockTags;
import net.minecraft.tags.FluidTags;
import net.minecraft.world.level.block.FallingBlock;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Base64;
import java.util.HashMap;
import java.util.Set;

/** Bounded, read-only loaded terrain snapshot; raw voxels never enter model context. */
final class FishSpatialScan {
    private static final Set<String> HAZARDS=Set.of("minecraft:fire","minecraft:soul_fire","minecraft:magma_block","minecraft:campfire","minecraft:soul_campfire","minecraft:cactus","minecraft:powder_snow","minecraft:sweet_berry_bush","minecraft:wither_rose");
    static JsonObject scan() throws RpcException {
        Gates.vision();long start=System.nanoTime();
        var level=ClientMc.level();var p=ClientMc.player();var feet=p.blockPosition();
        int r=16, v=12, sx=33, sy=25, sz=33;
        int ox=feet.getX()-r, oy=feet.getY()-v, oz=feet.getZ()-r;
        JsonArray palette=new JsonArray();palette.add(new JsonObject());
        var indices=new HashMap<String,Integer>();
        var buffer=ByteBuffer.allocate(sx*sy*sz*2).order(ByteOrder.LITTLE_ENDIAN);
        var pos=new BlockPos.MutableBlockPos();int known=0;
        for(int y=0;y<sy;y++)for(int z=0;z<sz;z++)for(int x=0;x<sx;x++) {
            pos.set(ox+x,oy+y,oz+z);
            if(pos.getY()<level.getMinY()||pos.getY()>=level.getMaxY()||!level.hasChunkAt(pos)){buffer.putShort((short)0);continue;}
            known++;var state=level.getBlockState(pos);var fluid=state.getFluidState();
            var shape=state.getCollisionShape(level,pos);boolean collision=!shape.isEmpty();
            String id=BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();int f=0;
            if(collision)f|=1;
            if(state.isFaceSturdy(level,pos,Direction.UP))f|=2;
            if(!fluid.isEmpty())f|=fluid.is(FluidTags.LAVA)?8:4;
            if(HAZARDS.contains(id))f|=16;
            if(state.getBlock() instanceof FallingBlock)f|=32;
            if(state.is(BlockTags.LOGS))f|=64;
            if(state.is(BlockTags.LEAVES))f|=128;
            if(id.endsWith("_ore")||id.equals("minecraft:ancient_debris"))f|=256;
            if(state.hasBlockEntity()||id.contains("portal")||id.endsWith("_bed")||id.equals("minecraft:crafting_table"))f|=512;
            if(collision&&!state.isCollisionShapeFullBlock(level,pos))f|=1024;
            String key=id+":"+f;Integer index=indices.get(key);
            if(index==null){index=palette.size();indices.put(key,index);JsonObject entry=new JsonObject();entry.addProperty("id",id);entry.addProperty("flags",f);palette.add(entry);}
            buffer.putShort(index.shortValue());
        }
        JsonObject out=new JsonObject();out.addProperty("version",1);out.addProperty("dimension",level.dimension().location().toString());
        out.addProperty("biome",level.getBiome(feet).unwrapKey().map(key->key.location().toString()).orElse("unknown"));
        JsonArray origin=new JsonArray();origin.add(ox);origin.add(oy);origin.add(oz);out.add("origin",origin);
        JsonArray size=new JsonArray();size.add(sx);size.add(sy);size.add(sz);out.add("size",size);
        JsonObject player=new JsonObject();player.addProperty("x",p.getX());player.addProperty("y",p.getY());player.addProperty("z",p.getZ());player.addProperty("eyeY",p.getEyeY());player.addProperty("yaw",p.getYRot());player.addProperty("inWater",p.isInWater());player.addProperty("onGround",p.onGround());player.addProperty("halfWidth",p.getBbWidth()/2.0);out.add("player",player);
        out.addProperty("openSkyAtPlayer",level.canSeeSky(feet));out.addProperty("knownCells",known);
        out.addProperty("at",System.currentTimeMillis());out.addProperty("scanMs",(System.nanoTime()-start)/1000000.0);
        out.add("palette",palette);out.addProperty("cells",Base64.getEncoder().encodeToString(buffer.array()));return out;
    }
}
