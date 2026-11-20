import { isPlainObject } from '@nzyme/utils/isPlainObject.js';

/** Which tabs flaneur sees: only those its agents opened, or every web tab of the user. */
export type TabScopeKind = 'agent' | 'all';

/** What the user set on the options page; the options page is the only writer. */
export interface ExtensionSettings {
    scope: TabScopeKind;
}

/**
 * The settings in `chrome.storage.local`, each one not set yet taken from the package's `defaults.json`. The defaults
 * are read at run time, not bundled, so a test copies the extension with its own `defaults.json`.
 */
export async function readSettings(): Promise<ExtensionSettings> {
    const response = await fetch(chrome.runtime.getURL('defaults.json'));
    const defaults = parseSettings(await response.json(), { scope: 'agent' });
    return parseSettings(await chrome.storage.local.get(['scope']), defaults);
}

function parseSettings(value: unknown, fallback: ExtensionSettings): ExtensionSettings {
    if (!isPlainObject(value)) {
        return fallback;
    }
    const { scope } = value;
    return { scope: scope === 'agent' || scope === 'all' ? scope : fallback.scope };
}
