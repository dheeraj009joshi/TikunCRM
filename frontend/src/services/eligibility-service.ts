/**
 * Eligibility (Trust) Score Service - dynamic, dealership-configurable scoring
 * for leads, customers, and guests.
 */
import apiClient from "@/lib/api-client"

const PREFIX = "/eligibility"

export type EligibilityInputType = "boolean" | "number" | "select"
export type EligibilityValueSource = "manual" | "auto"
export type EligibilityEntityType = "lead" | "customer" | "guest"

export interface SelectOption {
    label: string
    value: string
    fraction: number
}

export interface CriterionConfig {
    method?: "threshold" | "scaled"
    operator?: "gte" | "lte" | "gt" | "lt" | "eq"
    threshold?: number
    min?: number
    max?: number
    direction?: "higher_better" | "lower_better"
    options?: SelectOption[]
}

export interface EligibilityCriterion {
    id: string
    dealership_id?: string | null
    key: string
    label: string
    description?: string | null
    category: string
    weight: number
    input_type: EligibilityInputType
    value_source: EligibilityValueSource
    auto_field?: string | null
    config: CriterionConfig
    display_order: number
    is_active: boolean
    created_at: string
    updated_at: string
}

export interface CriterionPayload {
    label: string
    description?: string | null
    category?: string
    weight?: number
    input_type?: EligibilityInputType
    value_source?: EligibilityValueSource
    auto_field?: string | null
    config?: CriterionConfig
    display_order?: number
    is_active?: boolean
    dealership_id?: string | null
}

export interface AssessmentItemState {
    criterion_id: string
    label: string
    description?: string | null
    category: string
    input_type: EligibilityInputType
    value_source: EligibilityValueSource
    auto_field?: string | null
    config: CriterionConfig
    weight: number
    display_order: number
    is_met: boolean
    value?: Record<string, unknown> | null
    is_override: boolean
    points: number
    auto_value?: unknown
}

export interface EligibilityAssessment {
    entity_type: EligibilityEntityType
    entity_id: string
    dealership_id?: string | null
    total_score: number
    raw_points: number
    max_points: number
    items: AssessmentItemState[]
    updated_at?: string | null
}

export interface ItemUpdatePayload {
    is_met?: boolean
    value?: Record<string, unknown> | null
    is_override?: boolean
}

export const EligibilityService = {
    async listCriteria(dealershipId?: string, activeOnly = false): Promise<EligibilityCriterion[]> {
        const params: Record<string, unknown> = {}
        if (dealershipId) params.dealership_id = dealershipId
        if (activeOnly) params.active_only = true
        const res = await apiClient.get(`${PREFIX}/criteria`, { params })
        return res.data
    },

    async createCriterion(payload: CriterionPayload): Promise<EligibilityCriterion> {
        const res = await apiClient.post(`${PREFIX}/criteria`, payload)
        return res.data
    },

    async updateCriterion(id: string, payload: Partial<CriterionPayload>): Promise<EligibilityCriterion> {
        const res = await apiClient.put(`${PREFIX}/criteria/${id}`, payload)
        return res.data
    },

    async deleteCriterion(id: string): Promise<void> {
        await apiClient.delete(`${PREFIX}/criteria/${id}`)
    },

    async reorderCriteria(orderedIds: string[]): Promise<void> {
        await apiClient.put(`${PREFIX}/criteria/reorder`, { ordered_ids: orderedIds })
    },

    async getAssessment(entityType: EligibilityEntityType, entityId: string): Promise<EligibilityAssessment> {
        const res = await apiClient.get(`${PREFIX}/assessment/${entityType}/${entityId}`)
        return res.data
    },

    async setItem(
        entityType: EligibilityEntityType,
        entityId: string,
        criterionId: string,
        payload: ItemUpdatePayload
    ): Promise<EligibilityAssessment> {
        const res = await apiClient.put(
            `${PREFIX}/assessment/${entityType}/${entityId}/items/${criterionId}`,
            payload
        )
        return res.data
    },
}

export const AUTO_FIELD_OPTIONS = [
    { value: "down_payment", label: "Down payment" },
    { value: "credit_score", label: "Credit score" },
    { value: "has_license", label: "Has driver's license" },
    { value: "distance_miles", label: "Distance to store (miles)" },
]
