package dev.tsm.tsmbridge;

import com.sun.net.httpserver.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.inventory.*;
import org.bukkit.inventory.ItemStack;

import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;

public class HttpServer {

    private final TSMBridge plugin;
    private final String secret;
    private final WsServer wsServer;
    private com.sun.net.httpserver.HttpServer server;

    public HttpServer(TSMBridge plugin, int port, String secret, WsServer wsServer) {
        this.plugin   = plugin;
        this.secret   = secret;
        this.wsServer = wsServer;
        try {
            server = com.sun.net.httpserver.HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
            server.setExecutor(Executors.newCachedThreadPool());

            server.createContext("/players",            this::handlePlayers);
            server.createContext("/player/",            this::handlePlayer);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public void start() { if (server != null) server.start(); }
    public void stop()  { if (server != null) server.stop(0); }

    // ── Auth ──────────────────────────────────────────────────────────────────
    private boolean isAuthed(HttpExchange ex) {
        String auth = ex.getRequestHeaders().getFirst("X-TSM-Secret");
        return secret.equals(auth);
    }

    private void sendJson(HttpExchange ex, int code, String json) throws IOException {
        byte[] bytes = json.getBytes("UTF-8");
        ex.getResponseHeaders().set("Content-Type", "application/json");
        ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        ex.sendResponseHeaders(code, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.getResponseBody().close();
    }

    private void sendError(HttpExchange ex, int code, String msg) throws IOException {
        sendJson(ex, code, "{\"error\":\"" + msg + "\"}");
    }

    // ── /players ──────────────────────────────────────────────────────────────
    private void handlePlayers(HttpExchange ex) throws IOException {
        if (!isAuthed(ex)) { sendError(ex, 401, "Unauthorized"); return; }
        StringBuilder sb = new StringBuilder("[");
        List<? extends Player> players = new ArrayList<>(plugin.getServer().getOnlinePlayers());
        for (int i = 0; i < players.size(); i++) {
            Player p = players.get(i);
            sb.append("{\"name\":\"").append(p.getName()).append("\",")
              .append("\"uuid\":\"").append(p.getUniqueId()).append("\"}");
            if (i < players.size() - 1) sb.append(",");
        }
        sb.append("]");
        sendJson(ex, 200, sb.toString());
    }

    // ── /player/:name/* ───────────────────────────────────────────────────────
    private void handlePlayer(HttpExchange ex) throws IOException {
        if (!isAuthed(ex)) { sendError(ex, 401, "Unauthorized"); return; }

        String path   = ex.getRequestURI().getPath(); // /player/Steve/inventory
        String[] parts = path.split("/");
        // parts: ["", "player", "Steve", "inventory"]
        if (parts.length < 4) { sendError(ex, 400, "Bad path"); return; }

        String playerName = parts[2];
        String action     = parts[3];
        String method     = ex.getRequestMethod();

        Player player = plugin.getServer().getPlayerExact(playerName);
        if (player == null) { sendError(ex, 404, "Player not found"); return; }

        switch (action) {
            case "stats"      -> handleStats(ex, player);
            case "inventory"  -> handleInventory(ex, player, method, parts);
            case "enderchest" -> handleEnderChest(ex, player, method, parts);
            case "give"       -> handleGive(ex, player);
            default           -> sendError(ex, 404, "Unknown action");
        }
    }

    // ── Stats ─────────────────────────────────────────────────────────────────
    private void handleStats(HttpExchange ex, Player player) throws IOException {
        Location loc = player.getLocation();
        String json = String.format(
            "{\"name\":\"%s\",\"health\":%.1f,\"maxHealth\":%.1f,\"food\":%d," +
            "\"gamemode\":\"%s\",\"xp\":%d,\"level\":%d," +
            "\"world\":\"%s\",\"x\":%.1f,\"y\":%.1f,\"z\":%.1f}",
            player.getName(), player.getHealth(), player.getMaxHealth(),
            player.getFoodLevel(), player.getGameMode().name(),
            (int)(player.getExp() * 100), player.getLevel(),
            loc.getWorld().getName(), loc.getX(), loc.getY(), loc.getZ()
        );
        sendJson(ex, 200, json);
    }

    // ── Inventory ─────────────────────────────────────────────────────────────
    private void handleInventory(HttpExchange ex, Player player, String method, String[] parts) throws IOException {
        if (method.equals("GET")) {
            sendJson(ex, 200, serializeInventory(player.getInventory()));
        } else if (method.equals("DELETE") && parts.length >= 5) {
            int slot = Integer.parseInt(parts[4]);
            // Must run on main thread
            CompletableFuture<Void> future = new CompletableFuture<>();
            plugin.getServer().getScheduler().runTask(plugin, () -> {
                player.getInventory().setItem(slot, null);
                player.updateInventory();
                future.complete(null);
            });
            try { future.get(3, TimeUnit.SECONDS); } catch (Exception ignored) {}
            sendJson(ex, 200, "{\"ok\":true}");
        } else {
            sendError(ex, 400, "Bad request");
        }
    }

    // ── Ender Chest ───────────────────────────────────────────────────────────
    private void handleEnderChest(HttpExchange ex, Player player, String method, String[] parts) throws IOException {
        if (method.equals("GET")) {
            sendJson(ex, 200, serializeInventory(player.getEnderChest()));
        } else if (method.equals("DELETE") && parts.length >= 5) {
            int slot = Integer.parseInt(parts[4]);
            CompletableFuture<Void> future = new CompletableFuture<>();
            plugin.getServer().getScheduler().runTask(plugin, () -> {
                player.getEnderChest().setItem(slot, null);
                future.complete(null);
            });
            try { future.get(3, TimeUnit.SECONDS); } catch (Exception ignored) {}
            sendJson(ex, 200, "{\"ok\":true}");
        } else {
            sendError(ex, 400, "Bad request");
        }
    }

    // ── Give ─────────────────────────────────────────────────────────────────
    private void handleGive(HttpExchange ex, Player player) throws IOException {
        if (!ex.getRequestMethod().equals("POST")) { sendError(ex, 405, "Method not allowed"); return; }
        String body = new String(ex.getRequestBody().readAllBytes(), "UTF-8");
        // Parse simple JSON: {"material":"DIAMOND","amount":1}
        String material = extractJson(body, "material");
        int amount = 1;
        try { amount = Integer.parseInt(extractJson(body, "amount")); } catch (Exception ignored) {}

        Material mat = Material.matchMaterial(material.toUpperCase());
        if (mat == null) { sendError(ex, 400, "Unknown material: " + material); return; }

        final int finalAmount = Math.min(amount, mat.getMaxStackSize());
        ItemStack item = new ItemStack(mat, finalAmount);
        CompletableFuture<Void> future = new CompletableFuture<>();
        plugin.getServer().getScheduler().runTask(plugin, () -> {
            player.getInventory().addItem(item);
            player.updateInventory();
            future.complete(null);
        });
        try { future.get(3, TimeUnit.SECONDS); } catch (Exception ignored) {}
        sendJson(ex, 200, "{\"ok\":true}");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    private String serializeInventory(Inventory inv) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < inv.getSize(); i++) {
            ItemStack item = inv.getItem(i);
            if (i > 0) sb.append(",");
            if (item == null || item.getType() == Material.AIR) {
                sb.append("null");
            } else {
                sb.append("{\"slot\":").append(i)
                  .append(",\"material\":\"").append(item.getType().name()).append("\"")
                  .append(",\"amount\":").append(item.getAmount())
                  .append(",\"displayName\":\"").append(item.hasItemMeta() && item.getItemMeta().hasDisplayName()
                      ? item.getItemMeta().getDisplayName().replace("\"", "\\\"") : "").append("\"")
                  .append("}");
            }
        }
        sb.append("]");
        return sb.toString();
    }

    private String extractJson(String json, String key) {
        String search = "\"" + key + "\"";
        int idx = json.indexOf(search);
        if (idx == -1) return "";
        int colon = json.indexOf(':', idx);
        int start = colon + 1;
        while (start < json.length() && (json.charAt(start) == ' ' || json.charAt(start) == '"')) start++;
        int end = start;
        while (end < json.length() && json.charAt(end) != '"' && json.charAt(end) != ',' && json.charAt(end) != '}') end++;
        return json.substring(start, end).trim().replace("\"", "");
    }
}
