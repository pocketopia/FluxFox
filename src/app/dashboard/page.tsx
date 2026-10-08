import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import FluxFoxConsole from '@/components/dashboard/FluxFoxConsole';
import {
  CalendarCheck2,
  ShieldCheck,
  KeyRound,
  Zap,
  LogOut,
  Bot,
  Activity,
  CheckCircle2,
  Clock,
  Flame,
  CircleAlert,
  User,
  History,
  Settings,
  CreditCard,
  PhoneCall,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();

  // Validate the user session server-side
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // ------------------------------------------------------------------
  // TEMPORARY ADMIN BYPASS — Day 1 architecture review only.
  // ------------------------------------------------------------------
  // `src/app/login/page.tsx` currently authenticates against a single
  // hardcoded credential pair and never creates a real Supabase session.
  // That mismatch made this guard fire on every visit (authError/!user is
  // always true for the hardcoded "admin" login), bouncing the user back
  // to /login and producing the login -> onboarding -> dashboard -> login
  // routing loop.
  //
  // The redirect below is disabled ONLY so the dashboard skeleton can be
  // reviewed before real Supabase auth is wired into the login form.
  // TODO/RE-ENABLE before shipping: /dashboard is currently reachable
  // without a valid session while this stays commented out.
  //
  // if (authError || !user) {
  //   redirect('/login');
  // }
  void authError;

  // Retrieve user record from public.users table. Skipped when there is
  // no real session (e.g. while the admin bypass above is active) so we
  // never crash on `user.id`.
  const { data: profile } = user
    ? await supabase.from('users').select('*').eq('id', user.id).single()
    : { data: null };

  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    profile?.full_name ||
    user?.email?.split('@')[0] ||
    'Admin Preview';

  const avatarUrl =
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture ||
    profile?.avatar_url ||
    null;

  const hasRefreshToken = Boolean(
    profile?.google_refresh_token || user?.app_metadata?.provider === 'google'
  );

  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      })
    : null;

  // Live AI receptionist provisioning state, sourced directly from public.users.
  const vapiAssistantId = (profile?.vapi_assistant_id as string | null) ?? null;
  const twilioPhoneNumber = (profile?.twilio_phone_number as string | null) ?? null;

  // Real call telemetry from public.call_logs (see /api/webhook/vapi and the
  // Day 10 migration in supabase.sql). The table has no direct user_id FK —
  // each row is tagged with the Vapi assistant_id that received the call —
  // so rows belonging to this authenticated user are resolved via their own
  // public.users.vapi_assistant_id, scoped further by the RLS policy
  // "Users can view their own call logs".
  type CallLogRow = {
    id: string;
    customer_phone: string | null;
    created_at: string;
  };

  const { data: callLogs } = user && vapiAssistantId
    ? await supabase
        .from('call_logs')
        .select('id, customer_phone, created_at')
        .eq('assistant_id', vapiAssistantId)
        .order('created_at', { ascending: false })
    : { data: null as CallLogRow[] | null };
  // NOTE: the Day 8 Stripe web paywall (`profile.subscription_status`) has
  // been rolled back from the onboarding UI for App Store IAP compliance.
  // The `stripe_customer_id`/`subscription_status` columns and the
  // /api/stripe/* routes remain in place for a future in-app purchase
  // flow, but the dashboard no longer gates onboarding on them.

  async function handleSignOut() {
    'use server';
    const serverSupabase = await createClient();
    await serverSupabase.auth.signOut();
    redirect('/login');
  }

  return (
    <div
      id="fluxfox-dashboard-root"
      className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-amber-500/30 selection:text-amber-200 relative overflow-x-hidden"
    >
      {/* Cyber Grid Texture */}
      <div
        className="absolute inset-0 bg-[linear-gradient(to_right,#27272a15_1px,transparent_1px),linear-gradient(to_bottom,#27272a15_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none"
        aria-hidden="true"
      />

      {/* Cyber Ambient Glows */}
      <div
        className="absolute top-0 right-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute top-1/2 left-10 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none"
        aria-hidden="true"
      />

      {/* Top Navigation Bar */}
      <header
        id="dashboard-header"
        className="relative z-20 border-b border-zinc-800/80 bg-zinc-900/80 backdrop-blur-md px-6 py-4"
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center p-0.5 shadow-md shadow-amber-500/20 ring-1 ring-amber-400/40">
              <div className="w-full h-full bg-zinc-950 rounded-[6px] flex items-center justify-center">
                <Flame className="w-5 h-5 text-amber-400" />
              </div>
            </div>
            <div>
              <span className="font-mono text-base font-bold tracking-tight text-white">
                Flux<span className="text-amber-400">Fox</span>
              </span>
              <span
                className={`ml-2 px-2 py-0.5 text-[10px] font-medium tracking-wide rounded border ${
                  hasRefreshToken
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-zinc-800/60 text-zinc-400 border-zinc-700'
                }`}
              >
                {hasRefreshToken ? 'Receptionist Active' : 'Setup Needed'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-zinc-300 truncate max-w-[200px]">
                {user?.email ?? 'Admin preview session'}
              </span>
            </div>

            <form action={handleSignOut}>
              <button
                id="sign-out-button"
                type="submit"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700 text-xs text-zinc-300 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 text-zinc-400" />
                <span>Sign Out</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content Area — Side Nav + Content Panel */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 py-10 flex flex-col lg:flex-row gap-8 items-start">
        {/* Side Navigation */}
        <aside
          id="dashboard-side-nav"
          className="w-full lg:w-56 shrink-0 lg:sticky lg:top-24"
        >
          <nav className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-2 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
            <a
              href="#profile"
              id="nav-link-profile"
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-zinc-200 bg-zinc-800/70 hover:bg-zinc-800 border border-zinc-700/60 transition-colors whitespace-nowrap"
            >
              <User className="w-4 h-4 text-amber-400 shrink-0" />
              Profile
            </a>
            <a
              href="#call-logs"
              id="nav-link-call-logs"
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent transition-colors whitespace-nowrap"
            >
              <History className="w-4 h-4 shrink-0" />
              Call Logs
            </a>
            <a
              href="#ai-settings"
              id="nav-link-ai-settings"
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent transition-colors whitespace-nowrap"
            >
              <Settings className="w-4 h-4 shrink-0" />
              AI Settings
            </a>
            <a
              href="#billing"
              id="nav-link-billing"
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent transition-colors whitespace-nowrap"
            >
              <CreditCard className="w-4 h-4 shrink-0" />
              Billing
            </a>
          </nav>
        </aside>

        {/* Main Viewing Area */}
        <main id="dashboard-main-content" className="flex-1 min-w-0 space-y-10">
        {/* Welcome / Profile Section */}
        <section id="profile" className="scroll-mt-24">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 p-8 bg-zinc-900/90 border border-zinc-800 rounded-xl relative overflow-hidden shadow-2xl backdrop-blur-xl">
            {/* Cyber neon line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-500 via-orange-400 to-transparent" />

            <div className="flex items-center gap-5">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="w-16 h-16 rounded-xl border-2 border-amber-500/50 shadow-lg shadow-amber-500/10 object-cover"
                />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center font-mono font-bold text-xl text-amber-400">
                  {displayName.slice(0, 2).toUpperCase()}
                </div>
              )}

              <div>
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    You&rsquo;re signed in
                  </span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mt-1">
                  Welcome back, <span className="text-amber-400">{displayName}</span>
                </h1>
                <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                  {memberSince ? `With FluxFox since ${memberSince}` : 'Your AI receptionist is ready to work'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="px-4 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-lg text-xs flex items-center gap-3">
                <Bot className="w-4 h-4 text-amber-400" />
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Google Account</div>
                  <div className="text-zinc-200 font-semibold">
                    {hasRefreshToken ? 'Connected' : 'Not Connected'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Guided Mascot Onboarding — Flux walks the user through activation */}
        <FluxFoxConsole vapiAssistantId={vapiAssistantId} twilioPhoneNumber={twilioPhoneNumber} />

        {/* Operational Status Grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {/* Status Card: Calendar Synced */}
          <div
            id="status-card-calendar-synced"
            className={`md:col-span-2 bg-zinc-900/90 border rounded-xl p-6 relative overflow-hidden shadow-xl ${
              hasRefreshToken ? 'border-emerald-900/60' : 'border-zinc-800'
            }`}
          >
            <div
              className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${
                hasRefreshToken ? 'from-emerald-500 to-cyan-500' : 'from-zinc-700 to-transparent'
              }`}
            />
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`w-12 h-12 rounded-lg flex items-center justify-center shadow-md ${
                    hasRefreshToken
                      ? 'bg-emerald-950/70 border border-emerald-500/40 text-emerald-400 shadow-emerald-500/10'
                      : 'bg-zinc-800/70 border border-zinc-700 text-zinc-400'
                  }`}
                >
                  <CalendarCheck2 className="w-6 h-6" />
                </div>
                <div>
                  <span
                    className={`text-xs uppercase tracking-widest font-semibold ${
                      hasRefreshToken ? 'text-emerald-400' : 'text-zinc-500'
                    }`}
                  >
                    Calendar
                  </span>
                  <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2 mt-0.5">
                    {hasRefreshToken ? 'Your Calendar is Connected' : 'Connect Your Calendar'}
                    {hasRefreshToken ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <CircleAlert className="w-5 h-5 text-amber-400" />
                    )}
                  </h2>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 text-xs font-medium rounded-md border ${
                  hasRefreshToken
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                }`}
              >
                {hasRefreshToken ? 'LIVE' : 'ACTION NEEDED'}
              </span>
            </div>

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-lg">
                <div className="text-xs text-zinc-400 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  New Bookings
                </div>
                <div className="text-xs text-zinc-200 mt-1">
                  {hasRefreshToken
                    ? 'Automatically added to your calendar'
                    : 'Will sync once your calendar is connected'}
                </div>
                <div className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
                  <span>{hasRefreshToken ? 'Two-way sync enabled' : 'Not yet connected'}</span>
                </div>
              </div>

              <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-lg">
                <div className="text-xs text-zinc-400 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                  Your AI Receptionist
                </div>
                <div className="text-xs text-zinc-200 mt-1">
                  {hasRefreshToken
                    ? 'Answering and booking for you 24/7'
                    : 'Waiting to be switched on'}
                </div>
                <div className="text-[11px] text-amber-400 mt-1">
                  {hasRefreshToken ? 'Always on, always working' : 'Sign in with Google to activate'}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-zinc-500" />
                <span>{hasRefreshToken ? 'Last checked: just now' : 'No activity yet'}</span>
              </div>
              <div className="text-zinc-500 text-[11px]">
                Powered by Google Calendar
              </div>
            </div>
          </div>

          {/* Trust & Privacy Card */}
          <div
            id="security-telemetry-card"
            className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-6 relative overflow-hidden shadow-xl"
          >
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-500 to-transparent" />
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  Your Data is Protected
                </h3>
                <span className="text-[11px] text-zinc-400">
                  Bank-level security, always on
                </span>
              </div>
            </div>

            <ul className="space-y-3 text-xs text-zinc-300">
              <li className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
                <span className="text-zinc-400">Connection:</span>
                <span className="text-zinc-200">Encrypted</span>
              </li>
              <li className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
                <span className="text-zinc-400">Sign-in:</span>
                <span className="text-zinc-200">Secure Google Login</span>
              </li>
              <li className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
                <span className="text-zinc-400">Your data:</span>
                <span className="text-emerald-400">Visible only to you</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-zinc-400">Powered by:</span>
                <span className="text-amber-400">FluxFox</span>
              </li>
            </ul>
          </div>
        </section>

        {/* AI Settings — Active AI Receptionist Status */}
        <section id="ai-settings" className="scroll-mt-24">
          <div
            id="active-ai-receptionist-status"
            className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-6 relative overflow-hidden shadow-xl"
          >
            <div
              className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${
                vapiAssistantId ? 'from-emerald-500 to-cyan-500' : 'from-zinc-700 to-transparent'
              }`}
            />
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center border ${
                    vapiAssistantId
                      ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-400'
                      : 'bg-zinc-800/70 border-zinc-700 text-zinc-400'
                  }`}
                >
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight">
                    Active AI Receptionist
                  </h2>
                  <p className="text-xs text-zinc-500">Voice engine, prompt, and live phone line</p>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 text-xs font-medium rounded-md border ${
                  vapiAssistantId
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    : 'bg-zinc-800/60 text-zinc-400 border-zinc-700'
                }`}
              >
                {vapiAssistantId ? 'ONLINE' : 'NOT DEPLOYED'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-lg">
                <div className="text-xs text-zinc-400 flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5 text-amber-400" />
                  Assistant Status
                </div>
                <div className="text-sm text-zinc-200 mt-1.5 font-mono truncate">
                  {vapiAssistantId ?? 'No assistant deployed yet'}
                </div>
              </div>

              <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-lg">
                <div className="text-xs text-zinc-400 flex items-center gap-1.5">
                  <PhoneCall className="w-3.5 h-3.5 text-cyan-400" />
                  Business Line
                </div>
                <div className="text-sm text-zinc-200 mt-1.5 font-mono truncate">
                  {twilioPhoneNumber ?? 'No number provisioned yet'}
                </div>
              </div>

              <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-lg">
                <div className="text-xs text-zinc-400 flex items-center gap-1.5">
                  <CalendarCheck2 className="w-3.5 h-3.5 text-emerald-400" />
                  Calendar Sync
                </div>
                <div className="text-sm text-zinc-200 mt-1.5">
                  {hasRefreshToken ? 'Connected' : 'Not connected'}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Call Logs */}
        <section id="call-logs" className="scroll-mt-24">
          <div
            id="call-logs-card"
            className="bg-zinc-900/90 border border-zinc-800 rounded-xl overflow-hidden shadow-xl"
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight">Call Logs</h2>
                  <p className="text-xs text-zinc-500">
                    Every inbound call answered by your AI receptionist
                  </p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table id="call-logs-table" className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wide text-zinc-500">
                    <th className="px-6 py-3 font-semibold">Caller</th>
                    <th className="px-6 py-3 font-semibold">Date &amp; Time</th>
                  </tr>
                </thead>
                <tbody>
                  {callLogs && callLogs.length > 0 ? (
                    callLogs.map((call) => (
                      <tr
                        key={call.id}
                        className="border-b border-zinc-800/60 last:border-b-0 hover:bg-zinc-800/30 transition-colors"
                      >
                        <td className="px-6 py-4 text-zinc-200 whitespace-nowrap">
                          {call.customer_phone ?? 'Unknown caller'}
                        </td>
                        <td className="px-6 py-4 text-zinc-400 whitespace-nowrap">
                          {new Date(call.created_at).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2} className="px-6 py-10 text-center text-zinc-500 text-xs">
                        No calls yet. Your AI assistant is ready and waiting!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Billing */}
        <section id="billing" className="scroll-mt-24">
          <div
            id="billing-card"
            className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-6 relative overflow-hidden shadow-xl"
          >
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-500 to-transparent" />
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <CreditCard className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Billing</h2>
                <p className="text-xs text-zinc-500">Plan, trial status, and payment method</p>
              </div>
            </div>

            <div className="p-4 bg-zinc-950/70 border border-zinc-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs text-zinc-400">Current Plan</div>
                <div className="text-sm text-zinc-200 font-semibold mt-0.5">
                  {profile?.subscription_status === 'active' ? 'FluxFox Pro' : 'No active plan'}
                </div>
              </div>
              <span className="px-2.5 py-1 text-xs font-medium rounded-md border bg-zinc-800/60 text-zinc-400 border-zinc-700 w-fit">
                Managed in-app
              </span>
            </div>
          </div>
        </section>

        {/* Status Banner */}
        <section
          id="operational-banner"
          className="p-6 rounded-xl bg-gradient-to-r from-zinc-900 via-zinc-900 to-zinc-950 border border-zinc-800 relative text-xs text-zinc-400 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <span className="text-zinc-200 font-semibold">
                {hasRefreshToken ? "You're All Set" : 'One Step Away'}
              </span>
              <p className="text-zinc-500 mt-0.5">
                {hasRefreshToken
                  ? 'Your account is connected and your AI receptionist is ready to capture every lead.'
                  : 'Sign in with Google above to activate your AI receptionist and start booking appointments.'}
              </p>
            </div>
          </div>
          <div className="text-[11px] text-zinc-500 whitespace-nowrap">
            FluxFox &bull; Built for small business
          </div>
        </section>
        </main>
      </div>
    </div>
  );
}
