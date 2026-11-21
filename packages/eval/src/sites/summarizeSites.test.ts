import { expect, test } from 'bun:test';

import { summarizeSites } from './summarizeSites.js';
import type { AttemptRecord, SiteRow } from './summarizeSites.js';

test('refused attempts are shown apart and left out of the pass rate; skipped ones are no attempts', () => {
    const rows = summarizeSites([
        attempt({}),
        attempt({}),
        attempt({ passed: false, outcome: { class: 'refused', step: 'open' } }),
        attempt({ passed: false, outcome: { class: 'challenged', vendor: 'DataDome', step: 'search' } }),
        attempt({ passed: false, outcome: { class: 'broken', step: 'search' } }),
        attempt({ executed: false, passed: false }),
    ]);

    const expected: Partial<SiteRow> = {
        passed: 2,
        executed: 4,
        refused: 1,
        challenged: 1,
        broken: 1,
        challengeVendors: { DataDome: 1 },
        failingStep: 'search',
    };
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(expected);
});

test('the control passes too only when headless ran the journey and passed every attempt', () => {
    const flaneur = (journey: string) => attempt({ journey, passed: false, outcome: { class: 'broken', step: 's' } });
    const controlPassed = (rows: SiteRow[], journey: string) =>
        rows.find(row => row.project === 'flaneur' && row.journey === journey)?.controlPasses;

    const rows = summarizeSites([
        flaneur('all-pass'),
        attempt({ project: 'headless', journey: 'all-pass' }),
        attempt({ project: 'headless', journey: 'all-pass' }),
        flaneur('one-fails'),
        attempt({ project: 'headless', journey: 'one-fails' }),
        attempt({ project: 'headless', journey: 'one-fails', passed: false }),
        flaneur('not-run'),
        flaneur('skipped'),
        attempt({ project: 'headless', journey: 'skipped', executed: false, passed: false }),
    ]);

    expect(controlPassed(rows, 'all-pass')).toBe(true);
    expect(controlPassed(rows, 'one-fails')).toBe(false);
    expect(controlPassed(rows, 'not-run')).toBe(false);
    expect(controlPassed(rows, 'skipped')).toBe(false);
});

test('a passing attempt that carries an outcome is not counted in any class, and shop scores are averaged', () => {
    const rows = summarizeSites([
        attempt({ outcome: { class: 'challenged', vendor: 'Turnstile', step: 'x' }, shopScore: 0.9 }),
        attempt({ shopScore: 0.5 }),
        attempt({}),
    ]);

    expect(rows[0]).toMatchObject({ passed: 3, challenged: 0, challengeVendors: {}, meanShopScore: 0.7 });
    expect(rows[0]?.failingStep).toBeUndefined();
});

function attempt(overrides: Partial<AttemptRecord>): AttemptRecord {
    return { project: 'flaneur', journey: 'decathlon.pl', executed: true, passed: true, ...overrides };
}
