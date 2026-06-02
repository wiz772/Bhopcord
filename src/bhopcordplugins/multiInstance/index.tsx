import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { PluginNative } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

const Native = VencordNative.pluginHelpers.MultiInstance as PluginNative<typeof import("./native")>;

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Activer l'ouverture d'une nouvelle instance au changement de compte",
        default: true
    },
    notify: {
        type: OptionType.BOOLEAN,
        description: "Afficher une notification dans la console",
        default: true
    }
});

export default definePlugin({
    name: "MultiInstance",
    description: "Ouvre une nouvelle instance Discord quand vous changez de compte, pour garder l'instance actuelle ouverte.",
    authors: [{ name: "bhoppeur", id: 1500726636394315866n }],
    tags: ["Utility", "Bhopcord"],
    settings,

    flux: {
        LOGOUT({ isSwitchingAccount }: { isSwitchingAccount: boolean }) {
            if (!settings.store.enabled) return;
            if (!isSwitchingAccount) return;

            if (settings.store.notify)
                console.log("[MultiInstance] Changement de compte detecté, ouverture d'une nouvelle instance...");

            Native.launchNewInstance().then(success => {
                if (success && settings.store.notify)
                    console.log("[MultiInstance] Nouvelle instance ouverte !");
            });
        }
    }
});
