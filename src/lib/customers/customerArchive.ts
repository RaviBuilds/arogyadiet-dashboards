export const INACTIVE_EMAIL_DOMAIN = "@inactive.arogyadiet.local";

export function buildArchivedEmail(profileId: string) {
  return `archived+${profileId}${INACTIVE_EMAIL_DOMAIN}`;
}

export function isArchivedCustomerEmail(email: string) {
  return email.includes(INACTIVE_EMAIL_DOMAIN);
}
