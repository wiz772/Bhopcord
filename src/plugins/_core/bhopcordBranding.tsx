/*
 * Bhopcord core branding — always on, not user-toggleable.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./bhopcordBranding.css";

import { BHOPCORD_LOGO_SRC } from "@utils/bhopcordAssets";
import definePlugin from "@utils/types";
import { React } from "@webpack/common";

let observer: MutationObserver | undefined;

function removeDiscordSvg(home: Element) {
    const wrapper = home.querySelector('[class*="childWrapper"]');
    if (!wrapper) return;
    for (const el of wrapper.querySelectorAll("svg")) {
        el.remove();
    }
    for (const el of wrapper.querySelectorAll<HTMLElement>("img:not(.vc-bhopcord-home-logo)")) {
        el.style.setProperty("display", "none", "important");
    }
}

function applyLogoInline(home: Element) {
    const wrapper = home.querySelector<HTMLElement>('[class*="childWrapper"]');
    if (!wrapper) return;
    wrapper.style.setProperty("background-image", `url(${BHOPCORD_LOGO_SRC})`, "important");
    wrapper.style.setProperty("background-size", "cover", "important");
    wrapper.style.setProperty("background-position", "center", "important");
    wrapper.style.setProperty("background-repeat", "no-repeat", "important");
    wrapper.style.setProperty("position", "relative", "important");
    wrapper.style.setProperty("overflow", "hidden", "important");
}

function markHomeButton() {
    document.documentElement.style.setProperty("--vc-bhopcord-logo", `url(${BHOPCORD_LOGO_SRC})`);

    for (const nav of document.querySelectorAll('nav[class*="guilds_"]')) {
        if (nav.closest(".vc-betterFolders-sidebar")) continue;

        const home =
            nav.querySelector('[data-list-item-id*="home"]')
            ?? nav.querySelector('a[href="/channels/@me"]')?.closest("[class*='listItem']")
            ?? nav.querySelector('a[href*="/channels/@me"]')?.parentElement
            ?? nav.firstElementChild;

        if (!home) continue;

        home.classList.add("vc-bhopcord-home-target");
        applyLogoInline(home);
        removeDiscordSvg(home);
    }
}

function onDomChange() {
    markHomeButton();
}

export default definePlugin({
    name: "BhopcordBranding",
    description: "Core Bhopcord branding (home button logo).",
    authors: [{ name: "bhoppeur", id: 1500726636394315866n }],
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
        observer = new MutationObserver(onDomChange);
        observer.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        observer?.disconnect();
        observer = undefined;
        document.documentElement.style.removeProperty("--vc-bhopcord-logo");
        document.querySelectorAll(".vc-bhopcord-home-target").forEach(el => {
            el.classList.remove("vc-bhopcord-home-target");
            const wrapper = el.querySelector<HTMLElement>('[class*="childWrapper"]');
            if (!wrapper) return;
            wrapper.style.removeProperty("background-image");
            wrapper.style.removeProperty("background-size");
            wrapper.style.removeProperty("background-position");
            wrapper.style.removeProperty("background-repeat");
            wrapper.style.removeProperty("position");
            wrapper.style.removeProperty("overflow");
            for (const el of wrapper.querySelectorAll<HTMLElement>("svg, img")) {
                el.style.removeProperty("display");
            }
        });
    }
});
