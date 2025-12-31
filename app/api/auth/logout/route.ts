/**
 * Logout endpoint - clears stored tokens and all user data
 */

import { NextResponse } from 'next/server';
import { clearAllData } from '@/lib/storage';
import { clearSessionInResponse, getSessionUserEmail } from '@/lib/session';

export async function POST() {
  try {
    // Get user email from session before clearing
    const userEmail = await getSessionUserEmail();

    // Clear all user data
    await clearAllData();

    // Create response
    const response = NextResponse.json({
      success: true,
      message: 'Logged out successfully. All data cleared.'
    });

    // CRITICAL: Clear session cookie to prevent access to this user's data
    clearSessionInResponse(response);

    // Also clear CRM admin session cookie
    response.cookies.delete('crm_admin_session');
    response.cookies.delete('current_user_id');

    return response;
  } catch (error) {
    console.error('Error during logout:', error);
    const response = NextResponse.json(
      { error: 'Failed to logout', details: (error as Error).message },
      { status: 500 }
    );
    // Still try to clear session cookies even if there was an error
    clearSessionInResponse(response);
    response.cookies.delete('crm_admin_session');
    response.cookies.delete('current_user_id');
    return response;
  }
}


