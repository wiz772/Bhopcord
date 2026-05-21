import "./style.css";

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import {
    Button,
    SelectedChannelStore,
    showToast,
    Toasts,
    Tooltip,
} from "@webpack/common";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Permet d'activer/désactiver le son stéréo dans les salons vocaux.",
        default: false,
        restartNeeded: true,
    },
});

export default definePlugin({
    name: "StereoVoice",
    description: "Ajoute un bouton dans le panneau vocal pour activer/désactiver le son stéréo.",
    authors: [{ name: "bhoppeur", id: 1500726636394315866n }],
    tags: ["Voice", "Utility", "Bhopcord"],
    settings,

    patches: [
        {
            find: "this.renderChannelButtons()",
            replacement: {
                match: /this.renderChannelButtons\(\)/,
                replace: "this.renderChannelButtons(), $self.renderStereoButton()",
            },
        },
        {
            find: ";usedtx=",
            predicate: () => settings.store.enabled,
            replacement: {
                match: /;usedtx=\$\{(\i)\?"0":"1"\}/,
                replace: '$&${$1?";stereo=1;sprop-stereo=1":""}',
            },
        },
    ],

    renderStereoButton() {
        if (!SelectedChannelStore.getVoiceChannelId()) return null;

        const active = settings.store.enabled;

        return (
            <div className="vc-stereo-wrap">
                <Tooltip text={active
                    ? "Stéréo activée — désactiver et reconnectez-vous pour revenir en mono."
                    : "Activer la stéréo (reconnectez-vous au salon pour appliquer)."}>
                    {({ onMouseEnter, onMouseLeave }) => (
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.PRIMARY}
                            look={Button.Looks.OUTLINED}
                            className={active ? "vc-stereo-btn vc-stereo-active" : "vc-stereo-btn"}
                            onClick={() => {
                                settings.store.enabled = !settings.store.enabled;
                                showToast(
                                    settings.store.enabled
                                        ? "Stéréo activée — reconnectez-vous au salon vocal"
                                        : "Stéréo désactivée — reconnectez-vous au salon vocal",
                                    Toasts.Type.SUCCESS,
                                );
                            }}
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                        >
                            {active ? "Stereo: ON" : "Stereo: OFF"}
                        </Button>
                    )}
                </Tooltip>
            </div>
        );
    },
});
