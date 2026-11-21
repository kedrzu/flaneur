import { expect, test } from 'bun:test';

import { createTestLogger } from '@nzyme/logging/createTestLogger.js';

import type { CdpEvent, CdpRequest } from './CdpTypes.js';
import { createSessionRegistry } from './createSessionRegistry.js';
import { ATTACH_SITE_PACE, createSitePace } from './createSitePace.js';
import type { CreateSitePaceOptions, SitePaceClock, SitePaceRun, SitePaceVerdict } from './createSitePace.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const GRACE = 20 * SECOND;

test('a second load of a site waits out 5 s from the first, other sites go at once, www. is the same site', async () => {
    const { run, clock, emit } = setup();
    emit(pageUrl('T1', 'https://www.shop.pl/'));
    emit(documentResponse('S1', 'T1', 'L1', 'https://www.shop.pl/', 200));

    clock.advance(2 * SECOND);
    const held = track(run.gate(navigate('https://shop.pl/search')));
    expect(await track(run.gate(navigate('https://other.pl/'))).settled()).toEqual({ type: 'go' });
    expect(await held.settled()).toBeUndefined();
    clock.advance(3 * SECOND - 1);
    expect(await held.settled()).toBeUndefined();
    clock.advance(1);
    expect(await held.settled()).toEqual({ type: 'go' });
});

test('commands let through together take one slot each, and a wait over 15 s is refused', async () => {
    const { run, clock, logs } = setup();
    const gates = [1, 2, 3, 4].map(() => track(run.gate(navigate('https://shop.pl/'))));
    const refused = await run.gate(navigate('https://shop.pl/'));

    expect(refused).toEqual({
        type: 'refuse',
        message: 'shop.pl is paced at one page load every 5 s: the next action on it is possible in 20 s.',
    });
    expect(await gates[0]!.settled()).toEqual({ type: 'go' });
    for (const gate of gates.slice(1)) {
        clock.advance(5 * SECOND - 1);
        expect(await gate.settled()).toBeUndefined();
        clock.advance(1);
        expect(await gate.settled()).toEqual({ type: 'go' });
    }
    expect(logs.filter(log => log.message === 'A command was refused to keep the pace').map(log => log.data)).toEqual([
        { site: 'shop.pl', method: 'Page.navigate', reason: 'busy', waitMs: 20 * SECOND },
    ]);
});

test('a block pauses its site for 5 minutes, then doubles the interval for the rest of the hour', async () => {
    const { run, clock, emit, logs } = setup();
    emit(pageUrl('T1', 'https://shop.pl/'));
    // Two sessions on the page both report the load: still one block.
    emit(documentResponse('S1', 'T1', 'L1', 'https://shop.pl/', 403));
    emit(documentResponse('S2', 'T1', 'L1', 'https://shop.pl/', 403));
    clock.advance(GRACE);

    clock.advance(MINUTE);
    expect(await run.gate(navigate('https://shop.pl/'))).toEqual({
        type: 'refuse',
        message:
            'shop.pl is paced after it blocked or challenged the browser: the next action on it is possible in 4 min.',
    });
    expect(await track(run.gate(navigate('https://other.pl/'))).settled()).toEqual({ type: 'go' });

    clock.advance(4 * MINUTE);
    expect(await track(run.gate(navigate('https://shop.pl/'))).settled()).toEqual({ type: 'go' });
    const doubled = track(run.gate(navigate('https://shop.pl/')));
    clock.advance(10 * SECOND - 1);
    expect(await doubled.settled()).toBeUndefined();
    clock.advance(1);
    expect(await doubled.settled()).toEqual({ type: 'go' });

    clock.advance(55 * MINUTE);
    expect(await track(run.gate(navigate('https://shop.pl/'))).settled()).toEqual({ type: 'go' });
    const normal = track(run.gate(navigate('https://shop.pl/')));
    clock.advance(5 * SECOND);
    expect(await normal.settled()).toEqual({ type: 'go' });
    expect(logs.filter(log => log.message === 'A site showed a block').map(log => log.data)).toEqual([
        { site: 'shop.pl', reason: 'status 403', recentBlocks: 1 },
    ]);
});

test('a second block within the hour stops the site until an hour after it, then it is forgotten', async () => {
    const { run, clock, emit } = setup();
    emit(pageUrl('T1', 'https://shop.pl/'));
    emit(documentResponse('S1', 'T1', 'L1', 'https://shop.pl/', 429));
    clock.advance(30 * MINUTE);
    emit(documentResponse('S1', 'T1', 'L2', 'https://shop.pl/', 403));
    clock.advance(GRACE);

    const stopped: SitePaceVerdict = {
        type: 'refuse',
        message: 'shop.pl blocked or challenged the browser twice in a short time, so acting on it is stopped for now.',
    };
    expect(await run.gate(navigate('https://shop.pl/'))).toEqual(stopped);
    // The first block is an hour old here; the stop still runs from the second.
    clock.advance(45 * MINUTE);
    expect(await run.gate(navigate('https://shop.pl/'))).toEqual(stopped);
    clock.advance(15 * MINUTE);
    expect(await track(run.gate(navigate('https://shop.pl/'))).settled()).toEqual({ type: 'go' });
});

test("every refusal's text comes from the messages given, with the site, the wait and the interval", async () => {
    const { run, clock, emit } = setup({
        messages: {
            paused: (site, waitMs, afterBlock, intervalMs) => `paused ${site} ${waitMs} ${afterBlock} ${intervalMs}`,
            stopped: site => `stopped ${site}`,
        },
    });
    for (let i = 0; i < 4; i++) {
        void run.gate(navigate('https://busy.pl/'));
    }
    expect(await run.gate(navigate('https://busy.pl/'))).toEqual({
        type: 'refuse',
        message: 'paused busy.pl 20000 false 5000',
    });

    emit(pageUrl('T1', 'https://shop.pl/'));
    emit(documentResponse('S1', 'T1', 'L1', 'https://shop.pl/', 403));
    clock.advance(GRACE + MINUTE);
    expect(await run.gate(navigate('https://shop.pl/'))).toEqual({
        type: 'refuse',
        message: 'paused shop.pl 240000 true 10000',
    });
    clock.advance(4 * MINUTE);
    for (let i = 0; i < 2; i++) {
        void run.gate(navigate('https://shop.pl/'));
    }
    expect(await run.gate(navigate('https://shop.pl/'))).toEqual({
        type: 'refuse',
        message: 'paused shop.pl 20000 true 10000',
    });

    emit(documentResponse('S1', 'T1', 'L2', 'https://shop.pl/', 429));
    clock.advance(GRACE);
    expect(await run.gate(navigate('https://shop.pl/'))).toEqual({ type: 'refuse', message: 'stopped shop.pl' });
});

test("a vendor's challenge request blocks the page's site once per document; ordinary scripts do not", async () => {
    const { run, clock, emit } = setup();
    emit(pageUrl('T1', 'https://shop.pl/'));
    emit(documentResponse('S1', 'T1', 'L1', 'https://shop.pl/', 200));
    for (const url of [
        'https://shop.pl/cdn-cgi/challenge-platform/scripts/jsd/main.js',
        'https://www.google.com/recaptcha/api.js',
        'https://challenges.cloudflare.com/turnstile/v0/api.js',
        'https://client.perimeterx.net/PXabc/main.min.js',
    ]) {
        emit(request('S1', url));
    }
    clock.advance(5 * SECOND);
    expect(await track(run.gate(navigate('https://shop.pl/'))).settled()).toEqual({ type: 'go' });

    emit(documentResponse('S1', 'T1', 'L2', 'https://shop.pl/', 200));
    emit(request('S1', 'https://geo.captcha-delivery.com/captcha/?initialCid=x'));
    emit(request('S1', 'https://ct.captcha-delivery.com/c.js'));
    clock.advance(GRACE);
    const verdict = await run.gate(navigate('https://shop.pl/'));
    expect(verdict.type === 'refuse' ? verdict.message : undefined).toContain('after it blocked or challenged');

    for (const url of [
        'https://shop.pl/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=1',
        'https://captcha.px-cdn.net/PXabc/captcha.js',
        'https://collector-pxabc.px-cdn.net/captcha/x',
    ]) {
        const { run: other, clock: otherClock, emit: emitOther } = setup();
        emitOther(pageUrl('T1', 'https://shop.pl/'));
        emitOther(documentResponse('S1', 'T1', 'L1', 'https://shop.pl/', 200));
        emitOther(request('S1', url));
        otherClock.advance(GRACE);
        expect(await other.gate(navigate('https://shop.pl/'))).toMatchObject({ type: 'refuse' });
    }
});

test('a challenge frame the main frame holds blocks its site; one nested in another subframe does not, and is logged once per frame', async () => {
    const { run, clock, emit, logs } = setup();
    emit(pageUrl('T1', 'https://shop.pl/'));
    emit(documentResponse('S1', 'T1', 'L1', 'https://shop.pl/', 200));
    // leboncoin.fr, 2026-11-21: the hidden sign-in frame is answered with DataDome's CAPTCHA, which loads its script
    // there and its own frame inside it.
    emit(frameAttached('S1', 'AUTH', 'T1'));
    emit(request('S1', 'https://ct.captcha-delivery.com/c.js', { frameId: 'AUTH', type: 'Script' }));
    emit(frameAttached('S1', 'CAPTCHA', 'AUTH'));
    emit(request('S1', 'https://geo.captcha-delivery.com/captcha/?cid=1', { frameId: 'CAPTCHA', type: 'Document' }));
    emit(request('S1', 'https://geo.captcha-delivery.com/captcha/?cid=2', { frameId: 'CAPTCHA', type: 'Document' }));
    clock.advance(GRACE);
    expect(await track(run.gate(navigate('https://shop.pl/'))).settled()).toEqual({ type: 'go' });
    expect(
        logs.filter(log => log.message === 'A challenge nested in a subframe does not count as a block'),
    ).toHaveLength(2);

    // DataDome's overlay over the page after a blocked XHR: its frame is the main frame's own child.
    emit(documentResponse('S1', 'T1', 'L2', 'https://shop.pl/', 200));
    emit(frameAttached('S1', 'OVERLAY', 'T1'));
    emit(request('S1', 'https://geo.captcha-delivery.com/captcha/?cid=3', { frameId: 'OVERLAY', type: 'Document' }));
    clock.advance(GRACE);
    expect(await run.gate(navigate('https://shop.pl/'))).toMatchObject({ type: 'refuse' });
});

test('a 403 page with its challenge frame counts as one block', async () => {
    const { run, clock, emit, logs } = setup();
    emit(pageUrl('T1', 'https://shop.pl/'));
    emit(documentResponse('S1', 'T1', 'L1', 'https://shop.pl/', 403));
    emit(frameAttached('S1', 'CHALLENGE', 'T1'));
    emit(request('S1', 'https://geo.captcha-delivery.com/captcha/?cid=1', { frameId: 'CHALLENGE', type: 'Document' }));
    clock.advance(GRACE);

    expect(await run.gate(navigate('https://shop.pl/'))).toMatchObject({ type: 'refuse' });
    expect(logs.filter(log => log.message === 'A site showed a block').map(log => log.data)).toEqual([
        { site: 'shop.pl', reason: 'status 403', recentBlocks: 1 },
    ]);
});

test("an out-of-process iframe's own document and challenge block no site", async () => {
    const { run, clock, emit, logs } = setup();
    emit({
        method: 'Target.targetInfoChanged',
        params: { targetInfo: { targetId: 'T3', type: 'iframe', url: 'https://geo.captcha-delivery.com/captcha/' } },
    });
    emit(documentResponse('S3', 'T3', 'L1', 'https://geo.captcha-delivery.com/captcha/', 403));
    emit(request('S3', 'https://geo.captcha-delivery.com/captcha/check', { frameId: 'T3', type: 'XHR' }));
    clock.advance(GRACE);

    expect(await track(run.gate(navigate('https://geo.captcha-delivery.com/'))).settled()).toEqual({ type: 'go' });
    expect(logs.filter(log => log.message === 'A site showed a block')).toEqual([]);
});

test("loads of a subframe or on a session of the proxy don't count; one of an ungrouped client does", async () => {
    const { run, clock, emit } = setup();
    emit(documentResponse('S1', 'T1', 'L1', 'https://shop.pl/', 403, 'FRAME'));
    emit(documentResponse('S9', 'T9', 'L2', 'https://shop.pl/', 403));
    clock.advance(GRACE);
    expect(await track(run.gate(navigate('https://shop.pl/'))).settled()).toEqual({ type: 'go' });

    emit(documentResponse('S3', 'T3', 'L3', 'https://other.pl/', 403));
    clock.advance(GRACE);
    expect(await run.gate(navigate('https://other.pl/'))).toMatchObject({ type: 'refuse' });
});

test("a click and Enter wait for the page's last load but take no slot; moves, typing and a double click's second press do not wait", async () => {
    const { run, clock, emit } = setup();
    emit(pageUrl('T1', 'https://shop.pl/'));
    emit(documentResponse('S1', 'T1', 'L1', 'https://shop.pl/', 200));

    for (const command of [
        input('Input.dispatchMouseEvent', { type: 'mouseMoved' }),
        input('Input.dispatchMouseEvent', { type: 'mousePressed', clickCount: 2 }),
        input('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a' }),
        input('Input.insertText', { text: 'buty' }),
    ]) {
        expect(await track(run.gate(command)).settled()).toEqual({ type: 'go' });
    }
    const click = track(run.gate(input('Input.dispatchMouseEvent', { type: 'mousePressed', clickCount: 1 })));
    const enter = track(run.gate(input('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter' })));
    clock.advance(5 * SECOND - 1);
    expect(await click.settled()).toBeUndefined();
    expect(await enter.settled()).toBeUndefined();
    clock.advance(1);
    expect(await click.settled()).toEqual({ type: 'go' });
    expect(await enter.settled()).toEqual({ type: 'go' });
    // With no load since, the next click goes at once.
    expect(await track(run.gate(input('Input.dispatchMouseEvent', { type: 'mousePressed' }))).settled()).toEqual({
        type: 'go',
    });
});

test('a held command is refused when its site gets blocked while it waits', async () => {
    const { run, clock, emit } = setup({ blockGraceMs: 2 * SECOND });
    emit(pageUrl('T1', 'https://shop.pl/'));
    emit(documentResponse('S1', 'T1', 'L1', 'https://shop.pl/', 200));
    const held = track(run.gate(navigate('https://shop.pl/next')));
    emit(documentResponse('S1', 'T1', 'L2', 'https://shop.pl/blocked', 403));
    clock.advance(5 * SECOND);

    expect(await held.settled()).toMatchObject({ type: 'refuse' });
});

test("agent-browser's back and forward wait like a click and are refused on a paused site; other scripts go", async () => {
    const { run, clock, emit } = setup();
    emit(pageUrl('T1', 'https://shop.pl/'));
    emit(documentResponse('S1', 'T1', 'L1', 'https://shop.pl/', 200));
    const back = track(run.gate(input('Runtime.evaluate', { expression: 'history.back()' })));
    expect(await track(run.gate(input('Runtime.evaluate', { expression: 'document.title' }))).settled()).toEqual({
        type: 'go',
    });
    clock.advance(5 * SECOND);
    expect(await back.settled()).toEqual({ type: 'go' });

    emit(documentResponse('S1', 'T1', 'L2', 'https://shop.pl/blocked', 403));
    clock.advance(GRACE);
    expect(await run.gate(input('Runtime.evaluate', { expression: 'history.forward()' }))).toMatchObject({
        type: 'refuse',
    });
});

test("a block the page gets past within the grace never counts, and the site's commands go meanwhile", async () => {
    const { run, clock, emit, logs } = setup();
    emit(pageUrl('T1', 'https://shop.pl/'));
    // Kasada: a 429 interstitial solves its proof of work and reloads, twice here.
    emit(documentResponse('S1', 'T1', 'L1', 'https://shop.pl/', 429));
    clock.advance(5 * SECOND);
    const click = input('Input.dispatchMouseEvent', { type: 'mousePressed' });
    expect(await track(run.gate(click)).settled()).toEqual({ type: 'go' });
    emit(documentResponse('S1', 'T1', 'L2', 'https://shop.pl/', 429));
    clock.advance(5 * SECOND);
    emit(documentResponse('S1', 'T1', 'L3', 'https://www.shop.pl/', 200));

    clock.advance(GRACE);
    expect(await track(run.gate(click)).settled()).toEqual({ type: 'go' });
    expect(await track(run.gate(navigate('https://shop.pl/'))).settled()).toEqual({ type: 'go' });
    expect(logs.filter(log => log.message === 'A site showed a block')).toEqual([]);
    expect(logs.filter(log => log.message === 'A site let the browser past its block').map(log => log.data)).toEqual([
        { site: 'shop.pl', reason: 'status 429' },
    ]);
});

test("a block not got past within the grace counts from its end, and another site's document does not get past it", async () => {
    const { run, clock, emit, logs } = setup();
    emit(pageUrl('T1', 'https://shop.pl/'));
    emit(documentResponse('S1', 'T1', 'L1', 'https://shop.pl/', 429));
    emit(documentResponse('S1', 'T1', 'L2', 'https://other.pl/', 200));
    clock.advance(GRACE - 1);
    expect(await track(run.gate(navigate('https://shop.pl/'))).settled()).toEqual({ type: 'go' });

    clock.advance(1);
    expect(await run.gate(navigate('https://shop.pl/'))).toMatchObject({ type: 'refuse' });
    expect(await track(run.gate(navigate('https://other.pl/'))).settled()).toEqual({ type: 'go' });
    // A real document after the grace is too late.
    emit(documentResponse('S1', 'T1', 'L3', 'https://shop.pl/', 200));
    expect(await run.gate(navigate('https://shop.pl/'))).toMatchObject({ type: 'refuse' });
    expect(logs.filter(log => log.message === 'A site showed a block').map(log => log.data)).toEqual([
        { site: 'shop.pl', reason: 'status 429', recentBlocks: 1 },
    ]);
});

test('a trailing root dot names the same site', async () => {
    const { run, clock, emit } = setup();
    emit(pageUrl('T1', 'https://shop.pl/'));
    emit(documentResponse('S1', 'T1', 'L1', 'https://shop.pl/', 403));
    clock.advance(GRACE);

    expect(await run.gate(navigate('https://shop.pl./'))).toMatchObject({ type: 'refuse' });
});

test("a run attached after another keeps the sites' slots and blocks, but none of the pages; a detached run forgets its pages", async () => {
    const { pace, run, clock, emit } = setup();
    emit(pageUrl('T3', 'https://blocked.pl/'));
    emit(documentResponse('S3', 'T3', 'L2', 'https://blocked.pl/', 403));
    clock.advance(GRACE);
    emit(pageUrl('T1', 'https://shop.pl/'));
    emit(documentResponse('S1', 'T1', 'L1', 'https://shop.pl/', 200));
    run.detach();
    const click = input('Input.dispatchMouseEvent', { type: 'mousePressed' });
    // The page's URL is gone, so a click on it acts on no known site.
    expect(await track(run.gate(click)).settled()).toEqual({ type: 'go' });

    const next = pace[ATTACH_SITE_PACE](createRegistry());
    expect(await track(next.gate(click)).settled()).toEqual({ type: 'go' });
    expect(await next.gate(navigate('https://blocked.pl/'))).toMatchObject({ type: 'refuse' });
    const held = track(next.gate(navigate('https://shop.pl/')));
    expect(await held.settled()).toBeUndefined();
    clock.advance(5 * SECOND);
    expect(await held.settled()).toEqual({ type: 'go' });
});

/**
 * A pace over a fake browser run with page `T1` of group `group-a` (sessions `S1`, `S2` of two clients), page `T3` of an
 * ungrouped client (`S3`) and a session of the proxy (`S9` on `T9`), and a clock moved by `advance()`.
 */
function setup(options: Omit<CreateSitePaceOptions, 'clock' | 'logger'> = {}) {
    const { logger, logs } = createTestLogger('test');
    const clock = createFakeClock();
    const pace = createSitePace({ ...options, clock, logger });
    const run: SitePaceRun = pace[ATTACH_SITE_PACE](createRegistry());
    return { pace, run, clock, logs, emit: (event: CdpEvent) => run.observe(event) };
}

function createRegistry() {
    const registry = createSessionRegistry();
    registry.claimTarget('group-a', 'T1');
    registry.claimSession({ type: 'client', clientId: 'c1' }, 'S1', 'T1');
    registry.claimSession({ type: 'client', clientId: 'c2' }, 'S2', 'T1');
    registry.claimSession({ type: 'client', clientId: 'c3' }, 'S3', 'T3');
    registry.claimSession({ type: 'proxy' }, 'S9', 'T9');
    return registry;
}

/** A promise whose verdict can be read without waiting: `settled()` gives it, or `undefined` while it is pending. */
function track(promise: Promise<SitePaceVerdict>) {
    let verdict: SitePaceVerdict | undefined;
    void promise.then(value => {
        verdict = value;
        return value;
    });
    return {
        async settled() {
            // Lets the promise chain run.
            for (let i = 0; i < 10; i++) {
                await Promise.resolve();
            }
            return verdict;
        },
    };
}

function navigate(url: string): CdpRequest {
    return { method: 'Page.navigate', params: { url }, sessionId: 'S1' };
}

function input(method: string, params: Record<string, unknown>): CdpRequest {
    return { method, params, sessionId: 'S1' };
}

function pageUrl(targetId: string, url: string): CdpEvent {
    return { method: 'Target.targetInfoChanged', params: { targetInfo: { targetId, type: 'page', url } } };
}

function documentResponse(
    sessionId: string,
    targetId: string,
    requestId: string,
    url: string,
    status: number,
    frameId = targetId,
): CdpEvent {
    return {
        method: 'Network.responseReceived',
        sessionId,
        params: { requestId, loaderId: requestId, frameId, type: 'Document', response: { url, status } },
    };
}

function request(sessionId: string, url: string, frame: RequestFrame = {}): CdpEvent {
    return { method: 'Network.requestWillBeSent', sessionId, params: { requestId: url, ...frame, request: { url } } };
}

/** The frame a request is made in and its resource type, as `Network.requestWillBeSent` reports them. */
interface RequestFrame {
    frameId?: string;
    type?: string;
}

function frameAttached(sessionId: string, frameId: string, parentFrameId: string): CdpEvent {
    return { method: 'Page.frameAttached', sessionId, params: { frameId, parentFrameId } };
}

/** A clock whose time moves only by `advance()`, which runs the timers due by then. */
function createFakeClock() {
    let now = 1_700_000_000_000;
    const timers: FakeTimer[] = [];
    const clock: SitePaceClock & { advance(ms: number): void } = {
        now: () => now,
        setTimeout(callback, ms) {
            timers.push({ at: now + ms, callback });
        },
        advance(ms) {
            const until = now + ms;
            while (true) {
                const due = timers.filter(timer => timer.at <= until).toSorted((a, b) => a.at - b.at)[0];
                if (!due) {
                    break;
                }
                timers.splice(timers.indexOf(due), 1);
                now = due.at;
                due.callback();
            }
            now = until;
        },
    };
    return clock;
}

interface FakeTimer {
    at: number;
    callback: () => void;
}
