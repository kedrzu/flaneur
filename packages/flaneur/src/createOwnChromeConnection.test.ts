import { expect, test } from 'bun:test';

import { createTestLogger } from '@nzyme/logging/createTestLogger.js';
import { assert } from '@nzyme/utils/assert.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';
import { waitUntil } from '@nzyme/utils/waitUntil.js';

import { createOwnChromeConnection } from './createOwnChromeConnection.js';
import type { OwnChromeChannel } from './createOwnChromeConnection.js';
import { createStealthBrowser } from './createStealthBrowser.js';
import type { StealthBrowser, StealthBrowserConnection } from './createStealthBrowser.js';
import type { OwnChromeRequest, OwnChromeTab } from './OwnChromeProtocol.js';

const USER_TAB: OwnChromeTab = { targetId: 'user-1', url: 'https://example.com/', title: 'Example' };
const FOCUS_EMULATION = { method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } };

test('creates agent tabs, attached with focus emulation, and lists them beside the tabs already open', async () => {
    const extension = createFakeExtension({ tabs: [USER_TAB] });
    const core = connectCore(await createOwnChromeConnection(extension.channel, createTestLogger('test').logger));

    expect(await core.call('Target.setDiscoverTargets', { discover: true })).toEqual({ id: 1, result: {} });
    expect(await core.call('Target.createTarget', { url: 'about:blank', newWindow: true })).toEqual({
        id: 2,
        result: { targetId: 'tab-1' },
    });
    const listed = await core.call('Target.getTargets');

    // The user's tab is never attached by itself; the agent tab is, before `createTarget` answers.
    expect(extension.requests()).toEqual([
        { type: 'tabs.list' },
        { type: 'tabs.create', url: 'about:blank' },
        { type: 'debugger.attach', targetId: 'tab-1' },
        { type: 'debugger.send', targetId: 'tab-1', ...FOCUS_EMULATION },
    ]);
    expect(core.frames.slice(0, 2)).toMatchObject([
        { method: 'Target.targetCreated', params: { targetInfo: { targetId: 'user-1' } } },
        { id: 1, result: {} },
    ]);
    expect(listed).toMatchObject({
        id: 3,
        result: {
            targetInfos: [
                { targetId: 'user-1', type: 'page', url: 'https://example.com/' },
                { targetId: 'tab-1', type: 'page', attached: false },
            ],
        },
    });
});

test('announces a session before replying to its attach and carries its commands and events', async () => {
    const extension = createFakeExtension();
    const core = connectCore(await createOwnChromeConnection(extension.channel, createTestLogger('test').logger));
    await core.call('Target.createTarget', {});

    const reply = await core.call('Target.attachToTarget', { targetId: 'tab-1', flatten: true });
    const sessionId = readSessionId(reply);
    const attached = core.frames.findIndex(frame => frame['method'] === 'Target.attachedToTarget');
    expect(core.frames.slice(attached)).toMatchObject([
        {
            method: 'Target.attachedToTarget',
            params: {
                sessionId,
                targetInfo: { targetId: 'tab-1', attached: true },
                waitingForDebugger: false,
            },
        },
        reply,
    ]);

    await core.call('Page.navigate', { url: 'https://example.com/' }, sessionId);
    extension.emit({ type: 'debugger.event', targetId: 'tab-1', method: 'Page.frameNavigated', params: { x: 1 } });

    expect(extension.requests().at(-1)).toEqual({
        type: 'debugger.send',
        targetId: 'tab-1',
        method: 'Page.navigate',
        params: { url: 'https://example.com/' },
    });
    expect(core.frames.at(-1)).toEqual({ method: 'Page.frameNavigated', params: { x: 1 }, sessionId });
});

test("a popup of an agent tab is attached and joins its opener's group", async () => {
    const extension = createFakeExtension();
    const connection = await createOwnChromeConnection(extension.channel, createTestLogger('test').logger);
    const browser = await createStealthBrowser(connection, { logger: createTestLogger('test').logger });
    const client = connectClient(browser, 'g');

    try {
        expect(await client.call('Target.createTarget', { url: 'about:blank' })).toEqual({
            id: 1,
            result: { targetId: 'tab-1' },
        });
        extension.emit({
            type: 'tab.created',
            tab: { targetId: 'popup-1', url: 'https://example.com/', title: '', openerId: 'tab-1' },
        });
        await waitUntil(() => extension.requests().length >= 6, { timeoutMs: 1000 });

        expect(browser.groups.of('popup-1')).toBe('g');
        expect(extension.requests().slice(-2)).toEqual([
            { type: 'debugger.attach', targetId: 'popup-1' },
            { type: 'debugger.send', targetId: 'popup-1', ...FOCUS_EMULATION },
        ]);
    } finally {
        await browser.close();
    }
});

test("a client's attach right after creating a page with a URL gets the page, freshly reset", async () => {
    const extension = createFakeExtension();
    const connection = await createOwnChromeConnection(extension.channel, createTestLogger('test').logger);
    const browser = await createStealthBrowser(connection, { logger: createTestLogger('test').logger });
    const client = connectClient(browser, 'g');

    try {
        await client.call('Target.createTarget', { url: 'https://example.com/' });
        // Sent at once: the proxy's navigation session has only just been detached.
        const reply = await client.call('Target.attachToTarget', { targetId: 'tab-1', flatten: true });

        expect(readSessionId(reply)).toStartWith('own-session-');
        expect(extension.requests().filter(request => request.type !== 'tabs.list')).toEqual([
            { type: 'tabs.create', url: 'about:blank' },
            { type: 'debugger.attach', targetId: 'tab-1' },
            { type: 'debugger.send', targetId: 'tab-1', ...FOCUS_EMULATION },
            {
                type: 'debugger.send',
                targetId: 'tab-1',
                method: 'Page.navigate',
                params: { url: 'https://example.com/' },
            },
            { type: 'debugger.detach', targetId: 'tab-1' },
            { type: 'debugger.attach', targetId: 'tab-1' },
            { type: 'debugger.send', targetId: 'tab-1', ...FOCUS_EMULATION },
        ]);
    } finally {
        await browser.close();
    }
});

test('a tab has one session at a time; the next attach waits for the reset after the detach', async () => {
    const extension = createFakeExtension();
    const core = connectCore(await createOwnChromeConnection(extension.channel, createTestLogger('test').logger));
    await core.call('Target.createTarget', {});
    const first = readSessionId(await core.call('Target.attachToTarget', { targetId: 'tab-1', flatten: true }));

    expect(await core.call('Target.attachToTarget', { targetId: 'tab-1', flatten: true })).toEqual({
        id: 3,
        error: { code: -32_000, message: 'Target tab-1 is driven by another client; one session per page' },
    });

    const reattach = Promise.withResolvers<void>();
    extension.handle('debugger.attach', () => reattach.promise.then(() => ({})));
    const detached = core.call('Target.detachFromTarget', { sessionId: first });
    const second = core.call('Target.attachToTarget', { targetId: 'tab-1', flatten: true });
    expect(await detached).toEqual({ id: 4, result: {} });
    await waitUntil(() => extension.requests().at(-1)?.type === 'debugger.attach', { timeoutMs: 1000 });

    expect(core.frames.some(frame => frame['id'] === 5)).toBe(false);
    reattach.resolve();
    expect(readSessionId(await second)).not.toBe(first);
    expect(extension.requests().slice(-3)).toEqual([
        { type: 'debugger.detach', targetId: 'tab-1' },
        { type: 'debugger.attach', targetId: 'tab-1' },
        { type: 'debugger.send', targetId: 'tab-1', ...FOCUS_EMULATION },
    ]);
    expect(core.frames).toContainEqual({
        method: 'Target.detachedFromTarget',
        params: { sessionId: first, targetId: 'tab-1' },
    });
});

test('nothing a session left reaches anyone once it ends: its children end and its tab is detached', async () => {
    const extension = createFakeExtension({ tabs: [USER_TAB] });
    const core = connectCore(await createOwnChromeConnection(extension.channel, createTestLogger('test').logger));
    const sessionId = readSessionId(await core.call('Target.attachToTarget', { targetId: 'user-1', flatten: true }));
    extension.emit({
        type: 'debugger.event',
        targetId: 'user-1',
        method: 'Target.attachedToTarget',
        params: { sessionId: 'child-1', waitingForDebugger: true },
    });
    await core.call('Runtime.runIfWaitingForDebugger', {}, 'child-1');
    expect(extension.requests().at(-1)).toEqual({
        type: 'debugger.send',
        targetId: 'user-1',
        sessionId: 'child-1',
        method: 'Runtime.runIfWaitingForDebugger',
        params: {},
    });

    const framesBefore = core.frames.length;
    await core.call('Target.detachFromTarget', { sessionId });
    await waitUntil(() => extension.requests().at(-1)?.type === 'debugger.detach', { timeoutMs: 1000 });
    extension.emit({ type: 'debugger.event', targetId: 'user-1', method: 'Fetch.requestPaused', params: {} });
    extension.emit({ type: 'debugger.event', targetId: 'user-1', sessionId: 'child-1', method: 'X.y', params: {} });

    expect(core.frames.slice(framesBefore)).toEqual([
        { method: 'Target.detachedFromTarget', params: { sessionId: 'child-1' }, sessionId },
        { method: 'Target.detachedFromTarget', params: { sessionId, targetId: 'user-1' } },
        { id: 3, result: {} },
    ]);
    // A user's tab is attached only for a session: no focus emulation, and no attach after it.
    expect(extension.requests()).toEqual([
        { type: 'tabs.list' },
        { type: 'debugger.attach', targetId: 'user-1' },
        {
            type: 'debugger.send',
            targetId: 'user-1',
            sessionId: 'child-1',
            method: 'Runtime.runIfWaitingForDebugger',
            params: {},
        },
        { type: 'debugger.detach', targetId: 'user-1' },
    ]);
    for (const gone of [sessionId, 'child-1']) {
        expect(await core.call('Page.enable', {}, gone)).toMatchObject({
            error: { message: 'Session with given id not found' },
        });
    }
});

test('a session ends when Chrome detaches the debugger, and before its closed tab is destroyed', async () => {
    const extension = createFakeExtension({ tabs: [USER_TAB] });
    const core = connectCore(await createOwnChromeConnection(extension.channel, createTestLogger('test').logger));
    await core.call('Target.setDiscoverTargets', { discover: true });
    const cancelled = readSessionId(await core.call('Target.attachToTarget', { targetId: 'user-1', flatten: true }));

    extension.emit({ type: 'debugger.detached', targetId: 'user-1', reason: 'canceled_by_user' });
    const closed = readSessionId(await core.call('Target.attachToTarget', { targetId: 'user-1', flatten: true }));
    const framesBefore = core.frames.length;
    extension.emit({ type: 'tab.removed', targetId: 'user-1' });

    expect(core.frames).toContainEqual({
        method: 'Target.detachedFromTarget',
        params: { sessionId: cancelled, targetId: 'user-1' },
    });
    // Attached again for the next session, as the cancel ended the attachment.
    expect(extension.requests().filter(request => request.type === 'debugger.attach')).toHaveLength(2);
    expect(core.frames.slice(framesBefore)).toEqual([
        { method: 'Target.detachedFromTarget', params: { sessionId: closed, targetId: 'user-1' } },
        { method: 'Target.targetDestroyed', params: { targetId: 'user-1' } },
    ]);
});

test('activating a page, by target or on its session, brings it to the front through the extension', async () => {
    const extension = createFakeExtension();
    const core = connectCore(await createOwnChromeConnection(extension.channel, createTestLogger('test').logger));
    await core.call('Target.createTarget', {});
    await core.call('Target.createTarget', {});
    const sessionId = readSessionId(await core.call('Target.attachToTarget', { targetId: 'tab-2', flatten: true }));
    const before = extension.requests().length;

    expect(await core.call('Target.activateTarget', { targetId: 'tab-1' })).toMatchObject({ result: {} });
    expect(await core.call('Page.bringToFront', {}, sessionId)).toMatchObject({ result: {} });

    expect(extension.requests().slice(before)).toEqual([
        { type: 'tabs.activate', targetId: 'tab-1' },
        { type: 'tabs.activate', targetId: 'tab-2' },
    ]);
});

test('closing detaches every tab, closes none, then settles', async () => {
    const extension = createFakeExtension({ tabs: [USER_TAB] });
    const connection = await createOwnChromeConnection(extension.channel, createTestLogger('test').logger);
    const core = connectCore(connection);
    await core.call('Target.createTarget', {});
    await core.call('Target.attachToTarget', { targetId: 'user-1', flatten: true });
    const before = extension.requests().length;

    await connection.close();

    expect(await connection.closed).toEqual({ code: null, signal: null });
    expect(extension.isClosed()).toBe(true);
    expect(extension.requests().slice(before)).toEqual([
        { type: 'debugger.detach', targetId: 'user-1' },
        { type: 'debugger.detach', targetId: 'tab-1' },
    ]);
});

test('losing the extension settles the connection and fails what waits for it', async () => {
    const extension = createFakeExtension();
    const connection = await createOwnChromeConnection(extension.channel, createTestLogger('test').logger);
    const core = connectCore(connection);
    extension.handle('tabs.create', () => new Promise(() => {}));

    const created = core.call('Target.createTarget', {});
    await waitUntil(() => extension.requests().at(-1)?.type === 'tabs.create', { timeoutMs: 1000 });
    extension.channel.close();

    expect(await connection.closed).toEqual({ code: null, signal: null });
    expect(await created).toEqual({ id: 1, error: { code: -32_000, message: 'The extension disconnected' } });
});

test('an extension of another protocol version is refused with what to update', async () => {
    const newer = createFakeExtension({ version: 2 });
    const older = createFakeExtension({ version: 0 });
    const logger = createTestLogger('test').logger;

    await expect(createOwnChromeConnection(newer.channel, logger)).rejects.toThrow(
        'The flaneur extension speaks protocol version 2, this flaneur speaks version 1: update flaneur (npm install flaneur@latest)',
    );
    await expect(createOwnChromeConnection(older.channel, logger)).rejects.toThrow(
        'update the flaneur extension in Chrome',
    );
    expect(newer.isClosed()).toBe(true);
});

test('a browser-level method outside the emulated ones gets a CDP error', async () => {
    const extension = createFakeExtension();
    const core = connectCore(await createOwnChromeConnection(extension.channel, createTestLogger('test').logger));

    expect(await core.call('Browser.setDownloadBehavior', { behavior: 'deny' })).toEqual({
        id: 1,
        error: { code: -32_601, message: 'Browser.setDownloadBehavior is not supported with --chrome own' },
    });
    expect(extension.requests()).toEqual([{ type: 'tabs.list' }]);
});

/** Options of the stand-in extension. */
interface FakeExtensionOptions {
    version?: number;
    tabs?: OwnChromeTab[];
}

/** How the fake answers a request: with its result, or by throwing. */
type RequestHandler = (request: OwnChromeRequest) => unknown;

/**
 * A stand-in extension on an in-memory channel: answers the greeting with `version`, lists `tabs`, opens `tab-N` on
 * `tabs.create` and answers everything else with `{}`, each a tick later, unless a handler says otherwise.
 */
function createFakeExtension(options: FakeExtensionOptions = {}) {
    const listeners = new Set<(message: unknown) => void>();
    const received: OwnChromeRequest[] = [];
    const handlers = new Map<OwnChromeRequest['type'], RequestHandler>();
    const closed = Promise.withResolvers<void>();
    let isClosed = false;
    let lastTab = 0;

    const channel: OwnChromeChannel = {
        send: message => {
            if (message.type === 'hello') {
                queueMicrotask(() =>
                    emit({ type: 'hello', version: options.version ?? 1, userAgent: 'Mozilla/5.0 Chrome/150.0.0.0' }),
                );
                return;
            }
            received.push(message);
            void reply(message);
        },
        onMessage: listener => listeners.add(listener),
        closed: closed.promise,
        close: () => {
            isClosed = true;
            closed.resolve();
        },
    };

    return {
        channel,
        /** What flaneur asked, in order, without the ids. */
        requests: () => received.map(({ id: _id, ...request }) => request),
        handle: (type: OwnChromeRequest['type'], handler: RequestHandler) => handlers.set(type, handler),
        emit,
        isClosed: () => isClosed,
    };

    async function reply(request: OwnChromeRequest) {
        try {
            const result: unknown = await (handlers.get(request.type) ?? answer)(request);
            emit({ type: 'reply', id: request.id, result });
        } catch (error) {
            emit({ type: 'error', id: request.id, message: String(error) });
        }
    }

    function answer(request: OwnChromeRequest) {
        switch (request.type) {
            case 'tabs.list':
                return { tabs: options.tabs ?? [] };
            case 'tabs.create':
                return { tab: { targetId: `tab-${++lastTab}`, url: 'about:blank', title: '' } };
            default:
                return {};
        }
    }

    function emit(message: object) {
        if (isClosed) {
            return;
        }
        for (const listener of listeners) {
            listener(message);
        }
    }
}

/** The core's side of a connection: every frame it got, and a call that resolves with its reply frame. */
function connectCore(connection: StealthBrowserConnection) {
    const frames: Record<string, unknown>[] = [];
    let lastId = 0;
    connection.onFrame(frame => {
        const message: unknown = JSON.parse(frame);
        assert(isPlainObject(message));
        frames.push(message);
    });

    return { frames, call };

    async function call(method: string, params: object = {}, sessionId?: string) {
        const id = ++lastId;
        connection.send({ id, method, params, sessionId });
        await waitUntil(() => frames.some(frame => frame['id'] === id), { timeoutMs: 1000 });
        const reply = frames.find(frame => frame['id'] === id);
        assert(reply);
        return reply;
    }
}

/** A client of the core in `group`, on an in-memory socket. */
function connectClient(browser: StealthBrowser, group: string) {
    const replies: Record<string, unknown>[] = [];
    let lastId = 0;
    const client = browser.connect(
        {
            send: text => {
                const message: unknown = JSON.parse(text);
                assert(isPlainObject(message));
                replies.push(message);
            },
            close: () => {},
        },
        { group, data: undefined },
    );

    return { call };

    async function call(method: string, params: object) {
        const id = ++lastId;
        client.receive(JSON.stringify({ id, method, params }));
        await waitUntil(() => replies.some(reply => reply['id'] === id), { timeoutMs: 1000 });
        return replies.find(reply => reply['id'] === id);
    }
}

function readSessionId(reply: unknown) {
    const result = isPlainObject(reply) ? reply['result'] : undefined;
    const sessionId = isPlainObject(result) ? result['sessionId'] : undefined;
    assert(typeof sessionId === 'string', 'The attach gave no session');
    return sessionId;
}
