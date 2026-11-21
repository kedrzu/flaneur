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
        entries.push({ step, atMs: Date.now() - startedAt, url, cookies: await readCookies(url) });
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
