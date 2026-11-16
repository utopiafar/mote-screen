import Foundation

public enum InboxSummary {
    public static func fromHook(_ event: [String: Any], now: Date = Date()) -> [String: Any]? {
        guard let name = event["hook_event_name"] as? String else { return nil }
        guard name == "PermissionRequest" || name == "Stop" else { return nil }
        let project = basename(event["cwd"] as? String ?? "")
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let at = formatter.string(from: now)
        if name == "Stop" {
            return [
                "id": "stop:\(event["session_id"] as? String ?? "session"):\(at)",
                "kind": "stop",
                "title": "本轮已结束",
                "project": project,
                "source": "codex",
                "at": at
            ]
        }
        return [
            "id": "perm:\(event["session_id"] as? String ?? "session"):\(event["turn_id"] as? String ?? at)",
            "kind": "permission",
            "title": permissionTitle(event),
            "project": project,
            "source": "codex",
            "at": at
        ]
    }

    private static func basename(_ cwd: String) -> String {
        let text = cwd.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if text.isEmpty { return "codex" }
        return text.split(separator: "/").last.map(String.init) ?? "codex"
    }

    private static func permissionTitle(_ event: [String: Any]) -> String {
        let input = event["tool_input"] as? [String: Any] ?? [:]
        if let description = input["description"] as? String {
            let line = description.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            if !line.isEmpty { return clip(line) }
        }
        let tool = event["tool_name"] as? String ?? ""
        let command = (input["command"] as? String ?? "").split(whereSeparator: \.isWhitespace).joined(separator: " ")
        if tool == "Bash" || tool == "shell" {
            let shown = command.count > 32 ? String(command.prefix(32)) + "…" : (command.isEmpty ? "命令" : command)
            return clip("允许运行 \(shown)")
        }
        if tool == "apply_patch" || tool == "Edit" || tool == "Write" {
            let file = (input["path"] as? String) ?? (input["file_path"] as? String) ?? firstPath(command) 
            return clip("允许修改 \(file.isEmpty ? "文件" : file)")
        }
        if !tool.isEmpty { return clip("允许 \(tool)") }
        return "允许这次操作"
    }

    private static func firstPath(_ command: String) -> String {
        for part in command.split(separator: " ") {
            if part.contains(".") { return String(part) }
        }
        return ""
    }

    private static func clip(_ text: String) -> String {
        let chars = Array(text)
        if chars.count <= 48 { return text }
        return String(chars.prefix(47)) + "…"
    }
}
