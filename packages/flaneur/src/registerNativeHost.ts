import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { getChromeUserDataDir } from './getChromeUserDataDir.js';

/** Where the native messaging host is registered, and for which Chrome. */
export interface RegisterNativeHostOptions {
    /** flaneur's data folder: the host and its socket live in its `own-chrome` folder. */
    dataDir: string;
    /** The Chrome user data folder whose `NativeMessagingHosts` gets the manifest (macOS, Linux); Google Chrome's by default. */
    chromeUserDataDir?: string;
    /** The registry key the host is registered under (Windows); Google Chrome's by default. */
    registryKey?: string;
}

/** The registered host. */
export interface NativeHostRegistration {
    /** The socket (POSIX) or named pipe (Windows) the host listens on. */
    address: string;
}

/** The flaneur extension: the only one the host manifest lets talk to the host. */
export const OWN_CHROME_EXTENSION_ID = 'goimhkigkmnddobemofljbnlmlgbikcl';

/** The host's name, which the extension's `chrome.runtime.connectNative` asks for. */
const HOST_NAME = 'com.flaneur.own_chrome';
const DEFAULT_REGISTRY_KEY = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts';
/** The longest socket path, without the trailing NUL: `sun_path` holds 104 bytes on macOS, 108 on Linux. */
const MAX_SOCKET_PATH_BYTES = process.platform === 'darwin' ? 103 : 107;

const execFileAsync = promisify(execFile);

/**
 * Registers the native messaging host for the flaneur extension. Copies the host into `<dataDir>/own-chrome`, a folder
 * only the user may enter, and writes its manifest: next to Chrome's profiles (macOS, Linux) or in the registry
 * (Windows). Writes everything again each time, so a moved Node or a new flaneur is picked up.
 */
export async function registerNativeHost(options: RegisterNativeHostOptions): Promise<NativeHostRegistration> {
    const hostDir = path.join(options.dataDir, 'own-chrome');
    const address = getHostAddress(hostDir);
    await mkdir(hostDir, { recursive: true, mode: 0o700 });
    // An existing folder keeps its mode through `mkdir`.
    await chmod(hostDir, 0o700);

    const source = await readHostSource();
    const scriptPath = path.join(hostDir, 'nativeHost.mjs');
    const manifest = {
        name: HOST_NAME,
        description: 'Lets flaneur drive this Chrome through the flaneur extension',
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
        const key = `${options.registryKey ?? DEFAULT_REGISTRY_KEY}\\${HOST_NAME}`;
        await execFileAsync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f']);
        return { address };
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
    const manifestDir = path.join(options.chromeUserDataDir ?? getChromeUserDataDir(), 'NativeMessagingHosts');
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
        path.join(manifestDir, `${HOST_NAME}.json`),
        JSON.stringify({ ...manifest, path: launcherPath }, null, 4),
    );
    return { address };
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
