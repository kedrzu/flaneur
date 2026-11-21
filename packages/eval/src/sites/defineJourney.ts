import { setTimeout as sleep } from 'node:timers/promises';

import { errors, test } from 'playwright/test';
import type { Page, TestInfo } from 'playwright/test';

import { findChallenge, parsePageFacts, READ_PAGE_FACTS } from '../classifyChallenge.js';
import type { ChallengeVendor, PageFacts } from '../classifyChallenge.js';
import { classifyFailure } from './classifyFailure.js';
import type { FailureClassification } from './classifyFailure.js';
import type { JourneyTimeline } from './createJourneyTimeline.js';

/** What a journey and a CAPTCHA check are known by: the test title, the vendor and the site. */
export interface JourneySite {
    name: string;
    /** The anti-bot vendor the site is known to sit behind. */
    vendor: ChallengeVendor;
    /** Where the journey starts. */
    url: string;
    /** Playwright tags beside the vendor's, such as `@long` on the long walks, so a run can pick or skip them. */
    tags?: readonly string[];
}

/** A human-like, non-destructive walk through a protected site in Playwright: search, a product, a guest cart. */
export interface Journey extends JourneySite {
    /** Walks the site, every action inside a `step`, so a failure is classified and named after its step. */
    run(page: Page, step: JourneyStep): Promise<void>;
}

/** Runs one named step of a journey; a failure is classified and thrown as a `JourneyFailure`. */
export type StepRunner = (name: string, action: () => Promise<void>, options?: JourneyStepOptions) => Promise<void>;

/** The `StepRunner` of a Playwright journey. */
export interface JourneyStep extends StepRunner {
    /**
     * Moves the journey to a tab it opened, as a link with `target=_blank` does: the challenge checks of the steps
     * after, the timeline and a failure's evidence read that tab from then on.
     */
    follow(page: Page): void;
}

/** The tab a journey acts in: the test's page until the journey follows another with `JourneyStep.follow`. */
export interface JourneyTab {
    page: Page;
}

/** How a step may fail. */
export interface JourneyStepOptions {
    /**
     * The step acts on something a site shows only sometimes (a cookie banner): its actions get `OPTIONAL_STEP_TIMEOUT_MS`,
     * and one that does not find its target in time skips the rest of the step instead of failing the journey.
     */
    optional?: boolean;
}

/** What `runJourney` runs: a Playwright journey on a page, or an agent-browser journey in a session. */
export interface RunnableJourney<TBrowser, TStep extends StepRunner> {
    run(browser: TBrowser, step: TStep): Promise<void>;
}

/** What a step needs of the browser the journey drives, Playwright or agent-browser. */
export interface StepBrowser {
    /** The facts of the page the journey is on now; `null` when the page cannot tell them now. */
    readFacts(): Promise<PageFacts | null>;
    /** Runs an optional step's action, its actions looking for their target `OPTIONAL_STEP_TIMEOUT_MS` only. */
    runOptional(action: () => Promise<void>): Promise<void>;
    /** Whether an action failed because it did not find its target in time. */
    isMissingTarget(error: unknown): boolean;
}

/** A failed journey's class, with the step it failed in; written to the test as its `outcome` annotation. */
export type JourneyOutcome = FailureClassification & { step: string };

/** Options of `createStepRunner`. */
export interface CreateStepRunnerParams {
    browser: StepBrowser;
    testInfo: TestInfo;
    /** Gets an entry before the first step and after every step, failed ones too. */
    timeline: JourneyTimeline;
}

/** Options of `createJourneyStep`. */
export interface CreateJourneyStepParams {
    /** Shared with the fixtures that read the journey's page; `follow` replaces its page. */
    tab: JourneyTab;
    testInfo: TestInfo;
    /** The page's action timeout outside optional steps; `0` is none. */
    actionTimeout: number;
    /** Gets an entry before the first step and after every step, failed ones too. */
    timeline: JourneyTimeline;
}

/** The annotation type a failed test's `JourneyOutcome` is written under, as JSON. */
export const OUTCOME_ANNOTATION = 'outcome';

/** How long a challenge on the page gets to solve itself before the step counts as challenged. */
const CHALLENGE_RESOLVE_MS = 20_000;
const CHALLENGE_POLL_MS = 1000;

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
export async function runJourney<TBrowser, TStep extends StepRunner>(
    journey: RunnableJourney<TBrowser, TStep>,
    browser: TBrowser,
    step: TStep,
) {
    await journey.run(browser, step);
    await step(AFTER_JOURNEY, async () => {});
}

/**
 * Creates the `step` a Playwright journey runs its actions in, for one test; see `createStepRunner`.
 * @__NO_SIDE_EFFECTS__
 */
export function createJourneyStep({ tab, testInfo, actionTimeout, timeline }: CreateJourneyStepParams): JourneyStep {
    const runStep = createStepRunner({
        testInfo,
        timeline,
        browser: {
            readFacts: () => readPageFacts(tab.page),
            runOptional,
            isMissingTarget: error => error instanceof errors.TimeoutError,
        },
    });
    return Object.assign(runStep, { follow });

    function follow(page: Page) {
        page.setDefaultTimeout(actionTimeout);
        tab.page = page;
    }

    async function runOptional(action: () => Promise<void>) {
        // The action may follow a new tab; its timeout is restored on the tab it started on.
        const { page } = tab;
        page.setDefaultTimeout(OPTIONAL_STEP_TIMEOUT_MS);
        try {
            await action();
        } finally {
            page.setDefaultTimeout(actionTimeout);
        }
    }
}

/**
 * Creates the step runner of one test. Before its action a step fails `challenged` when a vendor's challenge is already
 * on the page and does not solve itself; when the action throws, the failure is classified from the error and the
 * page. The first failing step writes the test's `outcome` annotation. Every step adds to the timeline.
 * @__NO_SIDE_EFFECTS__
 */
export function createStepRunner({ browser, testInfo, timeline }: CreateStepRunnerParams): StepRunner {
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
        await failOnLastingChallenge(name);
        try {
            await (options.optional ? browser.runOptional(action) : action());
        } catch (error) {
            if (error instanceof JourneyFailure) {
                throw error;
            }
            const facts = await browser.readFacts();
            if (options.optional && browser.isMissingTarget(error)) {
                failOnChallenge(name, facts);
                return;
            }
            throw fail({ ...classifyFailure(error, facts), step: name }, error);
        }
    }

    /**
     * Fails the step on a challenge that does not go away by itself: Kasada's `ips.js`, Cloudflare's and AWS WAF's
     * JavaScript challenges solve themselves and reload the page within seconds, as the panel probe allows for.
     */
    async function failOnLastingChallenge(name: string) {
        const deadline = Date.now() + CHALLENGE_RESOLVE_MS;
        let facts = await browser.readFacts();
        while (facts != null && findChallenge(facts) != null && Date.now() < deadline) {
            await sleep(CHALLENGE_POLL_MS);
            facts = await browser.readFacts();
        }
        failOnChallenge(name, facts);
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
export function readPageFacts(page: Page): Promise<PageFacts | null> {
    return readFactsWith(expression => page.evaluate(expression));
}

/**
 * The page's facts as `evaluate` reads them, or `null` when it fails or does not answer in `READ_FACTS_TIMEOUT_MS`.
 * @util
 */
export async function readFactsWith(evaluate: (expression: string) => Promise<unknown>): Promise<PageFacts | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), READ_FACTS_TIMEOUT_MS);
    });
    try {
        return await Promise.race([evaluate(READ_PAGE_FACTS).then(parsePageFacts), timeout]);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}
