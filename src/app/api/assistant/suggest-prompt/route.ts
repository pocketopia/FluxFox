import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { generateSuggestedPrompt, VapiApiError } from '@/lib/vapi';

export const dynamic = 'force-dynamic';

interface SuggestPromptRequestBody {
  industry?: unknown;
  companyName?: unknown;
}

interface SuggestPromptSuccessResponse {
  systemPrompt: string;
}

interface ApiErrorResponse {
  error: string;
}

/**
 * POST /api/assistant/suggest-prompt
 *
 * Powers Path A ("Let the AI write it for me") of the assistant creation
 * wizard: given the company name + trade the user just entered on the new
 * "Company Name" step, returns the exact system prompt
 * `/api/assistant/deploy` would ship to Vapi for that business, so the
 * "I like it!" / "Edit" step always previews the real, final prompt rather
 * than a separate, divergent copy generated client-side.
 *
 * Requires a valid Supabase session (same guard as every other onboarding
 * API) purely to prevent unauthenticated prompt-generation spam; no
 * database read/write happens here, and no Vapi network call is made —
 * this is pure local template rendering (see `src/lib/vapi.ts`), so there
 * is no third-party failure mode to mock around.
 */
export async function POST(
  request: Request
): Promise<NextResponse<SuggestPromptSuccessResponse | ApiErrorResponse>> {
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

  let body: SuggestPromptRequestBody;
  try {
    body = (await request.json()) as SuggestPromptRequestBody;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const { industry, companyName } = body;

  if (typeof industry !== 'string' || !industry.trim()) {
    return NextResponse.json(
      { error: 'An `industry` string (e.g. "plumber", "roofer") is required in the request body.' },
      { status: 400 }
    );
  }

  if (typeof companyName !== 'string' || !companyName.trim()) {
    return NextResponse.json(
      { error: 'A `companyName` string is required in the request body.' },
      { status: 400 }
    );
  }

  try {
    const systemPrompt = generateSuggestedPrompt(industry, companyName);
    return NextResponse.json({ systemPrompt }, { status: 200 });
  } catch (err) {
    if (err instanceof VapiApiError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to generate a suggested prompt.' }, { status: 500 });
  }
}
