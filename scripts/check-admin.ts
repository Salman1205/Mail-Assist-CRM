
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load env vars manually
const envPath = path.resolve(process.cwd(), '.env.local');
let supabaseUrl = '';
let supabaseKey = '';

if (fs.existsSync(envPath)) {
    const fileContent = fs.readFileSync(envPath, 'utf-8');
    fileContent.split('\n').forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;
        const idx = line.indexOf('=');
        if (idx === -1) return;
        const key = line.substring(0, idx).trim();
        let val = line.substring(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.substring(1, val.length - 1);
        }
        if (key === 'SUPABASE_URL') supabaseUrl = val;
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') supabaseKey = val;
        if (key === 'NEXT_PUBLIC_SUPABASE_ANON_KEY' && !supabaseKey) supabaseKey = val;
    });
}

if (!supabaseUrl || !supabaseKey) {
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    const adminId = '00000000-0000-0000-0000-000000000001';
    console.log(`Checking for User ID: ${adminId}`);

    const { data, error } = await supabase
        .from('users')
        .select('id, name')
        .eq('id', adminId)
        .maybeSingle();

    if (error) {
        console.error('Error fetching user:', error);
    } else if (data) {
        console.log('User FOUND:', data);
    } else {
        console.log('User NOT FOUND.');
    }

    // Also check if we can insert a view for a fake ID (should fail)
    if (!data) {
        console.log('Attempting upsert with non-existent user (expecting FK error)...');
        // Need a valid ticket ID first
        const { data: tickets } = await supabase.from('tickets').select('id').limit(1);
        if (tickets && tickets.length > 0) {
            const { error: upsertError } = await supabase.from('ticket_views').upsert({
                user_id: adminId,
                ticket_id: tickets[0].id,
                last_viewed_at: new Date().toISOString()
            });
            if (upsertError) {
                console.log('Upsert failed as expected:', upsertError.code, upsertError.message);
            } else {
                console.log('Upsert SUCCEEDED ?? This implies no FK constraint or check disabled.');
            }
        }
    }
}

test();
