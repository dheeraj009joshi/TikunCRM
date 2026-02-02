"use client"

import * as React from "react"
import { useEditor, EditorContent, Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Underline from "@tiptap/extension-underline"
import Link from "@tiptap/extension-link"
import TextAlign from "@tiptap/extension-text-align"
import Placeholder from "@tiptap/extension-placeholder"
import { TextStyle } from "@tiptap/extension-text-style"
import Color from "@tiptap/extension-color"
import {
    Bold,
    Italic,
    Underline as UnderlineIcon,
    Strikethrough,
    List,
    ListOrdered,
    AlignLeft,
    AlignCenter,
    AlignRight,
    Link as LinkIcon,
    Undo,
    Redo,
    Code,
    Quote,
    Minus,
    Type,
    Palette,
} from "lucide-react"

import { Toggle } from "@/components/ui/toggle"
import { Button } from "@/components/ui/button"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

interface RichTextEditorProps {
    content: string
    onChange: (html: string) => void
    placeholder?: string
    minHeight?: string
}

const colors = [
    { name: "Default", value: "inherit" },
    { name: "Black", value: "#000000" },
    { name: "Gray", value: "#6b7280" },
    { name: "Red", value: "#dc2626" },
    { name: "Orange", value: "#ea580c" },
    { name: "Yellow", value: "#ca8a04" },
    { name: "Green", value: "#16a34a" },
    { name: "Blue", value: "#2563eb" },
    { name: "Purple", value: "#9333ea" },
    { name: "Pink", value: "#db2777" },
]

function ToolbarButton({
    onClick,
    isActive,
    disabled,
    children,
    title,
}: {
    onClick: () => void
    isActive?: boolean
    disabled?: boolean
    children: React.ReactNode
    title: string
}) {
    return (
        <Toggle
            size="sm"
            pressed={isActive}
            onPressedChange={onClick}
            disabled={disabled}
            title={title}
            className="h-8 w-8 p-0 data-[state=on]:bg-muted"
        >
            {children}
        </Toggle>
    )
}

function EditorToolbar({ editor }: { editor: Editor | null }) {
    const [linkUrl, setLinkUrl] = React.useState("")
    const [showLinkPopover, setShowLinkPopover] = React.useState(false)

    if (!editor) return null

    const addLink = () => {
        if (linkUrl) {
            editor
                .chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href: linkUrl })
                .run()
            setLinkUrl("")
            setShowLinkPopover(false)
        }
    }

    const removeLink = () => {
        editor.chain().focus().unsetLink().run()
        setShowLinkPopover(false)
    }

    return (
        <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 p-1.5">
            {/* Undo/Redo */}
            <ToolbarButton
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
                title="Undo"
            >
                <Undo className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
                title="Redo"
            >
                <Redo className="h-4 w-4" />
            </ToolbarButton>

            <div className="mx-1 h-6 w-px bg-border" />

            {/* Text formatting */}
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleBold().run()}
                isActive={editor.isActive("bold")}
                title="Bold (Ctrl+B)"
            >
                <Bold className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleItalic().run()}
                isActive={editor.isActive("italic")}
                title="Italic (Ctrl+I)"
            >
                <Italic className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                isActive={editor.isActive("underline")}
                title="Underline (Ctrl+U)"
            >
                <UnderlineIcon className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleStrike().run()}
                isActive={editor.isActive("strike")}
                title="Strikethrough"
            >
                <Strikethrough className="h-4 w-4" />
            </ToolbarButton>

            <div className="mx-1 h-6 w-px bg-border" />

            {/* Text color */}
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Text color">
                        <Palette className="h-4 w-4" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2">
                    <div className="grid grid-cols-5 gap-1">
                        {colors.map((color) => (
                            <button
                                key={color.value}
                                onClick={() => {
                                    if (color.value === "inherit") {
                                        editor.chain().focus().unsetColor().run()
                                    } else {
                                        editor.chain().focus().setColor(color.value).run()
                                    }
                                }}
                                className="h-6 w-6 rounded border hover:scale-110 transition-transform"
                                style={{ backgroundColor: color.value === "inherit" ? "#fff" : color.value }}
                                title={color.name}
                            />
                        ))}
                    </div>
                </PopoverContent>
            </Popover>

            <div className="mx-1 h-6 w-px bg-border" />

            {/* Lists */}
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                isActive={editor.isActive("bulletList")}
                title="Bullet list"
            >
                <List className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                isActive={editor.isActive("orderedList")}
                title="Numbered list"
            >
                <ListOrdered className="h-4 w-4" />
            </ToolbarButton>

            <div className="mx-1 h-6 w-px bg-border" />

            {/* Alignment */}
            <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign("left").run()}
                isActive={editor.isActive({ textAlign: "left" })}
                title="Align left"
            >
                <AlignLeft className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign("center").run()}
                isActive={editor.isActive({ textAlign: "center" })}
                title="Align center"
            >
                <AlignCenter className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign("right").run()}
                isActive={editor.isActive({ textAlign: "right" })}
                title="Align right"
            >
                <AlignRight className="h-4 w-4" />
            </ToolbarButton>

            <div className="mx-1 h-6 w-px bg-border" />

            {/* Link */}
            <Popover open={showLinkPopover} onOpenChange={setShowLinkPopover}>
                <PopoverTrigger asChild>
                    <Toggle
                        size="sm"
                        pressed={editor.isActive("link")}
                        className="h-8 w-8 p-0 data-[state=on]:bg-muted"
                        title="Insert link"
                    >
                        <LinkIcon className="h-4 w-4" />
                    </Toggle>
                </PopoverTrigger>
                <PopoverContent className="w-80">
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label>URL</Label>
                            <Input
                                placeholder="https://example.com"
                                value={linkUrl}
                                onChange={(e) => setLinkUrl(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && addLink()}
                            />
                        </div>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={addLink}>
                                Add Link
                            </Button>
                            {editor.isActive("link") && (
                                <Button size="sm" variant="destructive" onClick={removeLink}>
                                    Remove
                                </Button>
                            )}
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            {/* Quote & Divider */}
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                isActive={editor.isActive("blockquote")}
                title="Quote"
            >
                <Quote className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().setHorizontalRule().run()}
                title="Horizontal line"
            >
                <Minus className="h-4 w-4" />
            </ToolbarButton>
        </div>
    )
}

export function RichTextEditor({
    content,
    onChange,
    placeholder = "Write your email content here...",
    minHeight = "300px",
}: RichTextEditorProps) {
    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({
                heading: {
                    levels: [1, 2, 3],
                },
            }),
            Underline,
            Link.configure({
                openOnClick: false,
                HTMLAttributes: {
                    class: "text-blue-600 underline",
                },
            }),
            TextAlign.configure({
                types: ["heading", "paragraph"],
            }),
            Placeholder.configure({
                placeholder,
            }),
            TextStyle,
            Color,
        ],
        content,
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML())
        },
        editorProps: {
            attributes: {
                class: `prose prose-sm max-w-none focus:outline-none p-4`,
                style: `min-height: ${minHeight}`,
            },
        },
    })

    // Update content when prop changes
    React.useEffect(() => {
        if (editor && content !== editor.getHTML()) {
            editor.commands.setContent(content)
        }
    }, [content, editor])

    return (
        <div className="rounded-lg border bg-background overflow-hidden">
            <EditorToolbar editor={editor} />
            <EditorContent editor={editor} />
            <style jsx global>{`
                .ProseMirror p.is-editor-empty:first-child::before {
                    color: #adb5bd;
                    content: attr(data-placeholder);
                    float: left;
                    height: 0;
                    pointer-events: none;
                }
                .ProseMirror {
                    min-height: ${minHeight};
                }
                .ProseMirror:focus {
                    outline: none;
                }
                .ProseMirror ul,
                .ProseMirror ol {
                    padding-left: 1.5rem;
                }
                .ProseMirror blockquote {
                    border-left: 3px solid #e5e7eb;
                    padding-left: 1rem;
                    margin-left: 0;
                    color: #6b7280;
                }
                .ProseMirror hr {
                    border: none;
                    border-top: 1px solid #e5e7eb;
                    margin: 1rem 0;
                }
            `}</style>
        </div>
    )
}
