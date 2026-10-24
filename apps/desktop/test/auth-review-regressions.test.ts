import { test } from "node:test";
import assert from "node:assert/strict";
import type { spawn } from "node:child_process";
import { CodexBackend } from "../src/main/engine/backends/codex.js";
import { ClaudeLogin } from "../src/main/engine/claude-login.js";
import { FakeProcess } from "./fakeproc.js";

test("review: Codex can recover after initialization times out", async () => {
  let servers = 0;
  const spawnImpl = ((_bin: string, args: string[]) => {
    const child = new FakeProcess();
    if (args[0] === "--version") setImmediate(() => { child.emitLine("1.0.0"); child.close(0); });
    else {
      const server = ++servers;
      child.stdin.on("data", (data: Buffer) => {
        const request = JSON.parse(data.toString());
        if (request.id && server > 1) child.emitLine({ id: request.id, result: request.method === "model/list" ? { data: [] } : {} });
      });
    }
    return child;
  }) as unknown as typeof spawn;
  const backend = new CodexBackend("codex", spawnImpl);
  try {
    assert.equal((await backend.health()).authentication, "unknown");
    assert.deepEqual(await backend.listModels(), []);
    assert.equal(servers, 2);
  } finally { await backend.dispose(); }
});

test("review: Claude cancellation waits for its login child to exit", async () => {
  let loginChild: FakeProcess | undefined;
  const spawnImpl = ((_bin: string, args: string[]) => {
    const child = new FakeProcess();
    if (args[1] === "status") setImmediate(() => { child.emitLine({ loggedIn: false }); child.close(1); });
    else {
      loginChild = child;
      child.kill = () => { child.killed = true; return true; };
    }
    return child;
  }) as unknown as typeof spawn;
  const login = new ClaudeLogin(spawnImpl, 1000);
  let settled = false;
  const pending = login.run("claude").then((result) => { settled = true; return result; });
  while (!loginChild) await new Promise((resolve) => setImmediate(resolve));
  login.cancel();
  await new Promise((resolve) => setImmediate(resolve));
  try { assert.equal(settled, false, "cancellation reported completion while the login process was still alive"); }
  finally { loginChild.close(null); await pending; }
});

test("review: cancellation during status confirmation cannot become success", async () => {
  let checks = 0;
  let confirmation: FakeProcess | undefined;
  const spawnImpl = ((_bin: string, args: string[]) => {
    const child = new FakeProcess();
    if (args[1] === "status" && ++checks > 1) confirmation = child;
    else setImmediate(() => { if (args[1] === "status") child.emitLine({ loggedIn: false }); child.close(0); });
    return child;
  }) as unknown as typeof spawn;
  const login = new ClaudeLogin(spawnImpl);
  const pending = login.run("claude");
  while (!confirmation) await new Promise((resolve) => setImmediate(resolve));
  login.cancel();
  confirmation.emitLine({ loggedIn: true }); confirmation.close(0);
  assert.equal((await pending).status, "cancelled");
});
