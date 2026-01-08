import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const runtime = 'edge';

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const { env } = await getCloudflareContext();
    const key = params.path.join('/');

    const object = await env.R2.get(key);
    
    if (!object) {
      return new NextResponse('Not Found', { status: 404 });
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    
    return new NextResponse(object.body, { headers });
    
  } catch (error) {
    console.error('R2 fetch error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
