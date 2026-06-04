'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import Tesseract from 'tesseract.js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface BoundingBox {
  x: number; // % from left
  y: number; // % from top
  w: number; // % width
  h: number; // % height
}

type DragAction = {
  type: 'move' | 'resize';
  handle?: 'tl' | 'tr' | 'bl' | 'br';
  target: 'name' | 'price';
  startX: number;
  startY: number;
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

  // Professional presets: standard aspect ratios, perfectly centered on load
  const [nameBox, setNameBox] = useState<BoundingBox>({ x: 10, y: 25, w: 80, h: 14 });
  const [priceBox, setPriceBox] = useState<BoundingBox>({ x: 20, y: 52, w: 60, h: 14 });
  
  // Single fluid pointer interaction tracker
  const dragAction = useRef<DragAction | null>(null);

  // Form & Metadata States
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

    canvas.width = 1024;
    canvas.height = (video.videoHeight / video.videoWidth) * 1024;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    canvas.toBlob((blob) => {
      if (blob) {
        setCapturedImageBlob(blob);
        setImagePreviewUrl(URL.createObjectURL(blob));
        setAppState('adjusting');
      }
    }, 'image/jpeg', 0.8);
  };

  // --- SMOOTH NATIVE GESTURE ENGINE ---
  const handlePointerDown = (e: React.PointerEvent, type: 'move' | 'resize', handle?: 'tl' | 'tr' | 'bl' | 'br') => {
    e.stopPropagation();
    // Force pointer capture to keep tracking gestures cleanly even if the thumb slides outside the boundary box
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const target = activeBoxMode;
    const currentBox = target === 'name' ? nameBox : priceBox;

    dragAction.current = {
      type,
      handle,
      target,
      startX: e.clientX,
      startY: e.clientY,
      startBox: { ...currentBox }
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragAction.current || !containerRef.current) return;
    
    const action = dragAction.current;
    const rect = containerRef.current.getBoundingClientRect();
    
    // Calculate precise relative drag distance in layout percentage metrics
    const deltaX = ((e.clientX - action.startX) / rect.width) * 100;
    const deltaY = ((e.clientY - action.startY) / rect.height) * 100;

    let updated = { ...action.startBox };

    if (action.type === 'move') {
      updated.x = Math.max(0, Math.min(100 - updated.w, action.startBox.x + deltaX));
      updated.y = Math.max(0, Math.min(100 - updated.h, action.startBox.y + deltaY));
    } else if (action.type === 'resize' && action.handle) {
      const minSize = 8; // Enforce minimum boundary sizes to prevent bounding frames from collapsing completely
      
      switch (action.handle) {
        case 'tl':
          const newX = Math.min(action.startBox.x + action.startBox.w - minSize, Math.max(0, action.startBox.x + deltaX));
          updated.w = action.startBox.x + action.startBox.w - newX;
          updated.x = newX;
          const newY = Math.min(action.startBox.y + action.startBox.h - minSize, Math.max(0, action.startBox.y + deltaY));
          updated.h = action.startBox.y + action.startBox.h - newY;
          updated.y = newY;
          break;
        case 'tr':
          updated.w = Math.max(minSize, Math.min(100 - action.startBox.x, action.startBox.w + deltaX));
          const newY_tr = Math.min(action.startBox.y + action.startBox.h - minSize, Math.max(0, action.startBox.y + deltaY));
          updated.h = action.startBox.y + action.startBox.h - newY_tr;
          updated.y = newY_tr;
          break;
        case 'bl':
          const newX_bl = Math.min(action.startBox.x + action.startBox.w - minSize, Math.max(0, action.startBox.x + deltaX));
          updated.w = action.startBox.x + action.startBox.w - newX_bl;
          updated.x = newX_bl;
          updated.h = Math.max(minSize, Math.min(100 - action.startBox.y, action.startBox.h + deltaY));
          break;
        case 'br':
          updated.w = Math.max(minSize, Math.min(100 - action.startBox.x, action.startBox.w + deltaX));
          updated.h = Math.max(minSize, Math.min(100 - action.startBox.y, action.startBox.h + deltaY));
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

  // --- OCR HIGH CONTRAST RUNNER ---
  const scanCroppedZone = async (box: BoundingBox): Promise<string> => {
    if (!fullCanvasRef.current || !cropCanvasRef.current) return "";
    const fullCanvas = fullCanvasRef.current;
    const cropCanvas = cropCanvasRef.current;
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) return "";

    const sx = (box.x / 100) * fullCanvas.width;
    const sy = (box.y / 100) * fullCanvas.height;
    const sw = (box.w / 100) * fullCanvas.width;
    const sh = (box.h / 100) * fullCanvas.height;

    cropCanvas.width = sw;
    cropCanvas.height = sh;
    cropCtx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

    // Apply strict binarization matrix for high-contrast scanning look
    const imgData = cropCtx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gs = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      const binaryColor = gs < 125 ? 0 : 255; 
      d[i] = d[i+1] = d[i+2] = binaryColor;
    }
    cropCtx.putImageData(imgData, 0, 0);

    return new Promise((resolve) => {
      Tesseract.recognize(cropCanvas.toDataURL('image/jpeg'), 'eng')
        .then(res => resolve(res.data.text))
        .catch(() => resolve(""));
    });
  };

  const handleExecuteOcrScan = async () => {
    setAppState('processing');
    setOcrProgress(30);
    
    try {
      const [rawNameText, rawPriceText] = await Promise.all([
        scanCroppedZone(nameBox),
        scanCroppedZone(priceBox)
      ]);

      setOcrProgress(75);
      setProductName(rawNameText.replace(/[^a-zA-Z0-9\s\-\.]/g, '').replace(/\s+/g, ' ').trim());
      setPrice(rawPriceText.replace(/[^0-9\.]/g, '').trim());
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

      {/* PHASE 1: CAMERA FEED */}
      {appState === 'scanning' && (
        <div className="relative w-full h-full flex flex-col justify-between p-6">
          <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover z-0" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none z-10" />
          
          <div className="relative z-20 mx-auto bg-slate-900/90 border border-slate-700/50 backdrop-blur-md px-5 py-2 rounded-full text-xs font-semibold tracking-wide text-slate-200 shadow-xl">
            📸 Snap a steady photo of the item label
          </div>
          
          <button onClick={handleFreezePhoto} className="relative z-20 w-20 h-20 mx-auto mb-6 bg-white rounded-full flex items-center justify-center border-[6px] border-slate-800 shadow-2xl active:scale-90 transition duration-150">
            <div className="w-14 h-14 bg-cyan-500 rounded-full"></div>
          </button>
        </div>
      )}

      {/* PHASE 2: PROFESSIONAL GESTURE CROPPER UI */}
      {appState === 'adjusting' && (
        <div className="flex-1 flex flex-col h-full bg-slate-950">
          {/* Header Action Bar */}
          <div className="p-4 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 flex justify-between items-center z-20">
            <button onClick={() => setAppState('scanning')} className="text-xs font-medium text-slate-400 px-3 py-1.5 rounded-lg active:bg-slate-800">Retake</button>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Adjust Scanner Targets</h3>
            <button onClick={handleExecuteOcrScan} className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 px-4 py-1.5 rounded-lg text-xs font-bold shadow-md shadow-cyan-500/20 active:scale-95 transition">Analyze →</button>
          </div>

          {/* Interactive Workspace Viewport */}
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
              className={`absolute border-2 rounded-lg shadow-[0_0_15px_rgba(0,0,0,0.5)] cursor-move touch-none transition-shadow ${
                activeBoxMode === 'name' ? 'border-cyan-400 bg-cyan-500/10 z-30 shadow-cyan-500/10' : 'border-slate-500/40 bg-black/20 opacity-60 z-10'
              }`}
              style={{ left: `${nameBox.x}%`, top: `${nameBox.y}%`, width: `${nameBox.w}%`, height: `${nameBox.h}%` }}
            >
              <div className={`absolute top-0 left-0 text-[8px] font-black uppercase tracking-wider text-slate-950 px-1.5 py-0.5 rounded-br-md ${activeBoxMode === 'name' ? 'bg-cyan-400' : 'bg-slate-500 text-white'}`}>
                Item Name Target
              </div>

              {/* Precise Pro Corner Touch Anchors (Only show for active box mode) */}
              {activeBoxMode === 'name' && (
                <>
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'tl')} onPointerUp={handlePointerUp} className="absolute -top-1.5 -left-1.5 w-7 h-7 flex items-start justify-start cursor-nwse-resize touch-none"><div className="w-3 h-3 border-t-4 border-l-4 border-cyan-400 rounded-tl" /></div>
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'tr')} onPointerUp={handlePointerUp} className="absolute -top-1.5 -right-1.5 w-7 h-7 flex items-start justify-end cursor-nesw-resize touch-none"><div className="w-3 h-3 border-t-4 border-r-4 border-cyan-400 rounded-tr" /></div>
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'bl')} onPointerUp={handlePointerUp} className="absolute -bottom-1.5 -left-1.5 w-7 h-7 flex items-end justify-start cursor-nesw-resize touch-none"><div className="w-3 h-3 border-b-4 border-l-4 border-cyan-400 rounded-bl" /></div>
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'br')} onPointerUp={handlePointerUp} className="absolute -bottom-1.5 -right-1.5 w-7 h-7 flex items-end justify-end cursor-nwse-resize touch-none"><div className="w-3 h-3 border-b-4 border-r-4 border-cyan-400 rounded-br" /></div>
                </>
              )}
            </div>

            {/* RETAIL PRICE FRAME */}
            <div 
              onPointerDown={(e) => { setActiveBoxMode('price'); handlePointerDown(e, 'move'); }}
              onPointerUp={handlePointerUp}
              className={`absolute border-2 rounded-lg shadow-[0_0_15px_rgba(0,0,0,0.5)] cursor-move touch-none transition-shadow ${
                activeBoxMode === 'price' ? 'border-emerald-400 bg-emerald-500/10 z-30 shadow-emerald-500/10' : 'border-slate-500/40 bg-black/20 opacity-60 z-10'
              }`}
              style={{ left: `${priceBox.x}%`, top: `${priceBox.y}%`, width: `${priceBox.w}%`, height: `${priceBox.h}%` }}
            >
              <div className={`absolute top-0 left-0 text-[8px] font-black uppercase tracking-wider text-slate-950 px-1.5 py-0.5 rounded-br-md ${activeBoxMode === 'price' ? 'bg-emerald-400' : 'bg-slate-500 text-white'}`}>
                Retail Price Target
              </div>

              {activeBoxMode === 'price' && (
                <>
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'tl')} onPointerUp={handlePointerUp} className="absolute -top-1.5 -left-1.5 w-7 h-7 flex items-start justify-start cursor-nwse-resize touch-none"><div className="w-3 h-3 border-t-4 border-l-4 border-emerald-400 rounded-tl" /></div>
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'tr')} onPointerUp={handlePointerUp} className="absolute -top-1.5 -right-1.5 w-7 h-7 flex items-start justify-end cursor-nesw-resize touch-none"><div className="w-3 h-3 border-t-4 border-r-4 border-emerald-400 rounded-tr" /></div>
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'bl')} onPointerUp={handlePointerUp} className="absolute -bottom-1.5 -left-1.5 w-7 h-7 flex items-end justify-start cursor-nesw-resize touch-none"><div className="w-3 h-3 border-b-4 border-l-4 border-emerald-400 rounded-bl" /></div>
                  <div onPointerDown={(e) => handlePointerDown(e, 'resize', 'br')} onPointerUp={handlePointerUp} className="absolute -bottom-1.5 -right-1.5 w-7 h-7 flex items-end justify-end cursor-nwse-resize touch-none"><div className="w-3 h-3 border-b-4 border-r-4 border-emerald-400 rounded-br" /></div>
                </>
              )}
            </div>
          </div>

          {/* Quick Toggle Navigation System */}
          <div className="p-4 bg-slate-900 border-t border-slate-800/80 grid grid-cols-2 gap-3">
            <button 
              onClick={() => setActiveBoxMode('name')}
              className={`py-3.5 rounded-xl font-bold text-xs border transition flex flex-col items-center gap-1 ${
                activeBoxMode === 'name' ? 'bg-cyan-500/10 border-cyan-400 text-cyan-400' : 'bg-slate-800/50 border-slate-700/60 text-slate-400'
              }`}
            >
              <span className="text-sm">📝</span> Adjust Product Name
            </button>
            <button 
              onClick={() => setActiveBoxMode('price')}
              className={`py-3.5 rounded-xl font-bold text-xs border transition flex flex-col items-center gap-1 ${
                activeBoxMode === 'price' ? 'bg-emerald-500/10 border-emerald-400 text-emerald-400' : 'bg-slate-800/50 border-slate-700/60 text-slate-400'
              }`}
            >
              <span className="text-sm">🏷️</span> Adjust Item Price
            </button>
          </div>
        </div>
      )}

      {/* PHASE 3: PROCESSING RUN SCREEN */}
      {appState === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-950">
          <div className="w-12 h-12 border-[3px] border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-xs uppercase tracking-widest text-slate-400 font-semibold animate-pulse">Running Local OCR Workers ({ocrProgress}%)</p>
        </div>
      )}

      {/* PHASE 4: CONFIRMATION ENTRY FORM */}
      {appState === 'teaching' && (
        <div className="flex-1 flex flex-col h-full bg-slate-900 overflow-y-auto pb-10">
          <div className="w-full h-36 bg-slate-950 flex items-center justify-center border-b border-slate-800/80 p-2">
            <img src={imagePreviewUrl} alt="Target crop preview" className="h-full object-contain rounded" />
          </div>

          <form onSubmit={handleSaveToDatabase} className="flex flex-col flex-1 px-6 pt-5 space-y-4">
            <h2 className="text-base font-bold text-slate-100">Verify Scanned Output</h2>
            
            <div>
              <label className="block text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1">Supermarket / Branch</label>
              <input type="text" required value={storeName} onChange={(e) => setStoreName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-400 text-slate-200" />
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold tracking-wider text-cyan-400 mb-1">Product Description</label>
              <input type="text" required value={productName} onChange={(e) => setProductName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-400 text-slate-200" />
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold tracking-wider text-emerald-400 mb-1">Validated Retail Price</label>
              <div className="relative">
                <span className="absolute left-4 top-2.5 text-slate-400 font-bold text-sm">₱</span>
                <input type="number" step="0.01" required value={price} onChange={(e) => setPrice(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-8 pr-4 py-2.5 text-sm focus:outline-none focus:border-emerald-400 text-slate-200" />
              </div>
            </div>

            <button type="submit" disabled={loading} className="w-full mt-auto py-3.5 bg-gradient-to-r from-cyan-600 to-cyan-500 active:from-cyan-700 rounded-xl font-bold text-sm text-white disabled:opacity-40 shadow-lg shadow-cyan-500/10 transition">
              {loading ? 'Uploading Coordinates & Items...' : 'Save to Supabase'}
            </button>
          </form>
        </div>
      )}

      {/* PHASE 5: SUCCESS BLOCK */}
      {appState === 'success' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-950">
          <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center justify-center text-2xl mb-4 shadow-xl">✓</div>
          <h3 className="text-base font-bold text-slate-200 mb-1">Product Saved Natively</h3>
          <p className="text-xs text-slate-400 max-w-xs mb-8">Data points mapped directly to active location coordinates.</p>
          <button onClick={() => setAppState('scanning')} className="w-full max-w-xs py-3.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-700/50 rounded-xl font-bold text-xs uppercase tracking-wider text-slate-200 transition">Scan Next Label</button>
        </div>
      )}
    </main>
  );
}