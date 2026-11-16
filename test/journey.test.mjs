import test from "node:test";
import assert from "node:assert/strict";
import {
  createModel, menuLabel, hookLabel, connectSpeed, installHook, finishSetup, scanWifi,
  breakHook, inject, advance, removeHook, foreignHookSurvived, patchSettings, chooseUsb,
  setUsbPlugged, popoverRows,
} from "../simulator/model.mjs";
import { activeTransport } from "../core/settings.mjs";

test("第一次安装到跳过墨水屏，菜单栏停在未连接", () => {
  const model = createModel();
  assert.equal(menuLabel(model), "设置中");
  connectSpeed(model);
  installHook(model);
  finishSetup(model);
  assert.equal(model.setupDone, true);
  assert.equal(menuLabel(model), "未连接");
  assert.equal(popoverRows(model).eink, "未连接");
  assert.equal(popoverRows(model).speed, "已连接");
  assert.equal(popoverRows(model).hook, "已安装");
  assert.equal(foreignHookSurvived(model), true);
});

test("接上屏之后是已连接；hook 失效优先；修好后恢复", () => {
  const model = createModel();
  connectSpeed(model);
  installHook(model);
  finishSetup(model);
  scanWifi(model);
  assert.equal(menuLabel(model), "已连接");
  breakHook(model);
  assert.equal(hookLabel(model), "已失效");
  assert.equal(menuLabel(model), "Hook 失效");
  installHook(model);
  assert.equal(menuLabel(model), "已连接");
});

test("待处理立刻推送，速度要等间隔，十分钟后完整刷新", () => {
  const model = createModel();
  connectSpeed(model);
  installHook(model);
  finishSetup(model);
  scanWifi(model);
  const before = model.lastInboxText;
  inject(model, "permission");
  assert.notEqual(model.lastInboxText, before);
  assert.match(model.lastInboxText, /允许运行 git push/);
  assert.equal(model.lastInboxText.includes("不要出现"), false);
  assert.equal(model.lastInboxText.includes("should-not-appear"), false);
  assert.equal(model.lastRefresh, "partial");
  assert.equal(model.framebuffer.inbox[0].title, "允许运行 git push");
  advance(model, 14_000);
  assert.equal(model.lastFrameText.includes('"type":"speed"'), false);
  advance(model, 1_000);
  assert.match(model.lastFrameText, /"type":"speed"/);
  advance(model, 600_000);
  assert.equal(model.lastRefresh, "full");
});

test("蓝牙仍可用 USB 备份，拔掉后回到蓝牙", () => {
  const model = createModel();
  connectSpeed(model);
  installHook(model);
  finishSetup(model);
  patchSettings(model, { link: "bluetooth" });
  chooseUsb(model, model.panelPorts[0]);
  assert.equal(activeTransport({
    settings: model.settings,
    usbPlugged: model.usbPlugged && Boolean(model.settings.usbPort),
  }), "usb");
  assert.equal(menuLabel(model), "已连接");
  setUsbPlugged(model, false);
  assert.equal(activeTransport({
    settings: model.settings,
    usbPlugged: false,
  }), "bluetooth");
});

test("清理只摘掉我们的 hook，菜单栏不再是已连接", () => {
  const model = createModel();
  connectSpeed(model);
  installHook(model);
  finishSetup(model);
  scanWifi(model);
  removeHook(model);
  assert.equal(hookLabel(model), "已移除");
  assert.equal(menuLabel(model), "未连接");
  assert.equal(foreignHookSurvived(model), true);
  assert.equal(JSON.stringify(model.hooksDoc).includes("mote-screen-hook"), false);
});
