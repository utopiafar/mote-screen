/**
 * Agent Speed LAN frame (schema 1, type "live") → display model.
 * Quotas are ignored. Source rows may include other agents.
 * Those rows never become inbox items.
 */

const SOURCE_NAMES = {
  codex: "Codex",
  claudeCode: "Claude Code",
  claude: "Claude",
  cursor: "Cursor",
  opencode: "OpenCode",
  openCode: "OpenCode",
  gemini: "Gemini",
  aider: "Aider",
};

export function sourceDisplayName(id) {
  if (SOURCE_NAMES[id]) return SOURCE_NAMES[id];
  const text = String(id ?? "").trim();
  if (!text) return "其他";
  return text;
}

export function phaseLabel(phase) {
  if (phase === "tools") return "调用工具";
  if (phase === "idle") return "空闲";
  return "生成中";
}

export function parseLiveFrame(raw) {
  if (!raw || raw.type !== "live" || raw.schema !== 1) {
    throw new Error("不是 Agent Speed live 帧");
  }
  const sessions = raw.sessions || {};
  const sources = Array.isArray(raw.sources) ? raw.sources.map((src) => ({
    name: sourceDisplayName(src.source),
    source: String(src.source ?? ""),
    outputTokS: Number(src.outputTokS) || 0,
    phase: src.phase === "tools" || src.phase === "idle" ? src.phase : "generating",
  })) : [];
  const history = raw.history && Array.isArray(raw.history.outputTokS)
    ? raw.history.outputTokS.map((n) => Number(n) || 0)
    : [];
  return {
    phase: raw.phase === "tools" || raw.phase === "idle" ? raw.phase : "generating",
    outputTokS: Number(raw.outputTokS) || 0,
    active: Number(sessions.active) || 0,
    generating: Number(sessions.generating) || 0,
    tools: Number(sessions.tools) || 0,
    history,
    sources,
    name: typeof raw.name === "string" ? raw.name : "",
  };
}

export function emptySpeed() {
  return {
    phase: "idle",
    outputTokS: 0,
    active: 0,
    generating: 0,
    tools: 0,
    history: [0],
    sources: [],
    name: "",
  };
}
