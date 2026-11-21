import { expect, test } from 'bun:test';

import { findChallenge } from './classifyChallenge.js';
import type { FoundChallenge, PageFacts } from './classifyChallenge.js';

const REAL_TEXT = 4000;

test('reCAPTCHA v2 frames are a challenge; the invisible v3 badge is not', () => {
    const challenge = facts({ iframes: ['https://www.google.com/recaptcha/api2/bframe?hl=en&k=key'] });
    const checkbox = facts({ iframes: ['https://www.google.com/recaptcha/api2/anchor?ar=1&k=key&size=normal'] });
    const badge = facts({
        textLength: REAL_TEXT,
        iframes: ['https://www.google.com/recaptcha/api2/anchor?ar=1&k=key&size=invisible'],
    });

    const expected: FoundChallenge = {
        vendor: 'reCAPTCHA',
        evidence: 'reCAPTCHA iframe www.google.com/recaptcha/api2/bframe',
    };
    expect(findChallenge(challenge)).toEqual(expected);
    expect(findChallenge(checkbox)?.vendor).toBe('reCAPTCHA');
    expect(findChallenge(badge)).toBeNull();
});

test("Google's /sorry/ page is a reCAPTCHA challenge, other Google pages are not", () => {
    expect(findChallenge(facts({ url: 'https://www.google.com/sorry/index?continue=x' }))).toEqual({
        vendor: 'reCAPTCHA',
        evidence: 'Google /sorry/',
    });
    expect(findChallenge(facts({ url: 'https://www.google.com/search?q=sorry' }))).toBeNull();
    expect(findChallenge(facts({ url: 'https://example.com/sorry/' }))).toBeNull();
});

test('an hCaptcha checkbox frame is a challenge, a bare hcaptcha.com frame is not', () => {
    const checkbox = facts({
        iframes: ['https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox'],
    });

    expect(findChallenge(checkbox)?.vendor).toBe('hCaptcha');
    expect(findChallenge(facts({ iframes: ['https://hcaptcha.com/'] }))).toBeNull();
    expect(findChallenge(facts({ iframes: ['https://nothcaptcha.com/captcha/x'] }))).toBeNull();
});

test('a Turnstile frame is a challenge only on a near-empty page', () => {
    const iframes = ['https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/x'];

    expect(findChallenge(facts({ iframes, textLength: 20 }))?.vendor).toBe('Turnstile');
    expect(findChallenge(facts({ iframes, textLength: REAL_TEXT }))).toBeNull();
});

test("Amazon's robot check is told by its form action or title", () => {
    expect(findChallenge(facts({ formActions: ['https://www.amazon.com/errors/validateCaptcha'] }))?.vendor).toBe(
        'Amazon',
    );
    expect(findChallenge(facts({ title: 'Robot Check' }))?.vendor).toBe('Amazon');
    expect(findChallenge(facts({ title: 'Amazon.com', formActions: ['https://www.amazon.com/s'] }))).toBeNull();
});

test('an ordinary Cloudflare-fronted page, with only the jsd script, is not a challenge', () => {
    const page = facts({
        textLength: REAL_TEXT,
        scripts: ['https://www.example.com/cdn-cgi/challenge-platform/scripts/jsd/main.js'],
    });

    expect(findChallenge(page)).toBeNull();
});

function facts(overrides: Partial<PageFacts>): PageFacts {
    return {
        url: 'https://example.com/',
        title: 'Example',
        textLength: 0,
        textStart: '',
        scripts: [],
        iframes: [],
        formActions: [],
        pxCaptcha: false,
        akamaiChallenge: false,
        ...overrides,
    };
}
