import { Suspense } from 'react';
import OnboardingWizard from '@/components/onboarding/OnboardingWizard';

/**
 * Day 14 — Frictionless 3-Step Onboarding Overhaul.
 *
 * Replaces the previous 6-step wizard (Business Info -> Tailor Voice ->
 * Google Calendar -> Demo the AI -> Phone Number -> Start Your Trial) with
 * a tight 3-step flow built for non-technical field workers: Persona ->
 * Calendar -> Magic. The $99/mo Stripe trial/paywall step has been removed
 * entirely — V1 ships as a free sandbox for App Store review (Apple
 * Guideline 3.1.1). All UI and state logic now lives in
 * `src/components/onboarding/OnboardingWizard.tsx`.
 *
 * Wrapped in `<Suspense>` because the wizard reads `useSearchParams()` (to
 * detect the `?calendar=connected|error` result from `/auth/callback`),
 * which Next.js's App Router requires to be suspense-bounded in a Client
 * Component tree.
 */
export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingWizard />
    </Suspense>
  );
}
