/**
 * GET /api/tickets - List tickets with role-based filtering
 * - Agents: see only their own tickets + unassigned tickets
 * - Admin/Manager: see all tickets
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { getTickets } from '@/lib/tickets';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { canViewAllTickets } from '@/lib/permissions';
import { getCurrentUserEmail } from '@/lib/storage';
import { validateBusinessSession, getSessionUserEmailFromRequest } from '@/lib/session';
import { getUserByEmail } from '@/lib/users';

export async function GET(request: NextRequest) {
  try {
    let userId = getCurrentUserIdFromRequest(request);
    const businessSession = await validateBusinessSession();
    const businessId = businessSession?.businessId || null;
    const sessionEmail = getSessionUserEmailFromRequest(request);

    // Initial check for authentication tokens
    if (!userId && !sessionEmail) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Fallback: If userId is not in cookie but we have sessionEmail, try to find the user
    if (!userId && sessionEmail) {
      const user = await getUserByEmail(sessionEmail);
      if (user) {
        userId = user.id;
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Check if this is the CRM admin user
    const isAdminUser = userId === '00000000-0000-0000-0000-000000000001';

    // For CRM admin, pass null to see ALL tickets (no user_email filter)
    // For regular users, get their email from storage
    const filterEmail = isAdminUser
      ? null  // Admin sees all tickets regardless of user_email
      : await getCurrentUserEmail();

    // Non-admin users must have an email
    if (!isAdminUser && !filterEmail) {
      return NextResponse.json(
        { error: 'No Gmail account connected' },
        { status: 400 }
      );
    }

    // CRM admin can view all tickets; for others, check permissions
    const canViewAll = isAdminUser || await canViewAllTickets(userId);

    // Get account filter if specified
    const accountFilter = request.nextUrl.searchParams.get('account') || undefined;

    // Get tickets with role-based filtering and optional account scope
    const tickets = await getTickets(userId, canViewAll, filterEmail, accountFilter, businessId);

    return NextResponse.json({ tickets });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tickets', details: (error as Error).message },
      { status: 500 }
    );
  }
}





