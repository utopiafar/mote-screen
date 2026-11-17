/**
 * Menu-bar and popover status. Canonical on Linux; the Mac app ports this.
 *
 * Menu bar, only these four:
 *   设置中 / 未连接 / 已连接 / Hook 失效
 * Popover links: 已连接 / 未连接
 * Codex hook: 已安装 / 未安装 / 已失效 / 已移除
 *
 * Hook 失效 wins over every other menu label, including an open wizard.
 * 已连接 needs the panel, Agent Speed, and an installed hook together.
 * Skipping the panel during setup leaves the menu at 未连接 afterwards.
 */

export const MENU = Object.freeze({
  setup: "设置中",
  disconnected: "未连接",
  connected: "已连接",
  hookBroken: "Hook 失效",
});

export const LINK = Object.freeze({
  connected: "已连接",
  disconnected: "未连接",
});

export const HOOK = Object.freeze({
  installed: "已安装",
  missing: "未安装",
  broken: "已失效",
  removed: "已移除",
});

const HOOK_VALUES = new Set(Object.values(HOOK));

export function linkLabel(connected) {
  return connected ? LINK.connected : LINK.disconnected;
}

/**
 * @param {object} input
 * @param {boolean} input.setupInProgress
 * @param {boolean} input.agentSpeedConnected
 * @param {boolean} input.einkConnected
 * @param {"已安装"|"未安装"|"已失效"|"已移除"} input.hook
 */
export function menuBarStatus(input) {
  if (!input || !HOOK_VALUES.has(input.hook)) {
    throw new Error("menuBarStatus: hook 必须是已安装、未安装、已失效或已移除");
  }
  if (input.hook === HOOK.broken) return MENU.hookBroken;
  if (input.setupInProgress) return MENU.setup;
  if (input.agentSpeedConnected && input.einkConnected && input.hook === HOOK.installed) {
    return MENU.connected;
  }
  return MENU.disconnected;
}

/**
 * remembered: "never" | "installed" | "removed"
 * entries: our PermissionRequest / Stop handlers currently in hooks.json
 * scriptExists: the script file is still at the path we registered
 */
export function classifyHook({ entries, scriptExists, remembered }) {
  const permission = Boolean(entries && entries.permission);
  const stop = Boolean(entries && entries.stop);
  const any = permission || stop;
  const complete = permission && stop && scriptExists;
  if (complete) return HOOK.installed;
  if (remembered === "removed" && !any) return HOOK.removed;
  if (remembered === "installed" || any || (remembered === "removed" && any)) return HOOK.broken;
  return HOOK.missing;
}
