/**
 * Admin Login API Endpoint
 * Validates hardcoded admin credentials and creates session
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Hardcoded admin credentials (will be replaced with Microsoft Entra later)
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'crm-admin-2025';

// Admin user object - Using valid UUID format for Supabase compatibility
const ADMIN_USER = {
    id: '00000000-0000-0000-0000-000000000001', // Valid UUID for admin
    name: 'Administrator',
    email: 'admin@theinsolvencygroup.com',
    role: 'admin',
};

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { username, password } = body;

        // Validate credentials
        if (!username || !password) {
            return NextResponse.json(
                { error: 'Username and password are required' },
                { status: 400 }
            );
        }

        // Check against hardcoded credentials
        if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
            return NextResponse.json(
                { error: 'Invalid username or password' },
                { status: 401 }
            );
        }

        // Create session cookie
        const sessionData = {
            userId: ADMIN_USER.id,
            userName: ADMIN_USER.name,
            userEmail: ADMIN_USER.email,
            userRole: ADMIN_USER.role,
            loginAt: Date.now(),
        };

        const sessionToken = Buffer.from(JSON.stringify(sessionData)).toString('base64');

        // Set cookie with session token
        const cookieStore = await cookies();
        cookieStore.set('crm_admin_session', sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7, // 7 days
            path: '/',
        });

        // Also set a simple current user cookie for compatibility
        cookieStore.set('current_user_id', ADMIN_USER.id, {
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7,
            path: '/',
        });

        return NextResponse.json({
            success: true,
            user: ADMIN_USER,
        });
    } catch (error) {
        console.error('[Admin Login] Error:', error);
        return NextResponse.json(
            { error: 'Login failed. Please try again.' },
            { status: 500 }
        );
    }
}
