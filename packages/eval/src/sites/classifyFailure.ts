import { stripVTControlCharacters } from 'node:util';

import { findChallenge } from '../classifyChallenge.js';
import type { ChallengeVendor, PageFacts } from '../classifyChallenge.js';

/** Why a journey failed, as the sites eval counts it. */
export type FailureClassification =
    /** An anti-bot vendor's challenge or block page is on the page. */
    | { class: 'challenged'; vendor: ChallengeVendor; evidence: string }
    /** flaneur's own per-site pace refused the command, after earlier blocks or to keep the site's interval. */
    | { class: 'refused'; evidence: string }
    /** Anything else: a changed selector, a site down, a bug in the journey. */
    | { class: 'broken'; evidence: string };

/** The longest `broken` evidence kept: the first line of an error is enough to tell one breakage from another. */
const MAX_EVIDENCE_LENGTH = 200;

/**
 * The refusals of flaneur's site pace (the messages of `createSitePace`), wherever Playwright wraps them
 * (`page.goto: Protocol error (Page.navigate): <refusal>`). The site is the word before "is paced"/"blocked".
 */
const PACE_REFUSALS = [
    {
        pattern: /(\S+) is paced after it blocked or challenged the browser: the next action/,
        reason: 'paused after a block',
    },
    { pattern: /(\S+) is paced at one page load every [^:]+: the next action/, reason: 'paused at its interval' },
    {
        pattern: /(\S+) blocked or challenged the browser twice in a short time, so acting on it is stopped/,
        reason: 'stopped after two blocks',
    },
];

/**
 * Classifies a failed journey from the error and what the page showed when it failed (`null` when the page could not
 * be read). A challenge marker wins over a pace refusal: the pace refuses a site because it was challenged, and the
 * marker on the page names the vendor, which the refusal does not.
 * @__NO_SIDE_EFFECTS__
 */
export function classifyFailure(error: unknown, facts: PageFacts | null): FailureClassification {
    const challenge = facts == null ? null : findChallenge(facts);
    if (challenge != null) {
        return { class: 'challenged', vendor: challenge.vendor, evidence: challenge.evidence };
    }

    const message = readMessage(error);
    for (const { pattern, reason } of PACE_REFUSALS) {
        const match = pattern.exec(message);
        if (match != null) {
            return { class: 'refused', evidence: `flaneur pace ${reason} on ${match[1]}` };
        }
    }

    const firstLine = message.split('\n').find(line => line.trim() !== '') ?? 'no error message';
    return { class: 'broken', evidence: firstLine.trim().slice(0, MAX_EVIDENCE_LENGTH) };
}

/** The error's message without the ANSI colours Playwright puts in the messages of `testInfo.errors`. */
function readMessage(error: unknown) {
    return stripVTControlCharacters(error instanceof Error ? error.message : String(error));
}
