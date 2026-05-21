import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { GuildMemberStore, GuildStore, Menu, PermissionsBits, PermissionStore, React, RestAPI, showToast, Toasts, UserStore, VoiceStateStore } from "@webpack/common";
import type { VoiceState } from "@vencord/discord-types";

interface LeashTarget {
    userId: string;
    username: string;
    guildId: string;
    aggressive: boolean;
}

interface UserContextProps {
    guildId?: string;
    user?: { id: string; username: string; };
}

const getMoveKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

const pendingMoves = new Set<string>();
const lastMoveTarget = new Map<string, string>();
const moveFails = new Map<string, number>();
let lastUserChannelId: string | null = null;
let isSelfDisconnected = false;

const settings = definePluginSettings({
    cooldownMs: {
        type: OptionType.NUMBER,
        description: "Délai minimum entre deux déplacements (ms)",
        default: 200,
        min: 0,
        max: 5000,
    },
    maxRetries: {
        type: OptionType.NUMBER,
        description: "Échecs max avant de retirer la laisse automatiquement",
        default: 3,
        min: 1,
        max: 10,
    },
    defaultAggressive: {
        type: OptionType.BOOLEAN,
        description: "Mode agressif : replace automatiquement la cible si elle quitte le vocal volontairement",
        default: true,
    },
    leashData: {
        type: OptionType.STRING,
        description: "Données des laisses (persistance automatique)",
        default: "[]",
    },
});

function loadTargets(): LeashTarget[] {
    try {
        const raw = settings.store.leashData;
        if (!raw) return [];
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

function saveTargets(targets: LeashTarget[]) {
    settings.store.leashData = JSON.stringify(targets);
}

function hasMoveMembers(guildId: string): boolean {
    try {
        const perms = PermissionStore.getGuildPermissions({ id: guildId });
        return (perms & PermissionsBits.MOVE_MEMBERS) === PermissionsBits.MOVE_MEMBERS;
    } catch {
        return false;
    }
}

async function moveMember(guildId: string, userId: string, channelId: string): Promise<boolean> {
    const key = getMoveKey(guildId, userId);
    if (pendingMoves.has(key)) return false;

    pendingMoves.add(key);
    try {
        await RestAPI.patch({
            url: `/guilds/${guildId}/members/${userId}`,
            body: { channel_id: channelId },
            retries: 1,
        });
        moveFails.delete(key);
        lastMoveTarget.set(key, channelId);
        return true;
    } catch (e: any) {
        const fails = (moveFails.get(key) ?? 0) + 1;
        moveFails.set(key, fails);

        if (fails >= settings.store.maxRetries) {
            const targets = loadTargets();
            const idx = targets.findIndex(t => t.userId === userId && t.guildId === guildId);
            if (idx >= 0) {
                const [removed] = targets.splice(idx, 1);
                saveTargets(targets);
                showToast(`Laisse retirée de ${removed.username} (trop d'échecs)`, Toasts.Type.FAILURE);
            }
        }
        return false;
    } finally {
        pendingMoves.delete(key);
    }
}

function moveMyTarget(target: LeashTarget, channelId: string) {
    const key = getMoveKey(target.guildId, target.userId);
    if (lastMoveTarget.get(key) === channelId) return;

    moveMember(target.guildId, target.userId, channelId);
}

function getMyVoiceInfo(): { guildId: string | null; channelId: string | null } {
    const me = UserStore.getCurrentUser();
    if (!me) return { guildId: null, channelId: null };

    const vs = VoiceStateStore.getVoiceStateForUser(me.id);
    if (!vs?.channelId) return { guildId: null, channelId: null };

    return { guildId: vs.guildId ?? null, channelId: vs.channelId };
}

const UserContextPatch: NavContextMenuPatchCallback = (children, { guildId, user }: UserContextProps) => {
    if (!guildId || !user) return;
    if (user.id === UserStore.getCurrentUser()?.id) return;
    if (!hasMoveMembers(guildId)) return;

    const targets = loadTargets();
    const isLeashed = targets.some(t => t.userId === user.id && t.guildId === guildId);

    const [leashed, setLeashed] = React.useState(isLeashed);

    children.push(
        <Menu.MenuCheckboxItem
            id="vl-toggle-leash"
            label={leashed ? "Retirer la laisse" : "Mettre la laisse"}
            checked={leashed}
            action={() => {
                const current = loadTargets();
                const idx = current.findIndex(t => t.userId === user.id && t.guildId === guildId);

                if (idx >= 0) {
                    current.splice(idx, 1);
                    saveTargets(current);
                    setLeashed(false);
                    showToast(`Laisse retirée de ${user.username}`, Toasts.Type.SUCCESS);
                } else {
                    current.push({
                        userId: user.id,
                        username: user.username,
                        guildId,
                        aggressive: settings.store.defaultAggressive,
                    });
                    saveTargets(current);
                    setLeashed(true);

                    const { channelId } = getMyVoiceInfo();
                    if (channelId) {
                        moveMember(guildId, user.id, channelId);
                    }
                    showToast(`Laisse mise sur ${user.username}`, Toasts.Type.SUCCESS);
                }
            }}
        />
    );
};

export default definePlugin({
    name: "VoiceLeash",
    description: "Attachez des utilisateurs à votre salon vocal avec la permission MOVE_MEMBERS.",
    tags: ["Voice", "Moderation", "Bhopcord"],
    authors: [{ name: "bhoppeur", id: 1500726636394315866n }],
    settings,

    contextMenus: {
        "user-context": UserContextPatch,
    },

    flux: {
        GUILD_DELETE({ guild }: { guild: { id: string } }) {
            const targets = loadTargets();
            const filtered = targets.filter(t => t.guildId !== guild.id);
            if (filtered.length !== targets.length) {
                saveTargets(filtered);
            }
        },

        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[] }) {
            const me = UserStore.getCurrentUser();
            if (!me) return;

            const myStates = voiceStates.filter(vs => vs.userId === me.id);
            for (const myState of myStates) {
                if (myState.channelId) {
                    isSelfDisconnected = false;
                    lastUserChannelId = myState.channelId;

                    if (myState.guildId) {
                        const targets = loadTargets().filter(t => t.guildId === myState.guildId);
                        for (const target of targets) {
                            const targetVS = VoiceStateStore.getVoiceStateForUser(target.userId);
                            if (targetVS?.channelId && targetVS.channelId !== myState.channelId) {
                                moveMyTarget(target, myState.channelId);
                            }
                        }
                    }
                } else {
                    isSelfDisconnected = true;
                }
            }

            const targets = loadTargets();
            for (const target of targets) {
                const targetState = voiceStates.find(vs => vs.userId === target.userId);
                if (!targetState) continue;

                if (isSelfDisconnected) continue;

                if (targetState.channelId && lastUserChannelId && targetState.channelId !== lastUserChannelId) {
                    if (targetState.guildId === target.guildId) {
                        moveMyTarget(target, lastUserChannelId);
                    }
                } else if (!targetState.channelId && target.aggressive && lastUserChannelId) {
                    if (targetState.guildId === target.guildId) {
                        moveMyTarget(target, lastUserChannelId);
                    }
                }
            }
        },
    },

    start() {
        const { guildId, channelId } = getMyVoiceInfo();
        lastUserChannelId = channelId;
        isSelfDisconnected = !channelId;

        const targets = loadTargets();
        const valid = targets.filter(t => {
            const guild = GuildStore.getGuild(t.guildId);
            if (!guild) return false;

            if (!hasMoveMembers(t.guildId)) return false;

            const member = GuildMemberStore.getMember(t.guildId, t.userId);
            if (!member) return false;

            return true;
        });

        if (valid.length !== targets.length) {
            saveTargets(valid);
        }
    },

    stop() {
        pendingMoves.clear();
        lastMoveTarget.clear();
        moveFails.clear();
        lastUserChannelId = null;
        isSelfDisconnected = false;
    },
});
