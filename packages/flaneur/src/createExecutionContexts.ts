import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

import { CdpError } from './CdpTypes.js';
import type { CdpEvent } from './CdpTypes.js';
import { ISOLATED_WORLD_NAME } from './createIsolatedWorlds.js';
import type { ClientWorld } from './createIsolatedWorlds.js';
import { readFrame, readFrameTree } from './readFrameTree.js';

/** What a context id a client was given stands for. */
export type ExecutionContext =
    /** An isolated world of a frame, created again by frame and name for every call. */
    | { type: 'world'; world: ClientWorld }
    /** A worker's, where no code of a client runs. */
    | { type: 'worker' };

/** The execution contexts one client is told about, and the proxy's ids for them. */
export interface ExecutionContexts {
    /**
     * Starts telling the client of the contexts of `sessionId` (its `Runtime.enable`): announces those of the current
     * documents of its frames, or the worker's; returns the reply.
     */
    enable(sessionId: string): Promise<object>;
    /** Stops telling the client of the contexts of `sessionId`; the ids announced there are forgotten. */
    disable(sessionId: string): void;
    /**
     * Creates a client's own world (its `Page.createIsolatedWorld`), announces it when the session is enabled and returns
     * the reply, with an id that names the world, by frame and name, for as long as the session lives.
     */
    createWorld(sessionId: string, world: ClientWorld): Promise<object>;
    /** What a context id the client was given on `sessionId` stands for; none for any other id. */
    find(sessionId: string, contextId: number): ExecutionContext | undefined;
    /**
     * The events the client gets for one event of its own session: the event, with the context events a frame's new
     * document, attach or detach makes, in the order the client must see them.
     */
    translate(event: CdpEvent): CdpEvent[];
    /** Forgets a detached session. */
    forget(sessionId: string): void;
}

/** A context id the client was given. */
interface ContextEntry {
    sessionId: string;
    context: ExecutionContext;
    /** Returned by `Page.createIsolatedWorld`: it outlives the document it was announced for. */
    durable: boolean;
}

/** What the proxy keeps of one session of the client. */
interface SessionContexts {
    /** Between the client's `Runtime.enable` and `Runtime.disable`. */
    enabled: boolean;
    /** The client's own worlds by name, with their `grantUniveralAccess`: announced in every new document. */
    worlds: Map<string, boolean>;
    /** The ids announced for the current document of each frame, by world name (`MAIN_WORLD` for the proxy's). */
    frames: Map<string, Map<string, number>>;
    /** The id `Page.createIsolatedWorld` returned, by frame and world name (a line apart), returned again after. */
    handles: Map<string, number>;
}

/** The key of the main world in `SessionContexts.frames`: a client's world always has a name. */
const MAIN_WORLD = '';

/** The CDP error code of a method the target does not have: a worker has no Page domain. */
const METHOD_NOT_FOUND = -32_601;

/**
 * Creates the execution contexts of one client: Runtime is never enabled in the browser, so the proxy tells a client
 * that enables it of the contexts itself, as Chrome would (`Runtime.executionContextCreated`, `…Destroyed`). A
 * frame's default context ("main" to Playwright) is the proxy's isolated world (`ISOLATED_WORLD_NAME`), and each world
 * the client created is announced in every new document by its name. The ids are the proxy's own, counted per client:
 * Chrome's are never given out, as it reuses them across renderer processes. An announced id lives as long as its
 * document, so a call in a document gone is refused, never run in the next one; an id `Page.createIsolatedWorld`
 * returned names its world by frame and name for as long as the session lives, as agent-browser keeps it.
 * @__NO_SIDE_EFFECTS__
 */
export function createExecutionContexts(
    sendCommand: (method: string, params?: object, sessionId?: string) => Promise<unknown>,
    emit: (event: CdpEvent) => void,
): ExecutionContexts {
    const contexts = new Map<number, ContextEntry>();
    const sessions = new Map<string, SessionContexts>();
    let lastId = 0;

    return {
        enable,
        disable,
        createWorld,
        find: (sessionId, contextId) => {
            const entry = contexts.get(contextId);
            return entry?.sessionId === sessionId ? entry.context : undefined;
        },
        translate,
        forget,
    };

    /**
     * Reads the frame tree only now, so the contexts announced are those of the current documents. A frame a
     * navigation announced meanwhile keeps what it announced.
     */
    async function enable(sessionId: string) {
        const session = getSession(sessionId);
        if (session.enabled) {
            return {};
        }
        session.enabled = true;
        let reply: unknown;
        try {
            reply = await sendCommand('Page.getFrameTree', {}, sessionId);
        } catch (error) {
            if (error instanceof CdpError && error.code === METHOD_NOT_FOUND) {
                announceWorker(sessionId);
                return {};
            }
            session.enabled = false;
            throw error;
        }
        // Disabled or detached while the tree was read.
        if (sessions.get(sessionId) !== session || !session.enabled) {
            return {};
        }
        for (const frame of readFrameTree(reply)) {
            for (const event of announceDocument(sessionId, session, frame.id, frame.securityOrigin)) {
                emit(event);
            }
        }
        return {};
    }

    function disable(sessionId: string) {
        const session = sessions.get(sessionId);
        if (session == null) {
            return;
        }
        session.enabled = false;
        session.frames.clear();
        for (const [id, entry] of contexts) {
            if (entry.sessionId === sessionId && !entry.durable) {
                contexts.delete(id);
            }
        }
    }

    /**
     * The world is created in the browser before it is announced. Asked again for a world it already has an id for, in
     * the frame's current document or from an earlier call, the client gets that id, as Chrome gives the same context
     * for the same world of a document.
     */
    async function createWorld(sessionId: string, world: ClientWorld) {
        const reply = await sendCommand('Page.createIsolatedWorld', { ...world }, sessionId);
        if (!isPlainObject(reply) || typeof reply['executionContextId'] !== 'number') {
            throw new TypeError('Page.createIsolatedWorld gave no context id');
        }
        const { frameId, worldName } = world;
        const session = getSession(sessionId);
        session.worlds.set(worldName, world.grantUniveralAccess);
        const key = `${frameId}\n${worldName}`;
        const announced = session.enabled ? getFrame(session, frameId) : undefined;
        const id = session.handles.get(key) ?? announced?.get(worldName) ?? ++lastId;
        session.handles.set(key, id);
        contexts.set(id, { sessionId, context: { type: 'world', world }, durable: true });
        if (announced != null && !announced.has(worldName)) {
            announced.set(worldName, id);
            // The origin is not known here; Playwright does not read it.
            emit(created({ sessionId, id, frameId, name: worldName, origin: '' }));
        }
        return { executionContextId: id };
    }

    /**
     * A new document destroys the contexts of the old one before its `Page.frameNavigated` and announces its own right
     * after, before any later event of the session; a new frame is announced after its `Page.frameAttached`, a detached
     * one's contexts are destroyed before its `Page.frameDetached`.
     */
    function translate(event: CdpEvent): CdpEvent[] {
        const { sessionId, params } = event;
        const session = sessionId == null ? undefined : sessions.get(sessionId);
        if (sessionId == null || session == null || !session.enabled || !isPlainObject(params)) {
            return [event];
        }
        switch (event.method) {
            case 'Page.frameNavigated': {
                const frame = readFrame(params['frame']);
                return frame == null
                    ? [event]
                    : [
                          ...destroyFrame(sessionId, session, frame.id),
                          event,
                          ...announceDocument(sessionId, session, frame.id, frame.securityOrigin),
                      ];
            }
            case 'Page.frameAttached': {
                const { frameId } = params;
                return typeof frameId === 'string'
                    ? [event, ...announceDocument(sessionId, session, frameId, '')]
                    : [event];
            }
            case 'Page.frameDetached': {
                const { frameId } = params;
                return typeof frameId === 'string' ? [...destroyFrame(sessionId, session, frameId), event] : [event];
            }
            default:
                return [event];
        }
    }

    function forget(sessionId: string) {
        sessions.delete(sessionId);
        for (const [id, entry] of contexts) {
            if (entry.sessionId === sessionId) {
                contexts.delete(id);
            }
        }
    }

    /** Announces the main world and every world of the client in a frame's document, but those announced already. */
    function announceDocument(sessionId: string, session: SessionContexts, frameId: string, origin: string) {
        const announced = getFrame(session, frameId);
        const worlds: [string, ClientWorld][] = [
            [MAIN_WORLD, { frameId, worldName: ISOLATED_WORLD_NAME, grantUniveralAccess: false }],
        ];
        for (const [worldName, grantUniveralAccess] of session.worlds) {
            worlds.push([worldName, { frameId, worldName, grantUniveralAccess }]);
        }
        const events: CdpEvent[] = [];
        for (const [key, world] of worlds) {
            if (announced.has(key)) {
                continue;
            }
            const id = ++lastId;
            announced.set(key, id);
            contexts.set(id, { sessionId, context: { type: 'world', world }, durable: false });
            events.push(created({ sessionId, id, frameId, name: key, origin }));
        }
        return events;
    }

    /** Destroys the contexts announced for a frame's document; an id the client was returned keeps its world. */
    function destroyFrame(sessionId: string, session: SessionContexts, frameId: string) {
        const events: CdpEvent[] = [];
        for (const id of session.frames.get(frameId)?.values() ?? []) {
            if (contexts.get(id)?.durable !== true) {
                contexts.delete(id);
            }
            events.push({
                method: 'Runtime.executionContextDestroyed',
                params: { executionContextId: id },
                sessionId,
            });
        }
        session.frames.delete(frameId);
        return events;
    }

    /** A worker has one context, where every call is refused: no code of a client runs in a worker. */
    function announceWorker(sessionId: string) {
        const id = ++lastId;
        contexts.set(id, { sessionId, context: { type: 'worker' }, durable: false });
        emit({
            method: 'Runtime.executionContextCreated',
            params: {
                context: {
                    id,
                    origin: '',
                    name: '',
                    uniqueId: String(id),
                    auxData: { isDefault: true, type: 'default' },
                },
            },
            sessionId,
        });
    }

    function getSession(sessionId: string) {
        let session = sessions.get(sessionId);
        if (session == null) {
            session = { enabled: false, worlds: new Map(), frames: new Map(), handles: new Map() };
            sessions.set(sessionId, session);
        }
        return session;
    }

    function getFrame(session: SessionContexts, frameId: string) {
        let announced = session.frames.get(frameId);
        if (announced == null) {
            announced = new Map();
            session.frames.set(frameId, announced);
        }
        return announced;
    }
}

/** A context to announce: one of a frame's worlds, its default one when `name` is empty. */
interface CreatedContext {
    sessionId: string;
    id: number;
    frameId: string;
    name: string;
    origin: string;
}

function created({ sessionId, id, frameId, name, origin }: CreatedContext): CdpEvent {
    const isDefault = name === '';
    return {
        method: 'Runtime.executionContextCreated',
        params: {
            context: {
                id,
                origin,
                name,
                uniqueId: String(id),
                auxData: { frameId, isDefault, type: isDefault ? 'default' : 'isolated' },
            },
        },
        sessionId,
    };
}
