import { isPlainObject } from '@nzyme/utils/isPlainObject.js';
import type { OwnChromeDebuggerSend, OwnChromeFlaneurMessage, OwnChromeHello } from 'flaneur';

/** A `debugger.send` whose params were checked to be the plain object `chrome.debugger.sendCommand` takes. */
export interface CheckedDebuggerSend extends OwnChromeDebuggerSend {
    params: Record<string, unknown>;
}

/** A message from flaneur, checked. */
export type FlaneurMessage = Exclude<OwnChromeFlaneurMessage, OwnChromeDebuggerSend> | CheckedDebuggerSend;

/** A request from flaneur, checked: one of the operations the extension executes. */
export type FlaneurRequest = Exclude<FlaneurMessage, OwnChromeHello>;

/**
 * Reads a message from the native host, which may be any local program: `null` when it is not one of
 * `OwnChromeFlaneurMessage`, which holds the only operations the extension executes.
 * @__NO_SIDE_EFFECTS__
 */
export function readFlaneurMessage(value: unknown): FlaneurMessage | null {
    if (!isPlainObject(value)) {
        return null;
    }
    const { type, id, targetId } = value;
    if (type === 'hello') {
        const { version } = value;
        return typeof version === 'number' ? { type, version } : null;
    }
    if (typeof id !== 'number') {
        return null;
    }
    switch (type) {
        case 'tabs.create': {
            const { url } = value;
            if (url == null) {
                return { type, id };
            }
            return typeof url === 'string' ? { type, id, url } : null;
        }
        case 'tabs.list':
            return { type, id };
        case 'tabs.close':
        case 'tabs.activate':
        case 'debugger.attach':
        case 'debugger.detach':
            return typeof targetId === 'string' ? { type, id, targetId } : null;
        case 'debugger.send': {
            const { sessionId, method, params } = value;
            if (typeof targetId !== 'string' || typeof method !== 'string') {
                return null;
            }
            if (sessionId != null && typeof sessionId !== 'string') {
                return null;
            }
            const checkedParams = params == null ? {} : params;
            if (!isPlainObject(checkedParams)) {
                return null;
            }
            return sessionId == null
                ? { type, id, targetId, method, params: checkedParams }
                : { type, id, targetId, sessionId, method, params: checkedParams };
        }
        default:
            return null;
    }
}
