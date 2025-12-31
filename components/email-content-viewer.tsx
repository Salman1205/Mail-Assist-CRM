"use client"

import React, { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import DOMPurify from "isomorphic-dompurify"

import { useTheme } from "next-themes"

interface EmailContentViewerProps {
  content: string
  className?: string
  emailId?: string
  attachments?: { id: string; filename: string; mimeType: string; size: number }[]
}

export function EmailContentViewer({ content, className, emailId, attachments }: EmailContentViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState("auto")
  const [loading, setLoading] = useState(true)
  const observerRef = useRef<ResizeObserver | null>(null)

  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = mounted && resolvedTheme === 'dark'

  // Function to inject content and resize
  const updateIframe = () => {
    const iframe = iframeRef.current
    if (!iframe) return

    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc) return

    // Replace CID images if possible
    let processedContent = content;
    if (emailId && attachments && attachments.length > 0) {
      attachments.forEach(att => {
        // Match cid:filename or just cid:id
        const cidRegex = new RegExp(`cid:${att.id}|cid:${att.filename}`, 'gi');
        processedContent = processedContent.replace(cidRegex, `/api/emails/${emailId}/attachments/${att.id}?filename=${encodeURIComponent(att.filename)}`);
      });
    }

    // Sanitize content
    const sanitizedContent = DOMPurify.sanitize(processedContent, {
      USE_PROFILES: { html: true },
      ADD_TAGS: ['style', 'img'],
      ADD_ATTR: ['target', 'src', 'alt', 'width', 'height'],
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i, // Allow cid: and data:
    })

    // Base styles - Using OKLCH to match app theme exactly
    const baseStyles = `
      <style>
        body {
          margin: 0;
          padding: 16px; 
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-size: 15px;
          line-height: 1.6;
          background-color: ${isDark ? 'oklch(0.18 0.015 240)' : 'oklch(0.985 0.004 100)'} !important;
          color: ${isDark ? 'oklch(0.15 0.01 240)' : 'oklch(0.25 0.01 240)'}; /* Set to dark color so it inverts to light */
          overflow-wrap: break-word;
          word-wrap: break-word;
        }
        
        .email-content-wrapper {
            max-width: 100%; 
            margin: 0 auto;
            background-color: transparent;
            color: inherit;
            padding: 8px;
            border-radius: 8px;
            ${isDark ? 'filter: invert(1) hue-rotate(180deg) brightness(1.2) contrast(0.9);' : ''}
        }

        p, div, td, span, li {
           color: inherit; 
        }

        img {
          max-width: 100%;
          height: auto;
          display: block; 
          border: 0;
          ${isDark ? 'filter: invert(1) hue-rotate(180deg);' : ''}
        }

        a {
          color: #2563eb; 
          text-decoration: underline;
        }
        
        blockquote {
            margin-left: 0;
            padding-left: 1rem;
            border-left: 4px solid #e5e7eb; 
            color: #4b5563;
        }

        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: ${isDark ? 'oklch(0.30 0.012 220)' : 'oklch(0.86 0.008 180)'};
          border-radius: 4px;
        }
      </style>
    `

    // Inject content
    doc.open()
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta name="referrer" content="no-referrer-when-downgrade">
          <meta http-equiv="Content-Security-Policy" content="script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; img-src * data: cid: blob:;"> 
          <base target="_blank">
          ${baseStyles}
        </head>
        <body>
            <div class="email-content-wrapper">
                ${sanitizedContent}
            </div>
        </body>
      </html>
    `)
    doc.close()

    // Measure height immediately after write (approximate)
    if (iframe.contentDocument?.documentElement) {
      setHeight(`${iframe.contentDocument.documentElement.scrollHeight}px`);
    }

    // WAIT FOR IMAGES Logic
    const waitForImages = async () => {
      const images = Array.from(doc.getElementsByTagName('img'));
      const promises = images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
          img.onload = resolve;
          img.onerror = resolve;
          setTimeout(resolve, 2000); // 2s timeout for images
        });
      });

      if (promises.length > 0) {
        await Promise.all(promises);
      }

      if (iframe.contentDocument?.documentElement) {
        const newHeight = iframe.contentDocument.documentElement.scrollHeight;
        setHeight(`${newHeight}px`);
        setLoading(false);
      }
    };

    waitForImages();

    // Clean up previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    // Setup ResizeObserver
    const resizeObserver = new ResizeObserver(() => {
      if (iframe.contentDocument?.documentElement) {
        const newHeight = iframe.contentDocument.documentElement.scrollHeight
        setHeight(`${newHeight}px`)
      }
    })

    if (doc.body) {
      resizeObserver.observe(doc.body)
      observerRef.current = resizeObserver;
    }
  }

  useEffect(() => {
    if (!mounted) return;
    setLoading(true);

    // Clear iframe immediately to prevent flash of old content
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document
      if (doc) {
        doc.open()
        doc.write("")
        doc.close()
      }
    }

    // Set a minimum height initially to avoid total collapse
    setHeight("200px");

    // Small timeout to allow DOM to settle, but keep it snappy
    const t = setTimeout(() => updateIframe(), 0);

    return () => {
      clearTimeout(t);
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [content, isDark, mounted])

  return (
    <div className={`relative w-full overflow-hidden transition-colors bg-card ${className}`}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-card">
          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
        </div>
      )}
      <iframe
        ref={iframeRef}
        title="Email Content"
        width="100%"
        style={{
          height: height,
          minHeight: '200px',
          border: 'none',
          display: 'block',
          backgroundColor: 'transparent',
          opacity: loading ? 0 : 1, // Hide during switch
          pointerEvents: loading ? 'none' : 'auto',
          transition: 'opacity 0.15s ease-in-out',
        }}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  )
}
