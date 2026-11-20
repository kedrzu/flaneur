import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'bun:test';

import { registerNativeHost } from './registerNativeHost.js';

/** The POSIX registration; Windows writes the registry instead. */
const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) {
        await cleanup();
    }
});

test('writes a manifest in Chrome’s user data folder that lets only the flaneur extension start the host', async () => {
    const dataDir = await createDataDir();
    const chromeUserDataDir = path.join(dataDir, 'chrome');

    await registerNativeHost({ dataDir, chromeUserDataDir });

    const launcherPath = path.join(dataDir, 'own-chrome', 'host.sh');
    const manifest: unknown = JSON.parse(
        await readFile(path.join(chromeUserDataDir, 'NativeMessagingHosts', 'com.flaneur.own_chrome.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({
        name: 'com.flaneur.own_chrome',
        path: launcherPath,
        type: 'stdio',
        allowed_origins: ['chrome-extension://jfppphlhkknhkkjedcmmgedlnfneimhh/'],
    });
    // Chrome starts it without the user's PATH: the runtime is named in full.
    expect(await readFile(launcherPath, 'utf8')).toContain(`exec '${process.execPath}' `);
    expect((await stat(launcherPath)).mode & 0o777).toBe(0o700);
});

test('keeps the socket folder to the user, even one created open before', async () => {
    const dataDir = await createDataDir();
    const hostDir = path.join(dataDir, 'own-chrome');
    await mkdir(hostDir, { mode: 0o755 });

    const { address } = await registerNativeHost({ dataDir, chromeUserDataDir: path.join(dataDir, 'chrome') });

    expect((await stat(hostDir)).mode & 0o777).toBe(0o700);
    expect(path.dirname(address)).toBe(hostDir);
});

test('refuses a data folder whose socket path the system cannot bind', async () => {
    const dataDir = path.join(await createDataDir(), 'x'.repeat(100));

    await expect(registerNativeHost({ dataDir, chromeUserDataDir: path.join(dataDir, 'chrome') })).rejects.toThrow(
        /socket path .* is longer than/,
    );
});

async function createDataDir() {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'flaneur-register-'));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    return dataDir;
}
