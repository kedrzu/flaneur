import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { asArray, asNumber, asObject, asString } from '../jsonShape.js';
import { formatSitesHistory } from './formatSitesHistory.js';
import type { SitesRun } from './formatSitesHistory.js';
import { SITES_RESULTS_FOLDER } from './serveSitesBrowser.js';
import { COOLDOWN_FILE, readCooldowns } from './siteCooldowns.js';

// `bun run eval:sites:history [runs]`: flaneur's pass rate per journey over the last runs (5 by default), and the sites
// cooling now.

const DEFAULT_RUNS = 5;

const count = Number(process.argv[2] ?? DEFAULT_RUNS);
if (!Number.isInteger(count) || count < 1) {
    throw new Error(`The number of runs must be a positive integer, not ${process.argv[2]}`);
}

const files = await listRunFiles();
const runs: SitesRun[] = [];
for (const file of files.slice(-count)) {
    runs.push(parseSitesRun(JSON.parse(await readFile(path.join(SITES_RESULTS_FOLDER, file), 'utf8')), file));
}
process.stdout.write(`${formatSitesHistory({ runs, cooldowns: readCooldowns(COOLDOWN_FILE), now: new Date() })}\n`);

/** The saved sites runs, oldest first: the names start with the run's time. */
async function listRunFiles() {
    try {
        return (await readdir(SITES_RESULTS_FOLDER)).filter(file => file.endsWith('-sites.json')).toSorted();
    } catch {
        return [];
    }
}

function parseSitesRun(value: unknown, file: string): SitesRun {
    try {
        const run = asObject(value, 'run');
        return {
            startedAt: asString(run['startedAt'], 'startedAt'),
            rows: asArray(run['rows'], 'rows').map((item, index) => {
                const row = asObject(item, `rows[${index}]`);
                return {
                    project: asString(row['project'], `rows[${index}].project`),
                    journey: asString(row['journey'], `rows[${index}].journey`),
                    passed: asNumber(row['passed'], `rows[${index}].passed`),
                    executed: asNumber(row['executed'], `rows[${index}].executed`),
                };
            }),
        };
    } catch (error) {
        throw new Error(`${file} is not a sites run`, { cause: error });
    }
}
