/** @type {import('next').NextConfig} */
const path = require("path");

const withSentryConfig = (config) => config;

const nextConfig = {
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,
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

module.exports = withSentryConfig(nextConfig, sentryWebpackPluginOptions);
