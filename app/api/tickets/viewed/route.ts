import { NextRequest, NextResponse } from "next/server"
import { getCurrentUserEmail } from "@/lib/storage"
import { getCurrentUserIdFromRequest, getSessionUserEmailFromRequest } from "@/lib/session"
import { getTicketViewsForUser } from "@/lib/ticket-views"
import { getUserByEmail } from "@/lib/users"

export async function GET(request: NextRequest) {
  try {
    let userId = getCurrentUserIdFromRequest(request)
    const sessionEmail = getSessionUserEmailFromRequest(request)

    if (!userId && sessionEmail) {
      const user = await getUserByEmail(sessionEmail)
      if (user) userId = user.id
    }

    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const userEmail = await getCurrentUserEmail()
    // if (!userEmail) {
    //   return NextResponse.json({ error: "No Gmail account connected" }, { status: 400 })
    // }

    const views = await getTicketViewsForUser(userId, userEmail)
    const map: Record<string, string> = {}
    views.forEach((v) => {
      map[v.ticketId] = v.lastViewedAt
    })

    return NextResponse.json({ views: map })
  } catch (error) {
    console.error("Error fetching ticket views:", error)
    return NextResponse.json({ error: "Failed to fetch ticket views" }, { status: 500 })
  }
}

