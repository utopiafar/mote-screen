import Foundation

public enum ProtocolCodec {
    public static let version = 1
    public static let tcpPort = 7427
    public static let hookPort = 7428

    public static func configFrame(settings: ScreenSettings, seq: Int) -> [String: Any] {
        [
            "v": version,
            "type": "config",
            "seq": seq,
            "link": settings.link.rawValue,
            "usbFallback": settings.usbFallback,
            "pushGeneratingSec": settings.pushGeneratingSec,
            "pushIdleSec": settings.pushIdleSec,
            "partialOnChange": settings.partialOnChange,
            "fullEveryN": settings.fullEveryN,
            "fullEveryMin": settings.fullEveryMin
        ]
    }

    public static func speedFrame(seq: Int, phase: String, outputTokS: Double, active: Int, generating: Int, tools: Int, history: [Double], sources: [[String: Any]]) -> [String: Any] {
        [
            "v": version,
            "type": "speed",
            "seq": seq,
            "phase": phase,
            "outputTokS": outputTokS,
            "sessions": ["active": active, "generating": generating, "tools": tools],
            "history": history.suffix(60),
            "sources": Array(sources.prefix(8))
        ]
    }

    public static func inboxFrame(seq: Int, items: [[String: Any]]) -> [String: Any] {
        let kept = items.filter { item in
            let kind = item["kind"] as? String
            let source = item["source"] as? String
            return (kind == "permission" || kind == "stop") && (source == nil || source == "codex")
        }.prefix(8)
        return ["v": version, "type": "inbox", "seq": seq, "items": Array(kept)]
    }

    public static func encode(_ frame: [String: Any]) throws -> Data {
        let data = try JSONSerialization.data(withJSONObject: frame, options: [])
        var line = data
        line.append(0x0A)
        return line
    }

    public static func decode(_ line: String) throws -> [String: Any] {
        let text = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = text.data(using: .utf8),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ProtocolError.badFrame
        }
        guard (object["v"] as? Int) == version || (object["v"] as? NSNumber)?.intValue == version else {
            throw ProtocolError.unsupportedVersion
        }
        guard let type = object["type"] as? String else { throw ProtocolError.badFrame }
        switch type {
        case "hello", "config", "speed", "inbox", "ping", "ack", "error", "wifi":
            return object
        default:
            throw ProtocolError.badFrame
        }
    }

    public static func linkTimeoutMs(idleSec: Int) -> Int {
        max(45_000, idleSec * 3 * 1000)
    }
}

public enum ProtocolError: Error {
    case badFrame
    case unsupportedVersion
}
