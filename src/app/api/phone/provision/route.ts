import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { provisionPhoneNumber, TwilioApiError } from '@/lib/twilio';
import { updateAssistantTimezone, VapiApiError } from '@/lib/vapi';
import { getTimezoneFromAreaCode } from '@/utils/timezone';

export const dynamic = 'force-dynamic';

/**
 * DAY 4 SCHEMA MIGRATION — run against Supabase (PostgreSQL 15+):
 *
 *   alter table public.users
 *     add column if not exists twilio_phone_number text;
 *
 *   comment on column public.users.twilio_phone_number is
 *     'The purchased Twilio phone number bound to this user''s Vapi assistant (see /api/phone/provision).';
 */

interface ProvisionRequestBody {
  areaCode?: unknown;
}

interface ProvisionSuccessResponse {
  provisioned: true;
  phoneNumber: string;
  sid: string;
  timezone: string;
}

interface ApiErrorResponse {
  error: string;
}

/**
 * POST /api/phone/provision
 *
 * Purchases a Twilio local phone number in the requested area code and
 * binds its inbound VoiceUrl to the caller's Vapi assistant, then persists
 * the number to public.users.twilio_phone_number.
 *
 * No mock data, no fallback number: any failure mode returns a strict
 * JSON error with an appropriate status (401 for auth, 400 for bad
 * input/missing prerequisites, 500 for Twilio/DB failures).
 */
export async function POST(request: Request): Promise<NextResponse<ProvisionSuccessResponse | ApiErrorResponse>> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'No authenticated Supabase session was found.' }, { status: 401 });
  }

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

  const vapiAssistantId = profile.vapi_assistant_id as string | null;

  if (!vapiAssistantId) {
    return NextResponse.json(
      { error: 'No Vapi assistant found on your account. Deploy your AI receptionist before provisioning a phone number.' },
      { status: 400 }
    );
  }

  let body: ProvisionRequestBody;
  try {
    body = (await request.json()) as ProvisionRequestBody;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const { areaCode } = body;

  if (typeof areaCode !== 'string' || !/^\d{3}$/.test(areaCode.trim())) {
    return NextResponse.json(
      { error: 'An `areaCode` string of exactly 3 digits (e.g. "415") is required in the request body.' },
      { status: 400 }
    );
  }

  let provisioned;
  try {
    provisioned = await provisionPhoneNumber(areaCode, vapiAssistantId);
  } catch (err) {
    if (err instanceof TwilioApiError) {
      const status = err.status && err.status >= 400 && err.status < 500 ? 400 : 500;
      return NextResponse.json({ error: err.message }, { status });
    }
    return NextResponse.json({ error: 'Failed to provision the Twilio phone number.' }, { status: 500 });
  }

  // DAY 9: sync the assistant's "brain" to the local timezone of the area
  // code it now answers on, so it resolves {{now}} / relative dates
  // ("tomorrow", "3pm") against the caller's real local time instead of a
  // hardcoded default. The number has already been purchased and bound to
  // this assistant, so a failure here is a real, surfaced error rather
  // than a silently-ignored best-effort step.
  const timezone = getTimezoneFromAreaCode(areaCode);

  try {
    await updateAssistantTimezone(vapiAssistantId, timezone);
  } catch (err) {
    const message =
      err instanceof VapiApiError
        ? err.message
        : 'Failed to sync the assistant timezone with the newly provisioned number.';
    return NextResponse.json(
      {
        error: `Phone number ${provisioned.phoneNumber} was purchased, but the assistant timezone sync failed: ${message}`,
      },
      { status: 500 }
    );
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({ twilio_phone_number: provisioned.phoneNumber })
    .eq('id', user.id);

  if (updateError) {
    return NextResponse.json(
      {
        error: `Phone number ${provisioned.phoneNumber} was purchased but failed to save to your account: ${updateError.message}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      provisioned: true,
      phoneNumber: provisioned.phoneNumber,
      sid: provisioned.sid,
      timezone,
    },
    { status: 200 }
  );
}
