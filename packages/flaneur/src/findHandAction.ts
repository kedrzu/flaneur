import type { CdpRequest } from './CdpTypes.js';

/**
 * What a client's script call does that a person does by hand: focus a field, clear it, scroll an element into view or
 * scroll by an amount. The calls are agent-browser's, by their exact source; a script doing the same in other words
 * runs as it is.
 */
export type HandAction =
    /** `this.focus()` on an element. */
    | { type: 'focus'; objectId: string }
    /** Select the field's text, set its value to `''` and dispatch an untrusted `input` event. */
    | { type: 'clear'; objectId: string }
    /** `this.scrollIntoView(…)` on an element. */
    | { type: 'scrollIntoView'; objectId: string }
    /** Scroll by an amount: the page (`window.scrollBy`), or an element (`this.scrollBy`). */
    | { type: 'scrollBy'; objectId?: string; deltaX: number; deltaY: number }
    /**
     * An evaluation that finds an element and scrolls it into view if it is not, then reads where it is: agent-browser's
     * `click <css selector>`. `probe` is the same evaluation, returning the element instead of scrolling it.
     */
    | { type: 'revealThenEvaluate'; probe: string };

/** agent-browser 0.43.0's calls (`cli/src/native/interaction.rs`, `element.rs`), whitespace collapsed. */
const FOCUS = 'function() { this.focus(); }';
const CLEAR =
    "function() { this.select && this.select(); this.value = ''; this.dispatchEvent(new Event('input', { bubbles: true })); }";
const SCROLL_INTO_VIEW = "function() { this.scrollIntoView({ block: 'center', inline: 'center' }); }";
const SCROLL_ELEMENT_BY = 'function(dx, dy) { this.scrollBy(dx, dy); }';
const SCROLL_WINDOW_BY = /^window\.scrollBy\((-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)\)$/;
/** The scroll inside agent-browser's selector evaluation (`build_selector_js`), run only for an element out of view. */
const SELECTOR_SCROLL = "el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });";
const SELECTOR_START = '(() => {';

/**
 * The hand action a client's `Runtime.callFunctionOn` or `Runtime.evaluate` performs, if it is one of agent-browser's;
 * `undefined` for anything else.
 * @__NO_SIDE_EFFECTS__
 */
export function findHandAction(command: CdpRequest): HandAction | undefined {
    const { method, params } = command;
    if (method === 'Runtime.evaluate') {
        return findEvaluation(params['expression']);
    }
    const { objectId, functionDeclaration } = params;
    if (
        method !== 'Runtime.callFunctionOn' ||
        typeof objectId !== 'string' ||
        typeof functionDeclaration !== 'string'
    ) {
        return undefined;
    }
    switch (collapse(functionDeclaration)) {
        case FOCUS:
            return { type: 'focus', objectId };
        case CLEAR:
            return { type: 'clear', objectId };
        case SCROLL_INTO_VIEW:
            return { type: 'scrollIntoView', objectId };
        case SCROLL_ELEMENT_BY: {
            const deltaX = readArgument(params['arguments'], 0);
            const deltaY = readArgument(params['arguments'], 1);
            return deltaX == null || deltaY == null ? undefined : { type: 'scrollBy', objectId, deltaX, deltaY };
        }
        default:
            return undefined;
    }
}

function findEvaluation(expression: unknown): HandAction | undefined {
    if (typeof expression !== 'string') {
        return undefined;
    }
    const scroll = SCROLL_WINDOW_BY.exec(expression.trim());
    if (scroll != null) {
        return { type: 'scrollBy', deltaX: Number(scroll[1]), deltaY: Number(scroll[2]) };
    }
    // Matched in the source as it is: collapsing it would change the selector's own string.
    if (!expression.trimStart().startsWith(SELECTOR_START) || expression.split(SELECTOR_SCROLL).length !== 2) {
        return undefined;
    }
    return { type: 'revealThenEvaluate', probe: expression.replace(SELECTOR_SCROLL, 'return el;') };
}

function collapse(source: string) {
    return source.replaceAll(/\s+/g, ' ').trim();
}

/** The number a `Runtime.callFunctionOn` passes as its argument at `index`. */
function readArgument(callArguments: unknown, index: number) {
    const argument: unknown = Array.isArray(callArguments) ? callArguments[index] : undefined;
    const value = typeof argument === 'object' && argument !== null && 'value' in argument ? argument.value : undefined;
    return typeof value === 'number' ? value : undefined;
}
