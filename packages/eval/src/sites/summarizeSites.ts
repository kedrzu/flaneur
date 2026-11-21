/** The annotation type a journey's anti-bot vendor is recorded under. */
export const VENDOR_ANNOTATION = 'vendor';

/** The annotation type the shop visit's mean reCAPTCHA v3 score is recorded under, as a number in a string. */
export const SHOP_SCORE_ANNOTATION = 'shopScore';

/** The project the others are compared with: a plain headless Chromium. */
const CONTROL_PROJECT = 'headless';

/** How a journey attempt failed: its `outcome` annotation, as far as the summary needs it. */
export interface AttemptOutcome {
    class: 'challenged' | 'refused' | 'broken';
    vendor?: string;
    step: string;
}

/** One finished attempt of a journey in one project, as the reporter read it from Playwright. */
export interface AttemptRecord {
    project: string;
    journey: string;
    /** Ran to the end: not skipped. */
    executed: boolean;
    /** Ended as the test expected. */
    passed: boolean;
    outcome?: AttemptOutcome;
    /** The journey's protection vendor. */
    vendor?: string;
    shopScore?: number;
}

/** A journey's attempts in one project. */
export interface SiteRow {
    project: string;
    journey: string;
    /** The vendor the journey's site sits behind. */
    vendor?: string;
    /** Attempts that passed. */
    passed: number;
    /** Attempts the pass rate is over: run, and not refused by flaneur's own pace. */
    executed: number;
    refused: number;
    /** Failed attempts by class. */
    challenged: number;
    broken: number;
    /** Vendors of the challenges seen, with how often. */
    challengeVendors: Record<string, number>;
    /** The step most failed attempts failed in. */
    failingStep?: string;
    /** Mean of the attempts' `shopScore`, when any has one. */
    meanShopScore?: number;
    /** The `headless` project ran this journey in this run and passed every attempt. */
    controlPasses: boolean;
}

/** Groups attempts into one row per journey and project, in the order first seen. */
export function summarizeSites(records: readonly AttemptRecord[]): SiteRow[] {
    const groups = new Map<string, AttemptRecord[]>();
    for (const record of records) {
        const key = `${record.project}\n${record.journey}`;
        const group = groups.get(key);
        if (group == null) {
            groups.set(key, [record]);
        } else {
            group.push(record);
        }
    }

    const rows: SiteRow[] = [];
    for (const group of groups.values()) {
        rows.push(summarizeGroup(group, controlPasses(records, group[0]?.journey)));
    }
    return rows;
}

/** One line per row, with the challenge vendors and the failing step when there are any. */
export function formatSiteRows(rows: readonly SiteRow[]): string {
    const projectWidth = Math.max(0, ...rows.map(row => row.project.length));
    const journeyWidth = Math.max(0, ...rows.map(row => row.journey.length));
    const rate = (row: SiteRow) => `${row.passed}/${row.executed}`;
    const rateWidth = Math.max(0, ...rows.map(row => rate(row).length));

    return rows
        .map(row => {
            const parts = [
                row.project.padEnd(projectWidth),
                row.journey.padEnd(journeyWidth),
                rate(row).padEnd(rateWidth),
                `challenged ${row.challenged}  refused ${row.refused}  broken ${row.broken}`,
            ];
            const vendors = Object.entries(row.challengeVendors).map(([vendor, count]) => `${vendor} ${count}`);
            if (vendors.length > 0) {
                parts.push(`vendors: ${vendors.join(', ')}`);
            }
            if (row.failingStep != null) {
                parts.push(`step: ${row.failingStep}`);
            }
            if (row.meanShopScore != null) {
                parts.push(`score ${row.meanShopScore.toFixed(2)}`);
            }
            if (row.controlPasses) {
                parts.push('control passes too');
            }
            return parts.join('  ').trimEnd();
        })
        .join('\n');
}

function summarizeGroup(group: readonly AttemptRecord[], controlPassed: boolean): SiteRow {
    const [first] = group;
    const attempts = group.filter(record => record.executed);
    const failures = attempts.filter(record => !record.passed);
    const refused = failures.filter(record => record.outcome?.class === 'refused');
    const counted = failures.filter(record => record.outcome?.class !== 'refused');

    const challengeVendors: Record<string, number> = {};
    for (const { outcome } of counted) {
        if (outcome?.class === 'challenged' && outcome.vendor != null) {
            challengeVendors[outcome.vendor] = (challengeVendors[outcome.vendor] ?? 0) + 1;
        }
    }

    const scores = group.flatMap(record => (record.shopScore == null ? [] : [record.shopScore]));
    const protectionVendor = group.find(record => record.vendor != null)?.vendor;

    return {
        project: first?.project ?? '',
        journey: first?.journey ?? '',
        ...(protectionVendor == null ? {} : { vendor: protectionVendor }),
        passed: attempts.length - failures.length,
        executed: attempts.length - refused.length,
        refused: refused.length,
        challenged: counted.filter(record => record.outcome?.class === 'challenged').length,
        broken: counted.filter(record => record.outcome?.class === 'broken').length,
        challengeVendors,
        ...mostFrequentStep(failures),
        ...(scores.length === 0
            ? {}
            : { meanShopScore: scores.reduce((sum, score) => sum + score, 0) / scores.length }),
        controlPasses: first?.project !== CONTROL_PROJECT && controlPassed,
    };
}

/** The control passed: it ran the journey and every attempt it executed passed. */
function controlPasses(records: readonly AttemptRecord[], journey: string | undefined): boolean {
    const control = records.filter(
        record => record.project === CONTROL_PROJECT && record.journey === journey && record.executed,
    );
    return control.length > 0 && control.every(record => record.passed);
}

function mostFrequentStep(failures: readonly AttemptRecord[]): { failingStep?: string } {
    const counts = new Map<string, number>();
    for (const { outcome } of failures) {
        if (outcome != null) {
            counts.set(outcome.step, (counts.get(outcome.step) ?? 0) + 1);
        }
    }
    let best: string | undefined;
    let bestCount = 0;
    for (const [step, count] of counts) {
        if (count > bestCount) {
            best = step;
            bestCount = count;
        }
    }
    return best == null ? {} : { failingStep: best };
}
