import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

/**
 * The protocol version this flaneur speaks; the extension must speak the same one. Raise it with every change to the
 * messages below. The `hello` messages never change shape, so a mismatch is always told apart from garbage.
 */
export const OWN_CHROME_PROTOCOL_VERSION = 1;

/**
 * A tab the extension shows flaneur: one in the scope the user chose. Flaneur names a tab only by its CDP `targetId`
 * (from `chrome.debugger.getTargets()`); the extension maps it to its `tabId` itself.
 */
export interface OwnChromeTab {
    targetId: string;
    url: string;
    title: string;
    /** The `targetId` of the tab that opened this one (a popup); none when the opener is unknown or out of scope. */
    openerId?: string;
}

/** The first message flaneur sends; the extension answers with its own `hello` before anything else. */
export interface OwnChromeHello {
    type: 'hello';
    version: number;
}

/** The extension's answer to `hello`. */
export interface OwnChromeHelloReply {
    type: 'hello';
    version: number;
    /** The browser's `navigator.userAgent`, reported by `Browser.getVersion`. */
    userAgent: string;
}

/** Opens a tab in the agent window, which the extension creates on demand, unfocused. Result: `OwnChromeTabResult`. */
export interface OwnChromeTabsCreate {
    type: 'tabs.create';
    id: number;
    /** None: a blank tab. */
    url?: string;
}

/** Lists every tab in scope. Result: `OwnChromeTabListResult`. */
export interface OwnChromeTabsList {
    type: 'tabs.list';
    id: number;
}

/** Closes a tab. Result: `{}`. */
export interface OwnChromeTabsClose {
    type: 'tabs.close';
    id: number;
    targetId: string;
}

/** Brings the tab's window to the front and activates the tab. Result: `{}`. */
export interface OwnChromeTabsActivate {
    type: 'tabs.activate';
    id: number;
    targetId: string;
}

/** Attaches `chrome.debugger` (protocol 1.3) to a tab. Result: `{}`. */
export interface OwnChromeDebuggerAttach {
    type: 'debugger.attach';
    id: number;
    targetId: string;
}

/** Detaches `chrome.debugger` from a tab; it reports no `debugger.detached` for it. Result: `{}`. */
export interface OwnChromeDebuggerDetach {
    type: 'debugger.detach';
    id: number;
    targetId: string;
}

/** Sends a CDP command on a tab's attachment. Result: the command's CDP result. */
export interface OwnChromeDebuggerSend {
    type: 'debugger.send';
    id: number;
    targetId: string;
    /** A child session auto-attached under the tab (an iframe, a worker); none: the tab itself. */
    sessionId?: string;
    method: string;
    params: object;
}

/** What flaneur may ask of the extension; the extension executes nothing else. */
export type OwnChromeRequest =
    | OwnChromeTabsCreate
    | OwnChromeTabsList
    | OwnChromeTabsClose
    | OwnChromeTabsActivate
    | OwnChromeDebuggerAttach
    | OwnChromeDebuggerDetach
    | OwnChromeDebuggerSend;

/** Every message flaneur sends. */
export type OwnChromeFlaneurMessage = OwnChromeHello | OwnChromeRequest;

/** The result of `tabs.create`. */
export interface OwnChromeTabResult {
    tab: OwnChromeTab;
}

/** The result of `tabs.list`. */
export interface OwnChromeTabListResult {
    tabs: OwnChromeTab[];
}

/** A request done; `result` is the request's own. */
export interface OwnChromeReply {
    type: 'reply';
    id: number;
    result: unknown;
}

/** A request failed; for `debugger.send` a CDP error keeps its `code`. */
export interface OwnChromeErrorReply {
    type: 'error';
    id: number;
    message: string;
    code?: number;
}

/** A tab came into scope: opened, or opened by a tab in scope. */
export interface OwnChromeTabCreated {
    type: 'tab.created';
    tab: OwnChromeTab;
}

/** A tab's URL or title changed. */
export interface OwnChromeTabUpdated {
    type: 'tab.updated';
    tab: OwnChromeTab;
}

/** A tab was closed or left scope. */
export interface OwnChromeTabRemoved {
    type: 'tab.removed';
    targetId: string;
}

/** A CDP event of a tab's attachment. */
export interface OwnChromeDebuggerEvent {
    type: 'debugger.event';
    targetId: string;
    /** The child session the event came from; none: the tab itself. */
    sessionId?: string;
    method: string;
    params: unknown;
}

/**
 * Chrome ended a tab's attachment flaneur did not detach: the tab closed, or the user pressed "Cancel" on the
 * debugging bar.
 */
export interface OwnChromeDebuggerDetached {
    type: 'debugger.detached';
    targetId: string;
    /** `chrome.debugger.onDetach`'s reason. */
    reason: string;
}

/** Every message the extension sends. */
export type OwnChromeExtensionMessage =
    | OwnChromeHelloReply
    | OwnChromeReply
    | OwnChromeErrorReply
    | OwnChromeTabCreated
    | OwnChromeTabUpdated
    | OwnChromeTabRemoved
    | OwnChromeDebuggerEvent
    | OwnChromeDebuggerDetached;

/**
 * Reads a message of the extension, which comes from another process: `null` when it is not one of
 * `OwnChromeExtensionMessage`.
 * @__NO_SIDE_EFFECTS__
 */
export function readOwnChromeMessage(value: unknown): OwnChromeExtensionMessage | null {
    if (!isPlainObject(value)) {
        return null;
    }
    const { type, id, targetId } = value;
    switch (type) {
        case 'hello': {
            const { version, userAgent } = value;
            return typeof version === 'number' && typeof userAgent === 'string' ? { type, version, userAgent } : null;
        }
        case 'reply':
            return typeof id === 'number' ? { type, id, result: value['result'] } : null;
        case 'error': {
            const { message, code } = value;
            if (typeof id !== 'number' || typeof message !== 'string' || (code != null && typeof code !== 'number')) {
                return null;
            }
            return code == null ? { type, id, message } : { type, id, message, code };
        }
        case 'tab.created':
        case 'tab.updated': {
            const tab = readOwnChromeTab(value['tab']);
            return tab ? { type, tab } : null;
        }
        case 'tab.removed':
            return typeof targetId === 'string' ? { type, targetId } : null;
        case 'debugger.event': {
            const { sessionId, method } = value;
            if (typeof targetId !== 'string' || typeof method !== 'string') {
                return null;
            }
            if (sessionId != null && typeof sessionId !== 'string') {
                return null;
            }
            const event: OwnChromeDebuggerEvent = { type, targetId, method, params: value['params'] };
            return sessionId == null ? event : { ...event, sessionId };
        }
        case 'debugger.detached': {
            const { reason } = value;
            return typeof targetId === 'string' && typeof reason === 'string' ? { type, targetId, reason } : null;
        }
        default:
            return null;
    }
}

/**
 * Reads an `OwnChromeTab` the extension sent; `null` when it is malformed.
 * @__NO_SIDE_EFFECTS__
 */
export function readOwnChromeTab(value: unknown): OwnChromeTab | null {
    if (!isPlainObject(value)) {
        return null;
    }
    const { targetId, url, title, openerId } = value;
    if (typeof targetId !== 'string' || typeof url !== 'string' || typeof title !== 'string') {
        return null;
    }
    if (openerId != null && typeof openerId !== 'string') {
        return null;
    }
    return openerId == null ? { targetId, url, title } : { targetId, url, title, openerId };
}
