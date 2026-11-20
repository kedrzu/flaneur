import type { ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import type { Logger } from '@nzyme/logging/Logger.js';
import { withTimeout } from '@nzyme/utils/withTimeout.js';

import type { StealthBrowserCommand, StealthBrowserConnection, StealthBrowserExit } from './createStealthBrowser.js';
import { splitPipeFrames } from './splitPipeFrames.js';

/** How long `close` waits for the browser to exit on its own before killing it. */
const CLOSE_TIMEOUT_MS = 5000;
/** How much of the browser's stderr is kept for the exit log. */
const STDERR_TAIL_LENGTH = 2000;
/** The id of the connection's own `Browser.close`: the core numbers its commands from 1. */
const CLOSE_COMMAND_ID = 0;

/**
 * The connection to a browser spawned with `--remote-debugging-pipe`: commands go to its fd 3, messages come from its
 * fd 4, each ended by a NUL byte. It is gone when the process exits; `close` asks it to with `Browser.close` and kills
 * it when it has not exited after 5 s. Activating a page (`Page.bringToFront`, `Target.activateTarget`) is answered
 * here and never sent: each page has a window of its own, visible without it, and activating one would bring Chrome to
 * the front. Kills the process when its pipes are missing.
 */
export function connectBrowserPipe(child: ChildProcess, logger: Logger): StealthBrowserConnection {
    const { stderr, pipe, input } = readPipes(child);
    const listeners = new Set<(frame: string) => void>();
    let closing = false;
    let stderrTail = '';

    const closed = new Promise<StealthBrowserExit>(resolve => {
        child.once('exit', (code, signal) => resolve(onExit(code, signal)));
    });

    child.on('error', error => logger.error('The browser process failed', { error }));
    pipe.on('error', error => logger.debug('The pipe to the browser failed', { error }));
    stderr.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LENGTH);
    });
    let rest = Buffer.alloc(0);
    input.on('data', (chunk: Buffer) => {
        const split = splitPipeFrames(rest.length > 0 ? Buffer.concat([rest, chunk]) : chunk);
        rest = Buffer.from(split.rest);
        for (const frame of split.frames) {
            emit(frame);
        }
    });

    return {
        send,
        onFrame: listener => listeners.add(listener),
        closed,
        close,
    };

    function send(command: StealthBrowserCommand) {
        switch (command.method) {
            case 'Page.bringToFront':
            case 'Target.activateTarget':
                queueMicrotask(() => emit(JSON.stringify({ id: command.id, result: {} })));
                return;
            default:
                write(command);
        }
    }

    async function close() {
        closing = true;
        write({ id: CLOSE_COMMAND_ID, method: 'Browser.close', params: {} });
        await withTimeout({
            operation: closed,
            timeoutMs: CLOSE_TIMEOUT_MS,
            onTimeout: () => {
                child.kill('SIGKILL');
                return closed;
            },
        });
    }

    function write(command: StealthBrowserCommand) {
        pipe.write(`${JSON.stringify(command)}\0`);
    }

    function emit(frame: string) {
        for (const listener of listeners) {
            listener(frame);
        }
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null): StealthBrowserExit {
        if (closing) {
            logger.info('The browser closed', { code, signal });
        } else {
            logger.warn('The browser exited', { code, signal, stderr: stderrTail.trim() });
        }
        return { code, signal };
    }
}

/** The browser's stderr and its two ends of the debugging pipe; kills the browser when one is missing. */
function readPipes(child: ChildProcess) {
    const [, , stderr, pipe, input] = child.stdio;
    if (!(pipe instanceof Writable) || !(input instanceof Readable) || !(stderr instanceof Readable)) {
        child.kill('SIGKILL');
        throw new Error('The browser was spawned without its pipes');
    }
    return { stderr, pipe, input };
}
