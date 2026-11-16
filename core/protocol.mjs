/**
 * Mac → panel frames. Version 1. One JSON object per line.
 * The panel does not need to send conversation text back.
 * See protocol/PROTOCOL.md.
 */

export const PROTOCOL_VERSION = 1;
export const TCP_PORT = 7427;
export const HOOK_PORT = 7428;
export const MAX_HISTORY = 60;
export const MAX_INBOX = 8;
export const MAX_TITLE = 48;
export const MAX_PROJECT = 32;
export const MAX_SOURCES = 8;

const TYPES = new Set(["hello", "config", "speed", "inbox", "ping", "ack", "error", "wifi"]);

function clip(text, max) {
  const value = String(text ?? "");
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  return chars.slice(0, max).join("");
}

function finiteNumber(value, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

export function encodeFrame(frame) {
  if (!frame || typeof frame !== "object") throw new Error("帧必须是对象");
  if (frame.v !== PROTOCOL_VERSION) throw new Error("只编码协议版本 1");
  if (!TYPES.has(frame.type)) throw new Error(`未知帧类型: ${frame.type}`);
  return `${JSON.stringify(frame)}\n`;
}

export function decodeFrame(line) {
  const text = String(line).replace(/\r$/, "").trim();
  if (!text) throw new Error("空帧");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("帧不是 JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("帧必须是对象");
  if (raw.v !== PROTOCOL_VERSION) {
    const error = new Error("不支持的协议版本");
    error.code = "unsupportedVersion";
    throw error;
  }
  if (!TYPES.has(raw.type)) throw new Error(`未知帧类型: ${raw.type}`);
  return normalize(raw);
}

function normalize(raw) {
  if (raw.type === "hello") {
    const role = raw.role === "device" ? "device" : "mac";
    return { v: 1, type: "hello", role };
  }
  if (raw.type === "ping") return { v: 1, type: "ping", seq: finiteNumber(raw.seq, 0) };
  if (raw.type === "ack") {
    return { v: 1, type: "ack", seq: finiteNumber(raw.seq, 0), of: clip(raw.of, 16) };
  }
  if (raw.type === "error") {
    return { v: 1, type: "error", error: clip(raw.error, 48) };
  }
  if (raw.type === "wifi") {
    return { v: 1, type: "wifi", ssid: clip(raw.ssid, 32), password: clip(raw.password, 64) };
  }
  if (raw.type === "config") return normalizeConfig(raw);
  if (raw.type === "speed") return normalizeSpeed(raw);
  if (raw.type === "inbox") return normalizeInbox(raw);
  throw new Error("未知帧类型");
}

function normalizeConfig(raw) {
  const link = raw.link === "bluetooth" ? "bluetooth" : "wifi";
  return {
    v: 1,
    type: "config",
    seq: finiteNumber(raw.seq, 0),
    link,
    usbFallback: Boolean(raw.usbFallback),
    pushGeneratingSec: finiteNumber(raw.pushGeneratingSec, 15),
    pushIdleSec: finiteNumber(raw.pushIdleSec, 60),
    partialOnChange: raw.partialOnChange !== false,
    fullEveryN: finiteNumber(raw.fullEveryN, 10),
    fullEveryMin: finiteNumber(raw.fullEveryMin, 10),
  };
}

function normalizeSpeed(raw) {
  const sessions = raw.sessions && typeof raw.sessions === "object" ? raw.sessions : {};
  const history = Array.isArray(raw.history) ? raw.history.slice(-MAX_HISTORY).map((n) => finiteNumber(n, 0)) : [];
  const sources = Array.isArray(raw.sources) ? raw.sources.slice(0, MAX_SOURCES).map((src) => ({
    name: clip(src && src.name, 24),
    outputTokS: finiteNumber(src && src.outputTokS, 0),
  })) : [];
  const phase = raw.phase === "tools" || raw.phase === "idle" ? raw.phase : "generating";
  return {
    v: 1,
    type: "speed",
    seq: finiteNumber(raw.seq, 0),
    phase,
    outputTokS: finiteNumber(raw.outputTokS, 0),
    sessions: {
      active: finiteNumber(sessions.active, 0),
      generating: finiteNumber(sessions.generating, 0),
      tools: finiteNumber(sessions.tools, 0),
    },
    history,
    sources,
  };
}

function normalizeInbox(raw) {
  const items = Array.isArray(raw.items) ? raw.items : [];
  const kept = [];
  for (const item of items) {
    if (!item || (item.kind !== "permission" && item.kind !== "stop")) continue;
    if (item.source && item.source !== "codex") continue;
    kept.push({
      id: clip(item.id, 40),
      kind: item.kind,
      title: clip(item.title, MAX_TITLE),
      project: clip(item.project, MAX_PROJECT),
      at: clip(item.at, 40),
    });
    if (kept.length >= MAX_INBOX) break;
  }
  return { v: 1, type: "inbox", seq: finiteNumber(raw.seq, 0), items: kept };
}

export function configFrame(settings, seq) {
  return {
    v: 1,
    type: "config",
    seq,
    link: settings.link,
    usbFallback: settings.usbFallback,
    pushGeneratingSec: settings.pushGeneratingSec,
    pushIdleSec: settings.pushIdleSec,
    partialOnChange: settings.partialOnChange,
    fullEveryN: settings.fullEveryN,
    fullEveryMin: settings.fullEveryMin,
  };
}

export function createLinkSession() {
  return { connected: false, lastRxMs: null, lastSeq: 0, peer: null };
}

/** Drop the session when frames stop arriving. Default 3× the idle push, at least 45s. */
export function noteRx(session, frame, nowMs) {
  session.connected = true;
  session.lastRxMs = nowMs;
  if (frame && Number.isFinite(frame.seq)) session.lastSeq = frame.seq;
  return session;
}

export function pollLink(session, nowMs, timeoutMs) {
  if (session.lastRxMs == null) {
    session.connected = false;
    return session;
  }
  session.connected = nowMs - session.lastRxMs < timeoutMs;
  return session;
}

export function linkTimeoutMs(settings) {
  return Math.max(45_000, settings.pushIdleSec * 3 * 1000);
}
