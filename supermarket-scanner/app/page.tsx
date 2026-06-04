'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import Tesseract from 'tesseract.js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function SupermarketScanner() {
  const [appState, setAppState] = useState<'scanning' | 'processing' | 'teaching' | 'success'>('scanning');
  const [loading, setLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // We need multiple hidden canvases now for the two zones
  const fullCanvasRef = useRef<HTMLCanvasElement>(null);
  const nameCanvasRef = useRef<HTMLCanvasElement>(null);
  const priceCanvasRef = useRef<HTMLCanvasElement>(null);

  const [productName, setProductName] = useState('');
  const [price, setPrice] = useState('');
  const [storeName, setStoreName] = useState('Puregold');
  const [category, setCategory] = useState('Grocery');
  
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [capturedImageBlob, setCapturedImageBlob] = useState<Blob | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>('');

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      console.error("Camera error:", err);
      alert("Could not access camera.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
  }, []);

  const fetchLocation = useCallback(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLatitude(position.coords.latitude);
          setLongitude(position.coords.longitude);
        },
        () => console.log("Location access denied")
      );
    }
  }, []);

  useEffect(() => {
    if (appState === 'scanning') {
      startCamera();
      fetchLocation();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [appState, startCamera, stopCamera, fetchLocation]);

  // HELPER: Crops a specific zone and applies the high-contrast filter
  const extractAndFilterZone = (
    video: HTMLVideoElement, 
    canvas: HTMLCanvasElement, 
    pctX: number, pctY: number, pctW: number, pctH: number
  ) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const cropX = video.videoWidth * pctX;
    const cropY = video.videoHeight * pctY;
    const cropW = video.videoWidth * pctW;
    const cropH = video.videoHeight * pctH;

    canvas.width = cropW;
    canvas.height = cropH;
    
    // Draw only the specific zone
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    // Apply Black & White High Contrast Filter
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const grayscale = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
      const color = grayscale < 110 ? 0 : 255;
      data[i] = color;
      data[i+1] = color;
      data[i+2] = color;
    }
    ctx.putImageData(imgData, 0, 0);

    return canvas.toDataURL('image/jpeg');
  };

  const handleCaptureAndScan = async () => {
    if (!videoRef.current || !fullCanvasRef.current || !nameCanvasRef.current || !priceCanvasRef.current) return;
    setAppState('processing');
    setOcrProgress(5);
    
    const video = videoRef.current;
    
    // 1. Save full image for the database upload preview
    const fullCtx = fullCanvasRef.current.getContext('2d');
    if (fullCtx) {
      const scale = 800 / video.videoWidth;
      fullCanvasRef.current.width = 800;
      fullCanvasRef.current.height = video.videoHeight * scale;
      fullCtx.drawImage(video, 0, 0, fullCanvasRef.current.width, fullCanvasRef.current.height);
      
      fullCanvasRef.current.toBlob((blob) => {
        if (blob) {
          setCapturedImageBlob(blob);
          setImagePreviewUrl(URL.createObjectURL(blob));
        }
      }, 'image/jpeg', 0.6);
    }

    // 2. Crop and filter the two specific zones based on UI percentages
    // NAME ZONE: Top 30%, Height 15%, Left 10%, Width 80%
    const nameImageBase64 = extractAndFilterZone(video, nameCanvasRef.current, 0.10, 0.30, 0.80, 0.15);
    
    // PRICE ZONE: Top 55%, Height 15%, Left 25%, Width 50%
    const priceImageBase64 = extractAndFilterZone(video, priceCanvasRef.current, 0.25, 0.55, 0.50, 0.15);

    if (!nameImageBase64 || !priceImageBase64) return;
    setOcrProgress(20);

    // 3. Run Tesseract simultaneously on both tiny cropped images
    try {
      const [nameResult, priceResult] = await Promise.all([
        Tesseract.recognize(nameImageBase64, 'eng', { logger: m => { if (m.status === 'recognizing text') setOcrProgress(prev => Math.min(prev + 1, 90)); } }),
        Tesseract.recognize(priceImageBase64, 'eng')
      ]);

      setOcrProgress(100);

      // Clean the Name: Remove weird symbols, keep letters, numbers, spaces, and dashes
      const rawName = nameResult.data.text.replace(/[^a-zA-Z0-9\s\-\.]/g, '').trim();
      
      // Clean the Price: Since this box only has the price, just strip out letters and keep numbers/decimals
      const rawPrice = priceResult.data.text.replace(/[^0-9\.]/g, '').trim();

      setProductName(rawName);
      setPrice(rawPrice);
      setAppState('teaching');

    } catch (error) {
      console.error("OCR Error:", error);
      alert("Failed to read zones. Please enter manually.");
      setAppState('teaching');
    }
  };

  const handleSaveToDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName || !price) {
      alert("Please fill in the product name and price");
      return;
    }
    setLoading(true);

    try {
      let imageUrl = null;
      if (capturedImageBlob) {
        const fileName = `scan_${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage.from('product-images').upload(fileName, capturedImageBlob, { contentType: 'image/jpeg' });
        if (uploadError) throw uploadError;
        imageUrl = supabase.storage.from('product-images').getPublicUrl(fileName).data.publicUrl;
      }

      const { error: dbError } = await supabase.from('supermarket_items').upsert([
        { product_name: productName, price: parseFloat(price), category, store_name: storeName, latitude, longitude, image_url: imageUrl },
      ], { onConflict: 'product_name' });

      if (dbError) throw dbError;

      setAppState('success');
      setProductName('');
      setPrice('');
      setCapturedImageBlob(null);
      setImagePreviewUrl('');
    } catch (error: any) {
      alert(`Database Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex flex-col h-[100dvh] w-full bg-slate-900 text-white overflow-hidden relative">
      {/* Hidden Canvases for Processing */}
      <canvas ref={fullCanvasRef} className="hidden" />
      <canvas ref={nameCanvasRef} className="hidden" />
      <canvas ref={priceCanvasRef} className="hidden" />

      {appState === 'scanning' && (
        <div className="relative w-full h-full flex flex-col">
          <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
          
          <div className="absolute inset-0 z-10 bg-black/40">
            {/* The Cutout Zones - Visually maps to the percentages in extractAndFilterZone */}
            
            {/* NAME ZONE Cutout */}
            <div className="absolute border-2 border-dashed border-cyan-400 bg-transparent rounded-lg flex items-start justify-center"
                 style={{ top: '30%', left: '10%', width: '80%', height: '15%', boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }}>
              <span className="text-[10px] font-bold text-cyan-400 uppercase bg-slate-900/80 px-2 py-0.5 rounded-b-md">Align Product Name Here</span>
            </div>

            {/* PRICE ZONE Cutout */}
            <div className="absolute border-2 border-dashed border-emerald-400 bg-transparent rounded-lg flex items-start justify-center"
                 style={{ top: '55%', left: '25%', width: '50%', height: '15%' }}>
              <span className="text-[10px] font-bold text-emerald-400 uppercase bg-slate-900/80 px-2 py-0.5 rounded-b-md">Align Price Here</span>
            </div>
          </div>

          <div className="relative z-20 flex flex-col h-full justify-between pointer-events-none p-6">
            <div className="flex justify-center pt-8">
              <div className={`px-4 py-1.5 rounded-full border flex items-center gap-2 text-xs font-bold shadow-lg backdrop-blur-md ${latitude ? 'bg-emerald-600/90 border-emerald-500' : 'bg-amber-600/90 border-amber-500'}`}>
                {latitude ? 'GPS Locked' : 'Locating...'}
              </div>
            </div>

            <div className="pb-8 pointer-events-auto">
              <button onClick={handleCaptureAndScan} className="w-20 h-20 mx-auto bg-white rounded-full flex items-center justify-center border-4 border-slate-300 shadow-xl active:scale-95 transition">
                <div className="w-16 h-16 bg-cyan-500 rounded-full"></div>
              </button>
            </div>
          </div>
        </div>
      )}

      {appState === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-950">
          <div className="w-16 h-16 border-4 border-t-cyan-400 border-r-transparent border-b-emerald-400 border-l-transparent rounded-full animate-spin mb-6"></div>
          <h2 className="text-xl font-bold mb-1">Scanning 2 Zones...</h2>
          <div className="w-64 bg-slate-800 h-1.5 rounded-full mt-4 overflow-hidden">
            <div className="bg-gradient-to-r from-cyan-400 to-emerald-400 h-full transition-all duration-200" style={{ width: `${ocrProgress}%` }}></div>
          </div>
        </div>
      )}

      {appState === 'teaching' && (
        <div className="flex-1 flex flex-col h-full bg-slate-900 overflow-y-auto pb-10">
          {imagePreviewUrl && (
            <div className="w-full h-44 bg-slate-950 relative border-b border-slate-800">
              <img src={imagePreviewUrl} alt="Captured tag" className="w-full h-full object-contain p-2" />
              <button onClick={() => setAppState('scanning')} className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/70 flex items-center justify-center text-white text-sm font-bold shadow-md">←</button>
            </div>
          )}

          <form onSubmit={handleSaveToDatabase} className="flex flex-col flex-1 px-6 pt-5 space-y-5">
            <div>
              <label className="block text-[10px] uppercase font-bold text-cyan-400 mb-1.5">Scanned Item Name</label>
              <input type="text" required value={productName} onChange={(e) => setProductName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-400 mb-4" />
              
              <label className="block text-[10px] uppercase font-bold text-emerald-400 mb-1.5">Scanned Retail Price</label>
              <div className="relative">
                <span className="absolute left-4 top-3 text-slate-400 font-bold text-sm">₱</span>
                <input type="number" step="0.01" required value={price} onChange={(e) => setPrice(e.target.value)} className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl pl-8 pr-4 py-3 text-sm focus:outline-none focus:border-emerald-400" />
              </div>
            </div>
            
            <button type="submit" disabled={loading} className="w-full mt-auto py-3.5 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-bold text-sm text-white shadow-lg transition duration-150">
              {loading ? 'Saving...' : 'Save to Database'}
            </button>
          </form>
        </div>
      )}

      {appState === 'success' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-950">
          <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full flex items-center justify-center text-2xl mb-4">✓</div>
          <h3 className="text-xl font-bold text-white mb-6">Item Saved Successfully</h3>
          <button onClick={() => setAppState('scanning')} className="w-full max-w-xs py-3.5 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold text-sm text-white transition">Scan Next Item</button>
        </div>
      )}
    </main>
  );
}