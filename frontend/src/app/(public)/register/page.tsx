import RegistrationForm from "@/components/RegistrationForm";
import Link from "next/link";
import GuestGuard from "@/components/GuestGuard";

export default function RegisterPage() {
  return (
    <GuestGuard>
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-12 px-6 py-24 bg-white">
      <header className="flex flex-col gap-6 text-center">
        <p className="font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">Onboarding</p>
        <h1 className="text-5xl font-bold text-[#0A0A0A] tracking-tight font-serif uppercase">Join PLUTO</h1>
        <p className="text-sm font-medium text-[#6B6B6B] leading-relaxed">
          Create your merchant profile to start accepting modern payments and managing assets on the PLUTO infrastructure.
        </p>
      </header>

      <div className="relative overflow-hidden">
        <RegistrationForm />
      </div>

      <footer className="text-center">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
          Already have an account?{" "}
          <Link href="/login" className="text-[#0A0A0A] underline underline-offset-8 font-bold hover:text-black">
            Log in here
          </Link>
        </p>
      </footer>
    </main>
    </GuestGuard>
  );
}
