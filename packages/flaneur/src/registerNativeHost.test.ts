import { chmod, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'bun:test';

import { createTestLogger } from '@nzyme/logging/createTestLogger.js';

import { registerNativeHost } from './registerNativeHost.js';

/** The POSIX registration; Windows writes the registry instead. */
const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) {
        await cleanup();
    }
});

test('writes a manifest in every browser folder that lets only the flaneur extension start the host', async () => {
    const dataDir = await createDataDir();
    const browserDataDirs = [await createBrowserDir(dataDir, 'one'), await createBrowserDir(dataDir, 'two')];

    const { registeredIn } = await registerNativeHost({ dataDir, browserDataDirs, registryKeys: [] });

    const launcherPath = path.join(dataDir, 'own-chrome', 'host.sh');
    expect(registeredIn).toEqual(browserDataDirs);
    for (const browserDataDir of browserDataDirs) {
        const manifest: unknown = JSON.parse(
            await readFile(path.join(browserDataDir, 'NativeMessagingHosts', 'com.flaneur.own_chrome.json'), 'utf8'),
        );
        expect(manifest).toMatchObject({
            name: 'com.flaneur.own_chrome',
            path: launcherPath,
            type: 'stdio',
            allowed_origins: ['chrome-extension://goimhkigkmnddobemofljbnlmlgbikcl/'],
        });
    }
    // Chrome starts it without the user's PATH: the runtime is named in full.
    expect(await readFile(launcherPath, 'utf8')).toContain(`exec '${process.execPath}' `);
    expect((await stat(launcherPath)).mode & 0o777).toBe(0o700);
});

test('logs a folder it cannot write and still registers in the others', async () => {
    const dataDir = await createDataDir();
    const { logger, logs } = createTestLogger('test');
    // The manifest folder cannot be made inside a folder the user may only read.
    const readOnly = await createBrowserDir(dataDir, 'readOnly');
    await chmod(readOnly, 0o500);
    const good = await createBrowserDir(dataDir, 'good');

    try {
        const { registeredIn } = await registerNativeHost({
            dataDir,
            browserDataDirs: [readOnly, good],
            registryKeys: [],
            logger,
        });

        expect(registeredIn).toEqual([good]);
        expect(logs.filter(log => log.level === 'warn').map(log => log.data?.['place'])).toEqual([readOnly]);
        await expect(
            stat(path.join(good, 'NativeMessagingHosts', 'com.flaneur.own_chrome.json')),
        ).resolves.toBeDefined();
    } finally {
        await chmod(readOnly, 0o700);
    }
});

test('skips a browser folder that does not exist instead of creating it', async () => {
    const dataDir = await createDataDir();
    const missing = path.join(dataDir, 'missing', 'Browser');
    const { logger, logs } = createTestLogger('test');

    const { registeredIn } = await registerNativeHost({
        dataDir,
        browserDataDirs: [missing],
        registryKeys: [],
        logger,
    });

    expect(registeredIn).toEqual([]);
    await expect(stat(path.dirname(missing))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(logs.some(log => log.message === 'Skipping a browser folder that does not exist')).toBe(true);
});

test('keeps the socket folder to the user, even one created open before', async () => {
    const dataDir = await createDataDir();
    const hostDir = path.join(dataDir, 'own-chrome');
    await mkdir(hostDir, { mode: 0o755 });

    const { address } = await registerNativeHost({ dataDir, browserDataDirs: [], registryKeys: [] });

    expect((await stat(hostDir)).mode & 0o777).toBe(0o700);
    expect(path.dirname(address)).toBe(hostDir);
});

test('refuses a data folder whose socket path the system cannot bind', async () => {
    const dataDir = path.join(await createDataDir(), 'x'.repeat(100));

    await expect(registerNativeHost({ dataDir, browserDataDirs: [], registryKeys: [] })).rejects.toThrow(
        /socket path .* is longer than/,
    );
});

async function createBrowserDir(dataDir: string, name: string) {
    const dir = path.join(dataDir, name);
    await mkdir(dir);
    return dir;
}

async function createDataDir() {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'flaneur-register-'));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    return dataDir;
}
