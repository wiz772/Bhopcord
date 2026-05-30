import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { UserStore } from "@webpack/common";

const logger = new Logger("NitroSniper");
const GiftActions = findByPropsLazy("redeemGiftCode");

let startTime = 0;
let claiming = false;
const codeQueue: string[] = [];
const queuedCodes = new Set<string>();
const attemptedCodes = new Set<string>();

const GIFT_CODE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gift\/|discord(?:app)?\.com\/gifts?\/)([a-zA-Z0-9]{16,24})/gi;

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Activer le snipping automatique",
        default: true
    },
    ignoreOwnMessages: {
        type: OptionType.BOOLEAN,
        description: "Ignorer vos propres messages",
        default: true
    },
    claimDelayMs: {
        type: OptionType.SLIDER,
        description: "Délai entre chaque tentative (ms)",
        markers: [0, 250, 500, 1000, 2000],
        default: 350,
        stickToMarkers: false,
        minValue: 0,
        maxValue: 3000
    },
    maxQueueSize: {
        type: OptionType.SLIDER,
        description: "Taille max de la file d'attente",
        markers: [5, 10, 25, 50],
        default: 25,
        stickToMarkers: false,
        minValue: 1,
        maxValue: 100
    },
    logFailures: {
        type: OptionType.BOOLEAN,
        description: "Journaliser les échecs",
        default: true
    }
});

function extractGiftCodes(content: string) {
    const codes: string[] = [];
    GIFT_CODE_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = GIFT_CODE_REGEX.exec(content)) !== null) {
        const code = match[1];
        if (!code) continue;
        if (!codes.includes(code)) codes.push(code);
    }

    return codes;
}

function processQueue() {
    if (claiming || !codeQueue.length) return;

    if (!GiftActions?.redeemGiftCode) {
        logger.error("redeemGiftCode est indisponible");
        return;
    }

    claiming = true;
    const code = codeQueue.shift()!;
    queuedCodes.delete(code);
    attemptedCodes.add(code);

    const startedAt = Date.now();

    GiftActions.redeemGiftCode({
        code,
        onRedeemed: () => {
            logger.log(`Code récupéré avec succès: ${code} (${Date.now() - startedAt}ms)`);
            claiming = false;
            setTimeout(processQueue, settings.store.claimDelayMs);
        },
        onError: (err: Error) => {
            if (settings.store.logFailures)
                logger.error(`Échec du code: ${code}`, err);

            claiming = false;
            setTimeout(processQueue, settings.store.claimDelayMs);
        }
    });
}

export default definePlugin({
    name: "NitroSniper",
    description: "Récupère automatiquement les liens cadeaux Nitro envoyés dans le chat",
    authors: [{ name: "bhoppeur", id: 1500726636394315866n }],
    tags: ["Utility", "Bhopcord"],
    settings,

    start() {
        startTime = Date.now();
        codeQueue.length = 0;
        queuedCodes.clear();
        attemptedCodes.clear();
        claiming = false;
    },

    stop() {
        claiming = false;
        codeQueue.length = 0;
        queuedCodes.clear();
    },

    flux: {
        MESSAGE_CREATE({ message }: { message: any; }) {
            if (!settings.store.enabled) return;
            if (!message.content) return;

            if (settings.store.ignoreOwnMessages) {
                const me = UserStore.getCurrentUser();
                if (me?.id && message.author?.id === me.id) return;
            }

            const ts = new Date(message.timestamp).getTime();
            if (Number.isFinite(ts) && ts < startTime) return;

            const matches = extractGiftCodes(message.content);
            if (!matches.length) return;

            for (const code of matches) {
                if (attemptedCodes.has(code) || queuedCodes.has(code)) continue;
                if (codeQueue.length >= settings.store.maxQueueSize) break;

                codeQueue.push(code);
                queuedCodes.add(code);
            }

            processQueue();
        }
    }
});
