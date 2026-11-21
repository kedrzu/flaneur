import type { Locator } from 'playwright/test';

import { typeText } from './typeText.js';
import type { TypeTextOptions } from './typeText.js';

/**
 * Types a query into a search field as a person does and submits it with Enter.
 * @util
 */
export async function submitSearch(field: Locator, query: string, options: TypeTextOptions = {}) {
    await typeText(field, query, options);
    await field.press('Enter');
}
