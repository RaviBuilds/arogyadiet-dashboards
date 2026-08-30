/**
 * Search-column vocabulary for the Franchise Customer directory.
 *
 * WHAT USED TO BE HERE: a franchise-local filter pipeline —
 * `applyAllFilters` plus `filterBySearch` / `filterByDiet` / `filterByStatus` /
 * `filterByMedical` / `filterByAllergy` / `filterByArchived`, and a
 * `FranchiseDashboardFilters` shape. All of it was deleted when the Meal tab
 * switched from a franchise-local copy of the directory table to the SHARED
 * `MealCustomerSection`.
 *
 * WHY IT HAD TO GO RATHER THAN SIT UNUSED: those predicates were a second,
 * silently diverging implementation of filtering that the shared
 * `CustomerTableCells` module already owns — and owns as option/predicate PAIRS,
 * so a dropdown and its filter can never disagree. The franchise copy had already
 * drifted: it exposed allergy as a standalone control while admin folds allergy
 * into the Diet & Allergy column filter, and it had no notion of the clinic
 * filter, the dietitian filter, the location data-quality flags or the plan
 * sub-filter. Left in place with no callers and no tests, it was a trap: the next
 * person to "fix a franchise filter" would have edited dead code and seen nothing
 * change.
 *
 * Filtering now lives in `FranchiseCustomerDashboard.filteredMealCustomers`, built
 * from the shared predicates:
 * `matchesDietAllergy` / `matchesStatus` / `matchesDietitian` / `matchesMedical` /
 * `matchesLocationFlags`, plus `filterRowsByClinic` from `@/lib/clinic/visibility`.
 */
export type SearchColumn = "fullName" | "mobile" | "email" | "primary_pincode";
