import { expect, test } from 'bun:test';

import type { ChallengeVendor } from '../../classifyChallenge.js';
import { JOURNEYS } from './index.js';

test('the journeys cover every vendor the eval measures, each journey under its own name', () => {
    const expected = new Set<ChallengeVendor>([
        'Akamai',
        'Amazon',
        'Cloudflare',
        'DataDome',
        'HUMAN',
        'Kasada',
        'reCAPTCHA',
    ]);
    expect(new Set(JOURNEYS.map(journey => journey.vendor))).toEqual(expected);
    expect(new Set(JOURNEYS.map(journey => journey.name)).size).toBe(JOURNEYS.length);
});
