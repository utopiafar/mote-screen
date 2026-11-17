/**
 * Panel navigation. Portrait 480×800.
 * Home is a 2×2 desk. The reserved cell does not open.
 * Wheel selects, press opens, BOOT goes detail → workbench → home.
 */

export const APPS = Object.freeze([
  { id: "workbench", kicker: "APP", name: "工作台" },
  { id: "clock", kicker: "APP", name: "时钟" },
  { id: "settings", kicker: "APP", name: "设置" },
  { id: "reserved", kicker: "空", name: "预留", reserved: true },
]);

export function createDeviceState() {
  return {
    view: "home",
    homeSel: 0,
    ovSel: 0,
    inboxSel: 0,
  };
}

export function pendingItems(items) {
  return (items || []).filter((item) => item.kind === "permission");
}

export function overviewMax(items) {
  const n = Math.min(2, pendingItems(items).length);
  return n;
}

export function wheel(state, dir, items) {
  const next = { ...state };
  if (next.view === "home") {
    next.homeSel = (next.homeSel + (dir > 0 ? 1 : 3)) % 4;
    return next;
  }
  if (next.view === "overview") {
    const max = overviewMax(items);
    next.ovSel = Math.max(0, Math.min(max, next.ovSel + dir));
    return next;
  }
  if (next.view === "inbox" && items && items.length) {
    next.inboxSel = Math.max(0, Math.min(items.length - 1, next.inboxSel + dir));
  }
  return next;
}

export function press(state, items) {
  const next = { ...state };
  if (next.view === "home") {
    const app = APPS[next.homeSel];
    if (!app || app.reserved) return next;
    if (app.id === "workbench") {
      next.view = "overview";
      next.ovSel = pendingItems(items).length ? 1 : 0;
      return next;
    }
    next.view = app.id;
    return next;
  }
  if (next.view === "overview") {
    if (next.ovSel === 0) {
      next.view = "speed";
      return next;
    }
    next.view = "inbox";
    next.inboxSel = Math.max(0, next.ovSel - 1);
    return next;
  }
  return next;
}

export function boot(state) {
  const next = { ...state };
  if (next.view === "speed" || next.view === "inbox") {
    next.view = "overview";
    return next;
  }
  if (next.view !== "home") {
    if (next.view === "overview") next.homeSel = 0;
    next.view = "home";
  }
  return next;
}

export function viewTitle(view) {
  return {
    home: "主桌面",
    overview: "工作台",
    speed: "速度",
    inbox: "Codex 待处理",
    clock: "时钟",
    settings: "设置",
    reserved: "预留",
  }[view] || view;
}
