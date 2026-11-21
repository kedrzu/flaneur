import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { FullResult, Reporter, TestCase, TestResult } from 'playwright/types/testReporter';

import { asArray, asNumber, asObject, asOneOf, asString, asStringArray } from '../jsonShape.js';
import type { AbckState, VendorCookieSummary } from '../vendorCookies.js';
import { TIMELINE_ANNOTATION } from './createJourneyTimeline.js';
import type { TimelineEntry } from './createJourneyTimeline.js';
import { OUTCOME_ANNOTATION } from './defineJourney.js';
import { SITES_RESULTS_FOLDER } from './serveSitesBrowser.js';
import { addCooldown, COOLDOWN_FILE, readCooldowns, writeCooldowns } from './siteCooldowns.js';
import {
    FINAL_URL_ANNOTATION,
    formatSiteRows,
    SCORE_ANNOTATION,
    SITE_ANNOTATION,
    summarizeSites,
    VENDOR_ANNOTATION,
} from './summarizeSites.js';
import type { AttemptOutcome, AttemptRecord, AttemptStatus } from './summarizeSites.js';

/** The projects whose challenges put a site on cooldown: the two that drive flaneur; the control's are its own doing. */
const COOLDOWN_PROJECTS: readonly string[] = ['flaneur', 'agent-browser'];

const ABCK_STATES: readonly AbckState[] = ['valid', 'invalid', 'unknown'];

/**
 * Counts each journey's attempts per project over a `--repeat-each` run: prints a table and saves it as JSON with every
 * attempt's evidence. Puts the sites that challenged or refused flaneur on cooldown.
 */
export default class ConsistencyReporter implements Reporter {
    private readonly records: AttemptRecord[] = [];
    private startedAt = new Date();

    onBegin() {
        this.startedAt = new Date();
    }

    onTestEnd(test: TestCase, result: TestResult) {
        const annotation = (type: string) => result.annotations.find(item => item.type === type)?.description;
        const outcome = annotation(OUTCOME_ANNOTATION);
        const vendor = annotation(VENDOR_ANNOTATION);
        const site = annotation(SITE_ANNOTATION);
        const url = annotation(FINAL_URL_ANNOTATION);
        const timeline = annotation(TIMELINE_ANNOTATION);
        const score = Number(annotation(SCORE_ANNOTATION));
        const parsedOutcome = outcome == null ? undefined : parseOutcome(outcome);
        const parsedTimeline = timeline == null ? undefined : parseTimeline(timeline);
        this.records.push({
            project: test.parent.project()?.name ?? '',
            journey: test.title,
            repeatEachIndex: test.repeatEachIndex,
            status: readStatus(test, result, parsedOutcome),
            ...(parsedOutcome == null ? {} : { outcome: parsedOutcome }),
            ...(vendor == null ? {} : { vendor }),
            ...(site == null ? {} : { site }),
            ...(url == null ? {} : { url }),
            durationMs: result.duration,
            attachments: result.attachments.flatMap(({ name, path: file }) =>
                file == null ? [] : [{ name, path: file }],
            ),
            ...(parsedTimeline == null ? {} : { timeline: parsedTimeline }),
            ...(Number.isFinite(score) ? { score } : {}),
        });
    }

    async onEnd(_result: FullResult) {
        // `--list` and a run that matched nothing have no attempts to keep.
        if (this.records.length === 0) {
            return;
        }
        const rows = summarizeSites(this.records);
        const startedAt = this.startedAt.toISOString();
        await mkdir(SITES_RESULTS_FOLDER, { recursive: true });
        const file = path.join(SITES_RESULTS_FOLDER, `${startedAt.replaceAll(':', '-')}-sites.json`);
        const summary = { startedAt, finishedAt: new Date().toISOString(), rows, attempts: this.records };
        await writeFile(file, `${JSON.stringify(summary, null, 2)}\n`);
        process.stdout.write(`\n${formatSiteRows(rows)}\n\nSaved ${file}\n`);
        await this.saveCooldowns();
    }

    /** Puts every site that challenged or refused flaneur in this run on cooldown. */
    private async saveCooldowns() {
        const now = new Date();
        const before = readCooldowns(COOLDOWN_FILE);
        let cooldowns = before;
        for (const { project, site, status, outcome } of this.records) {
            if (
                !COOLDOWN_PROJECTS.includes(project) ||
                site == null ||
                (status !== 'challenged' && status !== 'refused')
            ) {
                continue;
            }
            const reason = outcome?.vendor == null ? status : `${status} by ${outcome.vendor}`;
            cooldowns = addCooldown(cooldowns, { site, reason, now });
        }
        if (cooldowns === before) {
            return;
        }
        await writeCooldowns(COOLDOWN_FILE, cooldowns);
        process.stdout.write(`Cooling ${Object.keys(cooldowns).join(', ')} (${COOLDOWN_FILE})\n`);
    }

    printsToStdio() {
        return true;
    }
}

/** Passed, skipped, or the class of the failure; a failure with no readable outcome is `broken`. */
function readStatus(test: TestCase, result: TestResult, outcome: AttemptOutcome | undefined): AttemptStatus {
    if (result.status === 'skipped') {
        return 'skipped';
    }
    if (result.status === test.expectedStatus) {
        return 'passed';
    }
    return outcome?.class ?? 'broken';
}

/** Reads an `outcome` annotation; one that does not parse is a `broken` attempt, so it is never lost from the count. */
function parseOutcome(description: string): AttemptOutcome {
    try {
        const value: unknown = JSON.parse(description);
        const fields = asObject(value, 'outcome');
        return {
            class: asOneOf(fields['class'], ['challenged', 'refused', 'broken'], 'outcome.class'),
            step: asString(fields['step'], 'outcome.step'),
            evidence: asString(fields['evidence'], 'outcome.evidence'),
            ...(typeof fields['vendor'] === 'string' ? { vendor: fields['vendor'] } : {}),
        };
    } catch {
        return { class: 'broken', step: 'unreadable outcome', evidence: description };
    }
}

/** Reads a `timeline` annotation; one that does not parse is left out rather than failing the report. */
function parseTimeline(description: string): TimelineEntry[] | undefined {
    try {
        return asArray(JSON.parse(description), 'timeline').map((item, index) => {
            const at = `timeline[${index}]`;
            const entry = asObject(item, at);
            return {
                step: asString(entry['step'], `${at}.step`),
                atMs: asNumber(entry['atMs'], `${at}.atMs`),
                url: asString(entry['url'], `${at}.url`),
                cookies: entry['cookies'] === null ? null : parseCookies(entry['cookies'], `${at}.cookies`),
            };
        });
    } catch {
        return undefined;
    }
}

function parseCookies(value: unknown, at: string): VendorCookieSummary {
    const cookies = asObject(value, at);
    const names = asStringArray(cookies['names'], `${at}.names`);
    return cookies['abck'] == null ? { names } : { names, abck: asOneOf(cookies['abck'], ABCK_STATES, `${at}.abck`) };
}
