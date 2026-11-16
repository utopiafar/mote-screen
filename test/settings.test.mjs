import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PRESETS, defaultSettings, applyPreset, updateSettings, msUntilPush, decideRefresh, activeTransport, presetMatching,
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
  assert.equal(settings.fullEveryN, 10);
  assert.equal(settings.fullEveryMin, 10);
});

test("省电比均衡更疏，及时比均衡更密", () => {
  assert.ok(PRESETS.saver.pushGeneratingSec > PRESETS.balanced.pushGeneratingSec);
  assert.ok(PRESETS.saver.pushIdleSec > PRESETS.balanced.pushIdleSec);
  assert.ok(PRESETS.saver.fullEveryMin > PRESETS.balanced.fullEveryMin);
  assert.ok(PRESETS.timely.pushGeneratingSec < PRESETS.balanced.pushGeneratingSec);
  assert.ok(PRESETS.timely.pushIdleSec < PRESETS.balanced.pushIdleSec);
});

test("预设会同时改通信和刷新，手改一项就离开预设", () => {
  let settings = applyPreset(defaultSettings(), "saver");
  assert.equal(settings.preset, "saver");
  assert.equal(settings.pushIdleSec, 300);
  assert.equal(settings.fullEveryMin, 30);
  settings = updateSettings(settings, { pushGeneratingSec: 15 });
  assert.equal(settings.preset, "custom");
  assert.equal(settings.pushIdleSec, 300);
  settings = updateSettings(settings, {
    pushGeneratingSec: 15,
    pushIdleSec: 60,
    partialOnChange: true,
    fullEveryN: 10,
    fullEveryMin: 10,
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
});
