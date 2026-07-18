import { Home } from "lucide-react";

/**
 * DeliveryAddressCard — premium version of the plain "Delivering To" card.
 * Same fields as before (tag/label, customer name, address string) — no new
 * data, just better presentation.
 */
export function DeliveryAddressCard({
  addressTag,
  customerName,
  addressString,
}: {
  addressTag: string | null;
  customerName: string | null;
  addressString: string;
}) {
  return (
    <div className="reveal-rise rounded-3xl border border-slate-100 bg-slate-50/70 p-5 sm:p-6">
      <div className="flex gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-100">
          <Home className="h-5 w-5 text-emerald-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {addressTag ? `Delivery · ${addressTag}` : "Delivery Address"}
            </p>
          </div>
          {customerName ? (
            <p className="mt-1 text-sm font-bold text-slate-900">{customerName}</p>
          ) : null}
          <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-slate-600">
            {addressString || "Delivery address"}
          </p>
          <p className="mt-2 text-xs font-medium text-emerald-600">
            Delivering today&apos;s breakfast
          </p>
        </div>
      </div>
    </div>
  );
}
