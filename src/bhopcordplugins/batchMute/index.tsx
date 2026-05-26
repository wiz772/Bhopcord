import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel } from "@vencord/discord-types";
import { ChannelStore, GuildActions, Menu, PermissionsBits, PermissionStore, showToast, Toasts, UserStore, VoiceStateStore } from "@webpack/common";

const selectedUsers = new Set<string>();
const getKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

function getSelectedInGuild(guildId: string): string[] {
    const prefix = guildId + ":";
    return [...selectedUsers].filter(k => k.startsWith(prefix)).map(k => k.split(":")[1]);
}

async function muteUsers(guildId: string, userIds: string[], mute: boolean) {
    for (const userId of userIds) {
        GuildActions.setServerMute(guildId, userId, mute);
        await new Promise(r => setTimeout(r, settings.store.rateLimitDelay));
    }

    const action = mute ? "Muted" : "Unmuted";
    showToast(`${action} ${userIds.length} user(s)`, Toasts.Type.SUCCESS);
}

interface UserContextProps {
    guildId?: string;
    user?: { id: string; username: string; };
}

const UserContextPatch: NavContextMenuPatchCallback = (children, { guildId, user }: UserContextProps) => {
    if (!guildId || !user) return;
    if (user.id === UserStore.getCurrentUser()?.id) return;

    const vs = VoiceStateStore.getVoiceStateForUser(user.id);
    if (!vs?.channelId) return;

    const channel = vs.channelId ? ChannelStore.getChannel(vs.channelId) : null;
    if (!channel?.guild_id) return;
    if (!PermissionStore.can(PermissionsBits.MUTE_MEMBERS, channel)) return;

    const key = getKey(guildId, user.id);
    const isSelected = selectedUsers.has(key);

    children.push(
        <Menu.MenuCheckboxItem
            id="bm-toggle-select"
            label={isSelected ? "Batch Mute: Deselect" : "Batch Mute: Select"}
            checked={isSelected}
            action={() => {
                if (isSelected) {
                    selectedUsers.delete(key);
                } else {
                    selectedUsers.add(key);
                }
                const count = getSelectedInGuild(guildId).length;
                if (count > 0) {
                    showToast(`Batch Mute: ${count} user(s) selected`, Toasts.Type.SUCCESS);
                }
            }}
        />
    );
};

interface ChannelContextProps {
    channel: Channel;
}

const ChannelContextPatch: NavContextMenuPatchCallback = (children, { channel }: ChannelContextProps) => {
    if (!channel || (channel.type !== 2 && channel.type !== 13)) return;
    if (!channel.guild_id) return;
    if (!PermissionStore.can(PermissionsBits.MUTE_MEMBERS, channel)) return;

    const guildId = channel.guild_id;
    const selected = getSelectedInGuild(guildId);
    if (selected.length === 0) return;

    children.splice(
        -1,
        0,
        <Menu.MenuItem
            label={`Batch Mute (${selected.length})`}
            key="batch-mute"
            id="batch-mute"
        >
            <Menu.MenuItem
                label="Mute selected"
                id="bm-mute"
                action={() => {
                    muteUsers(guildId, selected, true);
                    selected.forEach(id => selectedUsers.delete(getKey(guildId, id)));
                }}
            />
            <Menu.MenuItem
                label="Unmute selected"
                id="bm-unmute"
                action={() => {
                    muteUsers(guildId, selected, false);
                    selected.forEach(id => selectedUsers.delete(getKey(guildId, id)));
                }}
            />
            <Menu.MenuItem
                label="Clear selection"
                id="bm-clear"
                color="danger"
                action={() => {
                    selected.forEach(id => selectedUsers.delete(getKey(guildId, id)));
                    showToast("Batch Mute: selection cleared", Toasts.Type.SUCCESS);
                }}
            />
        </Menu.MenuItem>
    );
};

const settings = definePluginSettings({
    rateLimitDelay: {
        type: OptionType.NUMBER,
        description: "Délai entre chaque mutation (ms) pour éviter le rate-limit",
        default: 500,
        min: 0,
        max: 5000,
    }
});

export default definePlugin({
    name: "BatchMute",
    description: "Sélectionnez plusieurs utilisateurs vocaux et mute/unmute d'un coup via le menu contextuel.",
    authors: [{ name: "bhoppeur", id: 1500726636394315866n }],
    tags: ["Voice", "Moderation", "Bhopcord"],
    settings,
    contextMenus: {
        "user-context": UserContextPatch,
        "channel-context": ChannelContextPatch
    }
});
