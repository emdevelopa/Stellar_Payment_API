import React from "react";
import { Spinner } from "./Spinner";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  isLoading?: boolean;
}

const BASE_CLASSES =
  "group relative flex items-center justify-center rounded-xl px-6 font-bold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-pluto-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

const VARIANT_CLASSES: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "h-12 bg-pluto-500 text-white hover:bg-pluto-600",
  secondary:
    "h-12 border border-pluto-200 bg-pluto-50 text-pluto-700 hover:border-pluto-500 hover:bg-pluto-500 hover:text-white",
};

const ButtonBase = React.forwardRef<HTMLButtonElement, ButtonProps>(
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
    const variantClasses = VARIANT_CLASSES[variant];
    const showPrimaryGlow = variant === "primary";

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${BASE_CLASSES} ${variantClasses} ${className}`}
        {...props}
      >
        {isLoading ? (
          <span className="flex items-center gap-1.5 sm:gap-2">
            <Spinner
              size="sm"
              className={variant === "primary" ? "text-white" : "text-pluto-500"}
            />
            <span className="hidden xs:inline">Loading...</span>
          </span>
        ) : (
          children
        )}
        {showPrimaryGlow && (
          <div className="absolute inset-0 -z-10 bg-pluto-500/20 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
        )}
      </button>
    );
  },
);
ButtonBase.displayName = "Button";

export const Button = React.memo(ButtonBase);
Button.displayName = "Button";
