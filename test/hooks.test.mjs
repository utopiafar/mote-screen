import test from "node:test";
import assert from "node:assert/strict";
import { installHooks, removeHooks, findOurEntries, serializeHooks, ourHandler, commandInvokes } from "../core/hooks.mjs";

const SCRIPT = "/Users/me/Library/Application Support/mote-screen/mote-screen-hook";
const OTHER = "/Users/me/.codex/hooks/mine.py";

function userDoc() {
  return {
    description: "mine",
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: OTHER, timeout: 30 }] },
      ],
      PermissionRequest: [
        { matcher: "Bash", hooks: [{ type: "command", command: OTHER }] },
      ],
      Stop: [
        { hooks: [{ type: "command", command: "date -u >> /tmp/stop.log" }] },
      ],
    },
  };
}

test("安装只追加 PermissionRequest 和 Stop，不改别人的条目", () => {
  const original = userDoc();
  const next = installHooks(original, SCRIPT);
  assert.equal(original.hooks.PreToolUse[0].hooks.length, 1);
  assert.equal(next.description, "mine");
  assert.deepEqual(next.hooks.PreToolUse, original.hooks.PreToolUse);
  assert.equal(next.hooks.PermissionRequest.length, 2);
  assert.equal(next.hooks.PermissionRequest[0].hooks[0].command, OTHER);
  assert.equal(commandInvokes(next.hooks.PermissionRequest[1].hooks[0].command, SCRIPT), true);
  assert.equal(next.hooks.Stop.length, 2);
  assert.equal(next.hooks.Stop[0].hooks[0].command, "date -u >> /tmp/stop.log");
  assert.deepEqual(next.hooks.Stop[1].hooks[0], ourHandler(SCRIPT));
  assert.deepEqual(findOurEntries(next, SCRIPT), { permission: true, stop: true });
  assert.equal(Object.keys(next.hooks).includes("Interrupt"), false);
});

test("重复安装不复制条目", () => {
  const once = installHooks(userDoc(), SCRIPT);
  const twice = installHooks(once, SCRIPT);
  assert.equal(twice.hooks.PermissionRequest.length, 2);
  assert.equal(twice.hooks.Stop.length, 2);
  assert.equal(twice.hooks.PermissionRequest[1].hooks.length, 1);
});

test("清理只删除我们的条目和因此变空的组", () => {
  const installed = installHooks(userDoc(), SCRIPT);
  const cleaned = removeHooks(installed, SCRIPT);
  assert.equal(cleaned.description, "mine");
  assert.deepEqual(cleaned.hooks.PreToolUse, userDoc().hooks.PreToolUse);
  assert.equal(cleaned.hooks.PermissionRequest.length, 1);
  assert.equal(cleaned.hooks.PermissionRequest[0].hooks[0].command, OTHER);
  assert.equal(cleaned.hooks.Stop.length, 1);
  assert.equal(cleaned.hooks.Stop[0].hooks[0].command, "date -u >> /tmp/stop.log");
  assert.deepEqual(findOurEntries(cleaned, SCRIPT), { permission: false, stop: false });
  assert.ok(serializeHooks(cleaned).includes(OTHER));
});

test("和别人写在同一组里时，只摘掉我们的 handler", () => {
  const doc = {
    hooks: {
      Stop: [{
        hooks: [
          { type: "command", command: OTHER },
          ourHandler(SCRIPT),
        ],
      }],
    },
  };
  const cleaned = removeHooks(doc, SCRIPT);
  assert.equal(cleaned.hooks.Stop.length, 1);
  assert.equal(cleaned.hooks.Stop[0].hooks.length, 1);
  assert.equal(cleaned.hooks.Stop[0].hooks[0].command, OTHER);
});

test("我们单独占用的组会被整组拿掉，文件仍保留", () => {
  const doc = installHooks({ description: "keep" }, SCRIPT);
  const cleaned = removeHooks(doc, SCRIPT);
  assert.equal(cleaned.description, "keep");
  assert.deepEqual(cleaned.hooks, {});
  assert.match(serializeHooks(cleaned), /"description": "keep"/);
});

test("损坏的 JSON 结构拒绝写入", () => {
  assert.throws(() => installHooks([], SCRIPT), /不是对象/);
  assert.throws(() => installHooks({ hooks: [] }, SCRIPT), /不是对象/);
  assert.throws(() => removeHooks({ hooks: { Stop: {} } }, SCRIPT), /不是数组/);
});

test("空文档可以开始安装", () => {
  const next = installHooks(null, SCRIPT);
  assert.equal(commandInvokes(next.hooks.PermissionRequest[0].hooks[0].command, SCRIPT), true);
  assert.equal(commandInvokes(next.hooks.Stop[0].hooks[0].command, SCRIPT), true);
});

test("带引号的命令仍按脚本路径识别", () => {
  const doc = {
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: `/usr/bin/python3 "${SCRIPT}"` }] }],
    },
  };
  assert.equal(findOurEntries(doc, SCRIPT).stop, true);
  const cleaned = removeHooks(doc, SCRIPT);
  assert.equal(cleaned.hooks.Stop, undefined);
});
