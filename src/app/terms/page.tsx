import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, FileText } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Terms of Service — FluxFox',
  description:
    'The terms governing use of the FluxFox AI phone receptionist platform, including Google Calendar, Twilio telephony, and Vapi voice AI.',
};

const LAST_UPDATED = 'February 1, 2025';

/**
 * Day 13 — App Store Legal & Layout Wiring.
 *
 * Static Server Component satisfying Apple/Google App Store review
 * requirements for a public, linkable Terms of Service.
 */
export default function TermsOfServicePage() {
  return (
    <main
      id="fluxfox-terms-root"
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
          id="terms-back-to-login"
          href="/login"
          className="inline-flex items-center gap-2 min-h-[44px] text-sm text-zinc-400 hover:text-amber-400 transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Login
        </Link>

        <div
          id="terms-of-service-card"
          className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-6 sm:p-10 relative overflow-hidden shadow-2xl backdrop-blur-xl"
        >
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-500 via-orange-400 to-cyan-500" />

          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Terms of Service</h1>
              <p className="text-xs text-zinc-500">Last updated: {LAST_UPDATED}</p>
            </div>
          </div>

          <p className="mt-6 text-sm text-zinc-300 leading-relaxed">
            These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of FluxFox&rsquo;s AI phone
            receptionist platform, including our website, dashboard, and any related mobile applications
            (collectively, the &ldquo;Service&rdquo;). By creating an account or using the Service, you agree to be
            bound by these Terms.
          </p>

          <div className="mt-8 space-y-8 text-sm text-zinc-300 leading-relaxed">
            <section id="the-service">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                1. The Service
              </h2>
              <p>
                FluxFox deploys an AI-powered phone receptionist for your business. The Service provisions a
                dedicated business phone number, answers inbound calls with a configurable AI assistant, sends and
                receives text messages, and books qualifying appointments directly onto your connected Google
                Calendar. FluxFox is provided on a subscription basis and may be updated, modified, or enhanced from
                time to time.
              </p>
            </section>

            <section id="eligibility-account">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                2. Eligibility &amp; Account Registration
              </h2>
              <p>
                You must be at least 18 years old and able to form a binding contract to use FluxFox. You are
                responsible for maintaining the confidentiality of your account credentials and for all activity
                that occurs under your account, including calls, texts, and calendar events created through your AI
                receptionist.
              </p>
            </section>

            <section id="google-calendar-integration">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                3. Google Calendar Integration
              </h2>
              <p>
                By connecting your Google account, you authorize FluxFox to access your Google Calendar via the
                Google Calendar API using an encrypted refresh token, used solely to create, update, and manage
                calendar events for appointments booked on your behalf. FluxFox&rsquo;s access and use of this data
                is governed by our{' '}
                <Link href="/privacy" className="text-amber-400 hover:text-amber-300 font-medium">
                  Privacy Policy
                </Link>{' '}
                and complies with the Google API Services User Data Policy, including its Limited Use requirements.
                You may disconnect this integration at any time through your Google Account settings; doing so will
                disable automated appointment booking until reconnected.
              </p>
            </section>

            <section id="telephony-terms">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                4. Telephony Services (Twilio) &amp; Acceptable Use
              </h2>
              <p className="mb-2">
                Your dedicated business phone number and all associated call and SMS delivery are provided through{' '}
                <span className="text-zinc-200 font-medium">Twilio</span>, a third-party telecommunications
                infrastructure provider. You agree to:
              </p>
              <ul className="list-disc list-inside space-y-1.5 marker:text-amber-500">
                <li>
                  Use your FluxFox number only for lawful, legitimate business communications with your own
                  customers.
                </li>
                <li>
                  Comply with all applicable telecommunications laws, including the Telephone Consumer Protection
                  Act (TCPA), CAN-SPAM, and any call-recording consent laws in the jurisdictions where you operate.
                </li>
                <li>
                  Not use the Service to send unsolicited bulk messages (spam), engage in robocalling abuse, or
                  otherwise misuse the telephony network in a way that violates Twilio&rsquo;s Acceptable Use Policy.
                </li>
              </ul>
              <p className="mt-2">
                FluxFox reserves the right to suspend or reclaim a phone number that is used in violation of these
                Terms or applicable telecom regulations.
              </p>
            </section>

            <section id="vapi-ai-terms">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                5. AI Voice Processing (Vapi) &amp; Accuracy Disclaimer
              </h2>
              <p>
                Calls to your FluxFox number are answered by an AI voice assistant orchestrated through{' '}
                <span className="text-zinc-200 font-medium">Vapi</span>, which transcribes caller audio in real time
                and generates spoken responses. While FluxFox strives for high accuracy, AI-generated transcriptions,
                bookings, and conversational responses may occasionally contain errors or misunderstand caller
                intent. You are responsible for reviewing appointments booked by your AI receptionist and confirming
                details with customers where accuracy is critical. FluxFox is not liable for missed, mis-booked, or
                inaccurately transcribed appointments arising from AI processing errors.
              </p>
            </section>

            <section id="subscription-billing">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                6. Subscription &amp; Billing
              </h2>
              <p>
                Access to the Service requires an active paid subscription. Subscriptions are billed in advance on a
                recurring basis (monthly or as otherwise stated at checkout) and automatically renew until
                cancelled. Fees are processed securely by our payment provider and, where purchased through Apple
                App Store or Google Play, are subject to those platforms&rsquo; respective billing and refund
                policies. You may cancel your subscription at any time; cancellation takes effect at the end of the
                current billing period.
              </p>
            </section>

            <section id="acceptable-use">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                7. Acceptable Use
              </h2>
              <p>
                You agree not to use FluxFox to harass, defraud, or deceive any person; to transmit unlawful,
                threatening, or abusive content; to attempt to reverse-engineer or disrupt the Service; or to
                violate the acceptable use policies of any of our subprocessors, including Google, Twilio, and Vapi.
                FluxFox may suspend or terminate accounts that violate this section.
              </p>
            </section>

            <section id="intellectual-property">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                8. Intellectual Property
              </h2>
              <p>
                FluxFox and its licensors retain all rights, title, and interest in the Service, including its
                software, branding, and AI assistant configurations. You retain ownership of your business data,
                including call transcripts and calendar events generated through your use of the Service.
              </p>
            </section>

            <section id="termination">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                9. Termination
              </h2>
              <p>
                You may stop using the Service and delete your account at any time. FluxFox may suspend or
                terminate your access if you violate these Terms, fail to pay applicable fees, or misuse the
                telephony or AI voice features in a manner that creates legal or operational risk. Upon termination,
                your provisioned phone number and calendar integration will be deactivated.
              </p>
            </section>

            <section id="disclaimers-liability">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                10. Disclaimers &amp; Limitation of Liability
              </h2>
              <p>
                The Service is provided &ldquo;as is&rdquo; without warranties of any kind, express or implied,
                including merchantability, fitness for a particular purpose, and non-infringement. FluxFox does not
                guarantee uninterrupted telephony, AI transcription accuracy, or calendar synchronization at all
                times. To the fullest extent permitted by law, FluxFox&rsquo;s aggregate liability arising from your
                use of the Service shall not exceed the amount you paid FluxFox in the twelve (12) months preceding
                the claim.
              </p>
            </section>

            <section id="governing-law">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                11. Governing Law
              </h2>
              <p>
                These Terms are governed by the laws of the jurisdiction in which FluxFox is incorporated, without
                regard to conflict-of-law principles, unless otherwise required by applicable consumer protection
                law.
              </p>
            </section>

            <section id="changes-to-terms">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                12. Changes to These Terms
              </h2>
              <p>
                We may update these Terms from time to time. Material changes will be reflected by updating the
                &ldquo;Last updated&rdquo; date above and, where appropriate, communicated directly to account
                owners. Continued use of the Service after changes take effect constitutes acceptance of the revised
                Terms.
              </p>
            </section>

            <section id="terms-contact">
              <h2 className="text-lg font-semibold text-white mb-2 pb-2 border-b border-zinc-800">
                13. Contact Us
              </h2>
              <p>
                Questions about these Terms can be sent to{' '}
                <a href="mailto:legal@fluxfox.ai" className="text-amber-400 hover:text-amber-300 font-medium">
                  legal@fluxfox.ai
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
