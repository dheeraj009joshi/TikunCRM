/**
 * Call Review Service — AI call feedback and the scoring rubric.
 */
import apiClient from "@/lib/api-client";

const PREFIX = "/call-reviews";

export type CallReviewStatus =
    | "pending"
    | "transcribing"
    | "evaluating"
    | "completed"
    | "failed"
    | "skipped";

export type AiCallOutcome =
    | "appointment_booked"
    | "follow_up_required"
    | "no_appointment"
    | "not_a_sales_conversation";

export interface RubricCriterion {
    key?: string;
    name: string;
    weight: number;
    what_good_looks_like: string;
    what_bad_looks_like: string;
}

export interface Rubric {
    id: string;
    version: number | null;
    status: "draft" | "active" | "archived";
    name: string;
    criteria: RubricCriterion[];
    guidance: string | null;
    change_note: string | null;
    published_at: string | null;
    updated_at: string | null;
    calls_scored?: number;
}

export interface RubricState {
    active: Rubric | null;
    draft: Rubric | null;
    can_edit: boolean;
}

export interface RubricDraftInput {
    name: string;
    criteria: RubricCriterion[];
    guidance: string | null;
    change_note?: string | null;
}

export interface Evidence {
    quote: string;
    timestamp_seconds: number | null;
    speaker: string | null;
}

export interface CategoryScore {
    key: string;
    name: string;
    weight: number;
    not_applicable: boolean;
    score: number | null;
    rationale: string;
    evidence: Evidence[];
}

export interface Observation {
    text: string;
    evidence: Evidence[];
}

export interface Objection {
    objection: string;
    category?: string;
    how_rep_responded: string;
    resolved: boolean;
    evidence: Evidence[];
}

export type FeedbackItemType =
    | "category"
    | "strength"
    | "improvement"
    | "missed_opportunity"
    | "objection"
    | "coaching"
    | "hidden_objection";

/** The AI's guess at the real concern the customer did not say out loud. A guess, never a fact. */
export interface HiddenObjection {
    guess: string;
    category: string;
    confidence: "low" | "medium" | "high";
    how_to_uncover: string;
    evidence: Evidence[];
    /** false when none of the clues it gave could be found in the transcript */
    supported: boolean;
}

/** What the "Fix this" tile shows, and the group Recurring issues counts it under. */
export interface TopFix {
    key: string;
    label: string;
    /** Short reason tag, e.g. "Missed the ask"; null for a plain improvement */
    tag: string | null;
    text: string;
}

export type FeedbackVerdict = "accurate" | "inaccurate" | "useful" | "not_useful";

export interface ItemFeedback {
    item_type: FeedbackItemType;
    item_key: string;
    verdict: FeedbackVerdict | null;
    corrected_score: number | null;
    note: string | null;
}

export interface FeedbackInput {
    item_type: FeedbackItemType;
    item_key: string;
    verdict?: FeedbackVerdict | null;
    corrected_score?: number | null;
    note?: string | null;
}

export interface FeedbackResult {
    feedback: ItemFeedback[];
    overall_score: number | null;
    adjusted_overall_score: number | null;
    top_fix: TopFix | null;
}

export interface ManagerReview {
    reviewed_at: string | null;
    reviewed_by: string | null;
    note: string | null;
}

export interface CallEvaluation {
    id: string;
    overall_score: number | null;
    /** Score after manager corrections; null when nothing was corrected */
    adjusted_overall_score: number | null;
    category_scores: CategoryScore[];
    ai_call_outcome: AiCallOutcome | null;
    rubric_version: number | null;
    llm_model: string;
    prompt_version: string;
    created_at: string | null;
    summary: string;
    strengths: Observation[];
    improvements: Observation[];
    missed_appointment_opportunities: Observation[];
    customer_objections: Objection[];
    coaching_suggestions: Observation[];
    /** Missing on calls reviewed before this was added; null on non-sales calls */
    hidden_objection?: HiddenObjection | null;
    top_fix?: TopFix | null;
}

export interface TranscriptLine {
    speaker: string;
    start: number;
    end: number;
    text: string;
}

export interface CallSummary {
    id: string;
    direction: "inbound" | "outbound" | null;
    started_at: string | null;
    duration_seconds: number;
    has_recording: boolean;
}

export interface CallReviewListItem {
    id: string;
    status: CallReviewStatus;
    skip_reason: string | null;
    error: string | null;
    call: CallSummary | null;
    lead_id: string | null;
    customer_name: string | null;
    rep: { id: string; name: string } | null;
    overall_score: number | null;
    score_corrected: boolean;
    manager_reviewed: boolean;
    ai_call_outcome: AiCallOutcome | null;
    rubric_version: number | null;
    has_transcript: boolean;
}

export interface CallReviewListResponse {
    items: CallReviewListItem[];
    total: number;
    page: number;
    page_size: number;
    auto_review_enabled: boolean;
    can_manage: boolean;
}

export interface UnreviewedCall {
    call: CallSummary;
    lead_id: string | null;
    customer_name: string | null;
    rep: { id: string; name: string } | null;
}

export interface CrmOutcome {
    /** null = unknown (call is not linked to a lead) */
    appointment_booked: boolean | null;
    appointment: { id: string; scheduled_at: string | null; status: string } | null;
    rep_logged_outcome: string | null;
}

export interface CallReviewDetail {
    id: string;
    status: CallReviewStatus;
    skip_reason: string | null;
    error: string | null;
    attempts: number;
    can_manage: boolean;
    call: CallSummary | null;
    lead_id: string | null;
    customer_name: string | null;
    rep: { id: string; name: string } | null;
    dealership: { id: string; name: string } | null;
    transcript: TranscriptLine[];
    transcript_provider: string | null;
    transcript_model: string | null;
    evaluation: CallEvaluation | null;
    evaluation_count: number;
    feedback: ItemFeedback[];
    manager_review: ManagerReview;
    crm_outcome: CrmOutcome | null;
}

export interface Rate {
    numerator: number;
    denominator: number;
    /** 0-1, or null when the denominator is 0 */
    rate: number | null;
}

export interface DashboardSummary {
    calls_reviewed: number;
    calls_scored: number;
    average_score: number | null;
    appointment_rate: Rate;
    calls_without_lead: number;
    show_rate: Rate;
    appointments_outcome_pending: number;
}

export interface CriterionStats {
    key: string;
    name: string;
    calls: number;
    average_score: number | null;
    low_count: number;
    high_count: number;
}

export interface GroupStats {
    id: string | null;
    name: string;
    calls_reviewed: number;
    average_score: number | null;
    appointment_rate: Rate;
}

export interface TrendPoint {
    date: string;
    calls_reviewed: number;
    average_score: number | null;
    appointment_rate: Rate;
}

export interface CallDashboard {
    summary: DashboardSummary;
    previous_summary: DashboardSummary;
    trend: { bucket: "day" | "week"; points: TrendPoint[] };
    criteria: CriterionStats[];
    common_mistakes: CriterionStats[];
    successful_behaviors: CriterionStats[];
    objections: { category: string; label: string; calls: number; unresolved: number }[];
    hidden_objections: {
        calls_with_guess: number;
        items: { category: string; label: string; calls: number; medium_or_high: number; stated_too: number }[];
    };
    missed_opportunities: { calls: number; total: number };
    by_rep: GroupStats[];
    by_dealership: GroupStats[];
    focus: { title: string; detail: string }[];
    thresholds: { low: number; high: number };
    rubric_changes: { version: number; published_at: string | null; change_note: string | null }[];
    period: { start: string; end: string; days: number; truncated: boolean };
}

export interface CallQuestionAnswer {
    id: string;
    question: string;
    days: number | null;
    asked_at: string | null;
    calls_considered: number;
    /** null when no AI was involved (for example, no reviewed calls in the period) */
    llm_model: string | null;
    answerable: boolean;
    answer: string;
    caveats: string[];
    supporting_calls: { review_id: string; date: string | null; rep: string; score: number | null }[];
    /** Figures quoted in the answer that the server could not find in the underlying data */
    unverified_figures: string[];
}

export interface RecurringRow {
    key: string;
    label: string;
    count: number;
    previous_count: number;
    by_rep: { name: string; count: number }[];
    examples: {
        review_id: string;
        date: string | null;
        rep: string;
        text: string;
        /** hidden objections only */
        confidence?: string | null;
        /** stated objections only */
        resolved?: boolean | null;
    }[];
}

/** Running record across reviewed calls: four lists, each counted by kind, most common first. */
export interface RecurringIssues {
    calls_reviewed: number;
    previous_calls_reviewed: number;
    objections: RecurringRow[];
    hidden_objections: RecurringRow[];
    went_well: RecurringRow[];
    went_badly: RecurringRow[];
    /** start is null and all_time true for the all-time view */
    period: { start: string | null; end: string; days: number; all_time: boolean; truncated: boolean };
}

export interface RubricTestResult {
    review_id: string;
    call_started_at: string | null;
    current: { overall_score: number | null; rubric_version: number | null; category_scores: CategoryScore[] } | null;
    draft: { overall_score: number | null; category_scores: CategoryScore[]; summary: string } | null;
    error: string | null;
}

export const AI_OUTCOME_LABELS: Record<AiCallOutcome, string> = {
    appointment_booked: "Appointment agreed",
    follow_up_required: "Follow-up needed",
    no_appointment: "No appointment",
    not_a_sales_conversation: "Not a sales call",
};

export const SKIP_REASON_LABELS: Record<string, string> = {
    too_short: "Call too short to review",
    too_little_speech: "Not enough conversation to review",
    voicemail: "Voicemail",
    not_answered: "Call was not answered",
    not_completed: "Call did not complete",
    no_recording: "No recording",
    ai_outbound_call: "Automated AI call",
};

/** Extract a readable message from an API error. */
export function apiErrorMessage(err: unknown, fallback: string): string {
    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    return typeof detail === "string" && detail ? detail : fallback;
}

export const CallReviewService = {
    async list(params: { page?: number; page_size?: number; status?: string } = {}): Promise<CallReviewListResponse> {
        const response = await apiClient.get(PREFIX, { params });
        return response.data;
    },

    async get(id: string): Promise<CallReviewDetail> {
        const response = await apiClient.get(`${PREFIX}/${id}`);
        return response.data;
    },

    async listUnreviewedCalls(): Promise<UnreviewedCall[]> {
        const response = await apiClient.get(`${PREFIX}/unreviewed-calls`);
        return response.data.items;
    },

    async reviewCall(callLogId: string): Promise<{ review_id: string }> {
        const response = await apiClient.post(`${PREFIX}/calls/${callLogId}/review`);
        return response.data;
    },

    async rerun(reviewId: string): Promise<void> {
        await apiClient.post(`${PREFIX}/${reviewId}/rerun`);
    },

    async saveFeedback(reviewId: string, data: FeedbackInput): Promise<FeedbackResult> {
        const response = await apiClient.put(`${PREFIX}/${reviewId}/feedback`, data);
        return response.data;
    },

    async setManagerReview(reviewId: string, reviewed: boolean, note: string | null): Promise<ManagerReview> {
        const response = await apiClient.post(`${PREFIX}/${reviewId}/manager-review`, { reviewed, note });
        return response.data;
    },

    async getDashboard(params: { days: number; rep_user_id?: string; dealership_id?: string }): Promise<CallDashboard> {
        const response = await apiClient.get(`${PREFIX}/dashboard`, { params });
        return response.data;
    },

    async ask(question: string, days: number): Promise<CallQuestionAnswer> {
        const response = await apiClient.post(`${PREFIX}/ask`, { question, days }, { timeout: 120_000 });
        return response.data;
    },

    async listQuestions(limit = 3): Promise<CallQuestionAnswer[]> {
        const response = await apiClient.get(`${PREFIX}/questions`, { params: { limit } });
        return response.data.items;
    },

    async emailReportToMe(): Promise<{ sent_to: string; calls_reviewed: number }> {
        const response = await apiClient.post(`${PREFIX}/report/send-me`);
        return response.data;
    },

    /** days = 0 for all time */
    async getRecurring(days: number): Promise<RecurringIssues> {
        const response = await apiClient.get(`${PREFIX}/recurring`, { params: { days } });
        return response.data;
    },

    async getRubric(): Promise<RubricState> {
        const response = await apiClient.get(`${PREFIX}/rubric`);
        return response.data;
    },

    async listRubricVersions(): Promise<Rubric[]> {
        const response = await apiClient.get(`${PREFIX}/rubric/versions`);
        return response.data;
    },

    async saveDraft(data: RubricDraftInput): Promise<Rubric> {
        const response = await apiClient.put(`${PREFIX}/rubric/draft`, data);
        return response.data;
    },

    async discardDraft(): Promise<void> {
        await apiClient.delete(`${PREFIX}/rubric/draft`);
    },

    async publishDraft(): Promise<Rubric> {
        const response = await apiClient.post(`${PREFIX}/rubric/draft/publish`);
        return response.data;
    },

    async testRubric(reviewIds: string[], data: RubricDraftInput): Promise<RubricTestResult[]> {
        // Each call takes the AI several seconds to score
        const response = await apiClient.post(
            `${PREFIX}/rubric/test`,
            { review_ids: reviewIds, criteria: data.criteria, guidance: data.guidance },
            { timeout: 180_000 }
        );
        return response.data.results;
    },
};
