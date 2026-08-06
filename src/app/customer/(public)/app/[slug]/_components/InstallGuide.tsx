// src/app/customer/(public)/app/[slug]/_components/InstallGuide.tsx
// Server Component that renders step-by-step installation instructions
// for sideloading APK files on Android devices.
//
// Requirements: 10.1, 10.2, 10.3, 10.4, 10.5

import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import {
  Download,
  FolderOpen,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";

/**
 * Installation step data structure.
 */
interface InstallStep {
  /** Step number for the ordered list */
  step: number;
  /** Icon name for visual representation */
  icon: React.ReactNode;
  /** Title of the step */
  title: string;
  /** Detailed description of the step */
  description: React.ReactNode;
}

/**
 * The steps for installing an APK on Android.
 * Presented in order: download, open, grant permission, confirm install.
 * (Req 10.1)
 */
const INSTALL_STEPS: InstallStep[] = [
  {
    step: 1,
    icon: <Download className="h-5 w-5" aria-hidden="true" />,
    title: "Download the file",
    description:
      "Tap the Download button and wait for the APK to download. You'll see a progress indicator in your notification area.",
  },
  {
    step: 2,
    icon: <FolderOpen className="h-5 w-5" aria-hidden="true" />,
    title: "Open the downloaded file",
    description:
      "Tap the download notification when it completes, or find the APK in your Downloads folder using your file manager.",
  },
  {
    step: 3,
    icon: <ShieldCheck className="h-5 w-5" aria-hidden="true" />,
    title: "Grant install permission",
    description: (
      <>
        When prompted with <strong>&ldquo;Install blocked&rdquo;</strong>, go to{" "}
        <strong>Settings → Allow from this source</strong> and enable the
        permission. This allows your device to install apps from this source.
        Then tap <strong>Install</strong> to continue.
      </>
    ),
  },
  {
    step: 4,
    icon: <CheckCircle2 className="h-5 w-5" aria-hidden="true" />,
    title: "Confirm the install",
    description: (
      <>
        Google Play Protect may show a warning for apps installed outside the
        Google Play Store. This is normal for sideloaded apps. To proceed, tap{" "}
        <strong>&ldquo;Install anyway&rdquo;</strong> or tap{" "}
        <strong>&ldquo;More details&rdquo;</strong> then{" "}
        <strong>Install</strong> to continue. The app will install shortly
        after.
      </>
    ),
  },
];

/**
 * InstallGuide is a Server Component that renders step-by-step instructions
 * for sideloading APK files on Android devices.
 *
 * The guide presents the install steps in order:
 * 1. Download the file
 * 2. Open the downloaded file
 * 3. Grant install-from-this-source permission
 * 4. Confirm the install
 *
 * It describes:
 * - The Android prompt requesting permission to install applications from
 *   the current source, and states which option continues the install (Req 10.2)
 * - The Google Play Protect warning screen shown for applications installed
 *   outside the Google Play Store (Req 10.3)
 * - Where the option to continue past the Google Play Protect warning screen
 *   appears on that screen (Req 10.4)
 *
 * @returns The installation guide component
 */
export function InstallGuide(): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          Installation Guide
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Follow these steps to install the app on your Android device. The
          process takes less than a minute.
        </p>

        <ol
          className="space-y-4"
          aria-label="Installation steps for the APK file"
        >
          {INSTALL_STEPS.map((step) => (
            <li
              key={step.step}
              className="flex gap-3 items-start"
              aria-label={`Step ${step.step}: ${step.title}`}
            >
              {/* Step number badge */}
              <div
                className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium"
                aria-hidden="true"
              >
                {step.step}
              </div>

              {/* Step content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-primary" aria-hidden="true">
                    {step.icon}
                  </span>
                  <h3 className="font-medium text-sm">{step.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {/* Additional help note */}
        <div className="mt-6 p-3 bg-muted/50 rounded-lg">
          <p className="text-xs text-muted-foreground">
            <strong>Note:</strong> If you&apos;ve previously enabled the install
            permission for this source, you won&apos;t see the permission prompt
            again. The app will install directly after opening the APK.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
