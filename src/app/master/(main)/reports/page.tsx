import ReportEngineShell from "./ReportEngineShell";

export const revalidate = 0;

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Report Engine
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Generate chronological trend reports across all business segments. True WoW and MoM arrays.
        </p>
      </div>
      <ReportEngineShell />
    </div>
  );
}
