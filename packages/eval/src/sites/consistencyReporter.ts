import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { FullResult, Reporter, TestCase, TestResult } from 'playwright/types/testReporter';

import { asObject, asOneOf, asString } from '../jsonShape.js';
import { OUTCOME_ANNOTATION } from './defineJourney.js';
import { formatSiteRows, SHOP_SCORE_ANNOTATION, summarizeSites, VENDOR_ANNOTATION } from './summarizeSites.js';
import type { AttemptOutcome, AttemptRecord } from './summarizeSites.js';

/** Where the sites runs are saved, beside the stealth eval's. */
const RESULTS_FOLDER = path.join(homedir(), '.flaneur-eval', 'results');

/** Counts each journey's attempts per project over a `--repeat-each` run: prints a table and saves it as JSON. */
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
        const shopScore = Number(annotation(SHOP_SCORE_ANNOTATION));
        this.records.push({
            project: test.parent.project()?.name ?? '',
            journey: test.title,
            executed: result.status !== 'skipped',
            passed: result.status === test.expectedStatus && result.status !== 'skipped',
            ...(outcome == null ? {} : { outcome: parseOutcome(outcome) }),
            ...(vendor == null ? {} : { vendor }),
            ...(Number.isFinite(shopScore) ? { shopScore } : {}),
        });
    }

    async onEnd(_result: FullResult) {
        // `--list` and a run that matched nothing have no attempts to keep.
        if (this.records.length === 0) {
            return;
        }
        const rows = summarizeSites(this.records);
        const startedAt = this.startedAt.toISOString();
        await mkdir(RESULTS_FOLDER, { recursive: true });
        const file = path.join(RESULTS_FOLDER, `${startedAt.replaceAll(':', '-')}-sites.json`);
        const summary = { startedAt, finishedAt: new Date().toISOString(), rows };
        await writeFile(file, `${JSON.stringify(summary, null, 2)}\n`);
        process.stdout.write(`\n${formatSiteRows(rows)}\n\nSaved ${file}\n`);
    }

    printsToStdio() {
        return true;
    }
}

/** Reads an `outcome` annotation; one that does not parse is a `broken` attempt, so it is never lost from the count. */
function parseOutcome(description: string): AttemptOutcome {
    try {
        const value: unknown = JSON.parse(description);
        const fields = asObject(value, 'outcome');
        return {
            class: asOneOf(fields['class'], ['challenged', 'refused', 'broken'], 'outcome.class'),
            step: asString(fields['step'], 'outcome.step'),
            ...(typeof fields['vendor'] === 'string' ? { vendor: fields['vendor'] } : {}),
        };
    } catch {
        return { class: 'broken', step: 'unreadable outcome' };
    }
}
