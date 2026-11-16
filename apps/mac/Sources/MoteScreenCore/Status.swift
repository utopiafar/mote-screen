import Foundation

/// Menu-bar and popover labels. Same rules as core/status.mjs.
public enum MenuStatus: String {
    case setup = "设置中"
    case disconnected = "未连接"
    case connected = "已连接"
    case hookBroken = "Hook 失效"
}

public enum LinkStatus: String {
    case connected = "已连接"
    case disconnected = "未连接"
}

public enum HookStatus: String {
    case installed = "已安装"
    case missing = "未安装"
    case broken = "已失效"
    case removed = "已移除"
}

public enum HookMemory: String {
    case never
    case installed
    case removed
}

public func linkLabel(_ connected: Bool) -> LinkStatus {
    connected ? .connected : .disconnected
}

public func menuBarStatus(setupInProgress: Bool, agentSpeedConnected: Bool, einkConnected: Bool, hook: HookStatus) -> MenuStatus {
    if hook == .broken { return .hookBroken }
    if setupInProgress { return .setup }
    if agentSpeedConnected && einkConnected && hook == .installed { return .connected }
    return .disconnected
}

public func classifyHook(permission: Bool, stop: Bool, scriptExists: Bool, remembered: HookMemory) -> HookStatus {
    let any = permission || stop
    if permission && stop && scriptExists { return .installed }
    if remembered == .removed && !any { return .removed }
    if remembered == .installed || any { return .broken }
    return .missing
}
