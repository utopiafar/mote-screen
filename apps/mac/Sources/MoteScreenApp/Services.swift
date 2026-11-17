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
        let existing = try loadDocument(url)
        let next = try HookFile.install(document: existing, scriptPath: scriptURL.path)
        try writeJSON(next, url: url)
    }

    func remove() throws {
        let url = hooksURL()
        if FileManager.default.fileExists(atPath: url.path) {
            let existing = try loadDocument(url)
            let next = try HookFile.remove(document: existing, scriptPath: scriptURL.path)
            try writeJSON(next, url: url)
        }
        if scriptIsPresent {
            try? FileManager.default.removeItem(at: scriptURL)
        }
    }

    func entries() -> (permission: Bool, stop: Bool) {
        guard let document = try? loadDocument(hooksURL()) else { return (false, false) }
        return HookFile.find(document: document, scriptPath: scriptURL.path)
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

    /// nil only when hooks.json is absent. A present file that is not a JSON object throws
    /// so install/remove leave the user's file untouched.
    private func loadDocument(_ url: URL) throws -> [String: Any]? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        let parsed: Any
        do {
            parsed = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw HookStoreError.notObject
        }
        guard let object = parsed as? [String: Any] else { throw HookStoreError.notObject }
        return object
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
            if let object = Self.httpJSONBody(next) {
                let response = Data("HTTP/1.1 204 No Content\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".utf8)
                connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
                DispatchQueue.main.async { self?.onEvent?(object) }
                return
            }
            if done || next.count > 64 * 1024 {
                connection.cancel()
                return
            }
            self?.read(connection, buffer: next)
        }
    }

    /// The installed script POSTs `{"kind","title","project","source"}`. Body is not the request line.
    static func httpJSONBody(_ data: Data) -> [String: Any]? {
        let separator = Data("\r\n\r\n".utf8)
        guard let headerEnd = data.range(of: separator) else { return nil }
        let head = String(data: data.subdata(in: data.startIndex..<headerEnd.lowerBound), encoding: .utf8) ?? ""
        var length: Int?
        for line in head.split(separator: "\r\n", omittingEmptySubsequences: false) {
            let parts = line.split(separator: ":", maxSplits: 1).map(String.init)
            guard parts.count == 2, parts[0].lowercased() == "content-length" else { continue }
            length = Int(parts[1].trimmingCharacters(in: .whitespaces))
        }
        let bodyStart = headerEnd.upperBound
        let available = data.distance(from: bodyStart, to: data.endIndex)
        let size = length ?? available
        guard size >= 0, available >= size else { return nil }
        let body = data.subdata(in: bodyStart..<data.index(bodyStart, offsetBy: size))
        guard !body.isEmpty, let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else { return nil }
        return object
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
    /// Fires when the selected pipe can take a frame: Wi-Fi ready, USB opened, or the BLE write characteristic found.
    var onReady: (() -> Void)?
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
    private var usbWatch: DispatchSourceTimer?

    static func espPorts() -> [String] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: "/dev")) ?? []
        return names.filter { name in
            name.hasPrefix("cu.") &&
            (name.contains("usbmodem") || name.contains("usbserial") || name.contains("wchusbserial") || name.contains("SLAB_USBtoUART"))
        }.map { "/dev/\($0)" }.sorted()
    }

    func apply(_ settings: ScreenSettings) {
        queue.async { [weak self] in
            guard let self else { return }
            self.settings = settings
            self.sampleUsb()
            self.reconnect()
            self.armUsbWatch()
        }
    }

    func send(_ data: Data) {
        queue.async { [weak self] in
            self?.sendNow(data)
        }
    }

    private func sendNow(_ data: Data) {
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

    private func sampleUsb() {
        usbPlugged = settings.usbFallback && portPresent()
    }

    private func portPresent() -> Bool {
        !settings.usbPort.isEmpty && FileManager.default.fileExists(atPath: settings.usbPort)
    }

    private func armUsbWatch() {
        if usbWatch != nil { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in self?.pollUsb() }
        timer.resume()
        usbWatch = timer
    }

    private func pollUsb() {
        let was = usbPlugged
        sampleUsb()
        if usbPlugged == was { return }
        reconnect()
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
        guard writeChar != nil else { return }
        DispatchQueue.main.async { self.onReady?() }
    }

    private func reconnect() {
        connection?.cancel()
        connection = nil
        closeSerial()
        let pipe = activeTransport(link: settings.link, usbFallback: settings.usbFallback, usbPlugged: usbPlugged)
        if pipe == .usb {
            openSerial()
            let opened = serialFD >= 0
            DispatchQueue.main.async {
                self.onConnected?(opened)
                if opened { self.onReady?() }
            }
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
            guard let self else { return }
            let wifi = activeTransport(link: self.settings.link, usbFallback: self.settings.usbFallback, usbPlugged: self.usbPlugged) == .wifi
            DispatchQueue.main.async {
                guard wifi else { return }
                self.onConnected?(state == .ready)
                if state == .ready { self.onReady?() }
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
        if !portPresent() {
            closeSerial()
            pollUsb()
            return
        }
        if serialFD < 0 { openSerial() }
        guard serialFD >= 0 else { return }
        let wrote = data.withUnsafeBytes { buffer -> Int in
            guard let base = buffer.baseAddress else { return -1 }
            return Darwin.write(serialFD, base, buffer.count)
        }
        if wrote < 0 {
            closeSerial()
            pollUsb()
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
