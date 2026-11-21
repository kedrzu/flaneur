import { assertNever } from '@nzyme/utils/assertNever.js';

import { randomBetween } from './randomBetween.js';

/** A CDP command to send `delayMs` after the one before it. */
export interface TimedCommand {
    delayMs: number;
    method: string;
    params: Record<string, unknown>;
}

/** What to type, and how fast. */
export interface PlanTypingParams {
    text: string;
    /** Uniform in `[0, 1)`, like `Math.random`. */
    random: () => number;
    /** The mean time from one key press to the next. */
    intervalMs: number;
}

/** A key of a US keyboard and whether Shift is held for the character. */
interface UsKey {
    key: string;
    code: string;
    keyCode: number;
    shift: boolean;
}

/** How one character of the text is typed. */
type Stroke =
    | { type: 'key'; key: UsKey; text: string }
    /** A character no US key gives (`ł`, an emoji): a key press with its text alone, as an input method sends it. */
    | { type: 'text'; text: string }
    /** A character a key event cannot carry: Chrome takes at most 4 UTF-16 units of text per key, and no control. */
    | { type: 'insert'; text: string };

/** A command at its time from the first key press. */
interface PlannedCommand {
    at: number;
    method: string;
    params: Record<string, unknown>;
}

/** One character's key press at its time. */
interface PlanStrokeParams {
    stroke: Stroke;
    downAt: number;
    holdMs: number;
    /** How long before the key Shift goes down, for a shifted key. */
    shiftLeadMs: number;
    random: () => number;
}

/** The modifier bit of Shift in CDP's `modifiers`. */
const SHIFT = 8;
const SHIFT_KEY = { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, location: 1 };
const ENTER: UsKey = { key: 'Enter', code: 'Enter', keyCode: 13, shift: false };
/** Chrome refuses a key event whose text is longer. */
const MAX_KEY_TEXT_LENGTH = 4;
/** Up to this many characters are typed at the natural rate; a longer text is typed faster, in the same time. */
const NATURAL_LENGTH = 200;
/** The fastest mean interval a long text is typed at; what does not fit the time then is inserted at once. */
const MIN_INTERVAL_MS = 20;
/** The spread of the log-normal interval; its median is set so the mean is the asked one. */
const INTERVAL_SIGMA = 0.35;
/** A pause after a space or punctuation, as a typist's next word or sentence starts. */
const AFTER_PAUSE_FACTOR = 1.5;
const MAX_INTERVAL_MS = 280;
const MIN_HOLD_MS = 30;
const MAX_HOLD_MS = 90;
/** The characters a typist pauses after: a space or punctuation. */
export const PAUSE_CHARACTERS = /[\s.,;:!?]/u;

const US_KEYS = createUsKeys();

/**
 * The key events a person makes typing `text` on a US keyboard, each `delayMs` after the one before: per character a
 * `keyDown` with its `text` and a `keyUp`, Shift held around uppercase letters and symbols, a newline as Enter. Key
 * presses come at log-normal intervals around `intervalMs`, longer after a space or punctuation, and are held 30 to
 * 90 ms, so an unshifted key may still be down when the next goes down, as a fast typist's are. A character no US key
 * gives goes as a key press with its text alone, which Chrome types as an input method's; one a key event cannot carry
 * as `Input.insertText`. A text longer than 200 characters is typed faster, in the time 200 would take; what still
 * does not fit is inserted at once at the end, so a client's 30 s command timeout holds.
 */
export function planTyping({ text, random, intervalMs }: PlanTypingParams): TimedCommand[] {
    const characters = Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text), s => s.segment);
    const budgetMs = NATURAL_LENGTH * intervalMs;
    const meanMs = Math.max(MIN_INTERVAL_MS, Math.min(intervalMs, budgetMs / characters.length));
    const scale = meanMs / intervalMs;

    const planned: PlannedCommand[] = [];
    let downAt = 0;
    /** When the last command of the previous character goes. */
    let lastAt = 0;
    let previous: { character: string; stroke: Stroke } | undefined;
    let typedCount = 0;
    for (const character of characters) {
        const stroke = findStroke(character);
        const shiftLeadMs = isShifted(stroke) ? randomBetween(random, 30, 70) : 0;
        if (previous != null) {
            downAt += sampleKeyInterval(random, meanMs, PAUSE_CHARACTERS.test(previous.character));
            // Only plain key presses overlap, and never one key with itself.
            const overlaps =
                stroke.type !== 'insert' &&
                previous.stroke.type !== 'insert' &&
                !isShifted(stroke) &&
                !isShifted(previous.stroke) &&
                character !== previous.character;
            if (!overlaps) {
                downAt = Math.max(downAt, lastAt + randomBetween(random, 10, 30) * scale + shiftLeadMs);
            }
            // A text that is typed faster still fits only so far: the rest is inserted.
            if (characters.length > NATURAL_LENGTH && downAt > budgetMs) {
                break;
            }
        }
        const holdMs = randomBetween(random, MIN_HOLD_MS, MAX_HOLD_MS) * scale;
        const commands = planStroke({ stroke, downAt, holdMs, shiftLeadMs, random });
        planned.push(...commands);
        lastAt = Math.max(lastAt, ...commands.map(command => command.at));
        previous = { character, stroke };
        typedCount++;
    }
    const rest = characters.slice(typedCount).join('');
    if (rest !== '') {
        planned.push({
            at: lastAt + randomBetween(random, 10, 30),
            method: 'Input.insertText',
            params: { text: rest },
        });
    }

    // Stable: a key's own commands keep their order when two fall on the same time.
    const ordered = planned.toSorted((a, b) => a.at - b.at);
    const timed: TimedCommand[] = [];
    // The first command goes at once: Shift goes down before the first key's own time.
    let before = ordered[0]?.at ?? 0;
    for (const { at, method, params } of ordered) {
        timed.push({ delayMs: at - before, method, params });
        before = at;
    }
    return timed;
}

/**
 * A log-normal time from one key press to the next around `meanMs`, longer after a pause character, kept within half
 * and three times the mean and under 280 ms.
 */
export function sampleKeyInterval(random: () => number, meanMs: number, afterPause: boolean) {
    const median = meanMs / Math.exp((INTERVAL_SIGMA * INTERVAL_SIGMA) / 2);
    // Box-Muller; `1 - random()` keeps the logarithm finite.
    const normal = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    const interval = median * Math.exp(INTERVAL_SIGMA * normal) * (afterPause ? AFTER_PAUSE_FACTOR : 1);
    return Math.min(MAX_INTERVAL_MS, 3 * meanMs, Math.max(meanMs / 2, interval));
}

function planStroke({ stroke, downAt, holdMs, shiftLeadMs, random }: PlanStrokeParams): PlannedCommand[] {
    switch (stroke.type) {
        case 'insert':
            return [{ at: downAt, method: 'Input.insertText', params: { text: stroke.text } }];
        case 'text': {
            const { text } = stroke;
            return [
                {
                    at: downAt,
                    method: 'Input.dispatchKeyEvent',
                    params: { type: 'keyDown', key: text, text, unmodifiedText: text },
                },
                { at: downAt + holdMs, method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: text } },
            ];
        }
        case 'key': {
            const { key, text } = stroke;
            const modifiers = key.shift ? SHIFT : 0;
            const ids = { key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode };
            const press: PlannedCommand[] = [
                {
                    at: downAt,
                    method: 'Input.dispatchKeyEvent',
                    params: { type: 'keyDown', ...ids, text, unmodifiedText: text, modifiers },
                },
                { at: downAt + holdMs, method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', ...ids, modifiers } },
            ];
            if (!key.shift) {
                return press;
            }
            const shiftDownAt = downAt - shiftLeadMs;
            const shiftUpAt = downAt + holdMs + randomBetween(random, 10, 40);
            return [
                {
                    at: shiftDownAt,
                    method: 'Input.dispatchKeyEvent',
                    params: { type: 'rawKeyDown', ...SHIFT_KEY, modifiers: SHIFT },
                },
                ...press,
                {
                    at: shiftUpAt,
                    method: 'Input.dispatchKeyEvent',
                    params: { type: 'keyUp', ...SHIFT_KEY, modifiers: 0 },
                },
            ];
        }
        default:
            return assertNever(stroke);
    }
}

function findStroke(character: string): Stroke {
    if (character === '\n' || character === '\r' || character === '\r\n') {
        return { type: 'key', key: ENTER, text: '\r' };
    }
    const key = US_KEYS.get(character);
    if (key != null) {
        return { type: 'key', key, text: character };
    }
    // Controls other than a newline, such as a tab, would act as keys rather than type.
    const isControl = /\p{Cc}/u.test(character);
    return character.length > MAX_KEY_TEXT_LENGTH || isControl
        ? { type: 'insert', text: character }
        : { type: 'text', text: character };
}

function isShifted(stroke: Stroke) {
    return stroke.type === 'key' && stroke.key.shift;
}

/** The characters of a US keyboard, each with its key. */
function createUsKeys() {
    const keys = new Map<string, UsKey>();
    for (let index = 0; index < 26; index++) {
        const lower = String.fromCodePoint(0x61 + index);
        const upper = lower.toUpperCase();
        const code = `Key${upper}`;
        const keyCode = 0x41 + index;
        keys.set(lower, { key: lower, code, keyCode, shift: false });
        keys.set(upper, { key: upper, code, keyCode, shift: true });
    }
    const shiftedDigits = ')!@#$%^&*(';
    for (let digit = 0; digit <= 9; digit++) {
        const code = `Digit${digit}`;
        keys.set(String(digit), { key: String(digit), code, keyCode: 48 + digit, shift: false });
        const shifted = shiftedDigits.charAt(digit);
        keys.set(shifted, { key: shifted, code, keyCode: 48 + digit, shift: true });
    }
    const symbols: [code: string, keyCode: number, plain: string, shifted: string][] = [
        ['Backquote', 192, '`', '~'],
        ['Minus', 189, '-', '_'],
        ['Equal', 187, '=', '+'],
        ['BracketLeft', 219, '[', '{'],
        ['BracketRight', 221, ']', '}'],
        ['Backslash', 220, '\\', '|'],
        ['Semicolon', 186, ';', ':'],
        ['Quote', 222, "'", '"'],
        ['Comma', 188, ',', '<'],
        ['Period', 190, '.', '>'],
        ['Slash', 191, '/', '?'],
    ];
    for (const [code, keyCode, plain, shifted] of symbols) {
        keys.set(plain, { key: plain, code, keyCode, shift: false });
        keys.set(shifted, { key: shifted, code, keyCode, shift: true });
    }
    keys.set(' ', { key: ' ', code: 'Space', keyCode: 32, shift: false });
    return keys;
}
