import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", label, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`rounded-xl border border-white/10 bg-white/5 p-3 text-white placeholder:text-slate-600 focus-visible:border-mint focus-visible:ring-2 focus-visible:ring-mint ${className}`}
          {...props}
        />
      </div>
    );
  },
);
Input.displayName = "Input";
