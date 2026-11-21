import { expect, test } from 'bun:test';

import type { ChallengeVendor } from '../../classifyChallenge.js';
import { CAPTCHA_CHECKS } from '../captchaChecks.js';
import { JOURNEYS } from './index.js';

/**
 * The sites each compared vendor is measured on at least, so one site's quirk does not decide. The vendors in front of
 * most of the web get more; Imperva has too few sites with a guest flow reachable from Poland to be compared.
 */
const MIN_SITES_PER_VENDOR: Partial<Record<ChallengeVendor, number>> = {
    Cloudflare: 4,
    Akamai: 4,
    DataDome: 4,
    HUMAN: 3,
    Kasada: 3,
    'AWS WAF': 3,
    reCAPTCHA: 3,
};

test('every compared vendor is measured on enough distinct sites, each journey under its own name', () => {
    const sites = [...JOURNEYS, ...CAPTCHA_CHECKS];

    const tooFew = Object.entries(MIN_SITES_PER_VENDOR).filter(([vendor, min]) => {
        const hosts = new Set(sites.filter(site => site.vendor === vendor).map(site => new URL(site.url).hostname));
        return hosts.size < min;
    });
    expect(tooFew).toEqual([]);
    expect(new Set(sites.map(site => site.name)).size).toBe(sites.length);
});
