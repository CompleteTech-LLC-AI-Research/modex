import { spawn } from "node:child_process";
import type { BackendHealth } from "../../../shared/types.js";

/** A bounded, non-inference CLI probe. Raw output never crosses IPC. */
export function probe(bin: string, args: string[], spawnImpl = spawn, timeoutMs = 5000): Promise<{ code: number | null; output: string; failure?: "missing" | "timeout" | "failed" }> {
  return new Promise((resolve) => {
    let done = false;
    let output = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: { code: number | null; output: string; failure?: "missing" | "timeout" | "failed" }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    try {
      const child = spawnImpl(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      child.stderr?.resume();
      child.stdout?.on("data", (data: Buffer) => {
        output += data.toString();
        if (output.length > 65536) { finish({ code: null, output: "", failure: "failed" }); child.kill(); }
      });
      child.on("error", (error: NodeJS.ErrnoException) => finish({ code: null, output: "", failure: error.code === "ENOENT" ? "missing" : "failed" }));
      child.on("close", (code) => finish({ code, output }));
      timer = setTimeout(() => { finish({ code: null, output: "", failure: "timeout" }); child.kill(); }, timeoutMs);
    } catch { finish({ code: null, output: "", failure: "failed" }); }
  });
}

export function health(authentication: BackendHealth["authentication"], detail: string, executable: BackendHealth["executable"] = "available"): BackendHealth {
  return { executable, authentication, access: "unverified", detail };
}

export async function installation(bin: string, spawnImpl = spawn): Promise<BackendHealth | null> {
  const result = await probe(bin, ["--version"], spawnImpl);
  if (!result.failure && result.code === 0) return null;
  return health("unknown", result.failure === "missing" ? "CLI not found" : result.failure === "timeout" ? "CLI check timed out" : "CLI check failed", result.failure === "missing" ? "missing" : "unknown");
}
