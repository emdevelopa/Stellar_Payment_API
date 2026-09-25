/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      screens: {
        xs: "475px",
      },
      colors: {
        night: "var(--color-night)",
        tide: "var(--color-tide)",
        mint: "var(--color-mint)",
        glow: "var(--color-glow)",
        primary: "var(--color-primary)",
        secondary: "var(--color-secondary)",
        accent: "var(--color-accent)",
        pluto: {
          50: "var(--pluto-50)",
          100: "var(--pluto-100)",
          200: "var(--pluto-200)",
          300: "var(--pluto-300)",
          400: "var(--pluto-400)",
          500: "var(--pluto-500)",
          600: "var(--pluto-600)",
          700: "var(--pluto-700)",
          800: "var(--pluto-800)",
          900: "var(--pluto-900)",
        },
        gray: {
          950: "#000000",
        },
      },
      fontFamily: {
        heading: ["var(--font-heading)", "system-ui", "sans-serif"],
        body: ["var(--font-sans)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      keyframes: {
        "payment-confirmed": {
          "0%": { backgroundColor: "rgba(34, 197, 94, 0.3)" },
          "50%": { backgroundColor: "rgba(34, 197, 94, 0.15)" },
          "100%": { backgroundColor: "transparent" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% center" },
          "100%": { backgroundPosition: "-200% center" },
        },
        "onboarding-fill": {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
        "onboarding-fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "onboarding-check-pop": {
          "0%": { transform: "scale(0)", opacity: "0" },
          "70%": { transform: "scale(1.15)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "onboarding-spin": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "payment-confirmed": "payment-confirmed 1.2s ease-out forwards",
        shimmer: "shimmer 1.6s ease-in-out infinite",
        "onboarding-fill": "onboarding-fill 0.55s cubic-bezier(0.16,1,0.3,1) forwards",
        "onboarding-fade-up": "onboarding-fade-up 0.3s ease-out forwards",
        "onboarding-check-pop": "onboarding-check-pop 0.35s cubic-bezier(0.16,1,0.3,1) forwards",
        "onboarding-spin": "onboarding-spin 0.9s linear infinite",
      },
      backgroundColor: {
        dark: "#000000",
      },
    },
  },
  plugins: [],
};
