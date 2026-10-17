import type { NextRequest } from 'next/server';
export const runtime = 'nodejs';
async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = path.join('/');
  if (!/^(categories|animals|sightings|photos)(\/[a-zA-Z0-9_-]+)?(\/sightings)?$/.test(route) && !/^auth\/(login|refresh|me)$/.test(route))
    return Response.json({ ok: false, error: { message: '接口不存在' } }, { status: 404 });
  const origin = (process.env.KEDAYA_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
  const target = `${origin}/api/v1/${route.startsWith('auth/') ? route : `wildlife/${route}`}${request.nextUrl.search}`;
  try {
    const limit = 9 * 1024 * 1024;
    if (Number(request.headers.get('content-length') ?? 0) > limit)
      return Response.json({ ok: false, error: { message: '文件过大' } }, { status: 413 });
    let body: ArrayBuffer | undefined;
    if (!['GET', 'HEAD'].includes(request.method) && request.body) {
      const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
        if (size > limit) { await reader.cancel(); return Response.json({ ok: false, error: { message: '文件过大' } }, { status: 413 }); }
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      body = bytes.buffer;
    }
    const headers = new Headers();
    for (const name of ['authorization', 'content-type', 'idempotency-key']) { const value = request.headers.get(name); if (value) headers.set(name, value); }
    const response = await fetch(target, { method: request.method, headers, body, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    return new Response(response.body, { status: response.status, headers: {
      'Content-Type': response.headers.get('content-type') ?? 'application/json',
      'Cache-Control': response.headers.get('cache-control') ?? 'no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch { return Response.json({ ok: false, error: { message: '共享服务暂时无法连接，请稍后重试' } }, { status: 503 }); }
}
export const GET = proxy, POST = proxy, PATCH = proxy, DELETE = proxy;
