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
  experimental: {
    serverActions: {
      // Product forms submit their image gallery through a Server Action as
      // FormData. `ProductMediaGallery` accepts multiple images at up to 5 MB
      // each, so the default 1 MB Server Action body limit rejects a normal
      // multi-image submission with "Body exceeded 1 MB limit". 25 MB leaves
      // room for a handful of full-size images while still bounding how much
      // a single request can make the server parse.
      bodySizeLimit: "25mb",
    },
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
