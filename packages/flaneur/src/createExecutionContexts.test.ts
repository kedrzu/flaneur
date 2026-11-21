import { expect, test } from 'bun:test';

import { CdpError } from './CdpTypes.js';
import type { CdpEvent } from './CdpTypes.js';
import { createExecutionContexts } from './createExecutionContexts.js';
import type { ExecutionContext } from './createExecutionContexts.js';
import { ISOLATED_WORLD_NAME } from './createIsolatedWorlds.js';
import type { ClientWorld } from './createIsolatedWorlds.js';

/** Playwright's utility world in the main frame. */
const UTILITY: ClientWorld = {
    frameId: 'f-main',
    worldName: '__playwright_utility_world_1',
    grantUniveralAccess: true,
};

test('a session that never enabled Runtime gets its events as they are, and nothing more', async () => {
    const { contexts, emitted } = prepare();

    await contexts.createWorld('s-a', UTILITY);
    const navigated = frameNavigated('f-main');

    expect(contexts.translate(navigated)).toEqual([navigated]);
    expect(contexts.translate(frameAttached('f-child'))).toEqual([frameAttached('f-child')]);
    expect(emitted).toEqual([]);
});

test('enabling announces the main world and every world of the client in each frame of the current documents', async () => {
    const { contexts, emitted, sent } = prepare();
    await contexts.createWorld('s-a', UTILITY);

    expect(await contexts.enable('s-a')).toEqual({});

    expect(sent.at(-1)).toEqual({ method: 'Page.getFrameTree', sessionId: 's-a' });
    expect(emitted).toEqual([
        created(2, 'f-main', '', 'https://a.test'),
        created(3, 'f-main', UTILITY.worldName, 'https://a.test'),
        created(4, 'f-child', '', 'https://b.test'),
        created(5, 'f-child', UTILITY.worldName, 'https://b.test'),
    ]);
    const main: ExecutionContext = {
        type: 'world',
        world: { frameId: 'f-child', worldName: ISOLATED_WORLD_NAME, grantUniveralAccess: false },
    };
    expect(contexts.find('s-a', 4)).toEqual(main);
    expect(contexts.find('s-b', 4)).toBeUndefined();
});

test("a new document's contexts replace the old ones around its frameNavigated, and only a returned id outlives it", async () => {
    const { contexts, emitted } = prepare();
    await contexts.enable('s-a');
    const { executionContextId: returned } = await readId(contexts.createWorld('s-a', UTILITY));
    // Announced before the reply, with the proxy's id, not Chrome's.
    expect(returned).toBe(3);
    expect(emitted.at(-1)).toEqual(created(3, 'f-main', UTILITY.worldName, ''));

    const navigated = frameNavigated('f-main');
    expect(contexts.translate(navigated)).toEqual([
        destroyed(1),
        destroyed(3),
        navigated,
        created(4, 'f-main', '', 'https://c.test'),
        created(5, 'f-main', UTILITY.worldName, 'https://c.test'),
    ]);
    expect(contexts.find('s-a', 1)).toBeUndefined();
    const utility: ExecutionContext = { type: 'world', world: UTILITY };
    expect(contexts.find('s-a', returned)).toEqual(utility);
    // Asked again, the world keeps the id it was returned under.
    expect(await readId(contexts.createWorld('s-a', UTILITY))).toEqual({ executionContextId: returned });
});

test('a frame attached is announced after its event, a frame detached loses its contexts before its event', async () => {
    const { contexts } = prepare();
    await contexts.enable('s-a');

    const attached = frameAttached('f-new');
    expect(contexts.translate(attached)).toEqual([attached, created(3, 'f-new', '', '')]);
    const detached: CdpEvent = { method: 'Page.frameDetached', params: { frameId: 'f-new' }, sessionId: 's-a' };
    expect(contexts.translate(detached)).toEqual([destroyed(3), detached]);
    expect(contexts.find('s-a', 3)).toBeUndefined();
});

test('disabling stops the events and drops the announced ids, a detached session drops them all', async () => {
    const { contexts } = prepare();
    await contexts.enable('s-a');
    const { executionContextId: returned } = await readId(contexts.createWorld('s-a', UTILITY));

    contexts.disable('s-a');
    expect(contexts.translate(frameNavigated('f-main'))).toEqual([frameNavigated('f-main')]);
    expect(contexts.find('s-a', 1)).toBeUndefined();
    const utility: ExecutionContext = { type: 'world', world: UTILITY };
    expect(contexts.find('s-a', returned)).toEqual(utility);

    contexts.forget('s-a');
    expect(contexts.find('s-a', returned)).toBeUndefined();
});

test("a worker's session gets one context, which runs no code", async () => {
    const { contexts, emitted } = prepare();

    await contexts.enable('s-worker');

    expect(emitted).toEqual([
        {
            method: 'Runtime.executionContextCreated',
            params: {
                context: { id: 1, origin: '', name: '', uniqueId: '1', auxData: { isDefault: true, type: 'default' } },
            },
            sessionId: 's-worker',
        },
    ]);
    const worker: ExecutionContext = { type: 'worker' };
    expect(contexts.find('s-worker', 1)).toEqual(worker);
});

/** What `prepare`'s fake browser got. */
interface SentCommand {
    method: string;
    sessionId?: string;
}

/**
 * The contexts of one client over a fake browser: `s-a` is a page whose main frame `f-main` (at `https://a.test`) has
 * a child `f-child` (at `https://b.test`); `s-worker` a worker, which has no Page domain. Chrome's own context ids are
 * 1000 and up.
 */
function prepare() {
    const sent: SentCommand[] = [];
    const emitted: CdpEvent[] = [];
    let chromeId = 1000;
    const contexts = createExecutionContexts(
        (method, _params, sessionId) => {
            sent.push({ method, sessionId });
            switch (method) {
                case 'Page.getFrameTree':
                    return sessionId === 's-worker'
                        ? Promise.reject(new CdpError({ code: -32_601, message: "'Page.getFrameTree' wasn't found" }))
                        : Promise.resolve({
                              frameTree: {
                                  frame: { id: 'f-main', securityOrigin: 'https://a.test' },
                                  childFrames: [{ frame: { id: 'f-child', securityOrigin: 'https://b.test' } }],
                              },
                          });
                case 'Page.createIsolatedWorld':
                    return Promise.resolve({ executionContextId: chromeId++ });
                default:
                    return Promise.resolve({});
            }
        },
        event => emitted.push(event),
    );
    return { contexts, emitted, sent };
}

async function readId(reply: Promise<object>) {
    const result = await reply;
    if (!('executionContextId' in result) || typeof result.executionContextId !== 'number') {
        throw new TypeError('no context id');
    }
    return { executionContextId: result.executionContextId };
}

function frameNavigated(frameId: string): CdpEvent {
    return {
        method: 'Page.frameNavigated',
        params: { frame: { id: frameId, securityOrigin: 'https://c.test' }, type: 'Navigation' },
        sessionId: 's-a',
    };
}

function frameAttached(frameId: string): CdpEvent {
    return { method: 'Page.frameAttached', params: { frameId, parentFrameId: 'f-main' }, sessionId: 's-a' };
}

function created(id: number, frameId: string, name: string, origin: string): CdpEvent {
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
        sessionId: 's-a',
    };
}

function destroyed(id: number): CdpEvent {
    return { method: 'Runtime.executionContextDestroyed', params: { executionContextId: id }, sessionId: 's-a' };
}
