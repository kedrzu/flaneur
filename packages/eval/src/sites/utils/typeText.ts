import type { Locator } from 'playwright/test';

/** Options of `typeText`. */
export interface TypeTextOptions {
    /**
     * Where to click the field, relative to its top left corner; its centre when not given. For a field whose centre
     * another element covers, as a person clicks where the field shows.
     */
    position?: { x: number; y: number };
}

/** The pause between keystrokes: a person types a query, a script pastes it. */
const KEYSTROKE_DELAY_MS = 90;

/**
 * Types into a field key by key, as a person does, replacing what it held.
 * @util
 */
export async function typeText(field: Locator, text: string, options: TypeTextOptions = {}) {
    await field.click(options.position == null ? {} : { position: options.position });
    await field.clear();
    await field.pressSequentially(text, { delay: KEYSTROKE_DELAY_MS });
}
