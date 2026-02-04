/**
 * Simple timezone utilities.
 * Backend stores UTC. Frontend displays in user's local time.
 */
import { formatDistanceToNow } from "date-fns";

/**
 * Parse a date string as UTC.
 * Backend sends timestamps without timezone suffix, but they ARE in UTC.
 */
function parseAsUTC(date: Date | string): Date {
    if (date instanceof Date) return date;
    
    let str = String(date).trim();
    if (!str) return new Date(NaN);
    
    // If already has timezone info (Z or +/-offset), parse directly
    if (/Z$|[+-]\d{2}:?\d{2}$/.test(str)) {
        return new Date(str);
    }
    
    // No timezone - backend sends UTC, so append Z
    // Also handle space separator (some APIs use "2026-02-04 05:52:00")
    str = str.replace(" ", "T");
    return new Date(str + "Z");
}

/**
 * Format a date in the user's LOCAL browser time.
 * This is the main function to use for all displayed timestamps.
 * 
 * Example: If backend stores 05:52 UTC and user is in India (IST = UTC+5:30),
 * this will display "11:22 AM"
 */
export function formatDateInLocal(
    date: Date | string | null | undefined,
    _options?: any  // Ignored - kept for backward compatibility
): string {
    if (!date) return "—";
    
    try {
        // Parse as UTC first
        const d = parseAsUTC(date);
        if (isNaN(d.getTime())) return "—";
        
        // toLocaleString WITHOUT timeZone option = uses browser's local timezone
        return d.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true
        });
    } catch (e) {
        console.error("[formatDateInLocal] Error:", e);
        return "—";
    }
}

/**
 * Format relative time (e.g., "2 hours ago").
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
    if (!date) return "unknown";
    
    try {
        // Parse as UTC first
        const d = parseAsUTC(date);
        if (isNaN(d.getTime())) return "unknown";
        return formatDistanceToNow(d, { addSuffix: true });
    } catch (e) {
        console.error("[formatRelativeTime] Error:", e);
        return "unknown";
    }
}

// Keep these for backward compatibility with existing code
export const DEFAULT_TIMEZONE = "America/New_York";

export function formatDateInTimezone(
    date: Date | string | null | undefined,
    _timezone?: string,
    _options?: any
): string {
    return formatDateInLocal(date);
}

export function formatRelativeTimeInTimezone(
    date: Date | string | null | undefined,
    _timezone?: string
): string {
    return formatRelativeTime(date);
}

export function convertLocalToUTC(date: Date): string {
    return date.toISOString();
}

export const COMMON_TIMEZONES = [
    { value: "America/New_York", label: "Eastern Time (ET)" },
    { value: "America/Chicago", label: "Central Time (CT)" },
    { value: "America/Denver", label: "Mountain Time (MT)" },
    { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
    { value: "Asia/Kolkata", label: "India (IST)" },
];
