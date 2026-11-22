import type { JourneySite, StepRunner } from '../defineJourney.js';
import type { AgentBrowser } from './openAgentBrowser.js';

/**
 * A journey driven the way an AI agent drives agent-browser: it reads the page with `snapshot -i` and acts on what it
 * found by role and name (`find role … click`, `click @ref`, `fill`, `press Enter`), and confirms with `get url`. Titled
 * as its Playwright twin, so the reporter's table lines the two up by project.
 */
export interface AgentBrowserJourney extends JourneySite {
    /** Walks the site, every command inside a `step`, so a failure is classified and named after its step. */
    run(ab: AgentBrowser, step: StepRunner): Promise<void>;
}

/**
 * Declares an agent-browser journey; an identity function that gives the definition its type.
 * @__NO_SIDE_EFFECTS__
 */
export function defineAgentBrowserJourney(journey: AgentBrowserJourney): AgentBrowserJourney {
    return journey;
}
