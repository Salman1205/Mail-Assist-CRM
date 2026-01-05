/**
 * Returns the authenticated user's profile info
 */

import { NextResponse } from 'next/server';
import { getValidTokens } from '@/lib/token-refresh';
import { getUserProfile } from '@/lib/gmail';
import { cookies } from 'next/headers';

export async function GET() {
  try {
    // 1. Try to get user from business session first
    const { getCurrentUser } = await import('@/lib/session');
    const user = await getCurrentUser();

    if (user) {
      return NextResponse.json({
        emailAddress: user.email,
        displayName: user.name,
        picture: null, // Business users might not have a picture yet
        role: user.role,
        businessName: user.businessName
      });
    }

    // 2. Check for CRM admin user (hardcoded admin mode)
    const cookieStore = await cookies();
    const userId = cookieStore.get('current_user_id')?.value;
    if (userId === '00000000-0000-0000-0000-000000000001') {
      return NextResponse.json({
        emailAddress: 'admin@crm.local',
        displayName: 'CRM Admin',
        picture: null,
        role: 'admin',
        businessName: 'CRM'
      });
    }

    // 3. Fall back to Gmail tokens (legacy flow)
    const tokens = await getValidTokens();

    if (!tokens || !tokens.access_token) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const profile = await getUserProfile(tokens);
    return NextResponse.json(profile);
  } catch (error) {
    console.error('Error fetching profile:', error);
    return NextResponse.json(
      { error: 'Failed to fetch profile', details: (error as Error).message },
      { status: 500 }
    );
  }
}

































