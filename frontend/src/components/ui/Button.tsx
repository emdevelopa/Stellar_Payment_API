import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "primary", isLoading, children, disabled, ...props }, ref) => {
    const baseClasses =
      "group relative flex items-center justify-center rounded-xl px-6 font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50";
    
    // For primary button, height 12 (h-12) was used typically, but let's allow override or set default
    const primaryClasses = "h-12 bg-mint text-black hover:bg-glow";
    const secondaryClasses = "h-12 border border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white";

    const variantClasses = variant === "primary" ? primaryClasses : secondaryClasses;

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${baseClasses} ${variantClasses} ${className}`}
        {...props}
      >
        {isLoading && variant === "primary" ? (
          <span className="flex items-center gap-2">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Loading...
          </span>
        ) : (
          children
        )}
        {variant === "primary" && (
          <div className="absolute inset-0 -z-10 bg-mint/20 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
        )}
      </button>
    );
  }
);
Button.displayName = "Button";
