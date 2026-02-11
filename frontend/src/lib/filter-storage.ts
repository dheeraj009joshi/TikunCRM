/**
 * Persist and restore list-page filters in localStorage.
 * URL remains source of truth when present; localStorage is fallback when opening without query params.
 */

const PREFIX = "tikuncrm_filters_"

export const leadsFilterKey = PREFIX + "leads"
export const appointmentsFilterKey = PREFIX + "appointments"
export const followUpsFilterKey = PREFIX + "followups"
export const notificationsFilterKey = PREFIX + "notifications"

export type LeadsFilterState = {
  filter?: string
  status?: string
  source?: string
  view?: string
}

export type AppointmentsFilterState = {
  filter?: string
  status?: string
}

export type FollowUpsFilterState = {
  filter?: string
  status?: string
}

export type NotificationsFilterState = {
  filter?: string
  type?: string
}

function getItem<T>(key: string): T | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function setItem(key: string, value: object): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore
  }
}

export const filterStorage = {
  getLeads(): LeadsFilterState | null {
    return getItem<LeadsFilterState>(leadsFilterKey)
  },
  setLeads(state: LeadsFilterState): void {
    setItem(leadsFilterKey, state)
  },

  getAppointments(): AppointmentsFilterState | null {
    return getItem<AppointmentsFilterState>(appointmentsFilterKey)
  },
  setAppointments(state: AppointmentsFilterState): void {
    setItem(appointmentsFilterKey, state)
  },

  getFollowUps(): FollowUpsFilterState | null {
    return getItem<FollowUpsFilterState>(followUpsFilterKey)
  },
  setFollowUps(state: FollowUpsFilterState): void {
    setItem(followUpsFilterKey, state)
  },

  getNotifications(): NotificationsFilterState | null {
    return getItem<NotificationsFilterState>(notificationsFilterKey)
  },
  setNotifications(state: NotificationsFilterState): void {
    setItem(notificationsFilterKey, state)
  },
}
