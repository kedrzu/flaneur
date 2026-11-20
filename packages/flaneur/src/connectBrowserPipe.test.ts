import { spawn } from 'node:child_process';

import { expect, test } from 'bun:test';

import { createTestLogger } from '@nzyme/logging/createTestLogger.js';
import { waitUntil } from '@nzyme/utils/waitUntil.js';

import { connectBrowserPipe } from './connectBrowserPipe.js';

test('activating a page is answered on the connection and never reaches the browser', async () => {
    // A stand-in browser that sends back every command it reads, in order.
    const child = spawn('/bin/sh', ['-c', 'exec cat <&3 >&4'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    const connection = connectBrowserPipe(child, createTestLogger('test').logger);
    const frames: unknown[] = [];
    connection.onFrame(frame => frames.push(JSON.parse(frame)));

    try {
        connection.send({ id: 1, method: 'Page.bringToFront', params: {}, sessionId: 's-a' });
        connection.send({ id: 2, method: 'Target.activateTarget', params: { targetId: 't-a' } });
        connection.send({ id: 3, method: 'Browser.getVersion', params: {} });
        await waitUntil(() => frames.length >= 3, { timeoutMs: 5000 });

        // An activation written to the pipe would come back before the echo of the command after it.
        expect(frames).toEqual([
            { id: 1, result: {} },
            { id: 2, result: {} },
            { id: 3, method: 'Browser.getVersion', params: {} },
        ]);
    } finally {
        child.kill('SIGKILL');
        await connection.closed;
    }
});
