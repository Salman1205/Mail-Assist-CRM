
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Define minimal Ticket interface for our needs
interface Ticket {
    id: string;
    thread_id: string;
    subject: string;
    created_at: string;
    updated_at: string;
    user_email: string | null;
}

async function main() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error("Missing Supabase credentials");
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("Fetching all tickets to identify duplicates...");

    // We fetch all tickets ordered by thread_id to easier grouping
    // Assuming table size isn't massive. If >10k, we might need pagination.
    // For now, let's assume it fits in memory or use pagination.

    // A better approach for specific known duplicates is to just handle them, 
    // but a general cleanup is safer.

    // Let's implement robust pagination
    let allTickets: Ticket[] = [];
    let page = 0;
    const pageSize = 1000;

    while (true) {
        const { data, error } = await supabase
            .from('tickets')
            .select('id, thread_id, subject, created_at, updated_at, user_email')
            .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
            console.error("Error fetching tickets:", error);
            process.exit(1);
        }

        if (!data || data.length === 0) break;

        allTickets = allTickets.concat(data);
        console.log(`Fetched ${data.length} tickets (Total: ${allTickets.length})`);

        if (data.length < pageSize) break;
        page++;
    }

    console.log(`Total tickets processed: ${allTickets.length}`);

    // Group by thread_id + user_email (if user_email exists)
    // Actually, thread_id should be unique PER USER_EMAIL if present, or GLOBAL if not?
    // Current logic in tickets.ts seems to treat thread_id as unique.

    const groups = new Map<string, Ticket[]>();

    allTickets.forEach(t => {
        // Unique key: thread_id + (user_email || 'null')
        // Or just thread_id? The duplicates we saw had formatted output, but seemed global.
        // Let's stick to thread_id for now as that's what we saw duplicated.
        // If multiple tickets share thread_id but DIFFERENT user_email, they might be valid (sharing).
        // But the duplicates we saw had user_email: null.

        const key = `${t.thread_id}::${t.user_email || 'null'}`;
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(t);
    });

    let duplicatesFound = 0;
    let recordsToDelete: string[] = [];

    for (const [key, tickets] of groups.entries()) {
        if (tickets.length > 1) {
            duplicatesFound++;
            console.log(`Found duplicate group for ${key} (Count: ${tickets.length})`);

            // Sort by updated_at DESC (keep the most recently active one)
            // Or sort by ID? 
            // Usually we want to keep the one that has the most data or recent activity.
            tickets.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

            const toKeep = tickets[0];
            const toDelete = tickets.slice(1);

            console.log(`  Keeping: ${toKeep.id} (Updated: ${toKeep.updated_at})`);
            toDelete.forEach(t => {
                console.log(`  Deleting: ${t.id} (Updated: ${t.updated_at})`);
                recordsToDelete.push(t.id);
            });
        }
    }

    console.log(`\nDuplicate Groups Found: ${duplicatesFound}`);
    console.log(`Records marked for deletion: ${recordsToDelete.length}`);

    if (recordsToDelete.length > 0) {
        console.log("Deleting records...");

        // Delete in batches
        const batchSize = 50;
        for (let i = 0; i < recordsToDelete.length; i += batchSize) {
            const batch = recordsToDelete.slice(i, i + batchSize);
            const { error } = await supabase
                .from('tickets')
                .delete()
                .in('id', batch);

            if (error) {
                console.error(`Error deleting batch ${i}:`, error);
            } else {
                console.log(`Deleted batch ${i / batchSize + 1} (${batch.length} records)`);
            }
        }
        console.log("Cleanup complete.");
    } else {
        console.log("No duplicates to delete.");
    }
}

main();
