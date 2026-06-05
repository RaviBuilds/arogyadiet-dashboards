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

function findFarthestStopIndex(
  kitchenLat: number,
  kitchenLng: number,
  orders: RoutableOrder[],
): number {
  let farthestIndex = 0;
  let maxDistance = -1;

  for (let i = 0; i < orders.length; i++) {
    const distance = calculateHaversineDistanceKm(
      kitchenLat,
      kitchenLng,
      orders[i].lat,
      orders[i].lng,
    );
    if (distance > maxDistance) {
      maxDistance = distance;
      farthestIndex = i;
    }
  }

  return farthestIndex;
}

/** Open-loop fallback: nearest-neighbor intermediates, farthest stop last. */
export function computeOpenLoopHaversineRoute(
  orders: RoutableOrder[],
  kitchenLat: number,
  kitchenLng: number,
  payoutPerKm: number,
) {
  if (orders.length === 0) {
    return {
      totalKm: 0,
      expectedPayout: 0,
      legs: [] as { orderId: string; routeSequence: number; payoutAmount: number }[],
      optimizedWaypointIndex: [] as number[],
    };
  }

  if (orders.length === 1) {
    const straightLine = calculateHaversineDistanceKm(
      kitchenLat,
      kitchenLng,
      orders[0].lat,
      orders[0].lng,
    );
    const roadKm = estimateRoadDistanceKm(straightLine);
    return {
      totalKm: Number(roadKm.toFixed(2)),
      expectedPayout: Math.round(roadKm * payoutPerKm),
      legs: [
        {
          orderId: orders[0].id,
          routeSequence: 1,
          payoutAmount: Number((roadKm * payoutPerKm).toFixed(2)),
        },
      ],
      optimizedWaypointIndex: [0],
    };
  }

  const farthestIndex = findFarthestStopIndex(kitchenLat, kitchenLng, orders);
  const farthest = orders[farthestIndex];
  const remaining = orders.filter((_, i) => i !== farthestIndex);

  const ordered: RoutableOrder[] = [];
  const unvisited = [...remaining];
  let currentLat = kitchenLat;
  let currentLng = kitchenLng;

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const dist = calculateHaversineDistanceKm(
        currentLat,
        currentLng,
        unvisited[i].lat,
        unvisited[i].lng,
      );
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    const next = unvisited.splice(nearestIdx, 1)[0];
    ordered.push(next);
    currentLat = next.lat;
    currentLng = next.lng;
  }

  ordered.push(farthest);

  let totalKm = 0;
  currentLat = kitchenLat;
  currentLng = kitchenLng;

  const legs = ordered.map((order, index) => {
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

  const optimizedWaypointIndex = ordered.map((stop) =>
    orders.findIndex((o) => o.id === stop.id),
  );

  return {
    totalKm: Number(totalKm.toFixed(2)),
    expectedPayout: Math.round(totalKm * payoutPerKm),
    legs,
    optimizedWaypointIndex,
  };
}
