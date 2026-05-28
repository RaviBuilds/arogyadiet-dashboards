export type RoutableOrder = { id: string; lat: number; lng: number };

export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function estimateRoadDistanceKm(straightLineKm: number): number {
  return straightLineKm * 1.3;
}

export function computeHaversineRoute(
  orders: RoutableOrder[],
  kitchenLat: number,
  kitchenLng: number,
  payoutPerKm: number,
) {
  let currentLat = kitchenLat;
  let currentLng = kitchenLng;
  let totalKm = 0;

  const legs = orders.map((order, index) => {
    const straightLine = calculateHaversineDistanceKm(
      currentLat,
      currentLng,
      order.lat,
      order.lng,
    );
    const roadKm = estimateRoadDistanceKm(straightLine);
    totalKm += roadKm;

    currentLat = order.lat;
    currentLng = order.lng;

    return {
      orderId: order.id,
      routeSequence: index + 1,
      payoutAmount: Number((roadKm * payoutPerKm).toFixed(2)),
    };
  });

  return {
    totalKm: Number(totalKm.toFixed(2)),
    expectedPayout: Math.round(totalKm * payoutPerKm),
    legs,
  };
}
