package dev.fishlive.assistance;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.tags.TagKey;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.monster.piglin.Piglin;
import net.minecraft.world.level.material.Fluids;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;

/** Bounded, per-world file requests. No extra socket, arbitrary commands or game edits. */
public final class FishAssistance {
    private static LavaSearch search;
    private static long nextPoll;
    private static long stabilityUntil;
    private static final ResourceLocation STABILITY=ResourceLocation.fromNamespaceAndPath("fish","trade_footing");
    public static void tick(MinecraftServer server) {
        String directory=System.getProperty("fish.assistDirectory");
        if(directory==null)return;
        Path root=Path.of(directory);
        try {
            if(stabilityUntil>0&&System.currentTimeMillis()>=stabilityUntil){var p=server.getPlayerList().getPlayerByName("DeepSeekFish");if(p!=null){var attribute=p.getAttribute(net.minecraft.world.entity.ai.attributes.Attributes.KNOCKBACK_RESISTANCE);if(attribute!=null)attribute.removeModifier(STABILITY);}stabilityUntil=0;}
            Files.createDirectories(root);
            if(search!=null){if(search.step())search=null;return;}
            if(System.currentTimeMillis()<nextPoll)return;
            nextPoll=System.currentTimeMillis()+200;
            try(var paths=Files.list(root)) {
                for(Path file:paths.filter(p->p.getFileName().toString().matches("[a-f0-9-]{36}\\.request\\.json")).limit(1).toList()) {
                    JsonObject request=JsonParser.parseString(Files.readString(file)).getAsJsonObject();
                    Files.deleteIfExists(file);
                    String id=file.getFileName().toString().replace(".request.json","");
                    Path result=root.resolve(id+".result.json");
                    long deadline=request.get("deadline").getAsLong();
                    if(deadline<System.currentTimeMillis())continue;
                    JsonObject out=new JsonObject();
                    try {
                        ServerPlayer player=server.getPlayerList().getPlayerByName("DeepSeekFish");
                        if(player==null)throw new IllegalStateException("DeepSeekFish is not connected");
                        ServerLevel level=player.serverLevel();
                        String dimension=level.dimension().location().toString();
                        if(!dimension.equals(request.get("dimension").getAsString()))throw new IllegalStateException("Player dimension changed");
                        String target=request.get("target").getAsString();
                        int radius=Math.max(16,Math.min(256,request.get("radius").getAsInt()));
                        out.addProperty("source","server_assistance");out.addProperty("dimension",dimension);
                        if(target.equals("trade_stability")){
                            var attribute=player.getAttribute(net.minecraft.world.entity.ai.attributes.Attributes.KNOCKBACK_RESISTANCE);
                            if(attribute==null)throw new IllegalStateException("Player knockback attribute unavailable");
                            attribute.removeModifier(STABILITY);
                            attribute.addTransientModifier(new net.minecraft.world.entity.ai.attributes.AttributeModifier(STABILITY,1,net.minecraft.world.entity.ai.attributes.AttributeModifier.Operation.ADD_VALUE));
                            stabilityUntil=System.currentTimeMillis()+5000;out.addProperty("activeMs",5000);out.addProperty("damageProtection",false);write(result,out);continue;
                        }
                        if(target.equals("lava_lake")) {
                            search=new LavaSearch(root,id,result,level,player.blockPosition(),radius,deadline,out);return;
                        }
                        if(target.equals("entities"))out=entities(level,player,radius);
                        else {
                            String tag=switch(target){case "nether_fortress"->"fortress";case "village"->"village";case "ruined_portal"->"ruined_portal";case "stronghold"->"stronghold";default->throw new IllegalArgumentException("Unknown assistance target");};
                            boolean nether=dimension.equals("minecraft:the_nether");
                            if((target.equals("nether_fortress")&&!nether)||(!target.equals("nether_fortress")&&!dimension.equals("minecraft:overworld")))throw new IllegalStateException("Structure is not in this dimension");
                            BlockPos position=level.findNearestMapStructure(TagKey.create(Registries.STRUCTURE,ResourceLocation.fromNamespaceAndPath(target.equals("nether_fortress")||target.equals("stronghold")?"fish":"minecraft",tag)),player.blockPosition(),Math.min(64,Math.max(1,request.has("structureChunks")?request.get("structureChunks").getAsInt():32)),false);
                            out.addProperty("target",target);out.addProperty("found",position!=null);out.addProperty("searchRadiusChunks",Math.min(64,Math.max(1,request.has("structureChunks")?request.get("structureChunks").getAsInt():32)));
                            if(position!=null){out.add("position",position(position));out.addProperty("distance",Math.sqrt(position.distSqr(player.blockPosition())));}
                            out.addProperty("note","Server structure locator; this coordinate does not prove a safe route or exact entrance.");
                        }
                    }catch(Exception e){out.addProperty("error",e.getMessage());}
                    if(deadline>=System.currentTimeMillis())write(result,out);
                }
            }
        }catch(Exception e){System.err.println("Fish assistance: "+e.getMessage());search=null;}
    }
    private static JsonObject entities(ServerLevel level,ServerPlayer player,int radius) {
        var list=new ArrayList<Entity>();
        for(Entity entity:level.getAllEntities())if(entity!=player&&entity.distanceTo(player)<=radius&&(entity instanceof LivingEntity||entity instanceof ItemEntity))list.add(entity);
        list.sort(Comparator.comparingDouble(e->e.distanceTo(player)));
        JsonArray rows=new JsonArray();
        for(Entity entity:list.stream().limit(256).toList()) {
            JsonObject row=new JsonObject();row.addProperty("uuid",entity.getUUID().toString());row.addProperty("type",BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString());
            row.addProperty("x",entity.getX());row.addProperty("y",entity.getY());row.addProperty("z",entity.getZ());row.addProperty("distance",entity.distanceTo(player));
            if(entity instanceof LivingEntity living){row.addProperty("health",living.getHealth());row.addProperty("mainhand",BuiltInRegistries.ITEM.getKey(living.getMainHandItem().getItem()).toString());row.addProperty("offhand",BuiltInRegistries.ITEM.getKey(living.getOffhandItem().getItem()).toString());}
            if(entity instanceof Piglin piglin){row.addProperty("baby",piglin.isBaby());row.addProperty("ignoresPlayer",piglin.getMainHandItem().is(net.minecraft.world.item.Items.CROSSBOW));row.addProperty("attackingPlayer",piglin.getBrain().getMemory(net.minecraft.world.entity.ai.memory.MemoryModuleType.ATTACK_TARGET).filter(t->t==player).isPresent());}
            if(entity instanceof ItemEntity item){row.addProperty("item",BuiltInRegistries.ITEM.getKey(item.getItem().getItem()).toString());row.addProperty("count",item.getItem().getCount());}
            rows.add(row);
        }
        JsonObject out=new JsonObject();out.addProperty("source","server_assistance_loaded_entities");out.addProperty("dimension",level.dimension().location().toString());out.addProperty("radius",radius);out.add("entities",rows);out.addProperty("omitted",Math.max(0,list.size()-256));return out;
    }
    private static JsonObject position(BlockPos p){JsonObject o=new JsonObject();o.addProperty("x",p.getX());o.addProperty("y",p.getY());o.addProperty("z",p.getZ());return o;}
    private static void write(Path file,JsonObject value)throws Exception {Path temp=file.resolveSibling(file.getFileName()+".tmp");Files.writeString(temp,value.toString());Files.move(temp,file,StandardCopyOption.REPLACE_EXISTING);}

    /** Scan chunk rings incrementally, with at most 2048 block probes per server tick. */
    private static final class LavaSearch {
        final Path root,result;final String id;final ServerLevel level;final BlockPos origin;final long deadline;final JsonObject out;
        final ArrayList<int[]> chunks=new ArrayList<>();int chunk=0,cell=0;int probes=0;BlockPos best;double distance=Double.POSITIVE_INFINITY;
        LavaSearch(Path root,String id,Path result,ServerLevel level,BlockPos origin,int radius,long deadline,JsonObject out){
            this.root=root;this.id=id;this.result=result;this.level=level;this.origin=origin;this.deadline=deadline;this.out=out;
            int cx=origin.getX()>>4,cz=origin.getZ()>>4,r=(radius+15)/16;
            for(int dx=-r;dx<=r;dx++)for(int dz=-r;dz<=r;dz++)chunks.add(new int[]{cx+dx,cz+dz});
            chunks.sort(Comparator.comparingDouble(this::lowerBound));
            out.addProperty("radius",radius);out.addProperty("target","lava_lake");
        }
        boolean step()throws Exception {
            if(Files.exists(root.resolve(id+".cancel"))){Files.deleteIfExists(root.resolve(id+".cancel"));return true;}
            boolean timedOut=System.currentTimeMillis()>deadline;
            if(!timedOut&&chunk<chunks.size()) {
                int[] c=chunks.get(chunk);var terrain=level.getChunkSource().getChunkNow(c[0],c[1]);
                if(terrain==null){chunk++;cell=0;return false;}
                int top=level.dimension()==net.minecraft.world.level.Level.NETHER?120:Math.min(level.getMaxY()-1,Math.max(80,origin.getY()+32));
                int low=level.dimension()==net.minecraft.world.level.Level.NETHER?24:Math.max(level.getMinY()+4,-56);
                int height=top-low+1;
                for(int n=0;n<2048&&cell<256*height;n++,cell++) {
                    int column=cell/height,y=low+cell%height,x=c[0]*16+column%16,z=c[1]*16+column/16;
                    var p=new BlockPos(x,y,z);probes++;
                    double d=p.distSqr(origin);if(d>=distance)continue;
                    var fluid=terrain.getFluidState(p);
                    if(fluid.getType()!=Fluids.LAVA||!fluid.isSource()||!level.getBlockState(p.above()).isAir())continue;
                    int sources=0;
                    for(int dx=-1;dx<=1;dx++)for(int dz=-1;dz<=1;dz++) {var neighbor=p.offset(dx,0,dz);if(!level.hasChunkAt(neighbor))continue;var f=level.getFluidState(neighbor);if(f.getType()==Fluids.LAVA&&f.isSource())sources++;}
                    if(sources>=5){best=p;distance=d;}
                }
                if(cell>=256*height){chunk++;cell=0;if(best!=null&&(chunk>=chunks.size()||lowerBound(chunks.get(chunk))>=distance))return finish(false);}
                return false;
            }
            return finish(timedOut);
        }
        double lowerBound(int[] c){
            double x=Math.max(c[0]*16,Math.min(origin.getX(),c[0]*16+15)),z=Math.max(c[1]*16,Math.min(origin.getZ(),c[1]*16+15));
            return Math.pow(x-origin.getX(),2)+Math.pow(z-origin.getZ(),2);
        }
        boolean finish(boolean limited)throws Exception {
            out.addProperty("found",best!=null);out.addProperty("limited",limited||chunk<chunks.size());out.addProperty("blocksChecked",probes);
            if(best!=null){out.add("position",position(best));out.addProperty("distance",Math.sqrt(distance));}
            out.addProperty("loadedTerrainOnly",true);out.addProperty("note","Assisted search of loaded terrain for exposed clusters of at least five lava sources; does not generate chunks. A candidate, not proof of safe access, sufficient volume or the globally nearest lake.");
            write(result,out);return true;
        }
    }
}
