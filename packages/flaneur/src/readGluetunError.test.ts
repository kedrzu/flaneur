import { expect, test } from 'bun:test';

import { readGluetunError } from './readGluetunError.js';

const UNKNOWN_REGION_LOG = [
    '2026-11-19T10:00:00Z INFO [routing] default route found',
    '2026-11-19T10:00:01Z ERROR VPN settings: provider settings: server selection: region "US Atlantis" is not valid: choices available DE Berlin, US Texas, US California, DE Frankfurt, us east',
    '2026-11-19T10:00:01Z INFO Shutdown successful',
].join('\n');

test('an unknown region keeps the valid regions that start like it', () => {
    expect(readGluetunError(UNKNOWN_REGION_LOG, 'US Atlantis')).toBe(
        'ERROR VPN settings: provider settings: server selection: region "US Atlantis" is not valid: choices available: US Texas, US California, us east (and 2 more)',
    );
});

test('an unknown region unlike any valid one keeps the first of them all', () => {
    expect(readGluetunError(UNKNOWN_REGION_LOG, 'Atlantis')).toContain(
        'choices available: DE Berlin, US Texas, US California, DE Frankfurt, us east',
    );
});

test('the last error wins, and a log without one has none', () => {
    const log = 'ERROR first\nINFO between\n2026-11-19 ERROR [openvpn] AUTH_FAILED\n';
    expect(readGluetunError(log)).toBe('ERROR [openvpn] AUTH_FAILED');
    expect(readGluetunError('INFO all good\nERRORS are words too')).toBeNull();
});
