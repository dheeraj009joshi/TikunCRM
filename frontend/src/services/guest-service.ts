/**
 * Guest Service - showroom guest profiles captured at appointment booking,
 * with a public QR share link.
 */
import apiClient, { API_BASE_URL } from "@/lib/api-client"
import type { EligibilityAssessment } from "@/services/eligibility-service"

const PREFIX = "/guests"

export type GuestStatus = "draft" | "ready" | "checked_in" | "completed"

export interface Guest {
    id: string
    dealership_id?: string | null
    appointment_id?: string | null
    lead_id?: string | null
    customer_id?: string | null
    created_by?: string | null
    full_name?: string | null
    phone?: string | null
    email?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
    postal_code?: string | null
    down_payment?: number | null
    vehicle_of_interest?: string | null
    trade_in?: string | null
    payoff?: number | null
    payoff_bank?: string | null
    miles?: number | null
    notes?: string | null
    share_token?: string | null
    share_revoked: boolean
    status: GuestStatus
    created_at: string
    updated_at: string
}

export interface GuestCreatePayload {
    appointment_id?: string | null
    lead_id?: string | null
    customer_id?: string | null
    dealership_id?: string | null
    full_name?: string | null
    phone?: string | null
    email?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
    postal_code?: string | null
    down_payment?: number | null
    vehicle_of_interest?: string | null
    trade_in?: string | null
    payoff?: number | null
    payoff_bank?: string | null
    miles?: number | null
    notes?: string | null
}

export type GuestUpdatePayload = Partial<GuestCreatePayload> & { status?: GuestStatus }

export interface GuestDocument {
    id: string
    category_name: string
    file_name: string
    content_type: string
    uploaded_at: string
}

export interface GuestShareResponse {
    share_token: string
    share_url: string
}

export interface GuestPublicProfile {
    full_name?: string | null
    phone?: string | null
    email?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
    postal_code?: string | null
    down_payment?: number | null
    vehicle_of_interest?: string | null
    trade_in?: string | null
    payoff?: number | null
    payoff_bank?: string | null
    miles?: number | null
    notes?: string | null
    status: GuestStatus
    dealership_name?: string | null
    appointment_at?: string | null
    eligibility?: EligibilityAssessment | null
    documents: GuestDocument[]
}

export const GuestService = {
    async create(payload: GuestCreatePayload): Promise<Guest> {
        const res = await apiClient.post(PREFIX, payload)
        return res.data
    },

    async getByLead(leadId: string): Promise<Guest> {
        const res = await apiClient.get(`${PREFIX}/by-lead/${leadId}`)
        return res.data
    },

    /** Return existing guest for a lead or create one (idempotent). */
    async getOrCreate(payload: GuestCreatePayload & { lead_id: string }): Promise<Guest> {
        return this.create(payload)
    },

    async get(id: string): Promise<Guest> {
        const res = await apiClient.get(`${PREFIX}/${id}`)
        return res.data
    },

    async update(id: string, payload: GuestUpdatePayload): Promise<Guest> {
        const res = await apiClient.put(`${PREFIX}/${id}`, payload)
        return res.data
    },

    async getDocuments(id: string): Promise<GuestDocument[]> {
        const res = await apiClient.get(`${PREFIX}/${id}/documents`)
        return res.data
    },

    async share(id: string): Promise<GuestShareResponse> {
        const res = await apiClient.post(`${PREFIX}/${id}/share`, {})
        return res.data
    },

    async revokeShare(id: string): Promise<Guest> {
        const res = await apiClient.post(`${PREFIX}/${id}/revoke-share`, {})
        return res.data
    },

    /** Public, unauthenticated fetch used by the scanned QR page. */
    async getPublic(token: string): Promise<GuestPublicProfile> {
        const res = await fetch(`${API_BASE_URL}/public/guests/${token}`, {
            headers: { "Content-Type": "application/json" },
        })
        if (!res.ok) {
            throw new Error(res.status === 404 ? "Guest profile not found" : "Failed to load guest profile")
        }
        return res.json()
    },
}
