import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'bun:test';

import { createTestLogger } from '@nzyme/logging/createTestLogger.js';

import { readCliConfig, writeCliConfig } from './cliConfig.js';
import { setupNativeHost } from './setupNativeHost.js';

const dirs: string[] = [];

afterEach(async () => {
    for (const dir of dirs.splice(0)) {
        await rm(dir, { recursive: true, force: true });
    }
});

test('stores the named browser and registers the host in it and in the detected ones', async () => {
    const env = await createEnv();
    const portable = await createBrowserDir(env.home, 'portable');

    const { registeredIn, browser } = await setupNativeHost({ ...env.options, browserDataDirs: [portable] });

    expect(registeredIn).toEqual([path.join(env.configHome, 'google-chrome'), portable]);
    expect(browser).toBeUndefined();
    expect(await readCliConfig(env.dataDir)).toEqual({ browserDataDirs: [portable], registryKeys: [] });
    await expect(
        stat(path.join(portable, 'NativeMessagingHosts', 'com.flaneur.own_chrome.json')),
    ).resolves.toBeDefined();
});

test('resolves a relative folder to an absolute one', async () => {
    const env = await createEnv();
    const portable = await createBrowserDir(env.home, 'portable');

    await setupNativeHost({ ...env.options, browserDataDirs: [path.relative(process.cwd(), portable)] });

    expect(await readCliConfig(env.dataDir)).toEqual({ browserDataDirs: [portable], registryKeys: [] });
});

test('rejects a folder without Local State and changes nothing', async () => {
    const env = await createEnv();
    const good = await createBrowserDir(env.home, 'good');
    const notBrowser = path.join(env.home, 'notBrowser');
    await mkdir(notBrowser);

    await expect(setupNativeHost({ ...env.options, browserDataDirs: [good, notBrowser] })).rejects.toThrow(
        /notBrowser.*Local State/,
    );

    await expectNothingWritten(env.dataDir, good);
});

test('rejects a registry key outside HKCU Software NativeMessagingHosts and changes nothing', async () => {
    const env = await createEnv();
    const good = await createBrowserDir(env.home, 'good');
    const keys = [
        'HKCU\\Software\\Opera Software\\NativeMessagingHosts',
        'HKLM\\Software\\Google\\Chrome\\NativeMessagingHosts',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    ];

    await expect(setupNativeHost({ ...env.options, browserDataDirs: [good], registryKeys: keys })).rejects.toThrow(
        'HKLM',
    );

    await expectNothingWritten(env.dataDir, good);
});

test('replaces the list it is given and leaves the other as stored', async () => {
    const env = await createEnv();
    const first = await createBrowserDir(env.home, 'first');
    const second = await createBrowserDir(env.home, 'second');
    const key = 'HKCU\\Software\\Opera Software\\NativeMessagingHosts';
    await writeCliConfig(env.dataDir, { browserDataDirs: [first], registryKeys: [key] });

    await setupNativeHost({ ...env.options, browserDataDirs: [second] });

    expect(await readCliConfig(env.dataDir)).toEqual({ browserDataDirs: [second], registryKeys: [key] });
});

test('registers in the stored browsers when given no options, and reports the remembered browser', async () => {
    const env = await createEnv();
    const stored = await createBrowserDir(env.home, 'stored');
    await writeCliConfig(env.dataDir, { browserDataDirs: [stored], registryKeys: [] });
    await mkdir(path.join(env.dataDir, 'own-chrome'), { recursive: true });
    await writeFile(
        path.join(env.dataDir, 'own-chrome', 'browser.json'),
        JSON.stringify({ executable: process.execPath }),
    );

    const { registeredIn, browser } = await setupNativeHost(env.options);

    expect(registeredIn).toContain(stored);
    expect(browser).toBe(process.execPath);
});

test('names the config when it is broken and registers nothing', async () => {
    const env = await createEnv();
    await writeFile(path.join(env.dataDir, 'config.json'), '{not json');

    await expect(setupNativeHost(env.options)).rejects.toThrow(path.join(env.dataDir, 'config.json'));

    await expect(stat(path.join(env.dataDir, 'own-chrome'))).rejects.toThrow();
});

async function expectNothingWritten(dataDir: string, browserDataDir: string) {
    await expect(stat(path.join(dataDir, 'config.json'))).rejects.toThrow();
    await expect(stat(path.join(dataDir, 'own-chrome'))).rejects.toThrow();
    await expect(stat(path.join(browserDataDir, 'NativeMessagingHosts'))).rejects.toThrow();
}

/** A browser folder as detection and `setup` recognise it. */
async function createBrowserDir(home: string, name: string) {
    const dir = path.join(home, name);
    await mkdir(path.join(dir, 'Default', 'Extensions'), { recursive: true });
    await writeFile(path.join(dir, 'Local State'), '{}');
    return dir;
}

/** Data folder and home in a temp folder, as Linux: nothing reaches the real home. */
async function createEnv() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'flaneur-setup-'));
    dirs.push(root);
    const dataDir = path.join(root, 'data');
    const home = path.join(root, 'home');
    await mkdir(dataDir);
    await mkdir(home);
    const configHome = path.join(home, 'config');
    // Google Chrome's folder, which exists for the registration to use it.
    await mkdir(path.join(configHome, 'google-chrome'), { recursive: true });
    const { logger } = createTestLogger('test');
    return {
        dataDir,
        home,
        configHome,
        options: { dataDir, platform: 'linux', homeDir: home, configHome, logger } as const,
    };
}
