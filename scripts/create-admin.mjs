import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { openDatabase } from '../server/database.mjs';
import { createAdmin } from '../server/auth.mjs';

// Passwords are entered locally, without echoing them or storing them in shell history.
if (!process.stdin.isTTY) {
  console.error('Run npm run admin:create in an interactive terminal.');
  process.exit(1);
}
let hidden = false;
const output = new Writable({
  write(chunk, encoding, done) {
    if (!hidden) process.stdout.write(chunk, encoding);
    done();
  },
});
const terminal = createInterface({ input: process.stdin, output, terminal: true });
const db = openDatabase();
try {
  const email = await terminal.question('Admin email: ');
  process.stdout.write('Password (12–128 characters, hidden): ');
  hidden = true;
  const password = await terminal.question('');
  process.stdout.write('\nConfirm password (hidden): ');
  const confirmation = await terminal.question('');
  hidden = false;
  process.stdout.write('\n');
  if (password !== confirmation) throw new Error('Passwords do not match.');
  await createAdmin(db, email, password);
  console.log('Admin created. Sign in through the Admin link in Stockroom.');
} catch (error) {
  hidden = false;
  console.error(error.message.includes('UNIQUE') ? 'An admin with this email already exists.' : error.message);
  process.exitCode = 1;
} finally {
  terminal.close();
  db.close();
}
