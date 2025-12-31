/**
 * Email fetching endpoint
 * Fetches emails from CRM MySQL database (replaces Gmail)
 * Includes AI-based workstream/department classification using Groq
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchCrmEmails, searchCrmEmails, CrmEmail } from '@/lib/crm-email-provider';
import { ensureTicketForEmail } from '@/lib/tickets';

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';
// Cache configuration: revalidate every 30 seconds
export const revalidate = 30;

// Admin user check (same as in admin-login)
const ADMIN_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Check if user has valid admin session
 */
function isAdminAuthenticated(request: NextRequest): boolean {
  const adminSessionCookie = request.cookies.get('crm_admin_session');
  if (!adminSessionCookie) return false;

  try {
    const sessionData = JSON.parse(Buffer.from(adminSessionCookie.value, 'base64').toString('utf-8'));
    return sessionData.userId === ADMIN_USER_ID;
  } catch {
    return false;
  }
}

/**
 * Classify email using AI (Groq) for workstream/department assignment
 */
async function classifyEmailWithAI(email: CrmEmail): Promise<string | null> {
  try {
    const { getGroqApiKey, classifyEmailWithFallback } = await import('@/lib/department-classifier');
    const { supabase } = await import('@/lib/supabase');

    const groqApiKey = getGroqApiKey();

    // Fetch departments directly from Supabase for CRM mode (no user scoping)
    let departments: { id: string; name: string; description: string }[] = [];
    if (supabase) {
      const { data } = await supabase
        .from('departments')
        .select('id, name, description')
        .order('name');
      departments = data || [];
    }

    if (!departments || departments.length === 0) {
      return email.department; // Fall back to existing classification
    }

    const result = await classifyEmailWithFallback(
      { subject: email.subject, body: email.body },
      departments as any, // Cast - classifier only uses id, name, description
      groqApiKey,
      null, // userEmail not needed for CRM
      null  // businessId not needed for CRM
    );

    if (result.departmentName) {
      console.log(`[AI Classification] Email "${email.subject.substring(0, 30)}..." classified as: ${result.departmentName} (confidence: ${result.confidence}%)`);
      return result.departmentName;
    }

    return email.department;
  } catch (error) {
    console.error('[AI Classification] Error:', error);
    return email.department; // Fall back to existing classification
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check for admin authentication
    if (!isAdminAuthenticated(request)) {
      return NextResponse.json(
        { error: 'Not authenticated. Please login first.' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') || 'inbox';
    const q = searchParams.get('q');

    // Safely parse maxResults
    const maxResultsRaw = searchParams.get('maxResults');
    const parsedMax = maxResultsRaw ? Number(maxResultsRaw) : 50;
    const maxResults = Number.isFinite(parsedMax)
      ? Math.min(Math.max(parsedMax, 1), 200)
      : 50;

    let emails: CrmEmail[];

    // For sent emails, we don't have a separate view in CRM
    if (type === 'sent') {
      return NextResponse.json({ emails: [], count: 0 });
    }

    // Fetch from CRM database with error handling
    try {
      if (q && !q.includes('label:') && !q.includes('in:')) {
        emails = await searchCrmEmails(q, maxResults);
      } else {
        emails = await fetchCrmEmails(maxResults);
      }
    } catch (mysqlError) {
      console.error('[EMAILS] MySQL Error:', mysqlError);
      return NextResponse.json(
        {
          error: 'Failed to connect to CRM database',
          details: (mysqlError as Error).message,
          hint: 'Check MySQL connection settings and VPN status'
        },
        { status: 503 }
      );
    }

    console.log(`[EMAILS] Fetched ${emails.length} emails from CRM database`);

    // AI Classification DISABLED for CRM mode - uncomment when needed:
    /*
    // Apply AI classification to emails (async, non-blocking for first few emails)
    const emailsWithAIClassification = await Promise.all(
      emails.slice(0, 5).map(async (email) => {
        if (!email.department) {
          const aiDepartment = await classifyEmailWithAI(email);
          return { ...email, department: aiDepartment };
        }
        return email;
      })
    );

    // Combine AI-classified and non-classified emails
    emails = [...emailsWithAIClassification, ...emails.slice(5)];
    */

    // Background processing: Create tickets for emails
    if (emails && emails.length > 0) {
      Promise.all(
        emails.map(async (email) => {
          try {
            await ensureTicketForEmail(
              {
                id: email.id,
                threadId: email.threadId,
                subject: email.subject,
                from: email.from,
                to: email.to,
                date: email.date,
                body: email.body,
                snippet: email.snippet,
              },
              false // Not from agent (incoming email)
            );
          } catch (error) {
            console.error(`Error creating ticket for email ${email.id}:`, error);
          }
        })
      ).catch(err => console.error('Background ticket processing error:', err));
    }

    // Return emails
    const response = NextResponse.json({
      emails,
      count: emails.length,
      source: 'crm_database'
    });

    // Add cache headers
    response.headers.set(
      'Cache-Control',
      'public, s-maxage=30, stale-while-revalidate=60, max-age=0'
    );

    return response;
  } catch (error) {
    console.error('[EMAILS] Error fetching emails:', error);
    return NextResponse.json(
      { error: 'Failed to fetch emails', details: (error as Error).message },
      { status: 500 }
    );
  }
}
