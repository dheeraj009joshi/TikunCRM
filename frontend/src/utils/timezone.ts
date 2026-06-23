/**
 * Simple timezone utilities.
 * Backend stores UTC. Frontend displays in user's local time.
 */
import { formatDistanceToNow } from "date-fns";

/**
 * Parse a date string as UTC.
 * Backend sends timestamps without timezone suffix, but they ARE in UTC.
 */
export function parseAsUTC(date: Date | string): Date {
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

/**
 * Format a date in a specific timezone (e.g., dealership timezone).
 * Used for appointments which should display in dealership business hours.
 * 
 * @param date - The date to format (UTC from backend)
 * @param timezone - IANA timezone string (e.g., "America/New_York")
 * @param options - Optional formatting options
 */
export function formatDateInDealershipTimezone(
    date: Date | string | null | undefined,
    timezone: string,
    options?: {
        dateStyle?: "full" | "long" | "medium" | "short";
        timeStyle?: "full" | "long" | "medium" | "short";
        dateOnly?: boolean;
        timeOnly?: boolean;
    }
): string {
    if (!date) return "—";
    
    try {
        const d = parseAsUTC(date);
        if (isNaN(d.getTime())) return "—";
        
        // Build format options based on what's requested
        const formatOptions: Intl.DateTimeFormatOptions = {
            timeZone: timezone,
        };
        
        if (options?.dateOnly) {
            formatOptions.month = "short";
            formatOptions.day = "numeric";
            formatOptions.year = "numeric";
        } else if (options?.timeOnly) {
            formatOptions.hour = "numeric";
            formatOptions.minute = "2-digit";
            formatOptions.hour12 = true;
        } else if (options?.dateStyle || options?.timeStyle) {
            if (options.dateStyle) formatOptions.dateStyle = options.dateStyle;
            if (options.timeStyle) formatOptions.timeStyle = options.timeStyle;
        } else {
            // Default: show date and time
            formatOptions.month = "short";
            formatOptions.day = "numeric";
            formatOptions.year = "numeric";
            formatOptions.hour = "numeric";
            formatOptions.minute = "2-digit";
            formatOptions.hour12 = true;
        }
        
        return d.toLocaleString("en-US", formatOptions);
    } catch (e) {
        console.error("[formatDateInDealershipTimezone] Error:", e);
        return "—";
    }
}

/**
 * Get timezone abbreviation (e.g., "ET", "CT", "PT", "IST")
 */
export function getTimezoneAbbreviation(timezone: string): string {
    try {
        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            timeZoneName: "short",
        });
        const parts = formatter.formatToParts(new Date());
        const tzPart = parts.find(p => p.type === "timeZoneName");
        return tzPart?.value || "";
    } catch {
        return "";
    }
}

export const COMMON_TIMEZONES = [
    // North America
    { value: "America/New_York", label: "Eastern Time - New York (ET)" },
    { value: "America/Chicago", label: "Central Time - Chicago (CT)" },
    { value: "America/Denver", label: "Mountain Time - Denver (MT)" },
    { value: "America/Los_Angeles", label: "Pacific Time - Los Angeles (PT)" },
    { value: "America/Phoenix", label: "Arizona - Phoenix (MST)" },
    { value: "America/Anchorage", label: "Alaska - Anchorage (AKT)" },
    { value: "Pacific/Honolulu", label: "Hawaii - Honolulu (HST)" },
    { value: "America/Detroit", label: "Eastern Time - Detroit" },
    { value: "America/Indianapolis", label: "Eastern Time - Indianapolis" },
    { value: "America/Toronto", label: "Eastern Time - Toronto" },
    { value: "America/Vancouver", label: "Pacific Time - Vancouver" },
    { value: "America/Winnipeg", label: "Central Time - Winnipeg" },
    { value: "America/Edmonton", label: "Mountain Time - Edmonton" },
    { value: "America/Halifax", label: "Atlantic Time - Halifax" },
    { value: "America/St_Johns", label: "Newfoundland - St. John's" },
    { value: "America/Mexico_City", label: "Mexico City (CST)" },
    { value: "America/Tijuana", label: "Tijuana (PT)" },
    
    // South America
    { value: "America/Sao_Paulo", label: "Brazil - São Paulo (BRT)" },
    { value: "America/Buenos_Aires", label: "Argentina - Buenos Aires (ART)" },
    { value: "America/Santiago", label: "Chile - Santiago (CLT)" },
    { value: "America/Lima", label: "Peru - Lima (PET)" },
    { value: "America/Bogota", label: "Colombia - Bogotá (COT)" },
    { value: "America/Caracas", label: "Venezuela - Caracas (VET)" },
    
    // Europe
    { value: "Europe/London", label: "UK - London (GMT/BST)" },
    { value: "Europe/Dublin", label: "Ireland - Dublin (GMT/IST)" },
    { value: "Europe/Paris", label: "France - Paris (CET)" },
    { value: "Europe/Berlin", label: "Germany - Berlin (CET)" },
    { value: "Europe/Madrid", label: "Spain - Madrid (CET)" },
    { value: "Europe/Rome", label: "Italy - Rome (CET)" },
    { value: "Europe/Amsterdam", label: "Netherlands - Amsterdam (CET)" },
    { value: "Europe/Brussels", label: "Belgium - Brussels (CET)" },
    { value: "Europe/Vienna", label: "Austria - Vienna (CET)" },
    { value: "Europe/Zurich", label: "Switzerland - Zurich (CET)" },
    { value: "Europe/Stockholm", label: "Sweden - Stockholm (CET)" },
    { value: "Europe/Oslo", label: "Norway - Oslo (CET)" },
    { value: "Europe/Copenhagen", label: "Denmark - Copenhagen (CET)" },
    { value: "Europe/Helsinki", label: "Finland - Helsinki (EET)" },
    { value: "Europe/Warsaw", label: "Poland - Warsaw (CET)" },
    { value: "Europe/Prague", label: "Czech Republic - Prague (CET)" },
    { value: "Europe/Budapest", label: "Hungary - Budapest (CET)" },
    { value: "Europe/Athens", label: "Greece - Athens (EET)" },
    { value: "Europe/Bucharest", label: "Romania - Bucharest (EET)" },
    { value: "Europe/Istanbul", label: "Turkey - Istanbul (TRT)" },
    { value: "Europe/Moscow", label: "Russia - Moscow (MSK)" },
    { value: "Europe/Kiev", label: "Ukraine - Kyiv (EET)" },
    { value: "Europe/Lisbon", label: "Portugal - Lisbon (WET)" },
    
    // Asia
    { value: "Asia/Kolkata", label: "India - Mumbai/Delhi (IST)" },
    { value: "Asia/Dubai", label: "UAE - Dubai (GST)" },
    { value: "Asia/Singapore", label: "Singapore (SGT)" },
    { value: "Asia/Hong_Kong", label: "Hong Kong (HKT)" },
    { value: "Asia/Tokyo", label: "Japan - Tokyo (JST)" },
    { value: "Asia/Seoul", label: "South Korea - Seoul (KST)" },
    { value: "Asia/Shanghai", label: "China - Shanghai (CST)" },
    { value: "Asia/Beijing", label: "China - Beijing (CST)" },
    { value: "Asia/Taipei", label: "Taiwan - Taipei (CST)" },
    { value: "Asia/Manila", label: "Philippines - Manila (PHT)" },
    { value: "Asia/Jakarta", label: "Indonesia - Jakarta (WIB)" },
    { value: "Asia/Bangkok", label: "Thailand - Bangkok (ICT)" },
    { value: "Asia/Ho_Chi_Minh", label: "Vietnam - Ho Chi Minh (ICT)" },
    { value: "Asia/Kuala_Lumpur", label: "Malaysia - Kuala Lumpur (MYT)" },
    { value: "Asia/Karachi", label: "Pakistan - Karachi (PKT)" },
    { value: "Asia/Dhaka", label: "Bangladesh - Dhaka (BST)" },
    { value: "Asia/Colombo", label: "Sri Lanka - Colombo (IST)" },
    { value: "Asia/Kathmandu", label: "Nepal - Kathmandu (NPT)" },
    { value: "Asia/Riyadh", label: "Saudi Arabia - Riyadh (AST)" },
    { value: "Asia/Kuwait", label: "Kuwait - Kuwait City (AST)" },
    { value: "Asia/Qatar", label: "Qatar - Doha (AST)" },
    { value: "Asia/Bahrain", label: "Bahrain - Manama (AST)" },
    { value: "Asia/Jerusalem", label: "Israel - Jerusalem (IST)" },
    { value: "Asia/Tehran", label: "Iran - Tehran (IRST)" },
    { value: "Asia/Kabul", label: "Afghanistan - Kabul (AFT)" },
    { value: "Asia/Tashkent", label: "Uzbekistan - Tashkent (UZT)" },
    { value: "Asia/Almaty", label: "Kazakhstan - Almaty (ALMT)" },
    
    // Australia & Pacific
    { value: "Australia/Sydney", label: "Australia - Sydney (AEST)" },
    { value: "Australia/Melbourne", label: "Australia - Melbourne (AEST)" },
    { value: "Australia/Brisbane", label: "Australia - Brisbane (AEST)" },
    { value: "Australia/Perth", label: "Australia - Perth (AWST)" },
    { value: "Australia/Adelaide", label: "Australia - Adelaide (ACST)" },
    { value: "Australia/Darwin", label: "Australia - Darwin (ACST)" },
    { value: "Pacific/Auckland", label: "New Zealand - Auckland (NZST)" },
    { value: "Pacific/Fiji", label: "Fiji - Suva (FJT)" },
    { value: "Pacific/Guam", label: "Guam (ChST)" },
    
    // Africa
    { value: "Africa/Cairo", label: "Egypt - Cairo (EET)" },
    { value: "Africa/Johannesburg", label: "South Africa - Johannesburg (SAST)" },
    { value: "Africa/Lagos", label: "Nigeria - Lagos (WAT)" },
    { value: "Africa/Nairobi", label: "Kenya - Nairobi (EAT)" },
    { value: "Africa/Casablanca", label: "Morocco - Casablanca (WET)" },
    { value: "Africa/Algiers", label: "Algeria - Algiers (CET)" },
    { value: "Africa/Tunis", label: "Tunisia - Tunis (CET)" },
    { value: "Africa/Accra", label: "Ghana - Accra (GMT)" },
    { value: "Africa/Addis_Ababa", label: "Ethiopia - Addis Ababa (EAT)" },
    
    // UTC
    { value: "UTC", label: "UTC (Coordinated Universal Time)" },
];
