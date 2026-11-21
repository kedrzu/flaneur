import { expect, test } from 'bun:test';

import type { ShopAction, ShopVisit } from '../StealthEvalTypes.js';
import { checkShopScore } from './checkShopScore.js';

test('averages only the scored actions and counts the rest', () => {
    const visit = visitOf([0.75, null, 0.5, 0.25]);

    expect(checkShopScore(visit, 0.5)).toEqual({ mean: 0.5, min: 0.25, scored: 3, unscored: 1 });
});

test('fails when the mean is below the threshold', () => {
    const visit = visitOf([0.1, 0.3, null]);

    expect(() => checkShopScore(visit, 0.5)).toThrow(
        'reCAPTCHA v3 mean 0.20 < 0.5 over 2 scored actions (1 without a score)',
    );
});

test('fails a visit with no scores at all instead of passing it', () => {
    expect(() => checkShopScore(visitOf([null, null]), 0.5)).toThrow('no score');
    expect(() => checkShopScore(visitOf([]), 0.5)).toThrow('no score');
});

function visitOf(scores: (number | null)[]): ShopVisit {
    const actions = scores.map((score, index): ShopAction => ({
        action: `action${index}`,
        page: '/',
        at: '2026-01-01T00:00:00.000Z',
        score,
        reasons: [],
        valid: score === null ? null : true,
        error: null,
    }));
    return { version: 1, visitId: 'v1', startedAt: '2026-01-01T00:00:00.000Z', userAgent: 'test', actions, input: [] };
}
