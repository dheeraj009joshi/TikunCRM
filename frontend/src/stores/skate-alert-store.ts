import { create } from "zustand";
import type { SkateAttemptDetail } from "@/lib/skate-alert";

interface SkateAlertState {
    open: boolean;
    message: string;
    assignedToName: string | null;
    show: (detail: SkateAttemptDetail) => void;
    close: () => void;
}

export const useSkateAlertStore = create<SkateAlertState>((set) => ({
    open: false,
    message: "",
    assignedToName: null,
    show: (detail) =>
        set({
            open: true,
            message: detail.message,
            assignedToName: detail.assigned_to_name ?? null,
        }),
    close: () => set({ open: false }),
}));
