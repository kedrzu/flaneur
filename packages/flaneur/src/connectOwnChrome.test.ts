import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'bun:test';

import { createTestLogger } from '@nzyme/logging/createTestLogger.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';
import { waitUntil } from '@nzyme/utils/waitUntil.js';

import { connectOwnChrome } from './connectOwnChrome.js';
import type { ConnectOwnChromeOptions } from './connectOwnChrome.js';
import { OWN_CHROME_PROTOCOL_VERSION } from './OwnChromeProtocol.js';

/**
 * flaneur against the real host (it needs the build), with the test playing Chrome and the extension on the host's
 * stdio; the extension itself is Task 6's integration tests'.
 */
const USER_AGENT = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const cleanups: (() => Promise<unknown> | void)[] = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).toReversed()) {
        await cleanup();
    }
});

test('with no extension in time, says how to install it and allow agents', async () => {
    const options = await createOptions();

    await expect(connectOwnChrome({ ...options, timeoutMs: 500 })).rejects.toThrow(
        /Install the flaneur extension \(https:\/\/\S+\) and switch on "Allow agents/,
    );
});

test('drives Chrome through the host, refuses a second flaneur, and ends when the extension goes', async () => {
    const options = await createOptions();
    const connecting = connectOwnChrome(options);
    // Written last by the registration.
    const manifest = path.join(options.dataDir, 'chrome', 'NativeMessagingHosts', 'com.flaneur.own_chrome.json');
    await waitUntil(() => existsSync(manifest), { timeoutMs: 5000 });
    const host = startExtension(options.dataDir);

    const browser = await connecting;
    const version = await browser.send('Browser.getVersion');
    const second = connectOwnChrome(options);

    expect(version).toMatchObject({ product: 'Chrome/140.0.0.0', userAgent: USER_AGENT });
    await expect(second).rejects.toThrow(/Another flaneur is already using your Chrome/);

    host.stdin.end();
    expect(await browser.exited).toEqual({ code: null, signal: null });
});

async function createOptions() {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'flaneur-own-'));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    const options: ConnectOwnChromeOptions = {
        dataDir,
        chromeUserDataDir: path.join(dataDir, 'chrome'),
        launchChrome: false,
        timeoutMs: 10_000,
        logger: createTestLogger('test').logger,
    };
    return options;
}

/** Starts the registered host as Chrome would for the extension, which greets flaneur and has no tabs. */
function startExtension(dataDir: string) {
    const host = spawn(path.join(dataDir, 'own-chrome', 'host.sh'), [], { stdio: ['pipe', 'pipe', 'ignore'] });
    const exited = new Promise(resolve => {
        host.once('exit', resolve);
    });
    cleanups.push(() => {
        host.kill('SIGKILL');
        return exited;
    });
    let rest: Buffer = Buffer.alloc(0);
    host.stdout.on('data', (chunk: Buffer) => {
        rest = Buffer.concat([rest, chunk]);
        while (rest.length >= 4 && rest.length >= 4 + rest.readUInt32LE(0)) {
            const end = 4 + rest.readUInt32LE(0);
            answer(JSON.parse(rest.subarray(4, end).toString('utf8')));
            rest = rest.subarray(end);
        }
    });
    return host;

    function answer(message: unknown) {
        if (!isPlainObject(message)) {
            return;
        }
        if (message['type'] === 'hello') {
            send({ type: 'hello', version: OWN_CHROME_PROTOCOL_VERSION, userAgent: USER_AGENT });
        } else if (message['type'] === 'tabs.list') {
            send({ type: 'reply', id: message['id'], result: { tabs: [] } });
        }
    }

    function send(message: object) {
        const payload = Buffer.from(JSON.stringify(message));
        const header = Buffer.alloc(4);
        header.writeUInt32LE(payload.length);
        host.stdin.write(Buffer.concat([header, payload]));
    }
}
