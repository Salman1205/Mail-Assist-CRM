/**
 * GET /api/tickets/[id]/thread - Get conversation thread for a ticket
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTicketById } from '@/lib/tickets';
import { getThreadById } from '@/lib/gmail';
import { getValidTokens } from '@/lib/token-refresh';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { canViewAllTickets } from '@/lib/permissions';
import { getCurrentUserEmail } from '@/lib/storage';

type RouteContext =
  | { params: { id: string } }
  | { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const paramsData = await Promise.resolve((context as any).params);
    const ticketId = paramsData?.id;

    if (!ticketId) {
      return NextResponse.json(
        { error: 'Missing ticket ID' },
        { status: 400 }
      );
    }

    const userId = getCurrentUserIdFromRequest(request);
    const userEmail = await getCurrentUserEmail();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Get ticket details
    const canViewAll = await canViewAllTickets(userId);
    const ticket = await getTicketById(ticketId, userId, canViewAll, userEmail);

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found or access denied' },
        { status: 404 }
      );
    }

    // 1. For CRM tickets (numeric threadId), fetch from MySQL FIRST to get attachments
    // This is critical because Supabase doesn't store attachment data
    if (/^\d+$/.test(ticket.threadId)) {
      try {
        const { getCrmEmailById } = await import('@/lib/crm-email-provider');
        const email = await getCrmEmailById(ticket.threadId);

        if (email) {
          console.log(`[Thread API] Fetched CRM email ${ticket.threadId} with ${email.attachments?.length || 0} attachments`);
          return NextResponse.json({
            messages: [email]
          });
        }
      } catch (dbError) {
        console.warn('Failed to fetch from CRM DB:', dbError);
      }
    }

    // 2. Try to fetch from Supabase 'emails' table (local sync)
    // This is used for non-CRM emails or as a fallback
    try {
      const { supabase } = await import('@/lib/supabase');
      if (supabase) {
        const { data: localEmails } = await supabase
          .from('emails')
          .select('*')
          .eq('thread_id', ticket.threadId)
          .order('date', { ascending: true });

        if (localEmails && localEmails.length > 0) {
          // Map to message format
          const messages = localEmails.map(email => ({
            id: email.id,
            threadId: email.thread_id,
            subject: email.subject,
            from: email.from_address,
            to: email.to_address,
            date: email.date,
            body: email.body,
            snippet: email.body ? email.body.substring(0, 100) : '',
            isReply: email.is_reply
          }));

          return NextResponse.json({ messages });
        }
      }
    } catch (localError) {
      console.warn('Failed to fetch from Supabase emails table:', localError);
    }

    // Fallback to Gmail if not found in CRM DB (legacy support)
    // Only proceed if we have tokens, otherwise return empty or error
    try {
      let tokens = await getValidTokens(ticket.userEmail);
      if ((!tokens || !tokens.access_token) && userEmail && userEmail !== ticket.userEmail) {
        tokens = await getValidTokens(userEmail);
      }

      if (tokens && tokens.access_token) {
        const thread = await getThreadById(tokens, ticket.threadId);
        return NextResponse.json({ messages: thread.messages || [] });
      }
    } catch (gmailError) {
      console.warn('Gmail fetch failed:', gmailError);
    }

    // If we reached here, we couldn't find the thread in DB or Gmail
    // Return empty array instead of error to prevent UI crash
    return NextResponse.json({ messages: [] });
  } catch (error) {
    console.error('Error fetching ticket thread:', error);
    // Return empty messages on error to prevent UI crash
    return NextResponse.json({ messages: [] });
  }
}





