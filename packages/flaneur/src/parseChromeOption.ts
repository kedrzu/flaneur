/** Which Chrome the CLI runs, as `--chrome` names it. */
export type ChromeOption =
    | { type: 'installed' }
    | { type: 'testing'; version?: string }
    | { type: 'path'; path: string };

/** The Chrome for Testing keyword; `testing@<version>` names a version. */
const TESTING = 'testing';

/**
 * Reads `--chrome`: `installed` (the default), `testing`, `testing@<version>`, or a path to the binary. Only a value
 * with a path separator is a path, so a mistyped keyword fails here instead of being spawned as a program.
 * @__NO_SIDE_EFFECTS__
 */
export function parseChromeOption(value: string | undefined): ChromeOption {
    if (value == null || value === 'installed') {
        return { type: 'installed' };
    }
    if (value === TESTING) {
        return { type: 'testing' };
    }
    if (value.startsWith(`${TESTING}@`)) {
        const version = value.slice(TESTING.length + 1);
        if (version === '') {
            throw new Error('--chrome testing@<version> needs a version');
        }
        return { type: 'testing', version };
    }
    if (value.includes('/') || value.includes('\\')) {
        return { type: 'path', path: value };
    }
    throw new Error(`--chrome is not installed, testing, testing@<version> or a path: ${value}`);
}
