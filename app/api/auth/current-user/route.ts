/**
 * Get current user from session
 * Supports both CRM admin session and legacy Gmail OAuth
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserEmailFromRequest, getCurrentUserIdFromRequest } from '@/lib/session';
import { getUserById } from '@/lib/users';
import { supabase } from '@/lib/supabase';

// Admin user object (same as in admin-login)
const ADMIN_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Administrator',
  email: 'admin@theinsolvencygroup.com',
  role: 'admin',
  businessId: null,
  businessName: 'The Insolvency Group',
  isActive: true,
};

export async function GET(request: NextRequest) {
  try {
    // FIRST: Check for CRM admin session
    const adminSessionCookie = request.cookies.get('crm_admin_session');
    if (adminSessionCookie) {
      try {
        const sessionData = JSON.parse(Buffer.from(adminSessionCookie.value, 'base64').toString('utf-8'));
        if (sessionData.userId === ADMIN_USER.id) {
          return NextResponse.json({ user: ADMIN_USER });
        }
      } catch (parseError) {
        console.error('[Current User] Invalid admin session cookie:', parseError);
        // Continue to legacy auth flow
      }
    }

    // LEGACY: Check for current_user_id cookie
    const userId = getCurrentUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'No user selected' },
        { status: 404 }
      );
    }

    // Special case: If userId is the admin ID, return admin user
    if (userId === ADMIN_USER.id) {
      return NextResponse.json({ user: ADMIN_USER });
    }

    // Get current Gmail account from session
    const sessionGmailEmail = getSessionUserEmailFromRequest(request);
    if (!sessionGmailEmail) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // CRITICAL: Verify user belongs to current Gmail account
    // For personal accounts, we allow the session Gmail to be different from the login email
    // as long as they are linked or it's a personal account (where the user IS the account)
    const isPersonalAccount = !user.businessId;
    const emailMatches = user.userEmail === sessionGmailEmail ||
      user.email === sessionGmailEmail ||
      (user as any).sharedGmailEmail === sessionGmailEmail;

    if (!emailMatches && !isPersonalAccount) {
      // For business accounts, the mismatch is still an error
      console.log('[Current User] Unauthorized access attempt:', { userId: user.id, userEmail: user.userEmail, sessionEmail: sessionGmailEmail });
      const response = NextResponse.json(
        { error: 'User does not belong to current account' },
        { status: 403 }
      );
      // Clear the invalid user ID cookie
      response.cookies.delete('current_user_id');
      return response;
    }

    // Get business name if user belongs to a business
    let businessName = null;
    if (user.businessId && supabase) {
      const { data: business } = await supabase
        .from('businesses')
        .select('name')
        .eq('id', user.businessId)
        .single();
      if (business) {
        businessName = business.name;
      }
    }

    // Return user with businessId and businessName explicitly set
    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessId: user.businessId,
        businessName: businessName, // Added businessName
        isActive: user.isActive,
      }
    });
  } catch (error) {
    console.error('Error fetching current user:', error);
    return NextResponse.json(
      { error: 'Failed to fetch current user', details: (error as Error).message },
      { status: 500 }
    );
  }
}

