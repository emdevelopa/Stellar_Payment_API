export default function HeroSection() {
  return (
    <div className="flex w-full flex-col justify-center max-w-[460px]">
      {/* 3D-ish Card Illustration */}
      <div className="mb-10 w-full aspect-square max-w-[380px] rounded-[32px] bg-[#111926] p-6 shadow-2xl relative overflow-hidden flex flex-col justify-center items-center isolate">
        {/* Abstract glowing grid effect simulating the design */}
        <div className="absolute inset-0 bg-transparent opacity-40 flex items-center justify-center pointer-events-none z-0">
          <div className="w-[200%] h-[200%] absolute border-[1px] border-mint/10 transform-gpu rotate-[-15deg] shadow-[inset_0_0_50px_rgba(94,242,192,0.1)] translate-y-12" 
               style={{ 
                   backgroundSize: '40px 40px', 
                   backgroundImage: 'linear-gradient(to right, rgba(94,242,192,0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(94,242,192,0.1) 1px, transparent 1px)',
                   maskImage: 'radial-gradient(circle at center, black, transparent 70%)'
               }}>
          </div>
        </div>
        
        {/* Floating Card */}
        <div className="relative w-[280px] h-[170px] rounded-2xl bg-[#377b6a]/80 backdrop-blur-md border border-mint/20 shadow-[0_15px_30px_rgba(0,0,0,0.4),0_0_40px_rgba(94,242,192,0.15)] p-6 flex flex-col justify-between overflow-hidden z-10 transform -rotate-1">
            <div className="absolute inset-0 bg-gradient-to-br from-mint/20 to-transparent pointer-events-none"></div>
            <div className="flex justify-between items-start w-full z-10">
                <div className="w-9 h-9 rounded-full bg-mint/10 border border-mint/40 flex items-center justify-center shadow-[0_0_15px_rgba(94,242,192,0.4)]">
                    <div className="w-[14px] h-[14px] rounded-full bg-mint"></div>
                </div>
                <div className="text-[9px] text-white/50 font-mono tracking-[0.2em] font-medium pt-1">STELLAR CARD</div>
            </div>
            <div className="text-white/90 font-mono text-lg tracking-[0.25em] z-10 drop-shadow-md">
                **** **** **** 8842
            </div>
        </div>
      </div>

      <h1 className="text-[40px] leading-[1.1] font-bold text-white mb-5 tracking-tight">
        Seamless Payments<br />
        with <span className="text-mint">Stellar Pay</span>
      </h1>
      
      <p className="text-[15px] text-slate-400 mb-8 leading-relaxed pr-8">
        Fast, secure, and borderless payments for the modern digital era. Experience the future of finance today.
      </p>

      {/* Avatars row */}
      <div className="flex items-center gap-4">
        <div className="flex -space-x-2">
          <div className="w-8 h-8 rounded-full border border-[#0b0c10] bg-slate-700 overflow-hidden relative grayscale"><img src="https://i.pravatar.cc/100?img=1" alt="user" className="w-full h-full object-cover" /></div>
          <div className="w-8 h-8 rounded-full border border-[#0b0c10] bg-slate-600 overflow-hidden relative grayscale"><img src="https://i.pravatar.cc/100?img=2" alt="user" className="w-full h-full object-cover" /></div>
          <div className="w-8 h-8 rounded-full border border-[#0b0c10] bg-slate-500 overflow-hidden relative grayscale"><img src="https://i.pravatar.cc/100?img=3" alt="user" className="w-full h-full object-cover" /></div>
        </div>
        <span className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">JOINED BY 2M+ USERS</span>
      </div>
    </div>
  );
}
