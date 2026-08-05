import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { PluginNative } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

const Native = VencordNative.pluginHelpers.MultiInstance as PluginNative<typeof import("./native")>;

const logger = new Logger("MultiInstance");

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Ouvrir une nouvelle instance automatiquement quand vous changez de compte",
        default: true
    },
    notify: {
        type: OptionType.BOOLEAN,
        description: "Afficher une notification dans la console",
        default: true
    }
});

function openNewInstance() {
    Native.launchNewInstance().then(success => {
        if (success) {
            logger.log("Nouvelle instance Discord ouverte !");
            showToast("Nouvelle instance Discord ouverte", Toasts.Type.SUCCESS);
        } else {
            logger.error("Échec de l'ouverture d'une nouvelle instance");
            showToast("Échec de l'ouverture d'une nouvelle instance", Toasts.Type.FAILURE);
        }
    }).catch(err => {
        logger.error("Erreur lors de l'ouverture d'une nouvelle instance:", err);
        showToast("Erreur lors de l'ouverture d'une nouvelle instance", Toasts.Type.FAILURE);
    });
}

export default definePlugin({
    name: "MultiInstance",
    description: "Ouvre une nouvelle instance Discord avec un dossier de données séparé. Utile pour avoir plusieurs comptes ouverts simultanément.",
    authors: [{ name: "bhoppeur", id: 1500726636394315866n }],
    tags: ["Utility", "Bhopcord"],
    settings,

    commands: [
        {
            name: "newinstance",
            description: "Ouvre une nouvelle instance Discord avec un dossier de données séparé",
            execute: () => void openNewInstance()
        }
    ],

    flux: {
        LOGOUT({ isSwitchingAccount }: { isSwitchingAccount: boolean }) {
            if (!settings.store.enabled) return;
            if (!isSwitchingAccount) return;

            logger.log("Changement de compte detecté, ouverture d'une nouvelle instance...");
            openNewInstance();
        }
    }
});
