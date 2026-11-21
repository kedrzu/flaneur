import { createLogger } from '@nzyme/logging/createLogger.js';
import type { Logger } from '@nzyme/logging/Logger.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

import type { CdpEvent, CdpRequest } from './CdpTypes.js';
import type { SessionRegistry } from './createSessionRegistry.js';
import { planMousePath } from './planMousePath.js';
import type { MousePathPoint, Point } from './planMousePath.js';
import { PAUSE_CHARACTERS, planTyping, sampleKeyInterval } from './planTyping.js';
import type { TimedCommand } from './planTyping.js';
import { randomBetween } from './randomBetween.js';
import { readTargetInfo } from './readTargetInfo.js';

/** The time and timers the input runs on; a test passes one it moves itself. */
export interface HumanInputClock {
    /** Milliseconds since the epoch, like `Date.now()`. */
    now(): number;
    /** Calls `callback` once after `ms`; whatever it returns is ignored. */
    setTimeout(callback: () => void, ms: number): unknown;
}

/** How the input moves, clicks and types; the defaults are a person's. */
export interface CreateHumanInputOptions {
    clock?: HumanInputClock;
    /** Uniform in `[0, 1)`, like `Math.random`, which it is by default; a test passes a seeded one. */
    random?: () => number;
    /** The mean time from one key press to the next when a text is typed; 90 ms by default, a fast typist. */
    typingIntervalMs?: number;
    /** The least time a freshly loaded page is looked at before its first input; 1.5 s by default. */
    minTimeOnPageMs?: number;
    /** The most time a freshly loaded page is looked at before its first input; 3.5 s by default. */
    maxTimeOnPageMs?: number;
    logger?: Logger;
}

/**
 * Input as a person's hand makes it, for every client of a browser: hand one to each launch that should have it.
 * Opaque: create it with `createHumanInput`.
 */
export interface HumanInput {
    /** Attaches the input to one browser run; the package's own. */
    readonly [ATTACH_HUMAN_INPUT]: (registry: HumanInputRegistry) => HumanInputRun;
}

/** The input attached to one browser run: it sees the run's events and performs its clients' input. */
export interface HumanInputRun {
    /**
     * Performs a client's command as a person would: sends what comes before it with `send`, on the command's session,
     * and resolves with the command to send last, whose reply answers the client. A command that is not input
     * resolves at once, unchanged.
     */
    perform(command: CdpRequest, send: HumanInputSend): Promise<CdpRequest>;
    /** Feeds a browser event of the run, after the session registry saw it. */
    observe(event: CdpEvent): void;
    /** The browser exited: what the run knew of its pages is forgotten. */
    detach(): void;
}

/** Sends a command the input makes on a client's behalf, on the client's session. */
export type HumanInputSend = (method: string, params: Record<string, unknown>, sessionId: string) => Promise<unknown>;

/** What the input reads of a run's sessions. */
export type HumanInputRegistry = Pick<SessionRegistry, 'getSessionTarget'>;

/** The key a `HumanInput` is attached by; not exported from the package, so only a launch attaches one. */
export const ATTACH_HUMAN_INPUT = Symbol('attachHumanInput');

/** What the input knows about one page. */
interface PageState {
    /** Where the cursor is; unknown until the first mouse input, which starts it somewhere in the viewport. */
    cursor?: Point;
    /** The client's point the cursor stands for: a client aims at an element's centre, the cursor lands near it. */
    aimedAt?: Point;
    /** When the last mouse event went. */
    lastMouseAt: number;
    /** When the last mouse button went down. */
    pressedAt: number;
    /** When the current main document committed; unknown for one committed before the input saw the page. */
    committedAt?: number;
    /** The loader of the current main document, which every session of the page reports. */
    loaderId?: string;
    /** The current document had its time on page. */
    looked: boolean;
    /** When the last key event went, and the last key went down. */
    lastKeyAt: number;
    lastKeyDownAt: number;
    /** The last text typed ended with a space or punctuation, after which a typist pauses. */
    afterPause: boolean;
    /** When each key that is down went down. */
    keysDown: Map<string, number>;
}

/** A client's command on its page. */
interface PageCommand {
    page: PageState;
    command: CdpRequest;
    sessionId: string;
    send: HumanInputSend;
}

/** A page's viewport, in CSS pixels. */
interface Viewport {
    width: number;
    height: number;
}

const SECOND_MS = 1000;
const TYPING_INTERVAL_MS = 90;
const MIN_TIME_ON_PAGE_MS = 1.5 * SECOND_MS;
const MAX_TIME_ON_PAGE_MS = 3.5 * SECOND_MS;
/** The viewport assumed when the page does not tell its own. */
const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 720 };
/** How far from the client's point the cursor lands; with rounding to a whole pixel, within 3 px of it. */
const MAX_AIM_ERROR_PX = 2.2;
/** A client's point this close to the one it aimed at last is that one. */
const SAME_POINT_PX = 0.5;
/** A key event this soon after the previous one is a client typing, given a typist's interval. */
const TYPING_GAP_MS = 40;
const WHEEL_NOTCH_PX = 100;
/** A client's wheel by more than this is split into notches. */
const MAX_WHEEL_DELTA_PX = 150;
/** The most notches a scroll into view is wheeled; the rest is the client's own scroll. */
const MAX_WHEEL_NOTCHES = 40;
/** How long the page's scroll may take to settle after wheeling, checked at this interval. */
const SCROLL_SETTLE_CHECKS = 12;
const SCROLL_SETTLE_INTERVAL_MS = 50;
/** Idle moves on a fresh page go on while at least this much of its time remains. */
const MIN_IDLE_MOVE_MS = 400;

/**
 * Creates input as a person makes it. A client's mouse move becomes a curved path from where the cursor is, ending a
 * few pixels from the client's exact point; a press waits a hover dwell and a release follows a press after a human
 * time; a text inserted at once (`Input.insertText`) is typed key by key; a client's own key presses are held and
 * spaced like a typist's; a scroll into view (`DOM.scrollIntoViewIfNeeded`) of a node out of view is wheeled most of
 * the way, and a long wheel is split into notches. The first input on a freshly committed main document waits until
 * 1.5 to 3.5 s have passed since the commit, the cursor idling meanwhile. A document committed before the input saw
 * its page counts from its first input.
 *
 * The input sends only plain Input commands and reads only the page's layout (`DOM.getContentQuads`,
 * `Page.getLayoutMetrics`): nothing a page script could tell from a person's hand. Anything else, touch and drag events
 * included, goes as the client sent it.
 */
export function createHumanInput(options: CreateHumanInputOptions = {}): HumanInput {
    const clock = options.clock ?? { now: () => Date.now(), setTimeout: (callback, ms) => setTimeout(callback, ms) };
    const random = options.random ?? Math.random;
    const typingIntervalMs = options.typingIntervalMs ?? TYPING_INTERVAL_MS;
    const minTimeOnPageMs = options.minTimeOnPageMs ?? MIN_TIME_ON_PAGE_MS;
    const maxTimeOnPageMs = options.maxTimeOnPageMs ?? MAX_TIME_ON_PAGE_MS;
    const logger = options.logger ?? createLogger('HumanInput');

    return { [ATTACH_HUMAN_INPUT]: attach };

    function attach(registry: HumanInputRegistry): HumanInputRun {
        const pages = new Map<string, PageState>();

        return { perform, observe, detach: () => pages.clear() };

        async function perform(command: CdpRequest, send: HumanInputSend): Promise<CdpRequest> {
            const { sessionId } = command;
            const targetId = sessionId == null ? undefined : registry.getSessionTarget(sessionId);
            if (sessionId == null || targetId == null) {
                return command;
            }
            const call: PageCommand = { page: getPage(targetId), command, sessionId, send };
            switch (command.method) {
                case 'Input.dispatchMouseEvent':
                    return performMouse(call);
                case 'Input.dispatchKeyEvent':
                    return performKey(call);
                case 'Input.insertText':
                    return performText(call);
                case 'DOM.scrollIntoViewIfNeeded':
                    return performScroll(call);
                default:
                    return command;
            }
        }

        function observe(event: CdpEvent) {
            const params = isPlainObject(event.params) ? event.params : {};
            switch (event.method) {
                case 'Page.frameNavigated': {
                    const targetId = event.sessionId == null ? undefined : registry.getSessionTarget(event.sessionId);
                    const { frame } = params;
                    // A page target's main frame has the target's id.
                    if (
                        targetId == null ||
                        !isPlainObject(frame) ||
                        frame['id'] !== targetId ||
                        frame['parentId'] != null
                    ) {
                        return;
                    }
                    const page = getPage(targetId);
                    const loaderId = typeof frame['loaderId'] === 'string' ? frame['loaderId'] : undefined;
                    if (loaderId != null && loaderId === page.loaderId) {
                        return;
                    }
                    page.loaderId = loaderId;
                    page.committedAt = clock.now();
                    page.looked = false;
                    return;
                }
                case 'Target.targetDestroyed': {
                    const targetId = readTargetInfo(params)?.targetId ?? params['targetId'];
                    if (typeof targetId === 'string') {
                        pages.delete(targetId);
                    }
                    break;
                }
            }
        }

        function getPage(targetId: string) {
            let page = pages.get(targetId);
            if (!page) {
                page = {
                    lastMouseAt: -Infinity,
                    pressedAt: -Infinity,
                    looked: false,
                    lastKeyAt: -Infinity,
                    lastKeyDownAt: -Infinity,
                    afterPause: false,
                    keysDown: new Map(),
                };
                pages.set(targetId, page);
            }
            return page;
        }
    }

    async function performMouse(call: PageCommand): Promise<CdpRequest> {
        const { page, command } = call;
        const { type, x, y } = command.params;
        if (typeof x !== 'number' || typeof y !== 'number') {
            return command;
        }
        const point = { x, y };
        switch (type) {
            case 'mouseMoved': {
                await lookAtPage(call);
                const path = await planMove(call, point);
                const end = await sendPath(call, path, command.params);
                page.lastMouseAt = clock.now();
                return { ...command, params: { ...command.params, ...end } };
            }
            case 'mousePressed': {
                await lookAtPage(call);
                const at = await reach(call, point);
                await waitUntil(page.lastMouseAt + randomBetween(random, 40, 160));
                page.pressedAt = clock.now();
                page.lastMouseAt = page.pressedAt;
                return { ...command, params: { ...command.params, ...at } };
            }
            case 'mouseReleased': {
                const at = await reach(call, point);
                await waitUntil(page.pressedAt + randomBetween(random, 50, 130));
                page.lastMouseAt = clock.now();
                return { ...command, params: { ...command.params, ...at } };
            }
            case 'mouseWheel': {
                await lookAtPage(call);
                const at = await reach(call, point);
                const wheel = await sendWheel(call, at);
                page.lastMouseAt = clock.now();
                return wheel;
            }
            default:
                return command;
        }
    }

    /**
     * Where the cursor is for a client's point: where it landed when the client aimed at that point last, else at the
     * end of a path the input moves it along first, as a hand would before it clicks.
     */
    async function reach(call: PageCommand, point: Point) {
        const { page } = call;
        const { aimedAt, cursor } = page;
        if (
            cursor != null &&
            aimedAt != null &&
            Math.hypot(point.x - aimedAt.x, point.y - aimedAt.y) <= SAME_POINT_PX
        ) {
            return cursor;
        }
        const path = await planMove(call, point);
        const end = await sendPath(call, path, readMoveParams(call.command.params));
        await sendCommand(call, 'Input.dispatchMouseEvent', {
            ...readMoveParams(call.command.params),
            type: 'mouseMoved',
            ...end,
        });
        page.lastMouseAt = clock.now();
        return end;
    }

    /** A path from the cursor to a point a few pixels from `point`, which the cursor then stands at, aimed at `point`. */
    async function planMove(call: PageCommand, point: Point) {
        const { page } = call;
        const from = await findCursor(call);
        const angle = randomBetween(random, 0, 2 * Math.PI);
        const error = randomBetween(random, 0, MAX_AIM_ERROR_PX);
        const to = {
            x: Math.round(point.x + Math.cos(angle) * error),
            y: Math.round(point.y + Math.sin(angle) * error),
        };
        page.cursor = to;
        page.aimedAt = point;
        return planMousePath({ from, to, random });
    }

    /** Sends a path's moves with `params`, but its last, which it waits for and returns. */
    async function sendPath(call: PageCommand, path: MousePathPoint[], params: Record<string, unknown>) {
        const last = path.at(-1);
        for (const { x, y, delayMs } of path.slice(0, -1)) {
            await sleep(delayMs);
            await sendCommand(call, 'Input.dispatchMouseEvent', { ...params, type: 'mouseMoved', x, y });
        }
        if (last == null) {
            return call.page.cursor ?? { x: 0, y: 0 };
        }
        await sleep(last.delayMs);
        return { x: last.x, y: last.y };
    }

    /** A client's wheel at `at`, split into notches about 100 px each when it scrolls further than 150 px. */
    async function sendWheel(call: PageCommand, at: Point): Promise<CdpRequest> {
        const { command } = call;
        const deltaX = typeof command.params['deltaX'] === 'number' ? command.params['deltaX'] : 0;
        const deltaY = typeof command.params['deltaY'] === 'number' ? command.params['deltaY'] : 0;
        const largest = Math.max(Math.abs(deltaX), Math.abs(deltaY));
        const notches = largest > MAX_WHEEL_DELTA_PX ? Math.round(largest / WHEEL_NOTCH_PX) : 1;
        let restX = deltaX;
        let restY = deltaY;
        for (let notch = 1; notch < notches; notch++) {
            const share = randomBetween(random, 0.9, 1.1) / notches;
            await sendCommand(call, 'Input.dispatchMouseEvent', {
                ...command.params,
                ...at,
                deltaX: Math.round(deltaX * share),
                deltaY: Math.round(deltaY * share),
            });
            restX -= Math.round(deltaX * share);
            restY -= Math.round(deltaY * share);
            await sleep(randomBetween(random, 30, 80));
        }
        return { ...command, params: { ...command.params, ...at, deltaX: restX, deltaY: restY } };
    }

    /**
     * A client's key event, spaced as a typist's: a key press right after the previous key event comes a typing
     * interval after the previous press, and a key's release comes 30 to 90 ms after its press.
     */
    async function performKey(call: PageCommand): Promise<CdpRequest> {
        const { page, command } = call;
        const { type } = command.params;
        const key = readKeyName(command.params);
        switch (type) {
            case 'keyDown':
            case 'rawKeyDown': {
                await lookAtPage(call);
                if (clock.now() - page.lastKeyAt < TYPING_GAP_MS) {
                    await waitUntil(page.lastKeyDownAt + sampleKeyInterval(random, typingIntervalMs, false));
                }
                page.lastKeyDownAt = clock.now();
                page.keysDown.set(key, page.lastKeyDownAt);
                break;
            }
            case 'keyUp': {
                const downAt = page.keysDown.get(key);
                if (downAt != null) {
                    await waitUntil(downAt + randomBetween(random, 30, 90));
                }
                page.keysDown.delete(key);
                break;
            }
        }
        page.lastKeyAt = clock.now();
        return command;
    }

    /** A text inserted at once, typed key by key instead (`planTyping`). */
    async function performText(call: PageCommand): Promise<CdpRequest> {
        const { page, command } = call;
        const { text } = command.params;
        if (typeof text !== 'string' || text === '') {
            return command;
        }
        await lookAtPage(call);
        // A client that inserts a text character by character (agent-browser's `type`) sends the next right after the
        // previous one's reply: it starts a typing interval after the previous key press, not at once.
        if (clock.now() - page.lastKeyAt < TYPING_GAP_MS) {
            await waitUntil(page.lastKeyDownAt + sampleKeyInterval(random, typingIntervalMs, page.afterPause));
        }
        const commands = planTyping({ text, random, intervalMs: typingIntervalMs });
        const last = await sendTimed(call, commands);
        page.lastKeyAt = clock.now();
        page.lastKeyDownAt = page.lastKeyAt - findTimeSinceLastKeyDown(commands);
        page.afterPause = PAUSE_CHARACTERS.test(text.at(-1) ?? '');
        return last;
    }

    /**
     * A scroll into view of a node out of view: wheeled at the cursor in notches until the node is about centred, then
     * sent itself once the page's scroll has settled, finishing what the wheel left.
     */
    async function performScroll(call: PageCommand): Promise<CdpRequest> {
        const { command } = call;
        const { nodeId, backendNodeId, objectId } = command.params;
        let distance;
        try {
            const reply = await sendCommand(call, 'DOM.getContentQuads', { nodeId, backendNodeId, objectId });
            const viewport = await readViewport(call);
            distance = findScrollDistance(reply, viewport);
        } catch (error) {
            // A node with no layout: the client's own command says so.
            logger.debug('A node to scroll into view has no quads', { error });
            return command;
        }
        const notches =
            distance == null ? 0 : Math.min(MAX_WHEEL_NOTCHES, Math.floor(Math.abs(distance) / WHEEL_NOTCH_PX));
        if (distance == null || notches === 0) {
            return command;
        }
        await lookAtPage(call);
        const at = await findCursor(call);
        for (let notch = 0; notch < notches; notch++) {
            await sleep(randomBetween(random, 30, 80));
            await sendCommand(call, 'Input.dispatchMouseEvent', {
                type: 'mouseWheel',
                ...at,
                deltaX: 0,
                deltaY: Math.sign(distance) * Math.round(randomBetween(random, 0.9, 1.1) * WHEEL_NOTCH_PX),
            });
        }
        call.page.lastMouseAt = clock.now();
        await waitForScrollToSettle(call);
        return command;
    }

    /** Waits until two readings of the page's scroll, 50 ms apart, agree: a wheel scrolls smoothly, over time. */
    async function waitForScrollToSettle(call: PageCommand) {
        let before = await readScroll(call);
        for (let check = 0; check < SCROLL_SETTLE_CHECKS; check++) {
            await sleep(SCROLL_SETTLE_INTERVAL_MS);
            const now = await readScroll(call);
            if (now === before) {
                return;
            }
            before = now;
        }
    }

    async function readScroll(call: PageCommand) {
        const metrics = await sendCommand(call, 'Page.getLayoutMetrics', {});
        const layout = isPlainObject(metrics) ? metrics['cssLayoutViewport'] : undefined;
        return isPlainObject(layout) ? `${String(layout['pageX'])},${String(layout['pageY'])}` : '';
    }

    /**
     * The first input on a freshly committed main document waits until the page has been looked at for 1.5 to 3.5 s,
     * the cursor making a few small moves meanwhile. A document committed before the input saw its page counts from
     * now.
     */
    async function lookAtPage(call: PageCommand) {
        const { page } = call;
        if (page.looked) {
            return;
        }
        page.looked = true;
        const until = (page.committedAt ?? clock.now()) + randomBetween(random, minTimeOnPageMs, maxTimeOnPageMs);
        if (until - clock.now() < MIN_IDLE_MOVE_MS) {
            await waitUntil(until);
            return;
        }
        const viewport = await readViewport(call);
        const params = readMoveParams(call.command.params);
        while (until - clock.now() >= MIN_IDLE_MOVE_MS) {
            const from = await findCursor(call);
            const angle = randomBetween(random, 0, 2 * Math.PI);
            const distance = randomBetween(random, 15, 60);
            const to = {
                x: Math.round(Math.min(viewport.width - 1, Math.max(0, from.x + Math.cos(angle) * distance))),
                y: Math.round(Math.min(viewport.height - 1, Math.max(0, from.y + Math.sin(angle) * distance))),
            };
            const end = await sendPath(call, planMousePath({ from, to, random }), params);
            await sendCommand(call, 'Input.dispatchMouseEvent', { ...params, type: 'mouseMoved', ...end });
            page.cursor = end;
            page.aimedAt = undefined;
            await sleep(Math.min(randomBetween(random, 150, 500), Math.max(0, until - clock.now())));
        }
        page.lastMouseAt = clock.now();
        await waitUntil(until);
    }

    /** Where the cursor is; the first time, somewhere in the middle of the viewport, as a hand left it. */
    async function findCursor(call: PageCommand) {
        const { page } = call;
        if (page.cursor != null) {
            return page.cursor;
        }
        const { width, height } = await readViewport(call);
        const cursor = {
            x: Math.round(width * randomBetween(random, 0.15, 0.85)),
            y: Math.round(height * randomBetween(random, 0.15, 0.85)),
        };
        page.cursor = cursor;
        return cursor;
    }

    async function readViewport(call: PageCommand): Promise<Viewport> {
        try {
            const metrics = await sendCommand(call, 'Page.getLayoutMetrics', {});
            const layout = isPlainObject(metrics) ? metrics['cssLayoutViewport'] : undefined;
            const width = isPlainObject(layout) ? layout['clientWidth'] : undefined;
            const height = isPlainObject(layout) ? layout['clientHeight'] : undefined;
            if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
                return { width, height };
            }
        } catch (error) {
            logger.debug('The viewport could not be read', { error });
        }
        return DEFAULT_VIEWPORT;
    }

    /** Sends timed commands but the last, which it waits for and returns, on the client's session. */
    async function sendTimed(call: PageCommand, commands: TimedCommand[]): Promise<CdpRequest> {
        const last = commands.at(-1);
        if (last == null) {
            return call.command;
        }
        for (const { delayMs, method, params } of commands.slice(0, -1)) {
            await sleep(delayMs);
            await sendCommand(call, method, params);
        }
        await sleep(last.delayMs);
        return { method: last.method, params: last.params, sessionId: call.sessionId };
    }

    function sendCommand(call: PageCommand, method: string, params: Record<string, unknown>) {
        return call.send(method, params, call.sessionId);
    }

    async function waitUntil(at: number) {
        await sleep(at - clock.now());
    }

    async function sleep(ms: number) {
        if (ms <= 0) {
            return;
        }
        await new Promise<void>(resolve => {
            clock.setTimeout(resolve, ms);
        });
    }
}

/**
 * How far the page must scroll down (negative: up) to bring a node's centre to the middle of the viewport; `null` when
 * the node is in view already, or has no box.
 */
function findScrollDistance(reply: unknown, viewport: Viewport) {
    const quads = isPlainObject(reply) ? reply['quads'] : undefined;
    const quad: unknown = Array.isArray(quads) ? quads[0] : undefined;
    if (!Array.isArray(quad) || quad.length < 8) {
        return null;
    }
    const ys: number[] = [];
    for (const [index, value] of quad.entries()) {
        if (index % 2 === 1 && typeof value === 'number') {
            ys.push(value);
        }
    }
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    if (top >= 0 && bottom <= viewport.height) {
        return null;
    }
    return (top + bottom) / 2 - viewport.height / 2;
}

/** How long before the last of `commands` their last key press went: 0 when there is none. */
function findTimeSinceLastKeyDown(commands: TimedCommand[]) {
    let since = 0;
    for (const { delayMs, params } of commands.toReversed()) {
        if (params['type'] === 'keyDown') {
            return since;
        }
        since += delayMs;
    }
    return 0;
}

/** What a client's mouse event says of the hand beyond the point: its modifiers, and the buttons a drag holds. */
function readMoveParams(params: Record<string, unknown>) {
    const { type, modifiers, button, buttons } = params;
    const held = type === 'mouseReleased' ? { button, buttons } : {};
    return modifiers == null ? held : { ...held, modifiers };
}

/** The key a key event names, to match its release to its press. */
function readKeyName(params: Record<string, unknown>) {
    const { key, code } = params;
    if (typeof key === 'string') {
        return key;
    }
    return typeof code === 'string' ? code : '';
}
