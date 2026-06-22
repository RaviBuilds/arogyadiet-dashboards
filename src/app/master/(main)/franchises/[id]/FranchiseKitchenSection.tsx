"use client";

import { useState, useEffect, useTransition, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { ChefHat, Loader2, MapPin, Save, CheckCircle2, Pencil } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { toast } from "sonner";
import { GoogleMap, useJsApiLoader, Marker } from "@react-google-maps/api";
import {
  saveFranchiseKitchen,
  getFranchiseKitchen,
} from "@/actions/admin-actions/franchiseKitchenActions";

interface FranchiseKitchenSectionProps {
  franchiseId: string;
  franchiseName: string;
}

const DEFAULT_CENTER = { lat: 17.385, lng: 78.4867 };

const mapContainerStyle = { width: "100%", height: "260px", borderRadius: "0.75rem" };

const mapOptions: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  gestureHandling: "greedy",
  styles: [
    { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
  ],
};

interface KitchenData {
  id: string;
  name: string;
  address_text: string | null;
  lat: number;
  lng: number;
}

export default function FranchiseKitchenSection({
  franchiseId,
  franchiseName,
}: FranchiseKitchenSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [kitchen, setKitchen] = useState<KitchenData | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const mapRef = useRef<google.maps.Map | null>(null);

  // Form state
  const [kitchenName, setKitchenName] = useState(`${franchiseName} Kitchen`);
  const [addressText, setAddressText] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [markerPosition, setMarkerPosition] = useState<google.maps.LatLngLiteral | null>(null);

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string,
  });

  useEffect(() => {
    async function load() {
      const result = await getFranchiseKitchen(franchiseId);
      if (result.success && result.kitchen) {
        setKitchen(result.kitchen);
        setKitchenName(result.kitchen.name);
        setAddressText(result.kitchen.address_text ?? "");
        setLat(String(result.kitchen.lat));
        setLng(String(result.kitchen.lng));
        setMarkerPosition({ lat: result.kitchen.lat, lng: result.kitchen.lng });
      }
      setLoading(false);
    }
    load();
  }, [franchiseId]);

  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (e.latLng) {
      const newLat = e.latLng.lat();
      const newLng = e.latLng.lng();
      setMarkerPosition({ lat: newLat, lng: newLng });
      setLat(newLat.toFixed(6));
      setLng(newLng.toFixed(6));
    }
  }, []);

  const handleLatLngApply = () => {
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
      setMarkerPosition({ lat: parsedLat, lng: parsedLng });
      if (mapRef.current) {
        mapRef.current.panTo({ lat: parsedLat, lng: parsedLng });
        mapRef.current.setZoom(15);
      }
    }
  };

  const onMapLoad = useCallback((map: google.maps.Map) => { mapRef.current = map; }, []);

  const handleSave = () => {
    if (!kitchenName.trim()) { toast.error("Kitchen name is required"); return; }
    if (!addressText.trim()) { toast.error("Address is required"); return; }
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
      toast.error("Pin a location on the map or enter lat/lng."); return;
    }

    startTransition(async () => {
      const result = await saveFranchiseKitchen({
        franchiseId, name: kitchenName.trim(), addressText: addressText.trim(), lat: parsedLat, lng: parsedLng,
      });
      if (result.success) {
        toast.success("Kitchen location saved");
        setKitchen({ id: result.kitchenId, name: kitchenName.trim(), address_text: addressText.trim(), lat: parsedLat, lng: parsedLng });
        setIsEditOpen(false);
        router.refresh();
      } else { toast.error(result.error); }
    });
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-100 bg-gradient-to-r from-orange-50/80 to-amber-50/60 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100">
              <ChefHat className="h-4 w-4 text-orange-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Franchise Kitchen</h3>
              <p className="text-[11px] text-slate-500">
                {kitchen ? "Pickup point for deliveries" : "Required before activation"}
              </p>
            </div>
          </div>
          {kitchen && (
            <div className="flex items-center gap-1.5 text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="text-[11px] font-medium">Configured</span>
            </div>
          )}
          {!kitchen && (
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 h-8 bg-orange-600 hover:bg-orange-700 shadow-sm">
                  <MapPin className="h-3.5 w-3.5" /> Set Up Kitchen
                </Button>
              </DialogTrigger>
              <KitchenEditDialog
                isLoaded={isLoaded}
                kitchenName={kitchenName}
                setKitchenName={setKitchenName}
                addressText={addressText}
                setAddressText={setAddressText}
                lat={lat}
                setLat={setLat}
                lng={lng}
                setLng={setLng}
                markerPosition={markerPosition}
                handleMapClick={handleMapClick}
                handleLatLngApply={handleLatLngApply}
                onMapLoad={onMapLoad}
                handleSave={handleSave}
                isPending={isPending}
                isNew={true}
              />
            </Dialog>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {kitchen ? (
          <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200/80 px-5 py-4">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-100 text-orange-700">
                <ChefHat className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{kitchen.name}</p>
                <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {kitchen.address_text || `${kitchen.lat.toFixed(4)}, ${kitchen.lng.toFixed(4)}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-semibold">
                Active
              </Badge>
              <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-slate-200/80">
                    <Pencil className="h-3.5 w-3.5 text-slate-500" />
                  </Button>
                </DialogTrigger>
                <KitchenEditDialog
                  isLoaded={isLoaded}
                  kitchenName={kitchenName}
                  setKitchenName={setKitchenName}
                  addressText={addressText}
                  setAddressText={setAddressText}
                  lat={lat}
                  setLat={setLat}
                  lng={lng}
                  setLng={setLng}
                  markerPosition={markerPosition}
                  handleMapClick={handleMapClick}
                  handleLatLngApply={handleLatLngApply}
                  onMapLoad={onMapLoad}
                  handleSave={handleSave}
                  isPending={isPending}
                  isNew={false}
                />
              </Dialog>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
            <ChefHat className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500 font-medium">No kitchen configured</p>
            <p className="text-xs text-slate-400 mt-0.5">Set up the kitchen location to enable franchise activation.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Kitchen Edit Dialog Content ──────────────────────────────────────────

function KitchenEditDialog({
  isLoaded,
  kitchenName, setKitchenName,
  addressText, setAddressText,
  lat, setLat,
  lng, setLng,
  markerPosition,
  handleMapClick,
  handleLatLngApply,
  onMapLoad,
  handleSave,
  isPending,
  isNew,
}: {
  isLoaded: boolean;
  kitchenName: string; setKitchenName: (v: string) => void;
  addressText: string; setAddressText: (v: string) => void;
  lat: string; setLat: (v: string) => void;
  lng: string; setLng: (v: string) => void;
  markerPosition: google.maps.LatLngLiteral | null;
  handleMapClick: (e: google.maps.MapMouseEvent) => void;
  handleLatLngApply: () => void;
  onMapLoad: (map: google.maps.Map) => void;
  handleSave: () => void;
  isPending: boolean;
  isNew: boolean;
}) {
  return (
    <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{isNew ? "Set Up Kitchen" : "Edit Kitchen Location"}</DialogTitle>
        <DialogDescription>
          {isNew
            ? "Enter the kitchen address and pin location on the map."
            : "Update the kitchen name, address, or pin location."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 pt-3">
        {/* Name & Address */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-slate-600">Kitchen Name</label>
            <Input value={kitchenName} onChange={(e) => setKitchenName(e.target.value)} placeholder="e.g. Kolhapur Kitchen" className="mt-1 h-9" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Full Address</label>
            <Input value={addressText} onChange={(e) => setAddressText(e.target.value)} placeholder="Shop No. 5, Mahadwar Rd" className="mt-1 h-9" />
          </div>
        </div>

        {/* Map */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
              <MapPin className="h-3 w-3" /> Pin Location
            </label>
            <span className="text-[10px] text-slate-400">Click map to drop pin</span>
          </div>
          {isLoaded ? (
            <div className="rounded-xl overflow-hidden border border-slate-200">
              <GoogleMap
                mapContainerStyle={mapContainerStyle}
                center={markerPosition || DEFAULT_CENTER}
                zoom={markerPosition ? 15 : 10}
                options={mapOptions}
                onClick={handleMapClick}
                onLoad={onMapLoad}
              >
                {markerPosition && <Marker position={markerPosition} />}
              </GoogleMap>
            </div>
          ) : (
            <div className="h-[260px] rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
            </div>
          )}
        </div>

        {/* Lat/Lng */}
        <div className="rounded-lg bg-slate-50 border border-slate-200/80 p-3">
          <p className="text-[10px] font-medium text-slate-400 mb-2">Manual Coordinates</p>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-slate-400">Latitude</label>
              <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="16.7050" className="mt-0.5 h-8 font-mono text-xs" />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-slate-400">Longitude</label>
              <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="74.2433" className="mt-0.5 h-8 font-mono text-xs" />
            </div>
            <Button variant="outline" size="sm" onClick={handleLatLngApply} className="h-8 px-3 text-xs">
              Apply
            </Button>
          </div>
        </div>

        {/* Save */}
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={handleSave} disabled={isPending} className="gap-1.5 bg-orange-600 hover:bg-orange-700">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {isNew ? "Save Kitchen" : "Update Kitchen"}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
