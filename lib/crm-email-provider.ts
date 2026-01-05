/**
 * CRM Email Provider
 * Fetches emails from the company's MySQL CRM database
 */

import { query } from './mysql';

// Interface matching the expected email format
export interface CrmEmail {
    id: string;                    // crm_message_id
    threadId: string;              // Same as id (single messages in CRM)
    subject: string;
    from: string;                  // email_from
    to: string;                    // mailto (mailbox username)
    body: string;                  // content
    snippet: string;               // First 200 chars of content
    date: string;                  // Received_On
    labels: string[];              // Array including 'INBOX'
    clientId: number | null;
    type: string | null;
    department: string | null;     // Complaint classification
    assignedTo: string;
    arrearsStatus: string;
    assignment: string;
    isRead?: boolean;
    attachments?: { id: string; filename: string; mimeType: string; size: number }[];
}

// Raw row type from MySQL query
interface CrmEmailRow {
    crm_message_id: number;
    clientid: number | null;
    Client: string;
    email_from: string;
    mailto: string;
    subject: string;
    content: string;
    Received_On: string | Date;
    Arrears_Status: string;
    AssignedTo: string;
    Type: string | null;
    Assignment: string;
    Department: string | null;
}

/**
 * SQL Query for fetching unassigned emails from CRM
 */
const CRM_EMAIL_QUERY = `
SELECT 
  mr.id as crm_message_id,
  mr.clientid, 
  '-' AS Client, 
  SUBSTRING_INDEX(IFNULL(mr.email_from, ' '), ':', -1) AS email_from, 
  SUBSTRING_INDEX(IFNULL(mr.mailbox_username, ' '), '@', 1) AS mailto, 
  IFNULL(mr.subject, ' ') AS subject, 
  IFNULL(mr.content, ' ') AS content,
  CONVERT_TZ(FROM_UNIXTIME(mr.received_on), 'UTC', 'Europe/London') AS Received_On,
  ' ' AS Arrears_Status,
  '-' AS AssignedTo,
  mr.Type,
  'Unassigned' AS Assignment,
  CASE 
    WHEN LOWER(mr.subject) LIKE '%complaining%' OR LOWER(mr.subject) LIKE '%complaint%' OR LOWER(mr.subject) LIKE '%Dissatisfied%' OR
         LOWER(mr.content) LIKE '%complaining%' OR LOWER(mr.content) LIKE '%complaint%' OR LOWER(mr.content) LIKE '%Dissatisfied%'
    THEN 'Complaints'
    ELSE NULL 
  END AS Department
FROM theinsolvencygroup.message_received mr
WHERE mr.archived = 0
  AND (mr.clientid IS NULL OR mr.clientid = 0)
  AND (mr.email_from <> 'MAILER-DAEMON@eu-west-1.amazonses.com:MAILER-DAEMON@eu-west-1.amazonses.com' OR mr.email_from IS NULL)   
  AND (mr.subject NOT LIKE 'Auto%' AND mr.subject NOT LIKE '%Auto%' AND mr.subject NOT LIKE '%Acknowledgement%' AND mr.subject NOT LIKE 'Acknowledgement%' OR mr.subject IS NULL)
  AND YEAR(FROM_UNIXTIME(mr.received_on)) != 1970
ORDER BY Received_On DESC
LIMIT ?
`;

/**
 * Strip HTML tags from content while preserving basic structure
 */
function stripHtml(html: string): string {
    if (!html) return '';

    return html
        // Remove style and script blocks entirely
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<meta[^>]*>/gi, '')
        // Replace <br> and </p> with newlines
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        // Remove all other HTML tags
        .replace(/<[^>]*>/g, '')
        // Remove raw CSS fragments that might be left (e.g. from Outlook)
        .replace(/[a-z0-9\\:-]+\s*{[^}]*}/gi, '')
        .replace(/v\\?:[^*]*{[^}]*}/gi, '')
        .replace(/o\\?:[^*]*{[^}]*}/gi, '')
        .replace(/w\\?:[^*]*{[^}]*}/gi, '')
        // Decode common HTML entities
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        // Clean up excessive whitespace
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Create a snippet from email content
 */
function createSnippet(content: string, maxLength: number = 200): string {
    const text = stripHtml(content);
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
}

/**
 * Fetch emails from CRM database
 */
export async function fetchCrmEmails(maxResults: number = 100): Promise<CrmEmail[]> {
    try {
        console.log(`[CRM] Fetching up to ${maxResults} emails from MySQL...`);

        const rows = await query<CrmEmailRow>(CRM_EMAIL_QUERY, [maxResults]);

        console.log(`[CRM] Fetched ${rows.length} emails`);

        // Map to expected email format
        const emails: CrmEmail[] = rows.map((row) => {
            const content = row.content || '';
            const plainContent = stripHtml(content);

            // Format date properly
            let dateStr: string;
            if (row.Received_On instanceof Date) {
                dateStr = row.Received_On.toISOString();
            } else if (row.Received_On) {
                dateStr = new Date(row.Received_On).toISOString();
            } else {
                dateStr = new Date().toISOString();
            }

            return {
                id: String(row.crm_message_id),
                threadId: String(row.crm_message_id), // Each message is its own thread
                subject: row.subject || '(No Subject)',
                from: row.email_from || 'unknown',
                to: row.mailto || 'inbox',
                body: content, // Full content to avoid FOUC
                snippet: createSnippet(content),
                date: dateStr,
                labels: ['INBOX', 'UNREAD'],
                clientId: row.clientid,
                type: row.Type,
                department: row.Department,
                assignedTo: row.AssignedTo,
                arrearsStatus: row.Arrears_Status,
                assignment: row.Assignment,
            };
        });

        // Batch fetch attachments for these emails
        const messageIds = emails.map(e => Number(e.id));
        if (messageIds.length > 0) {
            const attachmentSql = `
                SELECT id, messageid, filename, content_type, size
                FROM theinsolvencygroup.attachment
                WHERE messageid IN (${messageIds.join(',')})
            `;
            const allAttachments = await query<{ id: number; messageid: number; filename: string; content_type: string; size: number }>(attachmentSql);

            // Map attachments to emails
            emails.forEach(email => {
                const emailId = Number(email.id);
                email.attachments = allAttachments
                    .filter(att => att.messageid === emailId)
                    .map(att => ({
                        id: String(att.id),
                        filename: att.filename,
                        mimeType: att.content_type,
                        size: att.size
                    }));
            });
        }

        return emails;
    } catch (error) {
        console.error('[CRM] Error fetching emails:', error);
        throw error;
    }
}

/**
 * Get a single email by CRM message ID
 */
export async function getCrmEmailById(messageId: string): Promise<CrmEmail | null> {
    try {
        const sql = `
      SELECT 
        mr.id as crm_message_id,
        mr.clientid, 
        '-' AS Client, 
        SUBSTRING_INDEX(IFNULL(mr.email_from, ' '), ':', -1) AS email_from, 
        SUBSTRING_INDEX(IFNULL(mr.mailbox_username, ' '), '@', 1) AS mailto, 
        IFNULL(mr.subject, ' ') AS subject, 
        IFNULL(mr.content, ' ') AS content,
        CONVERT_TZ(FROM_UNIXTIME(mr.received_on), 'UTC', 'Europe/London') AS Received_On,
        ' ' AS Arrears_Status,
        '-' AS AssignedTo,
        mr.Type,
        'Unassigned' AS Assignment,
        CASE 
          WHEN LOWER(mr.subject) LIKE '%complaining%' OR LOWER(mr.subject) LIKE '%complaint%' OR LOWER(mr.subject) LIKE '%Dissatisfied%' OR
               LOWER(mr.content) LIKE '%complaining%' OR LOWER(mr.content) LIKE '%complaint%' OR LOWER(mr.content) LIKE '%Dissatisfied%'
          THEN 'Complaints'
          ELSE NULL 
        END AS Department
      FROM theinsolvencygroup.message_received mr
      WHERE mr.id = ?
    `;

        const rows = await query<CrmEmailRow>(sql, [messageId]);

        if (rows.length === 0) return null;

        const row = rows[0];
        const content = row.content || '';
        const plainContent = stripHtml(content);

        let dateStr: string;
        if (row.Received_On instanceof Date) {
            dateStr = row.Received_On.toISOString();
        } else if (row.Received_On) {
            dateStr = new Date(row.Received_On).toISOString();
        } else {
            dateStr = new Date().toISOString();
        }

        // Fetch attachments
        const attachmentSql = `
            SELECT id, filename, content_type, size
            FROM theinsolvencygroup.attachment
            WHERE messageid = ?
        `;
        const attachments = await query<{ id: number; filename: string; content_type: string; size: number }>(attachmentSql, [messageId]);

        return {
            id: String(row.crm_message_id),
            threadId: String(row.crm_message_id),
            subject: row.subject || '(No Subject)',
            from: row.email_from || 'unknown',
            to: row.mailto || 'inbox',
            body: content, // Helper: Return full HTML content for display
            snippet: createSnippet(content),
            date: dateStr,
            labels: ['INBOX'],
            clientId: row.clientid,
            type: row.Type,
            department: row.Department,
            assignedTo: row.AssignedTo,
            arrearsStatus: row.Arrears_Status,
            assignment: row.Assignment,
            attachments: attachments.map(att => ({
                id: String(att.id),
                filename: att.filename,
                mimeType: att.content_type,
                size: att.size
            }))
        };
    } catch (error) {
        console.error('[CRM] Error fetching email by ID:', error);
        throw error;
    }
}

/**
 * Search CRM emails by query
 */
export async function searchCrmEmails(searchQuery: string, maxResults: number = 50): Promise<CrmEmail[]> {
    try {
        const likeQuery = `%${searchQuery}%`;

        const sql = `
      SELECT 
        mr.id as crm_message_id,
        mr.clientid, 
        '-' AS Client, 
        SUBSTRING_INDEX(IFNULL(mr.email_from, ' '), ':', -1) AS email_from, 
        SUBSTRING_INDEX(IFNULL(mr.mailbox_username, ' '), '@', 1) AS mailto, 
        IFNULL(mr.subject, ' ') AS subject, 
        IFNULL(mr.content, ' ') AS content,
        CONVERT_TZ(FROM_UNIXTIME(mr.received_on), 'UTC', 'Europe/London') AS Received_On,
        ' ' AS Arrears_Status,
        '-' AS AssignedTo,
        mr.Type,
        'Unassigned' AS Assignment,
        CASE 
          WHEN LOWER(mr.subject) LIKE '%complaining%' OR LOWER(mr.subject) LIKE '%complaint%' OR LOWER(mr.subject) LIKE '%Dissatisfied%' OR
               LOWER(mr.content) LIKE '%complaining%' OR LOWER(mr.content) LIKE '%complaint%' OR LOWER(mr.content) LIKE '%Dissatisfied%'
          THEN 'Complaints'
          ELSE NULL 
        END AS Department
      FROM theinsolvencygroup.message_received mr
      WHERE mr.archived = 0
        AND (mr.clientid IS NULL OR mr.clientid = 0)
        AND (mr.subject LIKE ? OR mr.content LIKE ? OR mr.email_from LIKE ?)
        AND YEAR(FROM_UNIXTIME(mr.received_on)) != 1970
      ORDER BY Received_On DESC
      LIMIT ?
    `;

        const rows = await query<CrmEmailRow>(sql, [likeQuery, likeQuery, likeQuery, maxResults]);

        // Map to expected format (same as fetchCrmEmails)
        const emails: CrmEmail[] = rows.map((row) => {
            const content = row.content || '';
            const plainContent = stripHtml(content);

            let dateStr: string;
            if (row.Received_On instanceof Date) {
                dateStr = row.Received_On.toISOString();
            } else if (row.Received_On) {
                dateStr = new Date(row.Received_On).toISOString();
            } else {
                dateStr = new Date().toISOString();
            }

            return {
                id: String(row.crm_message_id),
                threadId: String(row.crm_message_id),
                subject: row.subject || '(No Subject)',
                from: row.email_from || 'unknown',
                to: row.mailto || 'inbox',
                body: content, // Full content
                snippet: createSnippet(content),
                date: dateStr,
                labels: ['INBOX'],
                clientId: row.clientid,
                type: row.Type,
                department: row.Department,
                assignedTo: row.AssignedTo,
                arrearsStatus: row.Arrears_Status,
                assignment: row.Assignment,
            };
        });

        // Batch fetch attachments
        const messageIds = emails.map(e => Number(e.id));
        if (messageIds.length > 0) {
            const attachmentSql = `
                SELECT id, messageid, filename, content_type, size
                FROM theinsolvencygroup.attachment
                WHERE messageid IN (${messageIds.join(',')})
            `;
            const allAttachments = await query<{ id: number; messageid: number; filename: string; content_type: string; size: number }>(attachmentSql);

            emails.forEach(email => {
                const emailId = Number(email.id);
                email.attachments = allAttachments
                    .filter(att => att.messageid === emailId)
                    .map(att => ({
                        id: String(att.id),
                        filename: att.filename,
                        mimeType: att.content_type,
                        size: att.size
                    }));
            });
        }

        return emails;
    } catch (error) {
        console.error('[CRM] Error searching emails:', error);
        throw error;
    }
}

/**
 * Get all active CRM email IDs for sync comparison
 * Returns a Set of CRM message IDs that currently exist in the CRM database
 */
export async function getCrmEmailIds(): Promise<Set<string>> {
    try {
        const sql = `
            SELECT mr.id as crm_message_id
            FROM theinsolvencygroup.message_received mr
            WHERE mr.archived = 0
              AND (mr.clientid IS NULL OR mr.clientid = 0)
              AND (mr.email_from <> 'MAILER-DAEMON@eu-west-1.amazonses.com:MAILER-DAEMON@eu-west-1.amazonses.com' OR mr.email_from IS NULL)
              AND (mr.subject NOT LIKE 'Auto%' AND mr.subject NOT LIKE '%Auto%' AND mr.subject NOT LIKE '%Acknowledgement%' AND mr.subject NOT LIKE 'Acknowledgement%' OR mr.subject IS NULL)
              AND YEAR(FROM_UNIXTIME(mr.received_on)) != 1970
        `;

        const rows = await query<{ crm_message_id: number }>(sql);
        const ids = new Set<string>(rows.map(row => String(row.crm_message_id)));

        console.log(`[CRM] Fetched ${ids.size} active email IDs for sync`);
        return ids;
    } catch (error) {
        console.error('[CRM] Error fetching email IDs:', error);
        throw error;
    }
}
