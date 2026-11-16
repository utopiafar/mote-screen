/**
 * Append-only edits to the user-level ~/.codex/hooks.json.
 * Official events only: PermissionRequest and Stop.
 * Cleanup removes our handlers and the groups that become empty.
 * The file itself is never deleted, and other people's hooks stay put.
 */

export const HOOK_EVENTS = Object.freeze(["PermissionRequest", "Stop"]);

/** Quote so a path under Application Support still runs as one command. */
export function shellQuote(scriptPath) {
  if (!/[\s'"\\]/.test(scriptPath)) return scriptPath;
  return `'${scriptPath.replaceAll("'", `'\\''`)}'`;
}

export function ourHandler(scriptPath) {
  return {
    type: "command",
    command: shellQuote(scriptPath),
    timeout: 5,
    async: true,
    statusMessage: "通知墨水屏",
  };
}

function shellTokens(command) {
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return tokens.map((token) => token.replace(/^['"]|['"]$/g, ""));
}

export function commandInvokes(command, scriptPath) {
  if (typeof command !== "string" || typeof scriptPath !== "string" || !scriptPath) return false;
  if (command.trim() === scriptPath) return true;
  return shellTokens(command).includes(scriptPath);
}

export function isOurHandler(handler, scriptPath) {
  return Boolean(handler && handler.type === "command" && commandInvokes(handler.command, scriptPath));
}

function assertDocument(doc) {
  if (doc == null) return { hooks: {} };
  if (typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("hooks.json 不是对象，已停止写入，避免覆盖用户的文件");
  }
  const copy = structuredClone(doc);
  if (copy.hooks == null) copy.hooks = {};
  if (typeof copy.hooks !== "object" || Array.isArray(copy.hooks)) {
    throw new Error("hooks 字段不是对象，已停止写入");
  }
  return copy;
}

function eventGroups(hooks, event) {
  const groups = hooks[event];
  if (groups == null) return [];
  if (!Array.isArray(groups)) {
    throw new Error(`${event} 不是数组，已停止写入`);
  }
  return groups;
}

/**
 * Insert or refresh our handler on PermissionRequest and Stop.
 * Returns a new document. Does not mutate the input.
 */
export function installHooks(doc, scriptPath) {
  if (typeof scriptPath !== "string" || !scriptPath.startsWith("/")) {
    throw new Error("脚本路径必须是绝对路径");
  }
  const next = assertDocument(doc);
  const handler = ourHandler(scriptPath);
  for (const event of HOOK_EVENTS) {
    const groups = eventGroups(next.hooks, event).map((group) => structuredClone(group));
    let found = false;
    for (const group of groups) {
      if (!group || typeof group !== "object" || !Array.isArray(group.hooks)) continue;
      group.hooks = group.hooks.map((item) => {
        if (!isOurHandler(item, scriptPath)) return item;
        found = true;
        return structuredClone(handler);
      });
    }
    if (!found) {
      groups.push({ hooks: [structuredClone(handler)] });
    }
    next.hooks[event] = groups;
  }
  return next;
}

function groupHasForeignHooks(group, scriptPath) {
  if (!group || typeof group !== "object" || !Array.isArray(group.hooks)) return true;
  return group.hooks.some((item) => !isOurHandler(item, scriptPath));
}

/**
 * Remove only handlers whose command invokes scriptPath.
 * A matcher group is dropped when every remaining handler was ours.
 * Other events, matchers, and top-level keys stay.
 * An empty hooks object is left in place; the file is not deleted.
 */
export function removeHooks(doc, scriptPath) {
  if (typeof scriptPath !== "string" || !scriptPath) {
    throw new Error("缺少脚本路径");
  }
  const next = assertDocument(doc);
  for (const event of Object.keys(next.hooks)) {
    const groups = eventGroups(next.hooks, event);
    const kept = [];
    for (const group of groups) {
      if (!group || typeof group !== "object" || !Array.isArray(group.hooks)) {
        kept.push(structuredClone(group));
        continue;
      }
      const hooks = group.hooks.filter((item) => !isOurHandler(item, scriptPath));
      if (hooks.length === 0 && !groupHasForeignHooks({ ...group, hooks: group.hooks }, scriptPath)) {
        continue;
      }
      if (hooks.length === 0) continue;
      kept.push({ ...structuredClone(group), hooks });
    }
    if (kept.length === 0) delete next.hooks[event];
    else next.hooks[event] = kept;
  }
  return next;
}

export function findOurEntries(doc, scriptPath) {
  const found = { permission: false, stop: false };
  if (!doc || typeof doc !== "object" || !doc.hooks || typeof doc.hooks !== "object") return found;
  const map = { PermissionRequest: "permission", Stop: "stop" };
  for (const [event, key] of Object.entries(map)) {
    const groups = doc.hooks[event];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) continue;
      if (group.hooks.some((item) => isOurHandler(item, scriptPath))) found[key] = true;
    }
  }
  return found;
}

/** Stable JSON with a trailing newline, for writing hooks.json. */
export function serializeHooks(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
