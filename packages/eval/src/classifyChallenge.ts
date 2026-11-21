import { findChallengeVendor } from 'flaneur';

import { asNumber, asObject, asString, asStringArray } from './jsonShape.js';
import type { PanelVendor } from './StealthEvalTypes.js';

/**
 * The vendors the eval measures: the panel's, AWS WAF and Imperva, plus the CAPTCHA and robot-check pages sites show on
 * their own. `findChallenge` tells the challenge or block page of each.
 */
export type ChallengeVendor = PanelVendor | 'AWS WAF' | 'Imperva' | 'reCAPTCHA' | 'hCaptcha' | 'Turnstile' | 'Amazon';

/** A vendor's marker found on a page. */
export interface FoundChallenge {
    vendor: ChallengeVendor;
    /** The marker, described; saved results are compared across runs, so the strings stay stable. */
    evidence: string;
}

/** What the page shows, read in one evaluation by `READ_PAGE_FACTS`; `findChallenge` decides from it. */
export interface PageFacts {
    /** `location.href`. */
    url: string;
    title: string;
    /** The length of the body's visible text. */
    textLength: number;
    /** The start of the body's visible text, for markers in the text of a block page. */
    textStart: string;
    scripts: string[];
    iframes: string[];
    /** The `action` of every form on the page. */
    formActions: string[];
    /** Whether HUMAN's `#px-captcha` is on the page. */
    pxCaptcha: boolean;
    /** Whether Akamai's challenge container (`#sec-container`, `#sec-if-container`) is on the page. */
    akamaiChallenge: boolean;
}

/**
 * The visible text a real home page has at least, so a page still loading or a blank one is not taken for the site.
 * Length alone does not tell block pages from real ones: Medium's real home page had 229 characters, Indeed's block page
 * 409. The vendors' markers decide those; this only rules out the near-empty.
 */
export const MIN_REAL_TEXT = 150;

/** A JavaScript expression, evaluated in the page (it sees the DOM only), that returns the page's facts. */
export const READ_PAGE_FACTS = `(() => {
    const text = document.body?.innerText ?? '';
    return {
        url: location.href,
        title: document.title,
        textLength: text.trim().length,
        textStart: text.trim().slice(0, 600),
        scripts: [...document.scripts].map(script => script.src).filter(Boolean),
        iframes: [...document.querySelectorAll('iframe')].map(iframe => iframe.src).filter(Boolean),
        formActions: [...document.forms].map(form => form.action).filter(Boolean),
        pxCaptcha: document.querySelector('#px-captcha') != null,
        akamaiChallenge: document.querySelector('#sec-container, #sec-if-container') != null,
    };
})()`;

/**
 * Checks the value `READ_PAGE_FACTS` returned.
 * @__NO_SIDE_EFFECTS__
 */
export function parsePageFacts(value: unknown): PageFacts {
    const facts = asObject(value, 'page facts');
    return {
        url: asString(facts['url'], 'url'),
        title: asString(facts['title'], 'title'),
        textLength: asNumber(facts['textLength'], 'textLength'),
        textStart: asString(facts['textStart'], 'textStart'),
        scripts: asStringArray(facts['scripts'], 'scripts'),
        iframes: asStringArray(facts['iframes'], 'iframes'),
        formActions: asStringArray(facts['formActions'], 'formActions'),
        pxCaptcha: facts['pxCaptcha'] === true,
        akamaiChallenge: facts['akamaiChallenge'] === true,
    };
}

/**
 * A vendor's challenge or block marker on the page; `null` when there is none. Any vendor's marker counts: a site may
 * sit behind more than one. reCAPTCHA v3's invisible badge, a Turnstile widget on a page with real content and the
 * ordinary Cloudflare `jsd/main.js` script are not challenges.
 * @__NO_SIDE_EFFECTS__
 */
export function findChallenge(facts: PageFacts): FoundChallenge | null {
    // DataDome: its CAPTCHA, interstitial or block page comes in an iframe; the page around it is empty.
    const dataDome = facts.iframes.find(src => findChallengeVendor(src) === 'DataDome');
    if (dataDome != null) {
        return { vendor: 'DataDome', evidence: `DataDome iframe ${describeUrl(dataDome)}` };
    }
    // HUMAN: the "Press & Hold" page.
    if (facts.pxCaptcha) {
        return { vendor: 'HUMAN', evidence: 'HUMAN #px-captcha' };
    }
    if (facts.title === 'Access to this page has been denied') {
        return { vendor: 'HUMAN', evidence: `HUMAN title "${facts.title}"` };
    }
    // Cloudflare: the challenge page's orchestrating script. A normal page behind Cloudflare loads
    // `/cdn-cgi/challenge-platform/scripts/jsd/main.js`, which has no `/orchestrate/`. The title is localised
    // ("Just a moment...", "Cierpliwości...", "Security Check - Indeed.com"), so it is not the marker.
    const cloudflare = facts.scripts.find(src => findChallengeVendor(src) === 'Cloudflare');
    if (cloudflare != null) {
        return { vendor: 'Cloudflare', evidence: `Cloudflare challenge script ${describeUrl(cloudflare)}` };
    }
    // Cloudflare's block page (a WAF rule, no challenge to solve), also in a site's own design as on Indeed: "You
    // have been blocked … Your Ray ID for this request is …".
    if (facts.textStart.includes('Ray ID') && /blocked/i.test(facts.textStart)) {
        return { vendor: 'Cloudflare', evidence: 'Cloudflare block page (Ray ID)' };
    }
    // Akamai: the edge's "Access Denied" page (with "Reference #18.…") or Bot Manager's challenge page.
    if (facts.title === 'Access Denied' || /Reference #\d/.test(facts.textStart)) {
        return { vendor: 'Akamai', evidence: `Akamai "Access Denied" page` };
    }
    // Ordinary pages may carry the challenge container and script too (kohls.com, 2026-11-21), so only a near-empty
    // page around them is the challenge.
    if (
        (facts.akamaiChallenge || facts.scripts.some(src => src.includes('/_sec/cp_challenge/'))) &&
        facts.textLength < MIN_REAL_TEXT
    ) {
        return { vendor: 'Akamai', evidence: 'Akamai challenge page' };
    }
    // Kasada: its challenge page is empty but for `ips.js`, which solves the challenge and reloads the page.
    const kasada = facts.scripts.find(src => src.includes('/ips.js') && /KP_UIDz|x-kpsdk/.test(src));
    if (kasada != null && facts.textLength < MIN_REAL_TEXT) {
        return { vendor: 'Kasada', evidence: 'Kasada ips.js on an empty page' };
    }
    // AWS WAF: its CAPTCHA script (`…captcha.awswaf.com/…/captcha.js`) on any page, or its challenge script
    // (`…token.awswaf.com/…/challenge.js`) on a near-empty interstitial: real pages load the challenge script too.
    const awsWaf = facts.scripts.find(src => /(^|\.)awswaf\.com$/.test(URL.parse(src)?.hostname ?? ''));
    if (awsWaf != null && (awsWaf.includes('captcha') || facts.textLength < MIN_REAL_TEXT)) {
        return { vendor: 'AWS WAF', evidence: `AWS WAF ${describeUrl(awsWaf)}` };
    }
    // Imperva (Incapsula): its challenge page loads `/_Incapsula_Resource` in an iframe or a script; its block page
    // says "Request unsuccessful. Incapsula incident ID: …".
    const imperva = [...facts.iframes, ...facts.scripts].find(src => src.includes('/_Incapsula_Resource'));
    if (imperva != null) {
        return { vendor: 'Imperva', evidence: `Imperva ${describeUrl(imperva)}` };
    }
    if (facts.textStart.includes('Incapsula incident ID')) {
        return { vendor: 'Imperva', evidence: 'Imperva block page (incident ID)' };
    }
    // reCAPTCHA v2: the challenge frame, or the checkbox's anchor frame. The v3 badge is an anchor frame with
    // `size=invisible`, on ordinary pages, so it is not a marker.
    const recaptcha = facts.iframes.find(
        src =>
            /\/recaptcha\/(api2|enterprise)\/bframe/.test(src) ||
            (/\/recaptcha\/(api2|enterprise)\/anchor/.test(src) && !/[?&#]size=invisible/.test(src)),
    );
    if (recaptcha != null) {
        return { vendor: 'reCAPTCHA', evidence: `reCAPTCHA iframe ${describeUrl(recaptcha)}` };
    }
    // Google's "unusual traffic" page, which carries a reCAPTCHA.
    const page = URL.parse(facts.url);
    if (page != null && /(^|\.)google\.[a-z.]+$/.test(page.hostname) && page.pathname.startsWith('/sorry/')) {
        return { vendor: 'reCAPTCHA', evidence: 'Google /sorry/' };
    }
    // hCaptcha: the checkbox or challenge frame, served from hcaptcha.com or a subdomain under `/captcha/`.
    const hcaptcha = facts.iframes.find(src => {
        const frame = URL.parse(src);
        return (
            frame != null &&
            /(^|\.)hcaptcha\.com$/.test(frame.hostname) &&
            (frame.pathname.includes('/captcha/') || frame.hash.includes('/captcha/'))
        );
    });
    if (hcaptcha != null) {
        return { vendor: 'hCaptcha', evidence: `hCaptcha iframe ${describeUrl(hcaptcha)}` };
    }
    // Turnstile: ordinary forms embed it too, so only a near-empty page around it is a challenge.
    const turnstile = facts.iframes.find(src => URL.parse(src)?.hostname === 'challenges.cloudflare.com');
    if (turnstile != null && facts.textLength < MIN_REAL_TEXT) {
        return { vendor: 'Turnstile', evidence: `Turnstile iframe ${describeUrl(turnstile)} on an empty page` };
    }
    // Amazon: the "Robot Check" page, whose form posts to `/errors/validateCaptcha`.
    if (facts.formActions.some(action => action.includes('/errors/validateCaptcha')) || facts.title === 'Robot Check') {
        return { vendor: 'Amazon', evidence: 'Amazon Robot Check' };
    }
    return null;
}

/** A URL's host and path, without the query (which carries the visitor's ids). */
function describeUrl(url: string) {
    const parsed = URL.parse(url);
    return parsed == null ? url.slice(0, 100) : `${parsed.host}${parsed.pathname}`;
}
