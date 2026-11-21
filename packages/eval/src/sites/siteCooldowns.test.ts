import { expect, test } from 'bun:test';

import { addCooldown, remainingCooldownMinutes } from './siteCooldowns.js';
import type { SiteCooldowns } from './siteCooldowns.js';

const NOW = new Date('2026-11-21T10:00:00.000Z');

test('a new cooldown runs an hour, a longer one already set is kept, and expired ones are dropped', () => {
    const cooldowns: SiteCooldowns = {
        'www.kohls.com': { until: '2026-11-21T12:00:00.000Z', reason: 'challenged by Akamai' },
        'www.vinted.pl': { until: '2026-11-21T10:20:00.000Z', reason: 'refused' },
        'www.etsy.com': { until: '2026-11-21T09:59:00.000Z', reason: 'challenged by DataDome' },
    };

    let result = addCooldown(cooldowns, { site: 'www.kohls.com', reason: 'refused', now: NOW });
    result = addCooldown(result, { site: 'www.vinted.pl', reason: 'challenged by DataDome', now: NOW });

    const expected: SiteCooldowns = {
        'www.kohls.com': { until: '2026-11-21T12:00:00.000Z', reason: 'challenged by Akamai' },
        'www.vinted.pl': { until: '2026-11-21T11:00:00.000Z', reason: 'challenged by DataDome' },
    };
    expect(result).toEqual(expected);
    expect(cooldowns['www.etsy.com']).toBeDefined();
});

test('the remaining minutes round up and are 0 once the cooldown has ended or for a site never cooled', () => {
    const cooldowns: SiteCooldowns = {
        'www.kohls.com': { until: '2026-11-21T10:30:01.000Z', reason: 'challenged by Akamai' },
        'www.etsy.com': { until: '2026-11-21T09:59:00.000Z', reason: 'refused' },
    };

    expect(remainingCooldownMinutes(cooldowns, 'www.kohls.com', NOW)).toBe(31);
    expect(remainingCooldownMinutes(cooldowns, 'www.etsy.com', NOW)).toBe(0);
    expect(remainingCooldownMinutes(cooldowns, 'www.amazon.pl', NOW)).toBe(0);
});
