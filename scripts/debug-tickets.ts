
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load env vars manually
const envPath = path.resolve(process.cwd(), '.env.local');
let supabaseUrl = '';
let supabaseKey = '';

console.log('Reading env from:', envPath);

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
    console.error('Missing Supabase env vars');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    console.log('Fetching users...');
    const { data: users } = await supabase.from('users').select('id, name').limit(1);
    if (!users?.length) { console.log('No users'); return; }

    const userId = users[0].id;
    console.log(`Using User ID: ${userId}`);

    console.log('Fetching one ticket...');
    const { data: tickets } = await supabase.from('tickets').select('id').limit(1);
    if (!tickets?.length) { console.log('No tickets'); return; }

    const ticketId = tickets[0].id;
    console.log(`Using Ticket ID: ${ticketId}`);

    console.log('Inserting view record...');
    const { error: upsertError } = await supabase
        .from('ticket_views')
        .upsert({
            user_id: userId,
            ticket_id: ticketId,
            last_viewed_at: new Date().toISOString()
        }, { onConflict: 'user_id,ticket_id' });

    if (upsertError) {
        console.error('Upsert failed:', upsertError);
        return;
    }
    console.log('Upsert successful.');

    console.log('Fetching ticket with views...');
    const { data: ticketData, error } = await supabase
        .from('tickets')
        .select(`
      *,
      ticket_views(user_id, last_viewed_at)
    `)
        .eq('id', ticketId)
        .single();

    if (error) {
        console.error('Fetch failed:', error);
    } else {
        console.log('Fetch successful.');
        const views = ticketData.ticket_views as any[];
        console.log('Views found:', views.length);
        console.log('Views:', JSON.stringify(views, null, 2));

        const myView = views.find(v => v.user_id === userId);
        if (myView) {
            console.log('SUCCESS: View record found for user.');
        } else {
            console.error('FAILURE: View record NOT found for user.');
        }
    }
}

test();
