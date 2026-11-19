import { assert } from '@nzyme/utils/assert.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';
import { withTimeout } from '@nzyme/utils/withTimeout.js';

import type { BrowserStack } from './bootBrowserStack.js';
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

/** How long one agent-browser command may take; a page that never settles must not hang the eval. */
const COMMAND_TIMEOUT_MS = 60_000;

/**
 * Drives flaneur the way an agent does: the agent-browser CLI over flaneur's CDP endpoint, one session for the whole
 * run. Selectors are CSS, which agent-browser takes wherever it takes an `@e` ref.
 * @__NO_SIDE_EFFECTS__
 */
export function createAgentBrowserDriver(params: CreateAgentBrowserDriverParams): EvalDriver {
    const { executable, stack } = params;
    const env = {
        ...process.env,
        AGENT_BROWSER_CDP: stack.endpoint,
        AGENT_BROWSER_SESSION: stack.session,
        AGENT_BROWSER_NO_VERSION_CHECK: '1',
    };

    return {
        open: url => run('open', url).then(() => undefined),
        click: selector => runOn(selector, 'click', selector),
        type: (selector, text) => runOn(selector, 'fill', selector, text),
        press: key => run('press', key).then(() => undefined),
        select: (selector, value) => runOn(selector, 'select', selector, value),
        pickDate,
        scrollBy: px => run('scroll', 'down', String(px)).then(() => undefined),
        scrollTo: selector => runOn(selector, 'scrollintoview', selector),
        evaluate,
        cookieNames,
        browserVersion: () => stack.browserVersion(),
        // Ends agent-browser's own background process for the session; flaneur refuses closing the browser itself.
        close: () => run('close').then(() => undefined),
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
        const output = await run('--json', 'cookies', 'get');
        const reply: unknown = JSON.parse(output);
        // `{ success, data: { cookies: [{ name, domain, … }] }, error }`
        const data = isPlainObject(reply) && reply['success'] === true ? reply['data'] : undefined;
        const cookies = isPlainObject(data) ? data['cookies'] : undefined;
        if (!Array.isArray(cookies)) {
            throw new TypeError(`agent-browser cookies failed: ${output.trim()}`);
        }
        return cookies.flatMap(cookie =>
            isPlainObject(cookie) && typeof cookie['name'] === 'string' ? [cookie['name']] : [],
        );
    }

    async function evaluate(expression: string) {
        const output = await run('--json', 'eval', expression);
        const reply: unknown = JSON.parse(output);
        // `{ success, data: { result, origin, lifecycle }, error }`
        const data = isPlainObject(reply) && reply['success'] === true ? reply['data'] : undefined;
        if (!isPlainObject(data) || !('result' in data)) {
            throw new Error(`agent-browser eval failed: ${output.trim()}`);
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

    /** Runs one agent-browser command; resolves with its stdout, rejects with its stderr when it fails. */
    async function run(...args: string[]) {
        const child = Bun.spawn([executable, ...args], { env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
        const [stdout, stderr, exitCode] = await withTimeout({
            operation: Promise.all([
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
                child.exited,
            ]),
            timeoutMs: COMMAND_TIMEOUT_MS,
            onTimeout: () => {
                child.kill('SIGKILL');
                throw new Error(`agent-browser ${args[0]} timed out`);
            },
        });
        if (exitCode !== 0) {
            throw new Error(
                `agent-browser ${args.join(' ')} failed (exit ${exitCode}): ${stderr.trim() || stdout.trim()}`,
            );
        }
        return stdout;
    }
}
