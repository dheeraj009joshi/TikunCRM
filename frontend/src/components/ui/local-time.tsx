"use client";

import { useEffect, useState } from "react";

interface LocalTimeProps {
    date: Date | string | null | undefined;
    className?: string;
}

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
 * Displays a date/time in the user's local browser timezone.
 * Uses client-side only rendering to avoid SSR timezone issues.
 */
export function LocalTime({ date, className }: LocalTimeProps) {
    const [formatted, setFormatted] = useState<string>("—");

    useEffect(() => {
        if (!date) {
            setFormatted("—");
            return;
        }

        try {
            // Parse as UTC first
            const d = parseAsUTC(date);
            if (isNaN(d.getTime())) {
                setFormatted("—");
                return;
            }

            // Format in user's local timezone (browser default)
            const result = d.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true
            });
            setFormatted(result);
        } catch (e) {
            console.error("[LocalTime] Error:", e);
            setFormatted("—");
        }
    }, [date]);

    return <span className={className}>{formatted}</span>;
}

/**
 * Displays relative time (e.g., "2 hours ago") based on user's local time.
 */
export function RelativeTime({ date, className }: LocalTimeProps) {
    const [formatted, setFormatted] = useState<string>("—");

    useEffect(() => {
        if (!date) {
            setFormatted("—");
            return;
        }

        try {
            // Parse as UTC first
            const d = parseAsUTC(date);
            if (isNaN(d.getTime())) {
                setFormatted("—");
                return;
            }

            const now = new Date();
            const diffMs = now.getTime() - d.getTime();
            const diffSecs = Math.floor(diffMs / 1000);
            const diffMins = Math.floor(diffSecs / 60);
            const diffHours = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHours / 24);

            let result: string;
            if (diffSecs < 60) {
                result = "just now";
            } else if (diffMins < 60) {
                result = `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
            } else if (diffHours < 24) {
                result = `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
            } else if (diffDays < 30) {
                result = `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
            } else {
                result = d.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric"
                });
            }
            setFormatted(result);
        } catch (e) {
            console.error("[RelativeTime] Error:", e);
            setFormatted("—");
        }
    }, [date]);

    return <span className={className}>{formatted}</span>;
}
