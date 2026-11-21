import { expect, test } from 'bun:test';

import { filterVendorCookies, summarizeVendorCookies } from './vendorCookies.js';
import type { VendorCookieSummary } from './vendorCookies.js';

test('vendor cookies are kept by exact name or prefix, each once', () => {
    const names = [
        '__cf_bm',
        'utag_main',
        '_px3',
        '_pxhd',
        'bm_sz',
        'ak_bmsc',
        'datadome',
        '__cf_bm',
        'KP_UIDz',
        'aws-waf-token',
        'abck',
    ];

    expect(filterVendorCookies(names)).toEqual([
        '__cf_bm',
        '_px3',
        '_pxhd',
        'bm_sz',
        'ak_bmsc',
        'datadome',
        'KP_UIDz',
        'aws-waf-token',
    ]);
});

test("_abck's state is read from its second field only, and no cookie value is kept", () => {
    const summarize = (abck: string) =>
        summarizeVendorCookies([
            { name: 'bm_sz', value: 'secret-sz' },
            { name: '_abck', value: abck },
            { name: 'session', value: 'secret-session' },
        ]);

    const validated: VendorCookieSummary = { names: ['bm_sz', '_abck'], abck: 'valid' };
    expect(summarize('A1B2C3~0~YAAQ~-1~-1~-1')).toEqual(validated);
    expect(summarize('A1B2C3~-1~YAAQ~0~-1~-1').abck).toBe('invalid');
    expect(summarize('A1B2C3').abck).toBe('unknown');
    expect(summarizeVendorCookies([{ name: 'datadome', value: 'x' }])).toEqual({ names: ['datadome'] });
});
