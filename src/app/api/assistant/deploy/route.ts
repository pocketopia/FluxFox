import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { deployVapiAssistant, VapiApiError } from '@/lib/vapi';

export const dynamic = 'force-dynamic';

interface DeployRequestBody {
  industry?: unknown;
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
  const supabase = await createClient();

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

  const { industry } = body;

  if (typeof industry !== 'string' || !industry.trim()) {
    return NextResponse.json(
      { error: 'An `industry` string (e.g. "plumber", "roofer") is required in the request body.' },
      { status: 400 }
    );
  }

  let assistant;
  try {
    assistant = await deployVapiAssistant({ industry });
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
    return NextResponse.json(
      { error: `Assistant was created (${assistant.id}) but failed to save to your account: ${updateError.message}` },
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
