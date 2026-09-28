// Creates (or promotes) an owner/admin account. Admins cannot sign up through the website.
//   npm run create-admin -- --email you@example.com --username owner
// The password is read from ADMIN_PASSWORD or asked for interactively (not echoed).
process.env.TZ ||= 'America/Los_Angeles';
const readline = require('node:readline');
const config = require('./config');
const { openDatabase } = require('./db');
const { hashPassword } = require('./auth');
const v = require('./validate');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  try {
    const email = v.email(arg('email'));
    const username = v.username(arg('username') || 'owner');
    let password = process.env.ADMIN_PASSWORD;
    if (!password) {
      password = await askHidden('Admin password (min 8 chars, letters and numbers): ');
      const again = await askHidden('Repeat password: ');
      if (password !== again) throw new Error('Passwords do not match.');
    }
    v.password(password);
    const db = openDatabase(config.databasePath);
    const existing = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existing && existing.role !== 'admin') throw new Error(`${existing.email} is already a ${existing.role} account. Use a different email and user name.`);
    if (existing) {
      db.prepare("UPDATE users SET password_hash = ?, status = 'active' WHERE id = ?").run(hashPassword(password), existing.id);
      console.log(`Updated admin ${existing.username} <${existing.email}>.`);
    } else {
      db.prepare("INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, 'admin')").run(email, username, hashPassword(password));
      console.log(`Created admin ${username} <${email}>. Log in at /login, then open /admin/.`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
})();
