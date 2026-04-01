import Image from "next/image";

export default function HeroSection() {
  const avatars = [
    "https://i.pravatar.cc/100?img=1",
    "https://i.pravatar.cc/100?img=2",
    "https://i.pravatar.cc/100?img=3",
  ];

  return (
    <div className="flex w-full flex-col justify-center max-w-[460px]">
      {/* Surgical Card Illustration */}
      <div className="mb-16 w-full aspect-square max-w-[400px] rounded-[3rem] bg-[#F9F9F9] p-8 relative overflow-hidden flex flex-col justify-center items-center border border-[#E8E8E8]">
        {/* Minimal dot grid */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
             style={{ 
                 backgroundImage: 'radial-gradient(#000 1px, transparent 0)',
                 backgroundSize: '24px 24px'
             }}>
        </div>
        
        {/* Floating Minimal Card */}
        <div className="relative w-[320px] h-[190px] rounded-3xl bg-white shadow-[0_20px_50px_rgba(0,0,0,0.08)] p-8 flex flex-col justify-between overflow-hidden z-10 border border-[#E8E8E8] transform -rotate-2">
            <div className="flex justify-between items-start w-full z-10">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-[#0A0A0A] flex items-center justify-center">
                        <div className="w-3 h-3 rounded-full bg-white"></div>
                    </div>
                    <span className="font-serif text-sm font-bold tracking-tight text-[#0A0A0A]">PLUTO</span>
                </div>
                <div className="text-[8px] text-[#6B6B6B] font-bold tracking-[0.3em] uppercase pt-1">SECURE ASSET</div>
            </div>
            <div className="space-y-1 z-10">
                <div className="text-[#0A0A0A] font-mono text-lg font-bold tracking-[0.2em]">
                    **** **** **** 8842
                </div>
                <div className="text-[10px] text-[#6B6B6B] font-bold uppercase tracking-widest">VALID THRU 12/28</div>
            </div>
        </div>
      </div>

      <h1 className="text-5xl leading-[1.05] font-bold text-[#0A0A0A] mb-6 tracking-tighter uppercase">
        Commerce <br />
        <span className="text-[#6B6B6B]">Re-Engineered</span>
      </h1>
      
      <p className="text-base font-medium text-[#6B6B6B] mb-12 leading-relaxed pr-8">
        Precision infrastructure for modern merchants. High-performance payments built on the Stellar network.
      </p>

      {/* Social Proof */}
      <div className="flex items-center gap-4">
        <div className="flex -space-x-2">
          {avatars.map((src, index) => (
            <div
              key={src}
              className="relative h-10 w-10 overflow-hidden rounded-full border-2 border-white shadow-sm grayscale hover:grayscale-0 transition-all cursor-pointer"
            >
              <Image
                src={src}
                alt={`User avatar ${index + 1}`}
                fill
                sizes="40px"
                className="object-cover"
              />
            </div>
          ))}
        </div>
        <span className="text-[10px] font-bold tracking-widest text-[#6B6B6B] uppercase">TRUSTED BY 2M+ INNOVATORS</span>
      </div>
    </div>
  );
}
