import "./messageLogger.css";

import {
    findGroupChildrenByChildId,
    NavContextMenuPatchCallback,
} from "@api/ContextMenu";
import { updateMessage } from "@api/MessageUpdater";
import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { getIntlMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { findCssClassesLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, Menu, MessageStore, Parser, SelectedChannelStore, Timestamp, UserStore, useStateFromStores } from "@webpack/common";

import overlayStyle from "./deleteStyleOverlay.css?managed";
import textStyle from "./deleteStyleText.css?managed";
import { createMessageDiff, DiffPart } from "./diffUtils";
import { openHistoryModal } from "./HistoryModal";

interface MLMessage extends Message {
    deleted?: boolean;
    editHistory?: { timestamp: Date; content: string; }[];
    firstEditTimestamp?: Date;
    diffViewDisabled?: boolean;
}

interface DeletedMessageData {
    content: string;
    authorId: string;
    authorName: string;
    timestamp: Date;
}

const MessageClasses = findCssClassesLazy("edited", "communicationDisabled", "isSystemMessage");

const disabledDiffMessages = new Set<string>();
const deletedContentStore = new Map<string, DeletedMessageData>();
const messageCache = new Map<string, DeletedMessageData>();
const nonceIndex = new Map<string, string>(); // nonce → "channelId:messageId"

function storeKey(channelId: string, messageId: string): string {
    return `${channelId}:${messageId}`;
}

function getStoredDeletedMessage(channelId: string, messageId: string): DeletedMessageData | undefined {
    return deletedContentStore.get(storeKey(channelId, messageId));
}

function addDeleteStyle() {
    if (settings.store.deleteStyle === "text") {
        enableStyle(textStyle);
        disableStyle(overlayStyle);
    } else {
        disableStyle(textStyle);
        enableStyle(overlayStyle);
    }
}

const REMOVE_HISTORY_ID = "ml-remove-history";
const TOGGLE_DELETE_STYLE_ID = "ml-toggle-style";
const TOGGLE_DIFF_VIEW_ID = "ml-toggle-diff";
const patchMessageContextMenu: NavContextMenuPatchCallback = (
    children,
    props,
) => {
    const { message } = props;
    const { deleted, editHistory, id, channel_id } = message;

    if (!deleted && !editHistory?.length) return;

    toggle: {
        if (!deleted) break toggle;

        const domElement = document.getElementById(
            `chat-messages-${channel_id}-${id}`,
        );
        if (!domElement) break toggle;

        children.push(
            <Menu.MenuItem
                id={TOGGLE_DELETE_STYLE_ID}
                key={TOGGLE_DELETE_STYLE_ID}
                label="Toggle Deleted Highlight"
                action={() => domElement.classList.toggle("messagelogger-deleted")}
            />,
        );
    }

    if (editHistory?.length && settings.store.showEditDiffs) {
        const isDisabled = disabledDiffMessages.has(id);
        children.push(
            <Menu.MenuItem
                id={TOGGLE_DIFF_VIEW_ID}
                key={TOGGLE_DIFF_VIEW_ID}
                label={isDisabled ? "Enable Diff View" : "Disable Diff View"}
                color="danger"
                action={() => {
                    if (isDisabled) disabledDiffMessages.delete(id);
                    else disabledDiffMessages.add(id);
                    const domElement = document.getElementById(`chat-messages-${channel_id}-${id}`);
                    domElement?.classList.toggle("messagelogger-diff-disabled", disabledDiffMessages.has(id));
                    updateMessage(channel_id, id);
                }}
            />,
        );
    }

    let label;

    if (!isPluginEnabled("MessageLoggerEnhanced")) {
        label = "Remove Message History";
    } else {
        label = "Remove Message (Temporary)";
    }

    children.push(
        <Menu.MenuItem
            id={REMOVE_HISTORY_ID}
            key={REMOVE_HISTORY_ID}
            label={label}
            color="danger"
            action={() => {
                if (deleted) {
                    FluxDispatcher.dispatch({
                        type: "MESSAGE_DELETE",
                        channelId: channel_id,
                        id,
                        mlDeleted: true,
                        fromClearHistory: true,
                    });
                } else {
                    updateMessage(channel_id, id, { editHistory: [] });
                }
            }}
        />,
    );
};

const patchChannelContextMenu: NavContextMenuPatchCallback = (
    children,
    { channel },
) => {
    const messages = MessageStore.getMessages(channel?.id) as MLMessage[];
    if (!messages?.some(msg => msg.deleted || msg.editHistory?.length)) return;

    const group = findGroupChildrenByChildId("mark-channel-read", children) ?? children;
    group.push(
        <Menu.MenuItem
            id="vc-ml-clear-channel"
            label="Clear Message Log"
            color="danger"
            action={() => {
                messages.forEach(msg => {
                    if (msg.deleted)
                        FluxDispatcher.dispatch({
                            type: "MESSAGE_DELETE",
                            channelId: channel.id,
                            id: msg.id,
                            mlDeleted: true,
                            fromClearHistory: true,
                        });
                    else
                        updateMessage(channel.id, msg.id, {
                            editHistory: [],
                        });
                });
            }}
        />,
    );
};

function applyAggregatedCustomContent(message: Message, key: string, nodes: React.ReactNode) {
    const payload = {
        __messageloggerDiff: true,
        __messageloggerDiffKey: key,
        content: <div key={key}>
            {nodes}
        </div>
    };

    const existingKey = (message as any).customRenderedContent?.__messageloggerDiffKey;
    const shouldCommit = existingKey !== key;

    (message as any).__messageloggerLastAppliedKey = key;
    (message as any).customRenderedContent = payload;

    if (typeof queueMicrotask === "function") queueMicrotask(() => {
        if ((message as any).__messageloggerLastAppliedKey !== key) return;
        (message as any).customRenderedContent = payload;
        if (shouldCommit) {
            updateMessage(message.channel_id, message.id, { customRenderedContent: payload });
        }
    });
    else setTimeout(() => {
        if ((message as any).__messageloggerLastAppliedKey !== key) return;
        (message as any).customRenderedContent = payload;
        if (shouldCommit) {
            updateMessage(message.channel_id, message.id, { customRenderedContent: payload });
        }
    }, 0);
}

function clearCustomRenderedContent(message: Message) {
    const existing = (message as any).customRenderedContent;
    if (!existing?.__messageloggerDiff) return;

    const lastKey = (message as any).__messageloggerLastAppliedKey;
    delete (message as any).__messageloggerLastAppliedKey;
    delete (message as any).customRenderedContent;

    if (typeof queueMicrotask === "function") queueMicrotask(() => {
        const current = (message as any).customRenderedContent;
        if (current?.__messageloggerDiff) return;
        const currentKey = (message as any).__messageloggerLastAppliedKey;
        if (typeof currentKey === "string" && currentKey !== lastKey) return;
        updateMessage(message.channel_id, message.id, { customRenderedContent: null });
    });
    else setTimeout(() => {
        const current = (message as any).customRenderedContent;
        if (current?.__messageloggerDiff) return;
        const currentKey = (message as any).__messageloggerLastAppliedKey;
        if (typeof currentKey === "string" && currentKey !== lastKey) return;
        updateMessage(message.channel_id, message.id, { customRenderedContent: null });
    }, 0);
}

function createDiffSegment(part: DiffPart, message: Message, key: React.Key, highlightType?: "removed" | "added") {
    const parsedContent = Parser.parse(part.text, true, {
        channelId: message.channel_id,
        messageId: message.id,
        allowLinks: true,
        allowHeading: true,
        allowList: true,
        allowEmojiLinks: true,
        viewingChannelId: SelectedChannelStore.getChannelId(),
    });

    let className: string | undefined;
    if (part.type === "added" || part.type === "removed") {
        if (!highlightType || highlightType === part.type) {
            className = `messagelogger-diff-${part.type}`;
        }
    }

    return (
        <span key={key} className={className}>
            {parsedContent}
        </span>
    );
}

function renderDiffParts(diffParts: DiffPart[], message: Message) {
    return diffParts.map((part, index) => createDiffSegment(part, message, index));
}

function buildViewSegments(diffParts: DiffPart[], view: "original" | "updated"): DiffPart[] {
    const segments: DiffPart[] = [];

    for (const part of diffParts) {
        if (view === "original") {
            if (part.type === "added") continue;
            segments.push(part);
        } else {
            if (part.type === "removed") continue;
            segments.push(part);
        }
    }

    return segments;
}

export function parseEditContent(content: string, message: Message, previousContent?: string) {
    const perMessageDiffEnabled = !disabledDiffMessages.has(message.id);
    const aggregatedState = (message as any).__messageloggerAggregated as undefined | {
        key: string;
        aggregatedNodes: React.ReactNode;
    };
    if (previousContent && content !== previousContent && settings.store.showEditDiffs && perMessageDiffEnabled) {
        const diffParts = createMessageDiff(content, previousContent);
        const originalSegments = buildViewSegments(diffParts, "original");
        const updatedSegments = buildViewSegments(diffParts, "updated");
        const useSeparatedDiffs = settings.store.separatedDiffs;

        if (useSeparatedDiffs) {
            const highlightCurrent = previousContent === message.content;

            if (highlightCurrent) {
                if (aggregatedState) {
                    applyAggregatedCustomContent(message, aggregatedState.key, aggregatedState.aggregatedNodes);
                } else {
                    const diffKey = `${message.id}:current:${message.content}:${message.editedTimestamp?.valueOf?.() ?? 0}`;
                    applyAggregatedCustomContent(message, diffKey, renderDiffParts(updatedSegments, message));
                }
            } else if (!aggregatedState && (message as any).customRenderedContent?.__messageloggerDiff) {
                clearCustomRenderedContent(message);
            }

            return (
                <div className="messagelogger-diff-view" >
                    {originalSegments.length ? (
                        <div className="messagelogger-diff-original">
                            {renderDiffParts(originalSegments, message)}
                        </div>
                    ) : null}
                    {!highlightCurrent && updatedSegments.length ? (
                        <div className="messagelogger-diff-updated">
                            {renderDiffParts(updatedSegments, message)}
                        </div>
                    ) : null}
                </div>
            );
        }

        if (!aggregatedState && (message as any).customRenderedContent?.__messageloggerDiff) {
            clearCustomRenderedContent(message);
        }

        return renderDiffParts(diffParts, message);
    }

    if (!aggregatedState && (message as any).customRenderedContent?.__messageloggerDiff) {
        clearCustomRenderedContent(message);
    }

    return Parser.parse(content, true, {
        channelId: message.channel_id,
        messageId: message.id,
        allowLinks: true,
        allowHeading: true,
        allowList: true,
        allowEmojiLinks: true,
        viewingChannelId: SelectedChannelStore.getChannelId(),
    });
}

export const settings = definePluginSettings({
    deleteStyle: {
        type: OptionType.SELECT,
        description: "Style des messages supprimés",
        default: "text",
        options: [
            { label: "Red text", value: "text", default: true },
            { label: "Red overlay", value: "overlay" },
        ],
        onChange: () => addDeleteStyle(),
    },
    logDeletes: {
        type: OptionType.BOOLEAN,
        description: "Journaliser les messages supprimés",
        default: true,
    },
    collapseDeleted: {
        type: OptionType.BOOLEAN,
        description: "Réduire les messages supprimés comme les messages bloqués",
        default: false,
        restartNeeded: true,
    },
    logEdits: {
        type: OptionType.BOOLEAN,
        description: "Journaliser les messages édités",
        default: true,
    },
    inlineEdits: {
        type: OptionType.BOOLEAN,
        description: "Afficher l'historique d'édition dans le contenu du message",
        default: true,
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Ignorer les messages des bots",
        default: false,
    },
    ignoreSelf: {
        type: OptionType.BOOLEAN,
        description: "Ignorer vos propres messages",
        default: false,
    },
    ignoreSelfEdits: {
        type: OptionType.BOOLEAN,
        description: "Ignorer vos propres éditions",
        default: false,
    },
    ignoreUsers: {
        type: OptionType.STRING,
        description: "Liste d'IDs utilisateurs à ignorer (séparés par des virgules)",
        default: "",
        multiline: true,
    },
    ignoreChannels: {
        type: OptionType.STRING,
        description: "Liste d'IDs salons à ignorer (séparés par des virgules)",
        default: "",
        multiline: true,
    },
    ignoreGuilds: {
        type: OptionType.STRING,
        description: "Liste d'IDs serveurs à ignorer (séparés par des virgules)",
        default: "",
        multiline: true,
    },
    showEditDiffs: {
        type: OptionType.BOOLEAN,
        description: "Afficher les différences visuelles entre les versions éditées",
        default: false,
        onChange: value => {
            if (!value && settings.store.separatedDiffs) {
                settings.store.separatedDiffs = false;
            }
        },
    },
    separatedDiffs: {
        type: OptionType.BOOLEAN,
        description: "Séparer les ajouts et suppressions dans les diffs pour une lecture plus claire",
        default: false,
    },
}, {
    separatedDiffs: {
        disabled() {
            return !this.store.showEditDiffs;
        },
    },
    ignoreSelfEdits: {
        disabled() {
            return this.store.ignoreSelf;
        },
    },
});

export default definePlugin({
    name: "MessageLoggerBhopcord",
    description: "Logs les messages supprimés/édités avec cache indépendant.",
    tags: ["Chat", "Utility", "Bhopcord"],
    authors: [{ name: "Bhopcord", id: 0n }],
    dependencies: ["MessageUpdaterAPI"],
    settings,

    contextMenus: {
        message: patchMessageContextMenu,
        "channel-context": patchChannelContextMenu,
        "thread-context": patchChannelContextMenu,
        "user-context": patchChannelContextMenu,
        "gdm-context": patchChannelContextMenu,
    },

    flux: {
        MESSAGE_CREATE({ message }: { message: any; }) {
            if (!message?.id || !message?.channel_id) return;
            if (message.author?.bot) return;

            const key = storeKey(message.channel_id, message.id);

            if (message.nonce) {
                const nonce = String(message.nonce);
                const existing = nonceIndex.get(nonce);

                if (existing) {
                    const [existingChan] = existing.split(":");
                    if (existingChan === message.channel_id) {
                        return;
                    }
                }

                const channel = ChannelStore.getChannel(message.channel_id);
                if (channel?.type === 1 || channel?.type === 3) {
                    nonceIndex.set(nonce, key);
                }
            }

            messageCache.set(key, {
                content: message.content ?? "",
                authorId: message.author?.id ?? "",
                authorName: message.author?.username ?? message.author?.globalName ?? "",
                timestamp: message.timestamp,
            });
        },
    },

    start() {
        addDeleteStyle();
    },

    renderEdits: ErrorBoundary.wrap(
        ({
            message: { id: messageId, channel_id: channelId },
        }: {
            message: Message;
        }) => {
            const message = useStateFromStores(
                [MessageStore],
                () => MessageStore.getMessage(channelId, messageId) as MLMessage,
                null,
                (oldMsg, newMsg) =>
                    oldMsg?.editHistory === newMsg?.editHistory &&
                    oldMsg?.diffViewDisabled === newMsg?.diffViewDisabled &&
                    oldMsg?.content === newMsg?.content &&
                    (oldMsg?.editedTimestamp?.valueOf?.() ?? 0) === (newMsg?.editedTimestamp?.valueOf?.() ?? 0),
            );

            const { showEditDiffs, inlineEdits, separatedDiffs } = settings.use(["showEditDiffs", "inlineEdits", "separatedDiffs"]);
            const history = message.editHistory ?? [];
            const useAggregatedDiff = inlineEdits && showEditDiffs && separatedDiffs && history.length > 0;

            if (useAggregatedDiff) {
                const original = history[0];
                const diffKey = `${message.id}:${history.length}:${message.content}:${message.editedTimestamp?.valueOf?.() ?? 0}`;
                let aggregatedState = (message as any).__messageloggerAggregated as undefined | {
                    key: string;
                    originalNodes: React.ReactNode;
                    aggregatedNodes: React.ReactNode;
                    originalTimestamp: Date;
                };

                if (!aggregatedState || aggregatedState.key !== diffKey) {
                    const aggregatedDiff = createMessageDiff(original.content, message.content);
                    const originalSegments = buildViewSegments(aggregatedDiff, "original");
                    const aggregatedSegments = buildViewSegments(aggregatedDiff, "updated");
                    const originalNodes = originalSegments.length
                        ? renderDiffParts(originalSegments, message)
                        : Parser.parse(original.content, true, {
                            channelId: message.channel_id,
                            messageId: message.id,
                            allowLinks: true,
                            allowHeading: true,
                            allowList: true,
                            allowEmojiLinks: true,
                            viewingChannelId: SelectedChannelStore.getChannelId(),
                        });
                    const aggregatedNodes = renderDiffParts(aggregatedSegments, message);

                    aggregatedState = {
                        key: diffKey,
                        originalNodes,
                        aggregatedNodes,
                        originalTimestamp: original.timestamp,
                    };

                    (message as any).__messageloggerAggregated = aggregatedState;
                }

                applyAggregatedCustomContent(message, aggregatedState.key, aggregatedState.aggregatedNodes);

                return (
                    <div key={`diff-aggregated-${messageId}`}>
                        <div className="messagelogger-edited" key="ml-aggregated-original">
                            {aggregatedState.originalNodes}
                            <Timestamp
                                timestamp={aggregatedState.originalTimestamp}
                                isEdited={true}
                                isInline={false}
                            >
                                <span className={MessageClasses.edited}>{" "}({getIntlMessage("MESSAGE_EDITED")})</span>
                            </Timestamp>
                        </div>
                    </div>
                );
            }

            if ((message as any).__messageloggerAggregated) {
                delete (message as any).__messageloggerAggregated;
            }

            if ((message as any).customRenderedContent?.__messageloggerDiff) {
                clearCustomRenderedContent(message);
            }

            return inlineEdits && (
                <div key={disabledDiffMessages.has(messageId) ? `diff-off-${messageId}` : `diff-on-${messageId}`}>
                    {history.map((edit, idx) => {
                        const nextContent = idx === history.length - 1
                            ? message.content
                            : history[idx + 1]?.content;

                        return (
                            <div key={idx} className="messagelogger-edited">
                                {parseEditContent(edit.content, message, nextContent)}
                                <Timestamp
                                    timestamp={edit.timestamp}
                                    isEdited={true}
                                    isInline={false}
                                >
                                    <span className={MessageClasses.edited}>{" "}({getIntlMessage("MESSAGE_EDITED")})</span>
                                </Timestamp>
                            </div>
                        );
                    })}
                </div>
            );
        }, { noop: true }),

    renderDeletedContent: ErrorBoundary.wrap(
        ({ message: { id: messageId, channel_id: channelId } }: { message: Message }) => {
            const stored = getStoredDeletedMessage(channelId, messageId);
            if (!stored) return null;

            return (
                <div className="messagelogger-deleted-content">
                    {stored.authorName && (
                        <span className="messagelogger-deleted-author">{stored.authorName}: </span>
                    )}
                    {Parser.parse(stored.content, true, {
                        channelId,
                        messageId,
                        allowLinks: true,
                        allowHeading: true,
                        allowList: true,
                        allowEmojiLinks: true,
                        viewingChannelId: SelectedChannelStore.getChannelId(),
                    })}
                </div>
            );
        }, { noop: true },
    ),

    makeEdit(newMessage: any, oldMessage: any): any {
        return {
            timestamp: new Date(newMessage.edited_timestamp),
            content: oldMessage.content,
        };
    },

    handleDelete(
        cache: any,
        data: { ids: string[]; id: string; mlDeleted?: boolean; fromClearHistory?: boolean; },
        isBulk: boolean,
    ) {
        try {
            if (cache == null || (!isBulk && !cache.has(data.id))) return cache;

            const mutate = (id: string) => {
                const msg = cache.get(id);
                if (!msg) return;

                if (msg.deleted && !data.fromClearHistory) return;

                if (data.fromClearHistory) {
                    deletedContentStore.delete(storeKey(msg.channel_id, id));
                    cache = cache.remove(id);
                    return;
                }

                const EPHEMERAL = 64;
                const shouldIgnore = (msg.flags & EPHEMERAL) === EPHEMERAL || this.shouldIgnore(msg);

                const cached = messageCache.get(storeKey(msg.channel_id, id));
                const restoredContent = cached?.content ?? msg.editHistory?.[0]?.content ?? msg.content;

                deletedContentStore.set(storeKey(msg.channel_id, id), {
                    content: restoredContent,
                    authorId: cached?.authorId ?? msg.author?.id ?? "",
                    authorName: cached?.authorName ?? msg.author?.username ?? msg.author?.globalName ?? "",
                    timestamp: cached?.timestamp ?? msg.timestamp,
                });

                if (shouldIgnore) {
                    cache = cache.remove(id);
                    return;
                }

                cache = cache.update(id, m =>
                    m.set("deleted", true)
                     .set("attachments", m.attachments.map(a => ((a.deleted = true), a))),
                );
            };

            if (isBulk) {
                data.ids.forEach(mutate);
            } else {
                mutate(data.id);
            }
        } catch (e) {
            new Logger("MessageLoggerBhopcord").error("Error during handleDelete", e);
        }
        return cache;
    },

    shouldIgnore(message: any, isEdit = false) {
        try {
            const {
                ignoreBots,
                ignoreSelf,
                ignoreSelfEdits,
                ignoreUsers,
                ignoreChannels,
                ignoreGuilds,
                logEdits,
                logDeletes,
            } = settings.store;
            const myId = UserStore.getCurrentUser().id;

            return (
                (ignoreBots && message.author?.bot) ||
                (ignoreSelf && message.author?.id === myId) ||
                (ignoreSelfEdits && isEdit && message.author?.id === myId) ||
                ignoreUsers.includes(message.author?.id) ||
                ignoreChannels.includes(message.channel_id) ||
                ignoreChannels.includes(
                    ChannelStore.getChannel(message.channel_id)?.parent_id,
                ) ||
                (isEdit ? !logEdits : !logDeletes) ||
                ignoreGuilds.includes(ChannelStore.getChannel(message.channel_id)?.guild_id));
        } catch (e) {
            return false;
        }
    },

    EditMarker({ message, className, children, ...props }: any) {
        return (
            <span
                {...props}
                className={classes("messagelogger-edit-marker", className)}
                onClick={() => openHistoryModal(message)}
                role="button"
            >
                {children}
            </span>
        );
    },

    DELETED_MESSAGE_COUNT: () => ({
        ast: [[
            6,
            "count",
            {
                "=0": ["No deleted messages"],
                one: [
                    [
                        1,
                        "count"
                    ],
                    " deleted message"
                ],
                other: [
                    [
                        1,
                        "count"
                    ],
                    " deleted messages"
                ]
            },
            0,
            "cardinal"
        ]]
    }),

    patches: [
        {
            find: '"MessageStore"',
            replacement: [
                {
                    match: /(?<=MESSAGE_DELETE:function\((\i)\)\{)(?=let.{0,100}(\i\.\i)\.getOrCreate)/,
                    replace: `
                        let cache = $2.getOrCreate($1.channelId);
                        cache = $self.handleDelete(cache, $1, false);
                        $2.commit(cache);
                        MessageStore.emitChange();
                        return;
                    `
                },
                {
                    match: /(?<=MESSAGE_DELETE_BULK:function\((\i)\){)(?=let.{0,100}(\i\.\i)\.getOrCreate)/,
                    replace: `
                        let cache = $2.getOrCreate($1.channelId);
                        cache = $self.handleDelete(cache, $1, true);
                        $2.commit(cache);
                        MessageStore.emitChange();
                        return;
                    `
                },
                {
                    match: /(MESSAGE_UPDATE:function\((\i)\).+?)\.update\((\i)/,
                    replace: `
                        $1
                        .update($3, m =>
                            (($2.message.flags & 64) === 64 || $self.shouldIgnore($2.message, true)) ? m :
                            $2.message.edited_timestamp && $2.message.content !== m.content ?
                                m.set('editHistory',[...(m.editHistory || []), $self.makeEdit($2.message, m)]) :
                                m
                        )
                        .update($3
                    `
                },
                {
                    match: /(?<=getLastEditableMessage\(\i\)\{.{0,200}\.find\((\i)=>)/,
                    replace: "!$1.deleted &&",
                },
            ],
        },

        {
            find: "}addReaction(",
            replacement: [
                {
                    match: /this\.customRenderedContent=(\i)\.customRenderedContent,/,
                    replace:
                        "this.customRenderedContent = $1.customRenderedContent," +
                        "this.deleted = $1.deleted || false," +
                        "this.editHistory = $1.editHistory || []," +
                        "this.firstEditTimestamp = $1.firstEditTimestamp || this.editedTimestamp || this.timestamp," +
                        "this.diffViewDisabled = $1.diffViewDisabled || false,",
                },
            ],
        },

        {
            find: ".PREMIUM_REFERRAL&&(",
            replacement: [
                {
                    match:
                        /(?<=null!=\i\.edited_timestamp\)return )\i\(\i,\{reactions:(\i)\.reactions.{0,50}\}\)/,
                    replace:
                        "Object.assign($&,{ deleted:$1.deleted, editHistory:$1.editHistory, firstEditTimestamp:$1.firstEditTimestamp, diffViewDisabled:$1.diffViewDisabled })",
                },

                {
                    match: /attachments:(\i)\((\i)\)/,
                    replace:
                        "attachments: $1((() => {" +
                        "   if ($self.shouldIgnore($2)) return $2;" +
                        "   let old = arguments[1]?.attachments;" +
                        "   if (!old) return $2;" +
                        "   let new_ = $2.attachments?.map(a => a.id) ?? [];" +
                        "   let diff = old.filter(a => !new_.includes(a.id));" +
                        "   old.forEach(a => a.deleted = true);" +
                        "   $2.attachments = [...diff, ...$2.attachments];" +
                        "   return $2;" +
                        "})())," +
                        "deleted: arguments[1]?.deleted," +
                        "editHistory: arguments[1]?.editHistory," +
                        "firstEditTimestamp: new Date(arguments[1]?.firstEditTimestamp ?? $2.editedTimestamp ?? $2.timestamp)," +
"diffViewDisabled: arguments[1]?.diffViewDisabled,",
                },
                {
                    match: /(\((\i)\){return null==\2\.attachments.+?)spoiler:/,
                    replace: "$1deleted: arguments[0]?.deleted," + "spoiler:",
                },
            ],
        },

        {
            find: "#{intl::REMOVE_ATTACHMENT_TOOLTIP_TEXT}",
            replacement: [
                {
                    match: /\.SPOILER,(?=\[\i\.\i\]:)/,
                    replace: '$&"messagelogger-deleted-attachment":arguments[0]?.item?.originalItem?.deleted,'
                }
            ]
        },

        {
            find: "Message must not be a thread starter message",
            replacement: [
                {
                    match: /\)\("li",\{(.+?),className:/,
                    replace:
                        ')("li",{$1,className:(arguments[0].message.deleted ? "messagelogger-deleted " : "")+',
                },
            ],
        },

        {
            find: ".SEND_FAILED,",
            replacement: {
                match: /\]:\i.isUnsupported.{0,20}?,children:\[/,
                replace: "$&arguments[0]?.message?.editHistory?.length>0&&$self.renderEdits(arguments[0])," +
                         "$self.renderDeletedContent(arguments[0]),"
            }
        },

        {
            find: "#{intl::MESSAGE_EDITED}",
            replacement: {
                match: /(isInline:!1,children:.{0,50}?)"span",\{(?=className:)/,
                replace: "$1$self.EditMarker,{message:arguments[0].message,"
            }
        },

        {
            find: '"ReferencedMessageStore"',
            replacement: [
                {
                    match: /(?<=MESSAGE_DELETE:function\(\i\)\{)/,
                    replace: "return;"
                },
                {
                    match: /(?<=MESSAGE_DELETE_BULK:function\(\i\)\{)/,
                    replace: "return;"
                }
            ]
        },

        {
            find: ".MESSAGE,commandTargetId:",
            replacement: [
                {
                    match: /children:(\[""===.+?\])/,
                    replace: "children:arguments[0].message.deleted?[]:$1",
                },
            ],
        },
        {
            find: "NON_COLLAPSIBLE.has(",
            replacement: {
                match: /if\((\i)\.blocked\)return \i\.\i\.MESSAGE_GROUP_BLOCKED;/,
                replace: '$&else if($1.deleted) return"MESSAGE_GROUP_DELETED";',
            },
            predicate: () => settings.store.collapseDeleted,
        },
        {
            find: "#{intl::NEW_MESSAGES_ESTIMATED_WITH_DATE}",
            replacement: [
                {
                    match: /(\i).type===\i\.\i\.MESSAGE_GROUP_BLOCKED\|\|/,
                    replace: '$&$1.type==="MESSAGE_GROUP_DELETED"||',
                },
                {
                    match: /(\i).type===\i\.\i\.MESSAGE_GROUP_BLOCKED\?(\i)=.*?:/,
                    replace: '$&$1.type==="MESSAGE_GROUP_DELETED"?$2=$self.DELETED_MESSAGE_COUNT:',
                },
            ],
            predicate: () => settings.store.collapseDeleted,
        },
    ],
});
