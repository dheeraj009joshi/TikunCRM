/**
 * Short-lived config-unlock JWT for X-Config-Unlock-Token (sessionStorage, tab-scoped).
 */
const TOKEN_KEY = "config_unlock_token"
const EXP_KEY = "config_unlock_expires_at"

export function setConfigUnlockToken(token: string, expiresInSeconds: number): void {
    if (typeof window === "undefined") return
    sessionStorage.setItem(TOKEN_KEY, token)
    sessionStorage.setItem(EXP_KEY, String(Date.now() + expiresInSeconds * 1000))
}

export function getConfigUnlockToken(): string | null {
    if (typeof window === "undefined") return null
    const exp = sessionStorage.getItem(EXP_KEY)
    if (!exp || Date.now() > Number(exp)) {
        clearConfigUnlockToken()
        return null
    }
    return sessionStorage.getItem(TOKEN_KEY)
}

export function clearConfigUnlockToken(): void {
    if (typeof window === "undefined") return
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(EXP_KEY)
}
