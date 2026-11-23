import { setTimeout as sleep } from 'node:timers/promises';

import { expect, test } from 'playwright/test';
import type { Page, TestDetailsAnnotation, TestInfo } from 'playwright/test';

import { assert } from '@nzyme/utils/assert.js';

import type { ChallengeVendor } from '../classifyChallenge.js';
import { asNumber, asObject } from '../jsonShape.js';
import { JourneyFailure, recordOutcome } from './defineJourney.js';
import type { JourneyOutcome, JourneyStep } from './defineJourney.js';
import { SCORE_ANNOTATION } from './summarizeSites.js';

/** A public CAPTCHA demo page that tells how its CAPTCHA judged the browser. */
export interface CaptchaCheck {
    name: string;
    /** The CAPTCHA's vendor. */
    vendor: ChallengeVendor;
    url: string;
    /** What the verdict depends on besides the browser, as a test annotation. */
    note?: TestDetailsAnnotation;
    /** Loads the page and reads its verdict; a verdict against the browser fails the test as `challenged`. */
    run(page: Page, step: JourneyStep, testInfo: TestInfo): Promise<void>;
}

/** The reCAPTCHA v3 score a check must reach: sites commonly turn a visitor away below 0.7. */
const RECAPTCHA_V3_THRESHOLD = 0.7;

/** How long the v2 checkbox has to tick itself after the click before the check gives up. */
const CHECKBOX_TIMEOUT_MS = 10_000;

/** Between two looks at the v2 checkbox and its challenge frame. */
const CHECKBOX_POLL_MS = 250;

const TWOCAPTCHA_V3_URL = 'https://2captcha.com/demo/recaptcha-v3';
const ANTCPT_V3_URL = 'https://antcpt.com/eng/information/demo-form/recaptcha-3-test-score.html';
/** Google's reCAPTCHA v2 demo. */
export const RECAPTCHA_V2_URL = 'https://www.google.com/recaptcha/api2/demo';

/**
 * Why the v2 checkbox's verdict is read with the connection in mind: on 2026-11-23 the demo showed the image challenge
 * to a person in their own Chrome on the eval's home IP too, so a `challenged` here then measured the IP, not flaneur.
 * Both projects annotate the check with it.
 */
export const RECAPTCHA_V2_IP_NOTE: TestDetailsAnnotation = {
    type: 'ip-dependent',
    description:
        "The checkbox's verdict follows the IP's reputation: a person's own Chrome on the eval's IP got the image challenge too (2026-11-23).",
};
const NOWSECURE_URL = 'https://nowsecure.nl/';

/** 2captcha's reCAPTCHA v3 demo: "Check" verifies a fresh token on its server and shows the response, score included. */
const twocaptchaV3: CaptchaCheck = {
    name: '2captcha reCAPTCHA v3',
    vendor: 'reCAPTCHA',
    url: TWOCAPTCHA_V3_URL,
    run: async (page, step, testInfo) => {
        await step('open the demo', async () => {
            await page.goto(TWOCAPTCHA_V3_URL);
        });
        await step('check', async () => {
            await page.getByRole('button', { name: 'Check' }).click();
            const code = page.locator('[class*=successMessageCode]').first();
            await expect(code).toContainText('score');
            const response = asObject(JSON.parse(await code.innerText()), 'response');
            checkScore({
                score: asNumber(response['score'], 'response.score'),
                site: '2captcha',
                step: 'check',
                testInfo,
            });
        });
    },
};

/** antcpt's reCAPTCHA v3 demo, which scores the page load and prints "Your score is: 0.9". */
const antcptV3: CaptchaCheck = {
    name: 'antcpt reCAPTCHA v3',
    vendor: 'reCAPTCHA',
    url: ANTCPT_V3_URL,
    run: async (page, step, testInfo) => {
        await step('open the demo', async () => {
            await page.goto(ANTCPT_V3_URL);
        });
        await step('read the score', async () => {
            const score = page.locator('#score');
            await expect(score).toContainText(/\d\.\d/);
            const match = /(\d+(?:\.\d+)?)/.exec(await score.innerText());
            assert(match?.[1], 'antcpt showed no score');
            checkScore({ score: Number(match[1]), site: 'antcpt', step: 'read the score', testInfo });
        });
    },
};

/**
 * Google's reCAPTCHA v2 demo: the checkbox ticks for a browser it trusts and opens an image challenge otherwise. The
 * challenge is not solved and the form is not submitted.
 */
const recaptchaV2: CaptchaCheck = {
    name: 'Google reCAPTCHA v2 checkbox',
    vendor: 'reCAPTCHA',
    url: RECAPTCHA_V2_URL,
    note: RECAPTCHA_V2_IP_NOTE,
    run: async (page, step, testInfo) => {
        await step('open the demo', async () => {
            await page.goto(RECAPTCHA_V2_URL);
        });
        const checkbox = page.frameLocator('iframe[src*="api2/anchor"]').locator('#recaptcha-anchor');
        const challenge = page.locator('iframe[src*="api2/bframe"]');
        await tickRecaptchaCheckbox(testInfo, {
            click: () => checkbox.click(),
            isChallenged: () => challenge.isVisible(),
            isTicked: async () => (await checkbox.getAttribute('aria-checked')) === 'true',
        });
    },
};

/** nowsecure.nl, a page behind Cloudflare's managed challenge set to challenge every visitor it does not trust. */
const nowsecure: CaptchaCheck = {
    name: 'nowsecure.nl',
    vendor: 'Cloudflare',
    url: NOWSECURE_URL,
    run: async (page, step) => {
        await step('open the page', async () => {
            await page.goto(NOWSECURE_URL);
        });
        await step('see the content', async () => {
            await expect(page).toHaveTitle('nowsecure.nl');
        });
    },
};

/** reCAPTCHA v2's checkbox as a driver sees it. */
export interface RecaptchaCheckbox {
    click(): Promise<void>;
    /** Whether the image challenge is showing. */
    isChallenged(): Promise<boolean>;
    isTicked(): Promise<boolean>;
}

/**
 * Clicks reCAPTCHA v2's checkbox as the step `tick the checkbox` and waits for its verdict: ticked passes, an image
 * challenge fails the test as `challenged`, neither in `CHECKBOX_TIMEOUT_MS` as `broken`. The checkbox frame on the
 * page is itself a reCAPTCHA marker, so the step cannot be a journey step, which fails on any marker; it records its
 * outcome itself.
 * @util
 */
export async function tickRecaptchaCheckbox(testInfo: TestInfo, checkbox: RecaptchaCheckbox) {
    const name = 'tick the checkbox';
    await test.step(name, async () => {
        let ticked = false;
        try {
            await checkbox.click();
            const deadline = Date.now() + CHECKBOX_TIMEOUT_MS;
            while (Date.now() < deadline) {
                if (await checkbox.isChallenged()) {
                    throw fail({ class: 'challenged', vendor: 'reCAPTCHA', evidence: 'image challenge', step: name });
                }
                if (await checkbox.isTicked()) {
                    ticked = true;
                    break;
                }
                await sleep(CHECKBOX_POLL_MS);
            }
        } catch (error) {
            if (error instanceof JourneyFailure) {
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            throw fail({ class: 'broken', evidence: message.split('\n')[0] ?? message, step: name }, error);
        }
        if (!ticked) {
            throw fail({
                class: 'broken',
                evidence: `the checkbox was neither ticked nor challenged in ${CHECKBOX_TIMEOUT_MS / 1000} s`,
                step: name,
            });
        }
    });

    function fail(outcome: JourneyOutcome, cause?: unknown) {
        recordOutcome(testInfo, outcome);
        return new JourneyFailure(outcome, { cause });
    }
}

/** The checks `captcha.spec.ts` runs, one test each, in this order. */
export const CAPTCHA_CHECKS: readonly CaptchaCheck[] = [twocaptchaV3, antcptV3, recaptchaV2, nowsecure];

/** Options of `checkScore`. */
interface CheckScoreParams {
    score: number;
    /** The demo page, named in the failure. */
    site: string;
    step: string;
    testInfo: TestInfo;
}

/** Records a reCAPTCHA v3 score as the test's `score` annotation and fails the test as `challenged` below the threshold. */
function checkScore({ score, site, step, testInfo }: CheckScoreParams) {
    testInfo.annotations.push({ type: SCORE_ANNOTATION, description: String(score) });
    if (score < RECAPTCHA_V3_THRESHOLD) {
        const outcome: JourneyOutcome = {
            class: 'challenged',
            vendor: 'reCAPTCHA',
            evidence: `reCAPTCHA v3 score ${score} < ${RECAPTCHA_V3_THRESHOLD} on ${site}`,
            step,
        };
        recordOutcome(testInfo, outcome);
        throw new JourneyFailure(outcome);
    }
}
