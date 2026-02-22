/**
 * Lead Sync Source Service
 * Manages dynamic lead sync sources and campaign mappings.
 */
import apiClient from "@/lib/api-client";

const ADMIN_SYNC_PREFIX = "/admin/sync-sources";
const CAMPAIGN_MAPPINGS_PREFIX = "/campaign-mappings";

// Enums
export type SyncSourceType = "google_sheets" | "csv_upload" | "api";
export type MatchType = "exact" | "contains" | "starts_with" | "ends_with" | "regex";

// Brief types for nested responses
export interface DealershipBrief {
    id: string;
    name: string;
}

export interface UserBrief {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
}

export interface SyncSourceBrief {
    id: string;
    name: string;
    display_name: string;
}

// Campaign Mapping types
export interface CampaignMapping {
    id: string;
    sync_source_id: string;
    match_pattern: string;
    match_type: MatchType;
    display_name: string;
    dealership_id?: string | null;
    priority: number;
    is_active: boolean;
    leads_matched: number;
    created_at: string;
    updated_at: string;
    dealership?: DealershipBrief | null;
    created_by_user?: UserBrief | null;
    updated_by_user?: UserBrief | null;
    sync_source?: SyncSourceBrief | null;
}

export interface CampaignMappingCreate {
    match_pattern: string;
    match_type?: MatchType;
    display_name: string;
    dealership_id?: string | null;
    priority?: number;
    is_active?: boolean;
}

export interface CampaignMappingUpdate {
    match_pattern?: string;
    match_type?: MatchType;
    display_name?: string;
    dealership_id?: string | null;
    priority?: number;
    is_active?: boolean;
}

export interface CampaignMappingDisplayNameUpdate {
    display_name: string;
}

// Lead Sync Source types
export interface LeadSyncSource {
    id: string;
    name: string;
    display_name: string;
    source_type: SyncSourceType;
    sheet_id: string;
    sheet_gid: string;
    default_dealership_id?: string | null;
    default_campaign_display?: string | null;
    sync_interval_minutes: number;
    is_active: boolean;
    last_synced_at?: string | null;
    last_sync_lead_count: number;
    last_sync_error?: string | null;
    total_leads_synced: number;
    created_at: string;
    updated_at: string;
    default_dealership?: DealershipBrief | null;
    created_by_user?: UserBrief | null;
    campaign_mappings?: CampaignMapping[];
}

export interface LeadSyncSourceCreate {
    name: string;
    display_name: string;
    source_type?: SyncSourceType;
    sheet_id: string;
    sheet_gid?: string;
    default_dealership_id?: string | null;
    default_campaign_display?: string | null;
    sync_interval_minutes?: number;
    is_active?: boolean;
}

export interface LeadSyncSourceUpdate {
    name?: string;
    display_name?: string;
    sheet_id?: string;
    sheet_gid?: string;
    default_dealership_id?: string | null;
    default_campaign_display?: string | null;
    sync_interval_minutes?: number;
    is_active?: boolean;
}

// Preview types
export interface SheetPreviewRow {
    row_number: number;
    full_name?: string | null;
    phone?: string | null;
    email?: string | null;
    campaign_name?: string | null;
    matched_mapping?: string | null;
    target_dealership?: string | null;
}

export interface SheetPreview {
    total_rows: number;
    sample_rows: SheetPreviewRow[];
    unique_campaigns: string[];
    unmapped_campaigns: string[];
}

// Sync result (matches backend ManualSyncResponse)
export interface SyncResult {
    source_id: string;
    source_name: string;
    leads_synced: number;
    leads_updated: number;
    leads_skipped: number;
    errors: string[];
    sync_duration_seconds: number;
}

// ============== SUPER ADMIN: Sync Source CRUD ==============

export async function getSyncSources(): Promise<LeadSyncSource[]> {
    const response = await apiClient.get<{ items: LeadSyncSource[]; total: number }>(ADMIN_SYNC_PREFIX);
    return response.data.items || [];
}

export async function getSyncSource(id: string): Promise<LeadSyncSource> {
    const response = await apiClient.get<LeadSyncSource>(`${ADMIN_SYNC_PREFIX}/${id}`);
    return response.data;
}

export async function createSyncSource(data: LeadSyncSourceCreate): Promise<LeadSyncSource> {
    const response = await apiClient.post<LeadSyncSource>(ADMIN_SYNC_PREFIX, data);
    return response.data;
}

export async function updateSyncSource(id: string, data: LeadSyncSourceUpdate): Promise<LeadSyncSource> {
    const response = await apiClient.put<LeadSyncSource>(`${ADMIN_SYNC_PREFIX}/${id}`, data);
    return response.data;
}

export async function deleteSyncSource(id: string): Promise<void> {
    await apiClient.delete(`${ADMIN_SYNC_PREFIX}/${id}`);
}

export async function triggerSyncSource(id: string): Promise<SyncResult> {
    const response = await apiClient.post<SyncResult>(`${ADMIN_SYNC_PREFIX}/${id}/sync`);
    return response.data;
}

export async function getSyncSourcePreview(id: string, limit: number = 10): Promise<SheetPreview> {
    const response = await apiClient.get<SheetPreview>(`${ADMIN_SYNC_PREFIX}/${id}/preview`, {
        params: { limit },
    });
    return response.data;
}

// ============== SUPER ADMIN: Campaign Mapping CRUD ==============

export async function getSourceCampaignMappings(sourceId: string): Promise<CampaignMapping[]> {
    const response = await apiClient.get<{ items: CampaignMapping[]; total: number }>(
        `${ADMIN_SYNC_PREFIX}/${sourceId}/campaigns`
    );
    return response.data.items || [];
}

export async function createCampaignMapping(
    sourceId: string,
    data: CampaignMappingCreate
): Promise<CampaignMapping> {
    const response = await apiClient.post<CampaignMapping>(
        `${ADMIN_SYNC_PREFIX}/${sourceId}/campaigns`,
        data
    );
    return response.data;
}

export async function updateCampaignMapping(
    sourceId: string,
    mappingId: string,
    data: CampaignMappingUpdate
): Promise<CampaignMapping> {
    const response = await apiClient.put<CampaignMapping>(
        `${ADMIN_SYNC_PREFIX}/${sourceId}/campaigns/${mappingId}`,
        data
    );
    return response.data;
}

export async function deleteCampaignMapping(sourceId: string, mappingId: string): Promise<void> {
    await apiClient.delete(`${ADMIN_SYNC_PREFIX}/${sourceId}/campaigns/${mappingId}`);
}

// ============== WIZARD: Preview Sheet & Batch Create ==============

export interface SheetPreviewByUrl {
    sheet_id: string;
    sheet_gid: string;
    total_rows: number;
    unique_campaigns: string[];
    sample_rows: SheetPreviewRow[];
}

export interface CampaignMappingInput {
    match_pattern: string;
    match_type: MatchType;
    display_name: string;
    dealership_id?: string | null;
    priority?: number;
    is_active?: boolean;
}

export interface SyncSourceWithMappingsCreate {
    source: LeadSyncSourceCreate;
    campaign_mappings: CampaignMappingInput[];
}

export async function previewSheetByUrl(
    sheetUrl: string,
    sheetGid: string = "0"
): Promise<SheetPreviewByUrl> {
    const response = await apiClient.post<SheetPreviewByUrl>(
        `${ADMIN_SYNC_PREFIX}/preview-sheet`,
        { sheet_url: sheetUrl, sheet_gid: sheetGid }
    );
    return response.data;
}

export async function createSyncSourceWithMappings(
    data: SyncSourceWithMappingsCreate
): Promise<LeadSyncSource> {
    const response = await apiClient.post<LeadSyncSource>(
        `${ADMIN_SYNC_PREFIX}/with-mappings`,
        data
    );
    return response.data;
}

// ============== DEALERSHIP ADMIN/OWNER: Campaign Mapping Display Name ==============

export async function getDealershipCampaignMappings(): Promise<CampaignMapping[]> {
    const response = await apiClient.get<CampaignMapping[]>(CAMPAIGN_MAPPINGS_PREFIX);
    return response.data;
}

export async function getCampaignMapping(mappingId: string): Promise<CampaignMapping> {
    const response = await apiClient.get<CampaignMapping>(
        `${CAMPAIGN_MAPPINGS_PREFIX}/${mappingId}`
    );
    return response.data;
}

export async function updateCampaignMappingDisplayName(
    mappingId: string,
    displayName: string
): Promise<CampaignMapping> {
    const response = await apiClient.put<CampaignMapping>(
        `${CAMPAIGN_MAPPINGS_PREFIX}/${mappingId}/display-name`,
        { display_name: displayName }
    );
    return response.data;
}
