import { create } from "zustand";

export interface SkateWarningInfo {
    skate_warning: boolean;
    assigned_to_id: string;
    assigned_to_name: string;
    lead_name: string;
    lead_id: string;
    action_type: string;
    message: string;
    mention_hint?: string;
}

interface SkateConfirmState {
    open: boolean;
    warningInfo: SkateWarningInfo | null;
    onConfirm: (() => void) | null;
    onCancel: (() => void) | null;
    show: (info: SkateWarningInfo, onConfirm: () => void, onCancel?: () => void) => void;
    confirm: () => void;
    cancel: () => void;
}

export const useSkateConfirmStore = create<SkateConfirmState>((set, get) => ({
    open: false,
    warningInfo: null,
    onConfirm: null,
    onCancel: null,
    show: (info, onConfirm, onCancel) =>
        set({
            open: true,
            warningInfo: info,
            onConfirm,
            onCancel: onCancel ?? null,
        }),
    confirm: () => {
        const { onConfirm } = get();
        if (onConfirm) {
            onConfirm();
        }
        set({ open: false, warningInfo: null, onConfirm: null, onCancel: null });
    },
    cancel: () => {
        const { onCancel } = get();
        if (onCancel) {
            onCancel();
        }
        set({ open: false, warningInfo: null, onConfirm: null, onCancel: null });
    },
}));

/**
 * Helper to check if a response contains a skate warning
 */
export function isSkateWarningResponse(data: unknown): data is SkateWarningInfo {
    return (
        typeof data === "object" &&
        data !== null &&
        "skate_warning" in data &&
        (data as Record<string, unknown>).skate_warning === true
    );
}
