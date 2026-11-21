import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, expect, test } from 'bun:test';

import { assert } from '@nzyme/utils/assert.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';
import { waitFor } from '@nzyme/utils/waitFor.js';
import { waitUntil } from '@nzyme/utils/waitUntil.js';

import { registerNativeHost } from './registerNativeHost.js';

/**
 * These tests run the host as Chrome does: the copy `registerNativeHost` writes, started through its launcher (on
 * Windows directly), with native messaging frames on its stdio. They need the build (`dist/nativeHost.js`). CI runs them
 * on Windows too.
 */
const HELLO = { type: 'hello', version: 1 };
/** Windows: a key of the test's own, so no Chrome's registration is touched. */
const TEST_REGISTRY_ROOT = 'HKCU\\Software\\flaneur-test';
const TEST_REGISTRY_KEY = `${TEST_REGISTRY_ROOT}\\NativeMessagingHosts`;

const execFileAsync = promisify(execFile);

const cleanups: (() => Promise<unknown> | void)[] = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).toReversed()) {
        await cleanup();
    }
});

test('forwards nothing from Chrome to a client before it speaks, then carries messages both ways', async () => {
    const chrome = await startHost(await createDataDir());
    const client = await connectClient(chrome.address);

    chrome.send({ type: 'tab.created', tab: { targetId: 'early' } });
    await waitFor(300);
    expect(client.lines).toEqual([]);

    client.send(HELLO);
    await waitUntil(() => chrome.received.length > 0);
    chrome.send({ type: 'hello', version: 1, userAgent: 'Chrome/140' });
    await waitUntil(() => client.lines.length > 0);

    expect(chrome.received).toEqual([HELLO]);
    expect(client.lines).toEqual([{ type: 'hello', version: 1, userAgent: 'Chrome/140' }]);
});

test('refuses a second client, which reaches nothing, and keeps the first', async () => {
    const chrome = await startHost(await createDataDir());
    const first = await connectClient(chrome.address);
    first.send(HELLO);
    await waitUntil(() => chrome.received.length > 0);

    const second = await connectClient(chrome.address);
    second.send({ type: 'tabs.list', id: 1 });
    await second.closed;
    chrome.send({ type: 'reply', id: 1, result: {} });
    await waitUntil(() => first.lines.length > 0);

    expect(second.lines).toMatchObject([{ type: 'busy' }]);
    expect(chrome.received).toEqual([HELLO]);
    expect(first.lines).toEqual([{ type: 'reply', id: 1, result: {} }]);
});

test('frees its place when a client leaves silent, and exits when a client that spoke leaves', async () => {
    const chrome = await startHost(await createDataDir());
    const silent = await connectClient(chrome.address);
    silent.socket.end();
    await silent.closed;

    const client = await connectClient(chrome.address);
    client.send(HELLO);
    await waitUntil(() => chrome.received.length > 0);
    client.socket.end();

    expect(await chrome.exited).toBe(0);
    expect(existsSync(chrome.address)).toBe(false);
});

// POSIX: a named pipe goes with the process that served it, a socket file does not.
test.skipIf(process.platform === 'win32')('takes over the socket a dead host left behind', async () => {
    const dataDir = await createDataDir();
    const dead = await startHost(dataDir);
    await connectClient(dead.address);
    dead.host.kill('SIGKILL');
    await dead.exited;
    expect(existsSync(dead.address)).toBe(true);

    const chrome = await startHost(dataDir);
    const client = await connectClient(chrome.address);
    client.send(HELLO);
    await waitUntil(() => chrome.received.length > 0);

    expect(chrome.received).toEqual([HELLO]);
});

test('closes a client whose message exceeds what Chrome accepts, sending Chrome none of it', async () => {
    const chrome = await startHost(await createDataDir());
    const client = await connectClient(chrome.address);
    client.send(HELLO);
    client.send({ type: 'debugger.send', id: 1, params: { expression: 'x'.repeat(1024 * 1024) } });
    await client.closed;

    expect(await chrome.exited).toBe(0);
    expect(chrome.received).toEqual([HELLO]);
});

test('once it listens, records the executable that started it, and a host that finds the socket served does not touch it', async () => {
    const dataDir = await createDataDir();
    const file = path.join(dataDir, 'own-chrome', 'browser.json');
    const first = await startHost(dataDir);
    await connectClient(first.address);
    await waitUntil(() => existsSync(file), { timeoutMs: 5000 });
    const executable = await readExecutable(file);

    // Here the host's parent is this process; on Windows it is the batch launcher's `cmd.exe` in production, so the host
    // started directly here names this process's parent instead.
    if (process.platform === 'win32') {
        expect(path.isAbsolute(executable)).toBe(true);
    } else {
        expect(await realpath(executable)).toBe(await realpath(process.execPath));
    }

    const sentinel = JSON.stringify({ executable: 'sentinel' });
    await writeFile(file, sentinel);
    const second = await startHost(dataDir);
    expect(await second.exited).toBe(0);

    expect(await readFile(file, 'utf8')).toBe(sentinel);
});

async function readExecutable(file: string) {
    const record: unknown = JSON.parse(await readFile(file, 'utf8'));
    assert(isPlainObject(record) && typeof record['executable'] === 'string', 'browser.json names an executable');
    return record['executable'];
}

async function createDataDir() {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'flaneur-host-'));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    return dataDir;
}

/** Registers the host in `dataDir` and starts it as Chrome would, playing Chrome's side of its stdio. */
async function startHost(dataDir: string) {
    const { address } = await registerNativeHost({
        dataDir,
        browserDataDirs: [],
        registryKeys: [TEST_REGISTRY_KEY],
    });
    if (process.platform === 'win32') {
        cleanups.push(() => execFileAsync('reg', ['delete', TEST_REGISTRY_ROOT, '/f']).catch(() => {}));
    }
    // Windows: the host itself, as its batch launcher would run it; Node starts a batch file only through a shell, whose
    // kill would leave the host running.
    const hostDir = path.join(dataDir, 'own-chrome');
    const host =
        process.platform === 'win32'
            ? spawn(process.execPath, [path.join(hostDir, 'nativeHost.mjs')], { stdio: ['pipe', 'pipe', 'ignore'] })
            : spawn(path.join(hostDir, 'host.sh'), [], { stdio: ['pipe', 'pipe', 'ignore'] });
    const exited = new Promise<number | null>(resolve => {
        host.once('exit', code => resolve(code));
    });
    cleanups.push(() => {
        host.kill('SIGKILL');
        return exited;
    });
    const received: unknown[] = [];
    let rest: Buffer = Buffer.alloc(0);
    host.stdout.on('data', (chunk: Buffer) => {
        rest = Buffer.concat([rest, chunk]);
        while (rest.length >= 4 && rest.length >= 4 + rest.readUInt32LE(0)) {
            const end = 4 + rest.readUInt32LE(0);
            received.push(JSON.parse(rest.subarray(4, end).toString('utf8')));
            rest = rest.subarray(end);
        }
    });
    return { host, address, exited, received, send };

    function send(message: object) {
        const payload = Buffer.from(JSON.stringify(message));
        const header = Buffer.alloc(4);
        header.writeUInt32LE(payload.length);
        host.stdin.write(Buffer.concat([header, payload]));
    }
}

/** Connects to the host as flaneur does, once it listens. */
async function connectClient(address: string) {
    let socket: net.Socket | undefined;
    await waitUntil(
        async () => {
            socket = await new Promise<net.Socket | undefined>(resolve => {
                const attempt = net.connect(address);
                attempt.once('connect', () => resolve(attempt));
                attempt.once('error', () => resolve(undefined));
            });
            return socket;
        },
        { timeoutMs: 5000 },
    );
    const connected = socket!;
    connected.on('error', () => {});
    const lines: unknown[] = [];
    let rest = '';
    connected.on('data', (chunk: Buffer) => {
        const parts = (rest + chunk.toString('utf8')).split('\n');
        rest = parts.pop() ?? '';
        lines.push(...parts.map((line): unknown => JSON.parse(line)));
    });
    const closed = new Promise<void>(resolve => {
        connected.once('close', () => resolve());
    });
    return {
        socket: connected,
        lines,
        closed,
        send: (message: object) => connected.write(`${JSON.stringify(message)}\n`),
    };
}
