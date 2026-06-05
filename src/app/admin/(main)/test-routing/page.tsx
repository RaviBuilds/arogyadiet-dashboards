import TestRoutingClient from "./TestRoutingClient";

export default function TestRoutingPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Internal Sandbox
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          Routing Sandbox
        </h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          Inspect the latest automated routing assignment. Select a rider to
          review delivery sequence and map path quality from production dispatch
          data.
        </p>
      </div>

      <TestRoutingClient />
    </div>
  );
}
