import type { AxiosError } from "axios"

/**
 * Human-readable message from a failed API call (FastAPI detail, validation errors, or network).
 */
export function getApiErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
    if (!error || typeof error !== "object") return fallback

    const ax = error as AxiosError<{ detail?: unknown }>
    if (ax.message === "Network Error" || ax.code === "ERR_NETWORK") {
        return (
            "Could not reach the API server. Check your internet connection, VPN, or firewall. " +
            "If the problem continues, confirm the backend at api.tikuncrm.com is up and that browser extensions are not blocking requests."
        )
    }

    const detail = ax.response?.data?.detail
    if (detail == null) {
        return typeof ax.message === "string" && ax.message.length > 0 ? ax.message : fallback
    }
    if (typeof detail === "string") return detail
    if (Array.isArray(detail)) {
        const parts = detail
            .map((d: { msg?: string; loc?: unknown[] }) => {
                const loc = Array.isArray(d.loc) ? d.loc.filter(Boolean).join(".") : ""
                return loc ? `${loc}: ${d.msg ?? ""}` : (d.msg ?? "")
            })
            .filter(Boolean)
        if (parts.length) return parts.join("; ")
    }
    if (typeof detail === "object" && detail !== null && "message" in detail) {
        const m = (detail as { message?: string }).message
        if (typeof m === "string" && m.length) return m
    }
    return fallback
}
