import 'dotenv/config';

const placeholder = /development|change[-_ ]?this|replace[-_ ]?me|example|your[-_]|placeholder|^postgres$|^password$|^secret$|^test$/i;
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production';
  const invalid = new Set<string>();
  const required = (key: string) => {
    const value = env[key]?.trim() || '';
    if (production && (!value || placeholder.test(value))) invalid.add(key);
    return value;
  };
  const databaseUrl = required('DATABASE_URL');
  const jwtSecret = required('JWT_SECRET') || (production ? '' : 'development-only-secret');
  const appOrigin = required('APP_ORIGIN') || (production ? '' : env.WEB_ORIGIN || 'http://localhost:5173');
  if (production) {
    if (jwtSecret.length < 32) invalid.add('JWT_SECRET');
    try {
      const db = new URL(databaseUrl);
      if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.hostname || !db.pathname.slice(1) || !db.password || placeholder.test(decodeURIComponent(db.password))) invalid.add('DATABASE_URL');
    } catch { invalid.add('DATABASE_URL'); }
    try {
      const origin = new URL(appOrigin);
      if (origin.protocol !== 'https:' || origin.origin !== appOrigin || ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) invalid.add('APP_ORIGIN');
    } catch { invalid.add('APP_ORIGIN'); }
    for (const key of ['RESEND_API_KEY', 'EMAIL_FROM', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) required(key);
    if (env.SEED_DEMO === 'true') invalid.add('SEED_DEMO');
  }
  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) invalid.add('PORT');
  if (invalid.size) throw new Error(`Invalid configuration: ${[...invalid].join(', ')}`);
  return { production, databaseUrl, jwtSecret, appOrigin, port };
}
