import CoreBluetooth
import Darwin
import Foundation
import Network
import ServiceManagement
import MoteScreenCore

enum LoginItem {
    static func set(_ on: Bool) {
        if on {
            try? SMAppService.mainApp.register()
        } else {
            try? SMAppService.mainApp.unregister()
        }
    }
}

/// Copies hooks/mote-screen-hook into Application Support and edits ~/.codex/hooks.json.
final class HookBridge {
    var onEvent: (([String: Any]) -> Void)?
    private let listenerQueue = DispatchQueue(label: "mote-screen.hook")
    private var listener: NWListener?

    var supportDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("mote-screen", isDirectory: true)
    }

    var scriptURL: URL { supportDir.appendingPathComponent("mote-screen-hook") }
    var scriptIsPresent: Bool { FileManager.default.fileExists(atPath: scriptURL.path) }

    func start() {
        guard listener == nil else { return }
        do {
            guard let port = NWEndpoint.Port(rawValue: UInt16(ProtocolCodec.hookPort)) else { return }
            let params = NWParameters.tcp
            params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: port)
            let listener = try NWListener(using: params)
            listener.newConnectionHandler = { [weak self] connection in
                connection.start(queue: self?.listenerQueue ?? .main)
                self?.read(connection, buffer: Data())
            }
            listener.start(queue: listenerQueue)
            self.listener = listener
        } catch {
            return
        }
    }

    func install() throws {
        try FileManager.default.createDirectory(at: supportDir, withIntermediateDirectories: true)
        let template = try templateText()
        try template.write(to: scriptURL, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: scriptURL.path)
        let url = hooksURL()
        let existing = readJSON(url)
        let next = try HookFile.install(document: existing, scriptPath: scriptURL.path)
        try writeJSON(next, url: url)
    }

    func remove() throws {
        let url = hooksURL()
        if FileManager.default.fileExists(atPath: url.path) {
            let existing = readJSON(url)
            let next = try HookFile.remove(document: existing, scriptPath: scriptURL.path)
            try writeJSON(next, url: url)
        }
        if scriptIsPresent {
            try? FileManager.default.removeItem(at: scriptURL)
        }
    }

    func entries() -> (permission: Bool, stop: Bool) {
        HookFile.find(document: readJSON(hooksURL()), scriptPath: scriptURL.path)
    }

    private func hooksURL() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".codex", isDirectory: true)
            .appendingPathComponent("hooks.json")
    }

    private func templateText() throws -> String {
        if let bundled = Bundle.main.url(forResource: "mote-screen-hook", withExtension: nil),
           let text = try? String(contentsOf: bundled) {
            return text
        }
        let dev = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("hooks/mote-screen-hook")
        if let text = try? String(contentsOf: dev) { return text }
        throw HookStoreError.path
    }

    private func readJSON(_ url: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private func writeJSON(_ object: [String: Any], url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url, options: .atomic)
    }

    private func read(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, done, _ in
            var next = buffer
            if let data { next.append(data) }
            if let range = next.firstRange(of: Data([0x0A])) ?? (done ? next.startIndex..<next.endIndex : nil), !next.isEmpty {
                let line = next.subdata(in: next.startIndex..<range.upperBound)
                if let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any] {
                    DispatchQueue.main.async { self?.onEvent?(object) }
                }
            }
            if !done { self?.read(connection, buffer: Data()) }
        }
    }
}

final class AgentSpeedClient {
    var onLive: (([String: Any]) -> Void)?
    private var port = 7247
    private var accessCode = ""
    private var task: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .ephemeral)
    private var timer: Timer?

    func configure(port: Int, accessCode: String) {
        self.port = port
        self.accessCode = accessCode
    }

    func start() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            self?.ensureStream()
        }
        probe()
        ensureStream()
    }

    func probe() {
        guard let url = URL(string: "http://127.0.0.1:\(port)/v1/live") else { return }
        var request = URLRequest(url: url, timeoutInterval: 2)
        if !accessCode.isEmpty {
            request.setValue("Bearer \(accessCode)", forHTTPHeaderField: "Authorization")
        }
        session.dataTask(with: request) { [weak self] data, response, _ in
            guard let self, let data, let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  object["type"] as? String == "live" else { return }
            DispatchQueue.main.async { self.onLive?(object) }
        }.resume()
    }

    private func ensureStream() {
        if task != nil { return }
        var parts = URLComponents()
        parts.scheme = "ws"
        parts.host = "127.0.0.1"
        parts.port = port
        parts.path = "/v1/stream"
        if !accessCode.isEmpty { parts.queryItems = [URLQueryItem(name: "key", value: accessCode)] }
        guard let url = parts.url else { return }
        let task = session.webSocketTask(with: url)
        self.task = task
        task.resume()
        receive(task)
    }

    private func receive(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                let text: String?
                switch message {
                case .string(let value): text = value
                case .data(let data): text = String(data: data, encoding: .utf8)
                @unknown default: text = nil
                }
                if let text, let data = text.data(using: .utf8),
                   let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   object["type"] as? String == "live" {
                    DispatchQueue.main.async { self.onLive?(object) }
                }
                self.receive(task)
            case .failure:
                DispatchQueue.main.async {
                    if self.task === task { self.task = nil }
                }
            }
        }
    }
}

final class DeviceLink: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    var onConnected: ((Bool) -> Void)?
    private(set) var usbPlugged = false
    private var settings = ScreenSettings.default
    private var connection: NWConnection?
    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private let service = CBUUID(string: "6d6f7465-7363-7265-656e-000000000001")
    private let writeUUID = CBUUID(string: "6d6f7465-7363-7265-656e-000000000002")
    private var writeChar: CBCharacteristic?
    private let queue = DispatchQueue(label: "mote-screen.link")
    private var serialFD: Int32 = -1

    static func espPorts() -> [String] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: "/dev")) ?? []
        return names.filter { name in
            name.hasPrefix("cu.") &&
            (name.contains("usbmodem") || name.contains("usbserial") || name.contains("wchusbserial") || name.contains("SLAB_USBtoUART"))
        }.map { "/dev/\($0)" }.sorted()
    }

    func apply(_ settings: ScreenSettings) {
        self.settings = settings
        usbPlugged = !settings.usbPort.isEmpty && FileManager.default.fileExists(atPath: settings.usbPort)
        reconnect()
    }

    func send(_ data: Data) {
        let pipe = activeTransport(link: settings.link, usbFallback: settings.usbFallback, usbPlugged: usbPlugged)
        switch pipe {
        case .usb:
            writeSerial(data)
        case .bluetooth:
            guard let peripheral, let writeChar else { return }
            peripheral.writeValue(data, for: writeChar, type: .withResponse)
        case .wifi:
            connection?.send(content: data, completion: .contentProcessed { _ in })
        }
    }

    func browseWiFi(found: @escaping (String) -> Void) {
        // Bonjour name published by our firmware. The user still confirms the address.
        let browser = NetServiceBrowser()
        let context = BrowserBox(browser: browser, found: found)
        browser.delegate = context
        browser.searchForServices(ofType: "_motescreen._tcp.", inDomain: "local.")
        objc_setAssociatedObject(self, &BrowserBox.key, context, .OBJC_ASSOCIATION_RETAIN)
    }

    func browseBluetooth() {
        if central == nil { central = CBCentralManager(delegate: self, queue: queue) }
        if central?.state == .poweredOn {
            central?.scanForPeripherals(withServices: [service], options: nil)
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn && settings.link == .bluetooth {
            central.scanForPeripherals(withServices: [service], options: nil)
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        self.peripheral = peripheral
        peripheral.delegate = self
        central.stopScan()
        central.connect(peripheral, options: nil)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices([service])
        DispatchQueue.main.async { self.onConnected?(true) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let service = peripheral.services?.first(where: { $0.uuid == self.service }) else { return }
        peripheral.discoverCharacteristics([writeUUID], for: service)
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        writeChar = service.characteristics?.first { $0.uuid == writeUUID }
    }

    private func reconnect() {
        connection?.cancel()
        connection = nil
        closeSerial()
        let pipe = activeTransport(link: settings.link, usbFallback: settings.usbFallback, usbPlugged: usbPlugged)
        if pipe == .usb {
            openSerial()
            DispatchQueue.main.async { self.onConnected?(self.serialFD >= 0) }
            return
        }
        if pipe == .bluetooth {
            browseBluetooth()
            return
        }
        openWiFi()
    }

    private func openWiFi() {
        let parts = settings.address.split(separator: ":")
        guard let host = parts.first, let portValue = parts.count > 1 ? UInt16(parts[1]) : UInt16(ProtocolCodec.tcpPort),
              let port = NWEndpoint.Port(rawValue: portValue) else {
            DispatchQueue.main.async { self.onConnected?(false) }
            return
        }
        let connection = NWConnection(host: NWEndpoint.Host(String(host)), port: port, using: .tcp)
        connection.stateUpdateHandler = { [weak self] state in
            DispatchQueue.main.async {
                self?.onConnected?(state == .ready)
            }
        }
        connection.start(queue: queue)
        self.connection = connection
    }

    private func openSerial() {
        let fd = open(settings.usbPort, O_RDWR | O_NOCTTY | O_NONBLOCK)
        guard fd >= 0 else { return }
        var options = termios()
        if tcgetattr(fd, &options) == 0 {
            cfmakeraw(&options)
            cfsetspeed(&options, speed_t(B115200))
            tcsetattr(fd, TCSANOW, &options)
        }
        serialFD = fd
    }

    private func writeSerial(_ data: Data) {
        if serialFD < 0 { openSerial() }
        guard serialFD >= 0 else { return }
        data.withUnsafeBytes { buffer in
            _ = Darwin.write(serialFD, buffer.baseAddress, buffer.count)
        }
    }

    private func closeSerial() {
        if serialFD >= 0 { close(serialFD); serialFD = -1 }
    }
}

private final class BrowserBox: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    static var key: UInt8 = 0
    let browser: NetServiceBrowser
    let found: (String) -> Void
    init(browser: NetServiceBrowser, found: @escaping (String) -> Void) {
        self.browser = browser
        self.found = found
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        service.delegate = self
        service.resolve(withTimeout: 3)
        objc_setAssociatedObject(browser, &BrowserBox.key, service, .OBJC_ASSOCIATION_RETAIN)
    }
    func netServiceDidResolveAddress(_ sender: NetService) {
        guard let host = sender.hostName else { return }
        let name = host.hasSuffix(".") ? String(host.dropLast()) : host
        let port = sender.port > 0 ? Int(sender.port) : ProtocolCodec.tcpPort
        DispatchQueue.main.async { self.found("\(name):\(port)") }
    }
}
