import { spawn } from 'node:child_process';

import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

/** Where an agent-browser session connects. */
export interface CreateAgentBrowserCliParams {
    /** The agent-browser executable. */
    executable: string;
    /** flaneur's CDP endpoint. */
    endpoint: string;
    /** The session the commands share: one background process and one active tab. */
    session: string;
}

/** One agent-browser session's commands. */
export interface AgentBrowserCli {
    /**
     * Runs a command with `--json`.
     * @returns The reply's `data`.
     * @throws {AgentBrowserError} When the command fails.
     */
    json(...args: string[]): Promise<Record<string, unknown>>;
}

/**
 * How long one command may take: a page load may be held 15 s by the pace and then take agent-browser's own 60 s
 * (`AGENT_BROWSER_DEFAULT_TIMEOUT`); a page that never settles must not hang the eval.
 */
const COMMAND_TIMEOUT_MS = 90_000;

/** agent-browser's own timeout of a page load or a wait, as Playwright's navigation timeout in the sites eval. */
const AGENT_BROWSER_TIMEOUT_MS = 60_000;

/**
 * The errors agent-browser fails with when a selector, a ref or a role and name match nothing on the page, or a ref's
 * element was replaced by none of the same role and name.
 */
const MISSING_TARGET =
    /^(Element not found|No element found|Unknown ref|Could not locate element)|, but none match name /;

/** An agent-browser command that failed, with agent-browser's own message. */
export class AgentBrowserError extends Error {
    /** The command failed because its target is not on the page (yet): nothing was done. */
    readonly missingTarget: boolean;

    constructor(command: string, message: string) {
        super(`agent-browser ${command}: ${message}`);
        this.name = 'AgentBrowserError';
        this.missingTarget = MISSING_TARGET.test(message);
    }
}

/**
 * Runs agent-browser commands in one session over flaneur's CDP endpoint, with Node's `child_process`, so it works on
 * Node (the sites eval) and Bun (`bun run eval`).
 * @__NO_SIDE_EFFECTS__
 */
export function createAgentBrowserCli(params: CreateAgentBrowserCliParams): AgentBrowserCli {
    const env = {
        ...process.env,
        AGENT_BROWSER_CDP: params.endpoint,
        AGENT_BROWSER_SESSION: params.session,
        AGENT_BROWSER_NO_VERSION_CHECK: '1',
        AGENT_BROWSER_DEFAULT_TIMEOUT: String(AGENT_BROWSER_TIMEOUT_MS),
    };

    return { json };

    async function json(...args: string[]) {
        const command = args.join(' ');
        const stdout = await run(['--json', ...args], command);
        let reply: unknown;
        try {
            reply = JSON.parse(stdout);
        } catch {
            throw new AgentBrowserError(command, `not a JSON reply: ${stdout.trim().slice(0, 200)}`);
        }
        // `{ success, data, error }`
        if (!isPlainObject(reply) || reply['success'] !== true) {
            const error = isPlainObject(reply) ? reply['error'] : undefined;
            throw new AgentBrowserError(command, typeof error === 'string' ? error : stdout.trim());
        }
        const data = reply['data'];
        return isPlainObject(data) ? data : {};
    }

    /** Runs the executable; its stdout, which carries the JSON reply also when the command failed. */
    function run(args: string[], command: string) {
        return new Promise<string>((resolve, reject) => {
            const child = spawn(params.executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
                stdout += chunk;
            });
            child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
                stderr += chunk;
            });
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new AgentBrowserError(command, `timed out after ${COMMAND_TIMEOUT_MS / 1000} s`));
            }, COMMAND_TIMEOUT_MS);
            child.on('error', error => {
                clearTimeout(timer);
                reject(error);
            });
            child.on('close', () => {
                clearTimeout(timer);
                resolve(stdout.trim() === '' ? stderr : stdout);
            });
        });
    }
}
