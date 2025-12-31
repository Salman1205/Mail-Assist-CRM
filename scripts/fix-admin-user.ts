
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

async function fix() {
    const adminId = '00000000-0000-0000-0000-000000000001';
    console.log(`Checking for User ID: ${adminId}`);

    const { data, error } = await supabase
        .from('users')
        .select('id')
        .eq('id', adminId)
        .maybeSingle();

    if (data) {
        console.log('Admin user already exists.');
        return;
    }

    console.log('Inserting Admin user...');
    const { error: insertError } = await supabase
        .from('users')
        .insert({
            id: adminId,
            name: 'CRM Admin',
            email: 'admin@crm.local',
            role: 'admin',
            is_active: true,
            user_email: 'admin@crm.local' // Placeholder
        });

    if (insertError) {
        console.error('Failed to insert Admin user:', insertError);
    } else {
        console.log('Admin user inserted successfully.');
    }
}

fix();
