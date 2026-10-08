import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Privacy Policy — FluxFox',
  description:
    'How FluxFox collects, uses, and protects your data across Google Calendar, Twilio telecommunications, and Vapi voice AI orchestration.',
};

const LAST_UPDATED = 'February 1, 2025';

/**
 * Day 13 — App Store Legal & Layout Wiring.
 *
 * Static Server Component. No client state, no data fetching — this page
 * exists purely to satisfy Apple/Google App Store review requirements for
 * a public, linkable Privacy Policy, and to give FluxFox users a real
 * accounting of how their Google Calendar, Twilio telephony, and Vapi
 * voice data are handled.
 */
export default function PrivacyPolicyPage() {
  return (
    <main
      id="fluxfox-privacy-root"
      className="min-h-screen bg-zinc-950 text-zinc-100 relative overflow-hidden font-sans selection:bg-amber-500/30 selection:text-amber-200 px-4 py-12 sm:py-16"
    >
      {/* Cyber Grid Background */}
      <div
        className="absolute inset-0 bg-[linear-gradient(to_right,#27272a15_1px,transparent_1px),linear-gradient(to_bottom,#27272a15_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute top-0 right-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute bottom-0 left-10 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none"
        aria-hidden="true"
      />

      <div className="relative z-10 max-w-3xl mx-auto">
        <Link
          id="privacy-back-to-login"
          href="/login"
          className="inline-flex items-center gap-2 min-h-[44px] text-sm text-zinc-400 hover:text-amber-400 transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Login
        </Link>

        <div
          id="privacy-policy-card"
          className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-6 sm:p-10 relative overflow-hidden shadow-2xl backdrop-blur-xl"
        >
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-500 via-orange-400 to-cyan-500" />

          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
              <p className="text-xs text-zinc-500">Last updated: {LAST_UPDATED}</p>
            </div>
          </div>

          <p className="mt-6 text-sm text-zinc-300 leading-relaxed">
            FluxFox (&ldquo;FluxFox,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates an AI
            phone receptionist platform that answers calls, sends text messages, and books appointments on behalf of
            small businesses. This Privacy Policy explains what information we collect, how we use it, and the
            choices you have — including how we handle data from our core service providers: Google Calendar,
            Twilio, and Vapi.
          </p>

          <div className="mt-8 space-y-8 text-sm text-zinc-300 leading-relaxed">
            <section id="information-we-collect">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                1. Information We Collect
              </h2>
              <p className="mb-2">We collect the following categories of information:</p>
              <ul className="list-disc list-inside space-y-1.5 marker:text-amber-500">
                <li>
                  <span className="text-zinc-200 font-medium">Account information:</span> your name, email address,
                  and profile picture, obtained when you sign in with Google OAuth.
                </li>
                <li>
                  <span className="text-zinc-200 font-medium">Calendar data:</span> your Google Calendar refresh
                  token and the appointment events our system creates on your behalf.
                </li>
                <li>
                  <span className="text-zinc-200 font-medium">Telephony data:</span> the business phone number
                  provisioned for you, and call/SMS metadata (caller number, timestamps, duration) generated when
                  customers contact your AI receptionist.
                </li>
                <li>
                  <span className="text-zinc-200 font-medium">Voice &amp; conversation data:</span> real-time audio
                  and generated transcripts of calls handled by your AI receptionist.
                </li>
                <li>
                  <span className="text-zinc-200 font-medium">Billing information:</span> subscription and payment
                  status, processed by our payment provider (we do not store raw card numbers).
                </li>
              </ul>
            </section>

            <section id="google-calendar-api">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                2. Google Calendar API Data Handling
              </h2>
              <p>
                When you connect your Google account, FluxFox requests offline access to the Google Calendar Events
                scope. The resulting refresh token is{' '}
                <span className="text-amber-400 font-medium">encrypted at rest</span> in our database and is used{' '}
                <span className="text-zinc-200 font-medium">
                  solely to create, read, and manage calendar events for the purpose of booking appointments
                </span>{' '}
                on your behalf when your AI receptionist takes a booking call. FluxFox&rsquo;s use and transfer of
                information received from Google APIs adheres to the{' '}
                <span className="text-zinc-200 font-medium">Google API Services User Data Policy</span>, including
                the Limited Use requirements. We do not use your Google Calendar data for advertising, do not sell
                it, and do not share it with any party except as strictly necessary to operate the booking feature
                you requested. You may revoke FluxFox&rsquo;s calendar access at any time from your{' '}
                <span className="text-zinc-200 font-medium">
                  Google Account&rsquo;s Security &amp; Third-Party Access settings
                </span>
                , which immediately invalidates the stored refresh token.
              </p>
            </section>

            <section id="twilio-telecom">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                3. Twilio Telecommunications Compliance (SMS &amp; Voice)
              </h2>
              <p>
                FluxFox provisions and operates business phone numbers through{' '}
                <span className="text-zinc-200 font-medium">Twilio</span>, our telecommunications infrastructure
                provider. Calls placed to, and text messages sent to or from, your FluxFox number are routed through
                Twilio&rsquo;s network and are subject to Twilio&rsquo;s own security and compliance program. FluxFox
                and its customers are responsible for complying with applicable telecommunications regulations,
                including the Telephone Consumer Protection Act (TCPA) and CAN-SPAM, when using SMS and voice
                features — including obtaining any consent required before sending marketing messages or recording
                calls in jurisdictions that require it. Call and SMS metadata (numbers, timestamps, duration,
                delivery status) is retained only for as long as necessary to provide the service, produce call
                summaries, and meet legal and billing obligations.
              </p>
            </section>

            <section id="vapi-voice-ai">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                4. Vapi AI Voice Orchestration
              </h2>
              <p>
                The conversational intelligence behind your AI receptionist is powered by{' '}
                <span className="text-zinc-200 font-medium">Vapi</span>, our voice AI orchestration provider. During
                a live call, audio is streamed to Vapi in real time so it can be transcribed and answered by your
                configured assistant; Vapi returns generated speech back to the caller through Twilio. Call
                transcripts and recordings produced through this pipeline are stored in connection with your FluxFox
                account so you can review how your AI receptionist handled a conversation, and are not used by
                FluxFox to train models for any party other than to operate and improve your own assistant.
              </p>
            </section>

            <section id="how-we-use-information">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                5. How We Use Information
              </h2>
              <ul className="list-disc list-inside space-y-1.5 marker:text-amber-500">
                <li>Operate, maintain, and improve the AI receptionist, texting, and booking features.</li>
                <li>Provision and route calls/SMS through your dedicated business phone number.</li>
                <li>Create and manage calendar events reflecting appointments booked by callers.</li>
                <li>Authenticate your account and secure access to your dashboard.</li>
                <li>Process subscription billing and communicate service updates.</li>
                <li>Detect, investigate, and prevent fraud, abuse, or security incidents.</li>
              </ul>
            </section>

            <section id="data-sharing">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                6. Data Sharing &amp; Subprocessors
              </h2>
              <p className="mb-2">
                We do not sell your personal information. We share data only with the infrastructure providers
                necessary to deliver the service:
              </p>
              <ul className="list-disc list-inside space-y-1.5 marker:text-amber-500">
                <li>
                  <span className="text-zinc-200 font-medium">Google</span> — Calendar API, for appointment booking.
                </li>
                <li>
                  <span className="text-zinc-200 font-medium">Twilio</span> — phone number provisioning, call and SMS
                  delivery.
                </li>
                <li>
                  <span className="text-zinc-200 font-medium">Vapi</span> — real-time voice transcription and AI
                  response generation.
                </li>
                <li>
                  <span className="text-zinc-200 font-medium">Supabase</span> — authentication and encrypted
                  database storage.
                </li>
                <li>
                  <span className="text-zinc-200 font-medium">Stripe</span> — subscription billing and payment
                  processing.
                </li>
              </ul>
            </section>

            <section id="data-security">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                7. Data Security &amp; Retention
              </h2>
              <p>
                Data is encrypted in transit (TLS) and sensitive credentials — including Google refresh tokens — are
                encrypted at rest. Access to production data is restricted to authorized personnel on a
                need-to-know basis. We retain account, call, and calendar data for as long as your account is active
                or as needed to provide the service, and delete or anonymize it upon account deletion, subject to
                any legal retention obligations.
              </p>
            </section>

            <section id="your-rights">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                8. Your Rights &amp; Choices
              </h2>
              <p>
                You may access, export, or request deletion of your FluxFox account data at any time by contacting
                us. You may revoke Google Calendar access from your Google Account settings, and you may request
                that we deactivate your provisioned phone number, at which point outbound telephony and voice AI
                processing for that number will cease.
              </p>
            </section>

            <section id="children">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                9. Children&rsquo;s Privacy
              </h2>
              <p>
                FluxFox is a business tool intended for use by adults operating a small business. We do not
                knowingly collect personal information from children under 13.
              </p>
            </section>

            <section id="policy-changes">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                10. Changes to This Policy
              </h2>
              <p>
                We may update this Privacy Policy from time to time. Material changes will be reflected by updating
                the &ldquo;Last updated&rdquo; date above, and, where appropriate, communicated directly to account
                owners.
              </p>
            </section>

            <section id="contact">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                11. Contact Us
              </h2>
              <p>
                Questions about this Privacy Policy or your data can be sent to{' '}
                <a href="mailto:privacy@fluxfox.ai" className="text-amber-400 hover:text-amber-300 font-medium">
                  privacy@fluxfox.ai
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
