import { findChallengeVendor } from 'flaneur';
import type { Page } from 'playwright/test';

import { summarizeVendorCookies } from '../vendorCookies.js';
import type { VendorCookieSummary } from '../vendorCookies.js';
import type { JourneyTab } from './defineJourney.js';

/** Where a journey stood after one of its steps: the page and the anti-bot cookies the browser held for it. */
export interface TimelineEntry {
    /** The step just finished, or `start` before the first. */
    step: string;
    /** Since the timeline was created, at the test's start. */
    atMs: number;
    url: string;
    /** `null` when the browser did not say. */
    cookies: VendorCookieSummary | null;
    /**
     * Vendor challenges loaded inside a subframe of a subframe (leboncoin.fr's hidden sign-in frame gets DataDome's
     * CAPTCHA), which neither flaneur's pace nor the journey counts as a challenge of the page; omitted when none.
     */
    nestedChallenges?: NestedChallenge[];
}

/** A vendor challenge frame nested inside another subframe of the page. */
export interface NestedChallenge {
    vendor: string;
    /** The challenge frame's origin and path, without the query, which carries the vendor's ids. */
    url: string;
    /** The origin of the subframe that holds it. */
    parentOrigin: string;
}

/** A journey's step timeline; `sitesTest` writes its entries to the test as the `timeline` annotation. */
export interface JourneyTimeline {
    readonly entries: readonly TimelineEntry[];
    /** Adds an entry for the page as it is now; never throws. */
    record(step: string): Promise<void>;
}

/** The annotation type a test's timeline entries are written under, as JSON. */
export const TIMELINE_ANNOTATION = 'timeline';

/**
 * Creates an empty timeline of the journey's tab, whichever page it holds when an entry is recorded, its clock started
 * now.
 * @__NO_SIDE_EFFECTS__
 */
export function createJourneyTimeline(tab: JourneyTab): JourneyTimeline {
    const startedAt = Date.now();
    const entries: TimelineEntry[] = [];
    return { entries, record };

    async function record(step: string) {
        const { page } = tab;
        const url = page.url();
        const nestedChallenges = findNestedChallenges(page);
        entries.push({
            step,
            atMs: Date.now() - startedAt,
            url,
            cookies: await readCookies(url),
            ...(nestedChallenges.length > 0 ? { nestedChallenges } : {}),
        });
    }

    async function readCookies(url: string) {
        try {
            return summarizeVendorCookies(await tab.page.context().cookies(url));
        } catch {
            // A closed page or a disconnected browser has no cookies to tell; the entry says so with `null`.
            return null;
        }
    }
}

/** The challenge frames of `page` whose parent is a subframe; read from Playwright's frame tree, no command sent. */
function findNestedChallenges(page: Page) {
    const nested: NestedChallenge[] = [];
    for (const frame of page.frames()) {
        const parent = frame.parentFrame();
        if (parent?.parentFrame() == null) {
            continue;
        }
        const vendor = findChallengeVendor(frame.url());
        const challengeUrl = URL.parse(frame.url());
        const parentUrl = URL.parse(parent.url());
        if (vendor == null || challengeUrl == null || parentUrl == null) {
            continue;
        }
        nested.push({
            vendor,
            url: challengeUrl.origin + challengeUrl.pathname,
            parentOrigin: parentUrl.origin,
        });
    }
    return nested;
}
