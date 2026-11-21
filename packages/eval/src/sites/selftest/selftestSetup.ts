import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createSitePace } from 'flaneur';
import type { FullConfig } from 'playwright/test';

import { serveSitesBrowser } from '../serveSitesBrowser.js';

/** The selftest's global setup: flaneur on a throwaway profile, removed in the teardown, at a pace short enough for local pages. */
export default async function selftestSetup(config: FullConfig) {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'flaneur-sites-selftest-'));
    const teardown = await serveSitesBrowser(config, {
        userDataDir,
        // The pace holds for 127.0.0.1 as for any site.
        pace: createSitePace({ intervalMs: 500 }),
    });

    return async () => {
        await teardown?.();
        await rm(userDataDir, { recursive: true, force: true });
    };
}
