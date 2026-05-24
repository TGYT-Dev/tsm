package dev.tsm.tsmbridge;

import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.*;
import org.bukkit.event.entity.PlayerDeathEvent;

public class EventListener implements Listener {

    private final WsServer wsServer;

    public EventListener(WsServer wsServer) {
        this.wsServer = wsServer;
    }

    private String escape(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent e) {
        Player p   = e.getPlayer();
        Location l = p.getLocation();
        wsServer.broadcast(String.format(
            "{\"type\":\"join\",\"player\":\"%s\",\"world\":\"%s\",\"x\":%.1f,\"y\":%.1f,\"z\":%.1f}",
            escape(p.getName()), escape(l.getWorld().getName()), l.getX(), l.getY(), l.getZ()
        ));
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent e) {
        wsServer.broadcast(String.format(
            "{\"type\":\"quit\",\"player\":\"%s\"}",
            escape(e.getPlayer().getName())
        ));
    }

    @EventHandler
    public void onChat(AsyncPlayerChatEvent e) {
        wsServer.broadcast(String.format(
            "{\"type\":\"chat\",\"player\":\"%s\",\"message\":\"%s\"}",
            escape(e.getPlayer().getName()), escape(e.getMessage())
        ));
    }

    @EventHandler
    public void onCommand(PlayerCommandPreprocessEvent e) {
        wsServer.broadcast(String.format(
            "{\"type\":\"command\",\"player\":\"%s\",\"command\":\"%s\"}",
            escape(e.getPlayer().getName()), escape(e.getMessage())
        ));
    }

    @EventHandler
    public void onDeath(PlayerDeathEvent e) {
        Player   p = e.getEntity();
        Location l = p.getLocation();
        String killer = "";
        if (p.getKiller() != null) killer = p.getKiller().getName();
        wsServer.broadcast(String.format(
            "{\"type\":\"death\",\"player\":\"%s\",\"message\":\"%s\",\"killer\":\"%s\",\"world\":\"%s\",\"x\":%.1f,\"y\":%.1f,\"z\":%.1f}",
            escape(p.getName()), escape(e.getDeathMessage()), escape(killer),
            escape(l.getWorld().getName()), l.getX(), l.getY(), l.getZ()
        ));
    }

    @EventHandler
    public void onMove(PlayerMoveEvent e) {
        // Only broadcast on block change to reduce spam
        if (e.getFrom().getBlockX() == e.getTo().getBlockX() &&
            e.getFrom().getBlockZ() == e.getTo().getBlockZ() &&
            e.getFrom().getBlockY() == e.getTo().getBlockY()) return;

        Player   p = e.getPlayer();
        Location l = e.getTo();
        wsServer.broadcast(String.format(
            "{\"type\":\"move\",\"player\":\"%s\",\"world\":\"%s\",\"x\":%.1f,\"y\":%.1f,\"z\":%.1f}",
            escape(p.getName()), escape(l.getWorld().getName()), l.getX(), l.getY(), l.getZ()
        ));
    }
}
