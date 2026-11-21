import { expect, test } from 'bun:test';

import type { ChallengeVendor } from '../../classifyChallenge.js';
import { CAPTCHA_CHECKS } from '../captchaChecks.js';
import { JOURNEYS } from './index.js';

/** The vendors the eval compares, each measured on at least this many sites so one site's quirk does not decide. */
const MIN_SITES_PER_VENDOR = 3;

test('every vendor the eval compares is measured on at least 3 sites, each journey under its own name', () => {
    const vendors: ChallengeVendor[] = ['Akamai', 'AWS WAF', 'Cloudflare', 'DataDome', 'HUMAN', 'Kasada', 'reCAPTCHA'];
    const sites = [...JOURNEYS, ...CAPTCHA_CHECKS];

    const tooFew = vendors.filter(vendor => sites.filter(site => site.vendor === vendor).length < MIN_SITES_PER_VENDOR);
    expect(tooFew).toEqual([]);
    expect(new Set(sites.map(site => site.name)).size).toBe(sites.length);
});
