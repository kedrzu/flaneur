import { expect, mock, test } from 'bun:test';

import { createTestLogger } from '@nzyme/logging/createTestLogger.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

import { CdpError } from './CdpTypes.js';
import type { CdpEvent, CdpPolicy, CdpRequest } from './CdpTypes.js';
import { connectClient } from './connectClient.js';
import type { HumanInputRun } from './createHumanInput.js';
import { ISOLATED_WORLD_NAME, WORLD_PRELUDE } from './createIsolatedWorlds.js';
import { createSessionRegistry } from './createSessionRegistry.js';
import type { SessionRegistry } from './createSessionRegistry.js';
import { ATTACH_SITE_PACE, createSitePace } from './createSitePace.js';
import type { SitePaceClock, SitePaceRun } from './createSitePace.js';

/** A command the fake browser got. */
interface SentCommand {
    method: string;
    params?: object;
    sessionId?: string;
}

/** Playwright's browser-level auto-attach. */
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };

/** Messages a client must never get through to the browser, with or without a policy. */
const REFUSED: [string, Record<string, unknown>, string | undefined][] = [
    // Another client's session, a session of the proxy, an unknown one.
    ['Page.navigate', { url: 'https://example.com/' }, 's-b'],
    ['Page.navigate', { url: 'https://example.com/' }, 's-proxy'],
    ['Page.navigate', { url: 'https://example.com/' }, 'unknown'],
    // Another group's target, the proxy's own, an unknown one.
    ['Target.attachToTarget', { targetId: 't-b', flatten: true }, undefined],
    ['Target.attachToTarget', { targetId: 't-proxy', flatten: true }, undefined],
    ['Target.closeTarget', { targetId: 't-b' }, undefined],
    ['Target.activateTarget', { targetId: 't-b' }, undefined],
    ['Target.getTargetInfo', { targetId: 'unknown' }, undefined],
    // Detaching only an own session, by its id.
    ['Target.detachFromTarget', { sessionId: 's-b' }, undefined],
    ['Target.detachFromTarget', { sessionId: 's-proxy' }, undefined],
    ['Target.detachFromTarget', { targetId: 't-a' }, undefined],
    // The stealth rules.
    ['Runtime.addBinding', { name: 'binding' }, 's-a'],
    ['Runtime.compileScript', { expression: '1', sourceURL: '', persistScript: true }, 's-a'],
    ['Runtime.runScript', { scriptId: '1' }, 's-a'],
    ['Page.addScriptToEvaluateOnLoad', { scriptSource: 'x' }, 's-a'],
    ['Emulation.setUserAgentOverride', { userAgent: 'Bot/1.0' }, 's-a'],
    ['Network.setUserAgentOverride', { userAgent: 'Bot/1.0' }, 's-a'],
    ['Console.clearMessages', {}, 's-a'],
    ['Debugger.pause', {}, 's-a'],
    ['Target.sendMessageToTarget', { message: '{}', sessionId: 's-a' }, undefined],
    ['Target.exposeDevToolsProtocol', { targetId: 't-a' }, undefined],
    ['Target.attachToBrowserTarget', {}, undefined],
    ['Browser.close', {}, undefined],
    ['Runtime.evaluate', { expression: '1', contextId: 1 }, 's-a'],
];

test.each([
    ['no policy', undefined],
    ['a policy that passes everything', (request: CdpRequest) => request],
])('no refused command reaches the browser, with %s', async (_name, policy) => {
    const { browser, client } = prepare({ policy });

    for (const [method, params, sessionId] of REFUSED) {
        const reply = await client.call(method, params, sessionId);
        expect({ method, sessionId, error: isPlainObject(reply['error']) }).toEqual({
            method,
            sessionId,
            error: true,
        });
    }
    expect(browser.sent).toEqual([]);
});

test('a policy runs after the session and group rules, and what it passes is held to them and the stealth rules', async () => {
    const policy = mock<CdpPolicy<string>>((request, client) => {
        expect(client.data).toBe('data-a');
        switch (request.method) {
            case 'Page.reload':
                return { method: 'Runtime.addBinding', params: { name: 'binding' }, sessionId: request.sessionId };
            case 'Page.stopLoading':
                return { method: 'Page.navigate', params: { url: 'https://example.com/' }, sessionId: 's-b' };
            case 'Target.getTargetInfo':
                return { method: 'Target.closeTarget', params: { targetId: 't-b' } };
            default:
                return { reply: { answered: true } };
        }
    });
    const { browser, client } = prepare({ policy });

    // Named another group's target or session: refused before the policy is asked, even one that would answer it.
    expect((await client.call('Target.closeTarget', { targetId: 't-b' }))['error']).toBeDefined();
    expect((await client.call('Page.enable', {}, 's-b'))['error']).toBeDefined();
    expect(policy).not.toHaveBeenCalled();
    // Rewritten into what the client may not send.
    for (const [method, params, sessionId] of [
        ['Page.reload', {}, 's-a'],
        ['Page.stopLoading', {}, 's-a'],
        ['Target.getTargetInfo', { targetId: 't-a' }, undefined],
    ] as const) {
        expect((await client.call(method, params, sessionId))['error']).toBeDefined();
    }
    expect(browser.sent).toEqual([]);
    // Its own answer goes back as the reply.
    expect((await client.call('Page.enable', {}, 's-a'))['result']).toEqual({ answered: true });
    expect(policy).toHaveBeenCalledTimes(4);
});

test('a command a policy holds keeps the later commands of its session behind it, not those of others', async () => {
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    const { browser, client, registry } = prepare({
        policy: async request => {
            if (request.method === 'Page.navigate') {
                await held;
            }
            return request;
        },
    });
    registry.claimSession({ type: 'client', clientId: 'c-a' }, 's-a2', 't-a');

    const navigated = client.call('Page.navigate', { url: 'https://example.com/' }, 's-a');
    const reloaded = client.call('Page.reload', {}, 's-a');
    await client.call('Page.enable', {}, 's-a2');
    expect(browser.sent.map(sent => sent.method)).toEqual(['Page.enable']);

    release();
    await Promise.all([navigated, reloaded]);
    expect(browser.sent.map(sent => sent.method)).toEqual(['Page.enable', 'Page.navigate', 'Page.reload']);
});

test("a closed socket's commands never reach the browser", async () => {
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    const { browser, client } = prepare({
        policy: async request => {
            await held;
            return request;
        },
    });

    client.receive({ id: 1, method: 'Page.navigate', params: { url: 'https://example.com/' }, sessionId: 's-a' });
    client.receive({ id: 2, method: 'Page.reload', params: {}, sessionId: 's-a' });
    client.client.close();
    release();
    await Bun.sleep(10);

    expect(browser.sent).toEqual([]);
    expect(client.messages).toEqual([]);
});

test("a client's download behavior is answered without reaching the browser", async () => {
    const { browser, client } = prepare({});

    const reply = await client.call('Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true });

    expect(reply).toEqual({ id: 1, result: {} });
    expect(browser.sent).toEqual([]);
});

test('a reply names the session of its command, as Chrome does, whether forwarded, answered or refused', async () => {
    const { client } = prepare({});

    const forwarded = await client.call('Page.reload', {}, 's-a');
    const answered = await client.call('Console.enable', {}, 's-a');
    const refused = await client.call('Runtime.addBinding', { name: 'binding' }, 's-a');

    expect(forwarded).toEqual({ id: 1, sessionId: 's-a', result: {} });
    expect(answered).toEqual({ id: 2, sessionId: 's-a', result: {} });
    expect(refused).toMatchObject({ id: 3, sessionId: 's-a', error: { code: -32_000 } });
});

test('sessions are flat, and an auto-attach is set on a session', async () => {
    const { browser, client } = prepare({});

    await client.call('Target.attachToTarget', { targetId: 't-a', flatten: false });
    await client.call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true }, 's-a');

    expect(browser.sent).toEqual([
        { method: 'Target.attachToTarget', params: { targetId: 't-a', flatten: true } },
        {
            method: 'Target.setAutoAttach',
            params: { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
            sessionId: 's-a',
        },
    ]);
});

test("browser-level auto-attach never reaches the browser: the client is attached to its group's pages, the one used last first, each once", async () => {
    const { browser, client, registry } = prepare({});
    registry.claimTarget('group-a', 't-a2');

    const reply = await client.call('Target.setAutoAttach', AUTO_ATTACH);
    const announcedFirst = attachedTargets(client.messages);
    // A popup of a page of the group joins it; one of another group's page, and a page of no group, do not.
    browser.emit({ method: 'Target.targetCreated', params: { targetInfo: { ...pageInfo('t-pop'), openerId: 't-a' } } });
    browser.emit({
        method: 'Target.targetCreated',
        params: { targetInfo: { ...pageInfo('t-pop-b'), openerId: 't-b' } },
    });
    browser.emit({ method: 'Target.targetCreated', params: { targetInfo: pageInfo('t-stranger') } });
    browser.emit({
        method: 'Target.targetInfoChanged',
        params: { targetInfo: { ...pageInfo('t-pop'), openerId: 't-a' } },
    });
    await client.call('Target.setAutoAttach', AUTO_ATTACH);
    await Bun.sleep(10);

    expect(reply).toEqual({ id: 1, result: {} });
    expect(announcedFirst).toEqual(['t-a2', 't-a']);
    expect(browser.sent).toEqual([
        { method: 'Target.attachToTarget', params: { targetId: 't-a2', flatten: true } },
        { method: 'Target.attachToTarget', params: { targetId: 't-a', flatten: true } },
        { method: 'Target.attachToTarget', params: { targetId: 't-pop', flatten: true } },
    ]);
    expect(attachedTargets(client.messages)).toEqual(['t-a2', 't-a', 't-pop']);
});

test('each attach of the auto-attach is judged by the policy, whose refusal leaves the page out', async () => {
    const judged: unknown[] = [];
    const { browser, client, registry } = prepare({
        policy: request => {
            judged.push(request.params['targetId']);
            return request.params['targetId'] === 't-a2' ? { reject: 'not this one' } : request;
        },
    });
    registry.claimTarget('group-a', 't-a2');

    await client.call('Target.setAutoAttach', AUTO_ATTACH);

    expect(judged).toEqual([undefined, 't-a2', 't-a']);
    expect(browser.sent).toEqual([{ method: 'Target.attachToTarget', params: { targetId: 't-a', flatten: true } }]);
    expect(attachedTargets(client.messages)).toEqual(['t-a']);
});

test("with no group, auto-attach attaches the client to every page but the proxy's own, and to no frame", async () => {
    const { browser, client } = prepare({
        ungrouped: true,
        answer: command =>
            command.method === 'Target.getTargets'
                ? Promise.resolve({
                      targetInfos: [pageInfo('t-a'), pageInfo('t-proxy'), { targetId: 't-frame', type: 'iframe' }],
                  })
                : undefined,
    });

    await client.call('Target.setAutoAttach', AUTO_ATTACH);
    browser.emit({ method: 'Target.targetCreated', params: { targetInfo: pageInfo('t-b') } });
    browser.emit({ method: 'Target.targetCreated', params: { targetInfo: { targetId: 't-frame2', type: 'iframe' } } });
    await Bun.sleep(10);

    expect(attachedTargets(client.messages)).toEqual(['t-a', 't-b']);
});

test('with auto-attach on, a page the client creates is attached once the proxy navigated it, and announced before the reply', async () => {
    // With no group, the client sees the page from the browser's `Target.targetCreated` on, before the reply.
    const { browser, client } = prepare({ ungrouped: true });
    await client.call('Target.setAutoAttach', AUTO_ATTACH);

    await client.call('Target.createTarget', { url: 'https://example.com/' });
    await Bun.sleep(10);

    // With `--chrome own` a page has one session: the client's must come after the proxy's navigation session.
    expect(browser.sent).toEqual([
        { method: 'Target.getTargets', params: {} },
        { method: 'Target.createTarget', params: { url: 'about:blank', newWindow: true, background: true } },
        { method: 'Target.attachToTarget', params: { targetId: 't-new', flatten: true } },
        { method: 'Page.navigate', params: { url: 'https://example.com/' }, sessionId: 's-new' },
        { method: 'Target.detachFromTarget', params: { sessionId: 's-new' } },
        { method: 'Target.attachToTarget', params: { targetId: 't-new', flatten: true } },
    ]);
    expect(client.messages.map(message => message['method'] ?? message['id'])).toEqual([
        1,
        'Target.attachedToTarget',
        2,
    ]);
});

test('closing the client detaches its auto-attached sessions, one attached after it closed too', async () => {
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    const { browser, client, registry } = prepare({
        answer: command =>
            command.method === 'Target.attachToTarget' &&
            isPlainObject(command.params) &&
            command.params['targetId'] === 't-a2'
                ? held.then(() => ({ sessionId: 's-late' }))
                : undefined,
    });
    registry.claimTarget('group-a', 't-a2');
    registry.claimTarget('group-a', 't-a');

    void client.call('Target.setAutoAttach', AUTO_ATTACH);
    // `t-a` is attached by now, `t-a2` is not.
    await Bun.sleep(10);
    client.client.close();
    release();
    await Bun.sleep(10);

    expect(browser.sent.filter(sent => sent.method === 'Target.detachFromTarget')).toEqual([
        { method: 'Target.detachFromTarget', params: { sessionId: 's-new' } },
        { method: 'Target.detachFromTarget', params: { sessionId: 's-late' } },
    ]);
});

test('a page created with a URL is created blank and navigated by the proxy before the reply, and joins the group', async () => {
    const { browser, client, registry } = prepare({});

    const reply = await client.call('Target.createTarget', { url: 'https://example.com/', newWindow: true });

    expect(reply['result']).toEqual({ targetId: 't-new' });
    expect(browser.sent).toEqual([
        { method: 'Target.createTarget', params: { url: 'about:blank', newWindow: true, background: true } },
        { method: 'Target.attachToTarget', params: { targetId: 't-new', flatten: true } },
        { method: 'Page.navigate', params: { url: 'https://example.com/' }, sessionId: 's-new' },
        { method: 'Target.detachFromTarget', params: { sessionId: 's-new' } },
    ]);
    expect(registry.getTargetGroup('t-new')).toBe('group-a');
    expect(registry.getSessionOriginator('s-new')).toEqual({ type: 'proxy' });
});

test('pages open in background windows of their own, and activating one is left to the browser connection', async () => {
    const { browser, client } = prepare({});

    await client.call('Target.createTarget', { url: 'about:blank', newWindow: false, background: false, width: 800 });
    await client.call('Target.activateTarget', { targetId: 't-a' });
    await client.call('Page.bringToFront', {}, 's-a');

    expect(browser.sent).toEqual([
        {
            method: 'Target.createTarget',
            params: { url: 'about:blank', newWindow: true, background: true, width: 800 },
        },
        { method: 'Target.activateTarget', params: { targetId: 't-a' } },
        { method: 'Page.bringToFront', params: {}, sessionId: 's-a' },
    ]);
});

test('without a pace, loads of one site go to the browser one right after another', async () => {
    const { browser, client } = prepare({});

    await client.call('Page.navigate', { url: 'https://example.com/' }, 's-a');
    await client.call('Page.navigate', { url: 'https://example.com/next' }, 's-a');
    await client.call('Target.createTarget', { url: 'https://example.com/other' });

    expect(browser.sent.filter(sent => sent.method === 'Page.navigate')).toHaveLength(3);
});

test("a page created with a URL takes its site's slot once, the proxy's navigation of it is not held, and what the pace refuses never reaches the browser", async () => {
    const clock = createManualClock();
    const registry = createSessionRegistry();
    const { browser, client } = prepare({ registry, pace: createSitePace({ clock })[ATTACH_SITE_PACE](registry) });

    await client.call('Target.createTarget', { url: 'https://example.com/' });
    expect(browser.sent.map(sent => sent.method)).toEqual([
        'Target.createTarget',
        'Target.attachToTarget',
        'Page.navigate',
        'Target.detachFromTarget',
    ]);

    const held = client.call('Page.navigate', { url: 'https://example.com/next' }, 's-a');
    await Bun.sleep(10);
    expect(browser.sent).toHaveLength(4);
    clock.advance(5000);
    await held;
    expect(browser.sent.at(-1)).toEqual({
        method: 'Page.navigate',
        params: { url: 'https://example.com/next' },
        sessionId: 's-a',
    });

    // Each in its own session's line, so all three are held at once.
    registry.claimSession({ type: 'client', clientId: 'c-a' }, 's-a2', 't-a');
    registry.claimSession({ type: 'client', clientId: 'c-a' }, 's-a3', 't-a');
    void client.call('Page.navigate', { url: 'https://example.com/' }, 's-a2');
    void client.call('Page.navigate', { url: 'https://example.com/' }, 's-a3');
    void client.call('Target.createTarget', { url: 'https://example.com/' });
    const refused = await client.call('Page.navigate', { url: 'https://example.com/' }, 's-a');
    expect(refused['error']).toMatchObject({
        message: 'example.com is paced at one page load every 5 s: the next action on it is possible in 20 s.',
    });
});

test('with Runtime enabled, the browser never gets it, and every call naming a context runs in an isolated world', async () => {
    const { browser, client, registry } = prepare({ answer: answerPage });
    registry.claimSession({ type: 'client', clientId: 'c-a' }, 's-worker', 't-a');

    await client.call('Runtime.enable', {}, 's-a');
    const [main] = createdIds(client.messages);
    const world = await client.call(
        'Page.createIsolatedWorld',
        { frameId: 'f-main', worldName: 'utility-pw', grantUniveralAccess: true },
        's-a',
    );
    const worldId = isPlainObject(world['result']) ? world['result']['executionContextId'] : undefined;
    expect(createdIds(client.messages)).toEqual([main, worldId]);
    browser.sent.length = 0;

    await client.call('Runtime.evaluate', { expression: '1', contextId: main }, 's-a');
    await client.call('DOM.resolveNode', { backendNodeId: 5, executionContextId: worldId }, 's-a');
    expect(browser.sent).toEqual([
        {
            method: 'Page.createIsolatedWorld',
            params: { frameId: 'f-main', worldName: ISOLATED_WORLD_NAME, grantUniveralAccess: false },
            sessionId: 's-a',
        },
        { method: 'Runtime.evaluate', params: { expression: WORLD_PRELUDE, contextId: 1000 }, sessionId: 's-a' },
        { method: 'Runtime.evaluate', params: { expression: '1', contextId: 1000 }, sessionId: 's-a' },
        {
            method: 'Page.createIsolatedWorld',
            params: { frameId: 'f-main', worldName: 'utility-pw', grantUniveralAccess: true },
            sessionId: 's-a',
        },
        { method: 'Runtime.evaluate', params: { expression: WORLD_PRELUDE, contextId: 1001 }, sessionId: 's-a' },
        { method: 'DOM.resolveNode', params: { backendNodeId: 5, executionContextId: 1001 }, sessionId: 's-a' },
    ]);
    browser.sent.length = 0;

    // A worker's context, and an id of a document gone, never reach the browser.
    await client.call('Runtime.enable', {}, 's-worker');
    const [, , worker] = createdIds(client.messages);
    const inWorker = await client.call('Runtime.evaluate', { expression: '1', contextId: worker }, 's-worker');
    expect(inWorker['error']).toMatchObject({ message: 'Runtime.evaluate: Code cannot run in a worker' });
    browser.emit({ method: 'Page.frameNavigated', params: { frame: { id: 'f-main' } }, sessionId: 's-a' });
    const gone = await client.call('Runtime.evaluate', { expression: '1', contextId: main }, 's-a');
    expect(isPlainObject(gone['error']) ? gone['error']['message'] : undefined).toContain(
        'announced for the current document',
    );
    expect(browser.sent).toEqual([{ method: 'Page.getFrameTree', params: {}, sessionId: 's-worker' }]);
});

test("a client's init scripts of a world come after the proxy's prelude for that world, registered once per session", async () => {
    const { browser, client, registry } = prepare({ answer: answerPage });
    registry.claimSession({ type: 'client', clientId: 'c-a' }, 's-a2', 't-a');

    await client.call('Page.addScriptToEvaluateOnNewDocument', { source: 'one' }, 's-a');
    await client.call('Page.addScriptToEvaluateOnNewDocument', { source: 'two' }, 's-a');
    await client.call('Page.addScriptToEvaluateOnNewDocument', { source: '', worldName: 'utility-pw' }, 's-a');
    await client.call('Page.addScriptToEvaluateOnNewDocument', { source: 'three' }, 's-a2');

    const sent = browser.sent.map(command => {
        const params = isPlainObject(command.params) ? command.params : {};
        return [
            command.sessionId,
            params['worldName'],
            params['source'] === WORLD_PRELUDE ? 'prelude' : params['source'],
        ];
    });
    expect(sent).toEqual([
        ['s-a', ISOLATED_WORLD_NAME, 'prelude'],
        ['s-a', ISOLATED_WORLD_NAME, 'one'],
        ['s-a', ISOLATED_WORLD_NAME, 'two'],
        ['s-a', 'utility-pw', 'prelude'],
        ['s-a', 'utility-pw', ''],
        ['s-a2', ISOLATED_WORLD_NAME, 'prelude'],
        ['s-a2', ISOLATED_WORLD_NAME, 'three'],
    ]);
    expect(browser.sent[0]?.params).toMatchObject({ runImmediately: true });
});

test("a new document's contexts reach the client right after its frameNavigated, before any later event", async () => {
    const { browser, client } = prepare({ answer: answerPage });
    await client.call('Runtime.enable', {}, 's-a');
    client.messages.length = 0;

    browser.emit({ method: 'Page.frameNavigated', params: { frame: { id: 'f-main' } }, sessionId: 's-a' });
    browser.emit({ method: 'Page.lifecycleEvent', params: { frameId: 'f-main', name: 'init' }, sessionId: 's-a' });

    expect(client.messages.map(message => message['method'])).toEqual([
        'Runtime.executionContextDestroyed',
        'Page.frameNavigated',
        'Runtime.executionContextCreated',
        'Page.lifecycleEvent',
    ]);
});

test("contexts are announced only after the reply to the session's earlier commands, however the browser answers", async () => {
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    let trees = 0;
    const { client } = prepare({
        answer: async command => {
            // The client's own Page.getFrameTree is answered last, after any the proxy sends for its Runtime.enable.
            if (command.method === 'Page.getFrameTree' && trees++ === 0) {
                await held;
            }
            return answerPage(command);
        },
    });

    const tree = client.call('Page.getFrameTree', {}, 's-a');
    const enabled = client.call('Runtime.enable', {}, 's-a');
    await Bun.sleep(10);
    expect(client.messages).toEqual([]);
    release();
    await Promise.all([tree, enabled]);

    expect(client.messages.map(message => message['id'] ?? message['method'])).toEqual([
        1,
        'Runtime.executionContextCreated',
        2,
    ]);
});

test("lifecycle events are enabled once the client has the session's frame tree, and its events follow the reply", async () => {
    const tree = Promise.withResolvers<void>();
    const enabling = Promise.withResolvers<void>();
    const { browser, client } = prepare({
        answer: async command => {
            if (command.method === 'Page.getFrameTree') {
                await tree.promise;
            }
            if (command.method === 'Page.setLifecycleEventsEnabled') {
                // Chrome replays the document's lifecycle before it replies.
                browser.emit({
                    method: 'Page.lifecycleEvent',
                    params: { frameId: 'f-main', name: 'load' },
                    sessionId: 's-a',
                });
                await enabling.promise;
            }
            return answerPage(command);
        },
    });

    const replies = Promise.all([
        client.call('Page.getFrameTree', {}, 's-a'),
        client.call('Page.setLifecycleEventsEnabled', { enabled: true }, 's-a'),
    ]);
    await Bun.sleep(10);
    expect(browser.sent.map(command => command.method)).toEqual(['Page.getFrameTree']);
    tree.resolve();
    await Bun.sleep(10);
    expect(client.messages.map(message => message['id'] ?? message['method'])).toEqual([1]);
    enabling.resolve();
    await replies;

    expect(browser.sent.map(command => command.method)).toEqual([
        'Page.getFrameTree',
        'Page.setLifecycleEventsEnabled',
    ]);
    expect(client.messages.map(message => message['id'] ?? message['method'])).toEqual([1, 2, 'Page.lifecycleEvent']);
});

test("human input sends its own commands first in the session's line, held to the stealth rules, and the client gets the reply of the command it sends last", async () => {
    let refusal: unknown;
    const input: Pick<HumanInputRun, 'perform'> = {
        async perform(command, send) {
            if (command.method !== 'Input.dispatchMouseEvent' || command.sessionId == null) {
                return command;
            }
            await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 }, command.sessionId);
            await send('Runtime.enable', {}, command.sessionId).catch((error: unknown) => {
                refusal = error;
            });
            return { ...command, params: { ...command.params, x: 11 } };
        },
    };
    const { browser, client } = prepare({
        input,
        answer: command =>
            command.method === 'Input.dispatchMouseEvent' ? Promise.resolve({ x: 'answered' }) : undefined,
    });

    const pressed = client.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 10, y: 10 }, 's-a');
    const next = client.call('Page.getFrameTree', {}, 's-a');
    const reply = await pressed;
    await next;

    expect(browser.sent).toEqual([
        { method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 1, y: 1 }, sessionId: 's-a' },
        { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: 11, y: 10 }, sessionId: 's-a' },
        { method: 'Page.getFrameTree', params: {}, sessionId: 's-a' },
    ]);
    expect(reply['result']).toEqual({ x: 'answered' });
    expect(refusal).toBeInstanceOf(Error);
});

/** What `prepare` builds a client with. */
interface PrepareOptions {
    policy?: CdpPolicy<string>;
    pace?: Pick<SitePaceRun, 'gate'>;
    input?: Pick<HumanInputRun, 'perform'>;
    /** The registry to fill; a new one by default. */
    registry?: SessionRegistry;
    /** The fake browser's answer to a command; `undefined` leaves it to the default answers. */
    answer?: (command: SentCommand) => Promise<unknown> | undefined;
    /** A client of no group, which sees every page but the proxy's own; of `group-a` by default. */
    ungrouped?: boolean;
}

/**
 * Client `c-a` of `group-a` owns page `t-a` and session `s-a`; `c-b` of `group-b` owns `t-b`/`s-b`; the proxy has its
 * own page `t-proxy` and a session `s-proxy` on `t-a`. The fake browser answers `createTarget` with `t-new`, announced
 * by `Target.targetCreated` first, and `attachToTarget`, a macrotask later, with `s-new`, then `s-new-2` and so on,
 * announced by `Target.attachedToTarget` first; anything else with `{}`, unless `answer` answers it. `browser.emit` sends an event,
 * which the registry sees first.
 */
function prepare(options: PrepareOptions) {
    const registry = options.registry ?? createSessionRegistry();
    registry.claimTarget('group-a', 't-a');
    registry.claimSession({ type: 'client', clientId: 'c-a' }, 's-a', 't-a');
    registry.claimTarget('group-b', 't-b');
    registry.claimSession({ type: 'client', clientId: 'c-b' }, 's-b', 't-b');
    registry.claimProxyTarget('t-proxy');
    registry.claimSession({ type: 'proxy' }, 's-proxy', 't-a');

    const sent: SentCommand[] = [];
    const listeners: ((event: CdpEvent) => void)[] = [];
    let attaches = 0;
    const browser = {
        sent,
        emit(event: CdpEvent) {
            registry.observe(event);
            for (const listener of listeners) {
                listener(event);
            }
        },
        send(method: string, params?: object, sessionId?: string) {
            const command = sessionId == null ? { method, params } : { method, params, sessionId };
            sent.push(command);
            const answered = options.answer?.(command);
            if (answered != null) {
                return answered;
            }
            switch (method) {
                case 'Target.createTarget':
                    browser.emit({ method: 'Target.targetCreated', params: { targetInfo: pageInfo('t-new') } });
                    return Promise.resolve({ targetId: 't-new' });
                case 'Target.attachToTarget': {
                    const attached = ++attaches === 1 ? 's-new' : `s-new-${attaches}`;
                    const targetId = isPlainObject(params) ? String(params['targetId']) : '';
                    // A round trip later, as on a pipe.
                    return Bun.sleep(0).then(() => {
                        browser.emit({
                            method: 'Target.attachedToTarget',
                            params: { sessionId: attached, targetInfo: pageInfo(targetId), waitingForDebugger: false },
                        });
                        return { sessionId: attached };
                    });
                }
                default:
                    return Promise.resolve({});
            }
        },
    };
    const messages: Record<string, unknown>[] = [];
    const replies = new Map<number, (message: Record<string, unknown>) => void>();
    const client = connectClient({
        clientId: 'c-a',
        group: options.ungrouped ? undefined : 'group-a',
        data: 'data-a',
        socket: {
            send(text) {
                const message: unknown = JSON.parse(text);
                if (!isPlainObject(message)) {
                    return;
                }
                messages.push(message);
                const id = message['id'];
                if (typeof id === 'number') {
                    replies.get(id)?.(message);
                }
            },
            close: () => {},
        },
        send: (method, params, sessionId) => browser.send(method, params, sessionId),
        registry,
        brand: { whenBranded: () => Promise.resolve() },
        onEvent: listener => {
            listeners.push(listener);
            return () => {};
        },
        policy: options.policy,
        pace: options.pace,
        input: options.input,
        logger: createTestLogger('test').logger,
    });

    let lastId = 0;
    return {
        browser,
        registry,
        client: {
            client,
            messages,
            receive: (message: object) => client.receive(JSON.stringify(message)),
            /** Sends a command and resolves with the whole reply message. */
            call(method: string, params: object, sessionId?: string) {
                const id = ++lastId;
                return new Promise<Record<string, unknown>>(resolve => {
                    replies.set(id, resolve);
                    client.receive(JSON.stringify({ id, method, params, sessionId }));
                });
            },
        },
    };
}

/**
 * A page whose main frame is `f-main` and whose worlds get Chrome's context ids from 1000 up; `s-worker` is a worker,
 * which has no Page domain.
 */
function answerPage(command: SentCommand) {
    switch (command.method) {
        case 'Page.getFrameTree':
            return command.sessionId === 's-worker'
                ? Promise.reject(new CdpError({ code: -32_601, message: "'Page.getFrameTree' wasn't found" }))
                : Promise.resolve({ frameTree: { frame: { id: 'f-main' } } });
        case 'Page.createIsolatedWorld':
            return Promise.resolve({
                executionContextId:
                    isPlainObject(command.params) && command.params['worldName'] === 'utility-pw' ? 1001 : 1000,
            });
        default:
            return undefined;
    }
}

/** The ids of the contexts a client was told were created, in order. */
function createdIds(messages: Record<string, unknown>[]) {
    return messages
        .filter(message => message['method'] === 'Runtime.executionContextCreated')
        .map(message =>
            isPlainObject(message['params']) && isPlainObject(message['params']['context'])
                ? message['params']['context']['id']
                : undefined,
        );
}

/** A clock whose time moves only by `advance()`, which runs every timer due by then. */
function createManualClock() {
    let now = 0;
    const timers: { at: number; callback: () => void }[] = [];
    const clock: SitePaceClock & { advance(ms: number): void } = {
        now: () => now,
        setTimeout(callback, ms) {
            timers.push({ at: now + ms, callback });
        },
        advance(ms) {
            now += ms;
            for (const timer of timers.filter(pending => pending.at <= now)) {
                timers.splice(timers.indexOf(timer), 1);
                timer.callback();
            }
        },
    };
    return clock;
}

/** The target info of a page with no opener. */
function pageInfo(targetId: string) {
    return { targetId, type: 'page' };
}

/** The targets a client was told it is attached to, in order. */
function attachedTargets(messages: Record<string, unknown>[]) {
    return messages
        .filter(message => message['method'] === 'Target.attachedToTarget' && message['sessionId'] == null)
        .map(message =>
            isPlainObject(message['params']) && isPlainObject(message['params']['targetInfo'])
                ? message['params']['targetInfo']['targetId']
                : undefined,
        );
}
