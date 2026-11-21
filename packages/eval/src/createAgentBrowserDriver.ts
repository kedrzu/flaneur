import { assert } from '@nzyme/utils/assert.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

import type { BrowserStack } from './bootBrowserStack.js';
import { createAgentBrowserCli } from './createAgentBrowserCli.js';
import type { EvalDriver } from './StealthEvalTypes.js';

/** What the agent's driver runs and where it connects. */
export interface CreateAgentBrowserDriverParams {
    /** The agent-browser executable. */
    executable: string;
    stack: BrowserStack;
}

/** The order of a date input's segments in the page's locale, e.g. `['day', 'month', 'year']` for Polish. */
const DATE_PART_ORDER = `new Intl.DateTimeFormat(navigator.language).formatToParts(new Date(2000, 10, 22))
    .map(part => part.type).filter(type => type === 'day' || type === 'month' || type === 'year')`;

/**
 * Drives flaneur the way an agent does: the agent-browser CLI over flaneur's CDP endpoint, one session for the whole
 * run. Selectors are CSS, which agent-browser takes wherever it takes an `@e` ref.
 * @__NO_SIDE_EFFECTS__
 */
export function createAgentBrowserDriver(params: CreateAgentBrowserDriverParams): EvalDriver {
    const { executable, stack } = params;
    const cli = createAgentBrowserCli({ executable, endpoint: stack.endpoint, session: stack.session });

    return {
        open: url => run('open', url),
        click: selector => runOn(selector, 'click', selector),
        type: (selector, text) => runOn(selector, 'fill', selector, text),
        press: key => run('press', key),
        select: (selector, value) => runOn(selector, 'select', selector, value),
        pickDate,
        scrollBy: px => run('scroll', 'down', String(px)),
        scrollTo: selector => runOn(selector, 'scrollintoview', selector),
        evaluate,
        cookieNames,
        browserVersion: () => stack.browserVersion(),
        // Ends agent-browser's own background process for the session; flaneur refuses closing the browser itself.
        close: () => run('close'),
    };

    /**
     * agent-browser's `fill` and `keyboard type` leave a date input empty (checked 2026-11-15 on v0.43.0); single key
     * presses into the focused field do set it, segment by segment in the order of the browser's locale.
     */
    async function pickDate(selector: string, isoDate: string) {
        const [year, month, day] = isoDate.split('-');
        assert(year != null && month != null && day != null, 'The date is ISO');
        const order = await evaluate(DATE_PART_ORDER);
        if (!Array.isArray(order)) {
            throw new TypeError('The date part order is not a list');
        }
        await runOn(selector, 'focus', selector);
        for (const part of order) {
            const digits = part === 'day' ? day : part === 'month' ? month : year;
            for (const digit of digits) {
                await run('press', digit);
            }
        }
    }

    async function cookieNames() {
        // `{ cookies: [{ name, domain, … }] }`
        const { cookies } = await cli.json('cookies', 'get');
        if (!Array.isArray(cookies)) {
            throw new TypeError('agent-browser cookies gave no list');
        }
        return cookies.flatMap(cookie =>
            isPlainObject(cookie) && typeof cookie['name'] === 'string' ? [cookie['name']] : [],
        );
    }

    async function evaluate(expression: string) {
        // `{ result, origin, lifecycle }`
        const data = await cli.json('eval', expression);
        if (!('result' in data)) {
            throw new Error('agent-browser eval gave no result');
        }
        return data['result'];
    }

    /**
     * Runs a command on an element once it is there: agent-browser fails at once on a missing one, and the shop
     * navigates only after its reCAPTCHA token arrives, up to 1.5 s after the action that leads to the page.
     */
    async function runOn(selector: string, ...args: string[]) {
        await run('wait', selector);
        await run(...args);
    }

    /** Runs one agent-browser command; rejects with an `AgentBrowserError` when it fails. */
    async function run(...args: string[]) {
        await cli.json(...args);
    }
}
