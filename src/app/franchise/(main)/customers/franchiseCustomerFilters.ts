/**
 * Pure filter utility functions for the Franchise Customer Dashboard.
 * Each filter is a standalone predicate; `applyAllFilters` composes them with AND logic.
 */

export type SearchColumn = "fullName" | "mobile" | "email" | "primary_pincode";

export interface FranchiseDashboardFilters {
  activeTab: "overview" | "meal" | "kit" | "onboarded";
  searchColumn: SearchColumn;
  searchTerm: string;
  filterDiet: string;
  filterStatus: string;
  filterMedical: string;
  filterAllergy: string;
  showArchived: boolean;
  showExpired: boolean;
}

interface FilterableCustomer {
  fullName: string;
  mobile: string;
  email: string;
  primary_pincode: string;
  dietary_preference: string;
  status: string;
  hasMedicalHistory: boolean;
  allergies: string | null;
  isActive: boolean;
}

/** Case-insensitive substring match on the selected column. */
export function filterBySearch<T extends FilterableCustomer>(
  customers: T[],
  searchColumn: SearchColumn,
  searchTerm: string,
): T[] {
  if (!searchTerm.trim()) return customers;
  const term = searchTerm.toLowerCase();
  return customers.filter((c) => {
    const value = c[searchColumn] ?? "";
    return value.toLowerCase().includes(term);
  });
}

/** Filter by dietary preference. */
export function filterByDiet<T extends FilterableCustomer>(
  customers: T[],
  filterDiet: string,
): T[] {
  if (filterDiet === "ALL") return customers;
  if (filterDiet === "NOT_SET") {
    return customers.filter(
      (c) => !c.dietary_preference || c.dietary_preference === "N/A",
    );
  }
  // Match "VEG" → "Veg", "NON_VEG" → "Non-Veg"
  const map: Record<string, string> = { VEG: "Veg", NON_VEG: "Non-Veg" };
  const target = map[filterDiet] ?? filterDiet;
  return customers.filter((c) => c.dietary_preference === target);
}

/** Filter by subscription-derived status. */
export function filterByStatus<T extends FilterableCustomer>(
  customers: T[],
  filterStatus: string,
): T[] {
  if (filterStatus === "ALL") return customers;
  return customers.filter((c) => c.status === filterStatus);
}

/** Filter by medical history presence. */
export function filterByMedical<T extends FilterableCustomer>(
  customers: T[],
  filterMedical: string,
): T[] {
  if (filterMedical === "ALL") return customers;
  if (filterMedical === "HAS_MEDICAL") {
    return customers.filter((c) => c.hasMedicalHistory);
  }
  return customers.filter((c) => !c.hasMedicalHistory);
}

/** Filter by allergy presence. */
export function filterByAllergy<T extends FilterableCustomer>(
  customers: T[],
  filterAllergy: string,
): T[] {
  if (filterAllergy === "ALL") return customers;
  if (filterAllergy === "HAS_ALLERGY") {
    return customers.filter(
      (c) =>
        c.allergies !== null &&
        c.allergies.trim() !== "" &&
        c.allergies.toLowerCase() !== "none" &&
        c.allergies.toLowerCase() !== "no allergy",
    );
  }
  // NO_ALLERGY
  return customers.filter(
    (c) =>
      c.allergies === null ||
      c.allergies.trim() === "" ||
      c.allergies.toLowerCase() === "none" ||
      c.allergies.toLowerCase() === "no allergy",
  );
}

/**
 * When the toggle is on, strictly show only archived (inactive) customers.
 * When off, show only active customers.
 */
export function filterByArchived<T extends FilterableCustomer>(
  customers: T[],
  showArchived: boolean,
): T[] {
  if (showArchived) return customers.filter((c) => !c.isActive);
  return customers.filter((c) => c.isActive);
}

/** Apply all filters in sequence (AND logic). */
export function applyAllFilters<T extends FilterableCustomer>(
  customers: T[],
  filters: Omit<FranchiseDashboardFilters, "activeTab" | "showExpired">,
): T[] {
  let result = filterByArchived(customers, filters.showArchived);
  result = filterBySearch(result, filters.searchColumn, filters.searchTerm);
  result = filterByDiet(result, filters.filterDiet);
  result = filterByStatus(result, filters.filterStatus);
  result = filterByMedical(result, filters.filterMedical);
  result = filterByAllergy(result, filters.filterAllergy);
  return result;
}
