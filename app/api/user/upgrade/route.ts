import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getCurrentUser } from '@/lib/session';

// Initialize Supabase client with service role for admin actions
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser();

        if (!user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        if (user.businessId) {
            return NextResponse.json({ error: 'User is already in a business plan' }, { status: 400 });
        }

        // 1. Check if a business already exists for this email
        const { data: existingBusiness } = await supabase
            .from('businesses')
            .select('*')
            .eq('business_email', user.email)
            .maybeSingle();

        let business;

        if (existingBusiness) {
            // Reuse existing business
            business = existingBusiness;
            console.log('Reusing existing business:', business.id);
        } else {
            // Create a new business for this user
            const businessName = `${user.name}'s Business`;
            const { data: newBusiness, error: businessError } = await supabase
                .from('businesses')
                .insert({
                    business_name: businessName,
                    business_email: user.email,
                    owner_name: user.name,
                    subscription_tier: 'free', // Start on free tier
                    is_email_verified: true, // Already verified via user account
                })
                .select()
                .single();

            if (businessError) {
                console.error('Error creating business:', businessError);
                return NextResponse.json({ error: 'Failed to create business account' }, { status: 500 });
            }

            business = newBusiness;
            console.log('Created new business:', business.id);
        }

        // 2. Update user to link to this business and set role to admin
        const { error: userError } = await supabase
            .from('users')
            .update({
                business_id: business.id,
                role: 'admin',
            })
            .eq('id', user.id);

        if (userError) {
            console.error('Error updating user:', userError);
            return NextResponse.json({ error: 'Failed to update user profile' }, { status: 500 });
        }

        // 3. Update current session to reflect new business_id
        // We need to find the active session and update it
        const cookieStore = await cookies();
        const sessionToken = cookieStore.get('session_token')?.value;

        if (sessionToken) {
            await supabase
                .from('user_sessions')
                .update({ business_id: business.id })
                .eq('session_token', sessionToken);
        }

        // 4. Migrate tokens (if any) to the new business
        // This ensures connected Gmail accounts stay connected
        await supabase
            .from('tokens')
            .update({ business_id: business.id })
            .eq('user_email', user.email)
            .is('business_id', null);

        return NextResponse.json({ success: true, business });

    } catch (error) {
        console.error('Error upgrading user:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
