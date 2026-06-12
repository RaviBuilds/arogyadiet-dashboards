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
  serverExternalPackages: [
    "@capacitor-community/background-geolocation",
    "@capacitor-community/keep-awake",
    "@capacitor/app",
  ],
  turbopack: {
    resolveAlias: {
      // This package is native-only (no JS bundle). Stub it for the web build.
      // Actual usage is guarded by Capacitor.isNativePlatform() checks.
      "@capacitor-community/background-geolocation": "./src/lib/capacitor/background-geolocation-stub.ts",
      // Keep awake is native-only, stub for web builds
      "@capacitor-community/keep-awake": "./src/lib/capacitor/keep-awake-stub.ts",
      // App plugin is native-only (back button, app state)
      "@capacitor/app": "./src/lib/capacitor/app-stub.ts",
    },
  },
};

export default nextConfig;
