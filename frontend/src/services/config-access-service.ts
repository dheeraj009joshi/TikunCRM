import apiClient from "@/lib/api-client"
import { setConfigUnlockToken } from "@/lib/config-unlock"

export interface ConfigAccessStatus {
    eligible: boolean
    config_access_password_set: boolean
}

export async function getConfigAccessStatus(): Promise<ConfigAccessStatus> {
    const response = await apiClient.get<ConfigAccessStatus>("/auth/config-access-status")
    return response.data
}

export async function verifyConfigAccess(configPassword: string): Promise<{ unlock_token: string; expires_in: number }> {
    const response = await apiClient.post<{ unlock_token: string; expires_in: number }>(
        "/auth/verify-config-access",
        { config_password: configPassword }
    )
    return response.data
}

/** Verify password and store unlock token for subsequent API calls. */
export async function verifyAndStoreConfigUnlock(configPassword: string): Promise<void> {
    const { unlock_token, expires_in } = await verifyConfigAccess(configPassword)
    setConfigUnlockToken(unlock_token, expires_in)
}

export interface SetConfigAccessPasswordBody {
    login_password: string
    config_password: string
    config_password_confirm: string
    current_config_password?: string
}

export async function setConfigAccessPassword(body: SetConfigAccessPasswordBody): Promise<void> {
    await apiClient.put("/users/me/config-access-password", body)
}
