import type { TimelineEntry } from './createJourneyTimeline.js';

/** The annotation type a journey's anti-bot vendor is recorded under. */
export const VENDOR_ANNOTATION = 'vendor';

/** The annotation type a journey's site (the host it starts on) is recorded under; its cooldown is kept per site. */
export const SITE_ANNOTATION = 'site';

/** The annotation type the URL a test's page ended on is recorded under. */
export const FINAL_URL_ANNOTATION = 'finalUrl';

/**
 * The annotation type a test's reCAPTCHA v3 score is recorded under, as a number in a string: the shop visit's mean, or
 * the score a CAPTCHA demo page showed.
 */
export const SCORE_ANNOTATION = 'score';

/** The project the others are compared with: a plain headless Chromium. */
const CONTROL_PROJECT = 'headless';

/** How a journey attempt failed: its `outcome` annotation. */
export interface AttemptOutcome {
    class: 'challenged' | 'refused' | 'broken';
    /** The vendor whose challenge was on the page. */
    vendor?: string;
    step: string;
    evidence: string;
}

/** How an attempt ended: passed, failed by class, or skipped (no attempt at all). */
export type AttemptStatus = 'passed' | 'challenged' | 'refused' | 'broken' | 'skipped';

/** A file Playwright saved for an attempt: its screenshot or HTML. */
export interface AttemptAttachment {
    name: string;
    path: string;
}

/** One finished attempt of a journey in one project, as the reporter read it from Playwright; saved as it is. */
export interface AttemptRecord {
    project: string;
    journey: string;
    /** Which of the `--repeat-each` repeats it was, from 0. */
    repeatEachIndex: number;
    status: AttemptStatus;
    /** Why it failed; a passed attempt may carry one too (a test that expected the failure), which counts for nothing. */
    outcome?: AttemptOutcome;
    /** The journey's protection vendor. */
    vendor?: string;
    /** The journey's site, the host it starts on. */
    site?: string;
    /** Where the page ended. */
    url?: string;
    durationMs: number;
    attachments: AttemptAttachment[];
    timeline?: TimelineEntry[];
    score?: number;
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
    /** The evidence most failed attempts gave. */
    failingEvidence?: string;
    /** Mean of the attempts' `score`, when any has one. */
    meanScore?: number;
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
            if (row.meanScore != null) {
                parts.push(`score ${row.meanScore.toFixed(2)}`);
            }
            if (row.controlPasses) {
                parts.push('control passes too');
            }
            const line = parts.join('  ').trimEnd();
            return row.failingEvidence == null ? line : `${line}\n    ${row.failingEvidence}`;
        })
        .join('\n');
}

function summarizeGroup(group: readonly AttemptRecord[], controlPassed: boolean): SiteRow {
    const [first] = group;
    const attempts = group.filter(record => record.status !== 'skipped');
    const failures = attempts.filter(record => record.status !== 'passed');
    const count = (status: AttemptStatus) => attempts.filter(record => record.status === status).length;

    const challengeVendors: Record<string, number> = {};
    for (const { status, outcome } of failures) {
        if (status === 'challenged' && outcome?.vendor != null) {
            challengeVendors[outcome.vendor] = (challengeVendors[outcome.vendor] ?? 0) + 1;
        }
    }
    const failingStep = mostFrequent(failures.flatMap(({ outcome }) => (outcome == null ? [] : [outcome.step])));
    const failingEvidence = mostFrequent(
        failures.flatMap(({ outcome }) => (outcome == null ? [] : [outcome.evidence])),
    );

    const scores = group.flatMap(record => (record.score == null ? [] : [record.score]));
    const protectionVendor = group.find(record => record.vendor != null)?.vendor;

    return {
        project: first?.project ?? '',
        journey: first?.journey ?? '',
        ...(protectionVendor == null ? {} : { vendor: protectionVendor }),
        passed: count('passed'),
        executed: attempts.length - count('refused'),
        refused: count('refused'),
        challenged: count('challenged'),
        broken: count('broken'),
        challengeVendors,
        ...(failingStep == null ? {} : { failingStep }),
        ...(failingEvidence == null ? {} : { failingEvidence }),
        ...(scores.length === 0 ? {} : { meanScore: scores.reduce((sum, score) => sum + score, 0) / scores.length }),
        controlPasses: first?.project !== CONTROL_PROJECT && controlPassed,
    };
}

/** The control passed: it ran the journey and every attempt it executed passed. */
function controlPasses(records: readonly AttemptRecord[], journey: string | undefined): boolean {
    const control = records.filter(
        record => record.project === CONTROL_PROJECT && record.journey === journey && record.status !== 'skipped',
    );
    return control.length > 0 && control.every(record => record.status === 'passed');
}

/** The value given most often; the first seen of those tied. */
function mostFrequent(values: readonly string[]): string | undefined {
    const counts = new Map<string, number>();
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    let best: string | undefined;
    let bestCount = 0;
    for (const [value, count] of counts) {
        if (count > bestCount) {
            best = value;
            bestCount = count;
        }
    }
    return best;
}
