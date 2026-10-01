import { API_BASE_URL } from "@/lib/api-client"

export interface AiSearchSnippet {
    activity_id?: string
    activity_type?: string
    activity_label?: string
    created_at?: string
    snippet?: string
}

export interface AiSearchLead {
    id: string
    name: string
    phone?: string | null
    email?: string | null
    stage?: string | null
    source?: string | null
    activity_count?: number | null
    reasons: string[]
    snippets: AiSearchSnippet[]
}

export interface AiSearchResponse {
    interpretation: string
    parsed_by: "ai" | "heuristic" | "none"
    total: number
    returned: number
    leads: AiSearchLead[]
}

export const AiSearchService = {
    async search(query: string, signal?: AbortSignal): Promise<AiSearchResponse> {
        const token = localStorage.getItem("auth_token")
        const res = await fetch(`${API_BASE_URL}/crm-search/ai`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ query }),
            signal,
        })
        if (!res.ok) {
            const text = await res.text().catch(() => "")
            throw new Error(text || "AI search failed")
        }
        return res.json()
    },
}
