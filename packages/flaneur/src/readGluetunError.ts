/** How many valid region names an error lists when none starts like the requested one. */
const MAX_CHOICES = 30;

/**
 * Why gluetun stopped: the last `ERROR` line of its log, from `ERROR` on; `null` when it logged none. An unknown region
 * makes gluetun list every valid one, hundreds for some providers, so the list keeps those that start like `region`
 * (each `US …` for `US Atlantis`), else the first few, and says how many it left out.
 * @util
 * @__NO_SIDE_EFFECTS__
 */
export function readGluetunError(logs: string, region?: string) {
    let line: string | undefined;
    for (const logLine of logs.split('\n')) {
        if (/\bERROR\b/.test(logLine)) {
            line = logLine.trim();
        }
    }
    if (line == null) {
        return null;
    }
    const error = line.slice(line.search(/\bERROR\b/));
    const marker = 'choices available ';
    const at = error.indexOf(marker);
    if (at < 0) {
        return error;
    }

    const choices = error
        .slice(at + marker.length)
        .split(',')
        .map(choice => choice.trim())
        .filter(choice => choice !== '');
    const word = region?.trim().split(/\s+/)[0]?.toLowerCase();
    const alike =
        word == null || word === ''
            ? []
            : choices.filter(choice => {
                  const lower = choice.toLowerCase();
                  return lower === word || lower.startsWith(`${word} `);
              });
    const shown = alike.length > 0 ? alike : choices.slice(0, MAX_CHOICES);
    const omitted = choices.length - shown.length;
    return `${error.slice(0, at + marker.length - 1)}: ${shown.join(', ')}${omitted > 0 ? ` (and ${omitted} more)` : ''}`;
}
