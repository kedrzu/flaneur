import { assert } from '@nzyme/utils/assert.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

import { CdpError } from './CdpTypes.js';
import { readFrameTree } from './readFrameTree.js';

/**
 * The isolated world every client's evaluation, resolved node and init script lands in unless the client names a world
 * it created itself, so page scripts never observe it. Pages never see world names; an ordinary one keeps it unremarkable anyway.
 */
export const ISOLATED_WORLD_NAME = 'utility';

/**
 * An isolated world in one frame, by what it is created again with: one a client created with
 * `Page.createIsolatedWorld`, as it asked for it, or the proxy's own (`ISOLATED_WORLD_NAME`).
 */
export interface ClientWorld {
    frameId: string;
    /** Never empty: an unnamed world is a new one on every call, so it could not be created again by name. */
    worldName: string;
    /** Chrome's own spelling. */
    grantUniveralAccess: boolean;
}

/**
 * A call to run in an isolated world. With `world`, in that world, created again; else in the proxy's world:
 * `DOM.resolveNode` in the world of the node's own frame, anything else in the world of the session's main frame.
 */
export interface IsolatedCall {
    method: string;
    /** The call's parameters, with no execution context named. */
    params: Record<string, unknown>;
    sessionId: string;
    /** The parameter naming the execution context: `contextId` for `Runtime.evaluate`, else `executionContextId`. */
    contextParam: 'contextId' | 'executionContextId';
    /** The world the call named by a context id the client was given (`ExecutionContexts.find`). */
    world?: ClientWorld;
}

/** A client's `Page.addScriptToEvaluateOnNewDocument`, its world already named (`ISOLATED_WORLD_NAME` by default). */
export interface InitScript {
    sessionId: string;
    /** The call's parameters. */
    params: Record<string, unknown>;
    worldName: string;
}

/** Where `openIsolatedWorld` opens a world, and how it reaches the browser. */
export interface OpenIsolatedWorldParams {
    sendCommand: (method: string, params?: object, sessionId?: string) => Promise<unknown>;
    sessionId: string;
    world: ClientWorld;
}

/** The proxy's isolated worlds as one client uses them. */
export interface IsolatedWorlds {
    /**
     * Sends `call` with its context set to its world (`IsolatedCall`) in its frame, created (or, for the current
     * document, found) first. A navigation between the two invalidates the context; the call is then resolved again
     * and retried once.
     */
    send(call: IsolatedCall): Promise<unknown>;
    /**
     * Registers a client's init script, after the proxy's own prelude (`WORLD_PRELUDE`) for its world on its session,
     * registered once and run at once in the current documents too: Chrome runs the init scripts of a new document in
     * the order they were added, so the prelude runs before every script of a client.
     */
    addInitScript(script: InitScript): Promise<unknown>;
    /** Forgets a detached session. */
    forget(sessionId: string): void;
}

/** The browser's errors for a context or frame that went away with a navigation. */
const GONE_ERRORS = ['Cannot find context with specified id', 'No frame for given id found'];

/** The CDP error code of a method the target does not have: a worker has no Page domain. */
const METHOD_NOT_FOUND = -32_601;

/**
 * Run in every isolated world before any code of a client: Playwright's injected script dispatches DOM events of its
 * own (`__playwright_mark_target__` on an action's target, `__playwright_reset_targets__` on the document,
 * `__playwright_global_listeners_check__` on the window), and an event dispatched from an isolated world travels the
 * shared DOM to the page's own listeners, which anti-bot scripts use to tell Playwright apart. The world's own
 * `EventTarget.prototype.dispatchEvent` is wrapped so an event whose type starts with one of Playwright's internal
 * prefixes (`__playwright`, `__pw`) is not dispatched and reports `true`, as a non-cancelled event does; every other
 * event, `page.dispatchEvent` included, is a client's deliberate request and goes out unchanged. The wrapper lives in
 * the world's own prototypes, which the page never sees. Running it again changes nothing.
 */
export const WORLD_PRELUDE = `(() => {
    const proto = EventTarget.prototype;
    const dispatch = proto.dispatchEvent;
    const marker = Symbol.for('flaneur.worldPrelude');
    if (dispatch[marker] === true) {
        return;
    }
    const readType = Object.getOwnPropertyDescriptor(Event.prototype, 'type').get;
    const startsWith = String.prototype.startsWith;
    const wrapped = {
        dispatchEvent(event) {
            let type;
            try {
                type = Reflect.apply(readType, event, []);
            } catch {
                return Reflect.apply(dispatch, this, arguments);
            }
            if (Reflect.apply(startsWith, type, ['__playwright']) || Reflect.apply(startsWith, type, ['__pw'])) {
                return true;
            }
            return Reflect.apply(dispatch, this, arguments);
        },
    }.dispatchEvent;
    Object.defineProperty(wrapped, marker, { value: true });
    Object.defineProperty(proto, 'dispatchEvent', { ...Object.getOwnPropertyDescriptor(proto, 'dispatchEvent'), value: wrapped });
})()`;

/** Run on a node resolved in a frame's world: whether the node belongs to that frame's document. */
const IS_OWN_DOCUMENT = 'function () { return (this.ownerDocument ?? this) === document; }';

/** A node resolved in the world of one frame. */
interface Resolution {
    /** The browser's `DOM.resolveNode` reply. */
    reply: unknown;
    /** The resolved object; none when the frame's world cannot reach the node (a cross-origin frame's). */
    objectId?: string;
    /** Whether the node belongs to the frame's own document, so its world is the node's. */
    isOwn: boolean;
}

/**
 * Creates the isolated-world access of one client. Context ids are never cached, nor forwarded from the client:
 * Chrome reuses them across renderer processes, so after a cross-site navigation a remembered id can name the page's
 * own world. Each call asks `Page.createIsolatedWorld` again, which returns the existing world for the current
 * document; the ids a client is given are the proxy's own (`createExecutionContexts`) and only look up which world to
 * ask for.
 * @__NO_SIDE_EFFECTS__
 */
export function createIsolatedWorlds(
    sendCommand: (method: string, params?: object, sessionId?: string) => Promise<unknown>,
): IsolatedWorlds {
    /** The prelude's registration on a session for a world, by session and world name (a line apart). */
    const preludes = new Map<string, Promise<unknown>>();

    return { send, addInitScript, forget };

    async function addInitScript({ sessionId, params, worldName }: InitScript) {
        const key = `${sessionId}\n${worldName}`;
        let prelude = preludes.get(key);
        if (prelude == null) {
            prelude = sendCommand(
                'Page.addScriptToEvaluateOnNewDocument',
                { source: WORLD_PRELUDE, worldName, runImmediately: true },
                sessionId,
            );
            preludes.set(key, prelude);
        }
        try {
            await prelude;
        } catch (error) {
            preludes.delete(key);
            throw error;
        }
        return sendCommand('Page.addScriptToEvaluateOnNewDocument', { ...params, worldName }, sessionId);
    }

    function forget(sessionId: string) {
        for (const key of preludes.keys()) {
            if (key.startsWith(`${sessionId}\n`)) {
                preludes.delete(key);
            }
        }
    }

    async function send(call: IsolatedCall) {
        try {
            return await sendOnce(call);
        } catch (error) {
            if (!(error instanceof CdpError) || !GONE_ERRORS.some(message => error.message.includes(message))) {
                throw error;
            }
            return sendOnce(call);
        }
    }

    async function sendOnce(call: IsolatedCall) {
        if (call.world != null) {
            return sendInWorld(call, call.world);
        }
        const frames = await readFrames(call.sessionId);
        const [mainFrame] = frames;
        if (mainFrame == null) {
            throw new TypeError('Page.getFrameTree gave no main frame');
        }
        return call.method === 'DOM.resolveNode' ? resolveNode(call, frames) : sendInFrame(call, mainFrame);
    }

    /**
     * Resolves a node in the world of its own frame. A frame's world resolves a node of a same-origin frame too, but
     * with that frame's globals, and cannot reach a node of a cross-origin frame in the same process; so the main
     * frame's world is tried first, then every other frame's, until one owns the node. With none, the first object
     * resolved is kept.
     */
    async function resolveNode(call: IsolatedCall, frames: string[]) {
        const [mainFrame, ...otherFrames] = frames;
        assert(mainFrame != null);
        const main = await resolveInFrame(call, mainFrame);
        if (main.isOwn) {
            return main.reply;
        }
        let kept = main;
        for (const frameId of otherFrames) {
            let next: Resolution;
            try {
                next = await resolveInFrame(call, frameId);
            } catch (error) {
                // A frame that went away, or lives in another process, does not hold the node.
                if (error instanceof CdpError) {
                    continue;
                }
                throw error;
            }
            if (next.isOwn) {
                await releaseObject(call.sessionId, kept.objectId);
                return next.reply;
            }
            if (kept.objectId == null) {
                kept = next;
            } else {
                await releaseObject(call.sessionId, next.objectId);
            }
        }
        return kept.reply;
    }

    async function resolveInFrame(call: IsolatedCall, frameId: string): Promise<Resolution> {
        const reply = await sendInFrame(call, frameId);
        const object = isPlainObject(reply) ? reply['object'] : undefined;
        const objectId = isPlainObject(object) ? object['objectId'] : undefined;
        if (typeof objectId !== 'string') {
            return { reply, isOwn: false };
        }
        const checked = await sendCommand(
            'Runtime.callFunctionOn',
            { objectId, functionDeclaration: IS_OWN_DOCUMENT, returnByValue: true },
            call.sessionId,
        );
        const result = isPlainObject(checked) ? checked['result'] : undefined;
        return { reply, objectId, isOwn: isPlainObject(result) && result['value'] === true };
    }

    function sendInFrame(call: IsolatedCall, frameId: string) {
        return sendInWorld(call, { frameId, worldName: ISOLATED_WORLD_NAME, grantUniveralAccess: false });
    }

    async function sendInWorld(call: IsolatedCall, world: ClientWorld) {
        const { method, params, sessionId, contextParam } = call;
        const contextId = await openIsolatedWorld({ sendCommand, sessionId, world });
        return sendCommand(method, { ...params, [contextParam]: contextId }, sessionId);
    }

    async function releaseObject(sessionId: string, objectId: string | undefined) {
        if (objectId != null) {
            await sendCommand('Runtime.releaseObject', { objectId }, sessionId);
        }
    }

    /** The ids of the session's frames, the main frame first. */
    async function readFrames(sessionId: string) {
        let reply: unknown;
        try {
            reply = await sendCommand('Page.getFrameTree', {}, sessionId);
        } catch (error) {
            if (error instanceof CdpError && error.code === METHOD_NOT_FOUND) {
                throw new CdpError({ code: error.code, message: 'Code cannot run in a worker' });
            }
            throw error;
        }
        return readFrameTree(reply).map(frame => frame.id);
    }
}

/**
 * Creates an isolated world in the browser, or finds it for the frame's current document, and runs the prelude
 * (`WORLD_PRELUDE`) in it before anything else may: a world created for a document the prelude's init script was not
 * registered for yet has not run it. Returns the browser's context id.
 */
export async function openIsolatedWorld({ sendCommand, sessionId, world }: OpenIsolatedWorldParams): Promise<number> {
    const created = await sendCommand('Page.createIsolatedWorld', { ...world }, sessionId);
    const contextId = isPlainObject(created) ? created['executionContextId'] : undefined;
    if (typeof contextId !== 'number') {
        throw new TypeError('Page.createIsolatedWorld gave no context id');
    }
    const prelude = await sendCommand('Runtime.evaluate', { expression: WORLD_PRELUDE, contextId }, sessionId);
    if (isPlainObject(prelude) && prelude['exceptionDetails'] != null) {
        throw new Error('The isolated world prelude failed');
    }
    return contextId;
}
