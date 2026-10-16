import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { isSubscriptionActive } from '@/lib/subscription';
import {
  fetchAssistantSystemPrompt,
  resetAssistantToDefaults,
  updateAssistantSettings,
  VapiApiError,
} from '@/lib/vapi';

export const dynamic = 'force-dynamic';

interface SettingsBody {
  businessName?: unknown;
  industry?: unknown;
  businessAddress?: unknown;
  systemPrompt?: unknown;
}

interface BusinessSettings {
  businessName: string;
  industry: string;
  businessAddress: string;
  systemPrompt: string;
}

interface ApiErrorResponse {
  error: string;
  code?: 'SUBSCRIPTION_REQUIRED';
}

const MAX_NAME_LENGTH = 120;
const MAX_ADDRESS_LENGTH = 300;
const MAX_PROMPT_LENGTH = 20000;

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

async function authenticate() {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return {
      error: NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to initialize the Supabase client.' },
        { status: 500 }
      ),
    } as const;
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      error: NextResponse.json({ error: 'No authenticated Supabase session was found.' }, { status: 401 }),
    } as const;
  }

  return { supabase, user } as const;
}

/**
 * GET /api/assistant/settings — returns the signed-in user's saved business
 * name, trade, street address and VA system prompt. If a prompt was never
 * stored locally but an assistant is deployed, the live prompt is read from
 * Vapi so the editor always shows what callers actually hear.
 */
export async function GET(): Promise<NextResponse<BusinessSettings | ApiErrorResponse>> {
  const auth = await authenticate();
  if ('error' in auth) return auth.error;
  const { supabase, user } = auth;

  const { data: profile, error } = await supabase
    .from('users')
    .select('business_name, business_industry, business_address, vapi_system_prompt, vapi_assistant_id')
    .eq('id', user.id)
    .single();

  if (error || !profile) {
    return NextResponse.json(
      { error: `Failed to load your business settings: ${error?.message ?? 'no profile row found'}.` },
      { status: 500 }
    );
  }

  let systemPrompt = (profile.vapi_system_prompt as string | null) ?? '';
  const assistantId = profile.vapi_assistant_id as string | null;

  if (!systemPrompt && assistantId) {
    try {
      systemPrompt = await fetchAssistantSystemPrompt(assistantId);
    } catch {
      // Non-fatal for a read: the editor simply opens with an empty prompt.
      systemPrompt = '';
    }
  }

  return NextResponse.json({
    businessName: (profile.business_name as string | null) ?? '',
    industry: (profile.business_industry as string | null) ?? '',
    businessAddress: (profile.business_address as string | null) ?? '',
    systemPrompt,
  });
}

/**
 * PATCH /api/assistant/settings — saves the business name, trade, street
 * address and VA system prompt on `public.users` and, when an assistant is
 * already deployed, syncs them to Vapi (`PATCH /assistant/{id}`). Saving the
 * profile works for any signed-in user (setup / demo); the sync to a deployed
 * assistant is a live business function, so it also requires an active
 * subscription or trial (an assistant can only exist once one was active, so a
 * lapsed user is told to resubscribe rather than silently desynced).
 * A blank prompt regenerates the default prompt from the other fields.
 */
export async function PATCH(
  request: Request
): Promise<NextResponse<{ saved: true; syncedToVapi: boolean } | ApiErrorResponse>> {
  const auth = await authenticate();
  if ('error' in auth) return auth.error;
  const { supabase, user } = auth;

  let body: SettingsBody;
  try {
    body = (await request.json()) as SettingsBody;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const businessName = asTrimmedString(body.businessName) ?? '';
  const industry = asTrimmedString(body.industry) ?? '';
  const businessAddress = asTrimmedString(body.businessAddress) ?? '';
  const systemPrompt = asTrimmedString(body.systemPrompt) ?? '';

  if (businessName.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: `Business name must be ${MAX_NAME_LENGTH} characters or fewer.` }, { status: 400 });
  }
  if (businessAddress.length > MAX_ADDRESS_LENGTH) {
    return NextResponse.json(
      { error: `Business address must be ${MAX_ADDRESS_LENGTH} characters or fewer.` },
      { status: 400 }
    );
  }
  if (systemPrompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `System prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.` },
      { status: 400 }
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('vapi_assistant_id, subscription_status')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json(
      { error: `Failed to load your account profile: ${profileError?.message ?? 'no profile row found'}.` },
      { status: 500 }
    );
  }

  const assistantId = profile.vapi_assistant_id as string | null;
  let syncedToVapi = false;

  // Sync to the live assistant FIRST so the DB never claims settings Vapi rejected.
  if (assistantId) {
    if (!isSubscriptionActive(profile.subscription_status as string | null)) {
      return NextResponse.json(
        {
          error: 'An active subscription or 7-day free trial is required to update your live assistant.',
          code: 'SUBSCRIPTION_REQUIRED',
        },
        { status: 402 }
      );
    }
    if (!industry) {
      return NextResponse.json(
        { error: 'Choose a business type (trade) before saving changes to your live assistant.' },
        { status: 400 }
      );
    }
    try {
      await updateAssistantSettings({
        assistantId,
        industry,
        companyName: businessName || undefined,
        businessAddress: businessAddress || undefined,
        systemPrompt: systemPrompt || undefined,
        baseUrl: new URL(request.url).origin,
      });
      syncedToVapi = true;
    } catch (err) {
      const message = err instanceof VapiApiError ? err.message : 'Failed to sync your settings to the live assistant.';
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({
      business_name: businessName || null,
      business_industry: industry || null,
      business_address: businessAddress || null,
      vapi_system_prompt: systemPrompt || null,
    })
    .eq('id', user.id);

  if (updateError) {
    return NextResponse.json(
      { error: `Failed to save your business settings: ${updateError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ saved: true, syncedToVapi });
}

/**
 * DELETE /api/assistant/settings — clears the business name, trade, street
 * address and VA prompt back to a clean slate. A deployed assistant is reset
 * to a generic receptionist via `PATCH /assistant/{id}` (the assistant id and
 * phone line are kept so the user can reconfigure without re-provisioning).
 * Not subscription-gated: users can always wipe their own data.
 */
export async function DELETE(
  request: Request
): Promise<NextResponse<{ reset: true; syncedToVapi: boolean } | ApiErrorResponse>> {
  const auth = await authenticate();
  if ('error' in auth) return auth.error;
  const { supabase, user } = auth;

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('vapi_assistant_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json(
      { error: `Failed to load your account profile: ${profileError?.message ?? 'no profile row found'}.` },
      { status: 500 }
    );
  }

  const assistantId = profile.vapi_assistant_id as string | null;
  let syncedToVapi = false;

  if (assistantId) {
    try {
      await resetAssistantToDefaults(assistantId, new URL(request.url).origin);
      syncedToVapi = true;
    } catch (err) {
      const message = err instanceof VapiApiError ? err.message : 'Failed to reset your live assistant.';
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({
      business_name: null,
      business_industry: null,
      business_address: null,
      vapi_system_prompt: null,
    })
    .eq('id', user.id);

  if (updateError) {
    return NextResponse.json(
      { error: `Failed to reset your business settings: ${updateError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ reset: true, syncedToVapi });
}

