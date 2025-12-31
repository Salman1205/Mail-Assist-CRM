"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import AdminLogin from "@/components/auth/admin-login"

export default function WelcomePage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // Check if already logged in
    const checkSession = async () => {
      try {
        const response = await fetch("/api/auth/current-user")
        if (response.ok) {
          const data = await response.json()
          if (data.user) {
            // Already logged in, redirect to main app
            router.push("/")
            return
          }
        }
      } catch (error) {
        console.error("Session check error:", error)
      }
      setChecking(false)
    }

    checkSession()
  }, [router])

  const handleLoginSuccess = () => {
    // Redirect to main app with auth success flag
    window.location.href = "/?businessAuth=true"
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <p className="text-sm text-slate-400">Checking session...</p>
        </div>
      </div>
    )
  }

  return <AdminLogin onSuccess={handleLoginSuccess} />
}
