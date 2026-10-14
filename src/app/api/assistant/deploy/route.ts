import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { deployVapiAssistant, VapiApiError } from '@/lib/vapi';

export const dynamic = 'force-dynamic';

interface DeployRequestBody {
  industry?: unknown;
  /** The business's display name, collected on the wizard's "Company Name" step. */
  companyName?: unknown;
  /** Accepted as an alias of `companyName` for backward compatibility with existing callers. */
  businessName?: unknown;
  /**
   * A fully custom system prompt, set when the user accepted/edited the
   * auto-generated prompt (Path A) or wrote one from scratch (Path B). When
   * omitted, `deployVapiAssistant` falls back to its own auto-generated
   * prompt built from `industry` + `companyName`.
   */
  systemPrompt?: unknown;
}

interface DeploySuccessResponse {
  deployed: true;
  vapiAssistantId: string;
  assistantName: string;
}

interface ApiErrorResponse {
  error: string;
}

/**
 * POST /api/assistant/deploy
 *
 * Single-click server-side orchestration for provisioning a user's AI
 * receptionist:
 *   1. Validate the Supabase session.
 *   2. Read the requested `industry` from the JSON body.
 *   3. Generate and create a production-ready Vapi assistant.
 *   4. Persist the returned assistant id to public.users.vapi_assistant_id.
 *
 * No mock data, no fallback assistant: any failure mode returns a strict
 * JSON error with an appropriate status (401 for auth, 400 for bad input,
 * 500 for Vapi/DB failures).
 */
export async function POST(request: Request): Promise<NextResponse<DeploySuccessResponse | ApiErrorResponse>> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to initialize the Supabase client.' },
      { status: 500 }
    );
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'No authenticated Supabase session was found.' }, { status: 401 });
  }

  let body: DeployRequestBody;
  try {
    body = (await request.json()) as DeployRequestBody;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const { industry, companyName, businessName, systemPrompt } = body;

  if (typeof industry !== 'string' || !industry.trim()) {
    return NextResponse.json(
      { error: 'An `industry` string (e.g. "plumber", "roofer") is required in the request body.' },
      { status: 400 }
    );
  }

  const resolvedCompanyName =
    typeof companyName === 'string' && companyName.trim()
      ? companyName
      : typeof businessName === 'string' && businessName.trim()
        ? businessName
        : undefined;

  const resolvedSystemPrompt = typeof systemPrompt === 'string' && systemPrompt.trim() ? systemPrompt : undefined;

  // Always send the live request origin to Vapi as the webhook base URL,
  // so call events reach /api/webhook/vapi even with zero env vars set.
  const origin = new URL(request.url).origin;

  let assistant;
  try {
    assistant = await deployVapiAssistant({
      industry,
      companyName: resolvedCompanyName,
      systemPrompt: resolvedSystemPrompt,
      baseUrl: origin,
    });
  } catch (err) {
    if (err instanceof VapiApiError) {
      const status = err.status && err.status >= 400 && err.status < 500 ? 400 : 500;
      return NextResponse.json({ error: err.message }, { status });
    }
    return NextResponse.json({ error: 'Failed to deploy the Vapi assistant.' }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({ vapi_assistant_id: assistant.id })
    .eq('id', user.id);

  if (updateError) {
    // PGRST205 is PostgREST's "I don't see this table/column in my schema
    // cache" error. It fires either because (a) NEXT_PUBLIC_SUPABASE_URL
    // points at the wrong Supabase project (one that never ran
    // supabase.sql), or (b) the real project's schema was altered and
    // PostgREST's internal cache has not yet reloaded. `cache: 'no-store'`
    // on every Supabase fetch (see src/utils/supabase/server.ts) rules out
    // Next.js serving a stale *response*, so a persistent PGRST205 here
    // means the fix lives in Supabase/Vercel config, not in this route.
    const isSchemaCacheError = updateError.code === 'PGRST205' || /schema cache/i.test(updateError.message);
    const hint = isSchemaCacheError
      ? ' This is a PostgREST schema-cache error, not a Next.js caching issue — verify NEXT_PUBLIC_SUPABASE_URL/' +
        'SUPABASE_SERVICE_ROLE_KEY in Vercel match the Supabase project where supabase.sql was run, then reload ' +
        "PostgREST's schema cache from the Supabase Dashboard (Settings -> API -> \"Reload schema\") or by running " +
        "`select pg_notify('pgrst', 'reload schema');` in the SQL editor."
      : '';
    return NextResponse.json(
      {
        error: `Assistant was created (${assistant.id}) but failed to save to your account: ${updateError.message}.${hint}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      deployed: true,
      vapiAssistantId: assistant.id,
      assistantName: assistant.name,
    },
    { status: 200 }
  );
}
