import apiClient from "@/lib/api-client"
import type {
  CreditApplication,
  CreditApplicationUpdatePayload,
} from "@/types/credit-application"

export const CreditApplicationService = {
  async get(leadId: string): Promise<CreditApplication> {
    const response = await apiClient.get<CreditApplication>(
      `/leads/${leadId}/credit-application`
    )
    return response.data
  },

  async saveDraft(
    leadId: string,
    payload: CreditApplicationUpdatePayload
  ): Promise<CreditApplication> {
    const response = await apiClient.put<CreditApplication>(
      `/leads/${leadId}/credit-application`,
      payload
    )
    return response.data
  },

  async submit(leadId: string): Promise<CreditApplication> {
    const response = await apiClient.post<CreditApplication>(
      `/leads/${leadId}/credit-application/submit`
    )
    return response.data
  },
}
