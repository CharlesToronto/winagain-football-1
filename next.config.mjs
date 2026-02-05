import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants.js";

/** @type {import('next').NextConfig} */
const baseConfig = {
  reactStrictMode: false,
  images: {
    domains: ["media.api-sports.io"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "media.api-sports.io",
        pathname: "/football/**",
      },
    ],
  },
  webpack: (config, { dev }) => {
    // Dev-only: Webpack pack cache can get corrupted (missing *.pack.gz) after restarts/builds.
    // Disabling it makes dev a bit slower, but prevents the UI from randomly losing CSS/JS (404/unstyled).
    if (dev) {
      config.cache = false;
    }
    return config;
  },
};

export default function nextConfig(phase) {
  // Vercel's build/runtime expects the default `.next` directory.
  // A custom distDir breaks deployments with missing manifests (e.g. routes-manifest.json).
  const isVercel =
    process.env.VERCEL === "1" ||
    process.env.VERCEL === "true" ||
    Boolean(process.env.VERCEL_ENV);
  if (isVercel) return baseConfig;

  // Prevent "next build/start" from corrupting a running "next dev" by separating dist dirs.
  // Keep dev on the default `.next` (dev server assumes this for static assets).
  if (phase === PHASE_PRODUCTION_BUILD || phase === PHASE_PRODUCTION_SERVER) {
    return { ...baseConfig, distDir: ".next-build" };
  }
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return baseConfig;
  }
  return baseConfig;
}
