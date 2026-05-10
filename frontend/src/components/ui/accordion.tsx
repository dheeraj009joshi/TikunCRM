"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface AccordionContextValue {
  expandedItems: string[]
  toggleItem: (value: string) => void
  type: "single" | "multiple"
}

const AccordionContext = React.createContext<AccordionContextValue | undefined>(undefined)

function useAccordion() {
  const context = React.useContext(AccordionContext)
  if (!context) {
    throw new Error("useAccordion must be used within an Accordion")
  }
  return context
}

interface AccordionProps extends React.HTMLAttributes<HTMLDivElement> {
  type?: "single" | "multiple"
  collapsible?: boolean
  defaultValue?: string | string[]
  value?: string | string[]
  onValueChange?: (value: string | string[]) => void
}

const Accordion = React.forwardRef<HTMLDivElement, AccordionProps>(
  (
    {
      className,
      children,
      type = "single",
      collapsible = false,
      defaultValue,
      value,
      onValueChange,
      ...props
    },
    ref
  ) => {
    const [expandedItems, setExpandedItems] = React.useState<string[]>(() => {
      if (value !== undefined) {
        return Array.isArray(value) ? value : value ? [value] : []
      }
      if (defaultValue !== undefined) {
        return Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : []
      }
      return []
    })

    React.useEffect(() => {
      if (value !== undefined) {
        setExpandedItems(Array.isArray(value) ? value : value ? [value] : [])
      }
    }, [value])

    const toggleItem = React.useCallback(
      (itemValue: string) => {
        setExpandedItems((current) => {
          let newItems: string[]

          if (type === "single") {
            if (current.includes(itemValue)) {
              newItems = collapsible ? [] : current
            } else {
              newItems = [itemValue]
            }
          } else {
            if (current.includes(itemValue)) {
              newItems = current.filter((v) => v !== itemValue)
            } else {
              newItems = [...current, itemValue]
            }
          }

          onValueChange?.(type === "single" ? (newItems[0] || "") : newItems)
          return newItems
        })
      },
      [type, collapsible, onValueChange]
    )

    return (
      <AccordionContext.Provider value={{ expandedItems, toggleItem, type }}>
        <div ref={ref} className={cn("space-y-1", className)} {...props}>
          {children}
        </div>
      </AccordionContext.Provider>
    )
  }
)
Accordion.displayName = "Accordion"

interface AccordionItemContextValue {
  value: string
  isExpanded: boolean
}

const AccordionItemContext = React.createContext<AccordionItemContextValue | undefined>(undefined)

function useAccordionItem() {
  const context = React.useContext(AccordionItemContext)
  if (!context) {
    throw new Error("useAccordionItem must be used within an AccordionItem")
  }
  return context
}

interface AccordionItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
  disabled?: boolean
}

const AccordionItem = React.forwardRef<HTMLDivElement, AccordionItemProps>(
  ({ className, children, value, disabled = false, ...props }, ref) => {
    const { expandedItems } = useAccordion()
    const isExpanded = expandedItems.includes(value)

    return (
      <AccordionItemContext.Provider value={{ value, isExpanded }}>
        <div
          ref={ref}
          data-state={isExpanded ? "open" : "closed"}
          data-disabled={disabled ? "" : undefined}
          className={cn("border-b", className)}
          {...props}
        >
          {children}
        </div>
      </AccordionItemContext.Provider>
    )
  }
)
AccordionItem.displayName = "AccordionItem"

interface AccordionTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

const AccordionTrigger = React.forwardRef<HTMLButtonElement, AccordionTriggerProps>(
  ({ className, children, ...props }, ref) => {
    const { toggleItem } = useAccordion()
    const { value, isExpanded } = useAccordionItem()

    return (
      <button
        ref={ref}
        type="button"
        onClick={() => toggleItem(value)}
        aria-expanded={isExpanded}
        className={cn(
          "flex flex-1 w-full items-center justify-between py-4 text-sm font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180",
          className
        )}
        data-state={isExpanded ? "open" : "closed"}
        {...props}
      >
        {children}
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
      </button>
    )
  }
)
AccordionTrigger.displayName = "AccordionTrigger"

interface AccordionContentProps extends React.HTMLAttributes<HTMLDivElement> {}

const AccordionContent = React.forwardRef<HTMLDivElement, AccordionContentProps>(
  ({ className, children, ...props }, ref) => {
    const { isExpanded } = useAccordionItem()

    return (
      <div
        ref={ref}
        data-state={isExpanded ? "open" : "closed"}
        className={cn(
          "overflow-hidden text-sm",
          isExpanded ? "animate-accordion-down" : "animate-accordion-up hidden"
        )}
        {...props}
      >
        <div className={cn("pb-4 pt-0", className)}>{children}</div>
      </div>
    )
  }
)
AccordionContent.displayName = "AccordionContent"

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
