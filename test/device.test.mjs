import test from "node:test";
import assert from "node:assert/strict";
import { createDeviceState, wheel, press, boot } from "../core/device.mjs";

const items = [
  { id: "1", kind: "permission", title: "允许运行 cargo test", project: "payments-api" },
  { id: "2", kind: "permission", title: "允许修改 src/main.rs", project: "eink-sidecar" },
  { id: "3", kind: "stop", title: "本轮已结束", project: "notes-cli" },
];

test("主桌面滚轮四格循环，预留按不进去", () => {
  let state = createDeviceState();
  state = wheel(state, 1, items);
  state = wheel(state, 1, items);
  state = wheel(state, 1, items);
  assert.equal(state.homeSel, 3);
  state = press(state, items);
  assert.equal(state.view, "home");
  state = wheel(state, 1, items);
  assert.equal(state.homeSel, 0);
});

test("工作台方案 B：先选卡片，按下进收件箱，BOOT 回工作台再回桌面", () => {
  let state = createDeviceState();
  state = press(state, items);
  assert.equal(state.view, "overview");
  assert.equal(state.ovSel, 1);
  state = press(state, items);
  assert.equal(state.view, "inbox");
  state = boot(state);
  assert.equal(state.view, "overview");
  state = boot(state);
  assert.equal(state.view, "home");
  assert.equal(state.homeSel, 0);
});

test("上半速度按下进速度详情", () => {
  let state = createDeviceState();
  state = press(state, []);
  assert.equal(state.view, "overview");
  assert.equal(state.ovSel, 0);
  state = press(state, []);
  assert.equal(state.view, "speed");
  state = boot(state);
  assert.equal(state.view, "overview");
});

test("时钟和设置进得去，BOOT 回桌面", () => {
  let state = { ...createDeviceState(), homeSel: 1 };
  state = press(state, items);
  assert.equal(state.view, "clock");
  state = boot(state);
  assert.equal(state.view, "home");
  state = { ...createDeviceState(), homeSel: 2 };
  state = press(state, items);
  assert.equal(state.view, "settings");
});

test("概览里滚轮停在速度和最多两张待批准卡之间", () => {
  let state = { view: "overview", homeSel: 0, ovSel: 0, inboxSel: 0 };
  state = wheel(state, -1, items);
  assert.equal(state.ovSel, 0);
  state = wheel(state, 1, items);
  state = wheel(state, 1, items);
  state = wheel(state, 1, items);
  assert.equal(state.ovSel, 2);
});
