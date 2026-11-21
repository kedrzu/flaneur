import { expect, test } from 'bun:test';

import { formatSiteRows, summarizeSites } from './summarizeSites.js';
import type { AttemptOutcome, AttemptRecord, SiteRow } from './summarizeSites.js';

test('refused attempts are shown apart and left out of the pass rate; skipped ones are no attempts', () => {
    const rows = summarizeSites([
        attempt({}),
        attempt({}),
        failed({ class: 'refused', step: 'open', evidence: 'flaneur pace stopped after two blocks on x' }),
        failed({ class: 'challenged', vendor: 'DataDome', step: 'search', evidence: 'DataDome captcha iframe' }),
        failed({ class: 'challenged', vendor: 'DataDome', step: 'search', evidence: 'DataDome captcha iframe' }),
        failed({ class: 'broken', step: 'search', evidence: 'locator.click: Timeout' }),
        attempt({ status: 'skipped' }),
    ]);

    const expected: Partial<SiteRow> = {
        passed: 2,
        executed: 5,
        refused: 1,
        challenged: 2,
        broken: 1,
        challengeVendors: { DataDome: 2 },
        failingStep: 'search',
        failingEvidence: 'DataDome captcha iframe',
    };
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(expected);
});

test('the control passes too only when headless ran the journey and passed every attempt', () => {
    const flaneur = (journey: string) => attempt({ journey, status: 'broken' });
    const controlPassed = (rows: SiteRow[], journey: string) =>
        rows.find(row => row.project === 'flaneur' && row.journey === journey)?.controlPasses;

    const rows = summarizeSites([
        flaneur('all-pass'),
        attempt({ project: 'headless', journey: 'all-pass' }),
        attempt({ project: 'headless', journey: 'all-pass' }),
        flaneur('one-fails'),
        attempt({ project: 'headless', journey: 'one-fails' }),
        attempt({ project: 'headless', journey: 'one-fails', status: 'broken' }),
        flaneur('not-run'),
        flaneur('skipped'),
        attempt({ project: 'headless', journey: 'skipped', status: 'skipped' }),
    ]);

    expect(controlPassed(rows, 'all-pass')).toBe(true);
    expect(controlPassed(rows, 'one-fails')).toBe(false);
    expect(controlPassed(rows, 'not-run')).toBe(false);
    expect(controlPassed(rows, 'skipped')).toBe(false);
});

test('a passing attempt that carries an outcome is not counted in any class, and shop scores are averaged', () => {
    const rows = summarizeSites([
        attempt({ outcome: { class: 'challenged', vendor: 'Turnstile', step: 'x', evidence: 'e' }, shopScore: 0.9 }),
        attempt({ shopScore: 0.5 }),
        attempt({}),
    ]);

    expect(rows[0]).toMatchObject({ passed: 3, challenged: 0, challengeVendors: {}, meanShopScore: 0.7 });
    expect(rows[0]?.failingStep).toBeUndefined();
});

test("a failing row's table line is followed by its most frequent evidence", () => {
    const rows = summarizeSites([
        failed({ class: 'broken', step: 'search', evidence: 'locator.fill: Timeout 30000ms exceeded' }),
        attempt({}),
    ]);

    expect(formatSiteRows(rows).split('\n')).toEqual([
        'flaneur  decathlon.pl  1/2  challenged 0  refused 0  broken 1  step: search',
        '    locator.fill: Timeout 30000ms exceeded',
    ]);
});

function attempt(overrides: Partial<AttemptRecord>): AttemptRecord {
    return {
        project: 'flaneur',
        journey: 'decathlon.pl',
        repeatEachIndex: 0,
        status: 'passed',
        durationMs: 1000,
        attachments: [],
        ...overrides,
    };
}

function failed(outcome: AttemptOutcome): AttemptRecord {
    return attempt({ status: outcome.class, outcome });
}
