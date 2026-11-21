import type { Logger } from '@nzyme/logging/Logger.js';
import { assert } from '@nzyme/utils/assert.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';
import { withTimeout } from '@nzyme/utils/withTimeout.js';

import { attachTargetSession } from './attachTargetSession.js';
import { CdpError } from './CdpTypes.js';
import type { CdpErrorReply, CdpEvent, CdpPolicy, CdpSocket } from './CdpTypes.js';
import { connectClient } from './connectClient.js';
import type { CdpClient } from './connectClient.js';
import { createBrandOverride } from './createBrandOverride.js';
import type { BrandOverride } from './createBrandOverride.js';
import { ATTACH_HUMAN_INPUT } from './createHumanInput.js';
import type { HumanInput } from './createHumanInput.js';
import { createProxyAuth } from './createProxyAuth.js';
import { createSessionRegistry } from './createSessionRegistry.js';
import { ATTACH_SITE_PACE } from './createSitePace.js';
import type { SitePace } from './createSitePace.js';
import type { StealthBrowserProxy } from './StealthBrowserProxy.js';

/** How the browser ended. */
export interface StealthBrowserExit {
    code: number | null;
    signal: NodeJS.Signals | null;
}

/** Which group each page belongs to; a popup joins its opener's group. */
export interface StealthBrowserGroups {
    /** The group a target belongs to; `undefined` for one no group owns. */
    of(targetId: string): string | undefined;
    /** Every target of a group, the one used, or claimed, last first. */
    targets(group: string): string[];
    /** The group's target used, or claimed, last; `undefined` when it has none left. */
    lastUsed(group: string): string | undefined;
}

/** A client `connect` adds. */
export interface StealthBrowserClientOptions<D = unknown> {
    /** The group whose pages the client sees and the pages it creates join; none: every page but the proxy's own. */
    group?: string;
    /** Handed to the policy with each of the client's requests. */
    data: D;
}

/** A browser whose clients go through the proxy's checks, the policy, the stealth rules and the pace. */
export interface StealthBrowser<D = unknown> {
    /** The browser's process; only a launched browser has one. */
    pid?: number;
    /** Settles once the browser is gone; pending calls are rejected by then. */
    exited: Promise<StealthBrowserExit>;
    /**
     * Sends a CDP command, to a session when `sessionId` is given, and resolves with its unchecked `result`. Rejects
     * with `CdpError` when the browser answers with an error, and with a plain `Error` once the browser has exited or
     * when it exits before answering.
     */
    send(method: string, params?: object, sessionId?: string): Promise<unknown>;
    /**
     * Attaches a flat session to `targetId` that belongs to the browser's owner, never to a client, and resolves with its
     * id once the browser has answered the target's brand, so a new page navigated on the session reads the brand from
     * its first script. The caller detaches it with `Target.detachFromTarget` when done.
     */
    attach(targetId: string): Promise<string>;
    /** Subscribes to every CDP event, delivered after the session registry and the brand saw it; returns the unsubscribe. */
    onEvent(listener: (event: CdpEvent) => void): () => void;
    groups: StealthBrowserGroups;
    /**
     * Connects a client: the caller feeds it the socket's messages (`receive`) and tells it when the socket closed
     * (`close`). Its commands go through the proxy's checks, the policy and the stealth rules; it sees only its own
     * sessions and the targets of its group. When the browser exits, the socket is closed with 1011.
     */
    connect(socket: CdpSocket, client: StealthBrowserClientOptions<D>): CdpClient;
    /** Closes the browser and resolves once it is gone. */
    close(): Promise<void>;
}

/** A CDP command on its way to the browser. */
export interface StealthBrowserCommand {
    id: number;
    method: string;
    params: object;
    sessionId?: string;
}

/**
 * How the core reaches a browser, whatever carries it. The core numbers its commands from 1, so a connection may send
 * one of its own with id 0 (`Browser.close`): its reply reaches no pending call.
 */
export interface StealthBrowserConnection {
    send(command: StealthBrowserCommand): void;
    /** Subscribes to every message of the browser, a reply or an event, as its JSON text. */
    onFrame(listener: (frame: string) => void): void;
    /** Settles once the browser is gone. */
    closed: Promise<StealthBrowserExit>;
    /** Ends the browser and resolves once it is gone. */
    close(): Promise<void>;
}

/** What the browser on a connection is configured with, and what its clients may do. */
export interface CreateStealthBrowserOptions<D> {
    /** Names every page and worker Google Chrome from its first script; none: the browser keeps its own name. */
    brand?: boolean;
    /** The proxy the browser's requests go through; its login, when it has one, is answered over CDP. */
    proxy?: StealthBrowserProxy;
    policy?: CdpPolicy<D>;
    pace?: SitePace;
    /** Performs every client's input as a person would; none: input goes as the client sent it. */
    input?: HumanInput;
    /** How long configuring the browser, reading its identity included, may take; 15 s by default. */
    startTimeoutMs?: number;
    logger: Logger;
}

/** A call waiting for its reply. */
interface PendingCall {
    resolve(result: unknown): void;
    reject(error: Error): void;
}

/** A connected client and its socket, closed when the browser exits. */
interface ConnectedClient {
    socket: CdpSocket;
    client: CdpClient;
}

/** WebSocket close code: the server met a condition it cannot go on from. */
const CLOSE_SERVER_ERROR = 1011;
/** How long configuring the browser, reading its own identity included, may take before it fails. */
const START_TIMEOUT_MS = 15_000;
/** The brand of a browser that keeps its own name: nothing is held, every target is ready at once. */
const NO_BRAND: BrandOverride = {
    start: () => Promise.resolve(),
    observe: () => {},
    whenBranded: () => Promise.resolve(),
};

/**
 * Drives the browser on `connection` and resolves once it is ready: targets are discovered and, with `brand`, the
 * brand holds every new target, so nothing reaches the browser before it is configured. When configuring fails or
 * takes longer than `startTimeoutMs` (a browser that never answers), it rejects; ending the connection is then the
 * caller's.
 */
export async function createStealthBrowser<D = unknown>(
    connection: StealthBrowserConnection,
    options: CreateStealthBrowserOptions<D>,
): Promise<StealthBrowser<D>> {
    const { logger } = options;
    const registry = createSessionRegistry();
    const pending = new Map<number, PendingCall>();
    const listeners = new Set<(event: CdpEvent) => void>();
    const clients = new Set<ConnectedClient>();
    let lastId = 0;
    let lastClientId = 0;
    let running = true;

    const brand = options.brand ? createBrandOverride({ send: call, registry, logger }) : NO_BRAND;
    const proxyAuth = createConnectionProxyAuth();
    const pace = options.pace?.[ATTACH_SITE_PACE](registry);
    const input = options.input?.[ATTACH_HUMAN_INPUT](registry);
    const exited = connection.closed.then(onExit);
    connection.onFrame(handleFrame);

    // A browser that never answers would leave the start waiting for good.
    await withTimeout({
        operation: configure(),
        timeoutMs: options.startTimeoutMs ?? START_TIMEOUT_MS,
        onTimeout: () => {
            throw new Error('The browser did not start in time');
        },
    });

    return {
        exited,
        send,
        attach,
        onEvent,
        groups: {
            of: targetId => registry.getTargetGroup(targetId),
            targets: group => registry.getTargets(group),
            lastUsed: group => registry.lastUsed(group),
        },
        connect,
        close,
    };

    async function configure() {
        await proxyAuth?.start();
        await call('Target.setDiscoverTargets', { discover: true });
        await brand.start();
    }

    function send(method: string, params?: object, sessionId?: string) {
        if (!running) {
            return Promise.reject(new Error('The browser is not running'));
        }
        return call(method, params, sessionId);
    }

    async function attach(targetId: string) {
        // Navigated before the brand is answered, a new page's first script can read the browser's own name under load.
        await brand.whenBranded(targetId);
        const sessionId = await attachTargetSession({ send, registry, originator: { type: 'proxy' }, targetId });
        registry.claimSession({ type: 'proxy' }, sessionId, targetId);
        return sessionId;
    }

    function onEvent(listener: (event: CdpEvent) => void) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }

    function connect(socket: CdpSocket, client: StealthBrowserClientOptions<D>): CdpClient {
        const connected: ConnectedClient = {
            socket,
            client: connectClient({
                clientId: `client-${++lastClientId}`,
                group: client.group,
                data: client.data,
                socket,
                send,
                registry,
                brand,
                onEvent,
                policy: options.policy,
                pace,
                input,
                logger,
            }),
        };
        if (!running) {
            closeClient(connected);
            return connected.client;
        }
        clients.add(connected);
        return {
            receive: text => connected.client.receive(text),
            close: () => {
                clients.delete(connected);
                connected.client.close();
            },
        };
    }

    async function close() {
        if (running) {
            await connection.close();
        }
        await exited;
    }

    function createConnectionProxyAuth() {
        const { username, password } = options.proxy ?? {};
        if (username == null && password == null) {
            return null;
        }
        assert(username != null && password != null, 'A proxy login needs both a username and a password');
        return createProxyAuth({ send: call, username, password, logger });
    }

    function call(method: string, params?: object, sessionId?: string) {
        const id = ++lastId;
        return new Promise<unknown>((resolve, reject) => {
            if (!running) {
                reject(new Error('The browser exited'));
                return;
            }
            pending.set(id, { resolve, reject });
            connection.send({ id, method, params: params ?? {}, sessionId });
        });
    }

    function handleFrame(frame: string) {
        let message: unknown;
        try {
            message = JSON.parse(frame);
        } catch (error) {
            logger.warn('The browser sent a malformed message', { error });
            return;
        }
        if (!isPlainObject(message)) {
            return;
        }

        const { id, method, sessionId } = message;
        if (typeof id === 'number') {
            const waiting = pending.get(id);
            pending.delete(id);
            const error = readErrorReply(message['error']);
            if (error) {
                waiting?.reject(new CdpError(error));
            } else {
                waiting?.resolve(message['result']);
            }
            return;
        }
        if (typeof method === 'string') {
            dispatchEvent({
                method,
                params: message['params'],
                sessionId: typeof sessionId === 'string' ? sessionId : undefined,
            });
        }
    }

    function dispatchEvent(event: CdpEvent) {
        registry.observe(event);
        proxyAuth?.observe(event);
        brand.observe(event);
        pace?.observe(event);
        input?.observe(event);
        for (const listener of listeners) {
            try {
                listener(event);
            } catch (error) {
                logger.error('A browser event listener failed', { error, method: event.method });
            }
        }
    }

    function onExit(exit: StealthBrowserExit) {
        running = false;
        for (const waiting of pending.values()) {
            waiting.reject(new Error('The browser exited'));
        }
        pending.clear();
        registry.clear();
        pace?.detach();
        input?.detach();
        for (const connected of clients) {
            closeClient(connected);
        }
        clients.clear();
        return exit;
    }
}

/** Closes a client's socket and the client: the browser it drove is gone. */
function closeClient(connected: ConnectedClient) {
    connected.client.close();
    connected.socket.close(CLOSE_SERVER_ERROR, 'The browser exited');
}

function readErrorReply(error: unknown): CdpErrorReply | null {
    if (!isPlainObject(error)) {
        return null;
    }
    const { code, message, data } = error;
    return {
        code: typeof code === 'number' ? code : 0,
        message: typeof message === 'string' ? message : 'The browser answered with an error',
        data: typeof data === 'string' ? data : undefined,
    };
}
