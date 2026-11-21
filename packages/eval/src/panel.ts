import { MIN_REAL_TEXT, READ_PAGE_FACTS, findChallenge, parsePageFacts } from './classifyChallenge.js';
import type { PageFacts } from './classifyChallenge.js';
import { asArray, asNumber, asObject, asOneOf, asString, asStringArray } from './jsonShape.js';
import type { EvalDriver, PanelOutcome, PanelSiteResult, PanelVendor } from './StealthEvalTypes.js';

/** How `runPanelProbe` runs. */
export interface RunPanelProbeParams {
    driver: EvalDriver;
    label: string;
}

/** Where the page stands: on the real site, behind a vendor's marker, or neither yet (still loading or empty). */
export interface PanelPageState {
    state: 'through' | 'challenged' | 'unclear';
    evidence: string;
}

/** One site of the panel. */
interface PanelSite {
    vendor: PanelVendor;
    url: string;
}

/**
 * Two sites per vendor where possible (stealth-browsing D6), checked 2026-11-15 from a residential connection: curl was refused
 * by each (or, for Southwest and Allegro, got the vendor's cookies), and the vendor's markers were seen in a browser.
 * G2 turned out to be DataDome, not Cloudflare: its 403 carries `x-datadome: protected` and a
 * `geo.captcha-delivery.com` iframe. Lufthansa let even the plain headless Chromium through at once, so it told nothing
 * apart; Indeed and Medium both answer curl with `cf-mitigated: challenge` and the headless control with a challenge or
 * block page. Kasada has one site. Allegro, DataDome's other site, is left to the Allegro probe: DataDome flags the
 * IP once the headless control loads it, and every later Allegro reading from this connection then starts at a CAPTCHA.
 */
const PANEL_SITES: PanelSite[] = [
    { vendor: 'Cloudflare', url: 'https://www.indeed.com/' },
    { vendor: 'Cloudflare', url: 'https://medium.com/' },
    { vendor: 'Akamai', url: 'https://www.southwest.com/' },
    { vendor: 'Akamai', url: 'https://www.kohls.com/' },
    { vendor: 'HUMAN', url: 'https://www.wayfair.com/' },
    { vendor: 'HUMAN', url: 'https://www.priceline.com/' },
    { vendor: 'Kasada', url: 'https://www.realestate.com.au/buy' },
    { vendor: 'DataDome', url: 'https://www.g2.com/' },
];

/**
 * How long a challenge gets to resolve before the site counts as challenged. Indeed's Cloudflare challenge was seen
 * still up after 20 s and gone a few seconds later in a real Chrome.
 */
const CHALLENGE_TIMEOUT_MS = 30_000;
const POLL_MS = 2000;
const OUTCOMES: readonly PanelOutcome[] = ['through', 'challenged', 'error'];
const VENDORS: readonly PanelVendor[] = ['Cloudflare', 'Akamai', 'HUMAN', 'Kasada', 'DataDome'];

/** The vendors' cookies, by exact name or by prefix (`*`). */
const VENDOR_COOKIES = [
    // Cloudflare
    '__cf_bm',
    'cf_clearance',
    '_cfuvid',
    'cf_chl_*',
    // Akamai Bot Manager
    '_abck',
    'ak_bmsc',
    'bm_*',
    'sec_cpt',
    // HUMAN
    '_px*',
    'pxcts',
    // Kasada
    'KP_*',
    // DataDome
    'datadome',
];

/**
 * The vendor panel (stealth-browsing D6): loads every site once, waits up to 30 s for a JavaScript challenge to resolve, and
 * records whether the real site rendered, the marker that decided it and the vendors' cookies. Nothing is clicked or
 * submitted.
 */
export async function runPanelProbe(params: RunPanelProbeParams): Promise<PanelSiteResult[]> {
    const { driver, label } = params;
    const results: PanelSiteResult[] = [];
    for (const site of PANEL_SITES) {
        const result = await loadSite(site);
        console.log(`[${label}] panel: ${site.vendor} ${site.url} ${result.outcome} (${result.evidence})`);
        results.push(result);
    }
    return results;

    async function loadSite(site: PanelSite): Promise<PanelSiteResult> {
        const startedAt = Date.now();
        let facts: PageFacts | null = null;
        let state: PanelPageState = { state: 'unclear', evidence: 'not loaded' };
        try {
            await driver.open(site.url);
            const deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
            // A challenge that resolves reloads the page, and a read caught by the reload fails: that read is retried
            // until the deadline, and only a page never read at all counts as an error.
            let readError: Error | null = null;
            for (;;) {
                try {
                    facts = parsePageFacts(await driver.evaluate(READ_PAGE_FACTS));
                    state = classifyPanelPage(facts);
                    readError = null;
                } catch (error) {
                    readError = error instanceof Error ? error : new Error(String(error));
                }
                if (state.state === 'through' || Date.now() >= deadline) {
                    break;
                }
                await Bun.sleep(POLL_MS);
            }
            if (facts == null && readError != null) {
                throw readError;
            }
        } catch (error) {
            return {
                ...site,
                outcome: 'error',
                evidence: error instanceof Error ? error.message : String(error),
                // Reached only when the page failed to open or was never read, so there is no title.
                title: '',
                vendorCookies: await readVendorCookies(),
                elapsedMs: Date.now() - startedAt,
            };
        }
        return {
            ...site,
            outcome: state.state === 'through' ? 'through' : 'challenged',
            evidence: state.evidence,
            title: facts?.title ?? '',
            vendorCookies: await readVendorCookies(),
            elapsedMs: Date.now() - startedAt,
        };
    }

    /** The vendors' cookies the browser holds for the page; none when the browser cannot say. */
    async function readVendorCookies() {
        try {
            return filterVendorCookies(await driver.cookieNames());
        } catch {
            return [];
        }
    }
}

/**
 * Decides from what the page shows whether it is a vendor's challenge or block page, the real site, or neither yet.
 * Any vendor's marker counts, not only the expected vendor's: a site may sit behind more than one.
 * @__NO_SIDE_EFFECTS__
 */
export function classifyPanelPage(facts: PageFacts): PanelPageState {
    const challenge = findChallenge(facts);
    if (challenge != null) {
        return { state: 'challenged', evidence: challenge.evidence };
    }
    if (facts.title !== '' && facts.textLength >= MIN_REAL_TEXT) {
        return { state: 'through', evidence: `title "${facts.title}", ${facts.textLength} characters` };
    }
    return { state: 'unclear', evidence: `near-empty page: title "${facts.title}", ${facts.textLength} characters` };
}

/**
 * The names among `names` that are a protection vendor's cookies, each once, in order.
 * @__NO_SIDE_EFFECTS__
 */
export function filterVendorCookies(names: string[]): string[] {
    const matching = names.filter(name =>
        VENDOR_COOKIES.some(pattern =>
            pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
        ),
    );
    return [...new Set(matching)];
}

/**
 * Checks a saved panel probe's shape.
 * @__NO_SIDE_EFFECTS__
 */
export function parsePanelResults(value: unknown): PanelSiteResult[] {
    return asArray(value, 'panel').map((item, index) => {
        const at = `panel[${index}]`;
        const result = asObject(item, at);
        return {
            vendor: asOneOf(result['vendor'], VENDORS, `${at}.vendor`),
            url: asString(result['url'], `${at}.url`),
            outcome: asOneOf(result['outcome'], OUTCOMES, `${at}.outcome`),
            evidence: asString(result['evidence'], `${at}.evidence`),
            title: asString(result['title'], `${at}.title`),
            vendorCookies: asStringArray(result['vendorCookies'], `${at}.vendorCookies`),
            elapsedMs: asNumber(result['elapsedMs'], `${at}.elapsedMs`),
        };
    });
}
