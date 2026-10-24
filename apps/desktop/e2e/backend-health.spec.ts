import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { seedHome, launch, tid } from "./support.js";

test("static models never make a missing Claude executable ready", async () => {
  const { home, repo } = seedHome();
  const statePath = path.join(home, "app", "state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.settings.claude_bin = path.join(home, "missing-claude");
  state.settings.codex_bin = path.join(home, "missing-codex");
  fs.writeFileSync(statePath, JSON.stringify(state));
  const { app, page } = await launch(home);
  try {
    await tid(page, "open-settings").click();
    await page.getByRole("button", { name: "Coding CLIs", exact: true }).click();
    await expect(page.getByText("CLI not found", { exact: true })).toHaveCount(2);
    await expect(page.getByText(/^ready ·/)).toHaveCount(0);
    await page.getByRole("button", { name: "Sign in to Claude Code", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Account commands unavailable");
    await page.getByLabel("Claude executable").fill("another-cli");
    await expect(page.getByText("Path changed · save and restart to check", { exact: true })).toBeVisible();
  } finally {
    await app.close();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
