import type { SiteCooldowns } from './siteCooldowns.js';
import { remainingCooldownMinutes } from './siteCooldowns.js';
import type { SiteRow } from './summarizeSites.js';

/** A saved sites run, as far as the history reads it. */
export interface SitesRun {
    startedAt: string;
    rows: Pick<SiteRow, 'project' | 'journey' | 'passed' | 'executed'>[];
}

/** Options of `formatSitesHistory`. */
export interface FormatSitesHistoryParams {
    /** Oldest first: a column each, left to right. */
    runs: readonly SitesRun[];
    cooldowns: SiteCooldowns;
    now: Date;
}

/** The project the history shows. */
const HISTORY_PROJECT = 'flaneur';

/**
 * A journey × run matrix of flaneur's `passed/executed` (`-` where the run did not have the journey), then the sites
 * still cooling.
 * @__NO_SIDE_EFFECTS__
 */
export function formatSitesHistory({ runs, cooldowns, now }: FormatSitesHistoryParams): string {
    const journeys: string[] = [];
    for (const run of runs) {
        for (const row of run.rows) {
            if (row.project === HISTORY_PROJECT && !journeys.includes(row.journey)) {
                journeys.push(row.journey);
            }
        }
    }

    // `2026-11-21T10:15:00.000Z` → `11-21 10:15`, UTC as saved.
    const headers = runs.map(run => run.startedAt.slice(5, 16).replace('T', ' '));
    const lines = [['journey', ...headers]];
    for (const journey of journeys) {
        const cells = runs.map(run => {
            const row = run.rows.find(item => item.project === HISTORY_PROJECT && item.journey === journey);
            return row == null ? '-' : `${row.passed}/${row.executed}`;
        });
        lines.push([journey, ...cells]);
    }
    const widths = headers.map((_, index) => Math.max(...lines.map(line => line[index + 1]?.length ?? 0)));
    const journeyWidth = Math.max(...lines.map(line => line[0]?.length ?? 0));
    const matrix = lines.map(line =>
        [(line[0] ?? '').padEnd(journeyWidth), ...line.slice(1).map((cell, index) => cell.padEnd(widths[index] ?? 0))]
            .join('  ')
            .trimEnd(),
    );

    const cooling = Object.entries(cooldowns).flatMap(([site, cooldown]) => {
        const minutes = remainingCooldownMinutes(cooldowns, site, now);
        return minutes > 0 ? [`${site}  ${minutes} min  (${cooldown.reason})`] : [];
    });
    return [
        ...matrix,
        '',
        ...(cooling.length === 0 ? ['No site is cooling.'] : ['Cooling:', ...cooling.map(line => `  ${line}`)]),
    ].join('\n');
}
