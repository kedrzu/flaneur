import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { Logger } from '@nzyme/logging/Logger.js';

import { isNativeMessagingHostsKey, readCliConfig, writeCliConfig } from './cliConfig.js';
import type { FindNativeHostTargetsParams } from './findNativeHostTargets.js';
import { getCliNativeHostTargets } from './getCliNativeHostTargets.js';
import { readRememberedBrowser } from './readRememberedBrowser.js';
import { registerNativeHost } from './registerNativeHost.js';

/** What to store and where to look; the lists of `FindNativeHostTargetsParams` are for tests to keep off the real home. */
export interface SetupNativeHostOptions extends FindNativeHostTargetsParams {
    /** Replaces the stored folders of browsers detection misses; each must hold a `Local State`. Stored ones stay when not given. */
    browserDataDirs?: string[];
    /** Replaces the stored registry keys (Windows); each must be `HKCU\Software\…\NativeMessagingHosts`. Stored ones stay when not given. */
    registryKeys?: string[];
    logger: Logger;
}

/** The outcome of a setup. */
export interface SetupNativeHostResult {
    /** The user data folders (POSIX) or registry keys (Windows) the host was registered in. */
    registeredIn: string[];
    /** The browser the extension last connected from, when one did. */
    browser?: string;
}

/**
 * Stores the browsers the user names in the config (validated first: nothing is written or registered when one is
 * wrong), then registers the native messaging host in every browser found, stored or named, so the extension
 * connects with no further step.
 */
export async function setupNativeHost(options: SetupNativeHostOptions): Promise<SetupNativeHostResult> {
    const { dataDir, logger } = options;
    const browserDataDirs = options.browserDataDirs?.map(dir => path.resolve(dir));
    for (const dir of browserDataDirs ?? []) {
        if (!(await isBrowserDataDir(dir))) {
            throw new Error(`--browser-data ${dir} is not a browser's user data folder: it has no "Local State" file`);
        }
    }
    for (const key of options.registryKeys ?? []) {
        if (!isNativeMessagingHostsKey(key)) {
            throw new Error(`--registry-key ${key} is not of the form HKCU\\Software\\…\\NativeMessagingHosts`);
        }
    }

    const stored = await readCliConfig(dataDir);
    if (browserDataDirs != null || options.registryKeys != null) {
        await writeCliConfig(dataDir, {
            browserDataDirs: browserDataDirs ?? stored.browserDataDirs,
            registryKeys: options.registryKeys ?? stored.registryKeys,
        });
    }

    const targets = await getCliNativeHostTargets(options);
    const { registeredIn } = await registerNativeHost({ dataDir, ...targets, logger });
    const browser = await readRememberedBrowser(path.join(dataDir, 'own-chrome'), logger);
    return { registeredIn, browser };
}

async function isBrowserDataDir(dir: string) {
    return stat(path.join(dir, 'Local State')).then(
        info => info.isFile(),
        () => false,
    );
}
