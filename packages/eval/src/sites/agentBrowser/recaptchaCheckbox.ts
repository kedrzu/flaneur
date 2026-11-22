import type { TestInfo } from 'playwright/test';

import { RECAPTCHA_V2_URL, tickRecaptchaCheckbox } from '../captchaChecks.js';
import type { StepRunner } from '../defineJourney.js';
import type { AgentBrowser } from './openAgentBrowser.js';

/** The checkbox, found in the snapshot inside its frame: "Nie jestem robotem", "I'm not a robot". */
const CHECKBOX = { role: 'checkbox', name: /robot/i };

/** Whether the image challenge's frame shows: it is in the page from the start, hidden until reCAPTCHA wants it. */
const CHALLENGE_SHOWN = `[...document.querySelectorAll('iframe[src*="api2/bframe"]')].some(frame => {
    const box = frame.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(frame).visibility !== 'hidden';
})`;

/** Google's reCAPTCHA v2 demo, ticked with agent-browser; the image challenge is never solved, the form never sent. */
export const recaptchaCheckbox = {
    name: 'Google reCAPTCHA v2 checkbox',
    vendor: 'reCAPTCHA',
    url: RECAPTCHA_V2_URL,
    run: async (ab: AgentBrowser, step: StepRunner, testInfo: TestInfo) => {
        await step('open the demo', async () => {
            await ab.open(RECAPTCHA_V2_URL);
        });
        // agent-browser's snapshot reaches into the checkbox's cross-origin frame.
        const checkbox = await ab.findRef(CHECKBOX);
        await tickRecaptchaCheckbox(testInfo, {
            click: () => ab.click(checkbox),
            isChallenged: async () => (await ab.eval(CHALLENGE_SHOWN)) === true,
            isTicked: async () => (await ab.findElement(CHECKBOX)).checked === true,
        });
    },
};
