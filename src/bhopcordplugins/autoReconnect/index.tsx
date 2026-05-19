/*
 * Bhopcord — auto reconnect voice
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { RestartIcon } from "@components/Icons";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { VoiceState } from "@vencord/discord-types";
import {
    Button,
    ChannelActions,
    ChannelStore,
    React,
    SelectedChannelStore,
    showToast,
    Toasts,
    Tooltip,
    UserStore,
} from "@webpack/common";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Rejoint automatiquement le salon vocal après une déconnexion inattendue.",
        default: false
    },
    rejoinDelay: {
        type: OptionType.SLIDER,
        description: "Secondes d'attente avant de reconnecter.",
        markers: makeRange(1, 10, 1),
        default: 2,
        stickToMarkers: true
    }
});

interface SavedChannel {
    guildId: string | null;
    channelId: string;
}

let savedChannel: SavedChannel | null = null;
let suppressReconnect = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let originalSelectVoiceChannel: typeof ChannelActions.selectVoiceChannel;

export default definePlugin({
    name: "AutoReconnect",
    description: "Bouton dans le panneau vocal pour se reconnecter automatiquement après une déconnexion.",
    authors: [{ name: "Bhopcord", id: 0n }],
    tags: ["Voice", "Utility", "Bhopcord"],
    settings,

    patches: [
        {
            find: "this.renderChannelButtons()",
            replacement: {
                match: /this.renderChannelButtons\(\)/,
                replace: "this.renderChannelButtons(), $self.renderReconnectButton()"
            }
        }
    ],

    start() {
        originalSelectVoiceChannel = ChannelActions.selectVoiceChannel;
        ChannelActions.selectVoiceChannel = (channelId: string | null, ...args: unknown[]) => {
            if (channelId === null) {
                suppressReconnect = true;
            }
            return originalSelectVoiceChannel.call(ChannelActions, channelId, ...args);
        };
    },

    stop() {
        if (originalSelectVoiceChannel) {
            ChannelActions.selectVoiceChannel = originalSelectVoiceChannel;
        }
        clearTimeout(reconnectTimer);
    },

    renderReconnectButton() {
        if (!SelectedChannelStore.getVoiceChannelId()) {
            return null;
        }

        const active = settings.store.enabled;

        return (
            <div className="vc-autoreconnect-wrap">
                <Tooltip text={active
                    ? "Auto-reconnect is on — you will rejoin if disconnected. Click to disable."
                    : "Enable auto-reconnect if you get kicked or disconnected from voice."}>
                    {({ onMouseEnter, onMouseLeave }) => (
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.PRIMARY}
                            look={Button.Looks.OUTLINED}
                            className={active ? "vc-autoreconnect-btn vc-autoreconnect-active" : "vc-autoreconnect-btn"}
                            onClick={() => {
                                settings.store.enabled = !settings.store.enabled;
                                showToast(
                                    settings.store.enabled
                                        ? "Auto-reconnect enabled"
                                        : "Auto-reconnect disabled",
                                    Toasts.Type.SUCCESS
                                );
                            }}
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                        >
                            <RestartIcon style={{ marginRight: 6 }} />
                            {active ? "Auto-reconnect: ON" : "Auto-reconnect: OFF"}
                        </Button>
                    )}
                </Tooltip>
            </div>
        );
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            const currentUser = UserStore.getCurrentUser();
            if (!currentUser) return;

            const myState = voiceStates.find(s => s.userId === currentUser.id);
            if (!myState) return;

            if (myState.channelId) {
                savedChannel = {
                    guildId: myState.guildId ?? null,
                    channelId: myState.channelId
                };
                clearTimeout(reconnectTimer);
                return;
            }

            const oldChannelId =
                "oldChannelId" in myState && myState.oldChannelId
                    ? myState.oldChannelId as string
                    : savedChannel?.channelId;

            if (!oldChannelId || !settings.store.enabled) {
                return;
            }

            if (suppressReconnect) {
                suppressReconnect = false;
                return;
            }

            const target = savedChannel ?? {
                guildId: myState.guildId ?? null,
                channelId: oldChannelId
            };

            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                if (!settings.store.enabled) return;
                if (SelectedChannelStore.getVoiceChannelId()) return;

                const channel = ChannelStore.getChannel(target.channelId);
                if (!channel) {
                    showToast("Could not reconnect — channel no longer exists", Toasts.Type.FAILURE);
                    return;
                }

                ChannelActions.selectVoiceChannel(target.channelId);
                showToast("Reconnecting to voice…", Toasts.Type.SUCCESS);
            }, settings.store.rejoinDelay * 1000);
        }
    }
});
