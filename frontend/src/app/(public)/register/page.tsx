import RegistrationForm from "@/components/RegistrationForm";
import Link from "next/link";
import GuestGuard from "@/components/GuestGuard";
import dynamic from "next/dynamic";
import OnboardingTrackerSkeleton from "@/components/OnboardingTrackerSkeleton";
import type { OnboardingStep } from "@/components/OnboardingProgressTracker";

/**
 * Lazy-load the tracker so its JS bundle (including framer-motion) is only
 * fetched after the page paints — the skeleton renders instantly in its place.
 */
const OnboardingProgressTracker = dynamic(
  () => import("@/components/OnboardingProgressTracker").then((m) => m.OnboardingProgressTracker),
  {
    ssr: false,
    loading: () => (
      <OnboardingTrackerSkeleton
        stepCount={5}
        loadingLabel="Loading onboarding steps…"
      />
    ),
  },
);

/**
 * Demo steps shown on the registration page so users understand the full
 * onboarding journey before they submit the form.
 * Defined as a server-side constant — zero runtime cost.
 */
const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "create-account",
    title: "Create your account",
    description: "Register your merchant profile with a secure password.",
    completed: false,
    required: true,
    order: 1,
  },
  {
    id: "verify-email",
    title: "Verify your email",
    description: "Confirm your email address to activate your account.",
    completed: false,
    required: true,
    order: 2,
  },
  {
    id: "api-keys",
    title: "Generate API keys",
    description: "Create your live API key to start accepting payments.",
    completed: false,
    required: true,
    order: 3,
  },
  {
    id: "webhook",
    title: "Configure a webhook",
    description: "Point PLUTO at your server to receive real-time payment events.",
    completed: false,
    required: false,
    order: 4,
  },
  {
    id: "branding",
    title: "Customise checkout branding",
    description: "Upload your logo and set brand colours for the checkout page.",
    completed: false,
    required: false,
    order: 5,
  },
];

export default function RegisterPage() {
  return (
    <GuestGuard>
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-10 bg-white dark:bg-[#0a0a0a] px-6 py-14 md:py-20">

        {/* ── Page header ─────────────────────────────────────────────────── */}
        <header className="flex flex-col gap-6 text-center">
          <p className="font-bold text-xs uppercase tracking-[0.4em] text-[#6B6B6B] dark:text-pluto-400 motion-safe:animate-pulse">
            Onboarding
          </p>
          <h1 className="font-serif text-4xl font-bold uppercase tracking-tight text-[#0A0A0A] dark:text-white md:text-5xl">
            Join PLUTO
          </h1>
          <p className="text-sm font-medium leading-relaxed text-[#6B6B6B] dark:text-pluto-400">
            Create your merchant profile to start accepting modern payments and
            managing assets on the PLUTO infrastructure.
          </p>
        </header>

        {/* ── Onboarding Progress Tracker ──────────────────────────────────── */}
        <OnboardingProgressTracker
          steps={ONBOARDING_STEPS}
          currentStep="create-account"
          orientation="vertical"
          showStepNumbers
          compact={false}
        />

        {/* ── Registration form ────────────────────────────────────────────── */}
        <div className="relative overflow-hidden">
          <RegistrationForm />
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-[#6B6B6B] dark:text-pluto-400">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-bold text-[#0A0A0A] dark:text-white underline underline-offset-8 decoration-[#B8D4E8] transition-colors duration-200 hover:text-pluto-600 dark:hover:text-pluto-300 focus-visible:text-pluto-700 dark:focus-visible:text-pluto-200"
            >
              Log in here
            </Link>
          </p>
        </footer>

      </main>
    </GuestGuard>
  );
}
