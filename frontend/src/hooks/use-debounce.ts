"use client"

import { useState, useEffect } from "react"

/**
 * Hook that debounces a value by the specified delay.
 * Useful for search inputs to avoid excessive API calls.
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value)
    
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedValue(value)
        }, delay)
        
        return () => {
            clearTimeout(timer)
        }
    }, [value, delay])
    
    return debouncedValue
}
