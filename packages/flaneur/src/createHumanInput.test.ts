import { expect, test } from 'bun:test';

import { assert } from '@nzyme/utils/assert.js';

import type { CdpRequest } from './CdpTypes.js';
import { ATTACH_HUMAN_INPUT, createHumanInput } from './createHumanInput.js';
import type { CreateHumanInputOptions, HumanInputClock } from './createHumanInput.js';
import { planMousePath } from './planMousePath.js';
import type { MousePathPoint } from './planMousePath.js';
import { planTyping } from './planTyping.js';
import type { TimedCommand } from './planTyping.js';

/** A command the input sent, and when. */
interface SentInput {
    at: number;
    method: string;
    params: Record<string, unknown>;
}

const SEEDS = Array.from({ length: 40 }, (_, index) => index + 1);
const VIEWPORT = { clientWidth: 1280, clientHeight: 720, pageX: 0, pageY: 0 };

test('a mouse path curves from start to end within Fitts time, reporting every 8 to 16 ms, and sometimes overshoots', () => {
    let overshoots = 0;
    for (const seed of SEEDS) {
        const from = { x: 100, y: 600 };
        const to = { x: 900, y: 200 };
        const path = planMousePath({ from, to, random: createRandom(seed) });

        expect(path.at(-1)).toMatchObject(to);
        expect(path.length).toBeGreaterThan(20);
        const duration = sumDelays(path);
        expect(duration).toBeGreaterThanOrEqual(150);
        expect(duration).toBeLessThanOrEqual(700 + 160 + 90 + 16);
        for (const point of path) {
            expect(point.delayMs).toBeGreaterThanOrEqual(8);
            expect(Number.isInteger(point.x) && Number.isInteger(point.y)).toBe(true);
        }
        // Off the straight line: a hand does not draw with a ruler.
        expect(Math.max(...path.map(point => distanceFromLine(point, from, to)))).toBeGreaterThan(1);
        if (path.some(point => point.x > to.x + 2)) {
            overshoots++;
        }
    }
    expect(overshoots).toBeGreaterThan(0);
    expect(overshoots).toBeLessThan(SEEDS.length / 2);
});

test('a short move is quicker than a long one, and a move of a pixel or two is a single report', () => {
    const random = createRandom(7);
    const short = planMousePath({ from: { x: 100, y: 100 }, to: { x: 130, y: 100 }, random });
    const long = planMousePath({ from: { x: 0, y: 0 }, to: { x: 1200, y: 700 }, random });

    expect(sumDelays(short)).toBeLessThan(sumDelays(long));
    const tiny = planMousePath({ from: { x: 100, y: 100 }, to: { x: 101, y: 101 }, random });
    expect(tiny).toHaveLength(1);
    expect(tiny[0]).toMatchObject({ x: 101, y: 101 });
});

test('typing gives every character its key press and release on a US keyboard, with Shift around capitals and symbols', () => {
    const commands = planTyping({ text: 'Hi!\n', random: createRandom(3), intervalMs: 90 });

    expect(commands.map(command => describeKey(command))).toEqual([
        'rawKeyDown Shift ShiftLeft 16',
        'keyDown H KeyH 72 text=H shift',
        'keyUp H KeyH 72 shift',
        'keyUp Shift ShiftLeft 16',
        'keyDown i KeyI 73 text=i',
        'keyUp i KeyI 73',
        'rawKeyDown Shift ShiftLeft 16',
        'keyDown ! Digit1 49 text=! shift',
        'keyUp ! Digit1 49 shift',
        'keyUp Shift ShiftLeft 16',
        'keyDown Enter Enter 13 text=\r',
        'keyUp Enter Enter 13',
    ]);
});

test('typing spaces key presses 30 to 300 ms apart and holds each key 30 to 90 ms', () => {
    for (const seed of SEEDS) {
        const commands = planTyping({ text: 'the quick brown fox jumps', random: createRandom(seed), intervalMs: 90 });
        const timed = withTimes(commands);
        const downs = timed.filter(command => command.params['type'] === 'keyDown');
        expect(downs).toHaveLength(25);
        for (const [index, down] of downs.entries()) {
            const previous = downs[index - 1];
            if (previous != null) {
                expect(down.at - previous.at).toBeGreaterThanOrEqual(30);
                expect(down.at - previous.at).toBeLessThanOrEqual(300);
            }
            const up = timed.find(
                command =>
                    command.params['type'] === 'keyUp' &&
                    command.params['key'] === down.params['key'] &&
                    command.at >= down.at,
            );
            assert(up, 'every key press has its release');
            expect(up.at - down.at).toBeGreaterThanOrEqual(30);
            expect(up.at - down.at).toBeLessThanOrEqual(90);
        }
    }
});

test('a character no US key gives is a key press with its text alone, and one a key event cannot carry is inserted', () => {
    const commands = planTyping({ text: 'ł😀👨‍👩‍👧', random: createRandom(5), intervalMs: 90 });

    expect(commands.map(({ method, params }) => ({ method, params }))).toEqual([
        { method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'ł', text: 'ł', unmodifiedText: 'ł' } },
        { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: 'ł' } },
        { method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: '😀', text: '😀', unmodifiedText: '😀' } },
        { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: '😀' } },
        { method: 'Input.insertText', params: { text: '👨‍👩‍👧' } },
    ]);
});

test('a long text is typed faster, in the time 200 characters take, and what does not fit is inserted at the end', () => {
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40);
    const commands = planTyping({ text, random: createRandom(9), intervalMs: 90 });

    expect(sumDelays(commands)).toBeLessThan(200 * 90 * 1.1);
    const last = commands.at(-1);
    assert(last, 'something is typed');
    expect(last.method).toBe('Input.insertText');
    const typed = commands.filter(command => command.params['type'] === 'keyDown').length;
    expect(typed + String(last.params['text']).length).toBe(text.length);
    expect(typed).toBeGreaterThan(200);
});

test("a client's click becomes a path, a hover dwell and a human press, at a point within 3 px of its aim", async () => {
    const offsets = new Set<string>();
    for (const seed of SEEDS.slice(0, 10)) {
        const { run, sent, clock } = prepare({ random: createRandom(seed) });
        await run.perform(click('mouseMoved', 400, 300), run.send);
        clock.advance(5000);
        sent.length = 0;

        const moved = await run.perform(click('mouseMoved', 640.5, 360.5), run.send);
        const path = sent.splice(0);
        const movedAt = clock.now();
        const pressed = await run.perform(click('mousePressed', 640.5, 360.5), run.send);
        const pressedAt = clock.now();
        const released = await run.perform(click('mouseReleased', 640.5, 360.5), run.send);

        expect(path.length).toBeGreaterThan(10);
        expect(path.every(command => command.params['type'] === 'mouseMoved')).toBe(true);
        expect(sent).toEqual([]);
        const point = { x: moved.params['x'], y: moved.params['y'] };
        assert(typeof point.x === 'number' && typeof point.y === 'number', 'the move keeps a point');
        expect(Math.hypot(point.x - 640.5, point.y - 360.5)).toBeLessThanOrEqual(3);
        offsets.add(`${point.x},${point.y}`);
        expect(pressed.params).toEqual({ ...click('mousePressed', 0, 0).params, ...point });
        expect(released.params).toEqual({ ...click('mouseReleased', 0, 0).params, ...point });
        expect(pressedAt - movedAt).toBeGreaterThanOrEqual(40);
        expect(pressedAt - movedAt).toBeLessThanOrEqual(160);
        expect(clock.now() - pressedAt).toBeGreaterThanOrEqual(50);
        expect(clock.now() - pressedAt).toBeLessThanOrEqual(130);
    }
    expect(offsets.size).toBeGreaterThan(1);
});

test('a press with no move before it first moves the cursor there', async () => {
    const { run, sent, clock } = prepare({});
    await run.perform(click('mouseMoved', 100, 100), run.send);
    clock.advance(5000);
    sent.length = 0;

    const pressed = await run.perform(click('mousePressed', 900, 500), run.send);

    expect(sent.length).toBeGreaterThan(10);
    expect(sent.at(-1)?.params).toMatchObject({ type: 'mouseMoved', x: pressed.params['x'], y: pressed.params['y'] });
});

test('the first input on a fresh document waits 1.5 to 3.5 s from its commit with idle moves, and the next does not', async () => {
    for (const seed of SEEDS.slice(0, 10)) {
        const { run, sent, clock } = prepare({ random: createRandom(seed) });
        const committedAt = clock.now();
        run.observe({
            method: 'Page.frameNavigated',
            params: { frame: { id: 'page-1', loaderId: 'l-1' } },
            sessionId: 's-1',
        });

        await run.perform(click('mouseMoved', 600, 400), run.send);
        const looked = clock.now() - committedAt;
        const movesWhileLooking = sent.filter(command => command.params['type'] === 'mouseMoved').length;
        const before = clock.now();
        await run.perform(click('mouseMoved', 300, 200), run.send);

        expect(looked).toBeGreaterThanOrEqual(1500);
        expect(looked).toBeLessThanOrEqual(3500 + 1000);
        expect(movesWhileLooking).toBeGreaterThan(10);
        expect(clock.now() - before).toBeLessThan(1000);
    }
});

test('an inserted text is typed key by key, the last key release answering the client', async () => {
    const { run, sent, clock } = prepare({});
    await run.perform(click('mouseMoved', 1, 1), run.send);
    clock.advance(5000);
    sent.length = 0;

    const last = await run.perform(
        { method: 'Input.insertText', params: { text: 'Zażółć' }, sessionId: 's-1' },
        run.send,
    );

    const typed = [...sent, { at: clock.now(), method: last.method, params: last.params }]
        .filter(command => command.params['type'] === 'keyDown')
        .map(command => command.params['text']);
    expect(typed).toEqual(['Z', 'a', 'ż', 'ó', 'ł', 'ć']);
    expect(last).toMatchObject({ method: 'Input.dispatchKeyEvent', params: { type: 'keyUp' }, sessionId: 's-1' });
});

test('a text inserted character by character is typed at a typing interval, not key press after key press', async () => {
    const { run, sent, clock } = prepare({});
    await run.perform(click('mouseMoved', 1, 1), run.send);
    clock.advance(5000);
    const downs: number[] = [];
    for (const character of 'hello') {
        sent.length = 0;
        const start = clock.now();
        const last = await run.perform(
            { method: 'Input.insertText', params: { text: character }, sessionId: 's-1' },
            run.send,
        );
        const down = sent.find(command => command.params['type'] === 'keyDown');
        assert(down, 'the character is pressed');
        downs.push(down.at);
        expect(last.params).toMatchObject({ type: 'keyUp', key: character });
        expect(clock.now()).toBeGreaterThan(start);
    }
    for (const [index, at] of downs.entries()) {
        const previous = downs[index - 1];
        if (previous != null) {
            expect(at - previous).toBeGreaterThanOrEqual(45);
            expect(at - previous).toBeLessThanOrEqual(300);
        }
    }
});

test("a client's own key press is held 30 to 90 ms, and a key press right after a key event comes a typing interval after the previous press", async () => {
    const { run, clock } = prepare({});
    await run.perform(key('keyDown', 'a'), run.send);
    const downAt = clock.now();
    await run.perform(key('keyUp', 'a'), run.send);
    const upAt = clock.now();
    await run.perform(key('keyDown', 'b'), run.send);

    expect(upAt - downAt).toBeGreaterThanOrEqual(30);
    expect(upAt - downAt).toBeLessThanOrEqual(90);
    expect(clock.now() - downAt).toBeGreaterThanOrEqual(45);
    clock.advance(1000);
    const before = clock.now();
    await run.perform(key('keyDown', 'c'), run.send);
    expect(clock.now()).toBe(before);
});

test('a scroll into view of a far node is wheeled most of the way at the cursor, then sent itself', async () => {
    const { run, sent, clock } = prepare({ quads: [[100, 2400, 200, 2400, 200, 2440, 100, 2440]] });
    const moved = await run.perform(click('mouseMoved', 500, 300), run.send);
    clock.advance(5000);
    sent.length = 0;

    const command: CdpRequest = { method: 'DOM.scrollIntoViewIfNeeded', params: { objectId: 'o-1' }, sessionId: 's-1' };
    const last = await run.perform(command, run.send);

    const wheels = sent.filter(sentInput => sentInput.params['type'] === 'mouseWheel');
    // From 2420 to the middle, 360: about 20 notches.
    expect(wheels.length).toBe(20);
    for (const wheel of wheels) {
        expect(wheel.params['deltaY']).toBeGreaterThanOrEqual(90);
        expect(wheel.params['deltaY']).toBeLessThanOrEqual(110);
        expect(wheel.params).toMatchObject({ deltaX: 0 });
    }
    for (const wheel of wheels) {
        expect(wheel.params).toMatchObject({ x: moved.params['x'], y: moved.params['y'] });
    }
    expect(sent[0]).toMatchObject({ method: 'DOM.getContentQuads', params: { objectId: 'o-1' } });
    expect(last).toBe(command);
});

test('a scroll into view of a node in view sends nothing of its own', async () => {
    const { run, sent } = prepare({ quads: [[100, 200, 200, 200, 200, 240, 100, 240]] });
    const command: CdpRequest = { method: 'DOM.scrollIntoViewIfNeeded', params: { objectId: 'o-1' }, sessionId: 's-1' };

    expect(await run.perform(command, run.send)).toBe(command);
    expect(sent.map(sentInput => sentInput.method)).toEqual(['DOM.getContentQuads', 'Page.getLayoutMetrics']);
});

test("a client's long wheel is split into notches that add up to it", async () => {
    const { run, sent, clock } = prepare({});
    await run.perform(click('mouseMoved', 500, 300), run.send);
    clock.advance(5000);
    sent.length = 0;

    const last = await run.perform(
        {
            method: 'Input.dispatchMouseEvent',
            params: { type: 'mouseWheel', x: 500, y: 300, deltaX: 0, deltaY: 1000 },
            sessionId: 's-1',
        },
        run.send,
    );

    const deltas = [...sent.map(command => command.params['deltaY']), last.params['deltaY']];
    expect(deltas).toHaveLength(10);
    expect(deltas.reduce<number>((sum, delta) => sum + (typeof delta === 'number' ? delta : 0), 0)).toBe(1000);
});

test('what is not input goes unchanged, with nothing sent and no wait', async () => {
    const { run, sent, clock } = prepare({});
    const commands: CdpRequest[] = [
        { method: 'Runtime.evaluate', params: { expression: '1' }, sessionId: 's-1' },
        { method: 'Input.dispatchTouchEvent', params: { type: 'touchStart', touchPoints: [] }, sessionId: 's-1' },
        { method: 'Input.dispatchDragEvent', params: { type: 'drop', x: 1, y: 1 }, sessionId: 's-1' },
    ];

    for (const command of commands) {
        expect(await run.perform(command, run.send)).toBe(command);
    }
    expect(sent).toEqual([]);
    expect(clock.now()).toBe(0);
});

/** What `prepare` attaches the input with. */
interface PrepareOptions extends Pick<CreateHumanInputOptions, 'random'> {
    /** What `DOM.getContentQuads` answers. */
    quads?: number[][];
}

/**
 * The input attached to a run whose every session is on `page-1`, on a clock that moves by each wait at once, and a
 * browser that records what it is sent and answers a 1280×720 viewport.
 */
function prepare(options: PrepareOptions) {
    const clock = createInstantClock();
    const input = createHumanInput({ clock, random: options.random ?? createRandom(1) });
    const run = input[ATTACH_HUMAN_INPUT]({ getSessionTarget: () => 'page-1' });
    const sent: SentInput[] = [];
    function send(method: string, params: Record<string, unknown>) {
        sent.push({ at: clock.now(), method, params });
        switch (method) {
            case 'Page.getLayoutMetrics':
                return Promise.resolve({ cssLayoutViewport: VIEWPORT });
            case 'DOM.getContentQuads':
                return Promise.resolve({ quads: options.quads ?? [] });
            default:
                return Promise.resolve({});
        }
    }
    return { run: { ...run, send }, sent, clock };
}

/** A clock whose waits pass at once, moving its time by them. */
function createInstantClock(): HumanInputClock & { advance(ms: number): void } {
    let now = 0;
    return {
        now: () => now,
        setTimeout(callback, ms) {
            now += ms;
            queueMicrotask(callback);
        },
        advance(ms) {
            now += ms;
        },
    };
}

/** A seeded uniform source in `[0, 1)` (mulberry32), so a test's draws are the same every run. */
function createRandom(seed: number) {
    let state = seed;
    return () => {
        state = (state + 0x6d_2b_79_f5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
    };
}

function click(type: string, x: number, y: number): CdpRequest {
    return {
        method: 'Input.dispatchMouseEvent',
        params: { type, x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 },
        sessionId: 's-1',
    };
}

function key(type: string, name: string): CdpRequest {
    return { method: 'Input.dispatchKeyEvent', params: { type, key: name, text: name }, sessionId: 's-1' };
}

function sumDelays(timed: readonly (MousePathPoint | TimedCommand)[]) {
    let sum = 0;
    for (const { delayMs } of timed) {
        sum += delayMs;
    }
    return sum;
}

function withTimes(commands: TimedCommand[]) {
    let at = 0;
    return commands.map(command => {
        at += command.delayMs;
        return { ...command, at };
    });
}

function describeKey({ params }: TimedCommand) {
    const parts = [params['type'], params['key'], params['code'], params['windowsVirtualKeyCode']];
    if (typeof params['text'] === 'string') {
        parts.push(`text=${params['text']}`);
    }
    if (params['modifiers'] === 8 && params['key'] !== 'Shift') {
        parts.push('shift');
    }
    return parts
        .filter(part => part != null)
        .map(part => (typeof part === 'string' || typeof part === 'number' ? String(part) : '?'))
        .join(' ');
}

function distanceFromLine(point: MousePathPoint, from: { x: number; y: number }, to: { x: number; y: number }) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return Math.abs(dy * point.x - dx * point.y + to.x * from.y - to.y * from.x) / Math.hypot(dx, dy);
}
