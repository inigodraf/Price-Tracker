'use client';

import { useState, useEffect, Suspense } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; 
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// --------------------------------------------------------
// NEW: NATIVE IMAGE COMPRESSOR (Reduces 5MB images to ~100kb)
// --------------------------------------------------------
const compressImage = async (file: File, maxWidth = 800, quality = 0.7): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Resize if larger than maxWidth
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (blob) {
                // Force convert to lightweight JPEG
                const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, ".jpg"), {
                  type: 'image/jpeg',
                  lastModified: Date.now(),
                });
                resolve(newFile);
              } else {
                reject(new Error("Canvas compression failed"));
              }
            },
            'image/jpeg',
            quality // 0.7 = 70% quality, perfect balance for web
          );
        } else {
          reject(new Error("No canvas context"));
        }
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

interface Market { id: string; name: string; latitude: number; longitude: number; distance?: number; }

const PH_CATEGORIES = [
  "RICE & SUGAR",
  "CANNED GOODS",
  "NOODLES & PASTA",
  "CONDIMENTS & SAUCES",
  "MEAT & SEAFOOD",
  "FRESH PRODUCE",
  "DAIRY & CHILLED",
  "BEVERAGES",
  "SNACKS & BISCUITS",
  "PERSONAL CARE",
  "HOUSEHOLD & CLEANING",
  "OTHERS"
];

function AddItemContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [step, setStep] = useState(1);
  const [loadingMsg, setLoadingMsg] = useState("Checking location status...");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [coords, setCoords] = useState<{lat: number, lng: number} | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  
  const [isAddingNewMarket, setIsAddingNewMarket] = useState(false);
  const [newMarketName, setNewMarketName] = useState("");
  const [similarMarkets, setSimilarMarkets] = useState<Market[] | null>(null);

  const [productName, setProductName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  useEffect(() => {
    const urlStore = searchParams.get('store');
    const urlLat = searchParams.get('lat');
    const urlLng = searchParams.get('lng');

    if (urlStore && urlLat && urlLng) {
      setSelectedMarket({
        id: 'url-passed',
        name: urlStore.toUpperCase(),
        latitude: parseFloat(urlLat),
        longitude: parseFloat(urlLng)
      });
      setStep(3);
      return;
    }

    const fetchLocations = async (userLat: number, userLng: number) => {
      const { data } = await supabase.from('markets').select('*');
      let fetchedMarkets: Market[] = data || [];

      fetchedMarkets = fetchedMarkets.map(m => ({
        ...m,
        distance: getDistance(userLat, userLng, m.latitude, m.longitude)
      })).sort((a, b) => (a.distance || 0) - (b.distance || 0));
      
      setMarkets(fetchedMarkets.slice(0, 5));
      setStep(2);
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
          fetchLocations(position.coords.latitude, position.coords.longitude);
        },
        (error) => {
          console.warn("GPS disabled or denied");
          alert("Location access is required to add an item. Please enable GPS permissions.");
          router.push('/');
        },
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 }
      );
    } else {
      alert("Location services are not supported by your device.");
      router.push('/');
    }
  }, [searchParams, router]);

  const executeMarketCreation = async (finalName: string) => {
    setIsSubmitting(true);
    const newMarket = {
      name: finalName,
      latitude: coords?.lat || 0,
      longitude: coords?.lng || 0
    };

    const { data, error } = await supabase.from('markets').insert([newMarket]).select().single();
    setIsSubmitting(false);

    if (error) {
      console.error("Supabase Insert Error:", error);
      alert(`System error: ${error.message}`);
      return;
    }

    setSelectedMarket(data);
    setSimilarMarkets(null);
    setStep(3);
  };

  const handleCreateMarketCheck = async () => {
    const formattedName = newMarketName.toUpperCase().trim();
    if (!formattedName) return;
    
    if (!coords) {
      alert("Location services must be enabled to register a new market.");
      return;
    }

    setIsSubmitting(true);

    const { data } = await supabase
      .from('markets')
      .select('*')
      .ilike('name', `%${formattedName}%`);

    setIsSubmitting(false);

    if (data && data.length > 0) {
      setSimilarMarkets(data);
    } else {
      executeMarketCreation(formattedName);
    }
  };

  const handleSubmitProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName || !price || !category || !selectedMarket) return;
    
    setIsSubmitting(true);
    let imageUrl = "";

    try {
      if (imageFile) {
        // COMPRESS THE IMAGE FIRST
        const compressedFile = await compressImage(imageFile);
        
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.jpg`;
        
        // FIXED BUCKET NAME TO "product-images"
        const { error: uploadError } = await supabase.storage.from('product-images').upload(fileName, compressedFile);
        
        if (!uploadError) {
          const { data } = supabase.storage.from('product-images').getPublicUrl(fileName);
          imageUrl = data.publicUrl;
        } else {
          console.error("Upload error:", uploadError);
        }
      }

      const { error: dbError } = await supabase.from('supermarket_items').insert([{
        product_name: productName.trim(),
        price: parseFloat(price),
        category: category,
        store_name: selectedMarket.name,
        latitude: selectedMarket.latitude,
        longitude: selectedMarket.longitude,
        image_url: imageUrl
      }]);

      if (dbError) {
        console.error("Database Insert Error:", dbError);
        alert(`Database error: ${dbError.message}`);
        setIsSubmitting(false);
        return;
      }
      
      router.push('/');
      
    } catch (error: any) {
      console.error("Submission error:", error);
      alert(`System error: ${error.message || "Unknown error occurred"}`);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-white flex flex-col relative">
      <div className="flex items-center p-4 border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-50">
        <button onClick={() => step > 2 ? setStep(2) : router.push('/')} className="text-emerald-400 font-bold px-2 py-1 bg-slate-900 rounded-lg active:scale-95 transition">
          Back
        </button>
        <h1 className="flex-1 text-center font-black text-xl tracking-tight mr-10">Scan Item</h1>
      </div>

      <div className="flex-1 p-5 max-w-md mx-auto w-full">
        
        {step === 1 && (
          <div className="h-full flex flex-col items-center justify-center space-y-4 pt-32">
            <div className="w-12 h-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin"></div>
            <p className="text-slate-400 font-bold animate-pulse">{loadingMsg}</p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6 pb-10">
            <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-xl">
              <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Location Selection</h2>
              
              {isAddingNewMarket ? (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-4">
                  {similarMarkets ? (
                    <div className="space-y-3">
                      <p className="text-sm text-emerald-400 font-bold">Similar locations found. Select an existing market or proceed with creation.</p>
                      {similarMarkets.map(market => (
                        <button key={market.id} onClick={() => { setSelectedMarket(market); setStep(3); }} className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl text-left font-bold text-white hover:bg-slate-800 transition">
                          {market.name}
                        </button>
                      ))}
                      <div className="pt-2">
                        <button onClick={() => executeMarketCreation(newMarketName.toUpperCase().trim())} disabled={isSubmitting} className="w-full border border-emerald-500/50 text-emerald-400 py-3 rounded-xl font-bold hover:bg-emerald-500/10 transition mb-2">
                          {isSubmitting ? "Processing..." : `Create "${newMarketName.toUpperCase().trim()}" Anyway`}
                        </button>
                        <button onClick={() => { setSimilarMarkets(null); setIsAddingNewMarket(false); setNewMarketName(""); }} className="w-full bg-slate-800 text-slate-300 py-3 rounded-xl font-bold">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-emerald-400 font-bold">Registering new location at your current coordinates.</p>
                      <input 
                        type="text" 
                        value={newMarketName} 
                        onChange={(e) => setNewMarketName(e.target.value.toUpperCase())}
                        placeholder="ENTER STORE NAME" 
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white uppercase focus:outline-none focus:border-emerald-500"
                      />
                      <div className="flex gap-2 pt-2">
                        <button onClick={handleCreateMarketCheck} disabled={isSubmitting || !newMarketName.trim()} className="flex-1 bg-emerald-500 text-slate-950 py-3 rounded-xl font-bold disabled:opacity-50">
                          {isSubmitting ? "Validating..." : "Save Location"}
                        </button>
                        <button onClick={() => { setIsAddingNewMarket(false); setNewMarketName(""); }} className="flex-1 bg-slate-800 text-slate-300 py-3 rounded-xl font-bold">Cancel</button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {markets.length === 0 ? (
                    <p className="text-slate-400 text-sm italic py-2">No locations found in database.</p>
                  ) : (
                    markets.map(market => (
                      <button key={market.id} onClick={() => { setSelectedMarket(market); setStep(3); }} className="w-full bg-slate-950 hover:bg-slate-800 border border-slate-800 p-4 rounded-xl flex justify-between items-center text-left transition active:scale-95">
                        <span className="font-bold text-white truncate pr-2">{market.name}</span>
                        {market.distance !== undefined && (
                          <span className="text-xs text-emerald-400 font-mono whitespace-nowrap bg-emerald-500/10 px-2 py-1 rounded-md">
                            {(market.distance / 1000).toFixed(1)} km
                          </span>
                        )}
                      </button>
                    ))
                  )}
                  
                  <div className="pt-4 border-t border-slate-800 mt-4">
                    <button onClick={() => setIsAddingNewMarket(true)} className="w-full border-2 border-dashed border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10 py-3 rounded-xl font-bold transition">
                      Add New Location
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 3 && selectedMarket && (
          <form onSubmit={handleSubmitProduct} className="space-y-6 pb-20 animate-in slide-in-from-right-8">
            <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-2xl flex items-center justify-between">
              <div>
                <p className="text-xs text-emerald-400 font-bold uppercase tracking-wider">Active Location</p>
                <p className="text-white font-black text-lg">{selectedMarket.name}</p>
              </div>
              <button type="button" onClick={() => { setStep(2); setSimilarMarkets(null); }} className="text-xs bg-slate-800 text-slate-300 px-3 py-1.5 rounded-lg font-bold">Change</button>
            </div>

            <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-xl space-y-5">
              <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1">Product Data</h2>
              
              <div className="relative w-full aspect-video bg-slate-950 rounded-xl border-2 border-dashed border-slate-700 overflow-hidden flex flex-col items-center justify-center group">
                {imagePreview ? (
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center text-slate-500 group-hover:text-emerald-400 transition flex flex-col items-center">
                    <svg className="w-8 h-8 mb-2 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    <span className="font-bold text-sm">Tap to capture image</span>
                  </div>
                )}
                <input type="file" accept="image/*" capture="environment" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) { setImageFile(file); setImagePreview(URL.createObjectURL(file)); }
                }} className="absolute inset-0 opacity-0 cursor-pointer" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-300">Product Name</label>
                <input type="text" value={productName} onChange={(e) => setProductName(e.target.value.toUpperCase())} placeholder="PRODUCT NAME" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white uppercase focus:outline-none focus:border-emerald-500" required />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-300">Category</label>
                <div className="relative">
                  <select 
                    value={category} 
                    onChange={(e) => setCategory(e.target.value)} 
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white appearance-none focus:outline-none focus:border-emerald-500 font-bold" 
                    required
                  >
                    <option value="" disabled>SELECT CATEGORY</option>
                    {PH_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-slate-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-300">Price</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black">PHP</span>
                  <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-14 pr-4 py-3 text-white focus:outline-none focus:border-emerald-500 text-lg font-bold" required />
                </div>
              </div>
            </div>

            <button type="submit" disabled={isSubmitting || !productName || !price || !category} className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 text-slate-950 font-black text-lg py-4 rounded-2xl shadow-lg transition active:scale-95 flex items-center justify-center">
              {isSubmitting ? <div className="w-6 h-6 border-4 border-slate-900/30 border-t-slate-900 rounded-full animate-spin"></div> : "Save Record"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function AddItemPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-emerald-500 font-bold">Loading...</div>}>
      <AddItemContent />
    </Suspense>
  );
}