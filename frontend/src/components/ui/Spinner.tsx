import React from "react";

interface SpinnerProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeMap = {
  sm: "w-4 h-4",
  md: "w-8 h-8",
  lg: "w-12 h-12",
  xl: "w-16 h-16",
};

export const Spinner: React.FC<SpinnerProps> = ({
  size = "md",
  className = "",
}) => {
  return (
    <div
      className={`relative ${sizeMap[size]} ${className}`}
      role="status"
      aria-label="Loading"
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        {/* Outer ring with Stellar-inspired design */}
        <circle
          cx="50"
          cy="50"
          r="40"
          stroke="currentColor"
          strokeWidth="4"
          className="text-mint/20"
          fill="none"
        />

        {/* Animated arc */}
        <circle
          cx="50"
          cy="50"
          r="40"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="251.2"
          strokeDashoffset="62.8"
          className="text-mint origin-center animate-spin"
          fill="none"
          style={{
            animationDuration: "1.5s",
            animationTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />

        {/* Inner glow circle */}
        <circle
          cx="50"
          cy="50"
          r="25"
          fill="currentColor"
          className="text-mint/10 animate-pulse"
          style={{
            animationDuration: "2s",
          }}
        />

        {/* Center star points (Stellar theme) */}
        <g className="text-mint">
          <circle cx="50" cy="50" r="8" fill="currentColor" />
          <path
            d="M50 35L50 42M50 58L50 65M35 50L42 50M58 50L65 50"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="animate-pulse"
            style={{
              animationDuration: "2s",
            }}
          />
        </g>
      </svg>
      <span className="sr-only">Loading...</span>
    </div>
  );
};
