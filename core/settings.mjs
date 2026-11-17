/**
 * Link choice, push cadence, and panel refresh policy.
 * USB is a docked fallback, not a third exclusive mode.
 * Codex permission / stop pushes ignore the timer.
 * Defaults favour a 1200 mAh pack with the Wi-Fi radio available.
 */

export const LINKS = Object.freeze(["wifi", "bluetooth"]);

export const PUSH_CHOICES_SEC = Object.freeze([5, 15, 30, 60, 300]);
export const FULL_EVERY_N_CHOICES = Object.freeze([0, 5, 10, 20]);
export const FULL_EVERY_MIN_CHOICES = Object.freeze([0, 5, 10, 30]);

export const PRESETS = Object.freeze({
  saver: Object.freeze({
    id: "saver",
    label: "省电",
    pushGeneratingSec: 60,
    pushIdleSec: 300,
    partialOnChange: true,
    fullEveryN: 0,
    fullEveryMin: 0,
  }),
  balanced: Object.freeze({
    id: "balanced",
    label: "均衡",
    pushGeneratingSec: 15,
    pushIdleSec: 60,
    partialOnChange: true,
    fullEveryN: 0,
    fullEveryMin: 0,
  }),
  timely: Object.freeze({
    id: "timely",
    label: "及时",
    pushGeneratingSec: 5,
    pushIdleSec: 15,
    partialOnChange: true,
    fullEveryN: 0,
    fullEveryMin: 0,
  }),
});

/* Pairs shipped as the 省电 / 均衡 / 及时 refresh defaults before cleanup was opt-in.
 * Mac calls this once, when the stored state has no refreshCleanupMigrated flag.
 * A later choice of the same numbers stays. */
const LEGACY_CLEANUP_PAIRS = Object.freeze([
  Object.freeze([5, 5]),
  Object.freeze([10, 10]),
  Object.freeze([20, 30]),
]);

export function migrateLegacyCleanup(settings) {
  const legacy = LEGACY_CLEANUP_PAIRS.some(([n, minutes]) => settings.fullEveryN === n && settings.fullEveryMin === minutes);
  if (!legacy) return settings;
  return { ...settings, fullEveryN: 0, fullEveryMin: 0 };
}

const PRESET_LIST = Object.values(PRESETS);

export function defaultSettings() {
  return {
    link: "wifi",
    usbFallback: true,
    address: "",
    usbPort: "",
    preset: "balanced",
    pushGeneratingSec: PRESETS.balanced.pushGeneratingSec,
    pushIdleSec: PRESETS.balanced.pushIdleSec,
    partialOnChange: PRESETS.balanced.partialOnChange,
    fullEveryN: PRESETS.balanced.fullEveryN,
    fullEveryMin: PRESETS.balanced.fullEveryMin,
  };
}

function policyFields(settings) {
  return {
    pushGeneratingSec: settings.pushGeneratingSec,
    pushIdleSec: settings.pushIdleSec,
    partialOnChange: settings.partialOnChange,
    fullEveryN: settings.fullEveryN,
    fullEveryMin: settings.fullEveryMin,
  };
}

export function presetMatching(settings) {
  return PRESET_LIST.find((preset) => {
    const fields = policyFields(settings);
    return Object.keys(fields).every((key) => fields[key] === preset[key]);
  });
}

export function applyPreset(settings, presetId) {
  const preset = PRESETS[presetId];
  if (!preset) throw new Error(`未知预设: ${presetId}`);
  return {
    ...settings,
    preset: preset.id,
    pushGeneratingSec: preset.pushGeneratingSec,
    pushIdleSec: preset.pushIdleSec,
    partialOnChange: preset.partialOnChange,
    fullEveryN: preset.fullEveryN,
    fullEveryMin: preset.fullEveryMin,
  };
}

function assertChoice(value, choices, name) {
  if (!choices.includes(value)) throw new Error(`${name} 不在可选范围内`);
}

export function updateSettings(settings, patch) {
  const next = { ...settings, ...patch };
  if (!LINKS.includes(next.link)) throw new Error("连接方式只能是 Wi-Fi 或蓝牙");
  assertChoice(next.pushGeneratingSec, PUSH_CHOICES_SEC, "生成中间隔");
  assertChoice(next.pushIdleSec, PUSH_CHOICES_SEC, "空闲间隔");
  assertChoice(next.fullEveryN, FULL_EVERY_N_CHOICES, "完整刷新次数");
  assertChoice(next.fullEveryMin, FULL_EVERY_MIN_CHOICES, "完整刷新间隔");
  if (typeof next.partialOnChange !== "boolean") throw new Error("局部刷新必须是布尔值");
  if (typeof next.usbFallback !== "boolean") throw new Error("USB 备份必须是布尔值");
  if (typeof next.address !== "string" || typeof next.usbPort !== "string") {
    throw new Error("地址和串口必须是字符串");
  }
  const matched = presetMatching(next);
  next.preset = matched ? matched.id : "custom";
  return next;
}

export function pushIntervalSec(settings, phase) {
  if (phase === "idle") return settings.pushIdleSec;
  return settings.pushGeneratingSec;
}

/**
 * Milliseconds until the next speed / heartbeat push.
 * inboxDirty means a PermissionRequest or Stop has not been pushed yet.
 */
export function msUntilPush({ settings, phase, inboxDirty, lastPushMs, nowMs }) {
  if (inboxDirty) return 0;
  const interval = pushIntervalSec(settings, phase) * 1000;
  const elapsed = Math.max(0, nowMs - lastPushMs);
  return Math.max(0, interval - elapsed);
}

/**
 * Panel policy. "full" is the occasional 1-bit base refresh and may flash.
 * A page change stays "partial": the non-flashing update that keeps the previous frame as its base.
 * partialOnChange does not cover page changes. It only applies to later updates on the same page.
 * fullEveryN and fullEveryMin are off at 0. A positive count or timer still requests "full",
 * including when it lands on a page change.
 * A due timer refreshes even when the picture has not changed.
 */
export function decideRefresh({ policy, contentChanged, viewChanged, partialsSinceFull, msSinceFull }) {
  const timeDue = policy.fullEveryMin > 0 && msSinceFull >= policy.fullEveryMin * 60 * 1000;
  const countDue = policy.fullEveryN > 0 && partialsSinceFull >= policy.fullEveryN;
  if (viewChanged) {
    if (timeDue || countDue) return "full";
    return "partial";
  }
  if (!contentChanged && !timeDue) return "none";
  if (timeDue || countDue || !policy.partialOnChange) return "full";
  return "partial";
}

export function formatSeconds(sec) {
  if (sec % 60 === 0) {
    const minutes = sec / 60;
    return `${minutes} 分钟`;
  }
  return `${sec} 秒`;
}

export function linkLabel(link) {
  return link === "bluetooth" ? "蓝牙" : "Wi-Fi";
}

export function refreshSummary(settings) {
  if (!settings.partialOnChange) {
    return settings.fullEveryMin > 0 ? `完整 · 每 ${settings.fullEveryMin} 分钟` : "完整";
  }
  if (settings.fullEveryN > 0) return `局部 · 每 ${settings.fullEveryN} 次`;
  if (settings.fullEveryMin > 0) return `局部 · 每 ${settings.fullEveryMin} 分钟`;
  return "局部";
}

/** Which pipe the Mac should write to right now. */
export function activeTransport({ settings, usbPlugged }) {
  if (settings.usbFallback && usbPlugged) return "usb";
  return settings.link;
}
