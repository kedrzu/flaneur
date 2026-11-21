import type { AgentBrowser, ElementQuery } from './openAgentBrowser.js';

/**
 * Searches as an agent does with agent-browser: finds the search field in a snapshot, `fill`s it, presses Enter.
 * @util
 */
export async function submitSearch(ab: AgentBrowser, field: ElementQuery, query: string) {
    await ab.fill(await ab.findRef(field), query);
    await ab.press('Enter');
}
