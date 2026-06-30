import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // Cross-portal import guard: Master portal must NOT import from Admin portal
  // or other portal route directories. (Requirement 9.3)
  {
    files: ["src/app/master/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/admin/*", "@/app/admin/**"],
              message:
                "Forbidden cross-portal import from the Admin portal (@/app/admin). Master portal modules must import only from @/shared, @/actions, @/services, @/lib, @/types, or @/validations.",
            },
            {
              group: ["@/app/customer/*", "@/app/customer/**"],
              message:
                "Forbidden cross-portal import from the Customer portal (@/app/customer). Master portal modules must import only from @/shared, @/actions, @/services, @/lib, @/types, or @/validations.",
            },
            {
              group: ["@/app/rider/*", "@/app/rider/**"],
              message:
                "Forbidden cross-portal import from the Rider portal (@/app/rider). Master portal modules must import only from @/shared, @/actions, @/services, @/lib, @/types, or @/validations.",
            },
            {
              group: [
                "**/app/admin/**",
                "**/app/customer/**",
                "**/app/rider/**",
              ],
              message:
                "Forbidden cross-portal relative import into another portal's route directory. Master portal modules must import only from shared, actions, services, lib, types, or validations.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
