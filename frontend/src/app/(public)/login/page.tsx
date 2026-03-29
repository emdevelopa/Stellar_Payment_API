import HeroSection from "@/components/login/HeroSection";
import LoginForm from "@/components/login/LoginForm";
import Link from "next/link";
import GuestGuard from "@/components/GuestGuard";

export const metadata = {
  title: "Login - Stellar Pay",
  description: "Sign in to your Stellar Pay dashboard.",
};

export default function LoginPage() {
  return (
    <GuestGuard>
    <main 
        className="relative min-h-screen flex flex-col text-[#f3f5f7] overflow-x-hidden font-sans bg-[#0b0c10] md:bg-gradient-to-r md:from-[#0b0c10] md:from-50% md:to-[#10131a] md:to-50%"
    >
      {/* Top Header */}
      

      {/* Background glow effects strictly limited to left side to mimic radial glow */}
      <div className="absolute top-1/4 -left-64 h-[600px] w-[600px] rounded-full bg-mint/5 blur-[150px] pointer-events-none z-0" />

      {/* Main Content */}
      <div className="flex-1 w-full max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 relative z-10">
        {/* Left Column (Hero) */}
        <div className="flex flex-col justify-center items-start px-8 md:px-16 lg:px-24 py-12 md:py-0">
          <HeroSection />
        </div>
        
        {/* Right Column (Form) */}
        <div className="flex flex-col justify-center items-center px-8 md:px-16 lg:px-24 py-12 md:py-0">
          <LoginForm />
        </div>
      </div>

      {/* Footer */}
      <footer className="w-full max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between px-8 md:px-12 py-8 mt-auto z-50 text-[10px] font-bold tracking-[0.08em] text-slate-500 uppercase border-t border-white/10 md:border-t-0">
         <div className="text-white mb-4 md:mb-0">
            Stellar Pay
         </div>
         <div className="flex gap-8 mb-4 md:mb-0">
            <Link href="#" className="hover:text-slate-300 transition-colors">Privacy Policy</Link>
            <Link href="#" className="hover:text-slate-300 transition-colors">Terms of Service</Link>
            <Link href="#" className="hover:text-slate-300 transition-colors">Help Center</Link>
         </div>
         <div className="text-slate-600">
            © 2024 STELLAR PAY. PRECISION THROUGH ATMOSPHERE.
         </div>
      </footer>
    </main>
    </GuestGuard>
  );
}
