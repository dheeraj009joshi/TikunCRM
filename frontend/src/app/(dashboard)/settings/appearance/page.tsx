"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { ArrowLeft, Palette, Sun, Moon, Monitor } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

export default function AppearanceSettingsPage() {
    const router = useRouter()
    const { theme, setTheme } = useTheme()
    const [mounted, setMounted] = React.useState(false)
    
    React.useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) {
        return null
    }

    return (
        <div className="space-y-6 max-w-2xl">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => router.push("/settings")}
                >
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold">Appearance</h1>
                    <p className="text-muted-foreground">
                        Customize the look and feel of the application
                    </p>
                </div>
            </div>
            
            {/* Theme Selection */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Palette className="h-5 w-5" />
                        Theme
                    </CardTitle>
                    <CardDescription>
                        Select your preferred color scheme
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <RadioGroup 
                        value={theme} 
                        onValueChange={setTheme}
                        className="grid grid-cols-3 gap-4"
                    >
                        <div>
                            <RadioGroupItem 
                                value="light" 
                                id="light" 
                                className="peer sr-only" 
                            />
                            <Label
                                htmlFor="light"
                                className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                            >
                                <Sun className="mb-3 h-6 w-6" />
                                <span className="text-sm font-medium">Light</span>
                            </Label>
                        </div>
                        
                        <div>
                            <RadioGroupItem 
                                value="dark" 
                                id="dark" 
                                className="peer sr-only" 
                            />
                            <Label
                                htmlFor="dark"
                                className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                            >
                                <Moon className="mb-3 h-6 w-6" />
                                <span className="text-sm font-medium">Dark</span>
                            </Label>
                        </div>
                        
                        <div>
                            <RadioGroupItem 
                                value="system" 
                                id="system" 
                                className="peer sr-only" 
                            />
                            <Label
                                htmlFor="system"
                                className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                            >
                                <Monitor className="mb-3 h-6 w-6" />
                                <span className="text-sm font-medium">System</span>
                            </Label>
                        </div>
                    </RadioGroup>
                    
                    <p className="text-sm text-muted-foreground mt-4">
                        {theme === "system" 
                            ? "The app will automatically match your system's theme preference."
                            : theme === "dark"
                            ? "Dark mode is easier on the eyes in low-light environments."
                            : "Light mode provides better visibility in bright environments."
                        }
                    </p>
                </CardContent>
            </Card>
        </div>
    )
}
