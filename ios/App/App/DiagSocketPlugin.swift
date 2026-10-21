import Capacitor
import Foundation
import Network

/// Registriert die app-eigenen Plugins bei Capacitor.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(DiagSocketPlugin())
    }
}

/// TCP- und UDP-Zugriff für die Fahrzeugdiagnose (ELM327-WLAN-Dongles, BMW ENET).
/// Daten werden als Base64 mit der Web-Oberfläche ausgetauscht.
@objc(DiagSocketPlugin)
public class DiagSocketPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DiagSocketPlugin"
    public let jsName = "DiagSocket"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "udpRequest", returnType: CAPPluginReturnPromise),
    ]

    /// Alle Zugriffe auf `connections` laufen über diese Queue.
    private let queue = DispatchQueue(label: "de.dmperformance.obd.socket")
    private var connections: [Int: NWConnection] = [:]
    private var nextId = 1

    @objc func connect(_ call: CAPPluginCall) {
        guard let host = call.getString("host"),
              let port = call.getInt("port"),
              let nwPort = NWEndpoint.Port(rawValue: UInt16(clamping: port))
        else {
            call.reject("host und port erforderlich")
            return
        }
        let timeout = call.getInt("timeout") ?? 5000

        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        tcp.enableKeepalive = true
        let params = NWParameters(tls: nil, tcp: tcp)
        // Ziel liegt im lokalen Netz (Dongle-WLAN bzw. ENET) – nie über Mobilfunk.
        params.prohibitedInterfaceTypes = [.cellular]
        let connection = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: params)

        queue.async {
            let id = self.nextId
            self.nextId += 1
            var settled = false
            let fail = { (message: String) in
                guard !settled else { return }
                settled = true
                connection.cancel()
                call.reject(message)
            }
            self.queue.asyncAfter(deadline: .now() + .milliseconds(timeout)) {
                fail("Zeitüberschreitung beim Verbinden mit \(host):\(port)")
            }
            connection.stateUpdateHandler = { [weak self] state in
                guard let self = self else { return }
                switch state {
                case .ready:
                    guard !settled else { return }
                    settled = true
                    self.connections[id] = connection
                    call.resolve(["id": id])
                    self.receive(id, connection)
                case .waiting(let error):
                    // Ziel nicht erreichbar (z. B. Verbindung abgelehnt) – nicht endlos warten.
                    fail("Verbindung zu \(host):\(port) fehlgeschlagen: \(error.localizedDescription)")
                case .failed(let error):
                    if settled {
                        self.closed(id, error.localizedDescription)
                    } else {
                        fail("Verbindung zu \(host):\(port) fehlgeschlagen: \(error.localizedDescription)")
                    }
                default:
                    break
                }
            }
            connection.start(queue: self.queue)
        }
    }

    private func receive(_ id: Int, _ connection: NWConnection) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if let data = data, !data.isEmpty {
                self.notifyListeners("data", data: ["id": id, "data": data.base64EncodedString()])
            }
            if isComplete || error != nil {
                self.closed(id, error?.localizedDescription)
                return
            }
            self.receive(id, connection)
        }
    }

    /// Meldet eine unerwartet beendete Verbindung (nicht bei close()).
    private func closed(_ id: Int, _ error: String?) {
        guard let connection = connections.removeValue(forKey: id) else { return }
        connection.cancel()
        var event: [String: Any] = ["id": id]
        if let error = error { event["error"] = error }
        notifyListeners("closed", data: event)
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let id = call.getInt("id"),
              let encoded = call.getString("data"),
              let data = Data(base64Encoded: encoded)
        else {
            call.reject("Ungültige Daten")
            return
        }
        queue.async {
            guard let connection = self.connections[id] else {
                call.reject("Nicht verbunden")
                return
            }
            connection.send(content: data, completion: .contentProcessed { error in
                if let error = error {
                    call.reject("Senden fehlgeschlagen: \(error.localizedDescription)")
                } else {
                    call.resolve()
                }
            })
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        let id = call.getInt("id") ?? -1
        queue.async {
            self.connections.removeValue(forKey: id)?.cancel()
            call.resolve()
        }
    }

    /// Sendet ein UDP-Paket (auch Broadcast) und sammelt Antworten bis zum Timeout.
    /// Broadcasts erfordern unter iOS die Multicast-Berechtigung
    /// (com.apple.developer.networking.multicast), die bei Apple beantragt werden muss.
    @objc func udpRequest(_ call: CAPPluginCall) {
        guard let host = call.getString("host"),
              let port = call.getInt("port"),
              let encoded = call.getString("data"),
              let payload = Data(base64Encoded: encoded)
        else {
            call.reject("host, port und data erforderlich")
            return
        }
        let timeout = call.getInt("timeout") ?? 1500

        DispatchQueue.global(qos: .userInitiated).async {
            let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
            guard fd >= 0 else {
                call.reject("UDP-Socket konnte nicht geöffnet werden")
                return
            }
            defer { Darwin.close(fd) }

            var yes: Int32 = 1
            setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &yes, socklen_t(MemoryLayout<Int32>.size))
            var tv = timeval(tv_sec: 0, tv_usec: 100_000)
            setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

            var target = sockaddr_in()
            target.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            target.sin_family = sa_family_t(AF_INET)
            target.sin_port = in_port_t(UInt16(clamping: port).bigEndian)
            guard inet_pton(AF_INET, host, &target.sin_addr) == 1 else {
                call.reject("Ungültige IP-Adresse: \(host)")
                return
            }

            let sent = payload.withUnsafeBytes { buffer in
                withUnsafePointer(to: &target) { pointer in
                    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                        sendto(fd, buffer.baseAddress, payload.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                    }
                }
            }
            if sent < 0 {
                let reason = String(cString: strerror(errno))
                call.reject("UDP-Senden fehlgeschlagen (\(reason)). Bitte IP-Adresse manuell eingeben.")
                return
            }

            var replies: [[String: Any]] = []
            let capacity = 2048
            var buffer = [UInt8](repeating: 0, count: capacity)
            let deadline = Date().addingTimeInterval(Double(timeout) / 1000)
            while Date() < deadline {
                var from = sockaddr_in()
                var length = socklen_t(MemoryLayout<sockaddr_in>.size)
                let count = withUnsafeMutablePointer(to: &from) { pointer in
                    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                        recvfrom(fd, &buffer, capacity, 0, $0, &length)
                    }
                }
                if count <= 0 { continue }
                var ip = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                inet_ntop(AF_INET, &from.sin_addr, &ip, socklen_t(INET_ADDRSTRLEN))
                replies.append([
                    "address": String(cString: ip),
                    "data": Data(buffer[0..<count]).base64EncodedString(),
                ])
            }
            call.resolve(["replies": replies])
        }
    }
}
