import { spawn } from "child_process";
import { IpcMainInvokeEvent } from "electron";

export async function launchNewInstance(_: IpcMainInvokeEvent) {
    const exePath = process.execPath;
    const env = {
        ...process.env,
        BHOPCORD_USER_DATA_DIR: process.env.BHOPCORD_USER_DATA_DIR!
    };

    const child = spawn(exePath, [], {
        detached: true,
        stdio: "ignore",
        env,
        windowsHide: false
    });

    child.unref();
    return true;
}
