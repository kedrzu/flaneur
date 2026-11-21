/** A cookie as the browser reports it; only what the summary reads. */
export interface NamedCookie {
    name: string;
    value: string;
}

/**
 * Whether Akamai's sensor validated the session, read from `_abck`'s second `~` field: `0` once the sensor data was
 * accepted, `-1` before. Akamai documents none of it; it is the reading reverse-engineering write-ups agree on, and
 * some sites never write `0`.
 */
export type AbckState = 'valid' | 'invalid' | 'unknown';

/** The anti-bot cookies the browser holds for a site, without their values: those identify the browser. */
export interface VendorCookieSummary {
    /** The vendors' cookies present, each once, in the browser's order. */
    names: string[];
    /** Akamai's `_abck` state, when the cookie is present. */
    abck?: AbckState;
}

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
    // AWS WAF
    'aws-waf-token',
];

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
 * The vendors' cookies among `cookies`, with the state of those whose value tells one (`_abck`); no value is kept.
 * @__NO_SIDE_EFFECTS__
 */
export function summarizeVendorCookies(cookies: readonly NamedCookie[]): VendorCookieSummary {
    const names = filterVendorCookies(cookies.map(cookie => cookie.name));
    const abck = cookies.find(cookie => cookie.name === '_abck');
    return abck == null ? { names } : { names, abck: readAbckState(abck.value) };
}

/**
 * Reads `_abck`'s state field, the second of its `~`-separated fields. Only that field counts: a validated cookie
 * still carries `-1` in later fields.
 * @__NO_SIDE_EFFECTS__
 */
function readAbckState(value: string): AbckState {
    switch (value.split('~')[1]) {
        case '0':
            return 'valid';
        case '-1':
            return 'invalid';
        default:
            return 'unknown';
    }
}
