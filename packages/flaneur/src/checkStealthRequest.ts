import type { CdpRequest } from './CdpTypes.js';
import type { ExecutionContexts } from './createExecutionContexts.js';
import { ISOLATED_WORLD_NAME } from './createIsolatedWorlds.js';
import type { ClientWorld, InitScript, IsolatedCall } from './createIsolatedWorlds.js';

/** What the proxy does with a request that passed its other checks. */
export type StealthDecision =
    /** Send it to the browser as given here (params may be rebuilt), on `sessionId` when set. */
    | { type: 'forward'; method: string; params: Record<string, unknown>; sessionId?: string }
    /** Run it in an isolated world: the proxy's, or the client's own it named (`IsolatedWorlds.send`). */
    | { type: 'isolate'; call: IsolatedCall }
    /** Register a client's init script after the proxy's prelude for its world (`IsolatedWorlds.addInitScript`). */
    | { type: 'initScript'; script: InitScript }
    /** Create the client's own isolated world on `sessionId` and give it an id (`ExecutionContexts.createWorld`). */
    | { type: 'createWorld'; world: ClientWorld; sessionId: string }
    /** Tell the client of the contexts of `sessionId` (`ExecutionContexts.enable`); the browser's Runtime stays off. */
    | { type: 'enableRuntime'; sessionId: string }
    /** Stop telling the client of the contexts of `sessionId` (`ExecutionContexts.disable`). */
    | { type: 'disableRuntime'; sessionId: string }
    /** Answer the client with `result` without touching the browser. */
    | { type: 'reply'; result: object }
    /** Answer the client with a CDP error carrying `message`. */
    | { type: 'reject'; message: string };

/**
 * The Runtime methods a client may call, besides `enable` and `disable`, which the proxy answers itself: evaluating
 * and calling functions (both sent to an isolated world), and what works on objects those returned (properties,
 * awaiting, releasing), plus resuming a target held for the debugger. The rest is refused: `compileScript`,
 * `runScript` and `queryObjects` act in a context the client names by id, which may be the page's own world; a
 * binding (`addBinding`) exists for page code to call.
 */
const RUNTIME_METHODS = new Set([
    'evaluate',
    'callFunctionOn',
    'getProperties',
    'awaitPromise',
    'releaseObject',
    'releaseObjectGroup',
    'runIfWaitingForDebugger',
]);

/** Refused because they let a client step around the per-message checks or reach the proxy's own state; with why. */
const REFUSED_METHODS: Record<string, string> = {
    'Target.sendMessageToTarget': 'use a flat session: Target.attachToTarget sends every command through these checks',
    'Target.exposeDevToolsProtocol': 'it gives page code a binding into CDP',
    'Target.attachToBrowserTarget': "the browser target's session is the proxy's",
    'Target.autoAttachRelated':
        "its sessions could not be told apart from the proxy's own; use Target.setAutoAttach on a session",
    'Target.createBrowserContext': "browser contexts are the proxy's",
    'Target.disposeBrowserContext': "browser contexts are the proxy's",
    'Target.setRemoteLocations': 'it changes target discovery for every client',
    'Target.openDevTools': 'a DevTools window drives the browser past these checks',
    'Target.getDevToolsTarget': 'a DevTools window drives the browser past these checks',
    'Browser.close': "the browser's lifetime is the proxy's",
    'Browser.crash': "the browser's lifetime is the proxy's",
    'Browser.crashGpuProcess': "the browser's lifetime is the proxy's",
};

/**
 * Applies the proxy's stealth rules to a request that passed the session, target and policy checks. Page scripts must
 * never observe a client's code: an enabled Runtime, Console or Debugger domain is measurable from the page (an
 * Error logged while Runtime is enabled has its stack formatted, which calls the page's `Error.prepareStackTrace`), so
 * the proxy answers their `enable` and `disable` itself and never sends them (Runtime's on a session tells the client
 * of the proxy's own execution contexts, `createExecutionContexts`); every evaluation, resolved node and init script
 * goes to an isolated world (`ISOLATED_WORLD_NAME`, or one the client created itself), never the page's own;
 * Runtime is open only by method (`RUNTIME_METHODS`), Console and Debugger not at all. The user agent is the proxy's
 * (`createBrandOverride`): Emulation's and Network's `setUserAgentOverride` are refused, as a client's override would
 * replace the brand while its session lives. A `javascript:` URL is refused where it would be navigated to, as it runs
 * in the page's own world. A navigation goes without the client's `referrer`: Chrome sends a `Page.navigate` as a
typed URL (`Sec-Fetch-Site: none`), and one carrying a `Referer` too is a request no person's browser makes. Every
isolated world runs the proxy's prelude before any client code (`WORLD_PRELUDE`), so Playwright's internal DOM events
never reach the page. A few more methods are refused because they step around the per-message checks or reach the
 * proxy's own state (`REFUSED_METHODS`).
 * @__NO_SIDE_EFFECTS__
 */
export function checkStealthRequest(request: CdpRequest, contexts: Pick<ExecutionContexts, 'find'>): StealthDecision {
    const { method, params, sessionId } = request;
    const domain = method.slice(0, method.indexOf('.'));
    if (Object.hasOwn(REFUSED_METHODS, method)) {
        return reject(`${method} is not allowed: ${REFUSED_METHODS[method]}`);
    }

    switch (method) {
        case 'Runtime.enable':
            return sessionId == null ? { type: 'reply', result: {} } : { type: 'enableRuntime', sessionId };
        case 'Runtime.disable':
            return sessionId == null ? { type: 'reply', result: {} } : { type: 'disableRuntime', sessionId };
        case 'Console.enable':
        case 'Console.disable':
        case 'Debugger.enable':
        case 'Debugger.disable':
            return { type: 'reply', result: {} };
        case 'Runtime.evaluate':
            return checkIsolated(request, 'contextId', contexts);
        case 'Runtime.callFunctionOn':
        case 'DOM.resolveNode':
            return checkIsolated(request, 'executionContextId', contexts);
        case 'Page.createIsolatedWorld':
            return checkCreateWorld(request);
        case 'Runtime.addBinding':
            // A binding exists for page code to call; one in an isolated world never could, so it would do nothing.
            return reject(`${method} is not allowed: page code must not call the client's functions`);
        case 'Page.addScriptToEvaluateOnLoad':
            // Deprecated and world-less: the page's own world would run it.
            return reject(`${method} is not allowed: use Page.addScriptToEvaluateOnNewDocument`);
        case 'Page.addScriptToEvaluateOnNewDocument': {
            if (sessionId == null) {
                return reject(`${method} must be sent on a session of a page`);
            }
            const worldName =
                typeof params['worldName'] === 'string' && params['worldName'] !== ''
                    ? params['worldName']
                    : ISOLATED_WORLD_NAME;
            return { type: 'initScript', script: { sessionId, params: { ...params, worldName }, worldName } };
        }
        case 'Emulation.setUserAgentOverride':
        case 'Network.setUserAgentOverride':
            return reject(`${method} is not allowed: the browser's identity is set by the proxy`);
        case 'Page.navigate': {
            if (isScriptUrl(params['url'])) {
                return reject(`${method}: a javascript: URL would run in the page's own world`);
            }
            const navigation = { ...params };
            delete navigation['referrer'];
            delete navigation['referrerPolicy'];
            return forward(request, navigation);
        }
        case 'Target.createTarget':
            return isScriptUrl(params['url'])
                ? reject(`${method}: a javascript: URL would run in the page's own world`)
                : forward(request);
    }

    switch (domain) {
        case 'Runtime':
            return RUNTIME_METHODS.has(method.slice(domain.length + 1))
                ? forward(request)
                : reject(`${method} is not allowed: page scripts could observe it`);
        case 'Console':
        case 'Debugger':
            return reject(`${method} is not allowed: page scripts could observe it`);
        case 'Fetch':
            // On the browser target, interception pauses every page's requests, which no client is told about.
            return sessionId == null ? reject(`${method} must be sent on a session of a page`) : forward(request);
        default:
            return forward(request);
    }
}

/**
 * A call that runs code or creates an object in an execution context: the proxy always picks the context, never
 * forwarding a number. A context id is not proof of a world: Chrome reuses ids across renderer processes, so an id an
 * isolated world had can name the page's own world after a cross-site navigation. So with no context named the call
 * goes to the proxy's isolated world, and an id the proxy gave the client (`ExecutionContexts.find`) stands for its
 * isolated world, which is created again by frame and name; an id of a worker's context, of a document gone, or any
 * other id is refused, and none reaches the browser. A call on an object (`Runtime.callFunctionOn` with
 * `objectId`) runs where the object lives: a client calls functions on objects its own isolated calls returned, and an
 * object a page event carries lives in the page's world, which a client set on reaching it can reach through the DOM
 * anyway.
 */
function checkIsolated(
    request: CdpRequest,
    contextParam: IsolatedCall['contextParam'],
    contexts: Pick<ExecutionContexts, 'find'>,
): StealthDecision {
    const { method, sessionId } = request;
    if (sessionId == null) {
        return reject(`${method} must be sent on a session of a page`);
    }
    const { [contextParam]: contextId, ...params } = request.params;
    const otherParam = contextParam === 'contextId' ? 'executionContextId' : 'contextId';
    if (params[otherParam] != null || params['uniqueContextId'] != null) {
        return reject(`${method}: only ${contextParam} can name an execution context`);
    }
    if (contextId == null) {
        return params['objectId'] != null && method === 'Runtime.callFunctionOn'
            ? forward(request)
            : { type: 'isolate', call: { method, params, sessionId, contextParam } };
    }
    const context = typeof contextId === 'number' ? contexts.find(sessionId, contextId) : undefined;
    if (context?.type === 'worker') {
        return reject(`${method}: Code cannot run in a worker`);
    }
    if (context == null || params['objectId'] != null) {
        return reject(
            `${method}: code runs only in isolated worlds, so ${contextParam} must name one you created ` +
                'with Page.createIsolatedWorld or one announced for the current document',
        );
    }
    return { type: 'isolate', call: { method, params, sessionId, contextParam, world: context.world } };
}

/**
 * A client's own isolated world, rebuilt from what it is recorded by. A name is required: Chrome creates a new world
 * for each call with an empty name, which a later call by context id could not be sent to again.
 */
function checkCreateWorld(request: CdpRequest): StealthDecision {
    const { method, params, sessionId } = request;
    const { frameId, worldName } = params;
    if (sessionId == null) {
        return reject(`${method} must be sent on a session of a page`);
    }
    if (typeof frameId !== 'string' || typeof worldName !== 'string' || worldName === '') {
        return reject(`${method}: name the world and its frame`);
    }
    return {
        type: 'createWorld',
        world: { frameId, worldName, grantUniveralAccess: params['grantUniveralAccess'] === true },
        sessionId,
    };
}

/** Whether a URL is a `javascript:` one, as the browser would parse it: case and surrounding blanks do not matter. */
function isScriptUrl(url: unknown) {
    return typeof url === 'string' && URL.parse(url)?.protocol === 'javascript:';
}

function forward(request: CdpRequest, params = request.params): StealthDecision {
    return request.sessionId == null
        ? { type: 'forward', method: request.method, params }
        : { type: 'forward', method: request.method, params, sessionId: request.sessionId };
}

function reject(message: string): StealthDecision {
    return { type: 'reject', message };
}
