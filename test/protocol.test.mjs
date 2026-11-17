import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  encodeFrame, decodeFrame, configFrame, createLinkSession, noteRx, pollLink, linkTimeoutMs, TCP_PORT,
} from "../core/protocol.mjs";
import { defaultSettings } from "../core/settings.mjs";

const vectors = JSON.parse(readFileSync(new URL("./fixtures/vectors.json", import.meta.url), "utf8"));

test("速度帧往返，丢掉额度字段", () => {
  const frame = decodeFrame(vectors.speedLine);
  assert.equal(frame.type, "speed");
  assert.equal(frame.outputTokS, 75.9);
  assert.equal(frame.sessions.active, 3);
  assert.equal(frame.sources[0].name, "Codex");
  assert.equal(frame.sources.some((src) => src.name === "Cursor"), true);
  assert.equal("quota" in frame, false);
  const again = decodeFrame(encodeFrame(frame));
  assert.deepEqual(again, frame);
});

test("收件箱只留 Codex，Cursor 条目被丢掉", () => {
  const frame = decodeFrame(vectors.inboxLine);
  assert.equal(frame.items.length, 2);
  assert.ok(frame.items.every((item) => item.kind === "permission" || item.kind === "stop"));
  assert.equal(frame.items.some((item) => item.title.includes("cursor")), false);
});

test("配置帧带连接方式和刷新策略，USB 不是互斥模式", () => {
  const settings = defaultSettings();
  const frame = configFrame(settings, 4);
  assert.equal(frame.link, "wifi");
  assert.equal(frame.usbFallback, true);
  assert.equal(frame.pushGeneratingSec, 15);
  assert.equal(frame.pushIdleSec, 60);
  assert.equal(frame.fullEveryN, 0);
  assert.equal(frame.fullEveryMin, 0);
  const missing = decodeFrame('{"v":1,"type":"config","seq":1}\n');
  assert.equal(missing.fullEveryN, 0);
  assert.equal(missing.fullEveryMin, 0);
  const decoded = decodeFrame(encodeFrame(frame));
  assert.deepEqual(decoded, frame);
  assert.equal(TCP_PORT, 7427);
});

test("未知版本拒绝，已知帧忽略多余字段", () => {
  assert.throws(() => decodeFrame('{"v":2,"type":"ping","seq":1}\n'), /协议版本/);
  const ping = decodeFrame('{"v":1,"type":"ping","seq":3,"extra":true}');
  assert.deepEqual(ping, { v: 1, type: "ping", seq: 3 });
});

test("断线：超时后不再算已连接", () => {
  const session = createLinkSession();
  noteRx(session, { seq: 2 }, 1_000);
  assert.equal(pollLink(session, 1_000 + linkTimeoutMs(defaultSettings()) - 1, linkTimeoutMs(defaultSettings())).connected, true);
  assert.equal(pollLink(session, 1_000 + linkTimeoutMs(defaultSettings()), linkTimeoutMs(defaultSettings())).connected, false);
});

test("满员收件箱超过 1023 字节，仍在一帧上限内", () => {
  const title = "标".repeat(48);
  const project = "项".repeat(32);
  const items = Array.from({ length: 8 }, (_, index) => ({
    id: `perm:session-${index}:turn`,
    kind: "permission",
    title,
    project,
    source: "codex",
    at: "2026-11-16T03:57:00.000Z",
  }));
  const line = encodeFrame({ v: 1, type: "inbox", seq: 9, items });
  assert.ok(Buffer.byteLength(line) > 1023);
  assert.ok(Buffer.byteLength(line) < 16384);
  const frame = decodeFrame(line);
  assert.equal(frame.items.length, 8);
  assert.equal(Array.from(frame.items[0].title).length, 48);
});

test("标题过长会被截断", () => {
  const title = "允许运行 ".padEnd(80, "a");
  const line = JSON.stringify({
    v: 1, type: "inbox", seq: 1,
    items: [{ id: "1", kind: "permission", title, project: "p", source: "codex", at: "t" }],
  });
  const frame = decodeFrame(line);
  assert.ok(Array.from(frame.items[0].title).length <= 48);
});
