'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import dynamic from 'next/dynamic';

const StoreMap = dynamic(() => import('./components/StoreMap'), { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center bg-slate-950 text-emerald-500 font-bold animate-pulse">Loading Map...</div> });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PH_CATEGORIES = [
  "ALL", "RICE & SUGAR", "CANNED GOODS", "NOODLES & PASTA", "CONDIMENTS & SAUCES", 
  "MEAT & SEAFOOD", "FRESH PRODUCE", "DAIRY & CHILLED", "BEVERAGES", 
  "SNACKS & BISCUITS", "PERSONAL CARE", "HOUSEHOLD & CLEANING", "OTHERS"
];

interface FeedItem { id: string; product_name: string; price: number; category: string; store_name: string; latitude: number; longitude: number; image_url: string; created_at: string; }
interface StoreGroup { name: string; lat: number; lng: number; products: FeedItem[]; }

export default function MapHome() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [selectedStore, setSelectedStore] = useState<StoreGroup | null>(null);

  // Local filters for the bottom sheet
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("ALL");

  useEffect(() => {
    const fetchFeed = async () => {
      const { data } = await supabase.from('supermarket_items').select('*').not('latitude', 'is', null).order('created_at', { ascending: false });
      if (data) setFeed(data as FeedItem[]);
    };
    fetchFeed();
  }, []);

  const stores = useMemo(() => {
    const groups: Record<string, StoreGroup> = {};
    feed.forEach(item => {
      const key = `${item.store_name}_${item.latitude}_${item.longitude}`;
      if (!groups[key]) groups[key] = { name: item.store_name, lat: item.latitude, lng: item.longitude, products: [] };
      groups[key].products.push(item);
    });
    return Object.values(groups);
  }, [feed]);

  // Reset filters when a new store is selected
  useEffect(() => {
    setSearchQuery("");
    setActiveCategory("ALL");
  }, [selectedStore]);

  // Filter the selected store's products
  const filteredProducts = selectedStore?.products.filter(p => {
    const matchesSearch = p.product_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === "ALL" || p.category === activeCategory;
    return matchesSearch && matchesCategory;
  }) || [];

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(price);
  };

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-slate-950 text-white overflow-hidden relative">
      
      {/* FLOATING NAVBAR */}
      <nav className="absolute top-0 left-0 w-full p-4 z-[1000] pointer-events-none">
        <div className="bg-slate-950/80 backdrop-blur-xl border border-slate-800 rounded-2xl flex justify-between items-center px-5 py-3 shadow-2xl pointer-events-auto">
          <h1 className="text-emerald-400 font-black tracking-tight text-xl shadow-black drop-shadow-md">
            Price<span className="text-white">Scan</span>
          </h1>
          <Link href="/add" className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-4 py-2 rounded-xl text-xs font-bold transition shadow-lg active:scale-95">
            + Scan Item
          </Link>
        </div>
      </nav>

      {/* THE MAP */}
      <div className="flex-1 w-full h-full">
        <StoreMap stores={stores} onSelectStore={setSelectedStore} />
      </div>

      {/* DIMMED BACKDROP */}
      <div 
        className={`absolute inset-0 bg-slate-950/50 backdrop-blur-[2px] z-[990] transition-opacity duration-300 ${selectedStore ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setSelectedStore(null)}
      />

      {/* MOBILE BOTTOM SHEET (Taller to fit the grid and filters) */}
      <div 
        className={`absolute bottom-0 left-0 w-full bg-slate-900 rounded-t-[2.5rem] shadow-[0_-20px_60px_rgba(0,0,0,0.6)] z-[1000] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] flex flex-col ${selectedStore ? 'translate-y-0' : 'translate-y-full'}`} 
        style={{ height: '85dvh' }} 
      >
        
        {/* Drag Handle */}
        <div className="w-full flex justify-center pt-4 pb-2 shrink-0 cursor-pointer" onClick={() => setSelectedStore(null)}>
          <div className="w-12 h-1.5 bg-slate-700 rounded-full"></div>
        </div>

        {/* Header (Store Name) */}
        <div className="px-6 pb-4 border-b border-slate-800 flex justify-between items-start shrink-0">
          <div className="flex-1 pr-4">
            <h2 className="text-2xl font-black text-white tracking-tight leading-tight">{selectedStore?.name}</h2>
            <p className="text-xs text-emerald-400 font-bold uppercase tracking-wider mt-1">{selectedStore?.products?.length} items recorded</p>
          </div>
          <button onClick={() => setSelectedStore(null)} className="w-8 h-8 bg-slate-800 rounded-full shrink-0 flex items-center justify-center text-slate-400 hover:text-white font-bold transition active:scale-95">
            ✕
          </button>
        </div>

        {/* Filters (Search & Category) */}
        <div className="px-5 py-4 border-b border-slate-800 shrink-0 space-y-3 bg-slate-900/50">
          {/* Search Bar */}
          <div className="relative">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-slate-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
            <input 
              type="text" 
              placeholder="Search items here..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
            />
          </div>

          {/* Category Scroller */}
          <div className="flex overflow-x-auto hide-scrollbar gap-2 pb-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            {PH_CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-[10px] uppercase font-black transition-all tracking-wider ${
                  activeCategory === cat 
                    ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20" 
                    : "bg-slate-950 text-slate-400 border border-slate-800 hover:text-white"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Product Grid */}
        <div className="p-5 overflow-y-auto flex-1 overscroll-contain pb-20">
          {filteredProducts.length === 0 ? (
            <div className="text-center pt-10 text-slate-500">
              <p className="font-bold text-lg text-slate-400">No items found</p>
              <p className="text-sm mt-1">Try adjusting your filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {filteredProducts.map(product => (
                <div key={product.id} className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden flex flex-col shadow-sm">
                  
                  {/* Image Square */}
                  <div className="w-full aspect-square bg-slate-800 relative">
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.product_name} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-600">
                        <span className="text-3xl opacity-50">🛒</span>
                      </div>
                    )}
                    {/* Tiny Category Badge */}
                    {product.category && (
                      <div className="absolute top-1.5 left-1.5 bg-slate-950/80 backdrop-blur-sm text-[8px] font-black text-white px-1.5 py-0.5 rounded uppercase tracking-widest">
                        {product.category}
                      </div>
                    )}
                  </div>

                  {/* Details */}
                  <div className="p-3 flex flex-col flex-1">
                    <h3 className="font-bold text-xs text-white leading-tight line-clamp-2 mb-1">
                      {product.product_name}
                    </h3>
                    <div className="mt-auto pt-2">
                      <p className="text-sm font-black text-emerald-400">
                        {formatPrice(product.price)}
                      </p>
                      <p className="text-[9px] text-slate-500 mt-0.5 font-mono">
                        {new Date(product.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}