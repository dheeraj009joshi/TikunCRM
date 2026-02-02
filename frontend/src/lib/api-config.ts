/**
 * API Configuration
 * Centralized configuration for API endpoints
 */

/**
 * Get the base API URL from environment variables
 * Falls back to localhost for development
 */
export function getApiUrl(): string {
    return process.env.NEXT_PUBLIC_API_URL || "https://leedsapi.tikuntech.com/api/v1";
}

/**
 * Get the full API endpoint URL
 * @param endpoint - API endpoint path (e.g., "/auth/login")
 * @returns Full URL to the endpoint
 */
export function getApiEndpoint(endpoint: string): string {
    const baseUrl = getApiUrl();
    // Remove trailing slash from base URL and leading slash from endpoint
    const cleanBase = baseUrl.replace(/\/$/, "");
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    return `${cleanBase}${cleanEndpoint}`;
}
