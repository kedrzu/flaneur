import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from '@nzyme/utils/assert.js';

import { sitesTest } from '../sitesTest.js';

/** The worker fixtures `selftestTest` adds. */
export interface SelftestWorkerFixtures {
    /** The origin of the local server: the mini shop at `/`, a HUMAN challenge at `/challenge.html`, Beanwright at `/shop/`. */
    selftestOrigin: string;
}

/** The selftest's mini shop and challenge page. */
const PAGES_FOLDER = fileURLToPath(new URL('pages/', import.meta.url));

/** Beanwright, the reCAPTCHA test shop. */
const SHOP_FOLDER = fileURLToPath(new URL('../../../shop/', import.meta.url));

/** Beanwright's reCAPTCHA script: cut from the served pages, so the selftest stays offline and every action records an error. */
const RECAPTCHA_SCRIPT = /<script src="https:\/\/www\.google\.com\/recaptcha\/[^"]*"><\/script>/g;

const CONTENT_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
};

/** `sitesTest` with a local server of the selftest's pages, one per worker. */
export const selftestTest = sitesTest.extend<object, SelftestWorkerFixtures>({
    selftestOrigin: [
        // Playwright wants a destructured first argument; `runner` is a plain value, so depending on it sets nothing up.
        async ({ runner: _runner }, use) => {
            const server = createServer((request, response) => {
                serveFile(request, response).catch((error: unknown) => {
                    response.writeHead(500).end(String(error));
                });
            });
            await new Promise<void>(resolve => {
                server.listen(0, '127.0.0.1', resolve);
            });
            const address = server.address();
            assert(address != null && typeof address === 'object', 'the selftest server has no port');
            await use(`http://127.0.0.1:${address.port}`);
            await new Promise(resolve => {
                server.close(resolve);
            });
        },
        { scope: 'worker' },
    ],
});

async function serveFile(request: IncomingMessage, response: ServerResponse) {
    const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
    const [folder, relative] = pathname.startsWith('/shop/')
        ? [SHOP_FOLDER, pathname.slice('/shop/'.length)]
        : [PAGES_FOLDER, pathname.slice(1)];
    const file = path.join(folder, relative === '' || relative.endsWith('/') ? `${relative}index.html` : relative);
    const contentType = CONTENT_TYPES[path.extname(file)];
    if (!file.startsWith(folder) || contentType == null) {
        response.writeHead(404).end();
        return;
    }

    let body: string;
    try {
        body = await readFile(file, 'utf8');
    } catch {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, { 'Content-Type': contentType }).end(body.replace(RECAPTCHA_SCRIPT, ''));
}
