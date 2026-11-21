import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { asObject, asString } from '../jsonShape.js';
import { SITES_STATE_FOLDER } from './serveSitesBrowser.js';

// A site that challenged or refused flaneur is left alone for a while across runs, not only within one (flaneur's pace
// forgets when its browser closes): the next run would otherwise hit it again from an IP it has just flagged. The
// reporter, in the runner process, is the one writer; `describeSite` reads the store when the tests are collected.

/** A site's cooldown. */
export interface SiteCooldown {
    /** ISO time it ends. */
    until: string;
    /** What started it, e.g. `challenged by Akamai`. */
    reason: string;
}

/** The cooldowns by site (the host a journey starts on). */
export type SiteCooldowns = Record<string, SiteCooldown>;

/** Options of `addCooldown`. */
export interface AddCooldownParams {
    site: string;
    reason: string;
    now: Date;
}

/** The store, beside the runs' output folders. */
export const COOLDOWN_FILE = path.join(SITES_STATE_FOLDER, 'sites', 'cooldown.json');

/** Set to `1`, the journeys run on cooling sites too. */
export const IGNORE_COOLDOWN_VARIABLE = 'FLANEUR_SITES_IGNORE_COOLDOWN';

/** How long a site cools after a challenge or a refusal. */
const COOLDOWN_MS = 60 * 60_000;

/**
 * The cooldowns with `site`'s set to end `COOLDOWN_MS` from `now`, unless it already ends later; expired ones are
 * dropped.
 * @__NO_SIDE_EFFECTS__
 */
export function addCooldown(cooldowns: SiteCooldowns, { site, reason, now }: AddCooldownParams): SiteCooldowns {
    const result = activeCooldowns(cooldowns, now);
    const until = new Date(now.getTime() + COOLDOWN_MS);
    const existing = result[site];
    if (existing == null || new Date(existing.until) < until) {
        result[site] = { until: until.toISOString(), reason };
    }
    return result;
}

/**
 * The cooldowns that have not ended at `now`.
 * @__NO_SIDE_EFFECTS__
 */
export function activeCooldowns(cooldowns: SiteCooldowns, now: Date): SiteCooldowns {
    const active: SiteCooldowns = {};
    for (const [site, cooldown] of Object.entries(cooldowns)) {
        if (new Date(cooldown.until) > now) {
            active[site] = cooldown;
        }
    }
    return active;
}

/**
 * The whole minutes, rounded up, until `site`'s cooldown ends; `0` when it is not cooling.
 * @__NO_SIDE_EFFECTS__
 */
export function remainingCooldownMinutes(cooldowns: SiteCooldowns, site: string, now: Date): number {
    const cooldown = cooldowns[site];
    if (cooldown == null) {
        return 0;
    }
    return Math.max(0, Math.ceil((new Date(cooldown.until).getTime() - now.getTime()) / 60_000));
}

/**
 * Reads the store; none yet is no cooldowns. Synchronous, so a spec can read it while its tests are collected.
 * @throws {Error} When the file is not a cooldown store.
 */
export function readCooldowns(file: string): SiteCooldowns {
    let text: string;
    try {
        text = readFileSync(file, 'utf8');
    } catch {
        return {};
    }
    try {
        const cooldowns: SiteCooldowns = {};
        for (const [site, value] of Object.entries(asObject(JSON.parse(text), 'cooldowns'))) {
            const cooldown = asObject(value, site);
            cooldowns[site] = {
                until: asString(cooldown['until'], `${site}.until`),
                reason: asString(cooldown['reason'], `${site}.reason`),
            };
        }
        return cooldowns;
    } catch (error) {
        throw new Error(`${file} is not a cooldown store; fix or delete it`, { cause: error });
    }
}

/** Writes the store, creating its folder. */
export async function writeCooldowns(file: string, cooldowns: SiteCooldowns) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(cooldowns, null, 2)}\n`);
}
