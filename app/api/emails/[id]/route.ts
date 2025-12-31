/**
 * Get a specific email by ID
 */

import { NextRequest, NextResponse } from 'next/server';
import { getValidTokens } from '@/lib/token-refresh';
import { getEmailById } from '@/lib/gmail';
import { getStoredEmailById, storeReceivedEmail } from '@/lib/storage';
import { ensureTicketForEmail } from '@/lib/tickets';

type RouteContext =
  | { params: { id: string } }
  | { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const paramsData = await Promise.resolve((context as any).params);
    let emailId = paramsData?.id;
    if (!emailId) {
      const segments = request.nextUrl.pathname.split('/');
      emailId = decodeURIComponent(segments[segments.length - 1] || '');
    }
    if (!emailId) {
      return NextResponse.json(
        { error: 'Missing email id' },
        { status: 400 }
      );
    }

    // Check for admin/CRM mode first
    const adminSessionCookie = request.cookies.get('crm_admin_session');
    let isCrmMode = false;

    // Auto-detect CRM mode if ID is a number (CRM IDs are integers, Gmail IDs are hex/alphanumeric strings)
    if (/^\d+$/.test(emailId)) {
      isCrmMode = true;
    } else if (adminSessionCookie) {
      try {
        const sessionData = JSON.parse(Buffer.from(adminSessionCookie.value, 'base64').toString('utf-8'));
        if (sessionData.userId === '00000000-0000-0000-0000-000000000001') {
          isCrmMode = true;
        }
      } catch { } // Ignore JSON parse errors
    }

    // Try fetching from CRM if in CRM mode
    if (isCrmMode) {
      const { getCrmEmailById } = await import('@/lib/crm-email-provider');
      try {
        const crmEmail = await getCrmEmailById(emailId);
        if (crmEmail) {
          // Ensure ticket exists in background
          ensureTicketForEmail(
            {
              id: crmEmail.id,
              threadId: crmEmail.threadId,
              subject: crmEmail.subject,
              from: crmEmail.from,
              to: crmEmail.to,
              date: crmEmail.date,
              snippet: crmEmail.snippet,
              body: crmEmail.body, // Provide full email data for ticket
              attachments: crmEmail.attachments // Pass attachments if available (ensureTicketForEmail might need update to store them, but for now this just ensures the call is correct)
            },
            false
          ).catch(err => console.error('Error ensuring ticket for CRM email:', err));

          return NextResponse.json({ email: crmEmail });
        }
      } catch (crmError) {
        console.error('Error fetching CRM email:', crmError);
        // Fall through to Gmail/Storage if CRM fetch fails (might be a non-CRM email ID pattern)
      }
    }

    // Check local storage first (optimized indexed query)
    const cachedEmail = await getStoredEmailById(emailId);

    if (cachedEmail) {
      return NextResponse.json({ email: cachedEmail });
    }

    // Load and refresh tokens if needed
    const tokens = await getValidTokens();

    if (!tokens || !tokens.access_token) {
      return NextResponse.json(
        { error: 'Not authenticated. Please connect Gmail first.' },
        { status: 401 }
      );
    }

    // Fetch the specific email
    const email = await getEmailById(tokens, emailId);

    if (!email) {
      return NextResponse.json(
        { error: 'Email not found' },
        { status: 404 }
      );
    }

    // Store for future requests (without embeddings) - non-blocking
    storeReceivedEmail(email).catch(err => console.error('Error storing email:', err));

    // OPTIMIZED: Ensure ticket exists/updated in background (non-blocking)
    // This makes the API response faster
    ensureTicketForEmail(
      {
        id: email.id,
        threadId: email.threadId,
        subject: email.subject,
        from: email.from,
        to: email.to,
        date: email.date,
      },
      false
    ).catch(err => console.error('Error creating ticket:', err));

    // Return email immediately - ticket creation happens in background
    return NextResponse.json({ email });
  } catch (error) {
    console.error('Error fetching email:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch email',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}


