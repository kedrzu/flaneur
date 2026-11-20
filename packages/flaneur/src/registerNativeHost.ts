import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createLogger } from '@nzyme/logging/createLogger.js';
import type { Logger } from '@nzyme/logging/Logger.js';

import { findNativeHostTargets } from './findNativeHostTargets.js';
import { getChromeUserDataDir } from './getChromeUserDataDir.js';

/** Where the native messaging host is registered. */
export interface RegisterNativeHostOptions {
    /** flaneur's data folder: the host and its socket live in its `own-chrome` folder. */
    dataDir: string;
    /**
     * The browsers' user data folders whose `NativeMessagingHosts` get the manifest (macOS, Linux); a folder that does
     * not exist is skipped, except Google Chrome's. Found on disk by `findNativeHostTargets` by default.
     */
    browserDataDirs?: string[];
    /** The registry keys the host is registered under (Windows); found by `findNativeHostTargets` by default. */
    registryKeys?: string[];
    logger?: Logger;
}

/** The registered host. */
export interface NativeHostRegistration {
    /** The socket (POSIX) or named pipe (Windows) the host listens on. */
    address: string;
    /** The user data folders (POSIX) or registry keys (Windows) the host was registered in. */
    registeredIn: string[];
}

/** The flaneur extension: the only one the host manifest lets talk to the host. */
export const OWN_CHROME_EXTENSION_ID = 'goimhkigkmnddobemofljbnlmlgbikcl';

/** The host's name, which the extension's `chrome.runtime.connectNative` asks for. */
const HOST_NAME = 'com.flaneur.own_chrome';
/** The longest socket path, without the trailing NUL: `sun_path` holds 104 bytes on macOS, 108 on Linux. */
const MAX_SOCKET_PATH_BYTES = process.platform === 'darwin' ? 103 : 107;

const execFileAsync = promisify(execFile);

/**
 * Registers the native messaging host for the flaneur extension. Copies the host into `<dataDir>/own-chrome`, a folder
 * only the user may enter, and writes its manifest: in every browser's user data folder (macOS, Linux) or under every
 * registry key (Windows). Writes everything again each time, so a moved Node or a new flaneur is picked up. A place that
 * cannot be written is logged and does not stop the others; it throws when none could be.
 */
export async function registerNativeHost(options: RegisterNativeHostOptions): Promise<NativeHostRegistration> {
    const logger = options.logger ?? createLogger('NativeHost');
    const hostDir = path.join(options.dataDir, 'own-chrome');
    const address = getHostAddress(hostDir);
    await mkdir(hostDir, { recursive: true, mode: 0o700 });
    // An existing folder keeps its mode through `mkdir`.
    await chmod(hostDir, 0o700);

    const found =
        options.browserDataDirs == null || options.registryKeys == null ? await findNativeHostTargets(options) : null;
    const browserDataDirs = options.browserDataDirs ?? found?.browserDataDirs ?? [];
    const registryKeys = options.registryKeys ?? found?.registryKeys ?? [];

    const source = await readHostSource();
    const scriptPath = path.join(hostDir, 'nativeHost.mjs');
    const manifest = {
        name: HOST_NAME,
        description: 'Lets flaneur drive this browser through the flaneur extension',
        path: scriptPath,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${OWN_CHROME_EXTENSION_ID}/`],
    };

    if (process.platform === 'win32') {
        // Chrome runs only executables on Windows, so a batch file starts the script with this Node or Bun.
        const batchPath = path.join(hostDir, 'host.bat');
        await writeFile(scriptPath, source);
        await writeFile(batchPath, `@"${process.execPath}" "${scriptPath}" %*\r\n`);
        const manifestPath = path.join(hostDir, `${HOST_NAME}.json`);
        await writeFile(manifestPath, JSON.stringify({ ...manifest, path: batchPath }, null, 4));
        const registeredIn = await registerEverywhere(registryKeys, logger, async registryKey => {
            const key = `${registryKey}\\${HOST_NAME}`;
            await execFileAsync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f']);
            return true;
        });
        return { address, registeredIn };
    }

    // Chrome starts the host without the user's PATH (from the Dock, say), hence this runtime's absolute path; a shell
    // script rather than a shebang, which cannot hold a path with a space.
    const launcherPath = path.join(hostDir, 'host.sh');
    await writeFile(scriptPath, source);
    await writeFile(
        launcherPath,
        `#!/bin/sh\nexec ${quoteForShell(process.execPath)} ${quoteForShell(scriptPath)} "$@"\n`,
        { mode: 0o700 },
    );
    await chmod(launcherPath, 0o700);
    const manifestJson = JSON.stringify({ ...manifest, path: launcherPath }, null, 4);
    const chromeDir = path.resolve(getChromeUserDataDir());
    const registeredIn = await registerEverywhere(browserDataDirs, logger, async browserDataDir => {
        // A browser that is not there gets no folder of its own, except Google Chrome, which reads the host at its first run.
        if (path.resolve(browserDataDir) !== chromeDir && !(await isDirectory(browserDataDir))) {
            logger.info('Skipping a browser folder that does not exist', { browserDataDir });
            return false;
        }
        const manifestDir = path.join(browserDataDir, 'NativeMessagingHosts');
        await mkdir(manifestDir, { recursive: true });
        await writeFile(path.join(manifestDir, `${HOST_NAME}.json`), manifestJson);
        return true;
    });
    return { address, registeredIn };
}

/** Runs `register` for each place, logging the ones that fail; the places it registered in (`true`). */
async function registerEverywhere(places: string[], logger: Logger, register: (place: string) => Promise<boolean>) {
    const registeredIn: string[] = [];
    const errors: unknown[] = [];
    for (const place of places) {
        try {
            if (await register(place)) {
                registeredIn.push(place);
                logger.debug('Registered the native messaging host', { place });
            }
        } catch (error) {
            errors.push(error);
            logger.warn('Could not register the native messaging host', { place, error });
        }
    }
    if (registeredIn.length === 0 && errors.length > 0) {
        throw new Error('The native messaging host could not be registered anywhere', { cause: errors[0] });
    }
    return registeredIn;
}

async function isDirectory(dir: string) {
    return stat(dir).then(
        info => info.isDirectory(),
        () => false,
    );
}

/** `value` as one word of a POSIX shell command, whatever it holds. */
function quoteForShell(value: string) {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The host's compiled code, from source as from the package: `dist` sits beside `src` in the package. */
async function readHostSource() {
    const hostPath = fileURLToPath(new URL('../dist/nativeHost.js', import.meta.url));
    try {
        return await readFile(hostPath, 'utf8');
    } catch (error) {
        throw new Error(`The native messaging host is missing at ${hostPath}: build flaneur first`, { cause: error });
    }
}

/** The address `nativeHost.ts` listens on, worked out the same way there. */
function getHostAddress(hostDir: string) {
    if (process.platform === 'win32') {
        return `\\\\.\\pipe\\flaneur-own-chrome-${os.userInfo().username}`;
    }
    const socketPath = path.join(hostDir, 'host.sock');
    if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_BYTES) {
        throw new Error(
            `The native host's socket path ${socketPath} is longer than the ${MAX_SOCKET_PATH_BYTES} bytes this ` +
                'system allows: use a data folder with a shorter path',
        );
    }
    return socketPath;
}
