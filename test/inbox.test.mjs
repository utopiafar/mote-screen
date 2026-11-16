import test from "node:test";
import assert from "node:assert/strict";
import { summaryFromHook, cardFromHookPayload, upsertInbox } from "../core/inbox.mjs";
import { parseLiveFrame } from "../core/speed.mjs";

test("PermissionRequest 只留短标题和项目名", () => {
  const card = summaryFromHook({
    hook_event_name: "PermissionRequest",
    session_id: "thr_1",
    turn_id: "turn_1",
    cwd: "/Users/me/payments-api",
    tool_name: "Bash",
    tool_input: {
      command: "cargo test",
      description: "允许运行 cargo test",
    },
    transcript_path: "/secret/rollout.jsonl",
    model: "gpt",
  }, "2026-11-16T03:57:00.000Z");
  assert.equal(card.kind, "permission");
  assert.equal(card.title, "允许运行 cargo test");
  assert.equal(card.project, "payments-api");
  assert.equal(card.source, "codex");
  assert.equal(JSON.stringify(card).includes("rollout"), false);
  assert.equal(JSON.stringify(card).includes("gpt"), false);
});

test("没有说明时从命令生成标题，Stop 固定文案且不带助手正文", () => {
  const card = summaryFromHook({
    hook_event_name: "PermissionRequest",
    cwd: "/work/eink-sidecar",
    tool_name: "apply_patch",
    tool_input: { command: "*** Update File: src/main.rs" },
  }, "2026-11-16T03:57:00.000Z");
  assert.equal(card.title, "允许修改 src/main.rs");
  const stop = summaryFromHook({
    hook_event_name: "Stop",
    cwd: "/work/notes-cli",
    last_assistant_message: "这是不该上屏的长回复",
  }, "2026-11-16T03:57:00.000Z");
  assert.equal(stop.title, "本轮已结束");
  assert.equal(stop.project, "notes-cli");
  assert.equal(JSON.stringify(stop).includes("不该上屏"), false);
});

test("其他事件和空输入都不进收件箱", () => {
  assert.equal(summaryFromHook({ hook_event_name: "PreToolUse", cwd: "/work" }), null);
  assert.equal(summaryFromHook(null), null);
  const items = upsertInbox([], summaryFromHook({
    hook_event_name: "Stop",
    cwd: "/work/notes-cli",
  }, "2026-11-16T03:57:00.000Z"));
  assert.equal(items.length, 1);
});

test("Agent Speed 帧可带其他来源，但没有额度", () => {
  const speed = parseLiveFrame({
    schema: 1,
    type: "live",
    phase: "generating",
    outputTokS: 75.9,
    quota: { remaining: 1 },
    sessions: { active: 3, generating: 2, tools: 1 },
    sources: [
      { source: "codex", phase: "generating", outputTokS: 48.2, sessions: { active: 2, generating: 1, tools: 0 } },
      { source: "cursor", phase: "generating", outputTokS: 10, sessions: { active: 1, generating: 1, tools: 0 } },
    ],
    history: { stepMs: 1000, outputTokS: [70, 75.9] },
  });
  assert.equal(speed.outputTokS, 75.9);
  assert.equal(speed.sources[1].name, "Cursor");
  assert.equal("quota" in speed, false);
  assert.deepEqual(speed.history, [70, 75.9]);
});

test("脚本摘要和原始 hook 事件都能进同一张卡", () => {
  const posted = cardFromHookPayload({
    id: "perm:s1:t1",
    kind: "permission",
    title: "允许运行 git push",
    project: "website",
    source: "codex",
  }, "2026-11-16T03:57:10.000Z");
  assert.equal(posted.title, "允许运行 git push");
  assert.equal(posted.project, "website");
  assert.equal(posted.source, "codex");
  assert.equal("hook_event_name" in posted, false);
  assert.equal("last_assistant_message" in posted, false);
  const raw = cardFromHookPayload({
    hook_event_name: "Stop",
    session_id: "s1",
    cwd: "/work/notes",
    last_assistant_message: "不要出现",
  }, "2026-11-16T03:57:20.000Z");
  assert.equal(raw.kind, "stop");
  assert.equal(raw.title, "本轮已结束");
  assert.equal("last_assistant_message" in raw, false);
  assert.equal(cardFromHookPayload({ kind: "permission", source: "cursor", title: "x" }), null);
});
