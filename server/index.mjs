import { createApplication } from './app.mjs';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
const secureCookies = process.env.COOKIE_SECURE === 'true';
if (process.env.NODE_ENV === 'production' && (!origin.startsWith('https://') || !secureCookies)) {
  throw new Error('Production requires an HTTPS APP_ORIGIN and COOKIE_SECURE=true.');
}
const { server } = createApplication({ origin, secureCookies });
server.listen(port, host, () => console.log(`Stockroom is running at ${origin}`));
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
