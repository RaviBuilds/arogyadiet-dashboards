import { Card, CardContent } from "@/shared/components/ui/card";

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Greeting skeleton */}
      <div className="pt-4 pb-2">
        <div className="h-8 w-48 bg-zinc-200 rounded animate-pulse" />
        <div className="h-5 w-32 bg-zinc-100 rounded animate-pulse mt-2" />
      </div>

      {/* Status toggle skeleton */}
      <div className="h-14 w-full bg-zinc-100 rounded-2xl animate-pulse" />

      {/* Stats cards skeleton */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-none shadow-sm bg-white rounded-2xl">
          <CardContent className="flex flex-col items-center justify-center p-4">
            <div className="h-12 w-12 bg-zinc-100 rounded-full animate-pulse mb-3" />
            <div className="h-7 w-10 bg-zinc-200 rounded animate-pulse" />
            <div className="h-4 w-20 bg-zinc-100 rounded animate-pulse mt-2" />
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm bg-white rounded-2xl">
          <CardContent className="flex flex-col items-center justify-center p-4">
            <div className="h-12 w-12 bg-zinc-100 rounded-full animate-pulse mb-3" />
            <div className="h-7 w-16 bg-zinc-200 rounded animate-pulse" />
            <div className="h-4 w-20 bg-zinc-100 rounded animate-pulse mt-2" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
