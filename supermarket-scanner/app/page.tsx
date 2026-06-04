'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import Tesseract from 'tesseract.js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface BoundingBox {
  x: number; // percentage from left (0 to 100)
  y: number; // percentage from top (0 to 100)
  w: number; // width percentage (0 to 100)
  h: number; // height percentage (0 to 100)
}

export default function SupermarketScanner() {
  const [appState, setAppState] = useState<'scanning' | 'adjusting' | 'processing' | 'teaching' | 'success'>('scanning');
  const [loading, setLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [activeBoxMode, setActiveBoxMode] = useState<'name' | 'price'>('name');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  
  // Canvases for cropping operations
  const fullCanvasRef = useRef<HTMLCanvasElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);

  // Box Coordinates (Default starting positions in percentages)
  const [nameBox, setNameBox] = useState<BoundingBox>({ x: 10, y: 25, w: 80, h: 12 });
  const [priceBox, setPriceBox] = useState<BoundingBox>({ x: 25, y: 50, w: 50, h: 12 });
  const [isDrawing, setIsDrawing] = useState(false);
  const drawStart = useRef({ x: 0, y: 0 });

  // Form States
  const [productName, setProductName] = useState('');
  const [price, setPrice] = useState('');
  const [storeName, setStoreName] = useState('Puregold');
  const [category, setCategory] = useState('Grocery');
  
  // Metadata States
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
      console.error("Camera access error:", err);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
  }, []);

  useEffect(() => {
    if (appState === 'scanning') {
      startCamera();
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => { setLatitude(pos.coords.latitude); setLongitude(pos.coords.longitude); },
          null, { enableHighAccuracy: true }
        );
      }
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [appState, startCamera, stopCamera]);

  // Capture the full scene first
  const handleFreezePhoto = () => {
    if (!videoRef.current || !fullCanvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = fullCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Freeze photo at a high optimized processing resolution
    canvas.width = 1024;
    canvas.height = (video.videoHeight / video.videoWidth) * 1024;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    canvas.toBlob((blob) => {
      if (blob) {
        setCapturedImageBlob(blob);
        setImagePreviewUrl(URL.createObjectURL(blob));
        setAppState('adjusting');
      }
    }, 'image/jpeg', 0.75);
  };

  // Touch/Mouse handlers to drag & draw selection frames directly over the photo
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    
    // Calculate percentage coordinate clicked
    const clickX = ((e.clientX - rect.left) / rect.width) * 100;
    const clickY = ((e.clientY - rect.top) / rect.height) * 100;
    
    setIsDrawing(true);
    drawStart.current = { x: clickX, y: clickY };

    const initialBox = { x: clickX, y: clickY, w: 5, h: 4 };
    if (activeBoxMode === 'name') setNameBox(initialBox);
    else setPriceBox(initialBox);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDrawing || !imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    
    const currentX = ((e.clientX - rect.left) / rect.width) * 100;
    const currentY = ((e.clientY - rect.top) / rect.height) * 100;

    // Calculate boundary boxes fluidly
    const x = Math.max(0, Math.min(drawStart.current.x, currentX));
    const y = Math.max(0, Math.min(drawStart.current.y, currentY));
    const w = Math.min(100 - x, Math.abs(currentX - drawStart.current.x));
    const h = Math.min(100 - y, Math.abs(currentY - drawStart.current.y));

    if (activeBoxMode === 'name') setNameBox({ x, y, w, h });
    else setPriceBox({ x, y, w, h });
  };

  const handlePointerUp = () => {
    setIsDrawing(false);
  };

  // Helper method to process a specific box frame section
  const scanCroppedZone = async (box: BoundingBox): Promise<string> => {
    if (!fullCanvasRef.current || !cropCanvasRef.current) return "";
    
    const fullCanvas = fullCanvasRef.current;
    const cropCanvas = cropCanvasRef.current;
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) return "";

    // Convert percentage to actual source pixel units
    const sx = (box.x / 100) * fullCanvas.width;
    const sy = (box.y / 100) * fullCanvas.height;
    const sw = (box.w / 100) * fullCanvas.width;
    const sh = (box.h / 100) * fullCanvas.height;

    cropCanvas.width = sw;
    cropCanvas.height = sh;
    cropCtx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

    // Apply native binarization filter (Black & White conversion)
    const imgData = cropCtx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gs = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      const binaryColor = gs < 120 ? 0 : 255; // isolates thermal printer dot matrix text blocks
      d[i] = d[i+1] = d[i+2] = binaryColor;
    }
    cropCtx.putImageData(imgData, 0, 0);

    const base64Crop = cropCanvas.toDataURL('image/jpeg');
    
    // Run localized fast Tesseract task instance
    const result = await Tesseract.recognize(base64Crop, 'eng');
    return result.data.text;
  };

  const handleExecuteOcrScan = async () => {
    setAppState('processing');
    setOcrProgress(25);
    
    try {
      // Process both coordinates in parallel
      const [rawNameText, rawPriceText] = await Promise.all([
        scanCroppedZone(nameBox),
        scanCroppedZone(priceBox)
      ]);

      setOcrProgress(75);

      // Sanitize Name output (Drop noisy punctuation artifacts, preserve layout strings)
      const cleanName = rawNameText.replace(/[^a-zA-Z0-9\s\-\.]/g, '').replace(/\s+/g, ' ').trim();
      
      // Sanitize Price output (Discard letters completely, leave strictly numbers and floating decimals)
      const cleanPrice = rawPriceText.replace(/[^0-9\.]/g, '').trim();

      setProductName(cleanName);
      setPrice(cleanPrice);
      setOcrProgress(100);
      setAppState('teaching');
    } catch (err) {
      console.error(err);
      alert("Error scanning text positions. Please specify manually.");
      setAppState('teaching');
    }
  };

  const handleSaveToDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName || !price) return alert("Verify fields before submitting.");
    setLoading(true);

    try {
      let imageUrl = null;
      if (capturedImageBlob) {
        const fileName = `item_${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage.from('product-images').upload(fileName, capturedImageBlob, { contentType: 'image/jpeg' });
        if (uploadError) throw uploadError;
        imageUrl = supabase.storage.from('product-images').getPublicUrl(fileName).data.publicUrl;
      }

      const { error: dbError } = await supabase.from('supermarket_items').upsert([
        { product_name: productName, price: parseFloat(price), category, store_name: storeName, latitude, longitude, image_url: imageUrl },
      ], { onConflict: 'product_name' });

      if (dbError) throw dbError;
      setAppState('success');
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex flex-col h-[100dvh] w-full bg-slate-900 text-white overflow-hidden relative select-none">
      <canvas ref={fullCanvasRef} className="hidden" />
      <canvas ref={cropCanvasRef} className="hidden" />

      {/* STATE 1: CAMERA FEED CAPTURE */}
      {appState === 'scanning' && (
        <div className="relative w-full h-full flex flex-col justify-between p-6">
          <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover z-0" />
          <div className="relative z-10 mx-auto bg-slate-950/80 px-4 py-1.5 rounded-full text-xs font-bold border border-slate-700 backdrop-blur-md">
            📷 Snap a clear photo of the price tag
          </div>
          <button onClick={handleFreezePhoto} className="relative z-10 w-20 h-20 mx-auto mb-6 bg-white rounded-full flex items-center justify-center border-4 border-slate-300 shadow-2xl active:scale-95 transition">
            <div className="w-16 h-16 bg-cyan-500 rounded-full"></div>
          </button>
        </div>
      )}

      {/* STATE 2: INTERACTIVE DOUBLE BOX SELECTOR */}
      {appState === 'adjusting' && (
        <div className="flex-1 flex flex-col h-full bg-slate-950">
          <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
            <button onClick={() => setAppState('scanning')} className="text-sm text-slate-400">Cancel</button>
            <h3 className="text-sm font-bold">Drag & Adjust Selection</h3>
            <button onClick={handleExecuteOcrScan} className="bg-cyan-500 hover:bg-cyan-400 px-4 py-1.5 rounded-lg text-xs font-bold text-slate-950">Scan Now →</button>
          </div>

          {/* Interactive Work Area */}
          <div 
            ref={imageContainerRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="flex-1 relative w-full bg-contain bg-center bg-no-repeat touch-none cursor-crosshair"
            style={{ backgroundImage: `url(${imagePreviewUrl})` }}
          >
            {/* The Item Name Box Frame */}
            <div 
              className={`absolute border-2 rounded shadow-md pointer-events-none transition-colors duration-150 ${activeBoxMode === 'name' ? 'border-cyan-400 bg-cyan-500/10 z-30' : 'border-cyan-600/40 bg-transparent z-10'}`}
              style={{ left: `${nameBox.x}%`, top: `${nameBox.y}%`, width: `${nameBox.w}%`, height: `${nameBox.h}%` }}
            >
              <span className="absolute top-0 left-0 bg-cyan-500 text-[9px] font-black uppercase text-slate-950 px-1 py-0.5 rounded-br">Item Name Area</span>
            </div>

            {/* The Price Box Frame */}
            <div 
              className={`absolute border-2 rounded shadow-md pointer-events-none transition-colors duration-150 ${activeBoxMode === 'price' ? 'border-emerald-400 bg-emerald-500/10 z-30' : 'border-emerald-600/40 bg-transparent z-10'}`}
              style={{ left: `${priceBox.x}%`, top: `${priceBox.y}%`, width: `${priceBox.w}%`, height: `${priceBox.h}%` }}
            >
              <span className="absolute top-0 left-0 bg-emerald-400 text-[9px] font-black uppercase text-slate-950 px-1 py-0.5 rounded-br">Price Area</span>
            </div>
          </div>

          {/* Control Mode Toggle bar */}
          <div className="grid grid-cols-2 gap-2 p-4 bg-slate-900 border-t border-slate-800">
            <button 
              onClick={() => setActiveBoxMode('name')}
              className={`py-3 rounded-xl font-bold text-xs border transition ${activeBoxMode === 'name' ? 'bg-cyan-500/20 border-cyan-400 text-cyan-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
            >
              ✏️ Draw Item Name Box
            </button>
            <button 
              onClick={() => setActiveBoxMode('price')}
              className={`py-3 rounded-xl font-bold text-xs border transition ${activeBoxMode === 'price' ? 'bg-emerald-500/20 border-emerald-400 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
            >
              💵 Draw Price Box
            </button>
          </div>
        </div>
      )}

      {/* STATE 3: LOCAL PROCESSING PROGRESS SCREEN */}
      {appState === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-950">
          <div className="w-14 h-14 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-sm font-medium tracking-wide">OCR Processing Cropped Zones ({ocrProgress}%)</p>
        </div>
      )}

      {/* STATE 4: VERIFICATION FORM */}
      {appState === 'teaching' && (
        <div className="flex-1 flex flex-col h-full bg-slate-900 overflow-y-auto pb-10">
          <div className="w-full h-40 bg-slate-950 flex items-center justify-center border-b border-slate-800 p-2">
            <img src={imagePreviewUrl} alt="Tag view" className="h-full object-contain" />
          </div>

          <form onSubmit={handleSaveToDatabase} className="flex flex-col flex-1 px-6 pt-5 space-y-4">
            <div>
              <h2 className="text-md font-bold text-white mb-4">Confirm Scanned Details</h2>
              
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Store Name</label>
              <input type="text" required value={storeName} onChange={(e) => setStoreName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-400" />
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Product Name</label>
              <input type="text" required value={productName} onChange={(e) => setProductName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-400" />
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Retail Price</label>
              <div className="relative">
                <span className="absolute left-4 top-2.5 text-slate-400 font-bold text-sm">₱</span>
                <input type="number" step="0.01" required value={price} onChange={(e) => setPrice(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-8 pr-4 py-2.5 text-sm focus:outline-none focus:border-cyan-400" />
              </div>
            </div>

            <button type="submit" disabled={loading} className="w-full mt-auto py-3 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-bold text-sm text-white disabled:opacity-40 transition">
              {loading ? 'Uploading Scans...' : 'Confirm and Save'}
            </button>
          </form>
        </div>
      )}

      {/* STATE 5: SUCCESS FOOTER */}
      {appState === 'success' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-950">
          <div className="w-14 h-14 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full flex items-center justify-center text-xl mb-3">✓</div>
          <h3 className="text-lg font-bold mb-8">Data Point Saved Natively</h3>
          <button onClick={() => setAppState('scanning')} className="w-full max-w-xs py-3 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold text-sm">Scan Next Label</button>
        </div>
      )}
    </main>
  );
}