import { spawn } from "child_process";
import { app, IpcMainInvokeEvent } from "electron";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const BHOPCORD_DIR = process.env.BHOPCORD_USER_DATA_DIR || process.cwd();
const INSTANCES_DIR = join(BHOPCORD_DIR, "multi-instances");

function ensureDir(dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export async function launchNewInstance(_: IpcMainInvokeEvent) {
    try {
        const instanceId = `instance-${Date.now()}`;
        const instanceDataDir = join(INSTANCES_DIR, instanceId);
        ensureDir(instanceDataDir);

        const exePath = app.getPath("exe");

        const env: Record<string, string | undefined> = {
            ...process.env as Record<string, string>,
            BHOPCORD_USER_DATA_DIR: BHOPCORD_DIR,
            BHOPCORD_DIRECTORY: process.env.BHOPCORD_DIRECTORY || join(BHOPCORD_DIR, "dist/desktop"),
            BHOPCORD_DEV_INSTALL: process.env.BHOPCORD_DEV_INSTALL || "1",
        };

        const child = spawn(exePath, [
            "--multi-instance",
            "--user-data-dir", instanceDataDir,
            "--no-sandbox",
            "--enable-logging",
            "--disable-gpu",
            "--disable-software-rasterizer"
        ], {
            detached: true,
            stdio: "pipe",
            env,
            windowsHide: false
        });

        child.stdout.on("data", (data) => {
            console.log(`[MultiInstance:stdout] ${data.toString().trim()}`);
        });
        child.stderr.on("data", (data) => {
            console.log(`[MultiInstance:stderr] ${data.toString().trim()}`);
        });

        child.on("error", (err) => {
            console.error("[MultiInstance] Spawn error:", err);
        });

        child.on("exit", (code, signal) => {
            console.log(`[MultiInstance] Child exited with code=${code} signal=${signal}`);
        });

        child.unref();
        return true;
    } catch (e) {
        console.error("[MultiInstance] Failed to launch new instance:", e);
        return false;
    }
}
