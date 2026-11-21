import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'bun:test';

import { findNativeHostTargets } from './findNativeHostTargets.js';

const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) {
        await cleanup();
    }
});

test('finds browsers two levels deep and neither Electron apps nor flaneur’s own profile', async () => {
    const { homeDir, root } = await createHome();
    const dataDir = path.join(root, 'flaneur');
    await createBrowser(path.join(root, 'Arc', 'User Data'));
    await createBrowser(path.join(root, 'com.operasoftware.Opera'));
    await createBrowser(path.join(root, 'Google', 'Chrome'));
    await createBrowser(path.join(dataDir, 'profile'));
    // An Electron app: `Local State` but no profile.
    await mkdir(path.join(root, 'Slack'), { recursive: true });
    await writeFile(path.join(root, 'Slack', 'Local State'), '{}');

    const targets = await findNativeHostTargets({ dataDir, platform: 'darwin', homeDir });

    expect(targets).toEqual({
        browserDataDirs: [
            path.join(root, 'Google', 'Chrome'),
            path.join(root, 'com.operasoftware.Opera'),
            path.join(root, 'Arc', 'User Data'),
        ],
        registryKeys: [],
    });
});

test('lists Google Chrome’s folder on Linux even before it has a profile', async () => {
    const { homeDir } = await createHome();
    const configHome = path.join(homeDir, '.config');
    await createBrowser(path.join(configHome, 'BraveSoftware', 'Brave-Browser'));

    const targets = await findNativeHostTargets({
        dataDir: path.join(homeDir, 'data'),
        platform: 'linux',
        homeDir,
        configHome,
    });

    expect(targets.browserDataDirs).toEqual([
        path.join(configHome, 'google-chrome'),
        path.join(configHome, 'BraveSoftware', 'Brave-Browser'),
    ]);
});

test('derives registry keys from the Windows folders, with and without a vendor, plus Chrome’s and Chromium’s', async () => {
    const { homeDir } = await createHome();
    const localAppData = path.join(homeDir, 'Local');
    await createBrowser(path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'));
    await createBrowser(path.join(localAppData, 'Vivaldi', 'User Data'));
    await createBrowser(path.join(localAppData, 'Google', 'Chrome', 'User Data'));
    // An application that is not a browser.
    await mkdir(path.join(localAppData, 'Slack', 'User Data'), { recursive: true });
    await createBrowser(path.join(localAppData, 'flaneur', 'profile', 'User Data'));

    const targets = await findNativeHostTargets({
        dataDir: path.join(localAppData, 'flaneur'),
        platform: 'win32',
        homeDir,
        localAppData,
    });

    expect(targets).toEqual({
        browserDataDirs: [],
        registryKeys: [
            'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
            'HKCU\\Software\\Chromium\\NativeMessagingHosts',
            'HKCU\\Software\\Vivaldi\\NativeMessagingHosts',
            'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
        ],
    });
});

async function createHome() {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'flaneur-find-'));
    cleanups.push(() => rm(homeDir, { recursive: true, force: true }));
    return { homeDir, root: path.join(homeDir, 'Library', 'Application Support') };
}

/** What marks a browser's user data folder: `Local State` and a profile with extensions. */
async function createBrowser(dir: string) {
    await mkdir(path.join(dir, 'Default', 'Extensions'), { recursive: true });
    await writeFile(path.join(dir, 'Local State'), '{}');
}
