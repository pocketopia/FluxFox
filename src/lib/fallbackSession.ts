import { cookies } from 'next/headers';

export const FLUXFOX_SESSION_COOKIE = 'fluxfox_session_v1';
export const FLUXFOX_PROFILE_COOKIE = 'fluxfox_profile_v1';

export interface FallbackUserSession {
  id: string;
  email: string;
  fullName: string;
  provider: 'email' | 'apple' | 'google';
  createdAt: string;
}

export interface FallbackUserProfile {
  id: string;
  email: string;
  full_name: string;
  business_name: string | null;
  business_industry: string | null;
  business_address: string | null;
  vapi_system_prompt: string | null;
  vapi_assistant_id: string | null;
  twilio_phone_number: string | null;
  google_refresh_token: string | null;
  subscription_status: string;
  created_at: string;
}

export async function getFallbackSessionUser(): Promise<FallbackUserSession | null> {
  try {
    const store = await cookies();
    const raw = store.get(FLUXFOX_SESSION_COOKIE)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'));
    if (parsed && typeof parsed.email === 'string' && parsed.id) {
      return parsed as FallbackUserSession;
    }
  } catch {}
  return null;
}

export async function getFallbackUserProfile(user: FallbackUserSession): Promise<FallbackUserProfile> {
  const defaultProfile: FallbackUserProfile = {
    id: user.id,
    email: user.email,
    full_name: user.fullName || user.email.split('@')[0] || 'Business Owner',
    business_name: null,
    business_industry: null,
    business_address: null,
    vapi_system_prompt: null,
    vapi_assistant_id: null,
    twilio_phone_number: null,
    google_refresh_token: null,
    subscription_status: 'inactive',
    created_at: user.createdAt || new Date().toISOString(),
  };
  try {
    const store = await cookies();
    const raw = store.get(FLUXFOX_PROFILE_COOKIE)?.value;
    if (!raw) return defaultProfile;
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'));
    return { ...defaultProfile, ...parsed, id: user.id, email: user.email };
  } catch {
    return defaultProfile;
  }
}
