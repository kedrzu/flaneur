import type { Locator } from 'playwright/test';

/** The pause between keystrokes: a person types a query, a script pastes it. */
const KEYSTROKE_DELAY_MS = 90;

/**
 * Types into a field key by key, as a person does, replacing what it held.
 * @util
 */
export async function typeText(field: Locator, text: string) {
    await field.click();
    await field.clear();
    await field.pressSequentially(text, { delay: KEYSTROKE_DELAY_MS });
}
