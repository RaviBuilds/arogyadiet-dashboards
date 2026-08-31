// @vitest-environment jsdom
//
// src/shared/components/master/__tests__/OperationsGroupConfig.test.tsx
//
// franchise-scoped-access Task 8.
//
// `OperationsGroupConfig` was extracted from `UserManagement.tsx` so the
// Franchise Users panel could reuse it rather than grow a second copy. These
// tests pin the two things that extraction must not break:
//
//   1. The default group set is still the full admin set, so every pre-existing
//      call site behaves exactly as before.
//   2. A caller may narrow the offered groups — which is how the franchise panel
//      excludes `franchises`, and how the Clinic_Scoped_Admin path keeps
//      offering only the four clinic-scoped groups.
//
// The behavioural contract (checking a group defaults it to Manage; the
// permission Select stays disabled until checked) is pinned too, since the
// franchise create/edit forms rely on "checked implies a persisted permission".

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OperationsGroupConfig } from "@/shared/components/master/OperationsGroupConfig";
import {
  OPERATIONS_GROUPS,
  FRANCHISE_OPERATIONS_GROUPS,
  CLINIC_SCOPED_GROUPS,
  GROUP_LABELS,
  type OperationsAccess,
} from "@/lib/auth/adminAccessCore";

function renderConfig(
  props: Partial<React.ComponentProps<typeof OperationsGroupConfig>> = {},
) {
  const onChange = vi.fn();
  const value: OperationsAccess = props.value ?? {};
  render(
    <OperationsGroupConfig
      idPrefix="test"
      value={value}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
}

describe("OperationsGroupConfig — offered groups", () => {
  it("offers all six admin groups by default (pre-existing call sites unchanged)", () => {
    renderConfig();

    for (const group of OPERATIONS_GROUPS) {
      expect(
        screen.getByLabelText(GROUP_LABELS[group], { exact: false }),
      ).toBeInTheDocument();
    }
  });

  it("offers exactly the franchise groups when narrowed, excluding Franchises", () => {
    renderConfig({ groups: FRANCHISE_OPERATIONS_GROUPS });

    for (const group of FRANCHISE_OPERATIONS_GROUPS) {
      expect(
        screen.getByLabelText(GROUP_LABELS[group], { exact: false }),
      ).toBeInTheDocument();
    }

    // The whole point of the narrowed set: `franchises` governs Core network
    // management and must never be grantable to a franchise-scoped user.
    expect(
      screen.queryByLabelText(GROUP_LABELS.franchises, { exact: false }),
    ).not.toBeInTheDocument();
  });

  it("still supports the clinic-scoped subset", () => {
    renderConfig({ groups: CLINIC_SCOPED_GROUPS });

    expect(
      screen.queryByLabelText(GROUP_LABELS.operations, { exact: false }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(GROUP_LABELS.franchises, { exact: false }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(GROUP_LABELS.customers, { exact: false }),
    ).toBeInTheDocument();
  });
});

describe("OperationsGroupConfig — behaviour", () => {
  it("defaults a newly checked group to manage", async () => {
    const user = userEvent.setup();
    const { onChange } = renderConfig({ groups: FRANCHISE_OPERATIONS_GROUPS });

    await user.click(screen.getByLabelText(GROUP_LABELS.customers, { exact: false }));

    expect(onChange).toHaveBeenCalledWith({ customers: "manage" });
  });

  it("removes the group entirely when unchecked", async () => {
    const user = userEvent.setup();
    const { onChange } = renderConfig({
      groups: FRANCHISE_OPERATIONS_GROUPS,
      value: { customers: "view" },
    });

    await user.click(screen.getByLabelText(GROUP_LABELS.customers, { exact: false }));

    // Absent, not set to some falsy permission — `hasGroupAccess` keys off
    // presence.
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("preserves an existing permission rather than resetting it to manage", async () => {
    const user = userEvent.setup();
    const { onChange } = renderConfig({
      groups: FRANCHISE_OPERATIONS_GROUPS,
      value: { riders: "view" },
    });

    await user.click(screen.getByLabelText(GROUP_LABELS.customers, { exact: false }));

    expect(onChange).toHaveBeenCalledWith({ riders: "view", customers: "manage" });
  });

  it("renders a checked box for each stored group and unchecked for the rest", () => {
    renderConfig({
      groups: FRANCHISE_OPERATIONS_GROUPS,
      value: { customers: "manage", operations: "view" },
    });

    expect(
      screen.getByLabelText(GROUP_LABELS.customers, { exact: false }),
    ).toBeChecked();
    expect(
      screen.getByLabelText(GROUP_LABELS.operations, { exact: false }),
    ).toBeChecked();
    expect(
      screen.getByLabelText(GROUP_LABELS.riders, { exact: false }),
    ).not.toBeChecked();
  });

  it("disables the permission select for unchecked groups only", () => {
    renderConfig({
      groups: FRANCHISE_OPERATIONS_GROUPS,
      value: { customers: "manage" },
    });

    // One trigger per offered group, in order.
    const triggers = screen.getAllByRole("combobox");
    expect(triggers).toHaveLength(FRANCHISE_OPERATIONS_GROUPS.length);

    const customersIndex = FRANCHISE_OPERATIONS_GROUPS.indexOf("customers");
    const ridersIndex = FRANCHISE_OPERATIONS_GROUPS.indexOf("riders");

    expect(triggers[customersIndex]).not.toBeDisabled();
    expect(triggers[ridersIndex]).toBeDisabled();
  });
});
