'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Client
// Replace these with your actual keys from your Supabase Dashboard (Project Settings > API)
const SUPABASE_URL = "https://your-project-id.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-key";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function SupermarketScanner() {
  // Application states: 'scanning' | 'teaching' | 'success'
  const [appState, setAppState] = useState<'scanning' | 'teaching' | 'success'>('scanning');
  const [loading, setLoading] = useState(false);
  
  // Form States
  const [productName, setProductName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('Grocery');
  const [location, setLocation] = useState('Aisle 4 - Packaged Foods'); // Mocked auto-detected location

  // Handle Database Submission
  const handleSaveToDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName || !price) {
      alert("Please fill in all fields");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase
        .from('supermarket_items')
        .insert([
          { 
            product_name: productName, 
            price: parseFloat(price), 
            category, 
            location,
            image_url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=600&auto=format&fit=crop' // Mocked image
          },
        ]);

      if (error) throw error;

      setAppState('success');
      // Reset form fields
      setProductName('');
      setPrice('');
    } catch (error: any) {
      alert(`Error saving item: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex justify-center items-center min-h-screen p-4">
      {/* Mobile Container Mockup */}
      <div className="w-full max-w-md h-[844px] bg-slate-900 rounded-[40px] shadow-2xl border-8 border-slate-800 relative overflow-hidden flex flex-col justify-between">
        
        {/* Status Bar */}
        <div className="absolute top-0 inset-x-0 h-12 bg-gradient-to-b from-black/50 to-transparent z-30 flex justify-between items-center px-8 text-xs font-semibold tracking-wider">
          <span>14:22</span>
          <div className="flex items-center gap-1.5">
            <i className="fas fa-signal"></i>
            <i className="fas fa-wifi"></i>
            <i className="fas fa-battery-full text-lg"></i>
          </div>
        </div>

        {/* Dynamic Image / Camera Viewport */}
        <div 
          className="relative w-full h-[45%] bg-cover bg-center transition-all duration-500" 
          style={{ backgroundImage: `url('https://images.unsplash.com/photo-1542838132-92c53300491e?q=80&w=600&auto=format&fit=crop')` }}
        >
          <div className="absolute inset-0 bg-black/40"></div>

          {/* Top Actions Context Tags */}
          <div className="absolute top-14 inset-x-0 flex justify-between px-6 z-20">
            <button onClick={() => setAppState('scanning')} className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10 text-white">
              <i className="fas fa-arrow-left"></i>
            </button>
            {appState === 'scanning' ? (
              <div className="bg-cyan-500/20 backdrop-blur-md px-4 py-1.5 rounded-full border border-cyan-500/50 flex items-center gap-2 text-xs font-medium text-cyan-400">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span> Scanning Inventory
              </div>
            ) : (
              <div className="bg-amber-500/20 backdrop-blur-md px-4 py-1.5 rounded-full border border-amber-500/50 flex items-center gap-2 text-xs font-medium text-amber-400">
                <i className="fas fa-triangle-exclamation"></i> Unrecognized Item
              </div>
            )}
          </div>

          {/* Reticle / Target Scanner View Overlay */}
          {appState === 'scanning' && (
            <div className="absolute inset-0 flex items-center justify-center mt-8">
              <div className="w-44 h-44 border-2 border-dashed border-cyan-400/60 rounded-3xl relative animate-pulse">
                <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-cyan-400 rounded-tl-lg"></div>
                <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-cyan-400 rounded-tr-lg"></div>
                <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-cyan-400 rounded-bl-lg"></div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-cyan-400 rounded-br-lg"></div>
              </div>
            </div>
          )}
        </div>

        {/* Interactive Dynamic Bottom Sheet Content */}
        <div className="w-full h-[60%] bg-slate-900 border-t border-white/10 rounded-t-[32px] -mt-6 z-10 px-6 pt-4 pb-8 flex flex-col shadow-[0_-10px_30px_rgba(0,0,0,0.5)] overflow-y-auto">
          <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto mb-5 shrink-0"></div>

          {/* STATE 1: SCANNING MODE VIEW */}
          {appState === 'scanning' && (
            <div className="flex flex-col justify-between h-full">
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-cyan-500/10 text-cyan-400 rounded-full flex items-center justify-center text-2xl mx-auto mb-4 animate-bounce">
                  <i className="fas fa-barcode"></i>
                </div>
                <h3 className="text-lg font-bold text-white">Point camera at item</h3>
                <p className="text-xs text-slate-400 max-w-xs mx-auto mt-2">
                  The system automatically identifies supermarket products, registers current store prices, and logs floor location layouts.
                </p>
              </div>
              <button 
                onClick={() => setAppState('teaching')}
                className="w-full py-4 bg-slate-800 hover:bg-slate-750 transition rounded-xl font-semibold text-sm flex items-center justify-center gap-2 border border-white/5"
              >
                <i className="fas fa-plus"></i> Simulate Missing Product
              </button>
            </div>
          )}

          {/* STATE 2: TEACHING / ADDING TO SUPABASE FORM */}
          {appState === 'teaching' && (
            <form onSubmit={handleSaveToDatabase} className="flex flex-col flex-1 justify-between">
              <div>
                <div className="mb-4">
                  <h2 className="text-lg font-bold text-white">Teach Supermarket Database</h2>
                  <p className="text-xs text-slate-400 mt-0.5">This item is missing. Enter details to index it.</p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1 ml-0.5">Product / Item Name</label>
                    <input 
                      type="text" 
                      required
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      placeholder="e.g., Organic Whole Milk 1L" 
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-400 transition"
                    />
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1 ml-0.5">Supermarket Price</label>
                      <div className="relative">
                        <span className="absolute left-4 top-3 text-slate-500 text-sm">$</span>
                        <input 
                          type="number" 
                          step="0.01"
                          required
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          placeholder="0.00" 
                          className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl pl-8 pr-4 py-3 text-sm focus:outline-none focus:border-cyan-400 transition"
                        />
                      </div>
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1 ml-0.5">Department</label>
                      <select 
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-cyan-400 transition appearance-none"
                      >
                        <option value="Grocery">Grocery</option>
                        <option value="Dairy & Eggs">Dairy & Eggs</option>
                        <option value="Produce">Produce</option>
                        <option value="Meat & Seafood">Meat & Seafood</option>
                        <option value="Bakery">Bakery</option>
                      </select>
                    </div>
                  </div>

                  <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3 flex items-center gap-3">
                    <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center text-emerald-400 shrink-0">
                      <i className="fas fa-map-location-dot text-sm"></i>
                    </div>
                    <div className="truncate">
                      <p className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Auto-Sensed GPS Shelf Location</p>
                      <input 
                        type="text" 
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        className="bg-transparent font-semibold text-xs text-slate-300 w-full focus:outline-none focus:border-b border-slate-600"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <button 
                type="submit" 
                disabled={loading}
                className="w-full mt-5 py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:opacity-90 active:scale-[0.98] transition rounded-xl font-semibold text-sm flex items-center justify-center gap-2 text-white shadow-lg shadow-cyan-500/20 disabled:opacity-50"
              >
                {loading ? (
                  <>Writing to Database...</>
                ) : (
                  <>
                    <i className="fas fa-brain"></i> Save & Train Machine Learning
                  </>
                )}
              </button>
            </form>
          )}

          {/* STATE 3: SUCCESS MUTATION BANNER */}
          {appState === 'success' && (
            <div className="flex flex-col justify-between h-full text-center py-8">
              <div>
                <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center text-2xl mx-auto mb-4">
                  <i className="fas fa-circle-check"></i>
                </div>
                <h3 className="text-xl font-bold text-white">Database Synchronized!</h3>
                <p className="text-xs text-slate-400 max-w-xs mx-auto mt-2">
                  The item has been committed to Supabase. Future algorithmic image passes will instantly resolve this item.
                </p>
              </div>
              <button 
                onClick={() => setAppState('scanning')}
                className="w-full py-4 bg-gradient-to-r from-slate-800 to-slate-700 hover:opacity-90 transition rounded-xl font-semibold text-sm flex items-center justify-center gap-2 text-white"
              >
                Scan Next Item
              </button>
            </div>
          )}

        </div>
      </div>
    </main>
  );
}