import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function UnauthorizedPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground">
      <h1 className="text-4xl font-bold mb-4">403 - Unauthorized</h1>
      <p className="text-lg mb-8">You do not have permission to access this portal.</p>
      <Button asChild>
        <Link href="/">Go Back</Link>
      </Button>
    </div>
  );
}