
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

export const dynamic = 'force-dynamic';

interface AttachmentData {
    serialized: Buffer;
    filename: string;
    content_type: string;
    size: number;
}

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string; attachmentId: string }> }
) {
    try {
        const { id, attachmentId } = await context.params;

        if (!id || !attachmentId) {
            return new NextResponse('Missing required parameters', { status: 400 });
        }

        // Admin check (optional but recommended, skipping for now to match other routes or relying on middleware/cookie check if needed)
        // Ideally we should check if the user is authorized to view this email.

        console.log(`[Attachment] Fetching attachment ${attachmentId} for email ${id}`);

        // Fetch raw BLOB data
        const rows = await query<AttachmentData>(`
            SELECT serialized, filename, content_type, size
            FROM theinsolvencygroup.attachment
            WHERE id = ? AND messageid = ? AND serialized IS NOT NULL
        `, [attachmentId, id]);

        if (rows.length === 0) {
            // Also try without messageId constraint just in case, but safe to keep it
            console.log(`[Attachment] Not found: ${attachmentId} (msg: ${id})`);
            return new NextResponse('Attachment not found', { status: 404 });
        }

        const attachment = rows[0];
        console.log(`[Attachment] Found: ${attachment.filename} (${attachment.size} bytes)`);

        // Create response with appropriate headers
        const headers = new Headers();
        headers.set('Content-Type', attachment.content_type || 'application/octet-stream');
        headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`);
        headers.set('Content-Length', String(attachment.serialized.length));

        // Return the buffer directly
        return new NextResponse(attachment.serialized, {
            status: 200,
            headers
        });

    } catch (error: any) {
        console.error('[Attachment] Error download:', error);
        return new NextResponse(`Error fetching attachment: ${error.message}`, { status: 500 });
    }
}
