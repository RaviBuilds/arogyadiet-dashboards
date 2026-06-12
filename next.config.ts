import type { NextConfig } from "next";
import path from "path";

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
  // Webpack aliases (used by Vercel production builds)
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@capacitor-community/background-geolocation": path.resolve(
        __dirname,
        "src/lib/capacitor/background-geolocation-stub.ts",
      ),
      "@capacitor-community/keep-awake": path.resolve(
        __dirname,
        "src/lib/capacitor/keep-awake-stub.ts",
      ),
      "@capacitor/app": path.resolve(
        __dirname,
        "src/lib/capacitor/app-stub.ts",
      ),
    };
    return config;
  },
  // Turbopack aliases (used by local dev server)
  turbopack: {
    resolveAlias: {
      "@capacitor-community/background-geolocation":
        "./src/lib/capacitor/background-geolocation-stub.ts",
      "@capacitor-community/keep-awake":
        "./src/lib/capacitor/keep-awake-stub.ts",
      "@capacitor/app": "./src/lib/capacitor/app-stub.ts",
    },
  },
};

export default nextConfig;
