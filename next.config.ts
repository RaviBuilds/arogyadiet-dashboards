import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "mozolxjkzytjigdmngqq.supabase.co",
        port: "",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  serverExternalPackages: ["@capacitor-community/background-geolocation"],
  turbopack: {
    resolveAlias: {
      // This package is native-only (no JS bundle). Stub it for the web build.
      // Actual usage is guarded by Capacitor.isNativePlatform() checks.
      "@capacitor-community/background-geolocation": "./src/lib/capacitor/background-geolocation-stub.ts",
    },
  },
};

export default nextConfig;
