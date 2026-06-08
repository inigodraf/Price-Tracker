'use client';

import { MapContainer, TileLayer, Marker, ZoomControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';

// Create a custom, highly visible marker using Tailwind CSS directly
const createCustomIcon = (itemCount: number) => {
  return L.divIcon({
    className: 'bg-transparent', // Removes default leaflet square background
    html: `
      <div class="relative flex items-center justify-center w-12 h-12 -mt-6">
        <div class="absolute w-full h-full bg-emerald-500 rounded-full animate-ping opacity-40"></div>
        
        <div class="relative flex items-center justify-center w-8 h-8 bg-emerald-500 border-[3px] border-white rounded-full shadow-xl z-10">
          <span class="text-white text-xs font-black">${itemCount}</span>
        </div>
        
        <div class="absolute bottom-1 w-3 h-3 bg-emerald-500 rotate-45 border-r-[3px] border-b-[3px] border-white shadow-sm z-0"></div>
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 48], // Ensures the tip of the triangle points exactly at the GPS coordinate
  });
};

export default function StoreMap({ stores, onSelectStore }: { stores: any[], onSelectStore: (store: any) => void }) {
  useEffect(() => {
    // Force Leaflet to calculate mobile screen size correctly
    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
  }, []);

  return (
    <MapContainer 
      center={[14.4793, 121.0198]} // Metro Manila / Parañaque
      zoom={13} 
      className="w-full h-full z-0"
      zoomControl={false}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        attribution='&copy; OpenStreetMap &copy; CARTO'
      />
      <ZoomControl position="topright" />
      
      {stores.map((store, idx) => (
        <Marker 
          key={idx} 
          position={[store.lat, store.lng]} 
          icon={createCustomIcon(store.products.length)}
          eventHandlers={{ click: () => onSelectStore(store) }}
        />
      ))}
    </MapContainer>
  );
}