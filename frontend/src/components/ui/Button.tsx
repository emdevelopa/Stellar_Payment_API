import React from "react";
import { Spinner } from "./Spinner";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className = "",
      variant = "primary",
      isLoading,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const baseClasses =
      "group relative flex items-center justify-center rounded-xl px-6 font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50";

    // For primary button, height 12 (h-12) was used typically, but let's allow override or set default
    const primaryClasses = "h-12 bg-mint text-black hover:bg-glow";
    const secondaryClasses =
      "h-12 border border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white";

    const variantClasses =
      variant === "primary" ? primaryClasses : secondaryClasses;

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${baseClasses} ${variantClasses} ${className}`}
        {...props}
      >
        {isLoading ? (
          <span className="flex items-center gap-2">
            <Spinner
              size="sm"
              className={variant === "primary" ? "text-black" : "text-mint"}
            />
            <span>Loading...</span>
          </span>
        ) : (
          children
        )}
        {variant === "primary" && (
          <div className="absolute inset-0 -z-10 bg-mint/20 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
        )}
      </button>
    );
  },
);
Button.displayName = "Button";
