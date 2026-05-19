/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { fetchBuffer, fetchJson } from "@main/utils/http";
import { IpcEvents } from "@shared/IpcEvents";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { ipcMain } from "electron";
import { writeFileSync } from "original-fs";
import { sep } from "path";

import gitHash from "~git-hash";
import gitRemote from "~git-remote";

import { ASAR_FILE, serializeErrors } from "./common";

const API_BASE = `https://api.github.com/repos/${gitRemote}`;
let PendingUpdate: string | null = null;

function getAsarFilePath(): string {
    const parts = __dirname.split(sep);
    const asarIndex = parts.findIndex(p => p.endsWith(".asar"));
    if (asarIndex !== -1)
        return parts.slice(0, asarIndex + 1).join(sep);
    return __dirname;
}

async function githubGet<T = any>(endpoint: string) {
    return fetchJson<T>(API_BASE + endpoint, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": VENCORD_USER_AGENT
        }
    });
}

function extractHashFromReleaseName(name: string): string {
    return name.slice(name.lastIndexOf(" ") + 1);
}

async function calculateGitChanges() {
    const release = await githubGet<{ name: string; tag_name: string; assets: { name: string; browser_download_url: string; }[]; }>("/releases/latest");
    const shortHash = extractHashFromReleaseName(release.name);

    if (gitHash.startsWith(shortHash))
        return [];

    const asset = release.assets.find(a => a.name === ASAR_FILE);
    if (asset)
        PendingUpdate = asset.browser_download_url;

    const compare = await githubGet<{ commits: any[]; }>(`/compare/${gitHash}...${release.tag_name}`);

    return compare.commits.map(c => ({
        hash: c.sha,
        author: c.author?.login ?? c.commit?.author?.name ?? "Ghost",
        message: c.commit.message.split("\n")[0]
    }));
}

async function fetchUpdates() {
    const release = await githubGet<{ name: string; tag_name: string; assets: { name: string; browser_download_url: string; }[]; }>("/releases/latest");
    const shortHash = extractHashFromReleaseName(release.name);

    if (gitHash.startsWith(shortHash))
        return false;

    const asset = release.assets.find(a => a.name === ASAR_FILE);
    if (!asset)
        return false;

    PendingUpdate = asset.browser_download_url;
    return true;
}

async function applyUpdates() {
    if (!PendingUpdate) return true;

    const data = await fetchBuffer(PendingUpdate);
    const asarPath = getAsarFilePath();
    writeFileSync(asarPath, data, { flush: true });

    PendingUpdate = null;
    return true;
}

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(() => `https://github.com/${gitRemote}`));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(calculateGitChanges));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(fetchUpdates));
ipcMain.handle(IpcEvents.BUILD, serializeErrors(applyUpdates));
