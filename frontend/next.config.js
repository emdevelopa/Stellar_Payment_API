/** @type {import('next').NextConfig} */
const path = require("path");
const createNextIntlPlugin = require("next-intl/plugin");

const withSentryConfig = (config) => config;
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  fallbacks: {
    offline: "/offline",
  },
});

const nextConfig = {
  reactStrictMode: true,
  compress: true,
  transpilePackages: ["remark-gfm", "rehype-prism-plus"],
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.pravatar.cc",
      },
    ],
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@sentry/nextjs": path.resolve(__dirname, "src/lib/sentry-shim.ts"),
      "framer-motion": path.resolve(__dirname, "src/lib/framer-motion-shim.tsx"),
      recharts: path.resolve(__dirname, "src/lib/recharts-shim.tsx"),
    };

    return config;
  },
};

const sentryWebpackPluginOptions = {
  silent: true, // Suppresses all logs
};

module.exports = withPWA(
  withNextIntl(withSentryConfig(nextConfig, sentryWebpackPluginOptions)),
);
