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
    { value: "Africa/Accra", label: "Africa - Accra, Ghana (GMT)" },
    { value: "Africa/Addis_Ababa", label: "Africa - Addis Ababa, Ethiopia (EAT)" },
    { value: "Africa/Algiers", label: "Africa - Algiers, Algeria (CET)" },
    { value: "Africa/Cairo", label: "Africa - Cairo, Egypt (EET)" },
    { value: "Africa/Casablanca", label: "Africa - Casablanca, Morocco (WET)" },
    { value: "Africa/Johannesburg", label: "Africa - Johannesburg, South Africa (SAST)" },
    { value: "Africa/Lagos", label: "Africa - Lagos, Nigeria (WAT)" },
    { value: "Africa/Nairobi", label: "Africa - Nairobi, Kenya (EAT)" },
    { value: "Africa/Tunis", label: "Africa - Tunis, Tunisia (CET)" },
    { value: "America/Anchorage", label: "America - Anchorage, Alaska (AKT)" },
    { value: "America/Bogota", label: "America - Bogotá, Colombia (COT)" },
    { value: "America/Buenos_Aires", label: "America - Buenos Aires, Argentina (ART)" },
    { value: "America/Caracas", label: "America - Caracas, Venezuela (VET)" },
    { value: "America/Chicago", label: "America - Chicago (Central Time)" },
    { value: "America/Denver", label: "America - Denver (Mountain Time)" },
    { value: "America/Detroit", label: "America - Detroit (Eastern Time)" },
    { value: "America/Edmonton", label: "America - Edmonton, Canada (Mountain Time)" },
    { value: "America/Halifax", label: "America - Halifax, Canada (Atlantic Time)" },
    { value: "America/Indianapolis", label: "America - Indianapolis (Eastern Time)" },
    { value: "America/Lima", label: "America - Lima, Peru (PET)" },
    { value: "America/Los_Angeles", label: "America - Los Angeles (Pacific Time)" },
    { value: "America/Mexico_City", label: "America - Mexico City (CST)" },
    { value: "America/New_York", label: "America - New York (Eastern Time)" },
    { value: "America/Phoenix", label: "America - Phoenix, Arizona (MST)" },
    { value: "America/Santiago", label: "America - Santiago, Chile (CLT)" },
    { value: "America/Sao_Paulo", label: "America - São Paulo, Brazil (BRT)" },
    { value: "America/St_Johns", label: "America - St. John's, Newfoundland" },
    { value: "America/Tijuana", label: "America - Tijuana, Mexico (PT)" },
    { value: "America/Toronto", label: "America - Toronto, Canada (Eastern Time)" },
    { value: "America/Vancouver", label: "America - Vancouver, Canada (Pacific Time)" },
    { value: "America/Winnipeg", label: "America - Winnipeg, Canada (Central Time)" },
    { value: "Asia/Almaty", label: "Asia - Almaty, Kazakhstan (ALMT)" },
    { value: "Asia/Bahrain", label: "Asia - Bahrain (AST)" },
    { value: "Asia/Bangkok", label: "Asia - Bangkok, Thailand (ICT)" },
    { value: "Asia/Colombo", label: "Asia - Colombo, Sri Lanka (IST)" },
    { value: "Asia/Dhaka", label: "Asia - Dhaka, Bangladesh (BST)" },
    { value: "Asia/Dubai", label: "Asia - Dubai, UAE (GST)" },
    { value: "Asia/Ho_Chi_Minh", label: "Asia - Ho Chi Minh, Vietnam (ICT)" },
    { value: "Asia/Hong_Kong", label: "Asia - Hong Kong (HKT)" },
    { value: "Asia/Jakarta", label: "Asia - Jakarta, Indonesia (WIB)" },
    { value: "Asia/Jerusalem", label: "Asia - Jerusalem, Israel (IST)" },
    { value: "Asia/Kabul", label: "Asia - Kabul, Afghanistan (AFT)" },
    { value: "Asia/Karachi", label: "Asia - Karachi, Pakistan (PKT)" },
    { value: "Asia/Kathmandu", label: "Asia - Kathmandu, Nepal (NPT)" },
    { value: "Asia/Kolkata", label: "Asia - Kolkata/Mumbai, India (IST)" },
    { value: "Asia/Kuala_Lumpur", label: "Asia - Kuala Lumpur, Malaysia (MYT)" },
    { value: "Asia/Kuwait", label: "Asia - Kuwait (AST)" },
    { value: "Asia/Manila", label: "Asia - Manila, Philippines (PHT)" },
    { value: "Asia/Qatar", label: "Asia - Qatar (AST)" },
    { value: "Asia/Riyadh", label: "Asia - Riyadh, Saudi Arabia (AST)" },
    { value: "Asia/Seoul", label: "Asia - Seoul, South Korea (KST)" },
    { value: "Asia/Shanghai", label: "Asia - Shanghai, China (CST)" },
    { value: "Asia/Singapore", label: "Asia - Singapore (SGT)" },
    { value: "Asia/Taipei", label: "Asia - Taipei, Taiwan (CST)" },
    { value: "Asia/Tashkent", label: "Asia - Tashkent, Uzbekistan (UZT)" },
    { value: "Asia/Tehran", label: "Asia - Tehran, Iran (IRST)" },
    { value: "Asia/Tokyo", label: "Asia - Tokyo, Japan (JST)" },
    { value: "Australia/Adelaide", label: "Australia - Adelaide (ACST)" },
    { value: "Australia/Brisbane", label: "Australia - Brisbane (AEST)" },
    { value: "Australia/Darwin", label: "Australia - Darwin (ACST)" },
    { value: "Australia/Melbourne", label: "Australia - Melbourne (AEST)" },
    { value: "Australia/Perth", label: "Australia - Perth (AWST)" },
    { value: "Australia/Sydney", label: "Australia - Sydney (AEST)" },
    { value: "Europe/Amsterdam", label: "Europe - Amsterdam, Netherlands (CET)" },
    { value: "Europe/Athens", label: "Europe - Athens, Greece (EET)" },
    { value: "Europe/Berlin", label: "Europe - Berlin, Germany (CET)" },
    { value: "Europe/Brussels", label: "Europe - Brussels, Belgium (CET)" },
    { value: "Europe/Bucharest", label: "Europe - Bucharest, Romania (EET)" },
    { value: "Europe/Budapest", label: "Europe - Budapest, Hungary (CET)" },
    { value: "Europe/Copenhagen", label: "Europe - Copenhagen, Denmark (CET)" },
    { value: "Europe/Dublin", label: "Europe - Dublin, Ireland (GMT/IST)" },
    { value: "Europe/Helsinki", label: "Europe - Helsinki, Finland (EET)" },
    { value: "Europe/Istanbul", label: "Europe - Istanbul, Turkey (TRT)" },
    { value: "Europe/Kiev", label: "Europe - Kyiv, Ukraine (EET)" },
    { value: "Europe/Lisbon", label: "Europe - Lisbon, Portugal (WET)" },
    { value: "Europe/London", label: "Europe - London, UK (GMT/BST)" },
    { value: "Europe/Madrid", label: "Europe - Madrid, Spain (CET)" },
    { value: "Europe/Moscow", label: "Europe - Moscow, Russia (MSK)" },
    { value: "Europe/Oslo", label: "Europe - Oslo, Norway (CET)" },
    { value: "Europe/Paris", label: "Europe - Paris, France (CET)" },
    { value: "Europe/Prague", label: "Europe - Prague, Czech Republic (CET)" },
    { value: "Europe/Rome", label: "Europe - Rome, Italy (CET)" },
    { value: "Europe/Stockholm", label: "Europe - Stockholm, Sweden (CET)" },
    { value: "Europe/Vienna", label: "Europe - Vienna, Austria (CET)" },
    { value: "Europe/Warsaw", label: "Europe - Warsaw, Poland (CET)" },
    { value: "Europe/Zurich", label: "Europe - Zurich, Switzerland (CET)" },
    { value: "Pacific/Auckland", label: "Pacific - Auckland, New Zealand (NZST)" },
    { value: "Pacific/Fiji", label: "Pacific - Fiji (FJT)" },
    { value: "Pacific/Guam", label: "Pacific - Guam (ChST)" },
    { value: "Pacific/Honolulu", label: "Pacific - Honolulu, Hawaii (HST)" },
    { value: "UTC", label: "UTC (Coordinated Universal Time)" },
];
