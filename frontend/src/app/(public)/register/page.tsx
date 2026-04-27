import RegistrationForm from "@/components/RegistrationForm";
import Link from "next/link";
import GuestGuard from "@/components/GuestGuard";

export default function RegisterPage() {
  return (
    <GuestGuard>
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-10 bg-white px-6 py-14 md:py-20">
        <header className="flex flex-col gap-6 text-center">
          <p className="font-bold text-xs uppercase tracking-[0.4em] text-[#6B6B6B] motion-safe:animate-pulse">
            Onboarding
          </p>
          <h1 className="font-serif text-4xl font-bold uppercase tracking-tight text-[#0A0A0A] md:text-5xl">
            Join PLUTO
          </h1>
          <p className="text-sm font-medium leading-relaxed text-[#6B6B6B]">
            Create your merchant profile to start accepting modern payments and
            managing assets on the PLUTO infrastructure.
          </p>
        </header>

        <div className="relative overflow-hidden">
          <RegistrationForm />
        </div>

        <footer className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-[#6B6B6B]">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-bold text-[#0A0A0A] underline underline-offset-8 decoration-[#B8D4E8] transition-colors duration-200 hover:text-pluto-600 focus-visible:text-pluto-700"
            >
              Log in here
            </Link>
          </p>
        </footer>
      </main>
    </GuestGuard>
  );
}
