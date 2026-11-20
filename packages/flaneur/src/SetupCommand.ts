import { Option } from '@nzyme/cli-core';
import { Command } from '@nzyme/cli-core/Command.js';

import { getDataDir } from './getDataDir.js';
import { setupNativeHost } from './setupNativeHost.js';

/**
 * Registers the native messaging host in your browsers and stores the ones flaneur cannot find by itself. stdout says
 * where the host was registered and which browser flaneur will start.
 */
export class SetupCommand extends Command {
    static override paths = [['setup']];

    static override usage = Command.Usage({
        description: 'Register flaneur in your browsers and remember browsers it cannot find on its own',
        details: `
            Registers the native messaging host that \`flaneur --chrome own\` uses in every Chromium browser it finds, and in
            the ones stored here. \`--browser-data\` and \`--registry-key\` are for the rest: a portable browser, a browser
            started with its own \`--user-data-dir\`, a Windows browser with a registry key of its own. They are stored
            in \`config.json\` in flaneur's data folder, replacing what was stored for that option, and used on every
            later \`--chrome own\`.
        `,
        examples: [
            ['Register in the browsers flaneur finds', 'flaneur setup'],
            [
                'Also use a browser with its own user data folder',
                'flaneur setup --browser-data ~/portable-browser/data',
            ],
            [
                "Also register under a Windows browser's own registry key",
                'flaneur setup --registry-key "HKCU\\Software\\<Vendor>\\<Browser>\\NativeMessagingHosts"',
            ],
        ],
    });

    browserData = Option.Array('--browser-data', {
        description:
            "A browser's user data folder (the one with `Local State`; macOS, Linux); repeat for more. Replaces the stored folders",
    });

    registryKey = Option.Array('--registry-key', {
        description:
            'A registry key `HKCU\\Software\\…\\NativeMessagingHosts` to register under (Windows); repeat for more. Replaces the stored keys',
    });

    override async run() {
        const { registeredIn, browser } = await setupNativeHost({
            dataDir: getDataDir(),
            browserDataDirs: this.browserData,
            registryKeys: this.registryKey,
            logger: this.logger,
        });
        const { stdout } = this.context;
        stdout.write(`Registered the native messaging host in:\n${registeredIn.map(place => `  ${place}\n`).join('')}`);
        stdout.write(
            browser == null
                ? 'No browser is remembered yet: it is learned when the flaneur extension first connects.\n'
                : `Remembered browser: ${browser}\n`,
        );
    }
}
