import { supabase } from './supabase'

export interface TicketView {
  ticketId: string
  lastViewedAt: string
}

/**
 * Fetch ticket view timestamps for a user, scoped by userEmail (Gmail account)
 */
export async function getTicketViewsForUser(userId: string, userEmail: string | null) {
  if (!supabase) return []

  let query = supabase
    .from('ticket_views')
    .select('ticket_id, last_viewed_at, tickets!inner(user_email)')
    .eq('user_id', userId)

  if (userEmail) {
    query = query.eq('tickets.user_email', userEmail)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching ticket views:', error)
    return []
  }

  return (data || []).map((row: any) => ({
    ticketId: row.ticket_id as string,
    lastViewedAt: row.last_viewed_at as string,
  })) as TicketView[]
}

/**
 * Upsert a ticket view timestamp for a user
 */
export async function upsertTicketView(
  userId: string,
  ticketId: string,
  lastViewedAt?: string,
) {
  if (!supabase) return null

  const payload = {
    user_id: userId,
    ticket_id: ticketId,
    last_viewed_at: lastViewedAt || new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('ticket_views')
    .upsert(payload, { onConflict: 'user_id,ticket_id' }) // Remove space for standard format
    // 'user_id, ticket_id' might work but 'user_id,ticket_id' is safer
    .select('ticket_id, last_viewed_at')
    .maybeSingle()

  if (error) {
    console.error('Error upserting ticket view:', error)
    return null
  }

  return data
}

