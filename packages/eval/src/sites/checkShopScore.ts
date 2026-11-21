import type { ShopVisit } from '../StealthEvalTypes.js';

/** What a shop visit scored: over the actions that have a score, and how many have none. */
export interface ShopScoreSummary {
    mean: number;
    min: number;
    scored: number;
    unscored: number;
}

/** The mean and minimum reCAPTCHA v3 score over the visit's scored actions; `null` when no action has a score. */
export function summarizeShopScore(visit: ShopVisit): ShopScoreSummary | null {
    const scores: number[] = [];
    for (const { score } of visit.actions) {
        if (score != null) {
            scores.push(score);
        }
    }
    if (scores.length === 0) {
        return null;
    }
    let sum = 0;
    for (const score of scores) {
        sum += score;
    }
    return {
        mean: sum / scores.length,
        min: Math.min(...scores),
        scored: scores.length,
        unscored: visit.actions.length - scores.length,
    };
}

/** Fails a shop visit whose mean reCAPTCHA v3 score is below `threshold`, or that has no scores at all; unscored actions are counted, never averaged. */
export function checkShopScore(visit: ShopVisit, threshold: number): ShopScoreSummary {
    const summary = summarizeShopScore(visit);
    if (summary == null) {
        throw new Error(`reCAPTCHA v3 gave no score to any of ${visit.actions.length} actions`);
    }
    if (summary.mean < threshold) {
        throw new Error(
            `reCAPTCHA v3 mean ${summary.mean.toFixed(2)} < ${threshold} over ${summary.scored} scored actions (${summary.unscored} without a score)`,
        );
    }
    return summary;
}
