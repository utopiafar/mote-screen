import {
  createModel, loadStage, menuLabel, popoverRows, hookLabel, panelConnected, connectSpeed, installHook,
  finishSetup, go, patchSettings, scanWifi, scanBluetooth, chooseUsb, setUsbPlugged, inject, advance,
  removeHook, clearSecrets, deviceInput, selectHome, selectOverview, phaseLabel, projectMeta, pendingItems, viewTitle, APPS, refreshSummary,
  transportName, activeTransport, foreignHookSurvived,
} from "./model.mjs";
import { PUSH_CHOICES_SEC, FULL_EVERY_N_CHOICES, FULL_EVERY_MIN_CHOICES, PRESETS, formatSeconds } from "../core/settings.mjs";

const params = new URLSearchParams(location.search);
const chrome = params.get("chrome") !== "0" && params.get("shot") !== "1";
const model = createModel();
loadStage(model, params.get("stage") || "welcome");
if (params.get("tab")) model.tab = params.get("tab");
const screen = params.get("screen");
if (["home", "overview", "speed", "inbox", "clock", "settings"].includes(screen) || screen === "workbench") {
  model.device.view = screen === "workbench" ? "overview" : screen;
}

const ICON = {
  general: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6.8 1.6h2.4l.3 1.5c.4.1.7.3 1.1.6l1.4-.5 1.2 2.1-1.2.9c.1.3.1.7.1 1 0 .4 0 .7-.1 1l1.2.9-1.2 2.1-1.4-.5c-.4.3-.7.5-1.1.6l-.3 1.5H6.8l-.3-1.5c-.4-.1-.7-.3-1.1-.6l-1.4.5-1.2-2.1 1.2-.9a4 4 0 0 1 0-2l-1.2-.9 1.2-2.1 1.4.5c.4-.3.7-.5 1.1-.6l.3-1.5zM8 6.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z"/></svg>',
  speed: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.7a6.3 6.3 0 1 0 4.5 10.7l.9.9 1-1-.9-.9A6.3 6.3 0 0 0 8 1.7zm0 1.3a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm.1 1.6h1.1v2.7l1.9 1.3-.6.9L8.1 7.5z"/></svg>',
  hook: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.4 2.4h9.2v11.2H3.4zm1.3 1.3v8.6h6.6V3.7zM5.6 5.1h4.6v1.1H5.6zm0 2.2h4.6v1.1H5.6zm0 2.2h2.8v1.1H5.6z"/></svg>',
  eink: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.3 3.2h11.4v8.4H2.3zm1.3 1.3v5.8h8.8V4.5zM6.2 12.4h3.6v1.1H6.2z"/></svg>',
  debug: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M10.4 2.3 12 3.9l-1.2 1.2 1.1 1.1 1.2-1.2 1.6 1.6-1.2 1.2-1.5-1.5-5.7 5.7-2.4-.1-.1-2.4 5.7-5.7-1.5-1.5 1.2-1.2 1.6 1.6 1.2-1.2z"/></svg>',
  cleanup: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6.1 2.2h3.8l.5 1.3h2.8v1.2H2.8V3.5h2.8zm-.4 3.7h4.6v7.4c0 .4-.3.7-.7.7H6.4c-.4 0-.7-.3-.7-.7z"/></svg>',
  about: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.6a6.4 6.4 0 1 0 0 12.8A6.4 6.4 0 0 0 8 1.6zm0 1.3a5.1 5.1 0 1 1 0 10.2 5.1 5.1 0 0 1 0-10.2zM7.4 4.5h1.2v1.4H7.4zm0 2.5h1.2v4.6H7.4z"/></svg>',
};
const TABS = [
  ["general", "一般"], ["speed", "Agent Speed"], ["hook", "Codex"], ["eink", "墨水屏"],
  ["debug", "调试"], ["cleanup", "清理"], ["about", "关于"],
];
const STAGES = [
  ["welcome", "第一次打开"], ["speed", "Agent Speed"], ["hook", "安装 Hook"], ["eink", "墨水屏"],
  ["done", "完成"], ["daily", "日常设置"], ["broken", "Hook 失效"], ["cleanup", "清理"],
];

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch]));

function pip(label) {
  if (label === "已连接") return "ok";
  if (label === "Hook 失效") return "err";
  return "";
}

function spark(pts, w, h, pad) {
  const max = Math.max(1, ...pts);
  const step = (w - pad * 2) / Math.max(1, pts.length - 1);
  const xy = pts.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)]);
  const d = xy.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${d} L ${xy.at(-1)[0].toFixed(1)} ${h - 2} L ${xy[0][0].toFixed(1)} ${h - 2} Z`;
  return `<path d="${d}" fill="none" stroke="#111" stroke-width="4" stroke-linecap="square" stroke-linejoin="miter"/>`;
}

function cardHtml(item, selected, compact) {
  const urgent = item.kind === "permission";
  const tag = urgent ? "等待批准" : "已结束";
  return `<article class="card${urgent ? " urgent" : ""}${selected ? " sel" : ""}">
    <div><span class="tag">${tag}</span></div>
    <div class="title">${esc(item.title)}</div>
    <div class="meta">${esc(projectMeta(item))}</div>
    ${compact ? "" : `<div class="wait">${esc(item.wait || "")}</div>`}
  </article>`;
}

function renderDevice() {
  const view = model.device.view;
  const fb = model.framebuffer;
  const speed = fb.speed;
  const items = fb.inbox;
  const waits = pendingItems(items);
  const tok = speed.phase === "idle" ? "0" : Number(speed.outputTokS).toFixed(1);
  const homeStatus = `<div>${tok} tok/s</div><div>${waits.length ? `${waits.length} 条待处理` : "一切安静"}</div>`;
  const cells = APPS.map((app, i) => {
    const sel = i === model.device.homeSel ? " sel" : "";
    const reserved = app.reserved ? " reserved" : "";
    const badge = app.id === "workbench" && waits.length ? `<span class="badge">${waits.length}</span>` : "";
    const st = app.id === "workbench" ? homeStatus : (app.reserved ? "尚未开放" : "");
    return `<button type="button" class="cell${sel}${reserved}" data-cell="${i}">
      <div><div class="kicker">${app.kicker}</div><div class="name">${app.name}${badge}</div></div>
      ${st ? `<div class="cell-status">${st}</div>` : "<div></div>"}
    </button>`;
  }).join("");
  const preview = waits.slice(0, 2);
  const rows = popoverRows(model);
  const feet = {
    home: ["上 / 下选择", "按下打开"],
    overview: ["上 / 下选择", "按下进入详情 · BOOT 回桌面"],
    speed: ["速度来自 Agent Speed", "BOOT 返回工作台"],
    inbox: [items.length ? "上 / 下浏览" : "暂无条目", "BOOT 返回工作台"],
    clock: ["", "BOOT 回桌面"],
    settings: ["与 Mac 的连接状态", "BOOT 回桌面"],
  };
  const foot = feet[view] || ["", "BOOT 返回"];
  const curve = speed.history.length ? speed.history : [0];
  const refreshName = model.lastRefresh === "full" ? "基线刷新" : model.lastRefresh === "partial" ? "局部刷新" : "尚未刷新";
  document.getElementById("deviceCol").innerHTML = `
    <div class="panel-stack">
    <div class="refresh-flag" data-refresh="${esc(model.lastRefresh)}">${refreshName}</div>
    <div class="panel" id="panel">
      <header class="topbar"><div class="brand">${esc(viewTitle(view))}</div><div class="clock num">${esc(model.clock)}</div></header>
      <section class="view ${view === "home" ? "on" : ""}" id="view-home"><div class="desk">${cells}</div></section>
      <section class="view ${view === "overview" ? "on" : ""}">
        <div class="overview">
          <button type="button" class="half speed ${view === "overview" && model.device.ovSel === 0 ? "sel" : ""}" data-act="press-speed">
            <div>
              <div class="ov-label"><span>速度</span><span class="go">按下查看详情</span></div>
              <div class="ov-tok num">${tok}<span class="unit">tok/s</span></div>
              <div class="ov-phase">${esc(phaseLabel(speed.phase))} · ${speed.active} 个会话在跑</div>
            </div>
            <svg class="spark-sm" viewBox="0 0 436 56" preserveAspectRatio="none">${spark(curve, 436, 56, 4)}</svg>
          </button>
          <div class="half inbox">
            <div class="ov-label"><span>CODEX 待处理</span><span class="go">${preview.length ? "按下查看全部" : ""}</span></div>
            <div class="ov-cards">${preview.map((item, i) => cardHtml(item, model.device.ovSel === i + 1, true)).join("")}</div>
            <div class="empty" ${preview.length ? "hidden" : ""}><h1>一切安静</h1><p>没有等待批准的 Codex 对话。</p></div>
          </div>
        </div>
      </section>
      <section class="view ${view === "speed" ? "on" : ""}">
        <div class="speed-hero">
          <div class="label">AGENT SPEED · 本机输出</div>
          <div class="value num">${tok}<span class="unit">tok/s</span></div>
          <div class="phase">${esc(phaseLabel(speed.phase))}</div>
        </div>
        <div class="counts">
          <div class="count"><div class="n num">${speed.active}</div><div class="l">进行中</div></div>
          <div class="count"><div class="n num">${speed.generating}</div><div class="l">正在生成</div></div>
          <div class="count"><div class="n num">${speed.tools}</div><div class="l">调用工具</div></div>
        </div>
        <div class="chart-wrap"><div class="label">近一分钟</div>
          <svg class="spark" viewBox="0 0 432 88" preserveAspectRatio="none">${spark(curve, 432, 88, 8)}</svg>
        </div>
        <div class="sources">${speed.sources.map((src) => `<div class="src"><span>${esc(src.name)}</span><span class="n num">${speed.phase === "idle" ? "0.0" : Number(src.outputTokS).toFixed(1)} tok/s</span></div>`).join("")}</div>
      </section>
      <section class="view ${view === "inbox" ? "on" : ""}">
        <div class="inbox-head"><h1>Codex 待处理</h1><div class="count-label num">${waits.length ? `${waits.length} 条在等批准` : "暂无等待"}</div></div>
        <div class="list">${items.length ? items.map((item, i) => cardHtml(item, i === model.device.inboxSel, false)).join("") : ""}</div>
        <div class="empty" ${items.length ? "hidden" : ""}><h1>一切安静</h1><p>没有等待批准或刚结束的 Codex 对话。</p></div>
      </section>
      <section class="view ${view === "clock" ? "on" : ""}">
        <div class="clock-hero"><div class="big num">${esc(model.clock)}</div><div class="date">星期一 11 月 16 日</div></div>
      </section>
      <section class="view ${view === "settings" ? "on" : ""}">
        <div class="stack">
          <div class="rowline"><span class="k">墨水屏</span><span class="v">${rows.eink}</span></div>
          <div class="rowline"><span class="k">Agent Speed</span><span class="v">${rows.speed}</span></div>
          <div class="rowline"><span class="k">Codex hook</span><span class="v">${rows.hook}</span></div>
          <div class="rowline"><span class="k">连接方式</span><span class="v">${transportName(model.settings.link)}</span></div>
          <div class="rowline"><span class="k">刷新</span><span class="v">${esc(refreshSummary(model.settings))}</span></div>
        </div>
      </section>
      <footer class="foot"><span>${foot[0]}</span><span>${foot[1]}</span></footer>
    </div>
    </div>
    <div class="hw">
      <div class="cap">滚轮</div>
      <div class="wheel">
        <button type="button" data-act="wheel-up">上</button>
        <button type="button" data-act="press">按下</button>
        <button type="button" data-act="wheel-down">下</button>
      </div>
      <div class="cap" style="margin-top:18px">按键</div>
      <button class="boot" type="button" data-act="boot">BOOT</button>
    </div>`;
}

function select(name, value, choices, labelOf) {
  return `<select class="quiet" data-set="${name}">${choices.map((choice) => `<option value="${choice}"${choice === value ? " selected" : ""}>${labelOf(choice)}</option>`).join("")}</select>`;
}

function switchHtml(on, action) {
  return `<button type="button" class="switch${on ? "" : " off"}" data-act="${action}" aria-pressed="${on}"></button>`;
}

function segment(name, value, options) {
  return `<div class="segment">${options.map(([id, label]) => `<button type="button" class="${value === id ? "on" : ""}" data-set="${name}" data-value="${id}">${label}</button>`).join("")}</div>`;
}

function paneGeneral() {
  return `<h2>一般</h2>
    <div class="caption">启动</div>
    <div class="group">
      <div class="grow"><div>开机启动<span class="help">打开时，系统可能会再确认一次</span></div>${switchHtml(model.loginItem, "login")}</div>
      <div class="grow"><div>再走一遍设置向导<span class="help">第一次安装的步骤可以随时重来</span></div><button class="btn" type="button" data-stage="welcome">打开向导</button></div>
    </div>
    <div class="caption">菜单栏</div>
    <div class="group"><div class="grow"><span>显示内容</span><span class="v">仅连接状态</span></div></div>
    <p class="footer-note">速度看 Agent Speed，对话在 Codex 里处理，不在菜单栏重复显示。</p>`;
}

function paneSpeed() {
  return `<h2>Agent Speed</h2>
    <p class="pane-lead">从它的局域网接口读速度。接口默认是关的，需要在 Agent Speed 里打开。</p>
    <div class="group">
      <div class="grow"><span>状态</span><span class="v">${model.speedConnected ? "已连接" : "未连接"}</span></div>
      <div class="grow"><span>端口</span><span class="v">7247</span></div>
      <div class="grow"><span>访问码</span><span class="v">${model.accessCodeSaved ? "已保存" : "未填写"}</span></div>
    </div>
    <div class="actions"><button class="btn" type="button" data-act="test-speed">测试连接</button><button class="btn" type="button" data-act="save-code">更改访问码</button></div>
    <p class="footer-note">未连接时，先确认 Agent Speed 已打开局域网，端口一致，访问码没有改过。</p>`;
}

function paneHook() {
  const label = hookLabel(model);
  if (label === "已失效") {
    return `<h2>Codex</h2>
      <div class="alert"><strong>Hook 已失效</strong>找不到我们登记的条目，或脚本已经不在原位置。常见原因是用户目录下的 <span class="mono">.codex/hooks.json</span> 被改写，或数据目录里的脚本被移走。</div>
      <div class="group">
        <div class="grow"><span>Codex</span><span class="v">${model.codexDetected ? "已检测到" : "未检测到"}</span></div>
        <div class="grow"><span>Hook 状态</span><span class="v err">已失效</span></div>
        <div class="grow"><span>登记位置</span><span class="v mono">.codex/hooks.json</span></div>
        <div class="grow"><span>事件</span><span class="v">PermissionRequest · Stop</span></div>
      </div>
      <div class="actions"><button class="btn primary" type="button" data-act="reinstall-hook">重新安装 hook</button><button class="btn" type="button" data-act="show-hooks">打开 hooks.json</button></div>
      <p class="footer-note">重新安装只会写回我们自己的脚本和条目，不会覆盖你的其他 hook。</p>`;
  }
  if (label === "已移除" || label === "未安装") {
    return `<h2>Codex</h2>
      <p class="pane-lead">还没有安装 hook。装上之后，Codex 需要你批准或一轮结束时，会通知这个客户端。不会传送对话正文。</p>
      <div class="group">
        <div class="grow"><span>Codex</span><span class="v">${model.codexDetected ? "已检测到" : "未检测到"}</span></div>
        <div class="grow"><span>Hook 状态</span><span class="v">${label}</span></div>
        <div class="grow"><span>将登记到</span><span class="v mono">.codex/hooks.json</span></div>
        <div class="grow"><span>事件</span><span class="v">PermissionRequest · Stop</span></div>
      </div>
      <div class="actions"><button class="btn primary" type="button" data-act="reinstall-hook">安装 hook</button></div>`;
  }
  return `<h2>Codex</h2>
    <p class="pane-lead">Hook 已安装。它只通知「有事要看」，不会把对话正文送到墨水屏。</p>
    <div class="group">
      <div class="grow"><span>Codex</span><span class="v">已检测到</span></div>
      <div class="grow"><span>Hook 状态</span><span class="v">已安装</span></div>
      <div class="grow"><span>登记位置</span><span class="v mono">.codex/hooks.json</span></div>
      <div class="grow"><span>事件</span><span class="v">PermissionRequest · Stop</span></div>
    </div>
    <div class="caption">维护</div>
    <div class="group">
      <div class="grow"><div>重新安装<span class="help">配置被改写或脚本丢失时用这个修</span></div><button class="btn" type="button" data-act="reinstall-hook">重新安装</button></div>
      <div class="grow"><div>测试通知<span class="help">先在本机走一遍，不必等 Codex 真的来一次</span></div><button class="btn" type="button" data-act="inject-permission">发送测试</button></div>
      <div class="grow"><div>移除 hook<span class="help">只删除我们写入的条目和脚本</span></div><button class="btn" type="button" data-act="remove-hook">移除</button></div>
    </div>`;
}

function paneEink() {
  const address = model.settings.address || "未设置";
  const via = activeTransport({
    settings: model.settings,
    usbPlugged: model.usbPlugged && Boolean(model.settings.usbPort),
  });
  const viaText = via === "usb" ? "USB" : transportName(via);
  return `<h2>墨水屏</h2>
    <p class="pane-lead">设备能连上再接。还连不上就保持未连接即可。默认走 Wi-Fi。蓝牙只用于这块屏上的自制固件，不是出厂系统里的通道。</p>
    <div class="group">
      <div class="grow"><span>状态</span><span class="v">${panelConnected(model) ? "已连接" : "未连接"}</span></div>
      <div class="grow"><span>地址</span><span class="v">${esc(address)}</span></div>
      <div class="grow"><span>当前发送</span><span class="v">${viaText}</span></div>
    </div>
    <div class="caption">连接方式</div>
    <div class="group">
      <div class="grow"><span>主路径</span>${segment("link", model.settings.link, [["wifi", "Wi-Fi"], ["bluetooth", "蓝牙"]])}</div>
      <div class="grow"><div>插入时自动用 USB<span class="help">插着的时候改走串口，不会关掉上面选的 Wi-Fi 或蓝牙。这台 Mac 上可能有不止一个 ESP32 串口，选错端口无效。</span></div>${switchHtml(model.settings.usbFallback, "usb-fallback")}</div>
    </div>
    <div class="caption">通信频率</div>
    <div class="group">
      <div class="grow"><span>预设</span>${segment("preset", model.settings.preset, [["saver", "省电"], ["balanced", "均衡"], ["timely", "及时"]])}</div>
      <div class="grow"><span>生成中</span>${select("pushGeneratingSec", model.settings.pushGeneratingSec, PUSH_CHOICES_SEC, formatSeconds)}</div>
      <div class="grow"><span>空闲时</span>${select("pushIdleSec", model.settings.pushIdleSec, PUSH_CHOICES_SEC, formatSeconds)}</div>
    </div>
    <p class="footer-note">需要你批准，或一轮结束，会马上推过去，不等上面的间隔。</p>
    <div class="caption">墨水屏刷新</div>
    <div class="group">
      <div class="grow"><div>有新内容时局部刷新<span class="help">换页和同一页上的数字、卡片都走局部刷新。关掉之后，同一页的新画面改做基线刷新。换页不受这个开关影响。</span></div>${switchHtml(model.settings.partialOnChange, "partial")}</div>
      <div class="grow"><span>每 N 次</span>${select("fullEveryN", model.settings.fullEveryN, FULL_EVERY_N_CHOICES, (n) => n === 0 ? "关闭" : `每 ${n} 次局部刷新`)}</div>
      <div class="grow"><span>每隔</span>${select("fullEveryMin", model.settings.fullEveryMin, FULL_EVERY_MIN_CHOICES, (n) => n === 0 ? "关闭" : `${n} 分钟`)}</div>
    </div>
    <p class="footer-note">换页和日常更新走局部刷新；默认不再定时整屏闪。如残影积累，可在设置里打开偶尔的基线刷新（这时可能会闪一下）。</p>
    <div class="actions">
      <button class="btn" type="button" data-act="scan-wifi">扫描 Wi-Fi 设备</button>
      <button class="btn" type="button" data-act="scan-ble">扫描蓝牙设备</button>
      <button class="btn" type="button" data-act="pick-usb">选取 USB 设备</button>
    </div>
    <div class="ports" id="ports" ${model.pickingUsb ? "" : "hidden"}>
      ${model.panelPorts.map((port) => `<button class="btn" type="button" data-port="${esc(port)}">${esc(port)}</button>`).join("")}
      <p class="footer-note">看到两个 ESP32 口。请确认是这块屏，选错了没有画面。</p>
    </div>`;
}

function paneDebug() {
  const lines = model.log.length ? model.log.join("\n") : "还没有记录";
  const frame = model.lastFrameText ? `\n\n最近一帧\n${model.lastFrameText}` : "";
  const kept = foreignHookSurvived(model) ? "用户原有的 PreToolUse 还在" : "没有看到用户原有的 hook";
  return `<h2>调试</h2>
    <div class="debug-log">${esc(lines + frame)}\n${esc(kept)}</div>
    <div class="actions">
      <button class="btn" type="button" data-act="inject-permission">注入「等待批准」</button>
      <button class="btn" type="button" data-act="inject-stop">注入「本轮结束」</button>
      <button class="btn" type="button" data-act="inject-clear">清空收件箱</button>
      <button class="btn" type="button" data-act="inject-idle">速度改为空闲</button>
      <button class="btn" type="button" data-act="inject-generating">速度改为生成中</button>
      <button class="btn" type="button" data-act="retry">重试全部连接</button>
    </div>
    <p class="footer-note">注入事件只用来预览，不会改 Codex 里的真实对话。速度按间隔推，待处理不等间隔。</p>`;
}

function paneCleanup() {
  const removed = hookLabel(model) === "已移除" || hookLabel(model) === "未安装";
  return `<h2>清理</h2>
    <p class="pane-lead">不用了，或准备卸载时，先在这里收拾干净。卸掉应用前如果不移除 hook，Codex 仍可能调用已经不存在的脚本。</p>
    <div class="group">
      <div class="grow"><div>移除 Codex hook<span class="help">只删除我们写入的条目和脚本</span></div><button class="btn" type="button" data-act="remove-hook">${removed ? "已移除" : "移除"}</button></div>
      <div class="grow"><div>清除已保存的连接信息<span class="help">访问码、设备地址</span></div><button class="btn" type="button" data-act="clear-secrets">${model.secretsCleared ? "已清除" : "清除"}</button></div>
      <div class="grow"><div>关闭开机启动</div>${switchHtml(model.loginItem, "login")}</div>
    </div>
    <div class="caption">卸载应用</div>
    <div class="group">
      <div class="grow"><div>退出并移到废纸篓<span class="help">先完成上面的 hook 清理，再删除应用</span></div><button class="btn danger" type="button" data-act="quit">退出</button></div>
    </div>
    ${model.quitAsked ? `<p class="footer-note">模拟器里到此为止。在 Mac 上会退出，并把应用留到废纸篓那一步由你自己拖。</p>` : ""}`;
}

function paneAbout() {
  return `<h2>关于</h2>
    <div class="group">
      <div class="grow"><span>这个客户端</span><span class="v">只显示连接状态</span></div>
      <div class="grow"><span>版本</span><span class="v">1.0</span></div>
    </div>
    <p class="footer-note">速度看 Agent Speed，对话在 Codex 里处理。墨水屏用来在主显示器之外瞥一眼是否有事要处理。</p>`;
}

const PANES = { general: paneGeneral, speed: paneSpeed, hook: paneHook, eink: paneEink, debug: paneDebug, cleanup: paneCleanup, about: paneAbout };

function wizard() {
  const step = model.step;
  if (step === "welcome") {
    return `<div class="step-index">第一次打开</div><h2>开始设置</h2>
      <p class="lead">这个客户端只显示连接状态。先接上 Agent Speed，再给 Codex 安装 hook。墨水屏可以稍后再连。速度仍在 Agent Speed 里看，对话仍在 Codex 里处理。</p>
      <ol class="plain"><li><span class="n">1</span><span class="t">连接 Agent Speed</span></li><li><span class="n">2</span><span class="t">安装 Codex hook</span></li><li><span class="n">3</span><span class="t">连接墨水屏，可稍后</span></li></ol>
      <label class="checkrow"><input type="checkbox" checked disabled><span>开机时启动<span class="hint">建议打开。系统可能会再确认一次。</span></span></label>
      <div class="wiz-foot"><span></span><div class="right"><button class="btn primary" type="button" data-go="speed">继续</button></div></div>`;
  }
  if (step === "speed") {
    const ok = model.speedConnected;
    return `<div class="step-index">1 / 3</div><h2>连接 Agent Speed</h2>
      <p class="lead">${ok ? "已经连上，速度数据可以从这里转给墨水屏。" : "检测到 Agent Speed 在运行，但局域网还没打开，默认是关的。打开后点重新检测。"}</p>
      <div class="box"><div class="hd">Agent Speed <span class="v">${ok ? "已连接" : "未连接"}</span></div>
        <p>${ok ? "端口 7247，访问码已保存。" : "在 Agent Speed 里打开局域网。默认端口 7247，如有访问码，填在下面。"}</p>
        <div class="field"><span>端口</span><input value="7247" readonly></div>
        <div class="field"><span>访问码</span><input value="${ok ? "已保存" : ""}" placeholder="可选" readonly></div>
      </div>
      <div class="wiz-foot"><button class="btn ghost" type="button" data-go="welcome">上一步</button><div class="right">
        <button class="btn" type="button" data-act="skip-speed">跳过</button>
        ${ok ? `<button class="btn primary" type="button" data-go="hook">继续</button>` : `<button class="btn primary" type="button" data-act="connect-speed">重新检测</button>`}
      </div></div>`;
  }
  if (step === "hook") {
    const ok = hookLabel(model) === "已安装";
    return `<div class="step-index">2 / 3</div><h2>安装 Codex hook</h2>
      <p class="lead">Codex 在需要你批准、或一轮结束时，会调用一个小脚本。脚本只通知「有事要看」，不会传送对话正文。</p>
      <div class="box"><div class="hd">Codex hook <span class="v">${ok ? "已安装" : "未安装"}</span></div>
        <p>已检测到本机有 Codex。安装时会把脚本放到本应用的数据目录，并写入用户目录下的 <span class="mono">.codex/hooks.json</span>，只追加我们的条目。</p>
      </div>
      ${ok ? `<p class="note">以后如果失效，到设置里的 Codex 一页重新安装。不用了也在同一页移除。</p>` : ""}
      <div class="wiz-foot"><button class="btn ghost" type="button" data-go="speed">上一步</button><div class="right">
        <button class="btn" type="button" data-act="skip-hook">跳过</button>
        ${ok ? `<button class="btn primary" type="button" data-go="eink">继续</button>` : `<button class="btn primary" type="button" data-act="install-hook">安装 hook</button>`}
      </div></div>`;
  }
  if (step === "eink") {
    return `<div class="step-index">3 / 3</div><h2>连接墨水屏</h2>
      <p class="lead">设备还连不上的话，可以先跳过。跳过后这一项是「未连接」，等能连了再来设置里接上。</p>
      <div class="box"><div class="hd">墨水屏 <span class="v">${panelConnected(model) ? "已连接" : "未连接"}</span></div>
        <p>之后可用 Wi-Fi 地址连接，或在插着 USB 时选取设备。这台 Mac 上可能有不止一个 ESP32 串口，请确认是这块屏。蓝牙只用于自制固件。</p>
      </div>
      <div class="wiz-foot"><button class="btn ghost" type="button" data-go="hook">上一步</button><div class="right">
        <button class="btn" type="button" data-go="done">稍后在设置里连接</button>
        <button class="btn primary" type="button" data-act="skip-panel">跳过</button>
      </div></div>`;
  }
  const rows = popoverRows(model);
  return `<div class="step-index">设置完成</div><h2>之后看菜单栏就行</h2>
    <p class="lead">点开能看到三项各自的状态。设置、调试和清理都在同一个窗口里。</p>
    <ol class="plain">
      <li><span class="t">开机启动</span><span class="v">${model.loginItem ? "开" : "关"}</span></li>
      <li><span class="t">Agent Speed</span><span class="v">${rows.speed}</span></li>
      <li><span class="t">Codex hook</span><span class="v">${rows.hook}</span></li>
      <li><span class="t">墨水屏</span><span class="v">${rows.eink}</span></li>
    </ol>
    <div class="wiz-foot"><button class="btn ghost" type="button" data-go="eink">上一步</button><div class="right"><button class="btn primary" type="button" data-act="finish">完成</button></div></div>`;
}

function renderMac() {
  const label = menuLabel(model);
  const rows = popoverRows(model);
  const showWiz = !model.setupDone;
  document.getElementById("desktop").innerHTML = `
    <div class="menubar">
      <div class="mb-left"><span class="mb-item bold">Finder</span><span class="mb-item">文件</span><span class="mb-item">编辑</span><span class="mb-item">显示</span><span class="mb-item">窗口</span></div>
      <div class="mb-right">
        <button class="our" type="button" id="menuBtn" data-act="toggle-pop"><i class="pip ${pip(label)}"></i><span>${esc(label)}</span></button>
        <span class="mb-item">12:13</span>
      </div>
    </div>
    <section class="wizard" ${showWiz ? "" : "hidden"}>
      <div class="chrome"><div class="traffic"><i class="r"></i><i class="y"></i><i class="g"></i></div>开始设置</div>
      <div class="wiz-body">${wizard()}</div>
    </section>
    <section class="window" ${showWiz ? "hidden" : ""}>
      <div class="chrome"><div class="traffic"><i class="r"></i><i class="y"></i><i class="g"></i></div>设置</div>
      <div class="win-main">
        <nav class="sidebar">${TABS.map(([id, name]) => `<button class="nav-item${model.tab === id ? " active" : ""}" type="button" data-tab="${id}">${ICON[id]}<span>${name}</span></button>`).join("")}</nav>
        <div class="pane">${(PANES[model.tab] || paneGeneral)()}</div>
      </div>
    </section>
    <aside class="popover" ${model.popoverOpen && model.setupDone ? "" : "hidden"}>
      <div class="pop-head"><h1>连接状态</h1><div class="sub">速度看 Agent Speed，对话在 Codex 里处理</div></div>
      <div class="rows">
        <div class="row"><div class="left"><i class="dot ${rows.eink === "已连接" ? "ok" : ""}"></i><span>墨水屏</span></div><span class="v">${rows.eink}</span></div>
        <div class="row"><div class="left"><i class="dot ${rows.speed === "已连接" ? "ok" : ""}"></i><span>Agent Speed</span></div><span class="v">${rows.speed}</span></div>
        <div class="row"><div class="left"><i class="dot ${rows.hookError ? "err" : rows.hook === "已安装" ? "ok" : ""}"></i><span>Codex hook</span></div><span class="v${rows.hookError ? " err" : ""}">${rows.hook}</span></div>
      </div>
      <div class="pop-foot"><button type="button" data-open-tab="general">设置</button><button type="button" data-open-tab="debug">调试</button></div>
    </aside>`;
}

function renderBar() {
  const bar = document.getElementById("stagebar");
  bar.hidden = !chrome;
  const via = model.usbPlugged ? "拔出 USB" : "插入 USB";
  bar.innerHTML = `<span class="stage-label">用户旅程</span>${STAGES.map(([id, name]) => `<button type="button" class="${model.step === id && (id !== "daily" || model.setupDone) ? "on" : ""}" data-load="${id}">${name}</button>`).join("")}
    <span class="stage-label">屏</span>
    <button type="button" data-act="inject-permission">等待批准</button>
    <button type="button" data-act="inject-stop">本轮结束</button>
    <button type="button" data-act="inject-clear">清空</button>
    <button type="button" data-act="inject-idle">空闲</button>
    <button type="button" data-act="inject-generating">生成中</button>
    <button type="button" data-act="tick-15">推进 15 秒</button>
    <button type="button" data-act="tick-10m">推进 10 分钟</button>
    <button type="button" data-act="toggle-usb">${via}</button>`;
}

function render() {
  renderDevice();
  renderMac();
  renderBar();
}

function numericPatch(name, value) {
  const number = Number(value);
  if (name === "preset") {
    if (PRESETS[value]) patchSettings(model, {
      pushGeneratingSec: PRESETS[value].pushGeneratingSec,
      pushIdleSec: PRESETS[value].pushIdleSec,
      partialOnChange: PRESETS[value].partialOnChange,
      fullEveryN: PRESETS[value].fullEveryN,
      fullEveryMin: PRESETS[value].fullEveryMin,
    });
    return;
  }
  if (name === "link") patchSettings(model, { link: value });
  else patchSettings(model, { [name]: Number.isNaN(number) ? value : number });
}

document.body.addEventListener("click", (event) => {
  const cell = event.target.closest("[data-cell]");
  if (cell && event.target.closest(".panel")) {
    const index = Number(cell.dataset.cell);
    if (model.device.homeSel === index) deviceInput(model, "press");
    else selectHome(model, index);
    render();
    return;
  }
  const port = event.target.closest("[data-port]");
  if (port) {
    chooseUsb(model, port.dataset.port);
    model.pickingUsb = false;
    render();
    return;
  }
  const set = event.target.closest("[data-set]");
  if (set && set.dataset.value) {
    numericPatch(set.dataset.set, set.dataset.value);
    render();
    return;
  }
  const load = event.target.closest("[data-load]");
  if (load) {
    loadStage(model, load.dataset.load);
    render();
    return;
  }
  const tab = event.target.closest("[data-tab]");
  if (tab) { model.tab = tab.dataset.tab; render(); return; }
  const open = event.target.closest("[data-open-tab]");
  if (open) {
    model.setupDone = true;
    model.step = "daily";
    model.tab = open.dataset.openTab;
    model.popoverOpen = false;
    render();
    return;
  }
  const stageBtn = event.target.closest("[data-stage]");
  if (stageBtn && !event.target.closest("[data-go]")) {
    go(model, stageBtn.dataset.stage);
    model.popoverOpen = false;
    render();
    return;
  }
  const goBtn = event.target.closest("[data-go]");
  if (goBtn) {
    go(model, goBtn.dataset.go || goBtn.dataset.stage);
    if (!model.setupDone) model.popoverOpen = false;
    render();
    return;
  }
  const act = event.target.closest("[data-act]");
  if (!act) return;
  const name = act.dataset.act;
  if (name === "wheel-up" || name === "wheel-down" || name === "press" || name === "boot") deviceInput(model, name);
  if (name === "press-speed") {
    if (model.device.view === "overview" && model.device.ovSel === 0) deviceInput(model, "press");
    else if (model.device.view === "overview") selectOverview(model, 0);
  }
  if (name === "toggle-pop") model.popoverOpen = !model.popoverOpen;
  if (name === "connect-speed" || name === "test-speed") connectSpeed(model);
  if (name === "skip-speed") { model.speedConnected = false; go(model, "hook"); }
  if (name === "install-hook" || name === "reinstall-hook") installHook(model);
  if (name === "skip-hook") go(model, "eink");
  if (name === "skip-panel") go(model, "done");
  if (name === "finish") finishSetup(model);
  if (name === "login") model.loginItem = !model.loginItem;
  if (name === "usb-fallback") patchSettings(model, { usbFallback: !model.settings.usbFallback });
  if (name === "partial") patchSettings(model, { partialOnChange: !model.settings.partialOnChange });
  if (name === "scan-wifi") scanWifi(model);
  if (name === "scan-ble") scanBluetooth(model);
  if (name === "pick-usb") model.pickingUsb = !model.pickingUsb;
  if (name === "remove-hook") removeHook(model);
  if (name === "clear-secrets") clearSecrets(model);
  if (name === "quit") { removeHook(model); clearSecrets(model); model.loginItem = false; model.quitAsked = true; }
  if (name === "inject-permission") inject(model, "permission");
  if (name === "inject-stop") inject(model, "stop");
  if (name === "inject-clear") inject(model, "clear");
  if (name === "inject-idle") inject(model, "idle");
  if (name === "inject-generating") inject(model, "generating");
  if (name === "tick-15") advance(model, 15_000);
  if (name === "tick-10m") advance(model, 600_000);
  if (name === "toggle-usb") setUsbPlugged(model, !model.usbPlugged);
  if (name === "retry") {
    if (model.settings.link === "bluetooth") scanBluetooth(model);
    else scanWifi(model);
    connectSpeed(model);
  }
  if (name === "save-code") model.accessCodeSaved = true;
  if (name === "show-hooks") model.tab = "debug";
  render();
});

document.body.addEventListener("change", (event) => {
  const set = event.target.closest("[data-set]");
  if (!set) return;
  numericPatch(set.dataset.set, set.value);
  render();
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof Element && event.target.closest("input, select, textarea")) return;
  if (event.key === "ArrowUp" || event.key === "ArrowLeft") deviceInput(model, "wheel-up");
  else if (event.key === "ArrowDown" || event.key === "ArrowRight") deviceInput(model, "wheel-down");
  else if (event.key === "Enter") deviceInput(model, "press");
  else if (event.key === "Escape" || event.key === "Backspace") deviceInput(model, "boot");
  else return;
  event.preventDefault();
  render();
});

render();
