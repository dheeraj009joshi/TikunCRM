/** Shared display helpers for call review pages. */

/** Seconds -> "m:ss" */
export function formatDuration(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

/** Text colour class for a 0-100 score. The number is always shown too. */
export function scoreTone(score: number | null | undefined): string {
    if (score == null) return "text-muted-foreground";
    if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
    if (score >= 60) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
}

/** Progress-bar colour class for a 0-100 score. */
export function scoreBarTone(score: number | null | undefined): string {
    if (score == null) return "bg-muted-foreground/30";
    if (score >= 80) return "bg-emerald-500";
    if (score >= 60) return "bg-amber-500";
    return "bg-red-500";
}

export function formatCallTime(iso: string | null | undefined, withYear = false): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        ...(withYear ? { year: "numeric" } : {}),
        hour: "numeric",
        minute: "2-digit",
    });
}

export function speakerLabel(speaker: string | null | undefined): string {
    if (speaker === "rep") return "Rep";
    if (speaker === "customer") return "Customer";
    if (speaker?.startsWith("speaker_")) return `Speaker ${Number(speaker.slice(8)) + 1}`;
    return "Unknown";
}
