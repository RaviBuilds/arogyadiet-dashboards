import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import type { KitProductWithCalculations } from "@/types/kitProduct";

interface KitProductCardProps {
  product: KitProductWithCalculations;
}

/**
 * KIT Product Card Component
 * 
 * Displays a single KIT product with:
 * - Product name
 * - Base price (formatted as currency)
 * - Tax amount (5%)
 * - Total price
 * - Active badge
 * 
 * Requirements: 1.2, 1.5
 * Task: 4.2
 */
export function KitProductCard({ product }: KitProductCardProps) {
  return (
    <Card
      className="flex flex-col overflow-hidden border-border/70 shadow-sm transition-shadow hover:shadow-md"
    >
      <CardHeader className="pb-4">
        <CardTitle className="text-xl font-bold text-foreground">
          {product.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {/* Base Price */}
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Base Price:</span>
          <span className="text-lg font-semibold text-foreground">
            ₹{product.base_price.toLocaleString("en-IN")}
          </span>
        </div>

        {/* Tax Amount (5%) */}
        <div className="flex items-baseline justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground">
            Tax (5%):
          </span>
          <span className="text-sm font-medium text-muted-foreground">
            ₹{product.tax_amount.toLocaleString("en-IN")}
          </span>
        </div>

        {/* Total Price */}
        <div className="flex items-baseline justify-between border-t pt-3">
          <span className="text-sm font-semibold text-foreground">
            Total Price:
          </span>
          <span className="text-2xl font-bold text-primary">
            ₹{product.total_price.toLocaleString("en-IN")}
          </span>
        </div>

        {/* Active Badge */}
        <div className="mt-2 pt-3 border-t">
          <Badge className="border-0 bg-green-100 text-green-800 hover:bg-green-100">
            Active
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
