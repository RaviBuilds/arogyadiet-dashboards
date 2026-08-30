"use client";

// src/shared/components/master/OperationsGroupConfig.tsx
//
// Per-group operations access editor, shown only when the selected Access Level
// is `operations`. Each offered group can be selected and set to Manage
// (default) or View (read-only).
//
// EXTRACTED (franchise-scoped-access Task 8) from `UserManagement.tsx`, where it
// was a module-private component, so the Franchise Users panel can reuse the
// exact same control instead of growing a second copy that could drift. The
// `groups` prop is what lets one component serve both:
//
//   * Core admin users   -> OPERATIONS_GROUPS            (all six)
//   * Clinic-scoped admin -> CLINIC_SCOPED_GROUPS        (four)
//   * Franchise users    -> FRANCHISE_OPERATIONS_GROUPS  (five; no `franchises`)
//
// Behaviour is preserved verbatim from the pre-extraction version: checking a
// group defaults it to `manage`, and the permission Select stays disabled until
// the group is checked.

import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  OPERATIONS_GROUPS,
  GROUP_LABELS,
  type OperationsAccess,
  type OperationsGroup,
  type PermissionLevel,
} from "@/lib/auth/adminAccessCore";

export function OperationsGroupConfig({
  value,
  onChange,
  idPrefix,
  groups = OPERATIONS_GROUPS,
}: {
  value: OperationsAccess;
  onChange: (next: OperationsAccess) => void;
  /** Namespaces the checkbox ids so two instances can coexist in one page. */
  idPrefix: string;
  /**
   * The groups this caller may grant. Defaults to the full admin set so every
   * pre-existing call site is unchanged.
   */
  groups?: readonly OperationsGroup[];
}) {
  const toggle = (group: OperationsGroup, checked: boolean) => {
    const next: OperationsAccess = { ...value };
    if (checked) next[group] = next[group] ?? "manage";
    else delete next[group];
    onChange(next);
  };
  const setPermission = (group: OperationsGroup, perm: PermissionLevel) => {
    onChange({ ...value, [group]: perm });
  };

  return (
    <div className="space-y-2.5 rounded-md border p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Operations access — select groups and set each to Manage or View
      </p>
      {groups.map((group) => {
        const selected = value[group] !== undefined;
        return (
          <div key={group} className="flex items-center justify-between gap-3">
            <label
              htmlFor={`${idPrefix}-${group}`}
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id={`${idPrefix}-${group}`}
                checked={selected}
                onCheckedChange={(c) => toggle(group, c === true)}
              />
              {GROUP_LABELS[group]}
            </label>
            <Select
              value={selected ? value[group] : undefined}
              onValueChange={(v) => setPermission(group, v as PermissionLevel)}
              disabled={!selected}
            >
              <SelectTrigger className="h-8 w-28">
                <SelectValue placeholder="Manage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manage">Manage</SelectItem>
                <SelectItem value="view">View</SelectItem>
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}

export default OperationsGroupConfig;
