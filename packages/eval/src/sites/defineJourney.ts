import { errors, test } from 'playwright/test';
import type { Page, TestInfo } from 'playwright/test';

import { findChallenge, parsePageFacts, READ_PAGE_FACTS } from '../classifyChallenge.js';
import type { ChallengeVendor, PageFacts } from '../classifyChallenge.js';
import { classifyFailure } from './classifyFailure.js';
import type { FailureClassification } from './classifyFailure.js';
import type { JourneyTimeline } from './createJourneyTimeline.js';

/** A human-like, non-destructive walk through a protected site: search, a product, a guest cart. */
export interface Journey {
    name: string;
    /** The anti-bot vendor the site is known to sit behind. */
    vendor: ChallengeVendor;
    /** Where the journey starts. */
    url: string;
    /** Walks the site, every action inside a `step`, so a failure is classified and named after its step. */
    run(page: Page, step: JourneyStep): Promise<void>;
}

/** Runs one named step of a journey; a failure is classified and thrown as a `JourneyFailure`. */
export interface JourneyStep {
    (name: string, action: () => Promise<void>, options?: JourneyStepOptions): Promise<void>;
}

/** How a step may fail. */
export interface JourneyStepOptions {
    /**
     * The step acts on something a site shows only sometimes (a cookie banner): its actions get `OPTIONAL_STEP_TIMEOUT_MS`,
     * and one that does not find its target in time skips the rest of the step instead of failing the journey.
     */
    optional?: boolean;
}

/** A failed journey's class, with the step it failed in; written to the test as its `outcome` annotation. */
export type JourneyOutcome = FailureClassification & { step: string };

/** Options of `createJourneyStep`. */
export interface CreateJourneyStepParams {
    page: Page;
    testInfo: TestInfo;
    /** The page's action timeout outside optional steps; `0` is none. */
    actionTimeout: number;
    /** Gets an entry before the first step and after every step, failed ones too. */
    timeline: JourneyTimeline;
}

/** The annotation type a failed test's `JourneyOutcome` is written under, as JSON. */
export const OUTCOME_ANNOTATION = 'outcome';

/** How long an optional step's action looks for its target. */
export const OPTIONAL_STEP_TIMEOUT_MS = 3000;

/** The step name of the challenge check after a journey's last step. */
const AFTER_JOURNEY = 'after the journey';

/** How long reading the page's facts may take; a page stuck in a dialog or a navigation never answers. */
const READ_FACTS_TIMEOUT_MS = 5000;

/** A journey that failed, classified. */
export class JourneyFailure extends Error {
    readonly outcome: JourneyOutcome;

    constructor(outcome: JourneyOutcome, options?: ErrorOptions) {
        super(`${outcome.class} in step "${outcome.step}": ${outcome.evidence}`, options);
        this.name = 'JourneyFailure';
        this.outcome = outcome;
    }
}

/**
 * Declares a journey; an identity function that gives the definition its type.
 * @__NO_SIDE_EFFECTS__
 */
export function defineJourney(journey: Journey): Journey {
    return journey;
}

/**
 * Runs a journey, then checks that it did not end on a challenge page, which no step after it would notice.
 * @throws {JourneyFailure} When a step failed or the journey ended on a challenge.
 */
export async function runJourney(journey: Journey, page: Page, step: JourneyStep) {
    await journey.run(page, step);
    await step(AFTER_JOURNEY, async () => {});
}

/**
 * Creates the `step` a journey runs its actions in, for one test. Before its action a step fails `challenged` when a
 * vendor's challenge is already on the page; when the action throws, the failure is classified from the error and the
 * page. The first failing step writes the test's `outcome` annotation. Every step adds to the timeline.
 * @__NO_SIDE_EFFECTS__
 */
export function createJourneyStep({ page, testInfo, actionTimeout, timeline }: CreateJourneyStepParams): JourneyStep {
    return (name, action, options = {}) =>
        test.step(name, async () => {
            if (timeline.entries.length === 0) {
                await timeline.record('start');
            }
            try {
                await runStep(name, action, options);
            } finally {
                await timeline.record(name);
            }
        });

    async function runStep(name: string, action: () => Promise<void>, options: JourneyStepOptions) {
        failOnChallenge(name, await readPageFacts(page));

        if (options.optional) {
            page.setDefaultTimeout(OPTIONAL_STEP_TIMEOUT_MS);
        }
        try {
            await action();
        } catch (error) {
            if (error instanceof JourneyFailure) {
                throw error;
            }
            const facts = await readPageFacts(page);
            if (options.optional && error instanceof errors.TimeoutError) {
                failOnChallenge(name, facts);
                return;
            }
            throw fail({ ...classifyFailure(error, facts), step: name }, error);
        } finally {
            if (options.optional) {
                page.setDefaultTimeout(actionTimeout);
            }
        }
    }

    function failOnChallenge(name: string, facts: PageFacts | null) {
        const challenge = facts == null ? null : findChallenge(facts);
        if (challenge != null) {
            throw fail({ class: 'challenged', ...challenge, step: name });
        }
    }

    function fail(outcome: JourneyOutcome, cause?: unknown) {
        recordOutcome(testInfo, outcome);
        return new JourneyFailure(outcome, { cause });
    }
}

/**
 * Writes the test's `outcome` annotation, unless a failure before already did: a test has one class.
 * @util
 */
export function recordOutcome(testInfo: TestInfo, outcome: JourneyOutcome) {
    if (!testInfo.annotations.some(annotation => annotation.type === OUTCOME_ANNOTATION)) {
        testInfo.annotations.push({ type: OUTCOME_ANNOTATION, description: JSON.stringify(outcome) });
    }
}

/**
 * The page's facts, or `null` when the page cannot tell them now: it is navigating (the context is destroyed),
 * closed, or does not answer in `READ_FACTS_TIMEOUT_MS`.
 * @util
 */
export async function readPageFacts(page: Page): Promise<PageFacts | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), READ_FACTS_TIMEOUT_MS);
    });
    try {
        return await Promise.race([page.evaluate(READ_PAGE_FACTS).then(parsePageFacts), timeout]);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}
