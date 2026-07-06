"use client";

import { useState, useEffect } from "react";
import { PlusCircle } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { SectionCard } from "@/shared/components/franchise/ui/GlassCard";
import {
  createDisputeAction,
  fetchReceivedOrdersAction,
} from "@/actions/franchise-actions/franchiseDisputeActions";
import { DISPUTE_CATEGORIES } from "@/validations/disputeSchema";
import type { ReceivedOrderOption } from "@/types/dispute";

interface Props {
  onSuccess: () => void;
  onError: (message: string) => void;
}

function formatCategory(category: string): string {
  return category.replace(/_/g, " ");
}

export default function RaiseDisputeForm({ onSuccess, onError }: Props) {
  const [category, setCategory] = useState<string>("");
  const [description, setDescription] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [receivedOrders, setReceivedOrders] = useState<ReceivedOrderOption[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (category !== "Inventory") {
      setReceivedOrders([]);
      setSelectedOrderIds([]);
      return;
    }

    let cancelled = false;
    async function loadOrders() {
      setLoadingOrders(true);
      try {
        const result = await fetchReceivedOrdersAction();
        if (cancelled) return;
        if (result.success) {
          setReceivedOrders(result.data);
        } else {
          setReceivedOrders([]);
        }
      } catch {
        if (!cancelled) setReceivedOrders([]);
      } finally {
        if (!cancelled) setLoadingOrders(false);
      }
    }

    loadOrders();
    return () => { cancelled = true; };
  }, [category]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!category) newErrors.category = "Category is required";
    if (!description.trim()) newErrors.description = "Description is required";
    else if (description.length > 2000) newErrors.description = "Description cannot exceed 2000 characters";
    if (category === "Inventory" && selectedOrderIds.length === 0) {
      newErrors.related_order_ids = "At least one received order must be selected";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function resetForm() {
    setCategory("");
    setDescription("");
    setSelectedOrderIds([]);
    setReceivedOrders([]);
    setErrors({});
  }

  function toggleOrder(orderId: string) {
    setSelectedOrderIds((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set("category", category);
      formData.set("description", description);
      if (category === "Inventory" && selectedOrderIds.length > 0) {
        formData.set("related_order_ids", JSON.stringify(selectedOrderIds));
      }

      const result = await createDisputeAction(formData);
      if (result.success) {
        resetForm();
        onSuccess();
      } else {
        onError(result.error);
      }
    } catch {
      onError("Failed to create dispute. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SectionCard icon={PlusCircle} title="Raise a New Dispute" subtitle="Report an issue to the master admin">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Category */}
        <div className="space-y-1.5">
          <Label htmlFor="dispute-category">Category</Label>
          <Select
            value={category}
            onValueChange={(value) => {
              setCategory(value);
              setErrors((prev) => ({ ...prev, category: "" }));
            }}
          >
            <SelectTrigger id="dispute-category" className="w-full" aria-invalid={!!errors.category}>
              <SelectValue placeholder="Select a category" />
            </SelectTrigger>
            <SelectContent>
              {DISPUTE_CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>{formatCategory(cat)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.category && <p className="text-xs text-destructive">{errors.category}</p>}
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label htmlFor="dispute-description">Description</Label>
          <Textarea
            id="dispute-description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setErrors((prev) => ({ ...prev, description: "" }));
            }}
            placeholder="Describe your issue in detail..."
            maxLength={2000}
            rows={4}
            aria-invalid={!!errors.description}
            className="resize-none"
          />
          <div className="flex items-center justify-between">
            {errors.description ? (
              <p className="text-xs text-destructive">{errors.description}</p>
            ) : <span />}
            <span className="text-[11px] text-slate-400">{description.length}/2000</span>
          </div>
        </div>

        {/* Received Orders (only for Inventory) */}
        {category === "Inventory" && (
          <div className="space-y-1.5">
            <Label>Related Received Orders</Label>
            {loadingOrders ? (
              <div className="flex items-center gap-2 rounded-xl bg-slate-50/80 px-4 py-3 ring-1 ring-inset ring-slate-100">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
                <p className="text-sm text-slate-500">Loading received orders...</p>
              </div>
            ) : receivedOrders.length === 0 ? (
              <div className="rounded-xl bg-slate-50/80 px-4 py-3 ring-1 ring-inset ring-slate-100">
                <p className="text-sm text-slate-400">No received orders available in the last 72 hours</p>
              </div>
            ) : (
              <div className="rounded-xl ring-1 ring-inset ring-slate-200/80 max-h-48 overflow-y-auto divide-y divide-slate-100/80">
                {receivedOrders.map((order) => (
                  <label
                    key={order.id}
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50/60 transition-colors"
                  >
                    <Checkbox
                      checked={selectedOrderIds.includes(order.id)}
                      onCheckedChange={() => toggleOrder(order.id)}
                    />
                    <span className="text-sm text-slate-700">
                      <span className="font-medium">{order.product_name}</span>
                      <span className="text-slate-400"> · Qty: {order.quantity}</span>
                      <span className="text-slate-300"> · #{order.id.slice(0, 8)}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {errors.related_order_ids && (
              <p className="text-xs text-destructive">{errors.related_order_ids}</p>
            )}
          </div>
        )}

        {/* Submit */}
        <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
          {submitting ? "Submitting..." : "Raise Dispute"}
        </Button>
      </form>
    </SectionCard>
  );
}
