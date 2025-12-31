"use client"

import React, { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { ArrowLeft, ChevronDown, ChevronUp, Sparkles, Loader2, Mail, User, Link as LinkIcon, Image as ImageIcon, Paperclip, Code, Bold, Italic, Underline, Strikethrough, List, ListOrdered, Quote, AlignLeft, AlignCenter, AlignRight, Highlighter, Type } from "lucide-react"
import { EmailContentViewer } from "@/components/email-content-viewer"

const toPlainText = (html: string) => {
  if (!html) return ""
  const tmp = typeof window !== "undefined" ? document.createElement("div") : null
  if (!tmp) return html
  tmp.innerHTML = html
  return tmp.textContent || tmp.innerText || ""
}

const textToHtml = (text: string) => {
  if (!text) return ""
  return text
    .split(/\n{2,}/)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join("")
}

const applyCommand = (command: string, value?: string) => {
  if (typeof document === "undefined") return
  document.execCommand(command, false, value)
}

interface EmailDetailProps {
  emailId: string
  onDraftGenerated?: () => void
  onBack?: () => void
  onToggleShopify?: (email: string) => void
  showShopifySidebar?: boolean
  ticketId?: string | null
  hideCloseButton?: boolean // Hide Send & Close button (for inbox view)
  // Optional initial email data for instant display
  initialEmailData?: {
    subject?: string
    from?: string
    to?: string
    date?: string
    snippet?: string
    body?: string
    threadId?: string
  }
}

interface EmailMessage {
  id: string
  threadId?: string
  subject: string
  from: string
  to: string
  date: string
  body: string
  snippet?: string
  labels?: string[]
  attachments?: { id: string; filename: string; mimeType: string; size: number }[]
}

interface EmailSummary {
  id: string
  threadId?: string
  subject: string
  from: string
  to: string
  date: string
  body: string
  snippet?: string
  attachments?: { id: string; filename: string; mimeType: string; size: number }[]
}

const cleanSnippet = (text: string) => {
  if (!text) return ""
  // Strip common HTML/CSS patterns that often appear in snippets
  return text
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[a-z0-9\\:-]+\*?\s*{[^}]*}/gi, '') // Remove CSS rules (including v:*)
    .replace(/v\\?:[^*]*{[^}]*}/gi, '') // VML tags
    .replace(/o\\?:[^*]*{[^}]*}/gi, '')
    .replace(/w\\?:[^*]*{[^}]*}/gi, '')
    .replace(/\.shape\s*{[^}]*}/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function EmailDetail({ emailId, onDraftGenerated, onBack, initialEmailData, onToggleShopify, showShopifySidebar, ticketId, hideCloseButton }: EmailDetailProps) {
  const [threadMessages, setThreadMessages] = useState<EmailMessage[]>([])
  const [emailSummary, setEmailSummary] = useState<EmailSummary | null>(
    initialEmailData ? {
      id: emailId,
      threadId: initialEmailData.threadId,
      subject: initialEmailData.subject || '',
      from: initialEmailData.from || '',
      to: initialEmailData.to || '',
      date: initialEmailData.date || '',
      body: initialEmailData.body || initialEmailData.snippet || '',
      snippet: initialEmailData.snippet,
    } : null
  )
  const [loading, setLoading] = useState(!initialEmailData) // Don't show loading if we have initial data
  const [loadingFullContent, setLoadingFullContent] = useState(false)
  const [showDraft, setShowDraft] = useState(false)
  const [draftMinimized, setDraftMinimized] = useState(false)
  const [draftText, setDraftText] = useState("")
  const [draftId, setDraftId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendingAction, setSendingAction] = useState<'send' | 'send-close' | null>(null)
  const [copied, setCopied] = useState(false)
  const [sendSuccess, setSendSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()
  const [sendResetTimer, setSendResetTimer] = useState<NodeJS.Timeout | null>(null)
  const [conversationSummary, setConversationSummary] = useState<string>("")
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [autoSaving, setAutoSaving] = useState(false)
  const [draftHtml, setDraftHtml] = useState("")
  const editorRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const [attachments, setAttachments] = useState<{ id: string; name: string; type: string; size: number; data: string }[]>([])
  const [linkInputOpen, setLinkInputOpen] = useState(false)
  const [linkInputValue, setLinkInputValue] = useState("")
  const [linkTextValue, setLinkTextValue] = useState("")
  const [linkHasSelection, setLinkHasSelection] = useState(false)
  const [linkDialogPosition, setLinkDialogPosition] = useState<{ top: number; left: number } | null>(null)
  const linkDialogRef = useRef<HTMLDivElement | null>(null)
  const draftAutoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Get current user ID for auto-assignment
  useEffect(() => {
    fetch('/api/users/me')
      .then(r => r.json())
      .then(data => setCurrentUserId(data?.id || null))
      .catch(() => setCurrentUserId(null))
  }, [])

  // Auto-scroll to top when emailId changes
  useEffect(() => {
    // Find the scrollable container - in this layout it's likely the Card content or the window/main area depending on layout
    // Given the structure, we can try to scroll the Card's content area if it has a ref, or just the window
    // But looking at the layout, it seems the page scrolls. Let's try window scroll and also try to find a main scroll area.
    window.scrollTo(0, 0);

    // Also try to scroll the specific container if it exists
    const mainContent = document.querySelector('.overflow-y-auto');
    if (mainContent) {
      mainContent.scrollTop = 0;
    }
  }, [emailId]);

  useEffect(() => {
    return () => {
      if (sendResetTimer) {
        clearTimeout(sendResetTimer)
      }
      if (draftAutoSaveTimerRef.current) {
        clearTimeout(draftAutoSaveTimerRef.current)
      }
    }
  }, [sendResetTimer])

  // Close link dialog on outside click
  useEffect(() => {
    if (!linkInputOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (linkDialogRef.current && !linkDialogRef.current.contains(e.target as Node)) {
        setLinkInputOpen(false)
        setLinkInputValue("")
        setLinkTextValue("")
        setLinkDialogPosition(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [linkInputOpen])

  // Autosave draft HTML to localStorage
  useEffect(() => {
    if (!emailId || !draftHtml || !showDraft) return

    if (draftAutoSaveTimerRef.current) {
      clearTimeout(draftAutoSaveTimerRef.current)
    }

    draftAutoSaveTimerRef.current = setTimeout(() => {
      try {
        setAutoSaving(true)
        localStorage.setItem(`draft_${emailId}`, JSON.stringify({ html: draftHtml }))
        setTimeout(() => setAutoSaving(false), 500)
      } catch {
        // Ignore localStorage errors
      }
    }, 1000)

    return () => {
      if (draftAutoSaveTimerRef.current) {
        clearTimeout(draftAutoSaveTimerRef.current)
      }
    }
  }, [draftHtml, emailId, showDraft])

  useEffect(() => {
    if (emailId) {
      // CRITICAL UX FIX: Clear previous email content immediately
      setThreadMessages([])
      setEmailSummary(null)

      // Reset draft/UI state whenever user selects a new email
      setShowDraft(false)
      setDraftMinimized(false)
      setDraftText("")
      setDraftHtml("")
      setDraftId(null)
      setCopied(false)
      setGenerating(false)
      setError(null)
      setConversationSummary("")
      setSummaryExpanded(false)

      // Try to load autosaved draft from localStorage
      try {
        const saved = localStorage.getItem(`draft_${emailId}`)
        if (saved && !draftHtml) {
          const parsed = JSON.parse(saved)
          if (parsed?.html) {
            setDraftHtml(parsed.html)
            setDraftText(toPlainText(parsed.html))
          }
        }
      } catch {
        // Ignore localStorage errors
      }

      // Set initial email data immediately if provided
      if (initialEmailData) {
        setEmailSummary({
          id: emailId,
          threadId: initialEmailData.threadId,
          subject: initialEmailData.subject || '',
          from: initialEmailData.from || '',
          to: initialEmailData.to || '',
          date: initialEmailData.date || '',
          body: initialEmailData.body || initialEmailData.snippet || '',
          snippet: initialEmailData.snippet,
        })
        // Show initial message if we have snippet/body
        if (initialEmailData.snippet || initialEmailData.body) {
          setThreadMessages([{
            id: emailId,
            threadId: initialEmailData.threadId,
            subject: initialEmailData.subject || '',
            from: initialEmailData.from || '',
            to: initialEmailData.to || '',
            date: initialEmailData.date || '',
            body: initialEmailData.body || initialEmailData.snippet || '',
            snippet: initialEmailData.snippet,
          }])
        }
        setLoading(false)
        setLoadingFullContent(true) // Show subtle indicator that we're loading full content
      } else {
        setEmailSummary(null)
        setThreadMessages([])
        setLoading(true)
        setLoadingFullContent(false)
      }

      fetchThread()
    }
  }, [emailId, initialEmailData])

  const fetchThread = async () => {
    try {
      if (!initialEmailData) {
        setLoading(true)
      }
      // Don't clear error if we have content showing - it causes the UI glitch
      if (!initialEmailData && !emailSummary) {
        setError(null)
      }

      // OPTIMIZED: Fetch email and thread in parallel for faster loading
      // Use initial threadId if available, otherwise fetch email first
      const initialThreadId = initialEmailData?.threadId || emailId

      // Fetch both email and thread in parallel
      const [emailResponse, threadResponse] = await Promise.all([
        fetch(`/api/emails/${emailId}`).catch(() => ({ ok: false, status: 500 })),
        fetch(`/api/emails/threads/${encodeURIComponent(initialThreadId)}`).catch(() => ({ ok: false, status: 500 }))
      ])

      // Process email response
      if (emailResponse.ok) {
        try {
          const emailData = await (emailResponse as Response).json()
          const email: EmailSummary = emailData.email
          setEmailSummary(email)
          setError(null) // Clear any previous errors on success
        } catch (e) {
          // Ignore JSON parse errors, thread will have the data
        }
      }

      // Process thread response (this is what we really need)
      if (threadResponse.ok) {
        try {
          const threadData = await (threadResponse as Response).json()
          const messages = threadData.thread?.messages || []
          setThreadMessages(messages)
          setError(null) // Clear error on successful load

          // Update emailSummary from first message if we don't have it
          if (messages.length > 0 && !emailSummary) {
            const firstMessage = messages[0]
            setEmailSummary({
              id: firstMessage.id,
              threadId: firstMessage.threadId,
              subject: firstMessage.subject,
              from: firstMessage.from,
              to: firstMessage.to,
              date: firstMessage.date,
              body: firstMessage.body,
              snippet: firstMessage.snippet,
            })
          }
        } catch (e) {
          console.error('Error parsing thread data:', e)
        }
      } else {
        // If thread fetch failed, try with email's threadId
        if (emailResponse.ok) {
          try {
            const emailData = await (emailResponse as Response).json()
            const email: EmailSummary = emailData.email
            const threadId = email.threadId || email.id

            if (threadId !== initialThreadId) {
              // Retry with correct threadId
              const retryResponse = await fetch(`/api/emails/threads/${encodeURIComponent(threadId)}`)
              if (retryResponse.ok) {
                const threadData = await retryResponse.json()
                setThreadMessages(threadData.thread?.messages || [])
                setEmailSummary(email)
                setError(null)
              } else if (!initialEmailData) {
                // Only set error if we have nothing to show
                setError("Conversation not found")
              }
            } else if (!initialEmailData) {
              setError("Conversation not found")
            }
          } catch (e) {
            if (!initialEmailData) {
              setError("Failed to load conversation")
            }
          }
        } else if (!initialEmailData) {
          // Only set error if we have no content at all
          setError("Failed to load email")
        }
      }
    } catch (err) {
      // Only set error if we have no content showing
      if (!initialEmailData && !emailSummary) {
        setError(err instanceof Error ? err.message : 'Failed to load email')
      }
      console.error('Error fetching email:', err)
    } finally {
      setLoading(false)
      setLoadingFullContent(false)
    }
  }

  const handleGenerateDraft = async () => {
    if (!emailId) return

    try {
      setGenerating(true)
      setError(null)
      const response = await fetch(`/api/emails/${emailId}/draft`, {
        method: 'POST'
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to generate draft')
      }

      const data = await response.json()
      const regenerated = data.draft || ''
      setDraftText(regenerated)
      setDraftHtml(textToHtml(regenerated))
      setDraftId(data.draftId || null)
      setShowDraft(true)
      onDraftGenerated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate draft')
      console.error('Error generating draft:', err)
    } finally {
      setGenerating(false)
    }
  }

  const handleCopy = () => {
    const text = draftHtml ? toPlainText(draftHtml) : draftText
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRegenerate = async () => {
    if (!emailId) return

    try {
      setGenerating(true)
      setError(null)
      const response = await fetch(`/api/emails/${emailId}/draft?regenerate=true`, {
        method: 'POST'
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to regenerate draft')
      }

      const data = await response.json()
      const regenerated = data.draft || ''
      // Replace entire draft: both text and HTML, regardless of current edits
      setDraftHtml(textToHtml(regenerated))
      setDraftText(regenerated)
      setDraftId(data.draftId || null)
      setShowDraft(true)
      onDraftGenerated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate draft')
      console.error('Error regenerating draft:', err)
    } finally {
      setGenerating(false)
    }
  }

  const handleSendReply = async (opts?: { closeTicket?: boolean }) => {
    if (!emailId) return
    if (sending) return // Prevent double-submit

    const htmlValue = draftHtml || editorRef.current?.innerHTML || ""
    const textValue = draftText || toPlainText(htmlValue)

    if (!textValue.trim() && !htmlValue.trim()) {
      setError("Draft is empty. Please edit it before sending.")
      return
    }

    setSendSuccess(false)

    try {
      setSending(true)
      setSendingAction(opts?.closeTicket ? 'send-close' : 'send')
      setError(null)

      const response = await fetch(`/api/emails/${emailId}/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          draftText: textValue,
          draftHtml: htmlValue,
          draftId: draftId || null,
          attachments: attachments.map(att => ({ filename: att.name, mimeType: att.type, data: att.data })),
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to send reply")
      }

      setSendSuccess(true)

      // Add sent message to thread immediately (optimistic UI update)
      // Get the user's email from the first message's 'to' field (since it was sent to us)
      const userEmail = threadMessages[0]?.to || emailSummary?.to || 'You'
      const newMessage: EmailMessage = {
        id: `sent-${Date.now()}`,
        threadId: emailSummary?.threadId,
        subject: emailSummary?.subject || '(No subject)',
        from: userEmail, // Your email
        to: emailSummary?.from || '', // Recipient
        date: new Date().toISOString(),
        body: htmlValue,
        snippet: textValue.substring(0, 100)
      }
      setThreadMessages(prev => [...prev, newMessage])

      // Clear draft UI and autosaved data after successful send
      try {
        localStorage.removeItem(`draft_${emailId}`)
      } catch {
        // Ignore localStorage errors
      }
      setDraftText("")
      setDraftHtml("")
      setDraftId(null)
      setShowDraft(false)
      setDraftMinimized(false)

      if (sendResetTimer) {
        clearTimeout(sendResetTimer)
      }
      setSendResetTimer(
        setTimeout(() => {
          setSendSuccess(false)
          setSendResetTimer(null)
        }, 5000) // Show success for 5 seconds instead of 3
      )

      toast({
        title: "Reply sent",
        description: "Your reply was delivered via Gmail.",
      })

      // If closeTicket option is set and we have a ticketId, assign and close it
      if (opts?.closeTicket && ticketId && currentUserId) {
        console.log('🎫 Starting Send & Close for ticket:', ticketId, 'user:', currentUserId)

        // Execute assign and close sequentially - wait for completion
        try {
          // Step 1: Assign the ticket
          console.log('📝 Step 1: Assigning ticket to user...')
          const assignResponse = await fetch(`/api/tickets/${ticketId}/assign`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assigneeUserId: currentUserId }),
          })

          console.log('📝 Assign response status:', assignResponse.status)

          if (!assignResponse.ok) {
            const error = await assignResponse.json().catch(() => ({}))
            console.error('❌ Failed to assign ticket:', error)
            throw new Error(error.error || 'Failed to assign ticket')
          }

          const assignResult = await assignResponse.json()
          console.log('✅ Ticket assigned successfully:', assignResult)

          // Step 2: Close the ticket
          console.log('🔒 Step 2: Closing ticket...')
          const closeResponse = await fetch(`/api/tickets/${ticketId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'closed' }),
          })

          console.log('🔒 Close response status:', closeResponse.status)

          if (!closeResponse.ok) {
            const error = await closeResponse.json().catch(() => ({}))
            console.error('❌ Failed to close ticket:', error)
            throw new Error(error.error || 'Failed to close ticket')
          }

          const closeResult = await closeResponse.json()
          console.log('✅ Ticket closed successfully:', closeResult)

          // Step 3: Broadcast event to refresh tickets page
          console.log('📢 Broadcasting ticket update event...')
          console.log('📦 Event detail:', { ticketId, status: 'closed', assigneeUserId: currentUserId })
          window.dispatchEvent(new CustomEvent('ticketUpdated', {
            detail: { ticketId, status: 'closed', assigneeUserId: currentUserId }
          }))
          // Also fire a simpler refresh event for listeners
          window.dispatchEvent(new Event('ticketsForceRefresh'))
          console.log('✅ Events dispatched - ticketUpdated and ticketsForceRefresh')
          console.log('✅ Send & Close completed successfully!')

          // Show success toast
          toast({
            title: "Ticket closed",
            description: "Ticket has been assigned to you and closed",
          })

        } catch (error) {
          console.error('❌ Error in Send & Close:', error)
          toast({
            title: "Ticket update failed",
            description: error instanceof Error ? error.message : "Failed to update ticket",
            variant: "destructive",
          })
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send reply"
      setError(message)
      setSendSuccess(false)
      toast({
        title: "Couldn't send reply",
        description: message,
        variant: "destructive",
      })
    } finally {
      setSending(false)
      setSendingAction(null)
    }
  }

  const handleEditorInput = () => {
    const html = editorRef.current?.innerHTML || ""
    setDraftHtml(html)
    setDraftText(toPlainText(html))
  }

  const execAndSync = (fn: () => void) => {
    fn()
    handleEditorInput()
  }

  const makeListFromSelection = (ordered: boolean) => {
    if (typeof window === 'undefined' || !editorRef.current) {
      execAndSync(() => applyCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList'))
      return
    }
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) {
      execAndSync(() => applyCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList'))
      return
    }
    const range = sel.getRangeAt(0)
    if (range.collapsed) {
      execAndSync(() => applyCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList'))
      return
    }
    // If selection spans partial text, extract and insert as its own list item
    const frag = range.extractContents()
    const list = document.createElement(ordered ? 'ol' : 'ul')
    const li = document.createElement('li')
    li.appendChild(frag)
    list.appendChild(li)
    range.insertNode(list)
    // Place caret after the inserted list
    sel.removeAllRanges()
    const after = document.createTextNode(' ')
    list.parentNode?.insertBefore(after, list.nextSibling)
    const newRange = document.createRange()
    newRange.setStartAfter(list)
    newRange.collapse(true)
    sel.addRange(newRange)
    handleEditorInput()
  }

  // Sync external HTML into the editor without breaking selection; only touch DOM when content actually changes
  useEffect(() => {
    if (!editorRef.current) return
    const html = draftHtml || textToHtml(draftText)
    const current = editorRef.current.innerHTML
    if (html && current !== html) {
      editorRef.current.innerHTML = html
    }
    if (!html && current !== '') {
      editorRef.current.innerHTML = ''
    }
  }, [draftHtml, draftText])

  const handleEditorShortcut = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); execAndSync(() => applyCommand('bold')); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); execAndSync(() => applyCommand('italic')); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') { e.preventDefault(); execAndSync(() => applyCommand('underline')); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); handleInsertLink(); return }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); execAndSync(() => document.execCommand('undo')); return }
    if ((e.ctrlKey || e.metaKey) && (e.shiftKey || e.key.toLowerCase() === 'y')) { e.preventDefault(); execAndSync(() => document.execCommand('redo')); return }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') { /* native paste as plain text in many browsers */ return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSendReply(); return }
    // Gmail-like: Ctrl+Shift+8 bullets, Ctrl+Shift+7 numbers, Ctrl+Shift+9 quote
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      const key = e.key
      if (key === '8') { e.preventDefault(); makeListFromSelection(false); return }
      if (key === '7') { e.preventDefault(); makeListFromSelection(true); return }
      if (key === '9') { e.preventDefault(); toggleBlockquote(); return }
      const lower = e.key.toLowerCase()
      if (lower === 'l') { e.preventDefault(); makeListFromSelection(false); return }
      if (lower === 'e') { e.preventDefault(); execAndSync(() => applyCommand('outdent')); return }
      if (lower === 'o') { e.preventDefault(); execAndSync(() => applyCommand('indent')); return }
      // Do not preventDefault for other Ctrl+Shift combos to allow native selection (e.g., Ctrl+Shift+Arrow)
    }
  }

  const toggleBlockquote = () => {
    if (typeof window === 'undefined') return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return

    const range = sel.getRangeAt(0)
    let node = range.commonAncestorContainer as Node

    // If it's a text node, get its parent element
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentNode as Node
    }

    // Check if we're inside a blockquote
    const inQuote = !!(node as HTMLElement).closest?.('blockquote')

    execAndSync(() => {
      if (inQuote) {
        // Remove blockquote by converting to paragraph
        applyCommand('formatBlock', 'p')
      } else {
        // Apply blockquote
        applyCommand('formatBlock', 'blockquote')
      }
    })
  }

  const toggleHeading = () => {
    if (typeof window === 'undefined') return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return

    const range = sel.getRangeAt(0)
    let node = range.commonAncestorContainer as Node

    // If it's a text node, get its parent element
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentNode as Node
    }

    // Check if we're inside an h2
    const inHeading = !!(node as HTMLElement).closest?.('h2')

    execAndSync(() => {
      if (inHeading) {
        // Remove heading by converting to paragraph
        applyCommand('formatBlock', 'p')
      } else {
        // Apply heading
        applyCommand('formatBlock', 'h2')
      }
    })
  }

  const [savedRange, setSavedRange] = React.useState<Range | null>(null)

  const handleInsertLink = () => {
    if (typeof window === 'undefined') return

    const sel = window.getSelection()
    if (!sel) return

    // Ensure we have a range (create one at cursor if needed)
    let range: Range
    if (sel.rangeCount > 0) {
      range = sel.getRangeAt(0)
    } else {
      // Create a range at the end of the editor if no selection
      range = document.createRange()
      if (editorRef.current) {
        range.selectNodeContents(editorRef.current)
        range.collapse(false)
      }
    }

    // Save the range
    setSavedRange(range.cloneRange())

    // Get position to show dialog above it
    const rect = range.getBoundingClientRect()
    const editorRect = editorRef.current?.getBoundingClientRect()

    if (editorRect) {
      // Position dialog above the selection/cursor, relative to editor
      const topPos = rect.top - editorRect.top - 80 // 80px above
      const leftPos = rect.left - editorRect.left

      setLinkDialogPosition({
        top: Math.max(10, topPos), // Don't go above editor
        left: Math.max(10, leftPos)
      })
    }

    // Check if text is selected
    const hasSelection = !range.collapsed
    const selectedText = hasSelection ? sel.toString().trim() : ""

    setLinkTextValue(selectedText)
    setLinkHasSelection(hasSelection)
    setLinkInputOpen(true)

    setTimeout(() => {
      const el = document.getElementById('link-input-inline') as HTMLInputElement | null
      el?.focus()
    }, 50)
  }

  const applyLink = () => {
    const url = linkInputValue.trim()
    if (!url) {
      setLinkInputOpen(false)
      setLinkInputValue("")
      setLinkTextValue("")
      setSavedRange(null)
      setLinkDialogPosition(null)
      return
    }

    if (typeof window === 'undefined' || !savedRange) return

    // Focus the editor first
    editorRef.current?.focus()

    // Restore the saved selection range
    const sel = window.getSelection()
    if (sel) {
      sel.removeAllRanges()
      sel.addRange(savedRange)
    }

    setTimeout(() => {
      execAndSync(() => {
        if (linkHasSelection) {
          // If text was selected, wrap it with a link
          const link = document.createElement('a')
          link.href = url
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          link.textContent = linkTextValue

          const range = savedRange
          if (range) {
            range.deleteContents()
            range.insertNode(link)
            // Add space after link
            const space = document.createTextNode('\u00A0')
            if (link.parentNode) {
              link.parentNode.insertBefore(space, link.nextSibling)
              // Move cursor after the space
              range.setStartAfter(space)
              range.setEndAfter(space)
              sel?.removeAllRanges()
              sel?.addRange(range)
            }
          }
        } else {
          // No text selected, insert new link with custom or URL text
          const displayText = linkTextValue.trim() || url
          const link = document.createElement('a')
          link.href = url
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          link.textContent = displayText

          const range = savedRange
          if (range) {
            range.insertNode(link)
            // Add space after link
            const space = document.createTextNode('\u00A0')
            if (link.parentNode) {
              link.parentNode.insertBefore(space, link.nextSibling)
              // Move cursor after the space
              range.setStartAfter(space)
              range.setEndAfter(space)
              sel?.removeAllRanges()
              sel?.addRange(range)
            }
          }
        }
      })

      // Trigger input event to sync state
      handleEditorInput()
    }, 10)

    setLinkInputOpen(false)
    setLinkInputValue("")
    setLinkTextValue("")
    setSavedRange(null)
    setLinkDialogPosition(null)
  }

  const handleClearFormatting = () => {
    execAndSync(() => applyCommand('removeFormat'))
  }

  const handleAttachFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const next: { id: string; name: string; type: string; size: number; data: string }[] = []
    for (const file of Array.from(files)) {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          const [, dataPart] = result.split(',')
          resolve(dataPart)
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      next.push({ id: crypto.randomUUID(), name: file.name, type: file.type || 'application/octet-stream', size: file.size, data: base64 })
    }
    setAttachments(prev => [...prev, ...next])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleInsertInlineImage = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = files[0]
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    execAndSync(() => applyCommand('insertHTML', `<img src="${dataUrl}" style="max-width:100%;height:auto;" />`))
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full overflow-hidden animate-in fade-in duration-300">
        {/* Header skeleton */}
        <div className="border-b border-border px-6 py-5 bg-card">
          <div className="h-6 bg-muted rounded w-1/3 animate-pulse mb-3" />
          <div className="h-4 bg-muted rounded w-1/4 animate-pulse" />
        </div>

        {/* Messages skeleton */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="border border-border rounded-xl p-5 bg-card">
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="h-5 bg-muted rounded w-1/3 animate-pulse" />
                  <div className="h-4 bg-muted rounded w-20 animate-pulse" />
                </div>
                <div className="space-y-2">
                  <div className="h-4 bg-muted rounded w-full animate-pulse" />
                  <div className="h-4 bg-muted rounded w-5/6 animate-pulse" />
                  <div className="h-4 bg-muted rounded w-4/5 animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error && threadMessages.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center justify-center space-y-3">
        {onBack && (
          <Button
            onClick={onBack}
            variant="ghost"
            size="sm"
            className="md:hidden self-start -mt-2 -ml-2"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
        )}
        <div className="text-sm font-medium text-destructive">{error}</div>
        <Button
          onClick={fetchThread}
          variant="outline"
          size="sm"
          className="text-xs"
        >
          Retry
        </Button>
      </div>
    )
  }

  if (threadMessages.length === 0 && !emailSummary) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <Mail className="w-12 h-12 mx-auto text-muted-foreground/40" />
          <div className="text-sm font-medium text-muted-foreground">No email selected</div>
          <p className="text-xs text-muted-foreground/70">Select an email to view the conversation</p>
        </div>
      </div>
    )
  }

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString()
    } catch {
      return dateString
    }
  }

  const allAttachments = React.useMemo(() => {
    const list: { id: string; filename: string; mimeType: string; size: number, msgId: string }[] = []
    const seen = new Set<string>()

    // Helper to add attachments
    const add = (atts: { id: string; filename: string; mimeType: string; size: number }[] | undefined, msgId: string) => {
      atts?.forEach(att => {
        if (!seen.has(att.id)) {
          seen.add(att.id)
          list.push({ ...att, msgId })
        }
      })
    }

    if (threadMessages.length > 0) {
      threadMessages.forEach(msg => add(msg.attachments, msg.id))
    } else if (emailSummary) {
      add(emailSummary.attachments, emailSummary.id)
    }

    return list
  }, [threadMessages, emailSummary])

  return (
    <div className="h-full flex flex-col bg-muted/20 overflow-hidden">
      {onBack && (
        <div className="md:hidden px-4 pt-3 pb-2 flex-shrink-0 bg-background border-b border-border">
          <Button
            onClick={onBack}
            variant="ghost"
            size="sm"
            className="h-8 text-xs -ml-2"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
        </div>
      )}

      {/* Main Content Area - Wrapper for Flex Layout */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* Scrollable Thread Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 space-y-4">
          {/* Email Content Card */}
          <Card className={`flex flex-col overflow-hidden max-w-full shadow-lg ${showDraft && !draftMinimized ? 'flex-shrink-0' : 'flex-1'} min-h-[500px]`}>
            <div className="px-6 py-5 border-b border-border flex-shrink-0 overflow-hidden bg-card">
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold text-foreground line-clamp-2 break-words text-left">
                    {threadMessages[threadMessages.length - 1]?.subject || emailSummary?.subject || "(No subject)"}
                  </h2>
                </div>
                {threadMessages.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (!conversationSummary) {
                        setGeneratingSummary(true)
                        try {
                          const summary = threadMessages.map(m => `${m.from}: ${m.body || m.subject || ""}`).join("\n\n")
                          const response = await fetch("/api/ai/summarize", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ conversation: summary })
                          })
                          if (response.ok) {
                            const data = await response.json()
                            setConversationSummary(data.summary)
                            setSummaryExpanded(true)
                          } else {
                            setConversationSummary("Unable to generate summary at this time.")
                            setSummaryExpanded(true)
                          }
                        } catch (err) {
                          setConversationSummary("Error generating summary.")
                          setSummaryExpanded(true)
                        } finally {
                          setGeneratingSummary(false)
                        }
                      } else {
                        setSummaryExpanded(!summaryExpanded)
                      }
                    }}
                    className="h-8 px-3 text-xs flex-shrink-0"
                    disabled={generatingSummary}
                  >
                    {generatingSummary ? (
                      <>
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        Summarizing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 mr-1" />
                        {conversationSummary ? (summaryExpanded ? "Hide Summary" : "Show Summary") : "Summarize"}
                      </>
                    )}
                  </Button>
                )}
              </div>
              {conversationSummary && summaryExpanded && (
                <div className="mt-3 p-3 bg-primary/5 border border-primary/20 rounded-md">
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-foreground/90 leading-relaxed">
                      {conversationSummary}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4">
              <div className="space-y-6 max-w-full">
                {threadMessages.length > 0 ? (
                  threadMessages.map((msg, index) => (
                    <div
                      key={msg.id}
                      className="pb-6 border-b border-border last:border-b-0 last:pb-0 overflow-hidden"
                    >
                      <div className="flex justify-between items-start gap-4 mb-3 min-w-0">
                        <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
                          {/* Clickable Avatar for Client Info */}
                          {onToggleShopify && (
                            <button
                              onClick={() => onToggleShopify(msg.from)}
                              className="flex-shrink-0 transition-colors duration-200 cursor-pointer group"
                              title="View Client info"
                            >
                              <Avatar className="h-10 w-10 border-2 border-border group-hover:border-primary transition-colors">
                                <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
                                  {msg.from.split("<")[0].trim()
                                    ? msg.from.split("<")[0].trim()
                                      .split(" ")
                                      .map((n) => n[0])
                                      .join("")
                                      .slice(0, 2)
                                      .toUpperCase()
                                    : msg.from.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                            </button>
                          )}
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <div className="flex items-center gap-2 mb-1.5 min-w-0">
                              <div className="text-sm font-semibold text-foreground truncate">
                                {msg.from.split("<")[0].trim() || msg.from}
                              </div>
                              {index === 0 && (
                                <Badge variant="outline" className="text-xs flex-shrink-0">Original</Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              To: {msg.to.split("<")[0].trim() || msg.to}
                            </div>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap">
                          {formatDate(msg.date)}
                        </div>
                      </div>
                      {/* Dark Mode Text Handling: Check if content is complex HTML requiring isolation */}
                      <div className="text-sm text-foreground/90 leading-relaxed overflow-hidden break-words w-full">
                        {msg.body && msg.body.trim() ? (
                          (/<[^>]+>/.test(msg.body) || /<style|!doctype|{behavior:|font-family:|padding:|margin:|\.shape|\.[a-z0-9\\:-]+\*?\s*{/i.test(msg.body)) ? (
                            <div className="w-full overflow-hidden">
                              <EmailContentViewer
                                content={msg.body}
                                emailId={msg.id}
                                attachments={msg.attachments}
                              />
                            </div>
                          ) : (
                            <div className="whitespace-pre-wrap break-words px-1">
                              {cleanSnippet(msg.body)}
                            </div>
                          )
                        ) : (
                          <div className="text-muted-foreground italic">
                            No content
                          </div>
                        )}
                      </div>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-border/50">
                          <div className="text-xs font-medium text-muted-foreground mb-2">Attachments</div>
                          <div className="flex flex-wrap gap-2">
                            {msg.attachments.map((att) => (
                              <a
                                key={att.id}
                                href={`/api/emails/${msg.id}/attachments/${att.id}?filename=${encodeURIComponent(att.filename)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 px-3 py-2 bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors group text-sm no-underline"
                              >
                                <div className="p-1.5 bg-background rounded-md border border-border/50 group-hover:border-primary/30 transition-colors">
                                  <Paperclip className="w-4 h-4 text-primary/70 group-hover:text-primary" />
                                </div>
                                <div className="flex flex-col min-w-0">
                                  <span className="truncate max-w-[200px] text-foreground/90 font-medium">{att.filename}</span>
                                  <span className="text-xs text-muted-foreground">{(att.size / 1024).toFixed(1)} KB</span>
                                </div>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  // Fallback: show emailSummary if we have it but no thread messages yet
                  emailSummary ? (
                    <div className="pb-4 border-b border-border/50 last:border-b-0">
                      <div className="flex justify-between items-start gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="text-xs font-medium text-muted-foreground">Message</div>
                            <div className="text-xs font-semibold text-foreground truncate">
                              {emailSummary.from.split("<")[0].trim() || emailSummary.from}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            To: {emailSummary.to.split("<")[0].trim() || emailSummary.to}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap">
                          {formatDate(emailSummary.date)}
                        </div>
                      </div>
                      {emailSummary.body && (/<[^>]+>/.test(emailSummary.body) || /<style|!doctype|{behavior:|font-family:|padding:|margin:|\.shape|\.[a-z0-9\\:-]+\*?\s*{/i.test(emailSummary.body)) ? (
                        <div className="w-full overflow-hidden">
                          <EmailContentViewer
                            content={emailSummary.body}
                            emailId={emailId}
                            attachments={emailSummary.attachments}
                          />
                        </div>
                      ) : (
                        <div className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed overflow-hidden px-1" style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                          {cleanSnippet(emailSummary.body || emailSummary.snippet || "") || "Loading content..."}
                        </div>
                      )}
                      {emailSummary.attachments && emailSummary.attachments.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-border/50">
                          <div className="text-xs font-medium text-muted-foreground mb-2">Attachments</div>
                          <div className="flex flex-wrap gap-2">
                            {emailSummary.attachments.map((att) => (
                              <a
                                key={att.id}
                                href={`/api/emails/${emailId}/attachments/${att.id}?filename=${encodeURIComponent(att.filename)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 px-3 py-2 bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors group text-sm no-underline"
                              >
                                <div className="p-1.5 bg-background rounded-md border border-border/50 group-hover:border-primary/30 transition-colors">
                                  <Paperclip className="w-4 h-4 text-primary/70 group-hover:text-primary" />
                                </div>
                                <div className="flex flex-col min-w-0">
                                  <span className="truncate max-w-[200px] text-foreground/90 font-medium">{att.filename}</span>
                                  <span className="text-xs text-muted-foreground">{(att.size / 1024).toFixed(1)} KB</span>
                                </div>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">Loading content...</div>
                  )
                )}
              </div>
            </div>
          </Card>

          {error && (
            <div className="px-4 py-3 text-sm font-medium text-destructive bg-destructive/10 rounded-lg border border-destructive/20">
              {error}
            </div>
          )}

          {/* Spacer for the fixed footer */}
          <div className="h-24"></div>
        </div>

        {/* Persistent Attachment Sidebar */}
        {allAttachments.length > 0 && (
          <div className="w-72 hidden 2xl:block border-l border-border bg-card/40 overflow-y-auto p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground mb-2">
              <Paperclip className="w-4 h-4" />
              Attachments ({allAttachments.length})
            </div>
            <div className="space-y-2">
              {allAttachments.map((att) => (
                <a
                  key={att.id}
                  href={`/api/emails/${att.msgId}/attachments/${att.id}?filename=${encodeURIComponent(att.filename)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all group block no-underline"
                >
                  <div className="mt-0.5 p-2 bg-primary/5 rounded-md text-primary group-hover:bg-primary/10 transition-colors">
                    <Paperclip className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="text-sm font-medium text-foreground truncate" title={att.filename}>
                      {att.filename}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                      <span>{(att.size / 1024).toFixed(1)} KB</span>
                      <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                      <span className="truncate uppercase text-[10px]">{att.filename.split('.').pop()}</span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Persistent Footer Actions - Fixed at bottom */}
      <div className="border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 p-4 md:px-6 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-10">
        <div className="space-y-4 max-w-4xl mx-auto">
          {onToggleShopify && emailSummary && (
            <Button
              variant={showShopifySidebar ? "default" : "outline"}
              size="sm"
              onClick={() => onToggleShopify(emailSummary.from)}
              className="w-full gap-2 transition-all duration-300 hover:scale-[1.01] active:scale-[0.99]"
            >
              <User className="w-4 h-4" />
              {showShopifySidebar ? "Hide" : "Show"} Client Info
            </Button>
          )}

          <Button
            onClick={handleGenerateDraft}
            disabled={generating || showDraft}
            className="w-full h-11 text-base font-semibold shadow-md transition-all duration-300 hover:shadow-lg hover:translate-y-[-2px] active:translate-y-[0px] bg-gradient-to-r from-primary to-primary/80"
          >
            {generating ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Generating draft...
              </>
            ) : showDraft ? (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                Draft generated
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                Generate AI draft
              </>
            )}
          </Button>

          {showDraft && (
            <div className="space-y-4 pt-4 border-t border-border animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  AI-Generated Draft
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraftMinimized(!draftMinimized)}
                  className="h-9 px-3 hover:bg-accent/10"
                  title={draftMinimized ? "Expand draft" : "Minimize draft"}
                >
                  {draftMinimized ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronUp className="w-4 h-4" />
                  )}
                </Button>
              </div>
              {draftMinimized ? (
                <div className="text-sm text-muted-foreground italic py-3 px-4 bg-muted/30 rounded-lg border border-border/50">
                  Draft minimized - click arrow to expand
                </div>
              ) : (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1 items-center bg-muted/40 border border-border rounded-lg px-2 py-1.5 shadow-sm">
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={() => execAndSync(() => applyCommand('bold'))} aria-label="Bold"><Bold className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={() => execAndSync(() => applyCommand('italic'))} aria-label="Italic"><Italic className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={() => execAndSync(() => applyCommand('underline'))} aria-label="Underline"><Underline className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={() => execAndSync(() => applyCommand('strikeThrough'))} aria-label="Strikethrough"><Strikethrough className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={toggleHeading} aria-label="Heading"><Type className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={() => execAndSync(() => applyCommand('hiliteColor', '#fef08a'))} aria-label="Highlight"><Highlighter className="w-3.5 h-3.5 text-amber-500" /></button>

                      <div className="w-px h-5 bg-border mx-0.5" />

                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={() => makeListFromSelection(false)} aria-label="Bullet list"><List className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={() => makeListFromSelection(true)} aria-label="Numbered list"><ListOrdered className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={toggleBlockquote} aria-label="Quote"><Quote className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={() => execAndSync(() => applyCommand('justifyLeft'))} aria-label="Align left"><AlignLeft className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={() => execAndSync(() => applyCommand('justifyCenter'))} aria-label="Align center"><AlignCenter className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={() => execAndSync(() => applyCommand('justifyRight'))} aria-label="Align right"><AlignRight className="w-3.5 h-3.5" /></button>

                      <div className="w-px h-5 bg-border mx-0.5" />

                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={handleInsertLink} aria-label="Insert link"><LinkIcon className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={() => execAndSync(() => applyCommand('insertHTML', '<code></code>'))} aria-label="Inline code"><Code className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={() => imageInputRef.current?.click()} aria-label="Inline image"><ImageIcon className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent transition-colors" onClick={() => fileInputRef.current?.click()} aria-label="Attach file"><Paperclip className="w-3.5 h-3.5" /></button>

                      <div className="w-px h-5 bg-border mx-0.5" />

                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 px-2.5 inline-flex items-center justify-center rounded hover:bg-accent text-xs font-medium transition-colors" onClick={handleClearFormatting} aria-label="Clear formatting">Clear</button>
                    </div>
                    <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleAttachFiles(e.target.files)} />
                    <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleInsertInlineImage(e.target.files)} />
                    <div className="relative">
                      {linkInputOpen && linkDialogPosition && (
                        <div
                          ref={linkDialogRef}
                          className="absolute z-50 bg-popover border border-border rounded-md p-1.5 shadow-md text-xs"
                          style={{
                            top: `${linkDialogPosition.top}px`,
                            left: `${linkDialogPosition.left}px`,
                            minWidth: '280px',
                            maxWidth: '320px'
                          }}
                        >
                          <div className="space-y-1">
                            {linkHasSelection && linkTextValue && (
                              <div className="text-[9px] text-muted-foreground px-1 pb-0.5">
                                <span className="font-medium">Selected:</span> "{linkTextValue}"
                              </div>
                            )}
                            <Input
                              id="link-input-inline"
                              value={linkInputValue}
                              onChange={(e) => setLinkInputValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && linkInputValue.trim()) {
                                  e.preventDefault()
                                  applyLink()
                                } else if (e.key === 'Escape') {
                                  setLinkInputOpen(false)
                                  setLinkInputValue("")
                                  setLinkTextValue("")
                                  setLinkDialogPosition(null)
                                }
                              }}
                              placeholder="URL"
                              className="h-7 text-xs px-2"
                            />
                            {!linkHasSelection && (
                              <Input
                                id="link-text-inline"
                                value={linkTextValue}
                                onChange={(e) => setLinkTextValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && linkInputValue.trim()) {
                                    e.preventDefault()
                                    applyLink()
                                  } else if (e.key === 'Escape') {
                                    setLinkInputOpen(false)
                                    setLinkInputValue("")
                                    setLinkTextValue("")
                                    setLinkDialogPosition(null)
                                  }
                                }}
                                placeholder="Text (optional)"
                                className="h-7 text-xs px-2"
                              />
                            )}
                            <div className="flex items-center gap-1">
                              <Button size="sm" onClick={applyLink} disabled={!linkInputValue.trim()} className="flex-1 h-6 text-[11px] px-2">
                                Insert
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => { setLinkInputOpen(false); setLinkInputValue(""); setLinkTextValue(""); setLinkDialogPosition(null) }} className="h-6 text-[11px] px-2">
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                      <div
                        ref={editorRef}
                        contentEditable
                        suppressContentEditableWarning
                        onClick={(e) => {
                          // Clear selection when clicking on empty area (not on text)
                          const target = e.target as HTMLElement
                          if (target === editorRef.current) {
                            const sel = window.getSelection()
                            sel?.removeAllRanges()
                          }
                        }}
                        onInput={handleEditorInput}
                        onPaste={(e) => {
                          e.preventDefault()
                          const text = e.clipboardData.getData('text/plain')
                          execAndSync(() => {
                            if (!document.execCommand('insertText', false, text)) {
                              document.execCommand('insertHTML', false, text)
                            }
                          })
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setDraftMinimized(true)
                            e.preventDefault()
                          }
                          if ((e.key === 'Backspace' || e.key === 'Delete') && typeof window !== 'undefined') {
                            const sel = window.getSelection()
                            const node = sel?.anchorNode as HTMLElement | null
                            const img = node?.nodeType === 1 ? (node as HTMLElement).closest('img') : node?.parentElement?.closest('img')
                            if (img) {
                              e.preventDefault()
                              execAndSync(() => img.remove())
                              return
                            }
                          }
                          handleEditorShortcut(e)
                        }}
                        className="w-full min-h-[200px] max-h-[300px] overflow-y-auto p-4 border-2 border-border rounded-xl bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all duration-200 prose prose-sm max-w-none prose-img:max-w-full prose-img:max-h-96"
                        aria-label="Email draft editor"
                      />
                      {autoSaving && (
                        <div className="text-xs text-muted-foreground bg-background/90 px-2 py-1 rounded shadow-sm border border-border absolute top-3 right-3 pointer-events-none select-none">
                          Saving...
                        </div>
                      )}
                      {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {attachments.map(att => (
                            <div key={att.id} className="flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-muted/40">
                              <Paperclip className="w-3 h-3" />
                              <span>{att.name}</span>
                              <button type="button" onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))} className="text-xs text-foreground hover:text-destructive">✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {!draftMinimized && (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => handleSendReply()}
                      disabled={sending || sendSuccess}
                      className={`flex-1 h-10 text-sm font-semibold shadow-md transition-all duration-300 ease-out hover:shadow-lg disabled:cursor-not-allowed ${sendSuccess
                        ? "bg-green-600 text-white hover:bg-green-600"
                        : "disabled:opacity-50"
                        }`}
                    >
                      {sendingAction === 'send' ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Sending...
                        </>
                      ) : sendSuccess ? (
                        "✓ Reply sent!"
                      ) : (
                        "Send Reply"
                      )}
                    </Button>
                    {ticketId && !hideCloseButton && (
                      <Button
                        variant="secondary"
                        onClick={() => handleSendReply({ closeTicket: true })}
                        disabled={sending || sendSuccess}
                        className="flex-1 h-10 text-sm font-semibold shadow-md transition-all duration-300 ease-out hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {sendingAction === 'send-close' ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Sending...
                          </>
                        ) : sendSuccess ? (
                          "✓ Sent & Closed!"
                        ) : (
                          "Send & Close"
                        )}
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      onClick={handleCopy}
                      variant="outline"
                      className="h-10 text-sm font-medium hover:bg-accent/10 hover:border-primary/50 transition-all duration-200"
                    >
                      {copied ? "✓ Copied!" : "Copy Draft"}
                    </Button>
                    <Button
                      onClick={handleRegenerate}
                      variant="outline"
                      disabled={generating}
                      className="h-10 text-sm font-medium hover:bg-accent/10 hover:border-primary/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {generating ? "Regenerating..." : "Regenerate"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
