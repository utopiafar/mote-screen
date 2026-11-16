import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PRESETS, defaultSettings, applyPreset, updateSettings, msUntilPush, decideRefresh, activeTransport, presetMatching, migrateLegacyCleanup, refreshSummary,
} from "../core/settings.mjs";

const vectors = JSON.parse(readFileSync(new URL("./fixtures/vectors.json", import.meta.url), "utf8"));

test("默认是 Wi-Fi、USB 备份开着、均衡", () => {
  const settings = defaultSettings();
  assert.equal(settings.link, "wifi");
  assert.equal(settings.usbFallback, true);
  assert.equal(settings.preset, "balanced");
  assert.equal(settings.pushGeneratingSec, 15);
  assert.equal(settings.pushIdleSec, 60);
  assert.equal(settings.partialOnChange, true);
  assert.equal(settings.fullEveryN, 0);
  assert.equal(settings.fullEveryMin, 0);
  assert.equal(refreshSummary(settings), "局部");
});

test("省电比均衡更疏，及时比均衡更密", () => {
  assert.ok(PRESETS.saver.pushGeneratingSec > PRESETS.balanced.pushGeneratingSec);
  assert.ok(PRESETS.saver.pushIdleSec > PRESETS.balanced.pushIdleSec);
  assert.equal(PRESETS.saver.fullEveryN, 0);
  assert.equal(PRESETS.saver.fullEveryMin, 0);
  assert.equal(PRESETS.timely.fullEveryN, 0);
  assert.equal(PRESETS.timely.fullEveryMin, 0);
  assert.ok(PRESETS.timely.pushGeneratingSec < PRESETS.balanced.pushGeneratingSec);
  assert.ok(PRESETS.timely.pushIdleSec < PRESETS.balanced.pushIdleSec);
});

test("预设会同时改通信和刷新，手改一项就离开预设", () => {
  let settings = applyPreset(defaultSettings(), "saver");
  assert.equal(settings.preset, "saver");
  assert.equal(settings.pushIdleSec, 300);
  assert.equal(settings.fullEveryN, 0);
  assert.equal(settings.fullEveryMin, 0);
  settings = updateSettings(settings, { pushGeneratingSec: 15 });
  assert.equal(settings.preset, "custom");
  assert.equal(settings.pushIdleSec, 300);
  settings = updateSettings(settings, {
    pushGeneratingSec: 15,
    pushIdleSec: 60,
    partialOnChange: true,
    fullEveryN: 0,
    fullEveryMin: 0,
  });
  assert.equal(presetMatching(settings).id, "balanced");
  assert.equal(settings.preset, "balanced");
});

test("连接方式不能把 USB 当成互斥选项", () => {
  assert.throws(() => updateSettings(defaultSettings(), { link: "usb" }), /Wi-Fi 或蓝牙/);
  const settings = updateSettings(defaultSettings(), { link: "bluetooth", usbFallback: true });
  assert.equal(activeTransport({ settings, usbPlugged: false }), "bluetooth");
  assert.equal(activeTransport({ settings, usbPlugged: true }), "usb");
  const wifi = defaultSettings();
  assert.equal(activeTransport({ settings: wifi, usbPlugged: false }), "wifi");
  assert.equal(activeTransport({ settings: { ...wifi, usbFallback: false }, usbPlugged: true }), "wifi");
});

test("推送间隔：待处理立刻走，速度按阶段", () => {
  for (const row of vectors.push) {
    const settings = defaultSettings();
    const ms = msUntilPush({
      settings,
      phase: row.phase,
      inboxDirty: row.inboxDirty,
      lastPushMs: 0,
      nowMs: row.elapsed,
    });
    assert.equal(ms, row.expectMs, JSON.stringify(row));
  }
});

test("刷新策略：局部优先，次数或时间到了改完整", () => {
  const policy = {
    partialOnChange: true,
    fullEveryN: 10,
    fullEveryMin: 10,
  };
  for (const row of vectors.refresh) {
    assert.equal(decideRefresh({
      policy,
      contentChanged: row.changed,
      partialsSinceFull: row.partials,
      msSinceFull: row.ms,
    }), row.expect, JSON.stringify(row));
  }
  assert.equal(decideRefresh({
    policy: { ...policy, partialOnChange: false },
    contentChanged: true,
    partialsSinceFull: 0,
    msSinceFull: 0,
  }), "full");
  assert.equal(decideRefresh({
    policy,
    contentChanged: true,
    viewChanged: true,
    partialsSinceFull: 0,
    msSinceFull: 0,
  }), "partial");
  assert.equal(decideRefresh({
    policy,
    contentChanged: false,
    viewChanged: true,
    partialsSinceFull: 0,
    msSinceFull: 0,
  }), "partial");
  assert.equal(decideRefresh({
    policy: { ...policy, partialOnChange: false },
    contentChanged: true,
    viewChanged: true,
    partialsSinceFull: 0,
    msSinceFull: 0,
  }), "partial");
  assert.equal(decideRefresh({
    policy,
    contentChanged: true,
    viewChanged: true,
    partialsSinceFull: 10,
    msSinceFull: 0,
  }), "full");
  const off = { partialOnChange: true, fullEveryN: 0, fullEveryMin: 0 };
  assert.equal(decideRefresh({
    policy: off,
    contentChanged: true,
    partialsSinceFull: 100,
    msSinceFull: 600_000,
  }), "partial");
  assert.equal(decideRefresh({
    policy: off,
    contentChanged: false,
    partialsSinceFull: 0,
    msSinceFull: 600_000,
  }), "none");
  assert.equal(decideRefresh({
    policy: off,
    contentChanged: false,
    viewChanged: true,
    partialsSinceFull: 0,
    msSinceFull: 600_000,
  }), "partial");
});

test("旧预设的刷新间隔迁成关闭，不成对的选择留着", () => {
  for (const [fullEveryN, fullEveryMin] of [[5, 5], [10, 10], [20, 30]]) {
    const migrated = migrateLegacyCleanup({ ...defaultSettings(), fullEveryN, fullEveryMin, pushGeneratingSec: 30 });
    assert.equal(migrated.fullEveryN, 0, `${fullEveryN}/${fullEveryMin}`);
    assert.equal(migrated.fullEveryMin, 0);
    assert.equal(migrated.pushGeneratingSec, 30);
  }
  const mixed = migrateLegacyCleanup({ ...defaultSettings(), fullEveryN: 5, fullEveryMin: 30 });
  assert.equal(mixed.fullEveryN, 5);
  assert.equal(mixed.fullEveryMin, 30);
  const opted = migrateLegacyCleanup({ ...defaultSettings(), fullEveryN: 10, fullEveryMin: 0 });
  assert.equal(opted.fullEveryN, 10);
  assert.equal(opted.fullEveryMin, 0);
});
