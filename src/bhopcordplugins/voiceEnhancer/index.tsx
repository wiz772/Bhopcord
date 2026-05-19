import "./style.css";

import { definePluginSettings } from "@api/Settings";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, React, useEffect, useState } from "@webpack/common";

const configModule = findByPropsLazy("getOutputVolume");

interface StreamData {
    audioContext: AudioContext;
    audioElement: HTMLAudioElement;
    emitter: any;
    gainNode?: GainNode;
    id: string;
    levelNode: AudioWorkletNode;
    sinkId: string | "default";
    stream: MediaStream;
    streamSourceNode?: MediaStreamAudioSourceNode;
    videoStreamId: string;
    _mute: boolean;
    _speakingFlags: number;
    _volume: number;
}

const settings = definePluginSettings({
    title1: {
        type: OptionType.COMPONENT,
        component: () => <React.Fragment><div className="vc-voiceenhancer-section-title">Microphone Boost</div></React.Fragment>,
        description: ""
    },
    inputBoost: {
        type: OptionType.SLIDER,
        description: "Microphone input volume multiplier",
        markers: makeRange(1, 5, 0.5),
        default: 2,
        stickToMarkers: true,
    },
    title2: {
        type: OptionType.COMPONENT,
        component: () => <React.Fragment><div className="vc-voiceenhancer-section-title">Stereo Voice</div></React.Fragment>,
        description: ""
    },
    stereoVoice: {
        type: OptionType.BOOLEAN,
        description: "Enable stereo audio for your voice (requires restart)",
        default: false,
        restartNeeded: true,
    },
    title3: {
        type: OptionType.COMPONENT,
        component: () => <React.Fragment><div className="vc-voiceenhancer-section-title">Output Boost</div></React.Fragment>,
        description: ""
    },
    outputBoost: {
        type: OptionType.SLIDER,
        description: "Boost incoming user volume beyond 200% (requires restart)",
        markers: makeRange(1, 5, 0.5),
        default: 2,
        stickToMarkers: true,
    },
});

export default definePlugin({
    name: "VoiceEnhancer",
    description: "Boost microphone volume, enable stereo voice, and enhance audio control",
    authors: [{ name: "Bhopcord", id: 0n }],
    tags: ["Voice", "Utility", "Bhopcord"],
    settings,

    patches: [
        // Boost input volume: increase the slider max
        {
            find: "AUDIO_SET_INPUT_VOLUME",
            replacement: {
                match: /(?<=maxValue:)\d+(?=,)/,
                replace: () => `${Math.max(100, settings.store.inputBoost * 100)}`
            }
        },
        // Prevent Input Volume sync from capping values above 100
        {
            find: "AudioContextSettingsMigrated",
            replacement: [
                {
                    match: /(?<=getInputVolume\(\)||(\d+))/,
                    replace: (_, cap) => `${settings.store.inputBoost * 100}`
                },
            ]
        },
        // Boost output volume beyond 200% (enhanced volumeBooster)
        {
            find: "#{intl::USER_VOLUME}",
            replacement: {
                match: /(?<=maxValue:)\i\.isPlatformEmbedded\?(\i\.\i):\i\.\i(?=,)/,
                replace: (_, higherMaxVolume) => `${higherMaxVolume}*$self.settings.store.outputBoost`
            }
        },
        {
            find: "currentVolume:",
            replacement: {
                match: /(?<=maxValue:)\i\.\i\?(\d+?):\d+?(?=,)/,
                replace: (_, higherMaxVolume) => `${higherMaxVolume}*$self.settings.store.outputBoost`
            }
        },
        // Prevent Audio Context Settings sync from capping output volumes
        {
            find: "AudioContextSettingsMigrated",
            replacement: [
                {
                    match: /(?<=isLocalMute\(\i,\i\),volume:(\i).+?\(0,\i\.\i\)\(\i,\i,\{volume:)\1(?=\}\))/,
                    replace: "$&>200?200:$&"
                },
                {
                    match: /(?<=Object\.entries\(\i\.localMutes\).+?volume:).+?(?=,)/,
                    replace: "$&>200?200:$&"
                },
                {
                    match: /(?<=Object\.entries\(\i\.localVolumes\).+?volume:).+?(?=})/,
                    replace: "$&>200?200:$&"
                }
            ]
        },
        // Prevent MediaEngineStore from overwriting volumes >200
        {
            find: '="MediaEngineStore",',
            replacement: [
                {
                    match: /(\.settings\.audioContextSettings.+?)(\i\[\i\])=(\i\.volume)(.+?setLocalVolume\(\i,).+?\)/,
                    replace: (_, rest1, localVolume, syncVolume, rest2) => rest1
                        + `(${localVolume}>200?void 0:${localVolume}=${syncVolume})`
                        + rest2
                        + `${localVolume}??${syncVolume})`
                }
            ]
        },
        // Enable stereo in voice SDP
        {
            find: ";usedtx=",
            predicate: () => settings.store.stereoVoice,
            replacement: {
                match: /;usedtx=\$\{(\i)\?"0":"1"\}/,
                replace: '$&${$1?";stereo=1;sprop-stereo=1":""}'
            }
        },
    ],

    patchVolume(data: StreamData) {
        if (data.stream.getAudioTracks().length === 0) return;

        data.streamSourceNode ??= data.audioContext.createMediaStreamSource(data.stream);

        if (!data.gainNode) {
            const gain = data.gainNode = data.audioContext.createGain();
            data.streamSourceNode.connect(gain);
            gain.connect(data.audioContext.destination);
        }

        if (data.sinkId != null && data.sinkId !== (data.audioContext as any).sinkId && "setSinkId" in AudioContext.prototype) {
            (data.audioContext as any).setSinkId(data.sinkId === "default" ? "" : data.sinkId);
        }

        data.gainNode.gain.value = data._mute
            ? 0
            : data._volume / 100;
    }
});
