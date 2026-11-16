/**
 * Codex hook stdin → a short card. Conversation text stays off the panel.
 * Cursor events are not a thing here; anything that is not PermissionRequest
 * or Stop is ignored. Source is always codex.
 */

const TITLE_MAX = 48;

function basename(cwd) {
  const text = String(cwd ?? "").replace(/\/+$/, "");
  if (!text) return "codex";
  const parts = text.split("/");
  return parts[parts.length - 1] || "codex";
}

function oneLine(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function clip(text) {
  const chars = Array.from(text);
  if (chars.length <= TITLE_MAX) return text;
  return `${chars.slice(0, TITLE_MAX - 1).join("")}…`;
}

function permissionTitle(event) {
  const input = event.tool_input && typeof event.tool_input === "object" ? event.tool_input : {};
  const description = oneLine(input.description);
  if (description && !description.includes("\n")) return clip(description);
  const tool = String(event.tool_name ?? "");
  const command = oneLine(input.command);
  if (tool === "Bash" || tool === "shell") {
    const head = command.split(" ")[0] ? command : "命令";
    const shown = command.length > 32 ? `${command.slice(0, 32)}…` : (command || "命令");
    return clip(`允许运行 ${shown || head}`);
  }
  if (tool === "apply_patch" || tool === "Edit" || tool === "Write") {
    const file = oneLine(input.path || input.file_path || firstPath(command) || "文件");
    return clip(`允许修改 ${file}`);
  }
  if (tool) return clip(`允许 ${tool}`);
  return "允许这次操作";
}

function firstPath(command) {
  const match = String(command).match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/);
  return match ? match[1] : "";
}

export function summaryFromHook(event, nowIso) {
  if (!event || typeof event !== "object") return null;
  const name = event.hook_event_name;
  if (name !== "PermissionRequest" && name !== "Stop") return null;
  const project = basename(event.cwd);
  const at = nowIso || new Date().toISOString();
  if (name === "Stop") {
    return {
      id: `stop:${event.session_id || "session"}:${at}`,
      kind: "stop",
      title: "本轮已结束",
      project,
      source: "codex",
      at,
    };
  }
  return {
    id: `perm:${event.session_id || "session"}:${event.turn_id || at}`,
    kind: "permission",
    title: permissionTitle(event),
    project,
    source: "codex",
    at,
  };
}

export function upsertInbox(items, summary) {
  const next = Array.isArray(items) ? items.slice() : [];
  if (!summary) return next;
  const without = next.filter((item) => item.id !== summary.id);
  return [summary, ...without].slice(0, 8);
}

export function projectMeta(item) {
  return `codex · ${item.project}`;
}
