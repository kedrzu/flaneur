import { readFileSync } from 'node:fs';

import { execute } from '@nzyme/cli-core/execute.js';
import { initialize } from '@nzyme/cli-core/initialize.js';
import { createContainer } from '@nzyme/ioc/Container.js';
import { setLoggerTransport } from '@nzyme/logging/createLogger.js';
import { LoggerTransport } from '@nzyme/logging/LoggerTransport.js';
import { PrettyCliLoggerTransport } from '@nzyme/logging/PrettyCliLoggerTransport.js';
import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

import { ServeCommand } from './ServeCommand.js';

initialize();

// Logs of code given no logger go to stderr too: stdout carries only the endpoint, which callers read.
const container = createContainer();
container.register(PrettyCliLoggerTransport);
setLoggerTransport(container.resolve(LoggerTransport));

await execute({
    name: 'flaneur',
    title: 'A stealth Chrome for AI agents',
    version: readVersion(),
    commands: [ServeCommand],
    container,
});

/** The package's version; `package.json` sits one folder above both `src/` and the published `dist/`. */
function readVersion() {
    const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return isPlainObject(manifest) && typeof manifest['version'] === 'string' ? manifest['version'] : undefined;
}
