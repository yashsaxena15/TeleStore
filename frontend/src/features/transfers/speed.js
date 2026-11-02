/**
 * A calm transfer speed: an exponential moving average over about `window` seconds instead of
 * each short reading on its own (which jumps around). The app smooths its speeds the same way.
 *
 * previous: the smoothed speed so far (0 before the first reading), instant: bytes per second
 * measured over the last `seconds`.
 */
export function smoothSpeed(previous, instant, seconds, window = 5) {
    if (!(seconds > 0) || !isFinite(instant)) return previous || 0;
    if (!previous) return Math.max(0, instant);
    const weight = 1 - Math.exp(-seconds / window);
    return Math.max(0, previous + weight * (instant - previous));
}
