// src/lib/bulk-migration/kitTemplates.ts
//
// Column specification, human-facing header labels, sample rows and the
// instruction-sheet content for the KIT customer bulk-import spreadsheet.
//
// LAYERING: Pure data. No I/O, no Supabase, no React — imported by both the
// workbook generator (server action) and the row validator.
//
// A KIT customer is a one-time purchase (Customer_Category = KIT): one sheet
// row creates the Customer_Record, its KIT subscription and the payment in a
// single atomic write. That is intentionally different from the MEAL migration,
// which splits customers and subscriptions across two files.

/** Whether a template column must be filled by the client. */
export type KitFieldRequirement = "required" | "optional";

export interface KitTemplateField {
  /** Normalized row key the parser/validator reads. */
  key: string;
  /** Requirement marker rendered next to the header and in the guide sheet. */
  requirement: KitFieldRequirement;
  /** Accepted format / allowed values, shown in the guide sheet. */
  format: string;
  /** What happens when an optional column is left blank. */
  notes: string;
}

/**
 * The KIT collection sheet columns, in the order they appear in the template.
 * Grouped: identity → KIT purchase → shipping address → payment/access.
 */
export const KIT_CUSTOMER_TEMPLATE_FIELDS: readonly KitTemplateField[] = [
  {
    key: "full_name",
    requirement: "required",
    format: "Text, 2-100 characters",
    notes: "Customer's full name as it should appear on the invoice.",
  },
  {
    key: "mobile",
    requirement: "required",
    format: "10 digits, starts with 6-9 (no +91, no spaces)",
    notes:
      "Primary identifier. Must be unique across the platform and unique within this file.",
  },
  {
    key: "gender",
    requirement: "required",
    format: "Male | Female | Other",
    notes: "Case-insensitive.",
  },
  {
    key: "dietary_preference",
    requirement: "required",
    format: "Veg | Non-Veg",
    notes: "Case-insensitive. 'Non Veg' and 'NonVeg' are also accepted.",
  },
  {
    key: "email",
    requirement: "optional",
    format: "Valid email address",
    notes:
      "Leave blank when the customer has no email. A hidden placeholder email is generated from the mobile number.",
  },
  {
    key: "allergies",
    requirement: "optional",
    format: "Text, up to 500 characters",
    notes: "Free text. Leave blank when there are none.",
  },
  {
    key: "kit_product",
    requirement: "required",
    format: "KIT product name from the 'reference_kit_products' sheet",
    notes:
      "Must match an active KIT product name exactly (case-insensitive). A product UUID is also accepted.",
  },
  {
    key: "kit_duration_days",
    requirement: "required",
    format: "Whole number, 1-365",
    notes: "Number of days the kit covers. Drives the subscription end date.",
  },
  {
    key: "start_date",
    requirement: "optional",
    format: "YYYY-MM-DD",
    notes:
      "The date the kit programme starts. Leave blank to use today's date. Past dates are allowed for offline migration.",
  },
  {
    key: "initial_meal_preference",
    requirement: "optional",
    format: "VEG | EGG | CHICKEN",
    notes:
      "Defaults from dietary_preference: Veg becomes VEG, Non-Veg becomes CHICKEN.",
  },
  {
    key: "address_tag",
    requirement: "optional",
    format: "Home | Office",
    notes: "Defaults to Home.",
  },
  {
    key: "address_flat_number",
    requirement: "required",
    format: "Text, 1-50 characters",
    notes: "Flat / house / door number, e.g. '4B' or 'Plot 21'.",
  },
  {
    key: "address_floor_number",
    requirement: "optional",
    format: "Text, up to 20 characters",
    notes: "Floor or block, e.g. '2nd Floor'.",
  },
  {
    key: "address_street",
    requirement: "optional",
    format: "Text, up to 255 characters",
    notes: "Building name, street and locality details.",
  },
  {
    key: "address_area",
    requirement: "required",
    format: "Text",
    notes: "Locality / area name, e.g. 'Jubilee Hills'.",
  },
  {
    key: "address_city",
    requirement: "required",
    format: "Text",
    notes: "City name.",
  },
  {
    key: "address_state",
    requirement: "required",
    format: "Text",
    notes: "State name.",
  },
  {
    key: "address_pincode",
    requirement: "required",
    format: "Exactly 6 digits",
    notes:
      "KIT kits ship by courier, so any Indian pincode is accepted - it does not have to be a serviceable delivery pincode.",
  },
  {
    key: "address_lat",
    requirement: "optional",
    format: "Decimal, -90 to 90",
    notes: "Leave blank when unknown. Not required for KIT courier shipping.",
  },
  {
    key: "address_lng",
    requirement: "optional",
    format: "Decimal, -180 to 180",
    notes: "Leave blank when unknown. Not required for KIT courier shipping.",
  },
  {
    key: "clinic_name",
    requirement: "optional",
    format: "Existing clinic name (see the 'reference_clinics' sheet when present)",
    notes:
      "Internal use. Only applied when the pincode does not map to a clinic on its own. Leave blank to let the system resolve it.",
  },
  {
    key: "payment_status",
    requirement: "required",
    format: "PAID",
    notes:
      "Only PAID is accepted - a KIT record is created against a collected payment. 'Payment Collected' is also accepted.",
  },
  {
    key: "temporary_pin",
    requirement: "optional",
    format: "Exactly 6 digits",
    notes:
      "Login PIN for the customer app. Leave blank to use the last 6 digits of the mobile number. The customer is forced to change it on first login.",
  },
] as const;

/** Normalized row keys, in template order. */
export const KIT_CUSTOMER_BULK_KEYS = KIT_CUSTOMER_TEMPLATE_FIELDS.map(
  (f) => f.key,
);

/**
 * The header row written into the template: the field key plus an inline
 * `(optional)` marker. The parser strips the marker, so the client can leave
 * the labels untouched.
 */
export const KIT_CUSTOMER_BULK_HEADERS = KIT_CUSTOMER_TEMPLATE_FIELDS.map((f) =>
  f.requirement === "optional" ? `${f.key} (optional)` : f.key,
);

/** Guide-sheet header row. */
export const KIT_GUIDE_HEADERS = [
  "field",
  "required / optional",
  "format & allowed values",
  "notes",
] as const;

/** Guide-sheet body rows, derived from the single field specification above. */
export const KIT_GUIDE_ROWS: string[][] = KIT_CUSTOMER_TEMPLATE_FIELDS.map(
  (f) => [f.key, f.requirement.toUpperCase(), f.format, f.notes],
);

/** Free-text notes rendered above the field table in the guide sheet. */
export const KIT_GUIDE_INTRO: string[] = [
  "ArogyaDiet - KIT customer bulk import",
  "",
  "One row = one KIT customer. Each row creates the customer, their KIT subscription and the payment record together.",
  "Fill the '01_kit_customers' sheet only. Do not rename, reorder or delete columns.",
  "Headers marked '(optional)' may be left blank; every other column must be filled.",
  "Keep the '(optional)' text in the header - the importer ignores it.",
  "mobile is the primary identifier: it must be unique in this file and must not already exist on the platform.",
  "Use the 'reference_kit_products' sheet for the valid kit_product values.",
  "Leave clinic_name blank unless the ArogyaDiet team asks you to fill it.",
  "Save the file as .xlsx or .csv. It is uploaded in the admin portal under Customers > Bulk migration > KIT customers.",
  "",
];

export const KIT_REFERENCE_PRODUCTS_HEADERS = [
  "kit_product",
  "price_inr_inclusive",
  "kit_product_id",
] as const;

export const KIT_REFERENCE_CLINICS_HEADERS = ["clinic_name"] as const;

/** Two illustrative rows: one fully populated, one with optionals left blank. */
export const KIT_CUSTOMER_BULK_SAMPLE_ROWS: Record<string, string>[] = [
  {
    full_name: "Rahul Sharma",
    mobile: "9876543210",
    gender: "Male",
    dietary_preference: "Veg",
    email: "rahul@example.com",
    allergies: "No peanuts",
    kit_product: "Weightloss Prime",
    kit_duration_days: "30",
    start_date: "2026-07-01",
    initial_meal_preference: "VEG",
    address_tag: "Home",
    address_flat_number: "4B",
    address_floor_number: "2nd Floor",
    address_street: "Emerald Heights, Road No 10",
    address_area: "Jubilee Hills",
    address_city: "Hyderabad",
    address_state: "Telangana",
    address_pincode: "500033",
    address_lat: "17.4326",
    address_lng: "78.4071",
    clinic_name: "",
    payment_status: "PAID",
    temporary_pin: "123456",
  },
  {
    full_name: "Priya Nair",
    mobile: "9123456780",
    gender: "Female",
    dietary_preference: "Non-Veg",
    email: "",
    allergies: "",
    kit_product: "Weightloss Premium",
    kit_duration_days: "60",
    start_date: "",
    initial_meal_preference: "",
    address_tag: "",
    address_flat_number: "12",
    address_floor_number: "",
    address_street: "Green Park Road",
    address_area: "Kochi",
    address_city: "Kochi",
    address_state: "Kerala",
    address_pincode: "682001",
    address_lat: "",
    address_lng: "",
    clinic_name: "",
    payment_status: "PAID",
    temporary_pin: "",
  },
];
