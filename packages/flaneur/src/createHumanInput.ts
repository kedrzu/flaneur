import { createLogger } from '@nzyme/logging/createLogger.js';
import type { Logger } from '@nzyme/logging/Logger.js';
import { assertNever } from '@nzyme/utils/assertNever.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

import type { CdpEvent, CdpRequest } from './CdpTypes.js';
import type { SessionRegistry } from './createSessionRegistry.js';
import { findHandAction } from './findHandAction.js';
import type { HandAction } from './findHandAction.js';
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
     * and resolves with the command to send last, whose reply answers the client. A script call that does what a
     * hand does resolves, once the hand did it, with the call emptied of its script. Anything else resolves at once,
     * unchanged.
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
    /**
     * The node at the client's point when it was first aimed at, before the cursor moved (`readHit`): what a press
     * there should hit, and not a cover the cursor's way opened.
     */
    target?: number;
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

/** A box in the viewport, in CSS pixels. */
interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * What is at a client's point now, against the node it aimed at (`CHECK_TARGET`): that node or one inside it; a node
 * it is inside, as when the page moved; a cover over it, with the box the cover's whole stack spans; or nothing known.
 */
type TargetCheck = { relation: 'same' | 'beneath' | 'unknown' } | { relation: 'covered'; cover: Box };

/** Where the cursor goes off a cover (`findEscape`). */
interface EscapeParams {
    cover: Box;
    target: Point;
    viewport: Viewport;
    /** The how-manyth time the cursor moves off this cover, from 0: each goes to the next way out. */
    attempt: number;
}

/** A text field a client's script means to focus or clear (`READ_FIELD`). */
interface TextField {
    focused: boolean;
    empty: boolean;
    /** A one-line input, whose caret a click to the right of its text puts at the end. */
    line: boolean;
}

/** A key event's own parameters, as `Input.dispatchKeyEvent` takes them. */
interface KeyParams {
    type: 'rawKeyDown' | 'keyUp';
    key: string;
    code: string;
    windowsVirtualKeyCode: number;
    modifiers?: number;
    /** The editing commands of the key on macOS, where Chrome runs them only when named. */
    commands?: string[];
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
/** How many times the cursor moves off a cover over its target before it presses anyway. */
const MAX_COVER_ATTEMPTS = 3;
/** How long a cover may take to close once the cursor is off it, checked at this interval. */
const COVER_CLOSE_MS = 1500;
const COVER_CHECK_INTERVAL_MS = 100;
/** How far from the viewport's edge the cursor stays when it moves off a cover within the view. */
const VIEWPORT_EDGE_PX = 10;
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
/** What a client's script call is answered with once the hand did its work: nothing, as the script returns. */
const NO_FUNCTION = 'function () {}';
const NO_EXPRESSION = 'undefined';
/** Run on an element in the client's world: a `TextField`, or `null` for anything a click would not just focus. */
const READ_FIELD = `function () {
    const types = ['text', 'search', 'email', 'url', 'tel', 'password', 'number'];
    const line = this.localName === 'input' && types.includes(this.type);
    if (!(line || this.localName === 'textarea' || this.isContentEditable) || this.disabled || this.readOnly) {
        return null;
    }
    const value = this.isContentEditable ? this.textContent : this.value;
    return { focused: this.getRootNode().activeElement === this, empty: value === '', line };
}`;
/** Run on an element in the client's world: whether a point of the viewport hits it. */
const HITS_POINT = `function (x, y) {
    const hit = this.ownerDocument.elementFromPoint(x, y);
    return hit === this || this.contains(hit);
}`;

/**
 * Run on the node a client aimed at, in the proxy's isolated world, with the node now at its point: how the two relate
 * (`TargetCheck`). The target is the nearest control around the node (a link, a button, a label…), which a click
 * anywhere inside of activates and whose own hover may change what lies at the point (a product card's second image);
 * a node the page has since replaced is not known. A pseudo-element stands for its element. A cover's box spans it and
 * its ancestors up to the highest that does not hold the target: a mega menu and the header it hangs from.
 */
const CHECK_TARGET = `function (hit) {
    const CONTROLS = 'a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"], '
        + '[role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [onclick], [tabindex]';
    const element = node => node instanceof Node ? node : node.element;
    const parent = node => {
        const up = node.parentNode;
        return up instanceof ShadowRoot ? up.host : up;
    };
    const inside = (node, ancestor) => {
        for (let at = node; at != null; at = parent(at)) {
            if (at === ancestor) {
                return true;
            }
        }
        return false;
    };
    const node = element(this);
    if (!node.isConnected) {
        return { relation: 'unknown' };
    }
    const target = node.closest(CONTROLS) ?? node;
    let cover = element(hit);
    if (inside(cover, target)) {
        return { relation: 'same' };
    }
    if (inside(target, cover)) {
        return { relation: 'beneath' };
    }
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (;;) {
        const rect = cover.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            box.left = Math.min(box.left, rect.left);
            box.top = Math.min(box.top, rect.top);
            box.right = Math.max(box.right, rect.right);
            box.bottom = Math.max(box.bottom, rect.bottom);
        }
        const up = parent(cover);
        if (!(up instanceof Element) || inside(target, up)) {
            break;
        }
        cover = up;
    }
    return box.left < box.right ? { relation: 'covered', cover: box } : { relation: 'unknown' };
}`;

/**
 * Creates input as a person makes it. A client's mouse move becomes a curved path from where the cursor is, ending a
 * few pixels from the client's exact point; a press waits a hover dwell and a release follows a press after a human
 * time; a text inserted at once (`Input.insertText`) is typed key by key; a client's own key presses are held and
 * spaced like a typist's; a scroll into view (`DOM.scrollIntoViewIfNeeded`) of a node out of view is wheeled most of
 * the way, and a long wheel is split into notches. The first input on a freshly committed main document waits until
 * 1.5 to 3.5 s have passed since the commit, the cursor idling meanwhile. A document committed before the input saw
 * its page counts from its first input. A client's script call that does what a hand does (`findHandAction`:
 * agent-browser focusing or clearing a text field, scrolling into view or by an amount) is done by the hand instead.
 *
 * A cursor's way to a client's point can hover something that opens a cover over it (a header's mega menu over the
 * results below), which a client never sees, as its own input teleports. So the node at a point is read when the
 * client first aims at it, and again right before the press: when a cover hides it, the cursor moves off the cover,
 * waits for it to close, and comes back from the other side (`moveOffCover`).
 *
 * The input sends only plain Input commands, reads the page's layout (`DOM.getContentQuads`,
 * `Page.getLayoutMetrics`, `DOM.getNodeForLocation`) and reads nodes in an isolated world: nothing a page script
 * could tell from a person's hand. Anything else, touch and drag events included, goes as the client sent it.
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
                case 'Runtime.callFunctionOn':
                case 'Runtime.evaluate': {
                    const action = findHandAction(command);
                    return action == null ? command : performHandAction(call, action);
                }
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
                await rememberTarget(call, point);
                const path = await planMove(call, point);
                const end = await sendPath(call, path, command.params);
                page.lastMouseAt = clock.now();
                return { ...command, params: { ...command.params, ...end } };
            }
            case 'mousePressed': {
                await lookAtPage(call);
                await rememberTarget(call, point);
                let at = await reach(call, point);
                await waitUntil(page.lastMouseAt + randomBetween(random, 40, 160));
                at = await moveOffCover(call, point, at);
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
        if (cursor != null && aimedAt != null && isSamePoint(point, aimedAt)) {
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

    /** Reads the node at a point the client aims at for the first time, which a press there should hit. */
    async function rememberTarget(call: PageCommand, point: Point) {
        const { page } = call;
        if (page.aimedAt != null && isSamePoint(point, page.aimedAt)) {
            return;
        }
        page.target = await readHit(call, point);
    }

    /**
     * Makes sure a press at the client's point hits the node it aimed at. When a cover hides it (a menu the cursor's
     * way hovered open), the cursor moves off the cover, out of the box it spans or else out of the view
     * (`findEscape`), waits up to 1.5 s for it to close, and comes back to the point from there, so not across what opened it; three
     * times at most, then the press goes as it is and the client's own check tells it.
     * @returns Where the cursor stands, to press at.
     */
    async function moveOffCover(call: PageCommand, point: Point, at: Point): Promise<Point> {
        const { page } = call;
        const { target } = page;
        if (target == null) {
            return at;
        }
        let cursor = at;
        for (let attempt = 0; ; attempt++) {
            const check = await checkTarget(call, target, point);
            if (check.relation !== 'covered') {
                return cursor;
            }
            if (attempt === MAX_COVER_ATTEMPTS) {
                logger.debug('The target stays covered', { attempts: attempt });
                return cursor;
            }
            logger.debug('A cover hides the target, moving off it', { attempt });
            const viewport = await readViewport(call);
            await moveCursor(call, findEscape({ cover: check.cover, target: point, viewport, attempt }));
            await waitForUncovered(call, target, point);
            cursor = await reach(call, point);
            await sleep(randomBetween(random, 40, 160));
        }
    }

    /** Waits up to 1.5 s for nothing to cover the target any more. */
    async function waitForUncovered(call: PageCommand, target: number, point: Point) {
        const until = clock.now() + COVER_CLOSE_MS;
        while (clock.now() < until) {
            await sleep(COVER_CHECK_INTERVAL_MS);
            if ((await checkTarget(call, target, point)).relation !== 'covered') {
                return;
            }
        }
    }

    /**
     * Where the cursor goes off a cover: below the box it spans, else beside it, else out of the view by its nearer
     * side at the target's height, a later attempt taking the next of these; never above, where the cursor came from.
     * Out of the view the page sees the pointer leave the document (`mouseout` with no element to go to), as when a
     * hand leaves the window, and the way back in comes from the side, under whatever bar opened the cover.
     */
    function findEscape({ cover, target, viewport, attempt }: EscapeParams): Point {
        const margin = randomBetween(random, 30, 70);
        const ways: Point[] = [];
        if (cover.bottom + margin <= viewport.height - VIEWPORT_EDGE_PX) {
            ways.push({ x: target.x + randomBetween(random, -40, 40), y: cover.bottom + margin });
        }
        if (cover.right + margin <= viewport.width - VIEWPORT_EDGE_PX) {
            ways.push({ x: cover.right + margin, y: target.y });
        }
        if (cover.left - margin >= VIEWPORT_EDGE_PX) {
            ways.push({ x: cover.left - margin, y: target.y });
        }
        // Past a vertical scrollbar, which the view's width leaves out.
        const out = randomBetween(random, 20, 40);
        const outside = { x: target.x < viewport.width / 2 ? -out : viewport.width + out, y: target.y };
        const way = ways[attempt] ?? outside;
        return { x: Math.round(way.x), y: Math.round(way.y) };
    }

    /**
     * How the node now at a client's point relates to the node it aimed at. The same node needs no more than the hit
     * test; another is told apart in the proxy's isolated world (`CHECK_TARGET`).
     */
    async function checkTarget(call: PageCommand, target: number, point: Point): Promise<TargetCheck> {
        const hit = await readHit(call, point);
        if (hit == null) {
            return { relation: 'unknown' };
        }
        if (hit === target) {
            return { relation: 'same' };
        }
        const objects: string[] = [];
        try {
            for (const backendNodeId of [target, hit]) {
                const reply = await sendCommand(call, 'DOM.resolveNode', { backendNodeId });
                const object = isPlainObject(reply) ? reply['object'] : undefined;
                const objectId = isPlainObject(object) ? object['objectId'] : undefined;
                if (typeof objectId !== 'string') {
                    return { relation: 'unknown' };
                }
                objects.push(objectId);
            }
            const [targetObject, hitObject] = objects;
            const reply = await sendCommand(call, 'Runtime.callFunctionOn', {
                objectId: targetObject,
                functionDeclaration: CHECK_TARGET,
                arguments: [{ objectId: hitObject }],
                returnByValue: true,
            });
            return readTargetCheck(reply);
        } catch (error) {
            // The target is gone, or lives in another frame than the node now at its point.
            logger.debug('The target could not be checked', { error });
            return { relation: 'unknown' };
        } finally {
            for (const objectId of objects) {
                await sendCommand(call, 'Runtime.releaseObject', { objectId });
            }
        }
    }

    /**
     * The node at a point of the viewport, as a press there would hit it: the browser's hit test, which neither runs
     * page code nor changes what is hovered. It takes the point in the document, so the scroll is added.
     */
    async function readHit(call: PageCommand, point: Point) {
        try {
            const metrics = await sendCommand(call, 'Page.getLayoutMetrics', {});
            const viewport = isPlainObject(metrics) ? metrics['cssVisualViewport'] : undefined;
            const pageX = isPlainObject(viewport) && typeof viewport['pageX'] === 'number' ? viewport['pageX'] : 0;
            const pageY = isPlainObject(viewport) && typeof viewport['pageY'] === 'number' ? viewport['pageY'] : 0;
            const reply = await sendCommand(call, 'DOM.getNodeForLocation', {
                x: Math.round(point.x + pageX),
                y: Math.round(point.y + pageY),
            });
            const backendNodeId = isPlainObject(reply) ? reply['backendNodeId'] : undefined;
            return typeof backendNodeId === 'number' ? backendNodeId : undefined;
        } catch (error) {
            // Nothing at the point, as off the page's content.
            logger.debug('Nothing could be hit at a point', { error });
            return undefined;
        }
    }

    /** Moves the cursor along a path to `to` exactly, a point it is not aimed at for a client. */
    async function moveCursor(call: PageCommand, to: Point) {
        const { page } = call;
        const params = readMoveParams(call.command.params);
        const from = await findCursor(call);
        const end = await sendPath(call, planMousePath({ from, to, random }), params);
        await sendCommand(call, 'Input.dispatchMouseEvent', { ...params, type: 'mouseMoved', ...end });
        page.cursor = end;
        page.aimedAt = undefined;
        page.lastMouseAt = clock.now();
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

    /**
     * A client's script call that does what a hand does (`findHandAction`), done by the hand instead, and the call
     * then sent with no script, so the client gets the reply it expects: a text field is focused by clicking it and
     * cleared by selecting its text and pressing Backspace, and a scroll is wheeled. A field the hand would not
     * just focus by a click (a button, a select) is left to the client's script.
     */
    async function performHandAction(call: PageCommand, action: HandAction): Promise<CdpRequest> {
        const { command } = call;
        switch (action.type) {
            case 'focus':
            case 'clear': {
                const field = await readField(call, action.objectId);
                if (field == null) {
                    return command;
                }
                if (!field.focused) {
                    await clickField(call, action.objectId, field);
                    // The hand goes from the mouse to the keys.
                    await sleep(randomBetween(random, 250, 600));
                }
                if (action.type === 'clear' && !field.empty) {
                    await eraseField(call);
                }
                return withNoScript(command);
            }
            case 'scrollIntoView':
                await scrollIntoView(call, { objectId: action.objectId });
                return withNoScript(command);
            case 'scrollBy':
                await wheelBy(call, action);
                return withNoScript(command);
            case 'revealThenEvaluate':
                await revealProbed(call, action.probe);
                return command;
            default:
                return assertNever(action);
        }
    }

    async function readField(call: PageCommand, objectId: string): Promise<TextField | undefined> {
        const reply = await sendCommand(call, 'Runtime.callFunctionOn', {
            objectId,
            functionDeclaration: READ_FIELD,
            returnByValue: true,
        });
        const result = isPlainObject(reply) ? reply['result'] : undefined;
        const value = isPlainObject(result) ? result['value'] : undefined;
        if (!isPlainObject(value)) {
            return undefined;
        }
        return { focused: value['focused'] === true, empty: value['empty'] === true, line: value['line'] === true };
    }

    /**
     * Clicks a text field, wheeled into view first: in a one-line field with text, to the right of the text, so the
     * caret lands at its end, as where a script's focus leaves it matters to what is typed next.
     */
    async function clickField(call: PageCommand, objectId: string, field: TextField) {
        await scrollIntoView(call, { objectId });
        const quads = await sendCommand(call, 'DOM.getContentQuads', { objectId });
        const box = readBox(quads);
        if (box == null) {
            throw new Error('The field to focus has no box');
        }
        const centre = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
        let point = centre;
        if (field.line && !field.empty) {
            const end = { x: box.right - Math.min(10, (box.right - box.left) / 4), y: centre.y };
            const hit = await sendCommand(call, 'Runtime.callFunctionOn', {
                objectId,
                functionDeclaration: HITS_POINT,
                arguments: [{ value: end.x }, { value: end.y }],
                returnByValue: true,
            });
            const result = isPlainObject(hit) ? hit['result'] : undefined;
            point = isPlainObject(result) && result['value'] === true ? end : centre;
        }
        for (const type of ['mousePressed', 'mouseReleased']) {
            const params = { type, ...point, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 };
            const last = await performMouse({
                ...call,
                command: { method: 'Input.dispatchMouseEvent', params, sessionId: call.sessionId },
            });
            await sendCommand(call, last.method, last.params);
        }
    }

    /**
     * Selects the focused field's text with the platform's select-all chord and presses Backspace. On macOS Chrome
     * runs the editing command of a key sent over CDP only when it is named.
     */
    async function eraseField(call: PageCommand) {
        const mac = process.platform === 'darwin';
        const modifier = mac
            ? { key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91, bit: 4 }
            : { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, bit: 2 };
        const { key, code, windowsVirtualKeyCode, bit } = modifier;
        const keyA = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: bit };
        const backspace = { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 };
        await pressKey(call, { type: 'rawKeyDown', key, code, windowsVirtualKeyCode, modifiers: bit });
        await sleep(randomBetween(random, 40, 120));
        await pressKey(call, { type: 'rawKeyDown', ...keyA, ...(mac ? { commands: ['selectAll'] } : {}) });
        await pressKey(call, { type: 'keyUp', ...keyA });
        await sleep(randomBetween(random, 20, 80));
        await pressKey(call, { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers: 0 });
        await sleep(randomBetween(random, 100, 300));
        await pressKey(call, { type: 'rawKeyDown', ...backspace, ...(mac ? { commands: ['deleteBackward'] } : {}) });
        await pressKey(call, { type: 'keyUp', ...backspace });
    }

    /** Sends a key event the hand makes, spaced as a typist's (`performKey`). */
    async function pressKey(call: PageCommand, params: KeyParams) {
        const last = await performKey({
            ...call,
            command: { method: 'Input.dispatchKeyEvent', params: { ...params }, sessionId: call.sessionId },
        });
        await sendCommand(call, last.method, last.params);
    }

    /** Wheels a node into view (`performScroll`), then sends the scroll into view that finishes what the wheel left. */
    async function scrollIntoView(call: PageCommand, params: Record<string, unknown>) {
        const last = await performScroll({
            ...call,
            command: { method: 'DOM.scrollIntoViewIfNeeded', params, sessionId: call.sessionId },
        });
        await sendCommand(call, last.method, last.params);
    }

    /** A scroll by an amount, wheeled at the cursor, or at the centre of the element it scrolls when in view. */
    async function wheelBy(call: PageCommand, action: Extract<HandAction, { type: 'scrollBy' }>) {
        const { objectId, deltaX, deltaY } = action;
        let at = await findCursor(call);
        if (objectId != null) {
            const box = readBox(await sendCommand(call, 'DOM.getContentQuads', { objectId }));
            const viewport = await readViewport(call);
            if (box != null && box.top >= 0 && box.bottom <= viewport.height) {
                at = { x: Math.round((box.left + box.right) / 2), y: Math.round((box.top + box.bottom) / 2) };
            }
        }
        const params = { type: 'mouseWheel', ...at, deltaX, deltaY };
        const last = await performMouse({
            ...call,
            command: { method: 'Input.dispatchMouseEvent', params, sessionId: call.sessionId },
        });
        await sendCommand(call, last.method, last.params);
        await waitForScrollToSettle(call);
    }

    /**
     * Runs the probe of an evaluation that would scroll an element into view itself: when it gives the element, the
     * element is out of view and is wheeled in, so the evaluation then finds it in view and does not scroll.
     */
    async function revealProbed(call: PageCommand, probe: string) {
        const reply = await sendCommand(call, 'Runtime.evaluate', { expression: probe, returnByValue: false });
        const result = isPlainObject(reply) ? reply['result'] : undefined;
        const objectId = isPlainObject(result) ? result['objectId'] : undefined;
        if (typeof objectId !== 'string') {
            return;
        }
        try {
            if (isPlainObject(result) && result['subtype'] === 'node') {
                await scrollIntoView(call, { objectId });
            }
        } finally {
            await sendCommand(call, 'Runtime.releaseObject', { objectId });
        }
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
        while (until - clock.now() >= MIN_IDLE_MOVE_MS) {
            const from = await findCursor(call);
            const angle = randomBetween(random, 0, 2 * Math.PI);
            const distance = randomBetween(random, 15, 60);
            const to = {
                x: Math.round(Math.min(viewport.width - 1, Math.max(0, from.x + Math.cos(angle) * distance))),
                y: Math.round(Math.min(viewport.height - 1, Math.max(0, from.y + Math.sin(angle) * distance))),
            };
            await moveCursor(call, to);
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

/** Whether a client's point is the one it aimed at before. */
function isSamePoint(point: Point, aimedAt: Point) {
    return Math.hypot(point.x - aimedAt.x, point.y - aimedAt.y) <= SAME_POINT_PX;
}

/** What the proxy's isolated world answered of `CHECK_TARGET`. */
function readTargetCheck(reply: unknown): TargetCheck {
    const result = isPlainObject(reply) ? reply['result'] : undefined;
    const value = isPlainObject(result) ? result['value'] : undefined;
    if (!isPlainObject(value)) {
        return { relation: 'unknown' };
    }
    const { relation, cover } = value;
    switch (relation) {
        case 'same':
        case 'beneath':
            return { relation };
        case 'covered': {
            if (!isPlainObject(cover)) {
                return { relation: 'unknown' };
            }
            const { left, top, right, bottom } = cover;
            if (
                typeof left !== 'number' ||
                typeof top !== 'number' ||
                typeof right !== 'number' ||
                typeof bottom !== 'number'
            ) {
                return { relation: 'unknown' };
            }
            return { relation, cover: { left, top, right, bottom } };
        }
        default:
            return { relation: 'unknown' };
    }
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

/** A client's script call with its script taken out: what it answers is what an empty script returns. */
function withNoScript(command: CdpRequest): CdpRequest {
    const params =
        command.method === 'Runtime.evaluate'
            ? { ...command.params, expression: NO_EXPRESSION }
            : { ...command.params, functionDeclaration: NO_FUNCTION };
    return { ...command, params };
}

/** The box around the first quad of a `DOM.getContentQuads` reply, in the viewport; none for a node with no layout. */
function readBox(reply: unknown) {
    const quads = isPlainObject(reply) ? reply['quads'] : undefined;
    const quad: unknown = Array.isArray(quads) ? quads[0] : undefined;
    if (!Array.isArray(quad) || quad.length < 8) {
        return undefined;
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [index, value] of quad.entries()) {
        if (typeof value === 'number') {
            (index % 2 === 0 ? xs : ys).push(value);
        }
    }
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}
