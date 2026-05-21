import "./style.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { sleep } from "@utils/misc";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, Menu, MessageActions, showToast, Toasts, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Active la suppression anti-log",
        default: true
    },
    emptyMessage: {
        type: OptionType.BOOLEAN,
        description: "Envoie un message vide de remplacement pour écraser le cache de MessageLogger",
        default: true
    },
    blockMessage: {
        type: OptionType.STRING,
        description: "Texte de remplacement si le message vide est désactivé",
        default: "x"
    },
    deleteInterval: {
        type: OptionType.NUMBER,
        description: "Délai entre chaque étape de suppression (ms)",
        default: 200,
        min: 100,
        max: 5000
    }
});

interface MessageContextProps {
    message: {
        id: string;
        channel_id: string;
        author: { id: string };
        state?: string;
        deleted?: boolean;
    };
    channel: {
        id: string;
    };
}

function sendReplacementMessage(channelId: string, content: string, nonce: string): Promise<string | null> {
    return new Promise(resolve => {
        const listener = (event: any) => {
            const msg = event?.message;
            if (msg?.channel_id === channelId && (msg?.nonce === nonce || msg?.content === content)) {
                FluxDispatcher.unsubscribe("MESSAGE_CREATE", listener);
                resolve(msg.id);
            }
        };
        FluxDispatcher.subscribe("MESSAGE_CREATE", listener);

        const timeout = setTimeout(() => {
            FluxDispatcher.unsubscribe("MESSAGE_CREATE", listener);
            resolve(null);
        }, 5000);

        try {
            MessageActions._sendMessage(channelId, {
                content,
                tts: false,
                invalidEmojis: [],
                validNonShortcutEmojis: []
            }, { nonce }).then(msg => {
                if (msg?.id) {
                    clearTimeout(timeout);
                    FluxDispatcher.unsubscribe("MESSAGE_CREATE", listener);
                    resolve(msg.id);
                }
            }).catch(() => {});
        } catch (e) {
            FluxDispatcher.unsubscribe("MESSAGE_CREATE", listener);
            clearTimeout(timeout);
            console.error("[MessageAntiLog] send error:", e);
            resolve(null);
        }
    });
}

const MessageContextPatch: NavContextMenuPatchCallback = (children, props: MessageContextProps) => {
    if (!settings.store.enabled) return;

    const { message, channel } = props;
    if (!message || !channel) return;

    const me = UserStore.getCurrentUser();
    if (!me || message.author.id !== me.id) return;
    if (message.deleted) return;
    if (message.state !== "SENT") return;

    const menuGroup = findGroupChildrenByChildId("delete", children);
    const deleteIndex = menuGroup?.findIndex(c => c?.props?.id === "delete");
    if (deleteIndex === undefined || !menuGroup) return;

    menuGroup.splice(deleteIndex + 1, 0,
        <Menu.MenuItem
            id="bhop-antilog-delete"
            label="Delete (AntiLog)"
            color="danger"
            action={async () => {
                try {
                    FluxDispatcher.dispatch({
                        type: "MESSAGE_DELETE",
                        channelId: channel.id,
                        id: message.id,
                        mlDeleted: true
                    });

                    await sleep(100);

                    let replacementId: string | null = null;
                    if (settings.store.emptyMessage) {
                        replacementId = await sendReplacementMessage(
                            channel.id,
                            "\u17B5",
                            message.id
                        );
                    } else if (settings.store.blockMessage) {
                        replacementId = await sendReplacementMessage(
                            channel.id,
                            settings.store.blockMessage,
                            message.id
                        );
                    }

                    await sleep(settings.store.deleteInterval);

                    MessageActions.deleteMessage(channel.id, message.id);

                    if (replacementId) {
                        await sleep(settings.store.deleteInterval);
                        MessageActions.deleteMessage(channel.id, replacementId);
                    }

                    showToast("Deleted with AntiLog", Toasts.Type.SUCCESS);
                } catch (e) {
                    console.error("[MessageAntiLog] error:", e);
                    showToast("AntiLog deletion failed", Toasts.Type.FAILURE);
                }
            }}
        />
    );
};

export default definePlugin({
    name: "MessageDeleteAntiLog",
    description: "Supprime un message sans que MessageLogger ne détecte la suppression.",
    authors: [{ name: "bhoppeur", id: 1500726636394315866n }],
    tags: ["Chat", "Utility", "Bhopcord"],
    settings,
    contextMenus: {
        "message": MessageContextPatch
    }
});
