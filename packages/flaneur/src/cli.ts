import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { createContainer } from '@nzyme/ioc/Container.js';
import { createLogger, setLoggerTransport } from '@nzyme/logging/createLogger.js';
import { LoggerTransport } from '@nzyme/logging/LoggerTransport.js';
import { PrettyCliLoggerTransport } from '@nzyme/logging/PrettyCliLoggerTransport.js';
import { assertNever } from '@nzyme/utils/assertNever.js';

import { createSitePace } from './createSitePace.js';
import { findChrome } from './findChrome.js';
import { installChromeForTesting } from './installChromeForTesting.js';
import { parseChromeOption } from './parseChromeOption.js';
import type { ChromeOption } from './parseChromeOption.js';
import { serveStealthBrowser } from './serveStealthBrowser.js';
import type { StealthBrowserServer } from './serveStealthBrowser.js';
import { startVpnTunnel } from './startVpnTunnel.js';

const USAGE = `Usage: flaneur [--chrome installed|testing|testing@<version>|<path>] [--user-data-dir <dir>]
                       [--port <n>] [--no-pace]
                       [--vpn <region> --vpn-provider <name>] [-- <chrome args>]

Launches a stealth Chrome and prints its CDP endpoint (ws://127.0.0.1:<port>/<token>) as the only line on stdout.

  --chrome <chrome>         which Chrome runs:
                              installed            the installed Google Chrome (the default)
                              testing              the pinned Chrome for Testing, installed once
                              testing@<version>    another Chrome for Testing version, downloaded unverified
                              <path>               any Chrome binary
  --user-data-dir <dir>     the browser profile; a persistent one in this computer's app data by default
  --port <n>                the local port; any free one by default
  --no-pace                 do not hold sites to a human pace
  --vpn <region>            browse through a VPN server region, e.g. "US Texas"; needs Docker and the login in
                            FLANEUR_VPN_USER and FLANEUR_VPN_PASSWORD
  --vpn-provider <name>     the VPN provider, as gluetun names it, e.g. "private internet access"
  -- <chrome args>          passed to Chrome as they are`;

/** The folder this CLI keeps its profile and Chrome for Testing in. */
const DATA_FOLDER = 'flaneur';

setLoggerTransport(createCliTransport());
const logger = createLogger('flaneur');

try {
    await run();
} catch (error) {
    logger.error('The stealth browser failed to start', { error });
    process.exit(1);
}

async function run() {
    const separator = process.argv.indexOf('--', 2);
    const ownArgs = separator === -1 ? process.argv.slice(2) : process.argv.slice(2, separator);
    const chromeArgs = separator === -1 ? [] : process.argv.slice(separator + 1);
    const { values } = parseArgs({
        args: ownArgs,
        options: {
            chrome: { type: 'string' },
            'user-data-dir': { type: 'string' },
            port: { type: 'string' },
            'no-pace': { type: 'boolean' },
            vpn: { type: 'string' },
            'vpn-provider': { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        },
    });
    if (values.help) {
        console.error(USAGE);
        return;
    }
    const chrome = parseChromeOption(values.chrome);
    if ((values.vpn == null) !== (values['vpn-provider'] == null)) {
        throw new Error('--vpn and --vpn-provider go together');
    }

    const dataDir = getDataDir();
    const executablePath = await resolveChrome(chrome, dataDir);
    const tunnel =
        values.vpn == null || values['vpn-provider'] == null
            ? null
            : await startVpnTunnel({
                  provider: values['vpn-provider'],
                  region: values.vpn,
                  credentials: readVpnCredentials(),
                  logger,
              });
    let server: StealthBrowserServer;
    try {
        server = await serveStealthBrowser({
            executablePath,
            userDataDir: values['user-data-dir'] ?? path.join(dataDir, 'profile'),
            args: chromeArgs,
            proxy: tunnel?.proxy,
            port: values.port == null ? undefined : parsePort(values.port),
            pace: values['no-pace'] ? undefined : createSitePace(),
            logger,
        });
    } catch (error) {
        await tunnel?.close();
        throw error;
    }
    process.stdout.write(`${server.endpoint}\n`);

    let closing = false;
    process.once('SIGINT', close);
    process.once('SIGTERM', close);

    const exit = await server.browser.exited;
    await server.close();
    await tunnel?.close();
    if (!closing) {
        logger.error('Chrome exited', { code: exit.code, signal: exit.signal });
        process.exit(1);
    }
    process.exit(0);

    function close() {
        closing = true;
        void server.close();
    }
}

async function resolveChrome(chrome: ChromeOption, dataDir: string) {
    switch (chrome.type) {
        case 'installed': {
            const executablePath = findChrome();
            if (!executablePath) {
                throw new Error(
                    'Google Chrome is not installed: install it, or pass --chrome testing or --chrome <path>',
                );
            }
            return executablePath;
        }
        case 'testing': {
            const installed = await installChromeForTesting({
                cacheDir: path.join(dataDir, 'chrome-for-testing'),
                version: chrome.version,
                logger,
            });
            return installed.executablePath;
        }
        case 'path':
            return chrome.path;
        default:
            return assertNever(chrome);
    }
}

/** The VPN login, from the environment only: on the command line every local user could read it. */
function readVpnCredentials() {
    const username = process.env['FLANEUR_VPN_USER'];
    const password = process.env['FLANEUR_VPN_PASSWORD'];
    if (username == null || username === '' || password == null || password === '') {
        throw new Error('--vpn needs the VPN login in FLANEUR_VPN_USER and FLANEUR_VPN_PASSWORD');
    }
    return { username, password };
}

function parsePort(value: string) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error(`--port is not a port: ${value}`);
    }
    return port;
}

/** This computer's per-user app data folder for the CLI. */
function getDataDir() {
    switch (process.platform) {
        case 'darwin':
            return path.join(os.homedir(), 'Library', 'Application Support', DATA_FOLDER);
        case 'win32':
            return path.join(process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local'), DATA_FOLDER);
        default:
            return path.join(process.env['XDG_DATA_HOME'] ?? path.join(os.homedir(), '.local', 'share'), DATA_FOLDER);
    }
}

/** Logs go to stderr: stdout carries only the endpoint, which callers read. */
function createCliTransport() {
    const container = createContainer();
    container.register(PrettyCliLoggerTransport);
    return container.resolve(LoggerTransport);
}
