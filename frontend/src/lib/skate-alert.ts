import { AxiosError } from "axios";

export interface SkateAttemptDetail {
    message: string;
    assigned_to_name?: string;
}

/**
 * Returns the SKATE_ATTEMPT payload from an API error if present.
 * Backend returns 403 with detail: { code: "SKATE_ATTEMPT", message: "...", assigned_to_name: "..." }
 */
export function getSkateAttemptDetail(error: unknown): SkateAttemptDetail | null {
    const err = error as AxiosError<{ detail?: { code?: string; message?: string; assigned_to_name?: string } }>;
    const detail = err.response?.data?.detail;
    if (err.response?.status === 403 && detail && typeof detail === "object" && detail.code === "SKATE_ATTEMPT") {
        return {
            message: detail.message ?? "This lead is assigned to another team member.",
            assigned_to_name: detail.assigned_to_name,
        };
    }
    return null;
}
