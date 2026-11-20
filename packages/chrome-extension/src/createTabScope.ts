import { assertNever } from '@nzyme/utils/assertNever.js';

import { isWebUrl } from './isWebUrl.js';
import type { TabScopeKind } from './readSettings.js';

/** Which tabs flaneur may see over one connection. */
export interface TabScope {
    /** Marks a tab flaneur created on this connection. */
    addAgentTab(tabId: number): void;
    /**
     * Whether flaneur may see the tab. With scope `agent` that is a tab it created, or one such a tab opened, which
     * becomes an agent tab itself; with scope `all` any web tab.
     */
    includes(tab: chrome.tabs.Tab): boolean;
}

/**
 * The scope of one connection: its agent tabs end with it.
 * @__NO_SIDE_EFFECTS__
 */
export function createTabScope(kind: TabScopeKind): TabScope {
    const agentTabs = new Set<number>();

    return {
        addAgentTab: tabId => agentTabs.add(tabId),
        includes,
    };

    function includes(tab: chrome.tabs.Tab) {
        if (tab.id == null) {
            return false;
        }
        switch (kind) {
            case 'agent':
                if (agentTabs.has(tab.id)) {
                    return true;
                }
                if (tab.openerTabId != null && agentTabs.has(tab.openerTabId)) {
                    agentTabs.add(tab.id);
                    return true;
                }
                return false;
            case 'all':
                return isWebUrl(tab.url || tab.pendingUrl || '');
            default:
                return assertNever(kind);
        }
    }
}
