// Layout numbers for the virtualized file list. They match the plain grid's CSS:
// two columns on phones, then as many 150px-or-wider tiles as fit with a 10px gap.
export const VIRTUALIZE_AT = 300;
const MIN_TILE = 150;
const GAP = 10;
const SM_BREAKPOINT = 640;

export function gridColumnCount(width) {
    if (!width || width < SM_BREAKPOINT - 32) return 2;
    return Math.max(1, Math.floor((width + GAP) / (MIN_TILE + GAP)));
}

export const shouldVirtualize = (count) => count >= VIRTUALIZE_AT;
