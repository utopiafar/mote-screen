import Foundation

/// Append-only edits for ~/.codex/hooks.json. Events are PermissionRequest and Stop.
public enum HookStoreError: Error, CustomStringConvertible {
    case notObject
    case badHooks
    case badEvent(String)
    case path

    public var description: String {
        switch self {
        case .notObject: return "hooks.json 不是对象，已停止写入"
        case .badHooks: return "hooks 字段不是对象，已停止写入"
        case .badEvent(let name): return "\(name) 不是数组，已停止写入"
        case .path: return "脚本路径必须是绝对路径"
        }
    }
}

public enum HookFile {
    public static let events = ["PermissionRequest", "Stop"]

    public static func shellQuote(_ path: String) -> String {
        if path.range(of: "[\\s'\"\\\\]", options: .regularExpression) == nil { return path }
        return "'\(path.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    public static func ourHandler(scriptPath: String) -> [String: Any] {
        [
            "type": "command",
            "command": shellQuote(scriptPath),
            "timeout": 5,
            "async": true,
            "statusMessage": "通知墨水屏"
        ]
    }

    public static func commandInvokes(_ command: String, scriptPath: String) -> Bool {
        if command.trimmingCharacters(in: .whitespacesAndNewlines) == scriptPath { return true }
        return tokens(command).contains(scriptPath)
    }

    public static func install(document: [String: Any]?, scriptPath: String) throws -> [String: Any] {
        if !scriptPath.hasPrefix("/") { throw HookStoreError.path }
        var next = try copyDocument(document)
        var hooks = next["hooks"] as? [String: Any] ?? [:]
        let handler = ourHandler(scriptPath: scriptPath)
        for event in events {
            var groups = try eventGroups(hooks[event], event: event)
            var found = false
            for index in groups.indices {
                guard var group = groups[index] as? [String: Any], var list = group["hooks"] as? [[String: Any]] else { continue }
                list = list.map { item in
                    guard let command = item["command"] as? String, commandInvokes(command, scriptPath: scriptPath) else { return item }
                    found = true
                    return handler
                }
                group["hooks"] = list
                groups[index] = group
            }
            if !found {
                groups.append(["hooks": [handler]])
            }
            hooks[event] = groups
        }
        next["hooks"] = hooks
        return next
    }

    public static func remove(document: [String: Any]?, scriptPath: String) throws -> [String: Any] {
        if scriptPath.isEmpty { throw HookStoreError.path }
        var next = try copyDocument(document)
        var hooks = next["hooks"] as? [String: Any] ?? [:]
        for event in Array(hooks.keys) {
            let groups = try eventGroups(hooks[event], event: event)
            var kept: [Any] = []
            for group in groups {
                guard var object = group as? [String: Any], let list = object["hooks"] as? [[String: Any]] else {
                    kept.append(group)
                    continue
                }
                let remain = list.filter { item in
                    guard let command = item["command"] as? String else { return true }
                    return !commandInvokes(command, scriptPath: scriptPath)
                }
                if remain.isEmpty { continue }
                object["hooks"] = remain
                kept.append(object)
            }
            if kept.isEmpty { hooks.removeValue(forKey: event) }
            else { hooks[event] = kept }
        }
        next["hooks"] = hooks
        return next
    }

    public static func find(document: [String: Any]?, scriptPath: String) -> (permission: Bool, stop: Bool) {
        guard let hooks = document?["hooks"] as? [String: Any] else { return (false, false) }
        func present(_ event: String) -> Bool {
            guard let groups = hooks[event] as? [Any] else { return false }
            for group in groups {
                guard let list = (group as? [String: Any])?["hooks"] as? [[String: Any]] else { continue }
                if list.contains(where: { item in
                    guard let command = item["command"] as? String else { return false }
                    return commandInvokes(command, scriptPath: scriptPath)
                }) { return true }
            }
            return false
        }
        return (present("PermissionRequest"), present("Stop"))
    }

    private static func copyDocument(_ document: [String: Any]?) throws -> [String: Any] {
        if document == nil { return ["hooks": [String: Any]()] }
        guard let document else { throw HookStoreError.notObject }
        var copy = document
        if copy["hooks"] == nil { copy["hooks"] = [String: Any]() }
        guard copy["hooks"] is [String: Any] else { throw HookStoreError.badHooks }
        return copy
    }

    private static func eventGroups(_ value: Any?, event: String) throws -> [Any] {
        if value == nil { return [] }
        guard let groups = value as? [Any] else { throw HookStoreError.badEvent(event) }
        return groups
    }

    private static func tokens(_ command: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: #"(?:[^\s"']+|"[^"]*"|'[^']*')+"#) else { return [] }
        let range = NSRange(command.startIndex..., in: command)
        return regex.matches(in: command, range: range).compactMap { match in
            guard let slice = Range(match.range, in: command) else { return nil }
            var token = String(command[slice])
            if token.count >= 2, (token.hasPrefix("\"") && token.hasSuffix("\"")) || (token.hasPrefix("'") && token.hasSuffix("'")) {
                token.removeFirst()
                token.removeLast()
            }
            return token
        }
    }
}
