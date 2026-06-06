export default function InventoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <header className="sticky top-0 z-40 border-b bg-background px-6 py-4 shadow-sm">
        <h1 className="text-lg font-semibold text-primary">
          ArogyaDiet Warehouse System
        </h1>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
