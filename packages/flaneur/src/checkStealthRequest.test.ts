import { expect, test } from 'bun:test';

import { checkStealthRequest } from './checkStealthRequest.js';
import type { StealthDecision } from './checkStealthRequest.js';
import type { ExecutionContext } from './createExecutionContexts.js';
import { ISOLATED_WORLD_NAME } from './createIsolatedWorlds.js';
import type { ClientWorld } from './createIsolatedWorlds.js';

/** The world the client created on `s-a`, which it was given context id 7 for; 9 is the context of a worker. */
const OWN_WORLD: ClientWorld = { frameId: 'f', worldName: 'own', grantUniveralAccess: true };
const CONTEXTS = {
    find(sessionId: string, contextId: number): ExecutionContext | undefined {
        if (sessionId !== 's-a') {
            return undefined;
        }
        switch (contextId) {
            case 7:
                return { type: 'world', world: OWN_WORLD };
            case 9:
                return { type: 'worker' };
            default:
                return undefined;
        }
    },
};

function check(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    return checkStealthRequest(sessionId == null ? { method, params } : { method, params, sessionId }, CONTEXTS);
}

test.each([
    ['Runtime.addBinding', { name: 'binding' }, 'page code must not call'],
    ['Page.addScriptToEvaluateOnLoad', { scriptSource: 'x' }, 'use Page.addScriptToEvaluateOnNewDocument'],
    ['Emulation.setUserAgentOverride', { userAgent: 'Bot/1.0' }, "the browser's identity is set by the proxy"],
    ['Network.setUserAgentOverride', { userAgent: 'Bot/1.0' }, "the browser's identity is set by the proxy"],
    ['Runtime.compileScript', { expression: '1', sourceURL: '', persistScript: true }, 'page scripts could observe'],
    ['Runtime.runScript', { scriptId: '1' }, 'page scripts could observe'],
    ['Runtime.queryObjects', { prototypeObjectId: 'o' }, 'page scripts could observe'],
    ['Runtime.terminateExecution', {}, 'page scripts could observe'],
    ['Console.clearMessages', {}, 'page scripts could observe'],
    ['Debugger.setBreakpointByUrl', { lineNumber: 1, url: 'x' }, 'page scripts could observe'],
    ['Debugger.evaluateOnCallFrame', { callFrameId: 'c', expression: '1' }, 'page scripts could observe'],
    ['Debugger.pause', {}, 'page scripts could observe'],
    ['Target.sendMessageToTarget', { message: '{}', sessionId: 's-a' }, 'use a flat session'],
    ['Target.exposeDevToolsProtocol', { targetId: 't-a' }, 'binding into CDP'],
    ['Target.attachToBrowserTarget', {}, "the browser target's session is the proxy's"],
    ['Target.autoAttachRelated', { targetId: 't-a', waitForDebuggerOnStart: false }, 'Target.setAutoAttach'],
    ['Target.createBrowserContext', {}, "browser contexts are the proxy's"],
    ['Target.disposeBrowserContext', { browserContextId: 'c' }, "browser contexts are the proxy's"],
    ['Target.setRemoteLocations', { locations: [] }, 'discovery for every client'],
    ['Target.openDevTools', { targetId: 't-a' }, 'DevTools window'],
    ['Target.getDevToolsTarget', { targetId: 't-a' }, 'DevTools window'],
    ['Browser.close', {}, "the browser's lifetime is the proxy's"],
    ['Browser.crash', {}, "the browser's lifetime is the proxy's"],
    ['Browser.crashGpuProcess', {}, "the browser's lifetime is the proxy's"],
] as const)('%s is refused', (method, params, reason) => {
    const decision = check(method, params, 's-a');
    expect(decision.type).toBe('reject');
    expect(decision.type === 'reject' ? decision.message : '').toContain(reason);
});

test.each(['Page.navigate', 'Target.createTarget'])(
    '%s to a javascript: URL is refused, any other goes out',
    method => {
        for (const url of [
            'javascript:alert(1)',
            'JavaScript:alert(1)',
            ' javascript:alert(1)',
            'java\tscript:alert(1)',
        ]) {
            expect(check(method, { url }, 's-a')).toMatchObject({ type: 'reject' });
        }
        for (const url of ['https://example.com/', 'about:blank', 'not a url']) {
            expect(check(method, { url }, 's-a')).toEqual({
                type: 'forward',
                method,
                params: { url },
                sessionId: 's-a',
            });
        }
    },
);

test('Fetch is refused at the browser, where it would pause every page, and goes out on a session', () => {
    expect(check('Fetch.enable', { patterns: [] })).toMatchObject({ type: 'reject' });
    expect(check('Fetch.enable', { patterns: [] }, 's-a').type).toBe('forward');
});

test('the Runtime methods a client reads pages with go out', () => {
    for (const method of ['getProperties', 'awaitPromise', 'releaseObject', 'releaseObjectGroup']) {
        expect(check(`Runtime.${method}`, { objectId: 'o' }, 's-a').type).toBe('forward');
    }
    expect(check('Runtime.runIfWaitingForDebugger', {}, 's-a').type).toBe('forward');
});

test.each(['Console.enable', 'Console.disable', 'Debugger.enable', 'Debugger.disable'])(
    '%s is answered without reaching the browser',
    method => {
        const expected: StealthDecision = { type: 'reply', result: {} };
        expect(check(method, {}, 's-a')).toEqual(expected);
    },
);

test("Runtime's enable and disable on a session are the proxy's own contexts, never the browser's Runtime", () => {
    const enabled: StealthDecision = { type: 'enableRuntime', sessionId: 's-a' };
    const disabled: StealthDecision = { type: 'disableRuntime', sessionId: 's-a' };
    expect(check('Runtime.enable', {}, 's-a')).toEqual(enabled);
    expect(check('Runtime.disable', {}, 's-a')).toEqual(disabled);
    const answered: StealthDecision = { type: 'reply', result: {} };
    expect(check('Runtime.enable')).toEqual(answered);
});

test.each([
    ['Runtime.evaluate', { expression: '1' }, 'contextId'],
    ['Runtime.callFunctionOn', { functionDeclaration: '() => 1' }, 'executionContextId'],
    ['DOM.resolveNode', { backendNodeId: 5 }, 'executionContextId'],
] as const)(
    '%s runs in an isolated world: the proxy own, or one the client created',
    (method, params, contextParam) => {
        expect(check(method, params, 's-a')).toEqual({
            type: 'isolate',
            call: { method, params, sessionId: 's-a', contextParam },
        });
        // The id the client was given names its world, which is created again; the id itself never goes out.
        expect(check(method, { ...params, [contextParam]: 7 }, 's-a')).toEqual({
            type: 'isolate',
            call: { method, params, sessionId: 's-a', contextParam, world: OWN_WORLD },
        });
        // Context ids are reused across renderer processes: any other id may name the page's own world.
        const otherParam = contextParam === 'contextId' ? 'executionContextId' : 'contextId';
        for (const named of [
            { [contextParam]: 8 },
            { [contextParam]: '7' },
            { [otherParam]: 7 },
            { uniqueContextId: '7' },
        ]) {
            expect(check(method, { ...params, ...named }, 's-a')).toMatchObject({ type: 'reject' });
        }
        // A worker's context runs no code of a client.
        expect(check(method, { ...params, [contextParam]: 9 }, 's-a')).toMatchObject({ type: 'reject' });
        // A world is the client's on the session it created it on; with no session there is no page to run in.
        expect(check(method, { ...params, [contextParam]: 7 }, 's-b')).toMatchObject({ type: 'reject' });
        expect(check(method, params)).toMatchObject({ type: 'reject' });
    },
);

test('Runtime.callFunctionOn on an object goes out as given, but not into a named context', () => {
    expect(check('Runtime.callFunctionOn', { functionDeclaration: 'f', objectId: 'o' }, 's-a').type).toBe('forward');
    for (const executionContextId of [1, 7]) {
        expect(
            check('Runtime.callFunctionOn', { functionDeclaration: 'f', objectId: 'o', executionContextId }, 's-a'),
        ).toMatchObject({ type: 'reject' });
    }
});

test('a client creates a named world of its own, as it asked for it', () => {
    expect(
        check('Page.createIsolatedWorld', { frameId: 'f', worldName: 'own', grantUniveralAccess: true }, 's-a'),
    ).toEqual({ type: 'createWorld', world: OWN_WORLD, sessionId: 's-a' });
    // Chrome creates a new world for every unnamed call, so one could not be created again by name.
    for (const params of [{ frameId: 'f' }, { frameId: 'f', worldName: '' }, { worldName: 'own' }]) {
        expect(check('Page.createIsolatedWorld', params, 's-a')).toMatchObject({ type: 'reject' });
    }
});

test("an init script lands in the isolated world unless it names one, after that world's prelude", () => {
    for (const worldName of [undefined, '']) {
        const expected: StealthDecision = {
            type: 'initScript',
            script: {
                sessionId: 's-a',
                params: { source: 'x', worldName: ISOLATED_WORLD_NAME },
                worldName: ISOLATED_WORLD_NAME,
            },
        };
        expect(check('Page.addScriptToEvaluateOnNewDocument', { source: 'x', worldName }, 's-a')).toEqual(expected);
    }
    expect(check('Page.addScriptToEvaluateOnNewDocument', { source: 'x', worldName: 'own' }, 's-a')).toMatchObject({
        script: { params: { source: 'x', worldName: 'own' }, worldName: 'own' },
    });
});

test("Page.navigate goes out without the client's referrer, as a typed URL does, keeping its other params", () => {
    const params = {
        url: 'https://example.com/',
        referrer: 'https://google.com/',
        referrerPolicy: 'origin',
        frameId: 'f',
    };
    const expected: StealthDecision = {
        type: 'forward',
        method: 'Page.navigate',
        params: { url: 'https://example.com/', frameId: 'f' },
        sessionId: 's-a',
    };
    expect(check('Page.navigate', params, 's-a')).toEqual(expected);
});
