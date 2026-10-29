import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { HttpError } from './ownership.js';

export type LogSink = (event: Record<string, unknown>) => void;
export const log: LogSink = event => console.log(JSON.stringify(event));
export function requestLogger(write: LogSink = log): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    const start = performance.now();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    res.on('finish', () => write({ event: 'request', requestId, method: req.method,
      // Route patterns exclude IDs, query strings, and future invitation tokens.
      route: req.route?.path ?? 'unmatched', status: res.statusCode,
      durationMs: Math.round(performance.now() - start) }));
    next();
  };
}
export function restrictedCors(origin: string): RequestHandler {
  const middleware = cors({ origin, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'], exposedHeaders: ['X-Request-ID'] });
  return (req, res, next) => {
    if (req.headers.origin && req.headers.origin !== origin) {
      res.status(403).json({ error: 'Origin not allowed' }); return;
    }
    middleware(req, res, next);
  };
}
// Single-process limiter. Do not trust client-supplied forwarding headers.
// Expired buckets are swept, and capacity fails closed rather than growing forever.
export function authRateLimit({ limit = 20, windowMs = 15 * 60_000, now = Date.now } = {}): RequestHandler {
  const buckets = new Map<string, { count: number; expires: number }>();
  return (req, res, next) => {
    const time = now();
    for (const [key, bucket] of buckets) if (bucket.expires <= time) buckets.delete(key);
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket && buckets.size < 10_000) { bucket = { count: 0, expires: time + windowMs }; buckets.set(key, bucket); }
    if (!bucket || ++bucket.count > limit) {
      res.setHeader('Retry-After', Math.ceil(((bucket?.expires ?? time + windowMs) - time) / 1000));
      res.status(429).json({ error: 'Too many authentication requests. Try again later.' }); return;
    }
    next();
  };
}
export function errorHandler(write: LogSink = log): ErrorRequestHandler {
  return (err: unknown, _req, res, next) => {
    if (res.headersSent) { next(err); return; }
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
    if (err instanceof ZodError) { res.status(400).json({ error: 'Invalid request' }); return; }
    const type = err && typeof err === 'object' && 'type' in err ? err.type : undefined;
    if (type === 'entity.parse.failed') { res.status(400).json({ error: 'Invalid JSON' }); return; }
    if (type === 'entity.too.large') { res.status(413).json({ error: 'Request too large' }); return; }
    write({ event: 'request_error', requestId: res.locals.requestId, status: 500 });
    res.status(500).json({ error: 'Unexpected server error' });
  };
}
