package de.dmperformance.obd;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * TCP- und UDP-Zugriff für die Fahrzeugdiagnose (ELM327-WLAN-Dongles, BMW ENET).
 * Daten werden als Base64 mit der Web-Oberfläche ausgetauscht.
 *
 * Sockets werden an das lokale Netz (WLAN/Ethernet) gebunden, in dem das Ziel liegt.
 * Sonst würde Android Verbindungen ins Mobilfunknetz leiten, wenn das WLAN des
 * Dongles keinen Internetzugang hat.
 */
@CapacitorPlugin(name = "DiagSocket")
public class DiagSocketPlugin extends Plugin {

    private final Map<Integer, Socket> sockets = new ConcurrentHashMap<>();
    private final AtomicInteger nextId = new AtomicInteger(1);
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final ExecutorService writer = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void connect(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port");
        int timeout = call.getInt("timeout", 5000);
        if (host == null || port == null) {
            call.reject("host und port erforderlich");
            return;
        }
        executor.execute(() -> {
            Socket socket = new Socket();
            try {
                InetAddress address = InetAddress.getByName(host);
                Network network = findLocalNetwork(address);
                if (network != null) network.bindSocket(socket);
                socket.setTcpNoDelay(true);
                socket.setKeepAlive(true);
                socket.connect(new InetSocketAddress(address, port), timeout);
            } catch (Exception e) {
                closeQuietly(socket);
                call.reject("Verbindung zu " + host + ":" + port + " fehlgeschlagen: " + e.getMessage());
                return;
            }
            int id = nextId.getAndIncrement();
            sockets.put(id, socket);
            JSObject ret = new JSObject();
            ret.put("id", id);
            call.resolve(ret);
            readLoop(id, socket);
        });
    }

    private void readLoop(int id, Socket socket) {
        String error = null;
        try {
            InputStream in = socket.getInputStream();
            byte[] buffer = new byte[4096];
            int n;
            while ((n = in.read(buffer)) != -1) {
                JSObject event = new JSObject();
                event.put("id", id);
                event.put("data", Base64.encodeToString(buffer, 0, n, Base64.NO_WRAP));
                notifyListeners("data", event);
            }
        } catch (IOException e) {
            error = e.getMessage();
        }
        // Nur melden, wenn die Verbindung nicht bewusst per close() beendet wurde.
        if (sockets.remove(id) != null) {
            closeQuietly(socket);
            JSObject event = new JSObject();
            event.put("id", id);
            if (error != null) event.put("error", error);
            notifyListeners("closed", event);
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        Integer id = call.getInt("id");
        String data = call.getString("data");
        Socket socket = id == null ? null : sockets.get(id);
        if (socket == null || data == null) {
            call.reject("Nicht verbunden");
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
        writer.execute(() -> {
            try {
                socket.getOutputStream().write(bytes);
                socket.getOutputStream().flush();
                call.resolve();
            } catch (IOException e) {
                call.reject("Senden fehlgeschlagen: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        Integer id = call.getInt("id");
        Socket socket = id == null ? null : sockets.remove(id);
        if (socket != null) closeQuietly(socket);
        call.resolve();
    }

    /** Sendet ein UDP-Paket (auch Broadcast) und sammelt Antworten bis zum Timeout. */
    @PluginMethod
    public void udpRequest(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port");
        String data = call.getString("data");
        int timeout = call.getInt("timeout", 1500);
        if (host == null || port == null || data == null) {
            call.reject("host, port und data erforderlich");
            return;
        }
        executor.execute(() -> {
            byte[] payload = Base64.decode(data, Base64.NO_WRAP);
            List<DatagramSocket> open = new ArrayList<>();
            JSArray replies = new JSArray();
            try {
                InetAddress target = InetAddress.getByName(host);
                boolean broadcast = "255.255.255.255".equals(host);
                List<Network> networks = new ArrayList<>();
                if (broadcast) {
                    networks.addAll(localNetworks());
                } else {
                    Network n = findLocalNetwork(target);
                    if (n != null) networks.add(n);
                }
                if (networks.isEmpty()) networks.add(null);

                for (Network network : networks) {
                    DatagramSocket ds = new DatagramSocket();
                    open.add(ds);
                    if (network != null) network.bindSocket(ds);
                    ds.setBroadcast(true);
                    ds.setSoTimeout(100);
                    ds.send(new DatagramPacket(payload, payload.length, target, port));
                    // Zusätzlich an die gerichtete Broadcast-Adresse des Netzes.
                    if (broadcast && network != null) {
                        for (InetAddress b : directedBroadcasts(network)) {
                            ds.send(new DatagramPacket(payload, payload.length, b, port));
                        }
                    }
                }

                long deadline = System.currentTimeMillis() + timeout;
                byte[] buffer = new byte[2048];
                while (System.currentTimeMillis() < deadline) {
                    for (DatagramSocket ds : open) {
                        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                        try {
                            ds.receive(packet);
                        } catch (SocketTimeoutException e) {
                            continue;
                        }
                        JSObject reply = new JSObject();
                        reply.put("address", packet.getAddress().getHostAddress());
                        reply.put("data", Base64.encodeToString(packet.getData(), 0, packet.getLength(), Base64.NO_WRAP));
                        replies.put(reply);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("replies", replies);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("UDP fehlgeschlagen: " + e.getMessage());
            } finally {
                for (DatagramSocket ds : open) ds.close();
            }
        });
    }

    private ConnectivityManager connectivity() {
        return (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
    }

    /** WLAN- und Ethernet-Netze mit IPv4-Adresse (kein Mobilfunk). */
    private List<Network> localNetworks() {
        List<Network> result = new ArrayList<>();
        ConnectivityManager cm = connectivity();
        for (Network network : cm.getAllNetworks()) {
            NetworkCapabilities caps = cm.getNetworkCapabilities(network);
            LinkProperties props = cm.getLinkProperties(network);
            if (caps == null || props == null || caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) continue;
            for (LinkAddress la : props.getLinkAddresses()) {
                if (la.getAddress() instanceof Inet4Address) {
                    result.add(network);
                    break;
                }
            }
        }
        return result;
    }

    /** Netz, in dessen Subnetz die Zieladresse liegt; bei Link-Local bevorzugt Ethernet. */
    private Network findLocalNetwork(InetAddress target) {
        if (!(target instanceof Inet4Address)) return null;
        ConnectivityManager cm = connectivity();
        Network ethernet = null;
        for (Network network : localNetworks()) {
            LinkProperties props = cm.getLinkProperties(network);
            NetworkCapabilities caps = cm.getNetworkCapabilities(network);
            if (props == null) continue;
            for (LinkAddress la : props.getLinkAddresses()) {
                if (la.getAddress() instanceof Inet4Address
                        && sameSubnet(la.getAddress(), target, la.getPrefixLength())) {
                    return network;
                }
            }
            if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) ethernet = network;
        }
        return target.isLinkLocalAddress() ? ethernet : null;
    }

    private List<InetAddress> directedBroadcasts(Network network) {
        List<InetAddress> result = new ArrayList<>();
        LinkProperties props = connectivity().getLinkProperties(network);
        if (props == null) return result;
        for (LinkAddress la : props.getLinkAddresses()) {
            if (!(la.getAddress() instanceof Inet4Address)) continue;
            byte[] ip = la.getAddress().getAddress();
            int prefix = la.getPrefixLength();
            int value = ((ip[0] & 0xff) << 24) | ((ip[1] & 0xff) << 16) | ((ip[2] & 0xff) << 8) | (ip[3] & 0xff);
            int mask = prefix == 0 ? 0 : -1 << (32 - prefix);
            int bcast = value | ~mask;
            try {
                result.add(InetAddress.getByAddress(new byte[] {
                    (byte) (bcast >>> 24), (byte) (bcast >>> 16), (byte) (bcast >>> 8), (byte) bcast,
                }));
            } catch (IOException ignored) {
                // ungültige Adresse überspringen
            }
        }
        return result;
    }

    private static boolean sameSubnet(InetAddress a, InetAddress b, int prefix) {
        byte[] x = a.getAddress();
        byte[] y = b.getAddress();
        for (int bit = 0; bit < prefix; bit++) {
            int mask = 0x80 >> (bit % 8);
            if ((x[bit / 8] & mask) != (y[bit / 8] & mask)) return false;
        }
        return true;
    }

    private static void closeQuietly(Socket socket) {
        try {
            socket.close();
        } catch (IOException ignored) {
            // bereits geschlossen
        }
    }

    @Override
    protected void handleOnDestroy() {
        for (Socket socket : sockets.values()) closeQuietly(socket);
        sockets.clear();
        executor.shutdownNow();
        writer.shutdownNow();
    }
}
