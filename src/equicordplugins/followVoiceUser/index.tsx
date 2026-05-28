import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Notice } from "@components/Notice";
import { EquicordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { User, VoiceState } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { Menu, React, UserStore, VoiceStateStore } from "@webpack/common";

interface FollowEntry {
    lastChannelId: string;
    userId: string;
}

const followedUsers = new Map<string, FollowEntry>();

const voiceChannelAction = findByPropsLazy("selectVoiceChannel");

const settings = definePluginSettings({
    onlyWhenInVoice: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Only follow users when you are in a voice channel"
    },
    leaveWhenUserLeaves: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Leave the voice channel when the followed user leaves"
    }
});

interface UserContextProps {
    user: User;
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: UserContextProps) => {
    if (!user || UserStore.getCurrentUser()?.id === user.id) return;

    const [checked, setChecked] = React.useState(followedUsers.has(user.id));

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuCheckboxItem
            id="fvu-follow-user"
            label={checked ? "Unfollow User" : "Follow User"}
            checked={checked}
            action={() => {
                if (followedUsers.has(user.id)) {
                    followedUsers.delete(user.id);
                    setChecked(false);
                } else {
                    followedUsers.set(user.id, {
                        lastChannelId: UserStore.getCurrentUser().id,
                        userId: user.id
                    });
                    setChecked(true);
                }
            }}
        />
    );
};

export default definePlugin({
    name: "FollowVoiceUser",
    description: "Follow multiple users (friends or not) in voice chat.",
    tags: ["Voice"],
    authors: [EquicordDevs.TheArmagan],
    settings,
    settingsAboutComponent: () => (
        <Notice.Info>
            Follow multiple users into voice channels. Non-friends are supported.
        </Notice.Info>
    ),
    flux: {
        async VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (followedUsers.size === 0) return;

            if (
                settings.store.onlyWhenInVoice
                && !VoiceStateStore.getVoiceStateForUser(UserStore.getCurrentUser().id)
            ) return;

            const myId = UserStore.getCurrentUser().id;

            for (const voiceState of voiceStates) {
                const info = followedUsers.get(voiceState.userId);
                if (!info) continue;
                if (voiceState.userId === myId) continue;

                if (voiceState.channelId && voiceState.channelId !== info.lastChannelId) {
                    info.lastChannelId = voiceState.channelId;
                    voiceChannelAction.selectVoiceChannel(voiceState.channelId);
                } else if (!voiceState.channelId && settings.store.leaveWhenUserLeaves) {
                    followedUsers.delete(voiceState.userId);
                    if (followedUsers.size === 0) {
                        voiceChannelAction.selectVoiceChannel(null);
                    }
                }
            }
        }
    },
    contextMenus: {
        "user-context": UserContextMenuPatch
    },
    start() {
        followedUsers.clear();
    },
    stop() {
        followedUsers.clear();
    }
});
