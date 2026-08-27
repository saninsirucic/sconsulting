require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const knex = require('knex');
const { v4: uuidv4 } = require('uuid');
const configs = require('../knexfile');
const { normalizeUsername, validateNewPassword } = require('../aiEmail/auth');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const [rawKey, inlineValue] = argument.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) result[key] = inlineValue;
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) result[key] = argv[++index];
    else result[key] = true;
  }
  return result;
}

function generatePassword() {
  return `Sc!9-${crypto.randomBytes(15).toString('base64url')}`;
}

function usage() {
  return [
    'Korištenje:',
    '  npm run manage-user -- --username komercijalista --display-name "Ime Prezime" --email korisnik@s-consulting.ba --generate-password',
    '  npm run manage-user -- --username komercijalista --password "PrivremenaLozinka9!"',
    '',
    'Komanda kreira ili ažurira korisnika role komercijala i dodjeljuje sve aktivne CRM brendove.',
    'Kod nove/izmijenjene lozinke must_change_password se postavlja na true.'
  ].join('\n');
}

async function manageUser({ db, args, output = console.log }) {
  const username = String(args.username || '').trim();
  const normalized = normalizeUsername(username);
  if (!normalized) throw new Error('--username je obavezan.');
  if (args.generatePassword && args.password) {
    throw new Error('Koristite ili --generate-password ili --password, ne oba.');
  }

  const missing = [];
  for (const table of ['app_users', 'crm_brands', 'app_user_brand_access']) {
    if (!await db.schema.hasTable(table)) missing.push(table);
  }
  if (missing.length) {
    throw new Error(`Nedostaju migracije (${missing.join(', ')}). Prvo pokrenite knex migrate:latest.`);
  }

  const existing = await db('app_users').where({ username_normalized: normalized }).first();
  let plainPassword = null;
  if (args.generatePassword) plainPassword = generatePassword();
  else if (args.password) plainPassword = String(args.password);
  if (!existing && !plainPassword) {
    throw new Error('Za novog korisnika navedite --generate-password ili --password.');
  }
  if (plainPassword) validateNewPassword(plainPassword);

  const configuredRounds = Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
  const rounds = Number.isFinite(configuredRounds) ? Math.min(15, Math.max(4, configuredRounds)) : 12;
  const passwordHash = plainPassword ? await bcrypt.hash(plainPassword, rounds) : null;
  const now = new Date();
  const userId = existing ? existing.id : uuidv4();
  let activeBrandCodes = [];

  await db.transaction(async (trx) => {
    if (existing) {
      const update = {
        username,
        username_normalized: normalized,
        role: 'komercijala',
        active: args.inactive ? false : true,
        updated_at: now
      };
      if (Object.prototype.hasOwnProperty.call(args, 'displayName')) update.display_name = args.displayName || null;
      if (Object.prototype.hasOwnProperty.call(args, 'email')) update.email = args.email || null;
      if (passwordHash) {
        update.password_hash = passwordHash;
        update.must_change_password = true;
        update.password_changed_at = null;
        update.token_version = trx.raw('COALESCE(??, 0) + 1', ['token_version']);
      }
      await trx('app_users').where({ id: userId }).update(update);
    } else {
      await trx('app_users').insert({
        id: userId,
        username,
        username_normalized: normalized,
        password_hash: passwordHash,
        display_name: args.displayName || username,
        email: args.email || null,
        role: 'komercijala',
        active: args.inactive ? false : true,
        must_change_password: true,
        token_version: 0,
        created_at: now,
        updated_at: now
      });
    }

    const brands = await trx('crm_brands').where({ active: true }).select('id', 'code').orderBy('name');
    activeBrandCodes = brands.map((brand) => brand.code);
    for (const brand of brands) {
      await trx('app_user_brand_access').insert({
        id: uuidv4(),
        user_id: userId,
        brand_id: brand.id,
        can_read: true,
        can_write: true,
        created_at: now,
        updated_at: now
      }).onConflict(['user_id', 'brand_id']).merge({
        can_read: true,
        can_write: true,
        updated_at: now
      });
    }
  });

  output(`${existing ? 'Ažuriran' : 'Kreiran'} korisnik: ${username} (${userId})`);
  output(`Rola: komercijala | CRM pristup: ${activeBrandCodes.join(', ')}`);
  if (plainPassword) {
    output(`Privremena lozinka (prikazuje se samo sada): ${plainPassword}`);
    output('Korisnik mora promijeniti lozinku pri prvoj prijavi.');
  }
  return { id: userId, username, generatedPassword: args.generatePassword ? plainPassword : null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const environment = process.env.NODE_ENV || 'development';
  const config = configs[environment];
  if (!config) throw new Error(`Nepoznat NODE_ENV: ${environment}`);
  const db = knex(config);
  try {
    await manageUser({ db, args });
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Greška: ${error.message}`);
    console.error(usage());
    process.exitCode = 1;
  });
}

module.exports = { generatePassword, manageUser, parseArgs, usage };
