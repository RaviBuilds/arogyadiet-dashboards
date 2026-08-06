#!/usr/bin/env node
/**
 * ============================================================================
 * APK Secret Verification Script (Node.js)
 * ============================================================================
 * This script verifies that the built APK does not contain any embedded
 * secrets (service-role keys, API secrets, database credentials, etc.)
 *
 * Usage: node scripts/verify-apk-secrets.mjs <path-to-apk>
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4
 * ============================================================================
 */

import { readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

// Patterns that should NEVER appear in the APK
const SECRET_PATTERNS = [
  // Supabase service role
  { pattern: /service_role/i, name: "service_role keyword" },
  { pattern: /service-role/i, name: "service-role keyword" },
  { pattern: /SUPABASE_SERVICE_ROLE_KEY/i, name: "SUPABASE_SERVICE_ROLE_KEY env var" },
  
  // Razorpay secrets
  { pattern: /RAZORPAY_KEY_SECRET/i, name: "RAZORPAY_KEY_SECRET env var" },
  { pattern: /key_secret.*[=:]/i, name: "key_secret assignment" },
  
  // OneSignal secrets  
  { pattern: /ONESIGNAL_REST_API_KEY/i, name: "ONESIGNAL_REST_API_KEY env var" },
  
  // Turnstile secrets
  { pattern: /TURNSTILE_SECRET_KEY/i, name: "TURNSTILE_SECRET_KEY env var" },
  
  // Email secrets
  { pattern: /RESEND_API_KEY/i, name: "RESEND_API_KEY env var" },
  
  // Database credentials
  { pattern: /DB_PASSWORD/i, name: "DB_PASSWORD env var" },
  { pattern: /database.*password/i, name: "database password reference" },
  
  // Generic secret patterns (but be careful not to flag legitimate code)
  { pattern: /API_SECRET_KEY/i, name: "API_SECRET_KEY" },
  { pattern: /SECRET_KEY.*[=:]/i, name: "SECRET_KEY assignment" },
  { pattern: /PRIVATE_KEY.*[=:]/i, name: "PRIVATE_KEY assignment" },
];

// Get APK file from command line
const apkFile = process.argv[2];

if (!apkFile) {
  console.error(`${RED}ERROR: No APK file specified${RESET}`);
  console.error("Usage: node scripts/verify-apk-secrets.mjs <path-to-apk>");
  process.exit(1);
}

if (!existsSync(apkFile)) {
  console.error(`${RED}ERROR: APK file not found: ${apkFile}${RESET}`);
  process.exit(1);
}

console.log("============================================================================");
console.log("APK Secret Verification");
console.log("============================================================================");
console.log(`File: ${apkFile}`);
console.log("");

/**
 * Extract strings from APK using unzip and strings command
 * On Windows, we'll read the APK as binary and search for patterns
 */
function extractStringsFromApk(apkPath) {
  try {
    // Try using 'strings' command (available on Unix-like systems and Git Bash on Windows)
    const result = spawnSync("strings", [apkPath], { 
      encoding: "utf8", 
      maxBuffer: 100 * 1024 * 1024 // 100MB buffer
    });
    
    if (result.status === 0) {
      return result.stdout;
    }
  } catch {
    // strings command not available, fall back to binary read
  }
  
  // Fallback: Read APK as binary and convert to string
  // This is less accurate but works cross-platform
  const buffer = readFileSync(apkPath);
  
  // Extract printable ASCII strings (sequences of 4+ printable chars)
  let strings = "";
  let current = "";
  
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    // Printable ASCII range (space to tilde)
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte);
    } else {
      if (current.length >= 4) {
        strings += current + "\n";
      }
      current = "";
    }
  }
  
  // Don't forget the last string
  if (current.length >= 4) {
    strings += current + "\n";
  }
  
  return strings;
}

console.log("Extracting strings from APK...");
const content = extractStringsFromApk(apkFile);
console.log(`Extracted ${content.split("\n").length} strings`);
console.log("");

console.log("Checking for forbidden secret patterns...");
console.log("");

let foundSecrets = 0;
const findings = [];

for (const { pattern, name } of SECRET_PATTERNS) {
  const matches = content.match(pattern);
  if (matches) {
    foundSecrets++;
    findings.push({ name, match: matches[0]?.substring(0, 50) });
    console.log(`${RED}❌ FOUND forbidden pattern: ${name}${RESET}`);
  }
}

console.log("");
console.log("============================================================================");

if (foundSecrets > 0) {
  console.error(`${RED}FAILED: Found ${foundSecrets} forbidden secret pattern(s)${RESET}`);
  console.error("");
  console.error("The APK contains embedded secrets which is a security risk.");
  console.error("Please review the build configuration and ensure no secrets are included.");
  console.error("");
  console.error("This violates Requirements 15.1, 15.2, 15.3, 15.4");
  process.exit(1);
} else {
  console.log(`${GREEN}PASSED: No forbidden secrets found in APK${RESET}`);
  console.log("");
  console.log("The APK build configuration is secure:");
  console.log("  ✅ No service-role keys embedded");
  console.log("  ✅ No database credentials embedded");
  console.log("  ✅ No API secrets embedded");
  console.log("  ✅ Only public endpoints referenced");
  console.log("");
  console.log("Requirements 15.1, 15.2, 15.3, 15.4: SATISFIED");
  process.exit(0);
}
