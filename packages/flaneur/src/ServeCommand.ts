import path from 'node:path';

import { Option } from '@nzyme/cli-core';
import { Command } from '@nzyme/cli-core/Command.js';
import { assertNever } from '@nzyme/utils/assertNever.js';

import { connectOwnChrome } from './connectOwnChrome.js';
import { createSitePace } from './createSitePace.js';
import { findChrome } from './findChrome.js';
import { getCliNativeHostTargets } from './getCliNativeHostTargets.js';
import { getDataDir } from './getDataDir.js';
import { installChromeForTesting } from './installChromeForTesting.js';
import { parseChromeOption } from './parseChromeOption.js';
import type { ChromeOption } from './parseChromeOption.js';
import { serveBrowser } from './serveBrowser.js';
import type { StealthBrowserServer } from './serveBrowser.js';
import { serveStealthBrowser } from './serveStealthBrowser.js';
import { startVpnTunnel } from './startVpnTunnel.js';

/**
 * The CLI's default command: launches a stealth Chrome and serves it until Chrome exits or the process is stopped.
 * stdout is a contract, the endpoint as its only line; everything else goes to stderr.
 */
export class ServeCommand extends Command {
    static override paths = [Command.Default];

    static override usage = Command.Usage({
        description: 'Launch a stealth Chrome and print its CDP endpoint',
        details: `
            Prints the endpoint, \`ws://127.0.0.1:<port>/<token>\`, as the only line on stdout; logs go to stderr.
            Runs until Chrome exits (exit code 1) or the process gets SIGINT or SIGTERM (exit code 0).
            Arguments after \`--\` are passed to Chrome as they are.
        `,
        examples: [
            ['Serve the installed Google Chrome', 'flaneur'],
            ['Serve the pinned Chrome for Testing', 'flaneur --chrome testing'],
            ['Serve your own Chrome, signed in as you are, through the flaneur extension', 'flaneur --chrome own'],
            [
                'Browse through a VPN region',
                'FLANEUR_VPN_USER=… FLANEUR_VPN_PASSWORD=… flaneur --vpn "US Texas" --vpn-provider "private internet access"',
            ],
        ],
    });

    chrome = Option.String('--chrome', {
        description:
            'Which Chrome runs: `installed` (the default), `own` (your own Chrome with your profile, through the flaneur ' +
            'extension), `testing` (the pinned Chrome for Testing, installed once), `testing@<version>` (another ' +
            'version, downloaded unverified) or a path to any Chrome binary',
    });

    userDataDir = Option.String('--user-data-dir', {
        description: "The browser profile; a persistent one in this computer's app data by default",
    });

    port = Option.String('--port', { description: 'The local port; any free one by default' });

    pace = Option.Boolean('--pace', true, { description: 'Hold sites to a human pace; `--no-pace` turns it off' });

    vpn = Option.String('--vpn', {
        description:
            'Browse through a VPN server region, e.g. "US Texas"; needs Docker and the login in FLANEUR_VPN_USER and ' +
            'FLANEUR_VPN_PASSWORD',
    });

    vpnProvider = Option.String('--vpn-provider', {
        description: 'The VPN provider, as gluetun names it, e.g. "private internet access"',
    });

    chromeArgs = Option.Rest({ name: 'chrome args' });

    override async run() {
        const chrome = parseChromeOption(this.chrome);
        const port = this.port == null ? undefined : parsePort(this.port);
        if ((this.vpn == null) !== (this.vpnProvider == null)) {
            throw new Error('--vpn and --vpn-provider go together');
        }

        const dataDir = getDataDir();
        const pace = this.pace ? createSitePace() : undefined;
        if (chrome.type === 'own') {
            this.checkOwnChromeOptions();
            const { browserDataDirs, registryKeys } = await getCliNativeHostTargets({ dataDir });
            const browser = await connectOwnChrome({
                dataDir,
                browserDataDirs,
                registryKeys,
                pace,
                logger: this.logger,
            });
            try {
                return await this.serve(await serveBrowser(browser, { port, logger: this.logger }));
            } catch (error) {
                await browser.close();
                throw error;
            }
        }

        const executablePath = await this.resolveChrome(chrome, dataDir);
        const tunnel =
            this.vpn == null || this.vpnProvider == null
                ? null
                : await startVpnTunnel({
                      provider: this.vpnProvider,
                      region: this.vpn,
                      credentials: readVpnCredentials(),
                      logger: this.logger,
                  });
        let server: StealthBrowserServer;
        try {
            server = await serveStealthBrowser({
                executablePath,
                userDataDir: this.userDataDir ?? path.join(dataDir, 'profile'),
                args: this.chromeArgs,
                proxy: tunnel?.proxy,
                port,
                pace,
                logger: this.logger,
            });
        } catch (error) {
            await tunnel?.close();
            throw error;
        }
        try {
            return await this.serve(server);
        } finally {
            await tunnel?.close();
        }
    }

    /**
     * Prints the endpoint and serves until the browser goes (exit code 1) or the process is stopped (exit code 0): a
     * launched Chrome closes, the user's own Chrome is only let go.
     */
    private async serve(server: StealthBrowserServer) {
        this.context.stdout.write(`${server.endpoint}\n`);

        let closing = false;
        process.once('SIGINT', close);
        process.once('SIGTERM', close);

        const exit = await server.browser.exited;
        await server.close();
        if (closing) {
            return 0;
        }
        this.logger.error('Chrome exited', { code: exit.code, signal: exit.signal });
        return 1;

        function close() {
            closing = true;
            void server.close();
        }
    }

    /** The options that shape a Chrome flaneur starts, which the user's own running Chrome cannot take. */
    private checkOwnChromeOptions() {
        if (this.userDataDir != null) {
            throw new Error('--chrome own uses your own Chrome profile: drop --user-data-dir');
        }
        if (this.chromeArgs.length > 0) {
            throw new Error('--chrome own drives your Chrome as it runs: arguments after -- cannot reach it');
        }
        if (this.vpn != null) {
            throw new Error('--chrome own cannot browse through a VPN: your Chrome keeps its own connection');
        }
    }

    private async resolveChrome(chrome: Exclude<ChromeOption, { type: 'own' }>, dataDir: string) {
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
                    logger: this.logger,
                });
                return installed.executablePath;
            }
            case 'path':
                return chrome.path;
            default:
                return assertNever(chrome);
        }
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
