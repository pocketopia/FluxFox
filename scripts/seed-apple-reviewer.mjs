// Idempotently creates (or resets) the Apple App Review tester account in
// Supabase Auth so reviewers can sign in with email/password immediately.
// Usage: npm run seed:reviewer
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env (or .env.local).
// Override the defaults with REVIEWER_EMAIL / REVIEWER_PASSWORD if needed.
import { createClient } from '@supabase/supabase-js';

const email = process.env.REVIEWER_EMAIL || 'aiinfinitebusiness@gmail.com';
const password = process.env.REVIEWER_PASSWORD || '@Deadman88';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

if (/your-project|your-supabase|your-/i.test(url) || /^your-/i.test(serviceKey)) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are still placeholder values. ' +
      'Put the real Supabase project URL and service-role key in .env.local, then re-run `npm run seed:reviewer`.'
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function findUserByEmail(target) {
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === target.toLowerCase());
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

const existing = await findUserByEmail(email);
let userId;

if (existing) {
  const { data, error } = await supabase.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  console.log(`Updated existing reviewer account ${email} (${userId}).`);
} else {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'App Review Tester' },
  });
  if (error) throw error;
  userId = data.user.id;
  console.log(`Created reviewer account ${email} (${userId}).`);
}

// Ensure the public.users profile row exists (the on_auth_user_created trigger normally does this).
const { error: profileError } = await supabase.from('users').upsert({ id: userId, email }, { onConflict: 'id' });
if (profileError) throw profileError;
console.log('Reviewer profile row is in place. Subscription state is untouched (new = unpaid, demo only).');
