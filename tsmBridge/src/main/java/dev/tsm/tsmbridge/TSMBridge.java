package dev.tsm.tsmbridge;

import org.bukkit.plugin.java.JavaPlugin;

public class TSMBridge extends JavaPlugin {

    private HttpServer httpServer;
    private WsServer wsServer;
    private boolean tpsWarned = false;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        String secret = getConfig().getString("secret", "changeme");
        int httpPort  = getConfig().getInt("http-port", 4001);
        int wsPort    = getConfig().getInt("websocket-port", 4002);

        wsServer = new WsServer(wsPort, secret);
        wsServer.start();
        getLogger().info("WebSocket server started on port " + wsPort);

        httpServer = new HttpServer(this, httpPort, secret, wsServer);
        httpServer.start();
        getLogger().info("HTTP server started on port " + httpPort);

        getServer().getPluginManager().registerEvents(new EventListener(wsServer), this);

        // TPS + player count broadcast every 5s
        getServer().getScheduler().runTaskTimerAsynchronously(this, () -> {
            double tps1m  = getServer().getTPS()[0];
            double tps5m  = getServer().getTPS()[1];
            double tps15m = getServer().getTPS()[2];
            int online    = getServer().getOnlinePlayers().size();
            int max       = getServer().getMaxPlayers();

            // Clamp TPS to 20
            tps1m  = Math.min(tps1m,  20.0);
            tps5m  = Math.min(tps5m,  20.0);
            tps15m = Math.min(tps15m, 20.0);

            wsServer.broadcast(String.format(
                "{\"type\":\"tps\",\"tps1m\":%.2f,\"tps5m\":%.2f,\"tps15m\":%.2f,\"online\":%d,\"max\":%d}",
                tps1m, tps5m, tps15m, online, max
            ));

            // TPS warning
            if (tps1m < 15.0 && !tpsWarned) {
                tpsWarned = true;
                wsServer.broadcast(String.format(
                    "{\"type\":\"tpsWarning\",\"tps\":%.2f}", tps1m
                ));
            } else if (tps1m >= 18.0) {
                tpsWarned = false;
            }

            // Broadcast all player positions every 5s as a bulk update
            StringBuilder positions = new StringBuilder("{\"type\":\"positions\",\"players\":[");
            boolean first = true;
            for (org.bukkit.entity.Player p : getServer().getOnlinePlayers()) {
                org.bukkit.Location l = p.getLocation();
                if (!first) positions.append(",");
                positions.append(String.format(
                    "{\"name\":\"%s\",\"world\":\"%s\",\"x\":%.1f,\"y\":%.1f,\"z\":%.1f}",
                    p.getName(), l.getWorld().getName(), l.getX(), l.getY(), l.getZ()
                ));
                first = false;
            }
            positions.append("]}");
            wsServer.broadcast(positions.toString());

        }, 0L, 100L);

        getLogger().info("TSMBridge enabled.");
    }

    @Override
    public void onDisable() {
        if (httpServer != null) httpServer.stop();
        if (wsServer != null)   wsServer.stop();
        getLogger().info("TSMBridge disabled.");
    }
}
