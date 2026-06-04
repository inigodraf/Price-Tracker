'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import Tesseract from 'tesseract.js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface BoundingBox {
  x: number; y: number; w: number; h: number; r: number; // Added 'r' for Rotation degrees
}

type DragAction = {
  type: 'move' | 'resize';
  handle?: 'tl' | 'tr' | 'bl' | 'br' | 'rotate';
  target: 'name' | 'price';
  startX: number; startY: number;
  startBox: BoundingBox;
};

export default function SupermarketScanner() {
  const [appState, setAppState] = useState<'scanning' | 'adjusting' | 'processing' | 'teaching' | 'success'>('scanning');
  const [loading, setLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [activeBoxMode, setActiveBoxMode] = useState<'name' | 'price'>('name');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fullCanvasRef = useRef<HTMLCanvasElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);

  // Added r: 0 to the default box states
  const [nameBox, setNameBox] = useState<BoundingBox>({ x: 10, y: 25, w: 80, h: 12, r: 0 });
  const [priceBox, setPriceBox] = useState<BoundingBox>({ x: 20, y: 52, w: 60, h: 12, r: 0 });
  
  const dragAction = useRef<DragAction | null>(null);

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

  const handleFreezePhoto = () => {
    if (!videoRef.current || !fullCanvasRef.current) return;
    const video = videoRef.current;
    const canvas = fullCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 1440;
    canvas.height = (video.videoHeight / video.videoWidth) * 1440;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    canvas.toBlob((blob) => {
      if (blob) {
        setCapturedImageBlob(blob);
        setImagePreviewUrl(URL.createObjectURL(blob));
        setAppState('adjusting');
      }
    }, 'image/jpeg', 0.9);
  };

  const handlePointerDown = (e: React.PointerEvent, type: 'move' | 'resize', handle?: 'tl' | 'tr' | 'bl' | 'br' | 'rotate') => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const target = activeBoxMode;
    const currentBox = target === 'name' ? nameBox : priceBox;

    dragAction.current = {
      type, handle, target,
      startX: e.clientX, startY: e.clientY,
      startBox: { ...currentBox }
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragAction.current || !containerRef.current) return;
    
    const action = dragAction.current;
    const rect = containerRef.current.getBoundingClientRect();
    
    const deltaX = ((e.clientX - action.startX) / rect.width) * 100;
    const deltaY = ((e.clientY - action.startY) / rect.height) * 100;

    let updated = { ...action.startBox };

    // Handle standard move
    if (action.type === 'move') {
      updated.x = Math.max(0, Math.min(100 - updated.w, action.startBox.x + deltaX));
      updated.y = Math.max(0, Math.min(100 - updated.h, action.startBox.y + deltaY));
    } 
    // Handle free-form rotation math
    else if (action.handle === 'rotate') {
      const cx = rect.left + (action.startBox.x + action.startBox.w / 2) / 100 * rect.width;
      const cy = rect.top + (action.startBox.y + action.startBox.h / 2) / 100 * rect.height;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
      updated.r = angle;
    } 
    // Handle resizes
    else if (action.type === 'resize' && action.handle) {
      const minSizeX = 4;
      const minSizeY = 2; // Allowed height to go down to 2% for incredibly tiny text
      
      switch (action.handle) {
        case 'tl':
          const newX = Math.min(action.startBox.x + action.startBox.w - minSizeX, Math.max(0, action.startBox.x + deltaX));
          updated.w = action.startBox.x + action.startBox.w - newX;
          updated.x = newX;
          const newY = Math.min(action.startBox.y + action.startBox.h - minSizeY, Math.max(0, action.startBox.y + deltaY));
          updated.h = action.startBox.y + action.startBox.h - newY;
          updated.y = newY;
          break;
        case 'tr':
          updated.w = Math.max(minSizeX, Math.min(100 - action.startBox.x, action.startBox.w + deltaX));
          const newY_tr = Math.min(action.startBox.y + action.startBox.h - minSizeY, Math.max(0, action.startBox.y + deltaY));
          updated.h = action.startBox.y + action.startBox.h - newY_tr;
          updated.y = newY_tr;
          break;
        case 'bl':
          const newX_bl = Math.min(action.startBox.x + action.startBox.w - minSizeX, Math.max(0, action.startBox.x + deltaX));
          updated.w = action.startBox.x + action.startBox.w - newX_bl;
          updated.x = newX_bl;
          updated.h = Math.max(minSizeY, Math.min(100 - action.startBox.y, action.startBox.h + deltaY));
          break;
        case 'br':
          updated.w = Math.max(minSizeX, Math.min(100 - action.startBox.x, action.startBox.w + deltaX));
          updated.h = Math.max(minSizeY, Math.min(100 - action.startBox.y, action.startBox.h + deltaY));
          break;
      }
    }

    if (action.target === 'name') setNameBox(updated);
    else setPriceBox(updated);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragAction.current) return;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    dragAction.current = null;
  };

  // --- NATIVE CANVAS ROTATION & EXTRACTION ---
  const extractImage = (box: BoundingBox): string => {
    if (!fullCanvasRef.current || !cropCanvasRef.current) return "";
    const fullCanvas = fullCanvasRef.current;
    const cropCanvas = cropCanvasRef.current;
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) return "";

    const sw = (box.w / 100) * fullCanvas.width;
    const sh = (box.h / 100) * fullCanvas.height;

    // Magnify for AI precision
    const scaleFactor = 3.0; 
    cropCanvas.width = sw * scaleFactor;
    cropCanvas.height = sh * scaleFactor;

    // Fill white background to prevent transparent voids from rotation
    cropCtx.fillStyle = 'white';
    cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

    // High quality context filters instead of manual pixel destruction
    cropCtx.filter = 'grayscale(100%) contrast(160%) brightness(110%)';

    // Matrix geometry to flatten rotated boxes cleanly
    cropCtx.scale(scaleFactor, scaleFactor);
    cropCtx.translate(sw / 2, sh / 2);
    cropCtx.rotate((box.r * Math.PI) / 180);

    const cx = (box.x + box.w / 2) / 100 * fullCanvas.width;
    const cy = (box.y + box.h / 2) / 100 * fullCanvas.height;

    cropCtx.drawImage(fullCanvas, -cx, -cy);
    cropCtx.filter = 'none';

    return cropCanvas.toDataURL('image/jpeg');
  };

  // --- OCR V5 WORKER EXECUTION ---
  const handleExecuteOcrScan = async () => {
    setAppState('processing');
    setOcrProgress(10);
    
    try {
      const nameDataUrl = extractImage(nameBox);
      const priceDataUrl = extractImage(priceBox);
      setOcrProgress(25);

      // We instantiate the worker manually so we can force Single Line Mode
      const worker = await Tesseract.createWorker('eng');
      
      // PSM 7 tells the AI "This is a single line of text". It stops hallucinating nonsense.
      await worker.setParameters({
        tessedit_pageseg_mode: '7',
      });
      setOcrProgress(50);

      const { data: { text: rawNameText } } = await worker.recognize(nameDataUrl);
      setOcrProgress(75);

      const { data: { text: rawPriceText } } = await worker.recognize(priceDataUrl);
      await worker.terminate();
      setOcrProgress(90);

      // Less aggressive Regex: Allows hyphens, dots, commas, slashes, percent signs, and ampersands
      const cleanName = rawNameText
        .replace(/[^a-zA-Z0-9\s\-\.,&'%\/\+]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase(); 
      
      // Keep numbers, dots, and commas for the price
      let cleanPrice = rawPriceText.replace(/[^0-9\.,]/g, '').trim();
      cleanPrice = cleanPrice.replace(/,/g, '.'); // Normalize commas to dots
      
      if (cleanPrice && !cleanPrice.includes('.')) {
        if (cleanPrice.length > 2) {
          const mainUnits = cleanPrice.slice(0, -2);
          const centavos = cleanPrice.slice(-2);
          cleanPrice = `${mainUnits}.${centavos}`;
        } else {
          cleanPrice = `${cleanPrice}.00`;
        }
      }

      setProductName(cleanName);
      setPrice(cleanPrice);
      setOcrProgress(100);
      setAppState('teaching');
    } catch (err) {
      setAppState('teaching');
    }
  };

  const handleSaveToDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName || !price) return alert("Verify details before continuing.");
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
      alert(`Database Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex flex-col h-[100dvh] w-full bg-slate-950 text-white overflow-hidden relative select-none font-sans">
      <canvas ref={fullCanvasRef} className="hidden" />
      <canvas ref={cropCanvasRef} className="hidden" />

      {appState === 'scanning' && (
        <div className="relative w-full h-full flex flex-col justify-between p-6">
          <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover z-0" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none z-10" />
          
          <div className="relative z-20 mx-auto bg-slate-900/90 border border-slate-700/50 backdrop-blur-md px-5 py-2 rounded-full text-xs font-semibold tracking-wide text-slate-200 shadow-xl mt-4">
            📸 Snap a steady photo of the item label
          </div>
          
          <button onClick={handleFreezePhoto} className="relative z-20 w-20 h-20 mx-auto mb-6 bg-white rounded-full flex items-center justify-center border-[6px] border-slate-800 shadow-2xl active:scale-90 transition duration-150">
            <div className="w-14 h-14 bg-cyan-500 rounded-full"></div>
          </button>
        </div>
      )}

      {appState === 'adjusting' && (
        <div className="flex-1 flex flex-col h-full bg-slate-950">
          <div className="p-4 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 flex justify-between items-center z-20 relative shadow-lg">
            <button onClick={() => setAppState('scanning')} className="text-xs font-medium text-slate-400 px-3 py-1.5 rounded-lg active:bg-slate-800 transition">Retake</button>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Adjust Targets</h3>
            <button onClick={handleExecuteOcrScan} className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 px-4 py-1.5 rounded-lg text-xs font-bold shadow-md shadow-cyan-500/20 active:scale-95 transition">Analyze →</button>
          </div>

          <div 
            ref={containerRef}
            onPointerMove={handlePointerMove}
            className="flex-1 relative w-full bg-contain bg-center bg-no-repeat overflow-hidden touch-none"
            style={{ backgroundImage: `url(${imagePreviewUrl})` }}
          >
            {/* ITEM NAME FRAME */}
            <div 
              onPointerDown={(e) => { setActiveBoxMode('name'); handlePointerDown(e, 'move'); }}
              onPointerUp={handlePointerUp}
              className={`absolute border-[3px] rounded shadow-sm cursor-move touch-none transition-colors duration-200 ${
                activeBoxMode === 'name' ? 'border-cyan-400 z-30 bg-cyan-500/10' : 'border-white/30 bg-black/20 opacity-40 z-10'
              }`}
              style={{ 
                left: `${nameBox.x}%`, top: `${nameBox.y}%`, width: `${nameBox.w}%`, height: `${nameBox.h}%`,
                transform: `rotate(${nameBox.r}deg)`,
                boxShadow: activeBoxMode === 'name' ? '0 0 40px rgba(0, 0, 0, 0.8)' : 'none'
              }}
            >
              <div className={`absolute -top-[22px] left-[-3px] text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-t ${activeBoxMode === 'name' ? 'bg-cyan-400 text-slate-950' : 'bg-slate-700/80 text-white'}`}>
                Item Name
              </div>

              {activeBoxMode === 'name' && (
                <>
                  {/* The new Rotation Handle (Stick + Ball) */}
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'rotate')} onPointerUp={handlePointerUp} className="absolute -top-12 left-1/2 -translate-x-1/2 w-10 h-10 flex items-center justify-center cursor-grab touch-none">
                    <div className="w-[3px] h-6 bg-cyan-400 absolute bottom-2 rounded-full"></div>
                    <div className="w-5 h-5 bg-cyan-400 rounded-full shadow-lg border-[3px] border-slate-900 absolute top-0"></div>
                  </div>

                  {/* Corner Resizers */}
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'tl')} onPointerUp={handlePointerUp} className="absolute -top-3 -left-3 w-8 h-8 flex items-start justify-start cursor-nwse-resize touch-none"><div className="w-4 h-4 bg-cyan-400 rounded-full shadow-md" /></div>
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'tr')} onPointerUp={handlePointerUp} className="absolute -top-3 -right-3 w-8 h-8 flex items-start justify-end cursor-nesw-resize touch-none"><div className="w-4 h-4 bg-cyan-400 rounded-full shadow-md" /></div>
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'bl')} onPointerUp={handlePointerUp} className="absolute -bottom-3 -left-3 w-8 h-8 flex items-end justify-start cursor-nesw-resize touch-none"><div className="w-4 h-4 bg-cyan-400 rounded-full shadow-md" /></div>
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'br')} onPointerUp={handlePointerUp} className="absolute -bottom-3 -right-3 w-8 h-8 flex items-end justify-end cursor-nwse-resize touch-none"><div className="w-4 h-4 bg-cyan-400 rounded-full shadow-md" /></div>
                </>
              )}
            </div>

            {/* RETAIL PRICE FRAME */}
            <div 
              onPointerDown={(e) => { setActiveBoxMode('price'); handlePointerDown(e, 'move'); }}
              onPointerUp={handlePointerUp}
              className={`absolute border-[3px] rounded shadow-sm cursor-move touch-none transition-colors duration-200 ${
                activeBoxMode === 'price' ? 'border-emerald-400 z-30 bg-emerald-500/10' : 'border-white/30 bg-black/20 opacity-40 z-10'
              }`}
              style={{ 
                left: `${priceBox.x}%`, top: `${priceBox.y}%`, width: `${priceBox.w}%`, height: `${priceBox.h}%`,
                transform: `rotate(${priceBox.r}deg)`,
                boxShadow: activeBoxMode === 'price' ? '0 0 40px rgba(0, 0, 0, 0.8)' : 'none'
              }}
            >
              <div className={`absolute -top-[22px] left-[-3px] text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-t ${activeBoxMode === 'price' ? 'bg-emerald-400 text-slate-950' : 'bg-slate-700/80 text-white'}`}>
                Item Price
              </div>

              {activeBoxMode === 'price' && (
                <>
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'rotate')} onPointerUp={handlePointerUp} className="absolute -top-12 left-1/2 -translate-x-1/2 w-10 h-10 flex items-center justify-center cursor-grab touch-none">
                    <div className="w-[3px] h-6 bg-emerald-400 absolute bottom-2 rounded-full"></div>
                    <div className="w-5 h-5 bg-emerald-400 rounded-full shadow-lg border-[3px] border-slate-900 absolute top-0"></div>
                  </div>

                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'tl')} onPointerUp={handlePointerUp} className="absolute -top-3 -left-3 w-8 h-8 flex items-start justify-start cursor-nwse-resize touch-none"><div className="w-4 h-4 bg-emerald-400 rounded-full shadow-md" /></div>
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'tr')} onPointerUp={handlePointerUp} className="absolute -top-3 -right-3 w-8 h-8 flex items-start justify-end cursor-nesw-resize touch-none"><div className="w-4 h-4 bg-emerald-400 rounded-full shadow-md" /></div>
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'bl')} onPointerUp={handlePointerUp} className="absolute -bottom-3 -left-3 w-8 h-8 flex items-end justify-start cursor-nesw-resize touch-none"><div className="w-4 h-4 bg-emerald-400 rounded-full shadow-md" /></div>
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'br')} onPointerUp={handlePointerUp} className="absolute -bottom-3 -right-3 w-8 h-8 flex items-end justify-end cursor-nwse-resize touch-none"><div className="w-4 h-4 bg-emerald-400 rounded-full shadow-md" /></div>
                </>
              )}
            </div>
          </div>

          <div className="p-5 bg-slate-900 border-t border-slate-800/80 grid grid-cols-2 gap-4 relative z-20 shadow-[0_-10px_20px_rgba(0,0,0,0.3)]">
            <button 
              onClick={() => setActiveBoxMode('name')}
              className={`py-4 rounded-xl font-bold text-xs border transition shadow-sm ${
                activeBoxMode === 'name' ? 'bg-cyan-500 text-slate-950 border-cyan-400' : 'bg-slate-800/50 border-slate-700 text-slate-400'
              }`}
            >
              CROP NAME
            </button>
            <button 
              onClick={() => setActiveBoxMode('price')}
              className={`py-4 rounded-xl font-bold text-xs border transition shadow-sm ${
                activeBoxMode === 'price' ? 'bg-emerald-500 text-slate-950 border-emerald-400' : 'bg-slate-800/50 border-slate-700 text-slate-400'
              }`}
            >
              CROP PRICE
            </button>
          </div>
        </div>
      )}

      {appState === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-950">
          <div className="w-12 h-12 border-[3px] border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-xs uppercase tracking-widest text-slate-400 font-semibold animate-pulse">Scanning Crop Data ({ocrProgress}%)</p>
        </div>
      )}

      {appState === 'teaching' && (
        <div className="flex-1 flex flex-col h-full bg-slate-900 overflow-y-auto pb-10">
          <div className="w-full h-36 bg-slate-950 flex items-center justify-center border-b border-slate-800/80 p-2 shadow-inner">
            <img src={imagePreviewUrl} alt="Target crop preview" className="h-full object-contain rounded" />
          </div>

          <form onSubmit={handleSaveToDatabase} className="flex flex-col flex-1 px-6 pt-5 space-y-4">
            <h2 className="text-base font-bold text-slate-100">Verify Scanned Output</h2>
            
            <div>
              <label className="block text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1">Supermarket / Branch</label>
              <input type="text" required value={storeName} onChange={(e) => setStoreName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-400 text-slate-200 transition" />
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold tracking-wider text-cyan-400 mb-1">Product Description</label>
              <input type="text" required value={productName} onChange={(e) => setProductName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-400 text-slate-200 font-mono shadow-inner transition" />
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold tracking-wider text-emerald-400 mb-1">Validated Retail Price</label>
              <div className="relative">
                <span className="absolute left-4 top-3 text-slate-400 font-bold text-sm">₱</span>
                <input type="number" step="0.01" required value={price} onChange={(e) => setPrice(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-8 pr-4 py-3 text-sm focus:outline-none focus:border-emerald-400 text-slate-200 shadow-inner transition" />
              </div>
            </div>

            <button type="submit" disabled={loading} className="w-full mt-auto py-4 bg-gradient-to-r from-cyan-600 to-cyan-500 active:from-cyan-700 rounded-xl font-bold text-sm text-white disabled:opacity-40 shadow-[0_4px_14px_0_rgba(6,182,212,0.39)] hover:shadow-[0_6px_20px_rgba(6,182,212,0.23)] transition">
              {loading ? 'Uploading Details...' : 'Save to Supabase'}
            </button>
          </form>
        </div>
      )}

      {appState === 'success' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-950">
          <div className="w-20 h-20 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center justify-center text-3xl mb-4 shadow-xl">✓</div>
          <h3 className="text-lg font-bold text-slate-200 mb-1">Product Saved Natively</h3>
          <p className="text-sm text-slate-400 max-w-xs mb-10">Data points mapped successfully to database.</p>
          <button onClick={() => setAppState('scanning')} className="w-full max-w-xs py-4 bg-slate-800 hover:bg-slate-700 active:bg-slate-700/50 rounded-xl font-bold text-xs uppercase tracking-wider text-slate-200 transition shadow-md">Scan Next Label</button>
        </div>
      )}
    </main>
  );
}