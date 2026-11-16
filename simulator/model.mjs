/**
 * Simulator model. Every transition calls the shared core, then the page draws it.
 * No second state machine lives in the DOM layer.
 */

import { menuBarStatus, classifyHook, linkLabel } from "../core/status.mjs";
import { installHooks, removeHooks, findOurEntries } from "../core/hooks.mjs";
import {
  defaultSettings, applyPreset, updateSettings, msUntilPush, decideRefresh, activeTransport, linkLabel as transportName, refreshSummary,
} from "../core/settings.mjs";
import { encodeFrame, decodeFrame, configFrame, createLinkSession, noteRx, pollLink, linkTimeoutMs } from "../core/protocol.mjs";
import { summaryFromHook, upsertInbox, projectMeta } from "../core/inbox.mjs";
import { parseLiveFrame, emptySpeed, phaseLabel } from "../core/speed.mjs";
import { createDeviceState, wheel, press, boot, pendingItems, viewTitle, APPS } from "../core/device.mjs";

export const SCRIPT_PATH = "/Users/me/Library/Application Support/mote-screen/mote-screen-hook";

const FOREIGN = {
  description: "user hooks",
  hooks: {
    PreToolUse: [
      { matcher: "Bash", hooks: [{ type: "command", command: "/Users/me/.codex/hooks/mine.py", timeout: 30 }] },
    ],
  },
};

const DEMO_CURVE = [12, 18, 22, 41, 55, 63, 70, 68, 74, 80, 77, 69, 58, 61, 73, 81, 79, 76, 78, 75.9];

function liveFrame(mode) {
  if (mode === "idle") {
    return {
      schema: 1,
      type: "live",
      phase: "idle",
      outputTokS: 0,
      sessions: { active: 0, generating: 0, tools: 0 },
      sources: [
        { source: "codex", phase: "idle", outputTokS: 0 },
        { source: "claudeCode", phase: "idle", outputTokS: 0 },
        { source: "opencode", phase: "idle", outputTokS: 0 },
      ],
      history: { stepMs: 1000, outputTokS: DEMO_CURVE.map(() => 0) },
    };
  }
  return {
    schema: 1,
    type: "live",
    phase: "generating",
    outputTokS: 75.9,
    sessions: { active: 3, generating: 2, tools: 1 },
    sources: [
      { source: "codex", phase: "generating", outputTokS: 48.2 },
      { source: "claudeCode", phase: "generating", outputTokS: 27.7 },
      { source: "opencode", phase: "idle", outputTokS: 0 },
    ],
    history: { stepMs: 1000, outputTokS: DEMO_CURVE },
  };
}

export function createModel() {
  const model = {
    setupDone: false,
    step: "welcome",
    tab: "general",
    popoverOpen: false,
    loginItem: true,
    speedConnected: false,
    accessCodeSaved: false,
    hookRemembered: "never",
    scriptExists: false,
    hooksDoc: structuredClone(FOREIGN),
    codexDetected: true,
    settings: defaultSettings(),
    usbPlugged: false,
    bleFound: false,
    panelPorts: ["/dev/cu.usbmodem1101", "/dev/cu.usbmodem2101"],
    speed: parseLiveFrame(liveFrame("generating")),
    inbox: [
      { id: "1", kind: "permission", title: "允许运行 cargo test", project: "payments-api", source: "codex", at: "2026-11-16T03:55:40.000Z", wait: "已等 1 分 20 秒" },
      { id: "2", kind: "permission", title: "允许修改 src/main.rs", project: "eink-sidecar", source: "codex", at: "2026-11-16T03:56:24.000Z", wait: "已等 36 秒" },
      { id: "3", kind: "stop", title: "本轮已结束", project: "notes-cli", source: "codex", at: "2026-11-16T03:55:00.000Z", wait: "2 分钟前" },
    ],
    inboxDirty: true,
    lastPushMs: 0,
    nowMs: 0,
    device: createDeviceState(),
    partialsSinceFull: 0,
    msSinceFull: 0,
    lastRefresh: "full",
    pictureKey: "",
    framebuffer: null,
    seq: 1,
    linkSession: createLinkSession(),
    log: [],
    lastFrameText: "",
    lastInboxText: "",
    clock: "11:57",
    secretsCleared: false,
    quitAsked: false,
  };
  model.framebuffer = {
    speed: structuredClone(model.speed),
    inbox: model.inbox.map((item) => ({ ...item })),
  };
  return model;
}

export function hookLabel(model) {
  return classifyHook({
    entries: findOurEntries(model.hooksDoc, SCRIPT_PATH),
    scriptExists: model.scriptExists,
    remembered: model.hookRemembered,
  });
}

export function panelConnected(model) {
  const transport = activeTransport({
    settings: model.settings,
    usbPlugged: model.usbPlugged && Boolean(model.settings.usbPort),
  });
  if (transport === "usb") return true;
  if (transport === "bluetooth") return model.bleFound;
  return Boolean(model.settings.address);
}

export function menuLabel(model) {
  return menuBarStatus({
    setupInProgress: !model.setupDone,
    agentSpeedConnected: model.speedConnected,
    einkConnected: panelConnected(model),
    hook: hookLabel(model),
  });
}

export function popoverRows(model) {
  const hook = hookLabel(model);
  return {
    eink: linkLabel(panelConnected(model)),
    speed: linkLabel(model.speedConnected),
    hook,
    hookError: hook === "已失效",
  };
}

function log(model, line) {
  model.log = [`${model.clock}  ${line}`, ...model.log].slice(0, 12);
}

function deliver(model, frame, reason) {
  const encoded = encodeFrame(frame);
  const decoded = decodeFrame(encoded);
  model.lastFrameText = encoded.trim();
  if (decoded.type === "inbox") model.lastInboxText = model.lastFrameText;
  model.seq += 1;
  if (!panelConnected(model)) return false;
  noteRx(model.linkSession, decoded, model.nowMs);
  log(model, `推送 ${decoded.type} · ${reason}`);
  if (decoded.type === "speed" || decoded.type === "inbox") applyPicture(model);
  return true;
}

function pictureKey(model) {
  return JSON.stringify({
    phase: model.speed.phase,
    tok: model.speed.outputTokS,
    inbox: model.inbox.map((item) => item.id),
  });
}

function noteRefresh(model, contentChanged, viewChanged) {
  const kind = decideRefresh({
    policy: model.settings,
    contentChanged,
    viewChanged,
    partialsSinceFull: model.partialsSinceFull,
    msSinceFull: model.msSinceFull,
  });
  model.lastRefresh = kind;
  if (kind === "partial") {
    model.partialsSinceFull += 1;
    model.framebuffer = snapshot(model);
    log(model, "墨水屏局部刷新");
  } else if (kind === "full") {
    model.partialsSinceFull = 0;
    model.msSinceFull = 0;
    model.framebuffer = snapshot(model);
    log(model, "墨水屏完整刷新");
  }
}

function applyPicture(model) {
  const key = pictureKey(model);
  const changed = key !== model.pictureKey;
  noteRefresh(model, changed, false);
  model.pictureKey = key;
}

function snapshot(model) {
  return {
    speed: structuredClone(model.speed),
    inbox: model.inbox.map((item) => ({ ...item })),
  };
}

export function pushDue(model) {
  const inboxWait = msUntilPush({
    settings: model.settings,
    phase: model.speed.phase,
    inboxDirty: model.inboxDirty,
    lastPushMs: model.lastPushMs,
    nowMs: model.nowMs,
  });
  const speedWait = msUntilPush({
    settings: model.settings,
    phase: model.speed.phase,
    inboxDirty: false,
    lastPushMs: model.lastPushMs,
    nowMs: model.nowMs,
  });
  if (model.inboxDirty && inboxWait === 0) {
    const frame = {
      v: 1,
      type: "inbox",
      seq: model.seq,
      items: model.inbox.map(({ id, kind, title, project, source, at }) => ({ id, kind, title, project, source, at })),
    };
    if (deliver(model, frame, "Codex 立即")) model.inboxDirty = false;
  }
  const speedDue = msUntilPush({
    settings: model.settings,
    phase: model.speed.phase,
    inboxDirty: false,
    lastPushMs: model.lastPushMs,
    nowMs: model.nowMs,
  });
  if (speedDue === 0) {
    const frame = {
      v: 1,
      type: "speed",
      seq: model.seq,
      phase: model.speed.phase,
      outputTokS: model.speed.outputTokS,
      sessions: {
        active: model.speed.active,
        generating: model.speed.generating,
        tools: model.speed.tools,
      },
      history: model.speed.history.slice(-60),
      sources: model.speed.sources.map((src) => ({ name: src.name, outputTokS: src.outputTokS })),
    };
    if (deliver(model, frame, "速度")) model.lastPushMs = model.nowMs;
  }
  return { inboxWait, speedWait };
}

export function advance(model, ms) {
  model.nowMs += ms;
  model.msSinceFull += ms;
  pushDue(model);
  pollLink(model.linkSession, model.nowMs, linkTimeoutMs(model.settings));
}

export function connectSpeed(model) {
  model.speedConnected = true;
  model.accessCodeSaved = true;
  log(model, "Agent Speed 已连接  :7247");
}

export function installHook(model) {
  model.hooksDoc = installHooks(model.hooksDoc, SCRIPT_PATH);
  model.scriptExists = true;
  model.hookRemembered = "installed";
  log(model, "Codex hook 已写入，原有条目还在");
}

export function breakHook(model) {
  model.scriptExists = false;
  model.hookRemembered = "installed";
  log(model, "Codex hook 已失效：找不到脚本");
}

export function removeHook(model) {
  model.hooksDoc = removeHooks(model.hooksDoc, SCRIPT_PATH);
  model.scriptExists = false;
  model.hookRemembered = "removed";
  log(model, "已移除我们的 hook 条目和脚本");
}

export function go(model, step) {
  if (step === "daily" || step === "broken" || step === "cleanup") {
    model.setupDone = true;
  }
  if (["welcome", "speed", "hook", "eink", "done"].includes(step)) {
    model.setupDone = false;
    model.step = step;
  } else {
    model.step = step;
  }
  if (step === "broken") {
    model.tab = "hook";
    if (hookLabel(model) !== "已失效") breakHook(model);
  }
  if (step === "cleanup") model.tab = "cleanup";
  if (step === "daily") model.tab = model.tab || "general";
}

export function loadStage(model, id) {
  model.speedConnected = false;
  model.accessCodeSaved = false;
  model.hookRemembered = "never";
  model.scriptExists = false;
  model.hooksDoc = structuredClone(FOREIGN);
  model.bleFound = false;
  model.usbPlugged = false;
  model.linkSession = createLinkSession();
  model.settings = updateSettings(model.settings, { address: "", usbPort: "" });
  model.log = [];
  if (["hook", "eink", "done", "daily", "cleanup", "broken"].includes(id)) connectSpeed(model);
  if (["eink", "done", "daily", "cleanup", "broken"].includes(id)) installHook(model);
  if (id === "broken") breakHook(model);
  model.popoverOpen = ["daily", "broken", "cleanup"].includes(id);
  if (["welcome", "speed", "hook", "eink", "done"].includes(id)) {
    model.setupDone = false;
    model.step = id;
    return;
  }
  model.setupDone = true;
  model.step = id;
  model.tab = id === "broken" ? "hook" : id === "cleanup" ? "cleanup" : "general";
}

export function finishSetup(model) {
  model.setupDone = true;
  model.step = "daily";
  model.tab = "general";
  model.popoverOpen = true;
  log(model, "设置完成");
  pushDue(model);
}

export function patchSettings(model, patch) {
  model.settings = updateSettings(model.settings, patch);
  if (!deliver(model, configFrame(model.settings, model.seq), "设置")) {
    log(model, "设置已改，屏还没连上");
  }
}

export function scanWifi(model) {
  model.settings = updateSettings(model.settings, { address: "192.168.1.50:7427", link: "wifi" });
  log(model, "扫描到设备 192.168.1.50:7427");
  deliver(model, configFrame(model.settings, model.seq), "Wi-Fi");
  pushDue(model);
}

export function scanBluetooth(model) {
  model.bleFound = true;
  model.settings = updateSettings(model.settings, { link: "bluetooth" });
  log(model, "扫描到自制固件的蓝牙服务");
  deliver(model, configFrame(model.settings, model.seq), "蓝牙");
  pushDue(model);
}

export function chooseUsb(model, port) {
  model.settings = updateSettings(model.settings, { usbPort: port, usbFallback: true });
  model.usbPlugged = true;
  log(model, `选用串口 ${port}。这台 Mac 上还有别的 ESP32 口。`);
  deliver(model, configFrame(model.settings, model.seq), "USB");
  pushDue(model);
}

export function setUsbPlugged(model, plugged) {
  model.usbPlugged = plugged;
  const via = activeTransport({
    settings: model.settings,
    usbPlugged: plugged && Boolean(model.settings.usbPort),
  });
  log(model, plugged ? `USB 已插入，当前发送走 ${via}` : `USB 已拔出，当前发送走 ${transportName(model.settings.link)}`);
  pollLink(model.linkSession, model.nowMs, linkTimeoutMs(model.settings));
}

export function inject(model, kind) {
  if (kind === "permission") {
    const card = summaryFromHook({
      hook_event_name: "PermissionRequest",
      session_id: "thr_demo",
      turn_id: `turn_${model.seq}`,
      cwd: "/work/website",
      tool_name: "Bash",
      tool_input: { command: "git push", description: "允许运行 git push" },
      transcript_path: "/tmp/should-not-appear.jsonl",
      last_assistant_message: "不要出现",
    }, "2026-11-16T03:57:10.000Z");
    card.wait = "刚到达";
    model.inbox = upsertInbox(model.inbox, card).map((item) => ({ ...item, wait: item.wait || "刚刚" }));
    model.inboxDirty = true;
    if (model.device.view === "home") model.device.homeSel = 0;
    model.device.ovSel = 1;
    model.device.inboxSel = 0;
  } else if (kind === "stop") {
    const card = summaryFromHook({
      hook_event_name: "Stop",
      session_id: "thr_demo",
      cwd: "/work/website",
      last_assistant_message: "不要把这句送到屏上",
    }, "2026-11-16T03:57:20.000Z");
    card.wait = "刚刚";
    model.inbox = upsertInbox(model.inbox, card);
    model.inboxDirty = true;
  } else if (kind === "clear") {
    model.inbox = [];
    model.inboxDirty = true;
    model.device.inboxSel = 0;
    model.device.ovSel = 0;
  } else if (kind === "idle") {
    model.speed = parseLiveFrame(liveFrame("idle"));
  } else if (kind === "generating") {
    model.speed = parseLiveFrame(liveFrame("generating"));
  }
  const before = model.lastPushMs;
  pushDue(model);
  if ((kind === "permission" || kind === "stop" || kind === "clear") && model.lastInboxText.includes('"type":"inbox"')) {
    log(model, "待处理没有等速度间隔");
  }
  if (kind === "idle" || kind === "generating") {
    const wait = msUntilPush({
      settings: model.settings,
      phase: model.speed.phase,
      inboxDirty: false,
      lastPushMs: before,
      nowMs: model.nowMs,
    });
    if (wait > 0) log(model, `速度还要等 ${Math.round(wait / 1000)} 秒`);
  }
}

export function clearSecrets(model) {
  model.settings = updateSettings(model.settings, { address: "", usbPort: "" });
  model.accessCodeSaved = false;
  model.bleFound = false;
  model.usbPlugged = false;
  model.secretsCleared = true;
  model.linkSession = createLinkSession();
  log(model, "已清除访问码和设备地址");
}

export function selectOverview(model, index) {
  if (model.device.view !== "overview" || model.device.ovSel === index) return;
  model.device.ovSel = index;
  noteRefresh(model, true, false);
}

export function selectHome(model, index) {
  if (model.device.view !== "home" || model.device.homeSel === index) return;
  model.device.homeSel = index;
  noteRefresh(model, true, false);
}

export function deviceInput(model, action) {
  const before = JSON.stringify(model.device);
  const beforeView = model.device.view;
  if (action === "wheel-up") model.device = wheel(model.device, -1, model.inbox);
  if (action === "wheel-down") model.device = wheel(model.device, 1, model.inbox);
  if (action === "press") model.device = press(model.device, model.inbox);
  if (action === "boot") model.device = boot(model.device);
  if (JSON.stringify(model.device) === before) return;
  noteRefresh(model, true, model.device.view !== beforeView);
}

export function foreignHookSurvived(model) {
  const groups = model.hooksDoc.hooks && model.hooksDoc.hooks.PreToolUse;
  return Array.isArray(groups) && groups.some((group) => (group.hooks || []).some((hook) => String(hook.command).includes("mine.py")));
}

export { phaseLabel, projectMeta, pendingItems, viewTitle, APPS, refreshSummary, transportName, activeTransport };
