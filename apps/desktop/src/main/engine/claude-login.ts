import { spawn, type ChildProcess } from "node:child_process";
import { probe } from "./backends/health.js";
import type { ClaudeLoginResult } from "../../shared/types.js";

/** Claude owns browser authorization and credential persistence; Modex never parses tokens. */
export class ClaudeLogin {
  private child: ChildProcess | null = null;
  private running = false;
  private cancelCurrent: (() => void) | null = null;
  constructor(private readonly spawnImpl = spawn, private readonly timeoutMs = 300_000) {}

  cancel(): void { this.cancelCurrent?.(); }

  async run(bin: string): Promise<ClaudeLoginResult> {
    if (this.running) return { status: "busy", detail: "A Claude sign-in is already running." };
    this.running = true;
    let cancelled = false;
    this.cancelCurrent = () => { cancelled = true; this.child?.kill(); };
    try {
      // Older CLIs may interpret unknown subcommands as prompts: require structured status first.
      const check = await probe(bin, ["auth", "status"], this.spawnImpl);
      if (cancelled) return { status: "cancelled", detail: "Sign-in cancelled. CLI credentials may already have changed; refresh status." };
      let account: { loggedIn?: unknown };
      try { account = JSON.parse(check.output); } catch { return { status: "unsupported", detail: "Account commands unavailable. Update Claude Code or sign in from its terminal." }; }
      if (typeof account.loggedIn !== "boolean") return { status: "unsupported", detail: "Account commands unavailable. Update Claude Code or sign in from its terminal." };
      if (account.loggedIn) return { status: "authenticated", detail: "Claude is already signed in. Refresh account status to check the active billing source." };
      const exit = await new Promise<"timeout" | "failed" | "cancelled" | "completed">((resolve) => {
        let finished = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let escalation: ReturnType<typeof setTimeout> | undefined;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        let stopping: "cancelled" | "timeout" | null = null;
        const finish = (result: "timeout" | "failed" | "cancelled" | "completed") => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          clearTimeout(escalation);
          clearTimeout(deadline);
          resolve(result);
        };
        try {
          const child = this.spawnImpl(bin, ["auth", "login"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
          this.child = child;
          child.stdout?.resume();
          child.stderr?.resume();
          const stop = (reason: "cancelled" | "timeout") => {
            if (finished || stopping) return;
            stopping = reason;
            // Keep the attempt locked until close, not merely until kill was requested.
            escalation = setTimeout(() => { child.kill("SIGKILL"); }, 1000);
            deadline = setTimeout(() => finish("failed"), 5000);
            child.kill();
          };
          this.cancelCurrent = () => { cancelled = true; stop("cancelled"); };
          child.on("error", () => finish("failed"));
          child.on("close", (code) => finish(stopping ?? (cancelled ? "cancelled" : code === 0 ? "completed" : "failed")));
          timer = setTimeout(() => stop("timeout"), this.timeoutMs);
        } catch { finish("failed"); }
      });
      if (exit !== "completed") return { status: exit, detail: exit === "cancelled" ? "Sign-in cancelled. Refresh account status before retrying." : exit === "timeout" ? "Sign-in timed out. Use claude auth login in a terminal if browser login needs manual input." : "Sign-in failed. Use claude auth login in a terminal for interactive recovery." };
      this.cancelCurrent = () => { cancelled = true; };
      const confirmed = await probe(bin, ["auth", "status"], this.spawnImpl);
      if (cancelled) return { status: "cancelled", detail: "Sign-in cancelled. CLI credentials may already have changed; refresh status." };
      try {
        if (JSON.parse(confirmed.output).loggedIn === true) return { status: "authenticated", detail: "Claude sign-in confirmed. Model access remains unverified." };
      } catch { /* Never report success from opening a browser or an exit code alone. */ }
      return { status: "failed", detail: "Login finished but account status did not confirm sign-in. Refresh or check Claude Code in a terminal." };
    } finally {
      this.cancelCurrent = null;
      const child = this.child;
      if (child && child.exitCode === null && !child.signalCode) {
        // If termination was not confirmed, keep the lock until this exact child exits.
        child.once("close", () => { if (this.child === child) { this.child = null; this.running = false; } });
      } else { this.child = null; this.running = false; }
    }
  }
}
