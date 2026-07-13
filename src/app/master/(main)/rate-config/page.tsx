import { MasterPageHeader } from "@/shared/components/master/MasterPageHeader";
import { BackToSystem } from "@/shared/components/master/BackToSystem";
import { RateConfigCard } from "@/shared/components/master/rates/RateConfigCard";

export const revalidate = 0;

export default function RateConfigPage() {
  return (
    <div className="space-y-6">
      <MasterPageHeader
        title="Rate Configuration"
        description="Manage per-km delivery and rider payout rates for the Core Business and each franchise."
        action={<BackToSystem />}
      />
      <RateConfigCard />
    </div>
  );
}
