import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { RiderData } from "./RiderManagement";

interface RiderActivityProps {
  riders: RiderData[];
}

export default function RiderActivity({ riders }: RiderActivityProps) {
  const totalRiders = riders.length;
  const onlineRiders = riders.filter((rider) => rider.is_online).length;
  const ridersWithActiveBatches = riders.filter(
    (rider) => rider.latestBatchStatus !== "No Batch Assigned"
  ).length;
  const totalTodayDeliveries = riders.reduce(
    (sum, rider) => sum + rider.todayTotalDeliveries,
    0
  );
  const totalTodayCompletedDeliveries = riders.reduce(
    (sum, rider) => sum + rider.todayCompletedDeliveries,
    0
  );
  const totalTodayEstimatedEarning = riders.reduce(
    (sum, rider) => sum + rider.todayEstimatedEarning,
    0
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Riders
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalRiders}</div>
            <p className="text-xs text-muted-foreground">
              {onlineRiders} currently online
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Riders with Active Batches
            </CardTitle>
            <Clipboard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {ridersWithActiveBatches}
            </div>
            <p className="text-xs text-muted-foreground">
              Out of {totalRiders} total riders
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Today's Deliveries
            </CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalTodayCompletedDeliveries} / {totalTodayDeliveries}
            </div>
            <p className="text-xs text-muted-foreground">
              Estimated Earning: ₹{totalTodayEstimatedEarning.toFixed(2)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rider Status Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {riders.length > 0 ? (
              riders.map((rider) => (
                <div
                  key={rider.id}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center space-x-4">
                    <Avatar>
                      <AvatarImage src="/placeholder-user.jpg" />
                      <AvatarFallback>
                        {rider.fullName.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{rider.fullName}</p>
                      <p className="text-sm text-muted-foreground">
                        {rider.employee_code}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge
                      variant={
                        rider.is_online ? "default" : "secondary"
                      }
                      className="mb-1"
                    >
                      {rider.is_online ? "Online" : "Offline"}
                    </Badge>
                    <p className="text-sm text-muted-foreground">
                      Batch: {rider.latestBatchStatus}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Updated: {new Date(rider.latestBatchTime).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-center text-muted-foreground">
                No riders to display today.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Dummy icons - replace with actual icon imports from a library like lucide-react
const Users = (props: any) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 7V7a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3"></path>
    <path d="M9 17v-3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3"></path>
    <path d="M16 17v-4h-2"></path>
    <path d="M8 17v-4H6"></path>
    <path d="M12 22v-5"></path>
    <path d="M2 17h2"></path>
    <path d="M20 17h2"></path>
    <path d="M12 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"></path>
    <path d="M7 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"></path>
    <path d="M17 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"></path>
  </svg>
);

const Clipboard = (props: any) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="3" width="6" height="4" rx="1" />
    <path d="M10 7V4h4v3" />
    <path d="M17 17H7V7h10v10z" />
  </svg>
);

const Package = (props: any) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  </svg>
);
