import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const parameters = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
export const digest = (value) => createHash('sha256').update(value).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, parameters);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  // Unknown accounts still perform the same expensive hash operation.
  const [, salt, expected] = (storedHash || `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const actual = await scrypt(password, salt, 64, parameters);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex')) && Boolean(storedHash);
}

export async function createAdmin(db, email, password) {
  email = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Use a password between 12 and 128 characters.');
  const hash = await hashPassword(password);
  db.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)').run(email, hash);
}

export function createSession(db, adminId = null) {
  const token = randomBytes(32).toString('hex');
  const session = {
    token_hash: digest(token), admin_id: adminId,
    csrf: randomBytes(32).toString('hex'), expires_at: Date.now() + (adminId ? 8 : 24) * 60 * 60 * 1000,
  };
  db.prepare('INSERT INTO sessions (token_hash, admin_id, csrf, expires_at) VALUES (?, ?, ?, ?)')
    .run(session.token_hash, adminId, session.csrf, session.expires_at);
  return { token, session };
}
