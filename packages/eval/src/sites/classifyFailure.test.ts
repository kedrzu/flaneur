import { expect, test } from 'bun:test';

import type { PageFacts } from '../classifyChallenge.js';
import { classifyFailure } from './classifyFailure.js';
import type { FailureClassification } from './classifyFailure.js';

const REFUSALS = [
    {
        message:
            'page.goto: Protocol error (Page.navigate): www.allegro.pl is paced after it blocked or challenged the browser: the next action on it is possible in 4 min 30 s.\nCall log:\n  - navigating to "https://allegro.pl/", waiting until "load"',
        evidence: 'flaneur pace paused after a block on www.allegro.pl',
    },
    {
        message:
            'locator.click: Protocol error (Runtime.callFunctionOn): allegro.pl is paced at one page load every 10 s: the next action on it is possible in 3 s.',
        evidence: 'flaneur pace paused at its interval on allegro.pl',
    },
    {
        message:
            '\u001B[31mpage.goto: Protocol error (Page.navigate): allegro.pl blocked or challenged the browser twice in a short time, so acting on it is stopped for now.\u001B[39m',
        evidence: 'flaneur pace stopped after two blocks on allegro.pl',
    },
];

test('a pace refusal wrapped by Playwright is refused, never broken', () => {
    for (const { message, evidence } of REFUSALS) {
        const expected: FailureClassification = { class: 'refused', evidence };
        expect(classifyFailure(new Error(message), facts())).toEqual(expected);
        // `testInfo.errors` gives the message as a string, with ANSI colours.
        expect(classifyFailure(message, null)).toEqual(expected);
    }
});

test('a challenge marker on the page wins over the error, a pace refusal included', () => {
    const challenged = facts({ pxCaptcha: true });

    const expected: FailureClassification = { class: 'challenged', vendor: 'HUMAN', evidence: 'HUMAN #px-captcha' };
    expect(classifyFailure(new Error('locator.click: Timeout 30000ms exceeded.'), challenged)).toEqual(expected);
    expect(classifyFailure(new Error(REFUSALS[0]!.message), challenged)).toEqual(expected);
});

test('any other error is broken, with its first line as the evidence', () => {
    const error = new Error(
        "\u001B[2mlocator.click: Timeout 30000ms exceeded.\u001B[22m\nCall log:\n  - waiting for locator('#search')",
    );

    const expected: FailureClassification = { class: 'broken', evidence: 'locator.click: Timeout 30000ms exceeded.' };
    expect(classifyFailure(error, facts())).toEqual(expected);
    expect(classifyFailure(error, null)).toEqual(expected);
    // Text that only mentions pacing is not a refusal.
    expect(classifyFailure(new Error('the site is paced'), null).class).toBe('broken');
});

function facts(overrides: Partial<PageFacts> = {}): PageFacts {
    return {
        url: 'https://allegro.pl/',
        title: 'Allegro',
        textLength: 4000,
        textStart: 'Allegro - atrakcyjne ceny',
        scripts: [],
        iframes: [],
        formActions: [],
        pxCaptcha: false,
        akamaiChallenge: false,
        ...overrides,
    };
}
