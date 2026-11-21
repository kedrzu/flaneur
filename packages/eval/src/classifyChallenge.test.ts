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

test("AWS WAF's CAPTCHA page is a challenge anywhere, its challenge script and CAPTCHA SDK only on a near-empty page", () => {
    const captcha = ['https://abc.def.captcha.awswaf.com/abc/def/captcha.js'];
    const sdk = ['https://abc.captcha-sdk.awswaf.com/abc/jsapi.js'];
    const challenge = ['https://abc.def.token.awswaf.com/abc/def/challenge.js'];

    expect(findChallenge(facts({ scripts: captcha, textLength: REAL_TEXT }))?.vendor).toBe('AWS WAF');
    expect(findChallenge(facts({ scripts: sdk, textLength: REAL_TEXT }))).toBeNull();
    expect(findChallenge(facts({ scripts: sdk, textLength: 20 }))?.vendor).toBe('AWS WAF');
    expect(findChallenge(facts({ scripts: challenge, textLength: 20 }))).toEqual({
        vendor: 'AWS WAF',
        evidence: 'AWS WAF abc.def.token.awswaf.com/abc/def/challenge.js',
    });
    expect(findChallenge(facts({ scripts: challenge, textLength: REAL_TEXT }))).toBeNull();
});

test("Imperva's challenge resource or its incident text is a challenge; an ordinary page is not", () => {
    const challenge = facts({ iframes: ['https://www.example.com/_Incapsula_Resource?SWUDNSAI=31&xinfo=x'] });
    const block = facts({ textStart: 'Request unsuccessful. Incapsula incident ID: 1234-5678' });
    const page = facts({
        textLength: REAL_TEXT,
        scripts: ['https://www.example.com/_Incapsula_Resource?SWJIYLWA=719d34d31c8e3a6e6fffd425f7e032f3'],
    });
    const interstitial = facts({ textLength: 20, scripts: ['https://www.example.com/_Incapsula_Resource?SWJIYLWA=1'] });

    const expected: FoundChallenge = { vendor: 'Imperva', evidence: 'Imperva www.example.com/_Incapsula_Resource' };
    expect(findChallenge(challenge)).toEqual(expected);
    expect(findChallenge(block)?.vendor).toBe('Imperva');
    expect(findChallenge(interstitial)?.vendor).toBe('Imperva');
    expect(findChallenge(page)).toBeNull();
});

test('an ordinary Cloudflare-fronted page, with only the jsd script, is not a challenge', () => {
    const page = facts({
        textLength: REAL_TEXT,
        scripts: ['https://www.example.com/cdn-cgi/challenge-platform/scripts/jsd/main.js'],
    });

    expect(findChallenge(page)).toBeNull();
});

test("Akamai's challenge container is a challenge only on a near-empty page, as ordinary kohls.com pages carry it", () => {
    expect(findChallenge(facts({ akamaiChallenge: true, textLength: 20 }))?.vendor).toBe('Akamai');
    expect(findChallenge(facts({ akamaiChallenge: true, textLength: REAL_TEXT }))).toBeNull();
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
