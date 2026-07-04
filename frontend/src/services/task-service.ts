/**
 * Task Service — generalized work items (Task Manager / My Day)
 */
import apiClient from "@/lib/api-client"

export type TaskType = "call" | "email" | "sms" | "whatsapp" | "appointment_prep" | "document" | "todo"
export type TaskPriority = "low" | "medium" | "high" | "urgent"
export type TaskStatus = "pending" | "completed" | "cancelled"

export interface TaskLeadBrief {
    id: string
    first_name?: string
    last_name?: string
    phone?: string
}

export interface TaskUserBrief {
    id: string
    first_name: string
    last_name: string
    email: string
}

export interface Task {
    id: string
    title: string
    description?: string
    task_type: TaskType
    priority: TaskPriority
    status: TaskStatus
    due_at?: string
    lead_id?: string
    dealership_id?: string
    assigned_to: string
    created_by?: string
    completed_at?: string
    completion_notes?: string
    created_at: string
    updated_at: string
    lead?: TaskLeadBrief
    assigned_to_user?: TaskUserBrief
}

export interface TaskCreate {
    title: string
    description?: string
    task_type?: TaskType
    priority?: TaskPriority
    due_at?: string
    lead_id?: string
    assigned_to?: string
}

export interface TaskUpdate {
    title?: string
    description?: string
    task_type?: TaskType
    priority?: TaskPriority
    status?: TaskStatus
    due_at?: string
    assigned_to?: string
    completion_notes?: string
}

export interface TaskStats {
    total: number
    pending: number
    overdue: number
    due_today: number
    completed: number
}

export interface TaskListResponse {
    items: Task[]
    total: number
    page: number
    page_size: number
    total_pages: number
    stats: TaskStats
}

export interface TaskListParams {
    page?: number
    page_size?: number
    status?: TaskStatus
    task_type?: TaskType
    priority?: TaskPriority
    lead_id?: string
    assigned_to?: string
    due_today?: boolean
    overdue?: boolean
}

export const TaskService = {
    async list(params: TaskListParams = {}): Promise<TaskListResponse> {
        const search = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== "" && value !== false) search.append(key, String(value))
        })
        const qs = search.toString()
        const response = await apiClient.get(qs ? `/tasks?${qs}` : "/tasks")
        return response.data
    },

    async create(data: TaskCreate): Promise<Task> {
        const response = await apiClient.post("/tasks", data)
        return response.data
    },

    async update(id: string, data: TaskUpdate): Promise<Task> {
        const response = await apiClient.patch(`/tasks/${id}`, data)
        return response.data
    },

    async complete(id: string, notes?: string): Promise<Task> {
        return TaskService.update(id, { status: "completed", completion_notes: notes })
    },

    async delete(id: string): Promise<void> {
        await apiClient.delete(`/tasks/${id}`)
    },
}

export const TASK_TYPE_INFO: Record<TaskType, { label: string }> = {
    call: { label: "Call" },
    email: { label: "Email" },
    sms: { label: "Text" },
    whatsapp: { label: "WhatsApp" },
    appointment_prep: { label: "Appointment prep" },
    document: { label: "Document" },
    todo: { label: "To-do" },
}

export const TASK_PRIORITY_INFO: Record<TaskPriority, { label: string; className: string }> = {
    urgent: { label: "Urgent", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
    high: { label: "High", className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
    medium: { label: "Medium", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
    low: { label: "Low", className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
}
