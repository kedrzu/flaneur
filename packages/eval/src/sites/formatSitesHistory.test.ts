import { expect, test } from 'bun:test';

import { formatSitesHistory } from './formatSitesHistory.js';

test("the history is flaneur's pass rate per journey and run, then the sites still cooling", () => {
    const text = formatSitesHistory({
        runs: [
            {
                startedAt: '2026-11-20T09:05:00.000Z',
                rows: [
                    { project: 'flaneur', journey: 'kohls.com', passed: 3, executed: 3 },
                    { project: 'headless', journey: 'kohls.com', passed: 0, executed: 3 },
                ],
            },
            {
                startedAt: '2026-11-21T10:15:00.000Z',
                rows: [
                    { project: 'flaneur', journey: 'kohls.com', passed: 1, executed: 3 },
                    { project: 'flaneur', journey: 'amazon.pl', passed: 2, executed: 2 },
                ],
            },
        ],
        cooldowns: {
            'www.kohls.com': { until: '2026-11-21T11:00:00.000Z', reason: 'challenged by Akamai' },
            'www.etsy.com': { until: '2026-11-21T09:00:00.000Z', reason: 'refused' },
        },
        now: new Date('2026-11-21T10:30:00.000Z'),
    });

    expect(text.split('\n')).toEqual([
        'journey    11-20 09:05  11-21 10:15',
        'kohls.com  3/3          1/3',
        'amazon.pl  -            2/2',
        '',
        'Cooling:',
        '  www.kohls.com  30 min  (challenged by Akamai)',
    ]);
});
