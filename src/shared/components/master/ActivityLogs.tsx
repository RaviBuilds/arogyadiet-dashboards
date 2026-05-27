"use client";

import { useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import type { AdminActivityLogRow } from "@/actions/master-actions/logActions";
import { DataTableCard } from "@/shared/components/admin/core/DataTableCard";
import { DataSearchFilter } from "@/shared/components/admin/core/DataSearchFilter";
import { SectionHeader } from "@/shared/components/admin/core/SectionHeader";
import { StatusBadge } from "@/shared/components/admin/core/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { Badge } from "@/shared/components/ui/badge";

interface ActivityLogsProps {
  initialLogs: AdminActivityLogRow[];
}

const SEARCH_OPTIONS = [
  { value: "admin_name", label: "Admin" },
  { value: "entity_type", label: "Entity" },
  { value: "entity_id", label: "Entity ID" },
];

const ACTION_TABS = ["ALL", "CREATE", "UPDATE", "DELETE"] as const;

function formatEntityType(value: string) {
  return value.replace(/_/g, " ");
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDetails(details: Record<string, unknown> | null) {
  if (!details || Object.keys(details).length === 0) return "—";
  const summary = Object.entries(details)
    .slice(0, 3)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`)
    .join(" · ");
  return summary.length > 120 ? `${summary.slice(0, 117)}...` : summary;
}

function actionBadgeVariant(action: string) {
  if (action === "CREATE") return "bg-emerald-500/10 text-emerald-700 border-emerald-200";
  if (action === "DELETE") return "bg-destructive/10 text-destructive border-destructive/20";
  if (action === "UPDATE") return "bg-blue-500/10 text-blue-700 border-blue-200";
  return "bg-muted text-muted-foreground";
}

export default function ActivityLogs({ initialLogs }: ActivityLogsProps) {
  const [logs] = useState<AdminActivityLogRow[]>(initialLogs);
  const [actionFilter, setActionFilter] =
    useState<(typeof ACTION_TABS)[number]>("ALL");
  const [searchColumn, setSearchColumn] = useState("admin_name");
  const [searchTerm, setSearchTerm] = useState("");

  const counts = useMemo(() => {
    const c = { ALL: logs.length, CREATE: 0, UPDATE: 0, DELETE: 0 };
    for (const log of logs) {
      if (log.action_type === "CREATE") c.CREATE++;
      else if (log.action_type === "UPDATE") c.UPDATE++;
      else if (log.action_type === "DELETE") c.DELETE++;
    }
    return c;
  }, [logs]);

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      if (actionFilter !== "ALL" && log.action_type !== actionFilter) {
        return false;
      }
      if (!searchTerm) return true;
      const val = String(
        log[searchColumn as keyof AdminActivityLogRow] ?? "",
      ).toLowerCase();
      return val.includes(searchTerm.toLowerCase());
    });
  }, [logs, actionFilter, searchColumn, searchTerm]);

  return (
    <DataTableCard
      header={
        <SectionHeader
          title={`Activity Logs (${filtered.length})`}
          icon={ScrollText}
        />
      }
      controls={
        <div className="flex flex-col gap-4 w-full">
          <Tabs
            value={actionFilter}
            onValueChange={(v) =>
              setActionFilter(v as (typeof ACTION_TABS)[number])
            }
          >
            <TabsList className="flex flex-wrap h-auto gap-1">
              {ACTION_TABS.map((tab) => (
                <TabsTrigger key={tab} value={tab} className="gap-2">
                  {tab === "ALL" ? "All" : tab}
                  <Badge variant="secondary" className="text-xs px-1.5">
                    {counts[tab]}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <DataSearchFilter
            searchColumn={searchColumn}
            onColumnChange={setSearchColumn}
            searchTerm={searchTerm}
            onTermChange={setSearchTerm}
            options={SEARCH_OPTIONS}
          />
        </div>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Admin</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Entity ID</TableHead>
            <TableHead>Details</TableHead>
            <TableHead>When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                No activity logs found.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="font-medium">{log.admin_name}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`font-semibold ${actionBadgeVariant(log.action_type)}`}
                  >
                    {log.action_type}
                  </Badge>
                </TableCell>
                <TableCell>
                  <StatusBadge status={formatEntityType(log.entity_type)} />
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground max-w-[140px] truncate">
                  {log.entity_id || "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[280px] truncate">
                  {formatDetails(log.details)}
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {formatDate(log.created_at)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </DataTableCard>
  );
}
