import { getUserAddresses } from "@/services/addressService";
import { AddressList } from "@/shared/components/customer/address-list";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/shared/components/ui/button";

export default async function CustomerProfilePage() {
  // Fetch data securely on the server
  const addresses = await getUserAddresses();

  return (
    <div className="flex flex-col gap-8 p-6 md:p-10 max-w-6xl mx-auto w-full">
      {/* Profile Section (Task 1 Placeholder) */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Personal Details</h2>
        <p className="text-muted-foreground">
          Manage your profile information and dietary preferences.
        </p>
        {/* <ProfileForm /> will go here later */}
      </div>

      <Separator />

      {/* Address Section (Task 2) */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              Delivery Addresses
            </h2>
            <p className="text-muted-foreground">
              Manage where you want your daily diet meals delivered.
            </p>
          </div>

          {/* Top level add button - only shows if they already have addresses */}
          {addresses.length > 0 && (
            <Button variant="default">Add Address</Button>
          )}
        </div>

        <AddressList addresses={addresses} />
      </div>
    </div>
  );
}
