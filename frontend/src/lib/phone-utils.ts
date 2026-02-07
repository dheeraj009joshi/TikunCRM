/**
 * Phone and country code utilities for lead forms.
 * Normalizes country from dealership (e.g. "United States" -> "US") and formats phone with country code.
 */

// Map country names or codes to ISO 2-letter and dial code
const COUNTRY_TO_DIAL: Record<string, { code: string; dial: string }> = {
  US: { code: "US", dial: "+1" },
  USA: { code: "US", dial: "+1" },
  "United States": { code: "US", dial: "+1" },
  "United States of America": { code: "US", dial: "+1" },
  CA: { code: "CA", dial: "+1" },
  Canada: { code: "CA", dial: "+1" },
  GB: { code: "GB", dial: "+44" },
  UK: { code: "GB", dial: "+44" },
  "United Kingdom": { code: "GB", dial: "+44" },
  IN: { code: "IN", dial: "+91" },
  India: { code: "IN", dial: "+91" },
  AU: { code: "AU", dial: "+61" },
  Australia: { code: "AU", dial: "+61" },
  DE: { code: "DE", dial: "+49" },
  Germany: { code: "DE", dial: "+49" },
  FR: { code: "FR", dial: "+33" },
  France: { code: "FR", dial: "+33" },
  MX: { code: "MX", dial: "+52" },
  Mexico: { code: "MX", dial: "+52" },
  AE: { code: "AE", dial: "+971" },
  "United Arab Emirates": { code: "AE", dial: "+971" },
  UAE: { code: "AE", dial: "+971" },
  SA: { code: "SA", dial: "+966" },
  "Saudi Arabia": { code: "SA", dial: "+966" },
  PK: { code: "PK", dial: "+92" },
  Pakistan: { code: "PK", dial: "+92" },
  NG: { code: "NG", dial: "+234" },
  Nigeria: { code: "NG", dial: "+234" },
  ZA: { code: "ZA", dial: "+27" },
  "South Africa": { code: "ZA", dial: "+27" },
  BR: { code: "BR", dial: "+55" },
  Brazil: { code: "BR", dial: "+55" },
  PH: { code: "PH", dial: "+63" },
  Philippines: { code: "PH", dial: "+63" },
  ES: { code: "ES", dial: "+34" },
  Spain: { code: "ES", dial: "+34" },
  IT: { code: "IT", dial: "+39" },
  Italy: { code: "IT", dial: "+39" },
  NL: { code: "NL", dial: "+31" },
  Netherlands: { code: "NL", dial: "+31" },
  JP: { code: "JP", dial: "+81" },
  Japan: { code: "JP", dial: "+81" },
  CN: { code: "CN", dial: "+86" },
  China: { code: "CN", dial: "+86" },
  KR: { code: "KR", dial: "+82" },
  "South Korea": { code: "KR", dial: "+82" },
  SG: { code: "SG", dial: "+65" },
  Singapore: { code: "SG", dial: "+65" },
  KE: { code: "KE", dial: "+254" },
  Kenya: { code: "KE", dial: "+254" },
  GH: { code: "GH", dial: "+233" },
  Ghana: { code: "GH", dial: "+233" },
  EG: { code: "EG", dial: "+20" },
  Egypt: { code: "EG", dial: "+20" },
}

const DEFAULT_COUNTRY = "US";
const DEFAULT_DIAL = "+1";

/** Common dial codes for country code selector (default +1, user can change) */
export const DIAL_CODE_OPTIONS: { dial: string; code: string; label: string }[] = [
  { dial: "+1", code: "US", label: "+1 (US/CA)" },
  { dial: "+44", code: "GB", label: "+44 (UK)" },
  { dial: "+91", code: "IN", label: "+91 (India)" },
  { dial: "+61", code: "AU", label: "+61 (Australia)" },
  { dial: "+49", code: "DE", label: "+49 (Germany)" },
  { dial: "+33", code: "FR", label: "+33 (France)" },
  { dial: "+52", code: "MX", label: "+52 (Mexico)" },
  { dial: "+971", code: "AE", label: "+971 (UAE)" },
  { dial: "+966", code: "SA", label: "+966 (Saudi Arabia)" },
  { dial: "+92", code: "PK", label: "+92 (Pakistan)" },
  { dial: "+234", code: "NG", label: "+234 (Nigeria)" },
  { dial: "+27", code: "ZA", label: "+27 (South Africa)" },
  { dial: "+55", code: "BR", label: "+55 (Brazil)" },
  { dial: "+63", code: "PH", label: "+63 (Philippines)" },
  { dial: "+34", code: "ES", label: "+34 (Spain)" },
  { dial: "+39", code: "IT", label: "+39 (Italy)" },
  { dial: "+31", code: "NL", label: "+31 (Netherlands)" },
  { dial: "+81", code: "JP", label: "+81 (Japan)" },
  { dial: "+86", code: "CN", label: "+86 (China)" },
  { dial: "+82", code: "KR", label: "+82 (South Korea)" },
  { dial: "+65", code: "SG", label: "+65 (Singapore)" },
  { dial: "+254", code: "KE", label: "+254 (Kenya)" },
  { dial: "+233", code: "GH", label: "+233 (Ghana)" },
  { dial: "+20", code: "EG", label: "+20 (Egypt)" },
];

/**
 * Resolve country from dealership country (e.g. "United States", "US") to ISO code and dial code.
 */
export function getCountryAndDial(dealershipCountry: string | null | undefined): { countryCode: string; dialCode: string } {
  if (!dealershipCountry || !dealershipCountry.trim()) {
    return { countryCode: DEFAULT_COUNTRY, dialCode: DEFAULT_DIAL };
  }
  const key = dealershipCountry.trim();
  const normalized = key.length === 2 ? key.toUpperCase() : key;
  const found = COUNTRY_TO_DIAL[normalized] ?? COUNTRY_TO_DIAL[key] ?? COUNTRY_TO_DIAL[key.toLowerCase()];
  if (found) return { countryCode: found.code, dialCode: found.dial };
  return { countryCode: DEFAULT_COUNTRY, dialCode: DEFAULT_DIAL };
}

/**
 * Strip phone to digits only (no + or spaces).
 */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Format a phone number for display based on country.
 * US/CA: (234) 567-8900 or +1 234 567 8900
 * IN: +91 98765 43210
 * Others: +XX XXX XXX XXXX style
 */
export function formatPhoneForDisplay(raw: string, dialCode: string): string {
  const digits = digitsOnly(raw);
  if (digits.length === 0) return "";

  // If input already starts with + and digits, use that
  const withPlus = raw.trim().startsWith("+");
  let num = digits;
  if (withPlus && digits.length > 0) {
    // Assume full international
    if (digits.length <= 3) return `+${digits}`;
    return `+${digits.slice(0, 3)} ${digits.slice(3).replace(/(\d{3})(?=\d)/g, "$1 ").trim()}`;
  }

  const dialDigits = digitsOnly(dialCode);
  // If user typed more than dial digits, assume national number
  if (num.startsWith(dialDigits)) {
    num = num.slice(dialDigits.length);
  }

  if (dialCode === "+1") {
    // US/CA: (234) 567-8900
    if (num.length <= 3) return num;
    if (num.length <= 6) return `(${num.slice(0, 3)}) ${num.slice(3)}`;
    return `(${num.slice(0, 3)}) ${num.slice(3, 6)}-${num.slice(6, 10)}`;
  }
  if (dialCode === "+91") {
    // India: 98765 43210
    if (num.length <= 5) return num;
    return `${num.slice(0, 5)} ${num.slice(5)}`;
  }
  // Generic: group in 3s
  const grouped = num.replace(/(\d{3})(?=\d)/g, "$1 ");
  return grouped;
}

/**
 * Normalize phone to E.164 for API: +1234567890
 */
export function toE164(raw: string, dialCode: string): string {
  const digits = digitsOnly(raw);
  if (digits.length === 0) return "";
  const dialDigits = digitsOnly(dialCode);
  let national = digits;
  if (digits.startsWith(dialDigits)) {
    national = digits.slice(dialDigits.length);
  }
  return `${dialCode}${national}`;
}

/**
 * When user types, keep only valid phone chars and apply display format.
 */
export function formatPhoneInput(value: string, dialCode: string): string {
  const d = digitsOnly(value);
  if (d.length === 0) return value.trim().startsWith("+") ? dialCode : "";
  return formatPhoneForDisplay(d, dialCode);
}
