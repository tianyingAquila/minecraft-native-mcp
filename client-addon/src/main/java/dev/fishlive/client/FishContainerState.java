package dev.fishlive.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.fishlive.client.mixin.ContainerDataAccessor;
import dev.mcpfabric.bridge.RpcException;
import dev.mcpfabric.client.ClientMc;
import dev.mcpfabric.handlers.support.Gates;
import java.util.LinkedHashMap;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.inventory.MerchantMenu;

/** Read the actual menu, cursor, slot predicates and synchronized UI properties; no clicks or world reads. */
public final class FishContainerState {
    private FishContainerState() {}
    private static JsonObject stack(ItemStack stack) {
        JsonObject o=new JsonObject();o.addProperty("empty",stack.isEmpty());
        if(!stack.isEmpty()) {o.addProperty("id",BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());o.addProperty("count",stack.getCount());o.addProperty("name",stack.getHoverName().getString());o.addProperty("maxStack",stack.getMaxStackSize());}
        return o;
    }
    public static JsonObject read() throws RpcException {
        Gates.playerControl();var mc=ClientMc.mc();var player=ClientMc.player();var menu=player.containerMenu;
        JsonObject o=new JsonObject();boolean open=menu!=player.inventoryMenu;
        o.addProperty("open",open);o.addProperty("containerId",menu.containerId);
        o.addProperty("screenVisible",mc.screen instanceof AbstractContainerScreen);
        o.addProperty("screen",mc.screen==null?"none":mc.screen instanceof AbstractContainerScreen?"container":"other");
        if(mc.screen!=null)o.addProperty("title",mc.screen.getTitle().getString());
        try{o.addProperty("type",BuiltInRegistries.MENU.getKey(menu.getType()).toString());}catch(UnsupportedOperationException ignored){o.addProperty("type","player_inventory");}
        o.add("carried",stack(menu.getCarried()));o.addProperty("experienceLevel",player.experienceLevel);
        LinkedHashMap<String,ItemStack> available=new LinkedHashMap<>();
        for(int i=0;i<36;i++){var item=player.getInventory().getItem(i);if(!item.isEmpty())available.putIfAbsent(BuiltInRegistries.ITEM.getKey(item.getItem()).toString(),item);}
        JsonArray slots=new JsonArray(),details=new JsonArray(),playerSlots=new JsonArray();int size=0;
        for(var slot:menu.slots) {
            if(slot.container==player.getInventory()) {JsonObject p=new JsonObject();p.addProperty("menuSlot",slot.index);p.addProperty("inventorySlot",slot.getContainerSlot());playerSlots.add(p);continue;}
            size++;if(details.size()>=128)continue;
            var item=slot.getItem();JsonObject detail=stack(item);detail.addProperty("slot",slot.index);
            detail.addProperty("canTake",!item.isEmpty()&&slot.mayPickup(player));detail.addProperty("active",slot.isActive());
            detail.addProperty("limit",slot.getMaxStackSize());
            detail.addProperty("acceptsCarried",!menu.getCarried().isEmpty()&&slot.mayPlace(menu.getCarried()));
            JsonArray accepted=new JsonArray();for(var entry:available.entrySet())if(slot.mayPlace(entry.getValue()))accepted.add(entry.getKey());
            detail.add("acceptsInventoryItems",accepted);details.add(detail);
            if(!item.isEmpty()){JsonObject s=new JsonObject();s.addProperty("slot",slot.index);s.addProperty("id",BuiltInRegistries.ITEM.getKey(item.getItem()).toString());s.addProperty("count",item.getCount());slots.add(s);}
        }
        o.addProperty("size",size);o.add("slots",slots);o.add("slotDetails",details);o.add("playerMenuSlots",playerSlots);
        if(size>128)o.addProperty("omittedSlots",size-128);
        JsonArray data=new JsonArray();for(var value:((ContainerDataAccessor)menu).fish$dataSlots()){if(data.size()>=64)break;data.add(value.get());}o.add("properties",data);
        if(menu instanceof MerchantMenu merchant){
            JsonArray offers=new JsonArray();var list=merchant.getOffers();
            for(int i=0;i<Math.min(20,list.size());i++){var offer=list.get(i);JsonObject trade=new JsonObject();trade.addProperty("index",i);trade.add("paymentA",stack(offer.getCostA()));trade.add("paymentB",stack(offer.getCostB()));trade.add("result",stack(offer.getResult()));trade.addProperty("outOfStock",offer.isOutOfStock());offers.add(trade);}
            o.add("tradeOffers",offers);if(list.size()>20)o.addProperty("omittedOffers",list.size()-20);
        }
        o.addProperty("constraintsNote","acceptsInventoryItems只测试背包现有物品，不是完整配方白名单；canTake是当前原生槽位条件。格子编号是当前窗口menuSlot，不等于背包inventorySlot。");
        return o;
    }
}
