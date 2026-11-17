import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MENU, HOOK, menuBarStatus, classifyHook, linkLabel } from "../core/status.mjs";

const vectors = JSON.parse(readFileSync(new URL("./fixtures/vectors.json", import.meta.url), "utf8"));

test("菜单栏四档与向量一致", () => {
  for (const row of vectors.menu) {
    assert.equal(menuBarStatus(row), row.expect, JSON.stringify(row));
  }
});

test("向导结束后屏仍跳过，菜单栏是未连接", () => {
  assert.equal(menuBarStatus({
    setupInProgress: false,
    agentSpeedConnected: true,
    einkConnected: false,
    hook: HOOK.installed,
  }), MENU.disconnected);
});

test("Hook 失效压过向导和已连接", () => {
  assert.equal(menuBarStatus({
    setupInProgress: true,
    agentSpeedConnected: true,
    einkConnected: true,
    hook: HOOK.broken,
  }), MENU.hookBroken);
});

test("三项都好才是已连接", () => {
  assert.equal(menuBarStatus({
    setupInProgress: false,
    agentSpeedConnected: true,
    einkConnected: true,
    hook: HOOK.installed,
  }), MENU.connected);
  assert.equal(menuBarStatus({
    setupInProgress: false,
    agentSpeedConnected: false,
    einkConnected: true,
    hook: HOOK.installed,
  }), MENU.disconnected);
  assert.equal(menuBarStatus({
    setupInProgress: false,
    agentSpeedConnected: true,
    einkConnected: true,
    hook: HOOK.removed,
  }), MENU.disconnected);
});

test("弹出层只用已连接或未连接", () => {
  assert.equal(linkLabel(true), "已连接");
  assert.equal(linkLabel(false), "未连接");
});

test("hook 分类：完整、失效、已移除、未安装", () => {
  assert.equal(classifyHook({
    entries: { permission: true, stop: true },
    scriptExists: true,
    remembered: "installed",
  }), HOOK.installed);
  assert.equal(classifyHook({
    entries: { permission: true, stop: false },
    scriptExists: true,
    remembered: "installed",
  }), HOOK.broken);
  assert.equal(classifyHook({
    entries: { permission: false, stop: false },
    scriptExists: false,
    remembered: "installed",
  }), HOOK.broken);
  assert.equal(classifyHook({
    entries: { permission: false, stop: false },
    scriptExists: false,
    remembered: "removed",
  }), HOOK.removed);
  assert.equal(classifyHook({
    entries: { permission: false, stop: false },
    scriptExists: false,
    remembered: "never",
  }), HOOK.missing);
  assert.equal(classifyHook({
    entries: { permission: true, stop: true },
    scriptExists: false,
    remembered: "installed",
  }), HOOK.broken);
});
