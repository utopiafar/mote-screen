import Foundation

public enum LinkChoice: String, Codable {
    case wifi
    case bluetooth

    public var label: String { self == .bluetooth ? "蓝牙" : "Wi-Fi" }
}

public enum TransportPipe: String {
    case wifi
    case bluetooth
    case usb
}

public struct ScreenSettings: Codable, Equatable {
    public var link: LinkChoice
    public var usbFallback: Bool
    public var address: String
    public var usbPort: String
    public var pushGeneratingSec: Int
    public var pushIdleSec: Int
    public var partialOnChange: Bool
    public var fullEveryN: Int
    public var fullEveryMin: Int
    public var accessCode: String

    public static let pushChoices = [5, 15, 30, 60, 300]
    public static let fullEveryNChoices = [5, 10, 20]
    public static let fullEveryMinChoices = [5, 10, 30]

    public static let saver = ScreenSettings(link: .wifi, usbFallback: true, address: "", usbPort: "", pushGeneratingSec: 60, pushIdleSec: 300, partialOnChange: true, fullEveryN: 20, fullEveryMin: 30, accessCode: "")
    public static let balanced = ScreenSettings(link: .wifi, usbFallback: true, address: "", usbPort: "", pushGeneratingSec: 15, pushIdleSec: 60, partialOnChange: true, fullEveryN: 10, fullEveryMin: 10, accessCode: "")
    public static let timely = ScreenSettings(link: .wifi, usbFallback: true, address: "", usbPort: "", pushGeneratingSec: 5, pushIdleSec: 15, partialOnChange: true, fullEveryN: 5, fullEveryMin: 5, accessCode: "")

    public static var `default`: ScreenSettings { .balanced }

    public var preset: String {
        if matches(.saver) { return "saver" }
        if matches(.balanced) { return "balanced" }
        if matches(.timely) { return "timely" }
        return "custom"
    }

    public func applying(preset name: String) -> ScreenSettings {
        let base: ScreenSettings
        switch name {
        case "saver": base = .saver
        case "timely": base = .timely
        default: base = .balanced
        }
        var next = self
        next.pushGeneratingSec = base.pushGeneratingSec
        next.pushIdleSec = base.pushIdleSec
        next.partialOnChange = base.partialOnChange
        next.fullEveryN = base.fullEveryN
        next.fullEveryMin = base.fullEveryMin
        return next
    }

    public func pushInterval(phase: String) -> Int {
        phase == "idle" ? pushIdleSec : pushGeneratingSec
    }

    public func matches(_ other: ScreenSettings) -> Bool {
        pushGeneratingSec == other.pushGeneratingSec &&
        pushIdleSec == other.pushIdleSec &&
        partialOnChange == other.partialOnChange &&
        fullEveryN == other.fullEveryN &&
        fullEveryMin == other.fullEveryMin
    }

    public var refreshSummary: String {
        if !partialOnChange { return "完整 · 每 \(fullEveryMin) 分钟" }
        return "局部 · 每 \(fullEveryN) 次"
    }
}

public func msUntilPush(settings: ScreenSettings, phase: String, inboxDirty: Bool, lastPushMs: Int, nowMs: Int) -> Int {
    if inboxDirty { return 0 }
    let interval = settings.pushInterval(phase: phase) * 1000
    let elapsed = max(0, nowMs - lastPushMs)
    return max(0, interval - elapsed)
}

public enum RefreshKind: String {
    case none
    case partial
    case full
}

public func decideRefresh(partialOnChange: Bool, fullEveryN: Int, fullEveryMin: Int, contentChanged: Bool, partialsSinceFull: Int, msSinceFull: Int, viewChanged: Bool = false) -> RefreshKind {
    if viewChanged { return .full }
    let timeDue = fullEveryMin > 0 && msSinceFull >= fullEveryMin * 60 * 1000
    let countDue = partialsSinceFull >= fullEveryN
    if !contentChanged && !timeDue { return .none }
    if timeDue || countDue || !partialOnChange { return .full }
    return .partial
}

public func activeTransport(link: LinkChoice, usbFallback: Bool, usbPlugged: Bool) -> TransportPipe {
    if usbFallback && usbPlugged { return .usb }
    return link == .bluetooth ? .bluetooth : .wifi
}

public func formatSeconds(_ sec: Int) -> String {
    if sec % 60 == 0 { return "\(sec / 60) 分钟" }
    return "\(sec) 秒"
}
