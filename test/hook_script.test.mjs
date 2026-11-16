import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

function postHook(event) {
  return new Promise((resolve, reject) => {
    let posted = null;
    let exited = false;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      if (error) {
        settled = true;
        reject(error);
        return;
      }
      if (!posted || !exited) return;
      settled = true;
      resolve(posted);
    };
    const timer = setTimeout(() => finish(new Error("hook did not finish")), 5000);
    const server = createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        res.writeHead(204);
        res.end();
        try {
          posted = {
            path: req.url,
            method: req.method,
            json: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          };
        } catch (error) {
          clearTimeout(timer);
          finish(error);
          server.close();
          return;
        }
        finish();
        server.close();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const child = spawn("python3", ["hooks/mote-screen-hook"], {
        env: { ...process.env, MOTE_SCREEN_HOOK_URL: `http://127.0.0.1:${port}/hook` },
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.on("error", (error) => {
        clearTimeout(timer);
        finish(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) finish(new Error(`hook exit ${code}`));
        else if (stdout) finish(new Error(`stdout should stay empty, got ${stdout}`));
        else {
          exited = true;
          finish();
        }
      });
      child.stdin.end(JSON.stringify(event));
    });
  });
}

test("安装脚本用 HTTP POST 提交摘要，不传对话正文", async () => {
  const posted = await postHook({
    hook_event_name: "PermissionRequest",
    session_id: "s1",
    turn_id: "t1",
    cwd: "/work/website",
    tool_name: "Bash",
    tool_input: { command: "git push", description: "允许运行 git push" },
    last_assistant_message: "不要出现",
    transcript_path: "/tmp/rollout.jsonl",
  });
  assert.equal(posted.method, "POST");
  assert.equal(posted.path, "/hook");
  assert.equal(posted.json.kind, "permission");
  assert.equal(posted.json.title, "允许运行 git push");
  assert.equal(posted.json.project, "website");
  assert.equal(posted.json.source, "codex");
  assert.equal(posted.json.hook_event_name, undefined);
  assert.equal(posted.json.last_assistant_message, undefined);
  assert.equal(posted.json.command, undefined);
});

test("Stop 摘要固定文案，助手正文不在请求里", async () => {
  const posted = await postHook({
    hook_event_name: "Stop",
    session_id: "s1",
    cwd: "/work/notes-cli",
    last_assistant_message: "这句不能出现在屏上",
  });
  assert.equal(posted.json.kind, "stop");
  assert.equal(posted.json.title, "本轮已结束");
  assert.equal(posted.json.project, "notes-cli");
  assert.equal(JSON.stringify(posted.json).includes("这句不能出现"), false);
});
