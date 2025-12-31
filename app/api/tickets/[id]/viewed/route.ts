import { NextRequest, NextResponse } from "next/server"
import { getCurrentUserEmail } from "@/lib/storage"
import { getCurrentUserIdFromRequest, getSessionUserEmailFromRequest } from "@/lib/session"
import { upsertTicketView } from "@/lib/ticket-views"
import { getUserByEmail } from "@/lib/users"

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params
    const ticketId = params?.id
    if (!ticketId) {
      return NextResponse.json({ error: "Missing ticket ID" }, { status: 400 })
    }

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
    // if (!userEmail) { // Allow null userEmail for CRM admin
    //   return NextResponse.json({ error: "No Gmail account connected" }, { status: 400 })
    // }

    const body = await request.json().catch(() => ({}))
    const lastViewedAt = body?.lastViewedAt as string | undefined

    const result = await upsertTicketView(userId, ticketId, lastViewedAt)

    if (!result) {
      console.error("Failed to upsert ticket view, result is null");
      return NextResponse.json({ error: "Failed to update view state" }, { status: 500 })
    }

    // console.log("Upserted ticket view:", result);

    return NextResponse.json({ ticketId, lastViewedAt: result.last_viewed_at || lastViewedAt })
  } catch (error) {
    console.error("Error updating ticket view:", error)
    return NextResponse.json({ error: "Failed to update ticket view" }, { status: 500 })
  }
}

