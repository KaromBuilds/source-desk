"use client";
import { useEffect, useRef } from "react";
import type { Map as LMap, CircleMarker } from "leaflet";
import type { Sector, SectorId } from "@/lib/types";

export type SectorStatus = "ok" | "candidate" | "confirmed";
const COLOR: Record<SectorStatus, string> = { ok: "#2f855a", candidate: "#d69e2e", confirmed: "#c53030" };

/** Sector-level map only. No household locations, ever (Condition 5). */
export default function SectorMap({ sectors, status }: { sectors: Sector[]; status: Record<SectorId, SectorStatus> }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const dots = useRef<Partial<Record<SectorId, CircleMarker>>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current || map.current) return;
      const m = L.map(el.current, { scrollWheelZoom: false, attributionControl: true }).setView([19.355, -99.0655], 14);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap contributors" }).addTo(m);
      for (const s of sectors) {
        dots.current[s.id] = L.circleMarker([s.lat, s.lng], { radius: 26, weight: 2, color: "#fff", fillColor: COLOR.ok, fillOpacity: 0.8 })
          .bindTooltip(`${s.name} · ${s.households} pilot households (count only)`, { permanent: false })
          .addTo(m);
        L.marker([s.lat, s.lng], { icon: L.divIcon({ className: "", html: `<div style="color:#fff;font-weight:700;font-size:13px;transform:translate(-8px,-9px)">${s.id}</div>` }), interactive: false }).addTo(m);
      }
      map.current = m;
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      dots.current = {};
    };
  }, [sectors]);

  useEffect(() => {
    for (const id of Object.keys(status) as SectorId[]) dots.current[id]?.setStyle({ fillColor: COLOR[status[id]] });
  });

  return <div ref={el} className="map" aria-label="Map of pilot sectors" />;
}
