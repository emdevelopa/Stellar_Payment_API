import HeroSection from "@/components/login/HeroSection";
import LoginForm from "@/components/login/LoginForm";
import Link from "next/link";
import GuestGuard from "@/components/GuestGuard";

export const metadata = {
  title: "Login - PLUTO",
  description: "Sign in to your PLUTO dashboard.",
};

export default function LoginPage() {
  return (
    <GuestGuard>
    <main 
        className="relative min-h-screen flex flex-col text-[#0A0A0A] overflow-x-hidden font-sans bg-white pt-8 md:pt-10"
    >
      {/* Main Content */}
      <div className="flex-1 w-full max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 relative z-10">
        {/* Left Column (Hero) */}
        <div className="flex flex-col justify-center items-start px-6 md:px-12 lg:px-20 py-10 md:py-0">
          <HeroSection />
        </div>
        
        {/* Right Column (Form) */}
        <div className="flex flex-col justify-center items-center px-6 md:px-12 lg:px-20 py-10 md:py-0">
          <LoginForm />
        </div>
      </div>

      {/* Footer */}
      <footer className="w-full max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 px-6 md:px-10 py-8 mt-auto z-50 text-[10px] font-bold tracking-widest text-[#6B6B6B] uppercase border-t border-[#E8E8E8]">
          <div className="text-[#0A0A0A] mb-4 md:mb-0 uppercase tracking-[0.4em] font-serif font-black">
            PLUTO
          </div>
         <div className="flex gap-8 mb-4 md:mb-0">
            <Link href="#" className="hover:text-[#0A0A0A] transition-colors">Privacy Policy</Link>
            <Link href="#" className="hover:text-[#0A0A0A] transition-colors">Terms of Service</Link>
            <Link href="#" className="hover:text-[#0A0A0A] transition-colors">Help Center</Link>
         </div>
          <div className="text-[#6B6B6B] uppercase tracking-widest">
            © {new Date().getFullYear()} PLUTO. THE HUB FOR MODERN COMMERCE.
          </div>
      </footer>
    </main>
    </GuestGuard>
  );
}
