/**
 * Canonical color mapping for trade-group pills (QQQ-N / TQQQ-N / GROUP-N).
 *
 * The trailing index drives the hue so QQQ-6..QQQ-10 keep cycling through
 * the same sequence established for QQQ-0..QQQ-5:
 *   0 → amber, 1 → gray, 2 → green, 3 → gray, 4 → purple, 5 → blue
 * and then it repeats (6 → amber, 7 → gray, …) via index % 6.
 *
 * Returns the design-token class, or null when the group has no trailing
 * number — callers supply their own default gray (which varies slightly
 * between the read-only pill and the interactive Select trigger).
 */
const GROUP_PALETTE: (string | null)[] = [
    'cell-note',     // 0 — amber
    null,            // 1 — gray (caller default)
    'cell-positive', // 2 — green
    null,            // 3 — gray (caller default)
    'cell-accent',   // 4 — purple
    'cell-info',     // 5 — blue
];

export function groupPillClass(groupId: string | number | null | undefined): string | null {
    if (groupId == null) return null;
    const match = String(groupId).match(/-(\d+)$/);
    if (!match) return null;
    const n = parseInt(match[1], 10);
    if (Number.isNaN(n)) return null;
    return GROUP_PALETTE[n % GROUP_PALETTE.length];
}
