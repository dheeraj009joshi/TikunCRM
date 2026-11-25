/**
 * Note reminders — callbacks and deadlines the AI found in a lead's notes.
 */
import apiClient from "@/lib/api-client";

export interface NoteReminder {
    id: string;
    action: string;
    /** Exact words from the note */
    quote: string;
    due_at: string;
    /** False when the note named a day but no time */
    time_given: boolean;
    overdue: boolean;
    /** A follow-up already exists within a few hours of this time */
    already_scheduled: boolean;
    assignee_user_id: string | null;
    assignee_name: string | null;
    note_author: string | null;
    note_written_at: string | null;
    source_activity_id: string | null;
    /** Other reminders due within a few hours, shown on the same card */
    also: NoteReminderBrief[];
}

export interface NoteReminderBrief {
    id: string;
    action: string;
    quote: string;
    note_author: string | null;
    note_written_at: string | null;
}

export interface NoteRemindersResponse {
    /** False when the server has no AI key */
    available: boolean;
    /** The notes changed since they were last read */
    stale: boolean;
    scanned_at: string | null;
    error: boolean;
    notes_considered: number;
    reminders: NoteReminder[];
    prompt_version: string;
}

export const NoteReminderService = {
    async list(leadId: string): Promise<NoteRemindersResponse> {
        const res = await apiClient.get<NoteRemindersResponse>(`/note-reminders/leads/${leadId}`);
        return res.data;
    },

    async scan(leadId: string, force = false): Promise<NoteRemindersResponse> {
        const res = await apiClient.post<NoteRemindersResponse>(`/note-reminders/leads/${leadId}/scan`, null, {
            params: force ? { force: true } : undefined,
        });
        return res.data;
    },

    async accept(reminderId: string, followUpId: string): Promise<void> {
        await apiClient.post(`/note-reminders/${reminderId}/accept`, { follow_up_id: followUpId });
    },

    async dismiss(reminderId: string): Promise<void> {
        await apiClient.post(`/note-reminders/${reminderId}/dismiss`);
    },
};
