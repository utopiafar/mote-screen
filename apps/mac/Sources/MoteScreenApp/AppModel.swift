import AppKit
import Foundation
import MoteScreenCore

@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    @Published var setupDone = false
    @Published var loginItem = true
    @Published var speedConnected = false
    @Published var hook: HookStatus = .missing
    @Published var panelConnected = false
    @Published var settings = ScreenSettings.default
    @Published var logLines: [String] = []
    @Published var lastFrame = ""
    @Published var inbox: [[String: Any]] = []
    @Published var pickingUSB = false
    @Published var usbPorts: [String] = []
    @Published var quitHint = false

    private var remembered: HookMemory = .never
    private var scriptExists = false
    private let speedClient = AgentSpeedClient()
    private let link = DeviceLink()
    private let hooks = HookBridge()
    private var seq = 1
    private var inboxDirty = false
    private var lastPush = Date.distantPast
    private var phase = "idle"
    private var speedSnapshot: [String: Any] = [:]
    private var pushTimer: Timer?

    var menuText: String {
        menuBarStatus(
            setupInProgress: !setupDone,
            agentSpeedConnected: speedConnected,
            einkConnected: panelConnected,
            hook: hook
        ).rawValue
    }

    var addressLabel: String { settings.address.isEmpty ? "未设置" : settings.address }
    var pipeLabel: String {
        switch activeTransport(link: settings.link, usbFallback: settings.usbFallback, usbPlugged: link.usbPlugged) {
        case .usb: return "USB"
        case .bluetooth: return "蓝牙"
        case .wifi: return "Wi-Fi"
        }
    }

    private init() {
        restore()
        speedClient.onLive = { [weak self] frame in self?.acceptSpeed(frame) }
        link.onConnected = { [weak self] up in self?.panelConnected = up }
        hooks.onEvent = { [weak self] event in self?.acceptHook(event) }
        hooks.start()
        refreshHook()
        speedClient.configure(port: 7247, accessCode: settings.accessCode)
        speedClient.start()
        link.apply(settings)
        schedulePush()
        if loginItem { LoginItem.set(true) }
    }

    func log(_ line: String) {
        let stamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        logLines.insert("\(stamp)  \(line)", at: 0)
        if logLines.count > 40 { logLines.removeLast(logLines.count - 40) }
    }

    func connectSpeed() {
        speedClient.probe()
    }

    func saveAccessCode(_ code: String) {
        settings.accessCode = code.trimmingCharacters(in: .whitespaces)
        speedClient.configure(port: 7247, accessCode: settings.accessCode)
        persist()
        speedClient.probe()
    }

    func installHook() {
        do {
            try hooks.install()
            remembered = .installed
            scriptExists = true
            log("Codex hook 已写入，原有条目还在")
        } catch {
            log("安装 hook 失败：\(error)")
        }
        refreshHook()
        persist()
    }

    func removeHook() {
        do {
            try hooks.remove()
            remembered = .removed
            scriptExists = false
            log("已移除我们的 hook 条目和脚本")
        } catch {
            log("移除 hook 失败：\(error)")
        }
        refreshHook()
        persist()
    }

    func updateSettings(_ mutate: (inout ScreenSettings) -> Void) {
        var next = settings
        mutate(&next)
        settings = next
        link.apply(settings)
        persist()
        sendConfig()
    }

    func scanWiFi() {
        link.browseWiFi { [weak self] host in
            guard let self else { return }
            self.updateSettings { $0.address = host; $0.link = .wifi }
            self.log("扫描到设备 \(host)")
        }
    }

    func scanBluetooth() {
        updateSettings { $0.link = .bluetooth }
        link.browseBluetooth()
        log("开始扫描自制固件的蓝牙服务")
    }

    func refreshPorts() {
        usbPorts = DeviceLink.espPorts()
        pickingUSB = true
    }

    func choosePort(_ port: String) {
        updateSettings { $0.usbPort = port; $0.usbFallback = true }
        pickingUSB = false
        log("选用串口 \(port)。这台 Mac 上可能还有别的 ESP32 口。")
    }

    func clearSecrets() {
        updateSettings {
            $0.address = ""
            $0.usbPort = ""
            $0.accessCode = ""
        }
        speedClient.configure(port: 7247, accessCode: "")
        log("已清除访问码和设备地址")
    }

    func setLogin(_ on: Bool) {
        loginItem = on
        LoginItem.set(on)
        persist()
    }

    func finishSetup() {
        setupDone = true
        persist()
        log("设置完成")
        WindowHost.shared.close(id: "wizard")
        WindowHost.shared.openSettings()
    }

    func reopenWizard() {
        setupDone = false
        persist()
        WindowHost.shared.openWizard()
    }

    func sendTest() {
        acceptHook([
            "hook_event_name": "PermissionRequest",
            "session_id": "test",
            "turn_id": UUID().uuidString,
            "cwd": "/work/website",
            "tool_name": "Bash",
            "tool_input": ["command": "git push", "description": "允许运行 git push"]
        ])
    }

    func quitForTrash() {
        removeHook()
        clearSecrets()
        setLogin(false)
        quitHint = true
        log("可以退出了。请自行把应用拖到废纸篓。")
    }

    private func refreshHook() {
        let found = hooks.entries()
        scriptExists = hooks.scriptIsPresent
        hook = classifyHook(permission: found.permission, stop: found.stop, scriptExists: scriptExists, remembered: remembered)
    }

    private func acceptSpeed(_ frame: [String: Any]) {
        let first = !speedConnected
        speedConnected = true
        phase = (frame["phase"] as? String) ?? "generating"
        speedSnapshot = frame
        if first {
            log("Agent Speed 已连接  :7247")
            persist()
        }
    }

    private func acceptHook(_ event: [String: Any]) {
        guard let card = InboxSummary.fromHook(event) else { return }
        inbox.removeAll { ($0["id"] as? String) == (card["id"] as? String) }
        inbox.insert(card, at: 0)
        if inbox.count > 8 { inbox.removeLast(inbox.count - 8) }
        inboxDirty = true
        flush(forceInbox: true)
    }

    private func schedulePush() {
        pushTimer?.invalidate()
        pushTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.flush(forceInbox: false) }
        }
    }

    private func flush(forceInbox: Bool) {
        let now = Date()
        let elapsed = Int(now.timeIntervalSince(lastPush) * 1000)
        if inboxDirty || forceInbox {
            let wait = msUntilPush(settings: settings, phase: phase, inboxDirty: true, lastPushMs: 0, nowMs: elapsed)
            if wait == 0 {
                send(frame: ProtocolCodec.inboxFrame(seq: seq, items: inbox), reason: "Codex 立即")
                inboxDirty = false
            }
        }
        let speedWait = msUntilPush(settings: settings, phase: phase, inboxDirty: false, lastPushMs: 0, nowMs: elapsed)
        if speedWait == 0, !speedSnapshot.isEmpty {
            send(frame: speedFrame(from: speedSnapshot), reason: "速度")
            lastPush = now
        }
    }

    private func speedFrame(from live: [String: Any]) -> [String: Any] {
        let sessions = live["sessions"] as? [String: Any] ?? [:]
        let sources = (live["sources"] as? [[String: Any]] ?? []).map { src -> [String: Any] in
            ["name": src["name"] as? String ?? src["source"] as? String ?? "", "outputTokS": src["outputTokS"] as? Double ?? 0]
        }
        let history = (live["history"] as? [String: Any])?["outputTokS"] as? [Double] ?? live["history"] as? [Double] ?? []
        return ProtocolCodec.speedFrame(
            seq: seq,
            phase: phase,
            outputTokS: live["outputTokS"] as? Double ?? 0,
            active: sessions["active"] as? Int ?? 0,
            generating: sessions["generating"] as? Int ?? 0,
            tools: sessions["tools"] as? Int ?? 0,
            history: history,
            sources: sources
        )
    }

    private func sendConfig() {
        send(frame: ProtocolCodec.configFrame(settings: settings, seq: seq), reason: "设置")
    }

    private func send(frame: [String: Any], reason: String) {
        guard let data = try? ProtocolCodec.encode(frame) else { return }
        seq += 1
        lastFrame = String(data: data, encoding: .utf8) ?? ""
        link.send(data)
        log("推送 \(frame["type"] as? String ?? "") · \(reason)")
    }

    private func persist() {
        let payload: [String: Any] = [
            "setupDone": setupDone,
            "loginItem": loginItem,
            "remembered": remembered.rawValue,
            "settings": (try? JSONEncoder().encode(settings)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        ]
        UserDefaults.standard.set(payload, forKey: "mote-screen.state")
    }

    private func restore() {
        guard let payload = UserDefaults.standard.dictionary(forKey: "mote-screen.state") else { return }
        setupDone = payload["setupDone"] as? Bool ?? false
        loginItem = payload["loginItem"] as? Bool ?? true
        if let raw = payload["remembered"] as? String, let memory = HookMemory(rawValue: raw) {
            remembered = memory
        }
        if let json = payload["settings"] as? String, let data = json.data(using: .utf8),
           let stored = try? JSONDecoder().decode(ScreenSettings.self, from: data) {
            settings = stored
        }
    }
}
