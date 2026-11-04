import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/utils/supabase/server';
import { isSubscriptionActive } from '@/lib/subscription';
import {
  fetchAssistantSystemPrompt,
  resetAssistantToDefaults,
  updateAssistantSettings,
  VapiApiError,
} from '@/lib/vapi';
import {
  getFallbackSessionUser,
  getFallbackUserProfile,
  FLUXFOX_PROFILE_COOKIE,
} from '@/lib/fallbackSession';

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
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (!authError && user) {
      return { supabase, user } as const;
    }
  } catch {}
  return { error: NextResponse.json({ error: 'No authenticated Supabase session was found.' }, { status: 401 }) } as const;
}

export async function GET(): Promise<NextResponse<BusinessSettings | ApiErrorResponse>> {
  const auth = await authenticate();
  if ('error' in auth) {
    const fbUser = await getFallbackSessionUser();
    if (!fbUser) return auth.error;
    const prof = await getFallbackUserProfile(fbUser);
    return NextResponse.json({
      businessName: prof.business_name ?? '',
      industry: prof.business_industry ?? '',
      businessAddress: prof.business_address ?? '',
      systemPrompt: prof.vapi_system_prompt ?? '',
    });
  }
  const { supabase, user } = auth;

  const { data: profile, error } = await supabase
    .from('users')
    .select('business_name, business_industry, business_address, vapi_system_prompt, vapi_assistant_id')
    .eq('id', user.id)
    .single();

  if (error || !profile) {
    return NextResponse.json({
      businessName: '',
      industry: '',
      businessAddress: '',
      systemPrompt: '',
    });
  }

  let systemPrompt = (profile.vapi_system_prompt as string | null) ?? '';
  const assistantId = profile.vapi_assistant_id as string | null;

  if (!systemPrompt && assistantId) {
    try {
      systemPrompt = await fetchAssistantSystemPrompt(assistantId);
    } catch {
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

export async function PATCH(
  request: Request
): Promise<NextResponse<{ saved: true; syncedToVapi: boolean } | ApiErrorResponse>> {
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
    return NextResponse.json({ error: `Business address must be ${MAX_ADDRESS_LENGTH} characters or fewer.` }, { status: 400 });
  }
  if (systemPrompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json({ error: `System prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.` }, { status: 400 });
  }

  const auth = await authenticate();
  if ('error' in auth) {
    const fbUser = await getFallbackSessionUser();
    if (!fbUser) return auth.error;
    const currentProf = await getFallbackUserProfile(fbUser);
    const updatedProf = {
      ...currentProf,
      business_name: businessName || null,
      business_industry: industry || null,
      business_address: businessAddress || null,
      vapi_system_prompt: systemPrompt || null,
    };
    const encoded = Buffer.from(JSON.stringify(updatedProf), 'utf-8').toString('base64url');
    const store = await cookies();
    store.set(FLUXFOX_PROFILE_COOKIE, encoded, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return NextResponse.json({ saved: true, syncedToVapi: false });
  }

  const { supabase, user } = auth;
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('vapi_assistant_id, subscription_status')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Failed to load your account profile.' }, { status: 500 });
  }

  const assistantId = profile.vapi_assistant_id as string | null;
  let syncedToVapi = false;

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
    return NextResponse.json({ error: `Failed to save your business settings: ${updateError.message}` }, { status: 500 });
  }

  return NextResponse.json({ saved: true, syncedToVapi });
}

export async function DELETE(
  request: Request
): Promise<NextResponse<{ reset: true; syncedToVapi: boolean } | ApiErrorResponse>> {
  const auth = await authenticate();
  if ('error' in auth) {
    const fbUser = await getFallbackSessionUser();
    if (!fbUser) return auth.error;
    const store = await cookies();
    store.delete(FLUXFOX_PROFILE_COOKIE);
    return NextResponse.json({ reset: true, syncedToVapi: false });
  }
  const { supabase, user } = auth;

  const { data: profile } = await supabase
    .from('users')
    .select('vapi_assistant_id, subscription_status')
    .eq('id', user.id)
    .single();

  const assistantId = (profile?.vapi_assistant_id as string | null) ?? null;
  let syncedToVapi = false;

  if (assistantId && isSubscriptionActive(profile?.subscription_status as string | null)) {
    try {
      await resetAssistantToDefaults(assistantId, new URL(request.url).origin);
      syncedToVapi = true;
    } catch {}
  }

  await supabase
    .from('users')
    .update({
      business_name: null,
      business_industry: null,
      business_address: null,
      vapi_system_prompt: null,
    })
    .eq('id', user.id);

  return NextResponse.json({ reset: true, syncedToVapi });
}
