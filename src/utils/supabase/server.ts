import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * The literal placeholder value shipped in `.env.example`. If `.env.local`
 * (or a Vercel project's environment variables) still contains this exact
 * string, the app is talking to no real database at all — every query will
 * fail in confusing ways (network errors locally, or a misleading
 * "Could not find the table ... in the schema cache" PostgREST error in
 * production if DNS happens to resolve to an unrelated/decommissioned
 * project). Failing fast here with a precise message beats letting that
 * bubble up as an opaque Supabase error deep inside a route handler.
 */
const SUPABASE_URL_PLACEHOLDER = 'https://your-project.supabase.co';

/**
 * Creates a Supabase client for Next.js Server Components, Server Actions,
 * and Route Handlers.
 *
 * Uses @supabase/ssr cookie management to safely handle auth sessions across
 * requests. Also forces every outgoing request (auth, PostgREST, etc.) to
 * bypass Next.js's fetch Data Cache via `cache: 'no-store'`. Without this, a
 * response fetched before a Postgres schema migration/reload (e.g. the
 * `public.users` table or a new column) can keep being served from Next's
 * cache even after the underlying schema has changed, surfacing a stale
 * "Could not find the table 'public.users' in the schema cache" error long
 * after the real schema is correct. Route handlers that call this should
 * also export `export const dynamic = 'force-dynamic'` so Next never
 * attempts to statically render/cache the route itself.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl === SUPABASE_URL_PLACEHOLDER) {
    throw new Error(
      'Server misconfiguration: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY are missing or still ' +
        'set to the placeholder value from .env.example. Set the real Supabase project credentials in your ' +
        'deployment environment (Vercel Project -> Settings -> Environment Variables) and in .env.local for local ' +
        'development, then redeploy.'
    );
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // The `setAll` method was invoked from a Server Component.
          // This is expected and safe when middleware refreshes user sessions.
        }
      },
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  });
}
