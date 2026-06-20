import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { sleep } from "@utils/misc";
import { Queue } from "@utils/Queue";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, User } from "@vencord/discord-types";
import { Alerts, ChannelStore, Constants, FluxDispatcher, Menu, MessageActions, MessageStore, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    antiLog: {
        type: OptionType.BOOLEAN,
        description: "Cache la suppression aux logger MessageLogger",
        default: false
    }
});

const deleteQueue = new Queue();

function randomDelay() {
    return Math.random() * 4000 + 1000;
}

interface UserContextProps {
    channel?: Channel;
    guildId?: string;
    user?: User;
}

async function fetchAllMessages(channelId: string, before?: string): Promise<any[]> {
    const res = await RestAPI.get({
        url: Constants.Endpoints.MESSAGES(channelId),
        query: { limit: 100, ...(before ? { before } : {}) },
        retries: 2
    }).catch(() => null);

    if (!res?.body?.length) return [];

    const messages = res.body as any[];
    for (const msg of messages) {
        MessageStore.getMessages(channelId).receiveMessage(msg);
    }

    if (messages.length === 100) {
        const lastId = messages[messages.length - 1].id;
        const more = await fetchAllMessages(channelId, lastId);
        return [...messages, ...more];
    }

    return messages;
}

async function deleteWithRetry(channelId: string, msgId: string): Promise<void> {
    if (settings.store.antiLog) {
        FluxDispatcher.dispatch({
            type: "MESSAGE_DELETE",
            channelId,
            id: msgId,
            mlDeleted: true
        });
        await sleep(50);
    }

    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            await MessageActions.deleteMessage(channelId, msgId);
            return;
        } catch (e: any) {
            if (e?.status === 429) {
                const retryAfter = ((e?.body?.retry_after ?? 1) * 1000) + 500;
                await sleep(retryAfter);
                continue;
            }
            throw e;
        }
    }
}

const UserContextPatch: NavContextMenuPatchCallback = (children, { user }: UserContextProps) => {
    if (!user) return;

    const dmChannelId = ChannelStore.getDMFromUserId(user.id);
    if (!dmChannelId) return;

    children.push(
        <Menu.MenuItem
            id="bhop-clear-dm"
            label="Clear DM"
            action={() => {
                const antiLogActive = settings.store.antiLog;
                Alerts.show({
                    title: "Clear DM?",
                    body: `This will delete all your messages with ${user.username}.${antiLogActive ? "\n\nAntiLog is enabled — deletions will be hidden from MessageLogger." : ""}`,
                    confirmColor: "colorDanger" as any,
                    confirmText: "Delete All",
                    cancelText: "Cancel",
                    onConfirm: async () => {
                        const me = UserStore.getCurrentUser();
                        showToast("Fetching messages...", Toasts.Type.CUSTOM);

                        const messages = await fetchAllMessages(dmChannelId);
                        const myMessages = messages.filter(m => m.author.id === me.id);

                        if (!myMessages.length) {
                            showToast("No messages to delete.", Toasts.Type.FAILURE);
                            return;
                        }

                        const total = myMessages.length;
                        let deleted = 0;
                        let failed = 0;

                        showToast(`Deleting 0/${total}...`, Toasts.Type.CUSTOM);

                        for (const msg of myMessages) {
                            await new Promise<void>(resolve => {
                                deleteQueue.push(async () => {
                                    try {
                                        await deleteWithRetry(dmChannelId, msg.id);
                                        deleted++;
                                    } catch {
                                        failed++;
                                    }
                                    showToast(`Deleting ${deleted}/${total}...`, Toasts.Type.CUSTOM);
                                    await sleep(randomDelay());
                                    resolve();
                                });
                            });
                        }

                        if (failed === 0) {
                            showToast(`DM cleared. (${deleted} deleted)`, Toasts.Type.SUCCESS);
                        } else {
                            showToast(`Done. ${deleted} deleted, ${failed} failed.`, Toasts.Type.FAILURE);
                        }
                    }
                });
            }}
        />
    );
};

export default definePlugin({
    name: "ClearDM",
    description: "Supprime tous vos messages dans une conversation privée depuis le menu contextuel.",
    authors: [{ name: "bhoppeur", id: 1500726636394315866n }],
    tags: ["Chat", "Utility", "Bhopcord"],
    settings,
    contextMenus: {
        "user-context": UserContextPatch
    }
});
