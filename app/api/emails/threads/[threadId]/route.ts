import { NextRequest, NextResponse } from 'next/server';
import { getValidTokens } from '@/lib/token-refresh';
import { getThreadById } from '@/lib/gmail';

type RouteContext =
  | { params: { threadId: string } }
  | { params: Promise<{ threadId: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const paramsData = await Promise.resolve((context as any).params);
    let threadId = paramsData?.threadId;

    if (!threadId) {
      const segments = request.nextUrl.pathname.split('/');
      threadId = decodeURIComponent(segments[segments.length - 1] || '');
    }

    if (!threadId) {
      return NextResponse.json(
        { error: 'Missing thread id' },
        { status: 400 }
      );
    }

    // Check for CRM Mode (Numeric Thread ID)
    if (/^\d+$/.test(threadId)) {
      const { getCrmEmailById } = await import('@/lib/crm-email-provider');
      try {
        const email = await getCrmEmailById(threadId);
        if (email) {
          // Return as a thread with one message
          return NextResponse.json({
            thread: {
              id: email.id,
              historyId: email.id, // Mock historyId
              messages: [email]
            }
          });
        }
      } catch (error) {
        console.error('Error fetching CRM thread:', error);
        // Fallback to Gmail if failed (unlikely for numeric ID but safe)
      }
    }

    const tokens = await getValidTokens();

    if (!tokens || !tokens.access_token) {
      return NextResponse.json(
        { error: 'Not authenticated. Please connect Gmail first.' },
        { status: 401 }
      );
    }

    const thread = await getThreadById(tokens, threadId);

    if (!thread) {
      return NextResponse.json(
        { error: 'Thread not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ thread });
  } catch (error) {
    console.error('Error fetching email thread:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch email thread',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}


