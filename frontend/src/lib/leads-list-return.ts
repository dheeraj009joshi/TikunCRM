/**
 * Remember the last leads list URL (path + query) so "Back to Leads" returns to the same
 * tab, filters, and page — not a bare /leads.
 */
const STORAGE_KEY = "tikuncrm_leads_list_return"

export function rememberLeadsListLocation(): void {
    if (typeof window === "undefined") return
    try {
        const full = window.location.pathname + window.location.search
        if (full.startsWith("/leads") && !full.startsWith("/leads/")) {
            sessionStorage.setItem(STORAGE_KEY, full)
        }
    } catch {
        // ignore
    }
}

export function getLeadsListReturnHref(): string {
    if (typeof window === "undefined") return "/leads"
    try {
        const r = sessionStorage.getItem(STORAGE_KEY)
        if (r && r.startsWith("/leads") && !r.startsWith("/leads/")) {
            return r
        }
    } catch {
        // ignore
    }
    return "/leads"
}
