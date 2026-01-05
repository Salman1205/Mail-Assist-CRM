import { supabase } from './supabase';
import { getCurrentUserEmail } from './storage';

export type TicketStatus = 'open' | 'pending' | 'on_hold' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketSourceStatus = 'active' | 'archived_external';

export interface Ticket {
  id: string;
  threadId: string;
  customerEmail: string;
  customerName?: string | null;
  subject: string;
  status: TicketStatus;
  priority?: TicketPriority | null; // Optional - only set when ticket is assigned
  assignee?: string | null; // Legacy field (deprecated)
  assigneeUserId?: string | null; // New field - UUID of assigned user
  assigneeName?: string | null; // Name of assigned user (for display)
  tags: string[];
  lastCustomerReplyAt?: string | null;
  lastAgentReplyAt?: string | null;
  createdAt: string;
  updatedAt: string;
  ownerEmail?: string; // The account that this ticket belongs to
  userEmail?: string; // Scoping email for this ticket
  departmentId?: string | null; // Department assignment
  departmentName?: string | null; // Department name (for display)
  classificationConfidence?: number | null; // AI classification confidence (0-100)
  lastViewedAt?: string | null; // User specific view timestamp
  sourceStatus?: TicketSourceStatus; // Whether CRM email still exists ('active' | 'archived_external')
}

export interface TicketSeed {
  subject: string;
  customerEmail: string;
  customerName?: string | null;
  initialStatus?: TicketStatus;
  priority?: TicketPriority;
  tags?: string[];
  lastCustomerReplyAt?: string;
  lastAgentReplyAt?: string;
}

// Lightweight email shape used when creating/updating tickets
export interface TicketEmailLike {
  id: string;
  threadId?: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body?: string;
  snippet?: string;
  attachments?: { id: string; filename: string; mimeType: string; size: number }[];
}

function mapRowToTicket(row: any, currentUserId: string | null = null): Ticket {
  // Extract lastViewedAt from nested ticket_views if available
  // Since we fetch all views (to avoid PostgREST filter issues), we must filter by currentUserId here
  let lastViewedAt = null;
  // console.log(`[TicketMapper] Row ID: ${row.id}, ticket_views:`, row.ticket_views, 'CurrentUserID:', currentUserId);

  if (row.ticket_views && Array.isArray(row.ticket_views) && row.ticket_views.length > 0) {
    if (currentUserId) {
      // Find the view belonging to the current user
      const userView = row.ticket_views.find((v: any) => v.user_id === currentUserId);
      if (userView) {
        lastViewedAt = userView.last_viewed_at;
      }
    } else {
      // Fallback: take the first one? No, if no user, no view state.
      // But maybe for debugging take first? Safer to be null.
    }
  }

  return {
    id: row.id,
    threadId: row.thread_id,
    customerEmail: row.customer_email,
    customerName: row.customer_name,
    subject: row.subject,
    status: (row.status || 'open') as TicketStatus,
    priority: (row.priority || null) as TicketPriority | null,
    assignee: row.assignee, // Legacy field
    assigneeUserId: row.assignee_user_id || null,
    assigneeName: row.assignee_name || null, // Joined from users table
    tags: row.tags || [],
    lastCustomerReplyAt: row.last_customer_reply_at,
    lastAgentReplyAt: row.last_agent_reply_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownerEmail: row.owner_email,
    userEmail: row.user_email,
    departmentId: row.department_id || null,
    departmentName: row.department_name || null, // Joined from departments table
    classificationConfidence: row.classification_confidence || null,
    lastViewedAt,
    sourceStatus: (row.source_status || 'active') as TicketSourceStatus,
  };
}

export async function getTicketByThreadId(
  threadId: string,
  userEmail: string | null
): Promise<Ticket | null> {
  if (!supabase) return null;

  let query = supabase
    .from('tickets')
    .select('*')
    .eq('thread_id', threadId)

  if (userEmail) {
    query = query.eq('user_email', userEmail)
  }

  const { data, error } = await query.limit(1).maybeSingle()

  if (error) {
    console.error('Error fetching ticket by thread_id:', error);
    return null;
  }

  if (!data) return null;

  return mapRowToTicket(data);
}

export async function getOrCreateTicketForThread(
  threadId: string,
  seed: TicketSeed,
  emailBody?: string // Optional: email body for classification
): Promise<Ticket | null> {
  if (!supabase) return null;

  const userEmail = await getCurrentUserEmail();

  // 1) Check if ticket already exists
  const existing = await getTicketByThreadId(threadId, userEmail);
  if (existing) {
    return existing;
  }

  const nowIso = new Date().toISOString();

  const payload: any = {
    thread_id: threadId,
    customer_email: seed.customerEmail,
    customer_name: seed.customerName ?? null,
    subject: seed.subject,
    status: seed.initialStatus ?? 'open',
    priority: seed.priority ?? null, // Don't set priority for unassigned tickets
    assignee: null, // Legacy field
    assignee_user_id: null, // New tickets are unassigned
    tags: seed.tags ?? [],
    last_customer_reply_at: seed.lastCustomerReplyAt ?? null,
    last_agent_reply_at: seed.lastAgentReplyAt ?? null,
    created_at: nowIso,
    updated_at: nowIso,
    owner_email: userEmail, // Default to current user email as owner
  };

  if (userEmail) {
    payload.user_email = userEmail;
  }

  /* 
    Retry logic for race conditions:
    If insert fails with unique constraint violation (likely thread_id), 
    it means another process created it just now. Fetch and return that one.
  */
  let data, error;

  try {
    const result = await supabase
      .from('tickets')
      .insert(payload)
      .select('*')
      .maybeSingle();

    data = result.data;
    error = result.error;
  } catch (err) {
    // Supabase JS might throw, or return error object. 
    // Usually it returns error object, but let's be safe.
    console.warn('Exception during ticket insert:', err);
  }

  if (error) {
    // Check for unique violation (Postgres code 23505)
    if (error.code === '23505') {
      console.log(`[Ticket] Race condition detected for thread ${threadId}. Fetching existing ticket.`);
      const existingTicket = await getTicketByThreadId(threadId, userEmail);
      if (existingTicket) {
        return existingTicket;
      }
      // If still not found (weird), fall through to error logging
    }

    console.error('Error creating ticket:', error);
    console.error('Ticket payload:', payload);
    return null;
  }

  if (!data) {
    // Check if it exists now (rare edge case)
    const existing = await getTicketByThreadId(threadId, userEmail);
    if (existing) return existing;

    console.warn('No data returned when creating ticket for thread:', threadId);
    return null;
  }

  console.log(`[Ticket] Successfully created ticket ${data.id} for thread ${threadId}`);

  const ticket = mapRowToTicket(data);

  // 2) Classify ticket to department (async, non-blocking)
  // 2) Classify ticket to department (async, non-blocking)

  if (emailBody) {
    classifyTicketToDepartmentAsync(ticket.id, seed.subject, emailBody, userEmail).catch(err => {
      console.error('[Ticket] Department classification failed (non-blocking):', err);
    });
  }


  return ticket;
}

/**
 * Classify a ticket to a department using AI (async, non-blocking)
 * This runs in the background and updates the ticket after classification
 */
export async function classifyTicketToDepartmentAsync(
  ticketId: string,
  subject: string,
  body: string,
  userEmail: string | null
): Promise<void> {
  try {
    // Determine account scope
    const { getCurrentUser } = await import('./session');
    const currentUser = await getCurrentUser();
    const businessId = currentUser?.businessId || null;
    const scopeEmail = businessId ? null : (userEmail || null);

    // Get all departments for this account
    const { getAllDepartments } = await import('./departments');
    const departments = await getAllDepartments(scopeEmail, businessId);

    if (!departments || departments.length === 0) {
      console.log('[Ticket] No departments configured, skipping classification');
      return;
    }

    // Get Groq API key for classification
    const { getGroqApiKey, classifyEmailWithFallback } = await import('./department-classifier');
    const groqApiKey = getGroqApiKey();

    if (!groqApiKey) {
      console.warn('[Ticket] GROQ_API_KEY not configured, skipping AI classification');
      return;
    }

    // Perform classification
    const result = await classifyEmailWithFallback(
      { subject, body },
      departments,
      groqApiKey,
      scopeEmail,
      businessId
    );

    console.log('[Ticket] Classification result:', result);

    // Update ticket with department assignment
    if (result.departmentId) {
      await supabase
        ?.from('tickets')
        .update({
          department_id: result.departmentId,
          classification_confidence: result.confidence,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ticketId);

      console.log(`[Ticket] Assigned ticket ${ticketId} to department ${result.departmentName} (${result.confidence}% confidence)`);
    } else {
      // Store classification attempt even if no department matched
      await supabase
        ?.from('tickets')
        .update({
          classification_confidence: result.confidence,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ticketId);

      console.log(`[Ticket] Ticket ${ticketId} left unclassified (low confidence: ${result.confidence}%)`);
    }
  } catch (error) {
    console.error('[Ticket] Error in async department classification:', error);
    // Don't throw - this is a background task and shouldn't break ticket creation
  }
}


/**
 * Ensure there is a ticket row for a given email, and update
 * last_customer_reply_at / last_agent_reply_at based on who sent it.
 *
 * isFromAgent:
 * - true  => update last_agent_reply_at, set status to 'pending' (or keep if closed/on_hold)
 * - false => update last_customer_reply_at, set status to 'open'
 */
export async function ensureTicketForEmail(
  email: TicketEmailLike,
  isFromAgent: boolean
): Promise<Ticket | null> {
  if (!supabase) return null;

  const userEmail = await getCurrentUserEmail();
  const threadId = email.threadId || email.id;
  const dateIso = new Date(email.date).toISOString();

  // Guess customer email based on direction
  const customerEmail = isFromAgent ? email.to : email.from;

  // Sync email to Supabase 'emails' table for persistence
  if (email.body || email.snippet) {
    try {
      await supabase.from('emails').upsert({
        id: email.id,
        thread_id: threadId,
        subject: email.subject,
        from_address: email.from,
        to_address: email.to,
        body: email.body || email.snippet || '',
        date: dateIso,
        is_sent: isFromAgent,
        is_reply: false, // Can't easily determine this here, assume false for now
        user_email: userEmail,
        labels: ['INBOX'], // Default label
      });
      // console.log(`[Ticket] Synced email ${email.id} to Supabase`);
    } catch (err) {
      console.warn('Failed to sync email to Supabase:', err);
    }
  }

  // Try to find existing ticket
  let ticket = await getTicketByThreadId(threadId, userEmail);

  if (!ticket) {
    // Create new ticket using this email as seed
    ticket = await getOrCreateTicketForThread(threadId, {
      subject: email.subject,
      customerEmail,
      customerName: null,
      initialStatus: isFromAgent ? 'pending' : 'open',
      priority: undefined, // Don't set priority for unassigned tickets
      tags: [],
      lastCustomerReplyAt: isFromAgent ? undefined : dateIso,
      lastAgentReplyAt: isFromAgent ? dateIso : undefined,
    })!;
    if (ticket) {
      console.log(`[Ticket] Created ticket ${ticket.id} for email ${email.id}`, {
        threadId,
        lastCustomerReplyAt: ticket.lastCustomerReplyAt,
        createdAt: ticket.createdAt,
        dateIso
      });
    }
    return ticket;
  }

  // Update existing ticket
  const updates: any = {
    updated_at: dateIso,
  };

  if (isFromAgent) {
    updates.last_agent_reply_at = dateIso;

    // Only bump to pending if ticket is not closed or on hold
    if (ticket.status === 'open' || ticket.status === 'pending') {
      updates.status = 'pending';
    }
  } else {
    updates.last_customer_reply_at = dateIso;
    // Always re-open if customer replies, even if closed
    if (ticket.status === 'closed') {
      console.log(`[Ticket] Auto-reopening closed ticket ${ticket.id} due to customer reply`);
      updates.status = 'open';
    } else {
      updates.status = 'open';
    }
  }

  if (userEmail) {
    updates.user_email = userEmail;
  }

  let query = supabase
    .from('tickets')
    .update(updates)
    .eq('thread_id', threadId);

  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  const { data, error } = await query
    .select('*')
    .limit(1); // Use limit(1) instead of maybeSingle to handle duplicate tickets gracefully

  if (error) {
    console.error('Error updating ticket timestamps:', error);
    return ticket;
  }

  if (!data || data.length === 0) return ticket;

  const updatedTicket = mapRowToTicket(data[0]);

  // Emit realtime signal (best-effort; non-blocking)
  try {
    await supabase
      .from('ticket_updates')
      .insert({
        ticket_id: updatedTicket.id,
        user_email: userEmail || null,
        last_customer_reply_at: updatedTicket.lastCustomerReplyAt,
      });
  } catch (signalError) {
    console.warn('ticket_updates insert failed (non-blocking):', signalError);
  }

  return updatedTicket;
}

/**
 * Get tickets with role-based filtering
 * - Agents: see only their own tickets + unassigned tickets
 * - Admin/Manager: see all tickets for the shared Gmail account
 * - includeArchived: if false (default), only returns active tickets
 */
export async function getTickets(
  currentUserId: string | null,
  canViewAll: boolean,
  userEmail: string | null,
  accountFilter?: string,
  businessId?: string | null,
  includeArchived: boolean = false
): Promise<Ticket[]> {
  if (!supabase) return [];

  // OPTIMIZED: Use JOIN to fetch assignee names in a single query (much faster)
  // This eliminates the N+1 query problem
  let query = supabase
    .from('tickets')
    .select(`
      *,
      assignee:users!tickets_assignee_user_id_fkey(id, name),
      department:departments(id, name),
      ticket_views(user_id, last_viewed_at)
    `);

  // Filter by source_status (active by default, unless includeArchived is true)
  if (!includeArchived) {
    query = query.or('source_status.eq.active,source_status.is.null');
  }

  // Note: We are now fetching ALL views and filtering in JS (mapRowToTicket) 
  // because embedded filtering can sometimes be tricky with left joins/inner joins.
  // This is safer for data correctness even if slightly more bandwidth.
  // if (currentUserId) {
  //   query = query.eq('ticket_views.user_id', currentUserId);
  // }

  // Filter by Gmail account (the primary account scoping)
  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  // Filter by specific connected account if provided
  if (accountFilter) {
    query = query.eq('owner_email', accountFilter);
  }

  // Role-based filtering
  if (!canViewAll && currentUserId) {
    // Agent filtering logic:
    // 1. Tickets specifically assigned to this agent
    // 2. Unassigned tickets that belong to one of the agent's departments

    // First, fetch the user's assigned departments
    const { data: userDepts } = await supabase
      .from('user_departments')
      .select('department_id')
      .eq('user_id', currentUserId);

    const deptIds = userDepts?.map(ud => ud.department_id) || [];

    if (deptIds.length > 0) {
      // If agent has departments, they see: (assigned to them) OR (unassigned AND in their dept)
      query = query.or(`assignee_user_id.eq.${currentUserId},and(assignee_user_id.is.null,department_id.in.(${deptIds.join(',')}))`);
    } else {
      // If agent has no departments, they only see tickets assigned to them
      query = query.eq('assignee_user_id', currentUserId);
    }
  }
  // Admin/Manager: see all (no additional filter)

  // Order by last_customer_reply_at ascending (oldest customer-waiting first)
  // Tickets that have been waiting longest (oldest last_customer_reply_at) are at the top
  // When a customer replies, last_customer_reply_at updates to now, moving ticket down
  // Tickets with null last_customer_reply_at go to the end
  query = query.order('last_customer_reply_at', { ascending: true, nullsFirst: false });

  // OPTIMIZED: Add limit to prevent fetching too many tickets at once
  // Most users won't need more than 500 tickets in their view
  query = query.limit(500);

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching tickets:', error);
    // Fallback to simple query if JOIN fails (backward compatibility)
    return getTicketsFallback(currentUserId, canViewAll, userEmail);
  }

  if (!data) return [];

  // Map rows to tickets, extracting assignee name from JOIN
  return data.map((row: any) => {
    const ticket = mapRowToTicket(row, currentUserId);
    // Extract assignee name from joined users table
    if (row.assignee && typeof row.assignee === 'object' && row.assignee.name) {
      ticket.assigneeName = row.assignee.name;
    }
    // Extract department name from joined departments table
    if (row.department && typeof row.department === 'object' && row.department.name) {
      ticket.departmentName = row.department.name;
    }
    return ticket;
  });
}

// Fallback method if JOIN fails (backward compatibility)
async function getTicketsFallback(
  currentUserId: string | null,
  canViewAll: boolean,
  userEmail: string | null
): Promise<Ticket[]> {
  if (!supabase) return [];

  let query = supabase
    .from('tickets')
    .select('*');

  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  if (!canViewAll && currentUserId) {
    query = query.or(`assignee_user_id.eq.${currentUserId},assignee_user_id.is.null`);
  }

  query = query.order('last_customer_reply_at', { ascending: true, nullsFirst: false }).limit(500);

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching tickets (fallback):', error);
    return [];
  }

  if (!data) return [];

  // Fetch assignee names separately (original method)
  const assigneeUserIds = data
    .map((row: any) => row.assignee_user_id)
    .filter((id: string | null) => id !== null) as string[];

  const assigneeMap = new Map<string, string>();
  if (assigneeUserIds.length > 0 && supabase) {
    try {
      const { data: users } = await supabase
        .from('users')
        .select('id, name')
        .in('id', assigneeUserIds);

      if (users) {
        users.forEach((user: any) => {
          assigneeMap.set(user.id, user.name);
        });
      }
    } catch (err) {
      console.error('Error fetching assignee names:', err);
    }
  }

  return data.map((row: any) => {
    const ticket = mapRowToTicket(row);
    if (row.assignee_user_id && assigneeMap.has(row.assignee_user_id)) {
      ticket.assigneeName = assigneeMap.get(row.assignee_user_id) || null;
    }
    return ticket;
  });
}

/**
 * Get a single ticket by ID
 */
export async function getTicketById(
  ticketId: string,
  currentUserId: string | null,
  canViewAll: boolean,
  userEmail: string | null
): Promise<Ticket | null> {
  if (!supabase) return null;

  let query = supabase
    .from('tickets')
    .select(`
      *,
      department:departments(id, name)
    `)
    .eq('id', ticketId)

  // Filter by Gmail account
  if (userEmail) {
    query = query.eq('user_email', userEmail)
  }

  const { data, error } = await query.limit(1).maybeSingle()

  if (error) {
    console.error('Error fetching ticket by ID:', error);
    return null;
  }

  if (!data) return null;

  // Check permissions: Agents can only view their own tickets or unassigned
  if (!canViewAll && currentUserId) {
    const assigneeUserId = data.assignee_user_id;
    if (assigneeUserId && assigneeUserId !== currentUserId) {
      // Agent trying to view someone else's assigned ticket
      return null;
    }
  }

  const ticket = mapRowToTicket(data);

  // Extract department name from JOIN
  if (data.department && typeof data.department === 'object' && data.department.name) {
    ticket.departmentName = data.department.name;
  }

  // Fetch assignee name if ticket is assigned
  if (data.assignee_user_id && supabase) {
    try {
      const { data: user } = await supabase
        .from('users')
        .select('name')
        .eq('id', data.assignee_user_id)
        .limit(1)
        .maybeSingle();

      if (user) {
        ticket.assigneeName = user.name;
      }
    } catch (err) {
      console.error('Error fetching assignee name:', err);
    }
  }

  return ticket;
}

/**
 * Assign a ticket to a user
 * @param ticketId - Ticket ID
 * @param assigneeUserId - User ID to assign to (null to unassign)
 * @param userEmail - Gmail account email for scoping
 */
export async function assignTicket(
  ticketId: string,
  assigneeUserId: string | null,
  userEmail: string | null,
  assignerUserId?: string | null
): Promise<Ticket | null> {
  if (!supabase) return null;

  const updates: any = {
    assignee_user_id: assigneeUserId,
    updated_at: new Date().toISOString(),
  };

  let query = supabase
    .from('tickets')
    .update(updates)
    .eq('id', ticketId)
    .select('*');

  // Filter by Gmail account for security
  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('Error assigning ticket:', error);
    return null;
  }

  if (!data) return null;

  const ticket = mapRowToTicket(data);
  // Create assignment notification if assigned to a user
  try {
    if (assigneeUserId) {
      let assignerName: string | undefined = undefined

      // Best-effort lookup of the assigning user's name when provided
      if (assignerUserId && supabase) {
        try {
          const { data: assigner } = await supabase
            .from('users')
            .select('name')
            .eq('id', assignerUserId)
            .limit(1)
            .maybeSingle()

          if (assigner?.name) {
            assignerName = assigner.name
          }
        } catch (lookupErr) {
          console.warn('Non-fatal: failed to fetch assigner name', lookupErr)
        }
      }

      const { createAssignmentNotification } = await import('./notifications')
      await createAssignmentNotification(ticketId, assigneeUserId, assignerName, assignerUserId || undefined)
    }
  } catch (err) {
    console.warn('Non-fatal: failed to create assignment notification', err)
  }

  // Fetch assignee name if ticket is assigned
  if (data.assignee_user_id && supabase) {
    try {
      const { data: user } = await supabase
        .from('users')
        .select('name')
        .eq('id', data.assignee_user_id)
        .limit(1)
        .maybeSingle();

      if (user) {
        ticket.assigneeName = user.name;
      }
    } catch (err) {
      console.error('Error fetching assignee name:', err);
    }
  }

  return ticket;
}

/**
 * Update ticket status
 */
export async function updateTicketStatus(
  ticketId: string,
  status: TicketStatus,
  userEmail: string | null
): Promise<Ticket | null> {
  if (!supabase) return null;

  const updates: any = {
    status,
    updated_at: new Date().toISOString(),
  };

  let query = supabase
    .from('tickets')
    .update(updates)
    .eq('id', ticketId)
    .select('*');

  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('Error updating ticket status:', error);
    return null;
  }

  if (!data) return null;

  return mapRowToTicket(data);
}

/**
 * Update ticket priority
 */
export async function updateTicketPriority(
  ticketId: string,
  priority: TicketPriority,
  userEmail: string | null
): Promise<Ticket | null> {
  if (!supabase) return null;

  const updates: any = {
    priority,
    updated_at: new Date().toISOString(),
  };

  let query = supabase
    .from('tickets')
    .update(updates)
    .eq('id', ticketId)
    .select('*');

  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('Error updating ticket priority:', error);
    return null;
  }

  if (!data) return null;

  return mapRowToTicket(data);
}

/**
 * Update ticket tags
 */
export async function updateTicketTags(
  ticketId: string,
  tags: string[],
  userEmail: string | null
): Promise<Ticket | null> {
  if (!supabase) return null;

  const updates: any = {
    tags,
    updated_at: new Date().toISOString(),
  };

  let query = supabase
    .from('tickets')
    .update(updates)
    .eq('id', ticketId)
    .select('*');

  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('Error updating ticket tags:', error);
    return null;
  }

  if (!data) return null;

  return mapRowToTicket(data);
}

/**
 * Sync tickets with CRM emails
 * Marks tickets as 'archived_external' if their CRM email no longer exists
 * Re-activates tickets if their CRM email reappears
 * 
 * @returns Object with counts of archived and reactivated tickets
 */
export async function syncTicketsWithCrmEmails(): Promise<{
  archivedCount: number;
  reactivatedCount: number;
  totalChecked: number;
}> {
  if (!supabase) {
    return { archivedCount: 0, reactivatedCount: 0, totalChecked: 0 };
  }

  try {
    console.log('[Ticket Sync] Starting sync with CRM emails...');

    // 1. Get all active CRM email IDs
    const { getCrmEmailIds } = await import('./crm-email-provider');
    const activeCrmIds = await getCrmEmailIds();

    // 2. Get all tickets from Supabase (we need thread_id to compare)
    const { data: tickets, error: fetchError } = await supabase
      .from('tickets')
      .select('id, thread_id, source_status');

    if (fetchError) {
      console.error('[Ticket Sync] Error fetching tickets:', fetchError);
      throw fetchError;
    }

    if (!tickets || tickets.length === 0) {
      console.log('[Ticket Sync] No tickets to sync');
      return { archivedCount: 0, reactivatedCount: 0, totalChecked: 0 };
    }

    // 3. Categorize tickets based on CRM presence
    const toArchive: string[] = []; // Ticket IDs to mark as archived
    const toReactivate: string[] = []; // Ticket IDs to mark as active

    for (const ticket of tickets) {
      const existsInCrm = activeCrmIds.has(ticket.thread_id);
      const currentStatus = ticket.source_status || 'active';

      if (!existsInCrm && currentStatus === 'active') {
        // CRM email no longer exists, archive the ticket
        toArchive.push(ticket.id);
      } else if (existsInCrm && currentStatus === 'archived_external') {
        // CRM email reappeared, reactivate the ticket
        toReactivate.push(ticket.id);
      }
    }

    // 4. Batch update tickets that need to be archived
    if (toArchive.length > 0) {
      const { error: archiveError } = await supabase
        .from('tickets')
        .update({
          source_status: 'archived_external',
          updated_at: new Date().toISOString(),
        })
        .in('id', toArchive);

      if (archiveError) {
        console.error('[Ticket Sync] Error archiving tickets:', archiveError);
      } else {
        console.log(`[Ticket Sync] Archived ${toArchive.length} tickets (CRM emails removed)`);
      }
    }

    // 5. Batch update tickets that need to be reactivated
    if (toReactivate.length > 0) {
      const { error: reactivateError } = await supabase
        .from('tickets')
        .update({
          source_status: 'active',
          updated_at: new Date().toISOString(),
        })
        .in('id', toReactivate);

      if (reactivateError) {
        console.error('[Ticket Sync] Error reactivating tickets:', reactivateError);
      } else {
        console.log(`[Ticket Sync] Reactivated ${toReactivate.length} tickets (CRM emails returned)`);
      }
    }

    console.log(`[Ticket Sync] Sync complete. Checked: ${tickets.length}, Archived: ${toArchive.length}, Reactivated: ${toReactivate.length}`);

    return {
      archivedCount: toArchive.length,
      reactivatedCount: toReactivate.length,
      totalChecked: tickets.length,
    };
  } catch (error) {
    console.error('[Ticket Sync] Error during sync:', error);
    throw error;
  }
}

