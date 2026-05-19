/*
 * Bhopcord core branding — always on, not user-toggleable.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./bhopcordBranding.css";

import { BHOPCORD_LOGO_SRC } from "@utils/bhopcordAssets";
import definePlugin from "@utils/types";
import { React } from "@webpack/common";

let observer: MutationObserver | undefined;

function markHomeButton() {
    document.documentElement.style.setProperty("--vc-bhopcord-logo", `url(${BHOPCORD_LOGO_SRC})`);

    for (const nav of document.querySelectorAll('nav[class*="guilds_"]')) {
        if (nav.closest(".vc-betterFolders-sidebar")) continue;

        const home =
            nav.querySelector('[data-list-item-id*="home"]')
            ?? nav.querySelector('a[href="/channels/@me"]')?.closest("[class*='listItem']")
            ?? nav.querySelector('a[href*="/channels/@me"]')?.parentElement
            ?? nav.firstElementChild;

        if (!home || home.classList.contains("vc-bhopcord-home-target")) continue;

        home.classList.add("vc-bhopcord-home-target");
    }
}

export default definePlugin({
    name: "BhopcordBranding",
    description: "Core Bhopcord branding (home button logo).",
    authors: [{ name: "Bhopcord", id: 0n }],
    required: true,
    hidden: true,

    HomeIcon() {
        return (
            <img
                className="vc-bhopcord-home-logo"
                src={BHOPCORD_LOGO_SRC}
                alt="Bhopcord"
                draggable={false}
            />
        );
    },

    patches: [
        {
            find: 'tutorialId:"friends-list"',
            replacement: {
                match: /icon:\(\)=>\i\(\)/,
                replace: "icon:$self.HomeIcon"
            }
        },
        {
            find: 'tutorialId:"friends-list"',
            replacement: {
                match: /icon:\i,/,
                replace: "icon:$self.HomeIcon,"
            }
        },
        {
            find: "#{intl::DISCODO_DISABLED}",
            replacement: {
                match: /(\(0,\i.jsxs?\)\(\i,{}\))/,
                replace: "$self.HomeIcon()"
            }
        }
    ],

    start() {
        markHomeButton();
        observer = new MutationObserver(() => markHomeButton());
        observer.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        observer?.disconnect();
        observer = undefined;
        document.documentElement.style.removeProperty("--vc-bhopcord-logo");
        document.querySelectorAll(".vc-bhopcord-home-target").forEach(el => {
            el.classList.remove("vc-bhopcord-home-target");
        });
    }
});
