"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { COMMON_TIMEZONES } from "@/utils/timezone"

interface TimezonePickerProps {
    value: string
    onChange: (value: string) => void
    disabled?: boolean
    placeholder?: string
}

export function TimezonePicker({
    value,
    onChange,
    disabled = false,
    placeholder = "Select timezone..."
}: TimezonePickerProps) {
    const [open, setOpen] = React.useState(false)
    const [search, setSearch] = React.useState("")
    const inputRef = React.useRef<HTMLInputElement>(null)

    const selectedTimezone = COMMON_TIMEZONES.find(tz => tz.value === value)

    const filteredTimezones = React.useMemo(() => {
        if (!search.trim()) return COMMON_TIMEZONES
        
        const lowerSearch = search.toLowerCase()
        return COMMON_TIMEZONES.filter(tz => 
            tz.label.toLowerCase().includes(lowerSearch) ||
            tz.value.toLowerCase().includes(lowerSearch)
        )
    }, [search])

    const handleSelect = (tzValue: string) => {
        onChange(tzValue)
        setOpen(false)
        setSearch("")
    }

    React.useEffect(() => {
        if (open && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 0)
        }
    }, [open])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between font-normal"
                    disabled={disabled}
                >
                    <span className="truncate">
                        {selectedTimezone ? selectedTimezone.label : placeholder}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[400px] p-0" align="start">
                <div className="flex items-center border-b px-3 py-2">
                    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                    <Input
                        ref={inputRef}
                        placeholder="Search timezones..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="border-0 p-0 h-8 focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                </div>
                <ScrollArea className="h-[300px]">
                    {filteredTimezones.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                            No timezone found.
                        </div>
                    ) : (
                        <div className="p-1">
                            {filteredTimezones.map((tz) => (
                                <button
                                    key={tz.value}
                                    onClick={() => handleSelect(tz.value)}
                                    className={cn(
                                        "relative flex w-full cursor-pointer select-none items-center rounded-sm py-2 px-2 text-sm outline-none transition-colors",
                                        "hover:bg-accent hover:text-accent-foreground",
                                        value === tz.value && "bg-accent"
                                    )}
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4 shrink-0",
                                            value === tz.value ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    <span className="truncate">{tz.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </PopoverContent>
        </Popover>
    )
}
