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

        if (!user.businessId) {
            return NextResponse.json({ error: 'User is already on a personal plan' }, { status: 400 });
        }

        // 1. Check if there are other users in this business
        // We can't downgrade if there are other team members relying on this business account
        const { count, error: countError } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .eq('business_id', user.businessId)
            .neq('id', user.id); // Exclude current user

        if (countError) {
            console.error('Error checking team members:', countError);
            return NextResponse.json({ error: 'Failed to verify team status' }, { status: 500 });
        }

        if (count && count > 0) {
            return NextResponse.json({
                error: 'Cannot downgrade while other team members exist. Please remove them first.'
            }, { status: 400 });
        }

        // 2. Unlink user from business (set business_id to NULL)
        // Also reset role to 'user' (default for personal)
        const { error: userError } = await supabase
            .from('users')
            .update({
                business_id: null,
                role: 'user',
            })
            .eq('id', user.id);

        if (userError) {
            console.error('Error updating user:', userError);
            return NextResponse.json({ error: 'Failed to update user profile' }, { status: 500 });
        }

        // 3. Update current session to remove business_id
        const cookieStore = await cookies();
        const sessionToken = cookieStore.get('session_token')?.value;

        if (sessionToken) {
            await supabase
                .from('user_sessions')
                .update({ business_id: null })
                .eq('session_token', sessionToken);
        }

        // 4. Migrate tokens to personal (set business_id to NULL)
        // Use user_email as primary filter to catch all tokens
        await supabase
            .from('tokens')
            .update({ business_id: null })
            .eq('user_email', user.email);

        // 5. Delete the business record (since it's now empty)
        // This cleans up the database
        await supabase
            .from('businesses')
            .delete()
            .eq('id', user.businessId);

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Error downgrading user:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
