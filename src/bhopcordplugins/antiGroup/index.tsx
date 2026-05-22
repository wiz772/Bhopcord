import { definePluginSettings } from "@api/Settings";
import { showNotification } from "@api/Notifications";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, Constants, RestAPI, UserStore } from "@webpack/common";

const RelationshipActions = findByPropsLazy("cancelFriendRequest", "addRelationship");

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Activer l'anti-groupe",
    },
    delay: {
        type: OptionType.NUMBER,
        default: 1000,
        min: 100,
        max: 10000,
        description: "Délai avant de quitter le groupe (ms)",
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Afficher une notification quand un groupe est quitté",
    },
    leaveMessage: {
        type: OptionType.STRING,
        default: "",
        description: "Message à envoyer avant de quitter (laisser vide pour aucun message)",
    },
    blockOnAdd: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Bloquer la personne qui nous a ajouté",
    },
    unfriendOnAdd: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Supprimer l'ami qui nous a ajouté",
    },
    whitelist: {
        type: OptionType.STRING,
        default: "",
        description: "IDs des utilisateurs autorisés à vous ajouter (séparés par des virgules)",
    },
});

function isWhitelisted(userId: string): boolean {
    if (!userId) return false;
    return settings.store.whitelist
        .split(",")
        .map(id => id.trim())
        .filter(Boolean)
        .includes(userId);
}

async function leaveGroup(channelId: string, ownerId: string) {
    try {
        const channel = ChannelStore.getChannel(channelId);
        const name = channel?.name || "Groupe";

        if (settings.store.leaveMessage) {
            try {
                await RestAPI.post({
                    url: Constants.Endpoints.MESSAGES(channelId),
                    body: { content: settings.store.leaveMessage },
                });
                await new Promise(r => setTimeout(r, 500));
            } catch (e) {
                console.warn("[AntiGroup] Message failed:", e);
            }
        }

        if (settings.store.blockOnAdd) {
            try { RelationshipActions.addRelationship(ownerId, 2); } catch (e) { console.warn("[AntiGroup] Block failed:", e); }
        }
        if (settings.store.unfriendOnAdd) {
            try { RelationshipActions.removeRelationship(ownerId); } catch (e) { console.warn("[AntiGroup] Unfriend failed:", e); }
        }

        await RestAPI.del({ url: Constants.Endpoints.CHANNEL(channelId) });

        if (settings.store.showNotifications) {
            showNotification({
                title: "AntiGroup",
                body: `Groupe "${name}" quitté automatiquement`,
            });
        }
        console.log("[AntiGroup]", `Left group "${name}" (${channelId})`);
    } catch (e) {
        console.error("[AntiGroup] Leave failed:", e);
        if (settings.store.showNotifications) {
            showNotification({
                title: "AntiGroup - Erreur",
                body: "Impossible de quitter le groupe",
            });
        }
    }
}

export default definePlugin({
    name: "AntiGroup",
    description: "Quitte automatiquement les groupes DM dès qu'on vous y ajoute, avec options de message, blocage et unfriend.",
    authors: [{ name: "bhoppeur", id: 1500726636394315866n }],
    tags: ["Utility", "Bhopcord"],
    settings,

    flux: {
        CHANNEL_CREATE({ channel }: { channel: any }) {
            if (!settings.store.enabled) return;
            if (channel?.type !== 3) return;

            const me = UserStore.getCurrentUser();
            if (!me) return;

            const ownerId = channel.ownerId;
            if (!ownerId || ownerId === me.id) return;
            if (isWhitelisted(ownerId)) return;

            const anyWhitelisted = channel.recipients?.some((r: any) =>
                isWhitelisted(typeof r === "string" ? r : r.id)
            );
            if (anyWhitelisted) return;

            if (settings.store.showNotifications) {
                showNotification({
                    title: "AntiGroup",
                    body: `Ajouté au groupe "${channel.name || "Groupe"}" — sortie dans ${settings.store.delay / 1000}s`,
                });
            }

            setTimeout(() => leaveGroup(channel.id, ownerId), settings.store.delay);
        },
    },
});
