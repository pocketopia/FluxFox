import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { FLUXFOX_SESSION_COOKIE, FLUXFOX_PROFILE_COOKIE, type FallbackUserSession } from '@/lib/fallbackSession';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawEmail = typeof body.email === 'string' && body.email.trim()
      ? body.email.trim().toLowerCase()
      : body.provider === 'apple'
        ? 'apple.user@privaterelay.appleid.com'
        : body.provider === 'google'
          ? 'google.user@gmail.com'
          : 'reviewer@fluxfox.app';

    const provider = body.provider === 'apple' || body.provider === 'google' ? body.provider : 'email';
    const fullName = typeof body.fullName === 'string' && body.fullName.trim()
      ? body.fullName.trim()
      : rawEmail.split('@')[0];

    // Deterministic user ID from email
    let hash = 2166136261;
    for (let i = 0; i < rawEmail.length; i++) {
      hash ^= rawEmail.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    const userId = `00000000-0000-4000-8000-${hex.padEnd(12, '0').slice(0, 12)}`;

    const sessionPayload: FallbackUserSession = {
      id: userId,
      email: rawEmail,
      fullName,
      provider,
      createdAt: new Date().toISOString(),
    };

    const encoded = Buffer.from(JSON.stringify(sessionPayload), 'utf-8').toString('base64url');
    const store = await cookies();
    store.set(FLUXFOX_SESSION_COOKIE, encoded, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });

    return NextResponse.json({
      authenticated: true,
      user: sessionPayload,
      redirectTo: '/dashboard',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Authentication failed' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const store = await cookies();
  store.delete(FLUXFOX_SESSION_COOKIE);
  store.delete(FLUXFOX_PROFILE_COOKIE);
  return NextResponse.json({ signedOut: true });
}
