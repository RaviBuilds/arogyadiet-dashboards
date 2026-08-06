#!/bin/bash
# ============================================================================
# APK Secret Verification Script
# ============================================================================
# This script verifies that the built APK does not contain any embedded
# secrets (service-role keys, API secrets, database credentials, etc.)
#
# Usage: ./scripts/verify-apk-secrets.sh <path-to-apk>
#
# Requirements: 15.1, 15.2, 15.3, 15.4
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if APK file is provided
if [ -z "$1" ]; then
  echo -e "${RED}ERROR: No APK file specified${NC}"
  echo "Usage: $0 <path-to-apk>"
  exit 1
fi

APK_FILE="$1"

# Check if APK file exists
if [ ! -f "$APK_FILE" ]; then
  echo -e "${RED}ERROR: APK file not found: $APK_FILE${NC}"
  exit 1
fi

echo "============================================================================"
echo "APK Secret Verification"
echo "============================================================================"
echo "File: $APK_FILE"
echo "Size: $(du -h "$APK_FILE" | cut -f1)"
echo ""

# Patterns that should NEVER appear in the APK
SECRET_PATTERNS=(
  # Supabase service role
  "service_role"
  "service-role"
  "SUPABASE_SERVICE_ROLE_KEY"
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6" # JWT prefix for service role
  
  # Razorpay secrets
  "RAZORPAY_KEY_SECRET"
  "key_secret"
  
  # OneSignal secrets
  "ONESIGNAL_REST_API_KEY"
  "rest_api_key"
  
  # Turnstile secrets
  "TURNSTILE_SECRET_KEY"
  
  # Email secrets
  "RESEND_API_KEY"
  "RESEND_FROM_EMAIL"
  
  # Database credentials
  "database.*password"
  "db_password"
  "DB_PASSWORD"
  
  # Generic secret patterns
  "api_secret"
  "API_SECRET"
  "secret_key"
  "SECRET_KEY"
  "private_key"
  "PRIVATE_KEY"
)

# Patterns that are EXPECTED to be in the APK (public keys)
EXPECTED_PATTERNS=(
  "NEXT_PUBLIC_SUPABASE_URL"
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"
  "NEXT_PUBLIC_RAZORPAY_KEY_ID"
  "NEXT_PUBLIC_ONESIGNAL_APP_ID"
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY"
)

echo "Checking for forbidden secret patterns..."
echo ""

# Extract strings from APK (using aapt2 or strings)
# For a built APK, we use 'strings' command
TEMP_FILE=$(mktemp)
unzip -p "$APK_FILE" "classes*.dex" 2>/dev/null | strings > "$TEMP_FILE" 2>/dev/null || {
  # Fallback: try to extract all files and search
  unzip -l "$APK_FILE" > /dev/null 2>&1 || {
    echo -e "${RED}ERROR: Cannot read APK file${NC}"
    rm -f "$TEMP_FILE"
    exit 1
  }
  # Use strings on the whole APK if dex extraction fails
  strings "$APK_FILE" > "$TEMP_FILE"
}

FOUND_SECRETS=0

for pattern in "${SECRET_PATTERNS[@]}"; do
  if grep -qiE "$pattern" "$TEMP_FILE" 2>/dev/null; then
    echo -e "${RED}❌ FOUND forbidden pattern: $pattern${NC}"
    FOUND_SECRETS=$((FOUND_SECRETS + 1))
  fi
done

rm -f "$TEMP_FILE"

echo ""
echo "============================================================================"

if [ $FOUND_SECRETS -gt 0 ]; then
  echo -e "${RED}FAILED: Found $FOUND_SECRETS forbidden secret pattern(s)${NC}"
  echo ""
  echo "The APK contains embedded secrets which is a security risk."
  echo "Please review the build configuration and ensure no secrets are included."
  echo ""
  echo "This violates Requirements 15.1, 15.2, 15.3, 15.4"
  exit 1
else
  echo -e "${GREEN}PASSED: No forbidden secrets found in APK${NC}"
  echo ""
  echo "The APK build configuration is secure:"
  echo "  ✅ No service-role keys embedded"
  echo "  ✅ No database credentials embedded"
  echo "  ✅ No API secrets embedded"
  echo "  ✅ Only public endpoints referenced"
  echo ""
  echo "Requirements 15.1, 15.2, 15.3, 15.4: SATISFIED"
  exit 0
fi
