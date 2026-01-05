/**
 * POST /api/tickets/sync - Sync tickets with CRM emails
 * Marks tickets as 'archived_external' if their CRM email no longer exists
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { syncTicketsWithCrmEmails } from '@/lib/tickets';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { getSessionUserEmailFromRequest } from '@/lib/session';
import { getUserByEmail } from '@/lib/users';

export async function POST(request: NextRequest) {
    try {
        // Use same auth pattern as /api/tickets route
        let userId = getCurrentUserIdFromRequest(request);
        const sessionEmail = getSessionUserEmailFromRequest(request);

        // Fallback: If userId is not in cookie but we have sessionEmail, try to find the user
        if (!userId && sessionEmail) {
            const user = await getUserByEmail(sessionEmail);
            if (user) {
                userId = user.id;
            }
        }

        // Allow CRM admin user (hardcoded ID) or any logged-in user
        const isAdminUser = userId === '00000000-0000-0000-0000-000000000001';

        if (!userId && !isAdminUser) {
            return NextResponse.json(
                { error: 'Not authenticated' },
                { status: 401 }
            );
        }

        console.log('[API] Running ticket-CRM sync...');

        // Run the sync
        const result = await syncTicketsWithCrmEmails();

        return NextResponse.json({
            success: true,
            message: `Sync complete. Checked ${result.totalChecked} tickets.`,
            ...result,
        });
    } catch (error) {
        console.error('Error syncing tickets:', error);
        return NextResponse.json(
            { error: 'Failed to sync tickets', details: (error as Error).message },
            { status: 500 }
        );
    }
}
