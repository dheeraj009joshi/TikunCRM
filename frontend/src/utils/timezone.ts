/**
 * Timezone utilities for dealership-based timezone handling
 */
import { formatDistanceToNow } from "date-fns";

/**
 * Common timezones for dealerships
 */
export const COMMON_TIMEZONES = [
    { value: "UTC", label: "UTC (Coordinated Universal Time)" },
    { value: "America/New_York", label: "Eastern Time (ET)" },
    { value: "America/Chicago", label: "Central Time (CT)" },
    { value: "America/Denver", label: "Mountain Time (MT)" },
    { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
    { value: "America/Phoenix", label: "Arizona Time (MST)" },
    { value: "Europe/London", label: "London (GMT/BST)" },
    { value: "Europe/Paris", label: "Paris (CET/CEST)" },
    { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
    { value: "Asia/Dubai", label: "Dubai (GST)" },
    { value: "Asia/Kolkata", label: "India (IST)" },
    { value: "Asia/Singapore", label: "Singapore (SGT)" },
    { value: "Asia/Tokyo", label: "Tokyo (JST)" },
    { value: "Australia/Sydney", label: "Sydney (AEDT/AEST)" },
    { value: "Australia/Melbourne", label: "Melbourne (AEDT/AEST)" },
];

/**
 * Convert a UTC date to a specific timezone
 */
function convertToTimezone(date: Date, timezone: string): Date {
    try {
        // Create a formatter for the target timezone
        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });
        
        // Format the date in the target timezone
        const parts = formatter.formatToParts(date);
        const year = parseInt(parts.find(p => p.type === "year")?.value || "0")
        const month = parseInt(parts.find(p => p.type === "month")?.value || "0") - 1
        const day = parseInt(parts.find(p => p.type === "day")?.value || "0")
        const hour = parseInt(parts.find(p => p.type === "hour")?.value || "0")
        const minute = parseInt(parts.find(p => p.type === "minute")?.value || "0")
        const second = parseInt(parts.find(p => p.type === "second")?.value || "0")
        
        // Create a new date in local time (this represents the timezone-adjusted time)
        return new Date(year, month, day, hour, minute, second)
    } catch (error) {
        console.error("Error converting to timezone:", error);
        return date;
    }
}

/**
 * Format a date in the dealership timezone
 */
export function formatDateInTimezone(
    date: Date | string,
    timezone: string = "UTC",
    options: Intl.DateTimeFormatOptions = {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
    }
): string {
    try {
        const dateObj = typeof date === "string" ? new Date(date) : date;
        const formatter = new Intl.DateTimeFormat("en-US", {
            ...options,
            timeZone: timezone,
        });
        return formatter.format(dateObj);
    } catch (error) {
        console.error("Error formatting date in timezone:", error);
        const dateObj = typeof date === "string" ? new Date(date) : date;
        return dateObj.toLocaleString();
    }
}

/**
 * Format relative time (e.g., "2 hours ago") in dealership timezone
 * This calculates the relative time based on the timezone-adjusted date
 */
export function formatRelativeTimeInTimezone(
    date: Date | string,
    timezone: string = "UTC"
): string {
    try {
        const dateObj = typeof date === "string" ? new Date(date) : date;
        
        // For relative time, we need to account for the timezone difference
        // Get the current time in the target timezone
        const now = new Date();
        const nowInTz = convertToTimezone(now, timezone);
        const dateInTz = convertToTimezone(dateObj, timezone);
        
        // Calculate the difference
        const diffMs = nowInTz.getTime() - dateInTz.getTime();
        const adjustedDate = new Date(now.getTime() - diffMs);
        
        return formatDistanceToNow(adjustedDate, { addSuffix: true });
    } catch (error) {
        console.error("Error formatting relative time:", error);
        const dateObj = typeof date === "string" ? new Date(date) : date;
        return formatDistanceToNow(dateObj, { addSuffix: true });
    }
}

/**
 * Get timezone abbreviation (e.g., "EST", "PST")
 */
export function getTimezoneAbbreviation(timezone: string): string {
    try {
        const date = new Date();
        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            timeZoneName: "short",
        });
        const parts = formatter.formatToParts(date);
        const tzName = parts.find((part) => part.type === "timeZoneName");
        return tzName?.value || timezone;
    } catch (error) {
        return timezone;
    }
}
