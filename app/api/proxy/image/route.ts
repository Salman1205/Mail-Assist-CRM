/**
 * GET /api/proxy/image - Proxy external images to bypass CORS/auth issues
 * This helps load images that are blocked when loaded directly from emails
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const url = request.nextUrl.searchParams.get('url');

        if (!url) {
            return new NextResponse('Missing url parameter', { status: 400 });
        }

        // Decode the URL
        const decodedUrl = decodeURIComponent(url);

        // Validate it's an image URL (basic check)
        if (!decodedUrl.startsWith('http://') && !decodedUrl.startsWith('https://')) {
            return new NextResponse('Invalid URL', { status: 400 });
        }

        console.log(`[ImageProxy] Fetching: ${decodedUrl.substring(0, 100)}...`);

        // Fetch the image
        const response = await fetch(decodedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/*,*/*',
                'Referer': new URL(decodedUrl).origin,
            },
        });

        if (!response.ok) {
            console.log(`[ImageProxy] Failed: ${response.status} for ${decodedUrl.substring(0, 50)}`);
            // Return a transparent 1x1 gif for failed images
            const transparentGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
            return new NextResponse(transparentGif, {
                status: 200,
                headers: {
                    'Content-Type': 'image/gif',
                    'Cache-Control': 'public, max-age=86400',
                },
            });
        }

        const contentType = response.headers.get('content-type') || 'image/png';
        const buffer = await response.arrayBuffer();

        return new NextResponse(Buffer.from(buffer), {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
            },
        });
    } catch (error: any) {
        console.error('[ImageProxy] Error:', error.message);
        // Return a transparent 1x1 gif for any errors
        const transparentGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
        return new NextResponse(transparentGif, {
            status: 200,
            headers: {
                'Content-Type': 'image/gif',
                'Cache-Control': 'public, max-age=3600',
            },
        });
    }
}
