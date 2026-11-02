package dev.fishlive.client;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.FormattedCharSequence;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

/** Game-only presentation. Reads the same public overlay data as the browser fallback. */
public final class FishHud {
    private static final ResourceLocation WHALE = ResourceLocation.fromNamespaceAndPath("fishlive", "textures/gui/whale.png");
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private static final HttpRequest REQUEST = HttpRequest.newBuilder(URI.create(System.getProperty("fishlive.controlUrl", "http://127.0.0.1:21940/api/overlay")))
        .timeout(Duration.ofSeconds(2)).GET().build();
    private static volatile JsonObject snapshot;
    private static volatile boolean fetching;
    private static volatile long receivedAt;
    private static long nextPoll, nextBalance = System.currentTimeMillis() + 210000;
    private static long balanceSeq = -1, commentaryAt, hideAt, balanceUntil;
    private static String bubbleText = "";
    private static JsonObject waitingCommentary;
    private static boolean queuedBalance;
    private static long queuedAt, renderedFrames;
    private static int lastBubbleHeight;
    private static int lastGoalHeight;
    private static String lastGoalText = "";
    private static JsonObject waitingReaction;
    private static long reactionAt, reactionUntil;
    private static String reactionText = "";

    static void initialize() {
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            long now = System.currentTimeMillis();
            if (client.level == null || client.player == null || fetching || now < nextPoll) return;
            nextPoll = now + 700;
            fetching = true;
            HTTP.sendAsync(REQUEST, HttpResponse.BodyHandlers.ofString()).whenComplete((response, error) -> {
                try {
                    if (error == null && response.statusCode() == 200 && response.body().length() < 16000) {
                        JsonObject value = JsonParser.parseString(response.body()).getAsJsonObject();
                        if (value.has("note") && value.has("bubble")) {
                            snapshot = value;
                            receivedAt = System.currentTimeMillis();
                        }
                    }
                } catch (RuntimeException ignored) {
                    // Keep the static character; never put HTTP errors into the audience HUD.
                } finally { fetching = false; }
            });
        });
    }

    private static String text(JsonObject object, String key, String fallback) {
        return object != null && object.has(key) && !object.get(key).isJsonNull() ? object.get(key).getAsString() : fallback;
    }
    private static long number(JsonObject object, String key, long fallback) {
        try { return Long.parseLong(text(object, key, Long.toString(fallback))); } catch (RuntimeException ignored) { return fallback; }
    }
    private static JsonObject object(JsonObject parent, String key) {
        return parent != null && parent.has(key) && parent.get(key).isJsonObject() ? parent.getAsJsonObject(key) : null;
    }
    private static void show(String message, long now, long duration) {
        bubbleText = message.replaceAll("\\s+", " ").strip();
        if (bubbleText.codePointCount(0, bubbleText.length()) > 120)
            bubbleText = bubbleText.substring(0, bubbleText.offsetByCodePoints(0, 120));
        hideAt = now + duration;
    }
    private static void updateBubble(JsonObject state, long now) {
        JsonObject reaction = object(state, "reaction");
        long newReactionAt = number(reaction, "at", 0);
        if (newReactionAt > reactionAt) { reactionAt = newReactionAt; waitingReaction = reaction; }
        JsonObject settings = object(state, "bubble"), balance = object(state, "balance");
        long manualBalance = number(state, "balanceBubbleSeq", 0);
        if (balanceSeq < 0) balanceSeq = manualBalance;
        if (balanceSeq != manualBalance) { balanceSeq = manualBalance; queuedBalance = true; queuedAt = now - 12000; }
        if (now >= nextBalance) {
            if (!queuedBalance) queuedAt = now;
            queuedBalance = true;
            long min = Math.max(10, number(settings, "minSeconds", 180));
            long max = Math.max(min, number(settings, "maxSeconds", 300));
            nextBalance = now + ThreadLocalRandom.current().nextLong(min, max + 1) * 1000;
        }
        JsonObject commentary = object(state, "commentary");
        long at = number(commentary, "at", 0);
        if (at > commentaryAt && now - at < 20000) {
            commentaryAt = at;
            if (text(commentary, "action", "").equals("preview")) {
                show(text(commentary, "text", ""), now, 15000);
                balanceUntil = 0; queuedBalance = false; waitingCommentary = null;
                waitingReaction = null; reactionUntil = 0; reactionText = "";
            } else waitingCommentary = commentary;
        }
        if (queuedBalance && (now >= hideAt || now - queuedAt >= 12000) && balance != null && now - number(balance, "checkedAt", 0) < 120000) {
            try {
                show("账户余粮 ¥" + String.format(java.util.Locale.ROOT, "%.2f", Double.parseDouble(text(balance, "total", "0"))), now,
                    Math.max(1, number(settings, "durationSeconds", 8)) * 1000);
                balanceUntil = hideAt;
                queuedBalance = false;
            } catch (RuntimeException ignored) { queuedBalance = false; }
        } else if (waitingCommentary != null && now >= balanceUntil) {
            if (now - number(waitingCommentary, "at", 0) < 20000) {
                String message = text(waitingCommentary, "text", "");
                show(message, now, Math.min(12000, Math.max(4000, 2500 + message.codePointCount(0, message.length()) * 180L)));
            }
            waitingCommentary = null;
        }
        if (waitingReaction != null && now >= balanceUntil) {
            if (now - number(waitingReaction, "at", 0) < 16000) {
                reactionText = text(waitingReaction, "text", "");
                reactionUntil = now + Math.min(8000, Math.max(4000, 1800 + reactionText.codePointCount(0, reactionText.length()) * 160L));
            }
            waitingReaction = null;
        }
        if (now < reactionUntil && now >= balanceUntil) hideAt = Math.max(hideAt, reactionUntil);
    }

    public static void render(GuiGraphics graphics, DeltaTracker ignored) {
        Minecraft client = Minecraft.getInstance();
        JsonObject state = snapshot;
        if (client.player == null || client.level == null || client.options.hideGui || state == null || !Boolean.parseBoolean(text(state, "hudEnabled", "true"))) return;
        long now = System.currentTimeMillis();
        updateBubble(state, now);
        renderedFrames++;
        float scale = graphics.guiWidth() / 1280f;
        int height = Math.round(graphics.guiHeight() / scale);
        int whaleX = 42, whaleSize = 200, whaleY = height - Math.round(height * .085f) - whaleSize;
        graphics.pose().pushPose();
        graphics.pose().scale(scale, scale, 1);
        try {
            String note = text(state, "note", "");
            float noteScale = Math.min(2.0f, 1200f / Math.max(1, client.font.width(note)));
            drawText(graphics, note, (1280 - client.font.width(note) * noteScale) / 2f, 22, noteScale, 0xFFFFFFFF, true);
            lastGoalText = text(state, "goal", "正在确定下一阶段目标").replaceAll("\\s+", " ").strip();
            if (lastGoalText.isBlank()) lastGoalText = "正在确定下一阶段目标";
            List<FormattedCharSequence> goalLines = client.font.split(Component.literal(lastGoalText), 177);
            lastGoalHeight = 49 + goalLines.size() * 23;
            int goalBottom = 64 + lastGoalHeight;
            rounded(graphics, 42, 64, 352, lastGoalHeight, 8, 0xE610283D);
            drawText(graphics, "当前肥鱼的目标", 56, 76, 1.6f, 0xFFACDCE8, false);
            graphics.pose().pushPose();
            graphics.pose().translate(56, 104, 0);
            graphics.pose().scale(1.8f, 1.8f, 1);
            for (int i = 0; i < goalLines.size(); i++) graphics.drawString(client.font, goalLines.get(i), 0, Math.round(i * 23 / 1.8f), 0xFFF4F9FF, false);
            graphics.pose().popPose();

            graphics.pose().pushPose();
            graphics.pose().translate(whaleX, whaleY, 0);
            graphics.pose().scale(whaleSize / 610f, whaleSize / 610f, 1);
            // Reverse texture U coordinates, not the quad winding (GUI quads are culled).
            graphics.blit(RenderType::guiTextured, WHALE, 0, 0, 610f, 0f, 610, 610, -610, 610, 610, 610);
            graphics.pose().popPose();

            lastBubbleHeight = 0;
            if (now < hideAt && !bubbleText.isBlank()) {
                float fontScale = 2.2f;
                int maxTextWidth = 142;
                String presented = now < reactionUntil && now >= balanceUntil && !reactionText.isBlank() ? reactionText + "\n" + bubbleText : bubbleText;
                List<FormattedCharSequence> lines = client.font.split(Component.literal(presented), maxTextWidth);
                int maxLines = Math.max(1, (whaleY - goalBottom - 54) / 26);
                if (lines.size() > maxLines) lines = lines.subList(0, maxLines);
                int contentWidth = lines.stream().mapToInt(client.font::width).max().orElse(1);
                int width = Math.max(150, (int)Math.ceil(contentWidth * fontScale) + 30);
                int bubbleHeight = lines.size() * 26 + 26;
                int x = whaleX + 24, y = Math.max(goalBottom + 14, whaleY - bubbleHeight - 14);
                lastBubbleHeight = bubbleHeight;
                rounded(graphics, x + 3, y + 4, width, bubbleHeight, 8, 0x40152F51);
                rounded(graphics, x, y, width, bubbleHeight, 8, 0xFF738AB8);
                rounded(graphics, x + 1, y + 1, width - 2, bubbleHeight - 2, 7, 0xFFF4F9FF);
                for (int row = 0; row < 9; row++) graphics.fill(x + 17, y + bubbleHeight - 1 + row, x + 30 - row, y + bubbleHeight + row, 0xFFF4F9FF);
                graphics.pose().pushPose();
                graphics.pose().translate(x + 15, y + 13, 0);
                graphics.pose().scale(fontScale, fontScale, 1);
                for (int i = 0; i < lines.size(); i++) graphics.drawString(client.font, lines.get(i), 0, Math.round(i * 26 / fontScale), 0xFF35547D, false);
                graphics.pose().popPose();
            }
        } finally { graphics.pose().popPose(); }
    }
    private static void drawText(GuiGraphics graphics, String value, float x, float y, float scale, int color, boolean shadow) {
        graphics.pose().pushPose(); graphics.pose().translate(x, y, 0); graphics.pose().scale(scale, scale, 1);
        graphics.drawString(Minecraft.getInstance().font, value, 0, 0, color, shadow); graphics.pose().popPose();
    }
    private static void rounded(GuiGraphics graphics, int x, int y, int width, int height, int radius, int color) {
        graphics.fill(x + radius, y, x + width - radius, y + height, color);
        graphics.fill(x, y + radius, x + width, y + height - radius, color);
        for (int row = 0; row < radius; row++) {
            int inset = radius - (int)Math.sqrt(radius * radius - (radius - row) * (radius - row));
            graphics.fill(x + inset, y + row, x + width - inset, y + row + 1, color);
            graphics.fill(x + inset, y + height - row - 1, x + width - inset, y + height - row, color);
        }
    }
    static JsonObject status() {
        JsonObject result = new JsonObject();
        result.addProperty("receivedAt", receivedAt);
        result.addProperty("renderedFrames", renderedFrames);
        result.addProperty("enabled", snapshot != null && Boolean.parseBoolean(text(snapshot, "hudEnabled", "true")));
        result.addProperty("bubbleVisible", System.currentTimeMillis() < hideAt);
        result.addProperty("bubbleText", bubbleText);
        result.addProperty("bubbleHeight", lastBubbleHeight);
        result.addProperty("goalText", lastGoalText);
        result.addProperty("goalHeight", lastGoalHeight);
        result.addProperty("reactionText", reactionText);
        result.addProperty("reactionVisible", System.currentTimeMillis() < reactionUntil && System.currentTimeMillis() >= balanceUntil);
        return result;
    }
}
