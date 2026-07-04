"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { UserAvatar } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import apiClient from "@/lib/api-client"
import { useAuthStore } from "@/stores/auth-store"

interface MentionableUser {
    id: string
    email: string
    first_name: string
    last_name: string | null
    role: string
    is_active: boolean
    dealership_id: string | null
}

interface MentionInputProps {
    value: string
    onChange: (value: string) => void
    onMentionedUsersChange?: (userIds: string[]) => void
    placeholder?: string
    className?: string
    rows?: number
    disabled?: boolean
    onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
    dealershipId?: string | null
    leadId?: string | null
}

function getRoleLabel(role: string): string {
    switch (role) {
        case "bdc":
            return "BDC"
        case "salesperson":
            return "Sales"
        case "dealership_admin":
            return "Admin"
        case "dealership_owner":
            return "Owner"
        case "super_admin":
            return "Super Admin"
        default:
            return role.replace(/_/g, " ")
    }
}

function sortMentionableUsers(users: MentionableUser[]): MentionableUser[] {
    return [...users].sort((a, b) => {
        const aIsBdc = a.role === "bdc" ? 0 : 1
        const bIsBdc = b.role === "bdc" ? 0 : 1
        if (aIsBdc !== bIsBdc) return aIsBdc - bIsBdc
        const aName = `${a.first_name} ${a.last_name || ""}`.trim().toLowerCase()
        const bName = `${b.first_name} ${b.last_name || ""}`.trim().toLowerCase()
        return aName.localeCompare(bName)
    })
}

export function MentionInput({
    value,
    onChange,
    onMentionedUsersChange,
    placeholder = "Type your note... Use @ to mention someone",
    className,
    rows = 3,
    disabled = false,
    onKeyDown,
    dealershipId,
    leadId,
}: MentionInputProps) {
    const authDealershipId = useAuthStore((state) => state.user?.dealership_id)
    const resolvedDealershipId = dealershipId || authDealershipId || undefined

    const [mentionableUsers, setMentionableUsers] = React.useState<MentionableUser[]>([])
    const [showSuggestions, setShowSuggestions] = React.useState(false)
    const [suggestionFilter, setSuggestionFilter] = React.useState("")
    const [selectedIndex, setSelectedIndex] = React.useState(0)
    const [cursorPosition, setCursorPosition] = React.useState(0)
    const [mentionedUserIds, setMentionedUserIds] = React.useState<Set<string>>(new Set())
    
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const suggestionsRef = React.useRef<HTMLDivElement>(null)
    
    React.useEffect(() => {
        async function fetchUsers() {
            try {
                const params: Record<string, string> = {}
                if (resolvedDealershipId) params.dealership_id = resolvedDealershipId
                if (leadId) params.lead_id = leadId
                const response = await apiClient.get("/users/mentionable", {
                    params: Object.keys(params).length > 0 ? params : undefined,
                })
                setMentionableUsers(sortMentionableUsers(response.data))
            } catch (error) {
                console.error("Failed to fetch mentionable users:", error)
            }
        }
        fetchUsers()
    }, [resolvedDealershipId, leadId])
    
    const filteredUsers = React.useMemo(() => {
        const sorted = sortMentionableUsers(mentionableUsers)
        if (!suggestionFilter) return sorted.slice(0, 8)
        
        const lowerFilter = suggestionFilter.toLowerCase()
        return sorted
            .filter(user => 
                user.first_name.toLowerCase().includes(lowerFilter) ||
                (user.last_name && user.last_name.toLowerCase().includes(lowerFilter)) ||
                user.email.toLowerCase().includes(lowerFilter) ||
                getRoleLabel(user.role).toLowerCase().includes(lowerFilter)
            )
            .slice(0, 8)
    }, [mentionableUsers, suggestionFilter])
    
    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value
        const position = e.target.selectionStart || 0
        setCursorPosition(position)
        onChange(newValue)
        
        const textBeforeCursor = newValue.slice(0, position)
        const lastAtIndex = textBeforeCursor.lastIndexOf("@")
        
        if (lastAtIndex !== -1) {
            const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)
            if (!textAfterAt.includes(" ") && !textAfterAt.includes("\n")) {
                setSuggestionFilter(textAfterAt)
                setShowSuggestions(true)
                setSelectedIndex(0)
                return
            }
        }
        
        setShowSuggestions(false)
        setSuggestionFilter("")
    }
    
    const handleKeyDownInternal = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (showSuggestions && filteredUsers.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault()
                setSelectedIndex(i => Math.min(i + 1, filteredUsers.length - 1))
                return
            } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setSelectedIndex(i => Math.max(i - 1, 0))
                return
            } else if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault()
                selectUser(filteredUsers[selectedIndex])
                return
            } else if (e.key === "Escape") {
                e.preventDefault()
                setShowSuggestions(false)
                return
            }
        }
        
        if (onKeyDown) {
            onKeyDown(e)
        }
    }
    
    const selectUser = (user: MentionableUser) => {
        const textBeforeCursor = value.slice(0, cursorPosition)
        const textAfterCursor = value.slice(cursorPosition)
        
        const lastAtIndex = textBeforeCursor.lastIndexOf("@")
        if (lastAtIndex === -1) return
        
        const fullName = `${user.first_name} ${user.last_name || ""}`.trim()
        const newValue = textBeforeCursor.slice(0, lastAtIndex) + `@${fullName} ` + textAfterCursor
        
        onChange(newValue)
        
        const newMentionedIds = new Set(mentionedUserIds)
        newMentionedIds.add(user.id)
        setMentionedUserIds(newMentionedIds)
        
        if (onMentionedUsersChange) {
            onMentionedUsersChange(Array.from(newMentionedIds))
        }
        
        setShowSuggestions(false)
        setSuggestionFilter("")
        
        setTimeout(() => {
            textareaRef.current?.focus()
        }, 0)
    }
    
    React.useEffect(() => {
        const mentionPattern = /@([A-Za-z]+ [A-Za-z]+|[A-Za-z]+)/g
        const matches = value.match(mentionPattern) || []
        
        const matchedUserIds = new Set<string>()
        matches.forEach(mention => {
            const name = mention.slice(1).trim().toLowerCase()
            const user = mentionableUsers.find(u => {
                const fullName = `${u.first_name} ${u.last_name || ""}`.trim().toLowerCase()
                return fullName === name || u.first_name.toLowerCase() === name
            })
            if (user) {
                matchedUserIds.add(user.id)
            }
        })
        
        if (matchedUserIds.size !== mentionedUserIds.size || 
            !Array.from(matchedUserIds).every(id => mentionedUserIds.has(id))) {
            setMentionedUserIds(matchedUserIds)
            if (onMentionedUsersChange) {
                onMentionedUsersChange(Array.from(matchedUserIds))
            }
        }
    }, [value, mentionableUsers])
    
    return (
        <div className="relative">
            <textarea
                ref={textareaRef}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDownInternal}
                placeholder={placeholder}
                rows={rows}
                disabled={disabled}
                className={cn(
                    "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                    className
                )}
            />
            
            {showSuggestions && filteredUsers.length > 0 && (
                <div
                    ref={suggestionsRef}
                    className="absolute left-0 bottom-full z-[100] mb-1 w-full max-w-xs rounded-md border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
                >
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                        Mention a team member
                    </div>
                    {filteredUsers.map((user, index) => (
                        <button
                            key={user.id}
                            type="button"
                            onClick={() => selectUser(user)}
                            className={cn(
                                "w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors",
                                index === selectedIndex 
                                    ? "bg-accent text-accent-foreground" 
                                    : "hover:bg-accent hover:text-accent-foreground"
                            )}
                        >
                            <UserAvatar
                                firstName={user.first_name}
                                lastName={user.last_name || undefined}
                                size="sm"
                            />
                            <div className="flex-1 text-left min-w-0">
                                <div className="font-medium truncate">
                                    {user.first_name} {user.last_name || ""}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                    {user.email}
                                </div>
                            </div>
                            <Badge variant="secondary" size="sm" className="shrink-0 text-[10px]">
                                {getRoleLabel(user.role)}
                            </Badge>
                        </button>
                    ))}
                    <div className="border-t mt-1 pt-1 px-2 py-1 text-xs text-muted-foreground">
                        ↑↓ to navigate, Enter to select, Esc to close
                    </div>
                </div>
            )}
            
            {mentionedUserIds.size > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                    {mentionedUserIds.size} user{mentionedUserIds.size > 1 ? "s" : ""} will be notified
                </div>
            )}
        </div>
    )
}
