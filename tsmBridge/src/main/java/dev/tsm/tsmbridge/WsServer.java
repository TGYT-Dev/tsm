package dev.tsm.tsmbridge;

import java.io.*;
import java.net.*;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.Base64;

public class WsServer {

    private final int port;
    private final String secret;
    private final Set<WsClient> clients = ConcurrentHashMap.newKeySet();
    private ServerSocket serverSocket;
    private Thread acceptThread;

    public WsServer(int port, String secret) {
        this.port   = port;
        this.secret = secret;
    }

    public void start() {
        try {
            serverSocket = new ServerSocket(port, 50, InetAddress.getByName("0.0.0.0"));
            acceptThread = new Thread(() -> {
                while (!serverSocket.isClosed()) {
                    try {
                        Socket socket = serverSocket.accept();
                        new Thread(() -> handleHandshake(socket)).start();
                    } catch (IOException ignored) {}
                }
            }, "TSMBridge-WS-Accept");
            acceptThread.setDaemon(true);
            acceptThread.start();
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private void handleHandshake(Socket socket) {
        try {
            InputStream in   = socket.getInputStream();
            OutputStream out = socket.getOutputStream();

            BufferedReader reader = new BufferedReader(new InputStreamReader(in));
            Map<String, String> headers = new HashMap<>();
            String line;
            String requestLine = reader.readLine();
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) headers.put(line.substring(0, colon).trim().toLowerCase(), line.substring(colon + 1).trim());
            }

            // Auth check via query param ?secret=
            if (requestLine != null && !requestLine.contains("secret=" + secret)) {
                out.write("HTTP/1.1 401 Unauthorized\r\n\r\n".getBytes());
                socket.close();
                return;
            }

            String key = headers.get("sec-websocket-key");
            String accept = Base64.getEncoder().encodeToString(
                MessageDigest.getInstance("SHA-1")
                    .digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes("UTF-8"))
            );

            String response = "HTTP/1.1 101 Switching Protocols\r\n"
                + "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
            out.write(response.getBytes());
            out.flush();

            WsClient client = new WsClient(socket, in, out);
            clients.add(client);
            client.readLoop(clients);
        } catch (Exception e) {
            try { socket.close(); } catch (IOException ignored) {}
        }
    }

    public void broadcast(String message) {
        Iterator<WsClient> it = clients.iterator();
        while (it.hasNext()) {
            WsClient c = it.next();
            if (!c.send(message)) it.remove();
        }
    }

    public void stop() {
        try { if (serverSocket != null) serverSocket.close(); } catch (IOException ignored) {}
    }

    // ── WsClient ──────────────────────────────────────────────────────────────
    static class WsClient {
        private final Socket socket;
        private final InputStream in;
        private final OutputStream out;

        WsClient(Socket socket, InputStream in, OutputStream out) {
            this.socket = socket;
            this.in     = in;
            this.out    = out;
        }

        boolean send(String message) {
            try {
                byte[] payload = message.getBytes("UTF-8");
                ByteArrayOutputStream frame = new ByteArrayOutputStream();
                frame.write(0x81); // FIN + text frame
                if (payload.length < 126) {
                    frame.write(payload.length);
                } else if (payload.length < 65536) {
                    frame.write(126);
                    frame.write((payload.length >> 8) & 0xFF);
                    frame.write(payload.length & 0xFF);
                } else {
                    frame.write(127);
                    for (int i = 7; i >= 0; i--) frame.write((int)((payload.length >> (i * 8)) & 0xFF));
                }
                frame.write(payload);
                synchronized (out) { out.write(frame.toByteArray()); out.flush(); }
                return true;
            } catch (IOException e) {
                return false;
            }
        }

        void readLoop(Set<WsClient> clients) {
            try {
                while (!socket.isClosed()) {
                    int first = in.read();
                    if (first == -1) break;
                    in.read(); // skip length byte (we don't need client messages)
                }
            } catch (IOException ignored) {}
            finally { clients.remove(this); try { socket.close(); } catch (IOException ignored) {} }
        }
    }
}
