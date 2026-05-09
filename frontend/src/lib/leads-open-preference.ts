/** User choice for opening a lead from the list: same tab vs new tab */
const STORAGE_KEY = "tikuncrm_leads_open_in"

export type LeadsOpenPreference = "same" | "new"

export function getStoredLeadsOpenPreference(): LeadsOpenPreference | null {
    if (typeof window === "undefined") return null
    try {
        const v = localStorage.getItem(STORAGE_KEY)
        if (v === "same" || v === "new") return v
    } catch {
        // ignore
    }
    return null
}

export function setStoredLeadsOpenPreference(mode: LeadsOpenPreference): void {
    try {
        localStorage.setItem(STORAGE_KEY, mode)
    } catch {
        // ignore
    }
}

export function clearStoredLeadsOpenPreference(): void {
    try {
        localStorage.removeItem(STORAGE_KEY)
    } catch {
        // ignore
    }
}
