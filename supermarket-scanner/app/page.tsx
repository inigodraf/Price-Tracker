'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import Tesseract from 'tesseract.js';

// Initialize Supabase Client
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function SupermarketScanner() {
  const [appState, setAppState] = useState<'scanning' | 'processing' | 'teaching' | 'success'>('scanning');
  const [loading, setLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Form States
  const [productName, setProductName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('Grocery');
  const [storeName, setStoreName] = useState('Puregold');
  
  // Location & Image States
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
      console.error("Error accessing camera:", err);
      alert("Could not access the camera. Please check your permissions.");
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
        (error) => console.log("Location access failed", error),
        { enableHighAccuracy: true }
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

  // SMART PARSER: Finds the price near currency symbols and extracts clean names
  const parseOcrTextSmartly = (rawText: string) => {
    const lines = rawText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    console.log("Cleaned Lines for Parsing:", lines);

    let detectedPrice = "";
    let detectedName = "";

    // 1. SMART PRICE DETECTION (Looks for ₱, P, p, F, or standalone decimals)
    // Matches patterns like ₱ 105.00, P45.75, or just numbers with decimals omitting barcode noise
    const priceRegex = /(?:₱|P|p|F|E)?\s*(\d+[\.,]\s*\d{2})/i;

    for (let line of lines) {
      // Ignore lines that look like barcode strings (lots of vertical lines)
      if ((line.match(/[|lI1i!]/g) || []).length > 5 && !line.includes('.')) {
        continue;
      }

      const match = line.match(priceRegex);
      if (match) {
        // Grab the digits, fix common spacing issues caused by OCR
        detectedPrice = match[1].replace(/\s+/g, '').replace(',', '.');
        break;
      }
    }

    // 2. SMART NAME DETECTION
    // Find the first line that has real words and does NOT contain the price
    for (let line of lines) {
      // Filter out barcodes and prices
      const hasBarcodeNoise = (line.match(/[|lI]/g) || []).length > 4;
      const hasPriceDigits = priceRegex.test(line);
      const isTooShort = line.replace(/[^a-zA-Z]/g, "").length < 3;

      if (!hasBarcodeNoise && !hasPriceDigits && !isTooShort) {
        // Clean up common header/footer junk characters
        detectedName = line.replace(/[^a-zA-Z0-9\s\-\.\/]/g, '').trim();
        break;
      }
    }

    return { detectedName, detectedPrice };
  };

  // Capture, Preprocess Image, and Run Free Tesseract OCR
  const handleCaptureAndScan = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setAppState('processing');
    setOcrProgress(5);
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // --- 1. IMAGE PREPROCESSING & COMPRESSION ---
    // Target a clean box size for scanning to isolate text from background noise
    const scanWidth = video.videoWidth * 0.9;
    const scanHeight = video.videoHeight * 0.5;
    const sx = (video.videoWidth - scanWidth) / 2;
    const sy = (video.videoHeight - scanHeight) / 2;

    canvas.width = scanWidth;
    canvas.height = scanHeight;
    
    // Draw raw crop onto canvas
    ctx.drawImage(video, sx, sy, scanWidth, scanHeight, 0, 0, scanWidth, scanHeight);

    // Save optimized preview blob for database upload
    canvas.toBlob((blob) => {
      if (blob) {
        setCapturedImageBlob(blob);
        setImagePreviewUrl(URL.createObjectURL(blob));
      }
    }, 'image/jpeg', 0.6); // 60% compression keeps file sizes very tiny

    // --- 2. ADVANCED OCR BINARIZATION FILTER ---
    // This turns the image into high contrast black & white to fill in the thermal dot-gaps
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Convert to grayscale
      const grayscale = 0.299 * r + 0.587 * g + 0.114 * b;
      
      // Harsh thresholding: if dark, make solid black. If light, make solid white.
      const threshold = 110; 
      const finalColor = grayscale < threshold ? 0 : 255;
      
      data[i] = finalColor;     // R
      data[i + 1] = finalColor; // G
      data[i + 2] = finalColor; // B
    }
    ctx.putImageData(imgData, 0, 0);

    const processedImageBase64 = canvas.toDataURL('image/jpeg');
    setOcrProgress(20);

    // --- 3. FREE LOCAL TESSERACT OCR RUN ---
    try {
      const result = await Tesseract.recognize(
        processedImageBase64,
        'eng',
        {
          logger: m => {
            if (m.status === 'recognizing text') {
              setOcrProgress(20 + Math.round(m.progress * 80));
            }
          }
        }
      );

      const rawText = result.data.text;
      console.log("Raw OCR Extracted Text:\n", rawText);

      // Run our smart text filtering logic
      const { detectedName, detectedPrice } = parseOcrTextSmartly(rawText);

      setProductName(detectedName || '');
      setPrice(detectedPrice || '');
      
      setAppState('teaching');
    } catch (error) {
      console.error("Local OCR Error:", error);
      alert("Failed to read text locally. Please enter the tag details manually.");
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
      
      // Upload compressed image to your validated 'product-images' bucket
      if (capturedImageBlob) {
        const fileName = `scan_${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('product-images')
          .upload(fileName, capturedImageBlob, { contentType: 'image/jpeg' });

        if (uploadError) throw uploadError;
        
        const { data: publicUrlData } = supabase.storage.from('product-images').getPublicUrl(fileName);
        imageUrl = publicUrlData.publicUrl;
      }

      // Save everything including coordinates into Supabase
      const { error: dbError } = await supabase
        .from('supermarket_items')
        .upsert([
          { 
            product_name: productName, 
            price: parseFloat(price), 
            category: category, 
            store_name: storeName,
            latitude: latitude,
            longitude: longitude,
            image_url: imageUrl
          },
        ], { onConflict: 'product_name' });

      if (dbError) throw dbError;

      setAppState('success');
      setProductName('');
      setPrice('');
      setCapturedImageBlob(null);
      setImagePreviewUrl('');
    } catch (error: any) {
      console.error(error);
      alert(`Database Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex flex-col h-[100dvh] w-full bg-slate-900 text-white overflow-hidden relative">
      <canvas ref={canvasRef} className="hidden" />

      {appState === 'scanning' && (
        <div className="relative w-full h-full flex flex-col">
          <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
          
          {/* Target Overlay Guidelines */}
          <div className="absolute inset-0 z-10 flex flex-col justify-between p-6 bg-black/20">
            <div className="flex flex-col items-center pt-6 gap-3">
              <div className={`px-4 py-1.5 rounded-full border flex items-center gap-2 text-xs font-bold shadow-lg backdrop-blur-md ${latitude ? 'bg-emerald-600/90 border-emerald-500' : 'bg-amber-600/90 border-amber-500'}`}>
                <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span> 
                {latitude ? `GPS Locked: ${latitude.toFixed(4)}, ${longitude?.toFixed(4)}` : 'Fixing GPS Coordinates...'}
              </div>
            </div>

            {/* Target Box: Keeps user focused on the center text row */}
            <div className="w-[90%] h-[35%] mx-auto border-2 border-dashed border-cyan-400 rounded-2xl flex items-center justify-center bg-black/10 backdrop-blur-[1px]">
              <span className="text-xs font-semibold tracking-wider text-cyan-300 uppercase bg-slate-950/80 px-3 py-1 rounded-md">Align Name & Price Inside</span>
            </div>

            <div className="pb-8">
              <button onClick={handleCaptureAndScan} className="w-20 h-20 mx-auto bg-white rounded-full flex items-center justify-center border-4 border-slate-300 shadow-xl active:scale-95 transition">
                <div className="w-16 h-16 bg-cyan-500 rounded-full"></div>
              </button>
            </div>
          </div>
        </div>
      )}

      {appState === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-950">
          <div className="w-16 h-16 border-4 border-t-cyan-400 border-r-transparent border-b-cyan-400 border-l-transparent rounded-full animate-spin mb-6"></div>
          <h2 className="text-xl font-bold mb-1">Processing locally...</h2>
          <p className="text-xs text-slate-400 mb-6">Applying high-contrast threshold matrix filters</p>
          <div className="w-64 bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div className="bg-cyan-400 h-full transition-all duration-200" style={{ width: `${ocrProgress}%` }}></div>
          </div>
          <span className="text-xs text-cyan-400 mt-2 font-mono">{ocrProgress}%</span>
        </div>
      )}

      {appState === 'teaching' && (
        <div className="flex-1 flex flex-col h-full bg-slate-900 overflow-y-auto pb-10">
          {imagePreviewUrl && (
            <div className="w-full h-44 bg-slate-950 relative border-b border-slate-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreviewUrl} alt="Captured tag" className="w-full h-full object-contain p-2" />
              <button onClick={() => setAppState('scanning')} className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/70 flex items-center justify-center text-white text-sm font-bold shadow-md">←</button>
            </div>
          )}

          <form onSubmit={handleSaveToDatabase} className="flex flex-col flex-1 px-6 pt-5 space-y-5">
            <div>
              <h2 className="text-lg font-bold text-white mb-4">Validate Scanned Data</h2>
              
              <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">Store Brand</label>
              <input type="text" required value={storeName} onChange={(e) => setStoreName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-400 mb-4" />
              
              <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">Item Name</label>
              <input type="text" required value={productName} onChange={(e) => setProductName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-400 mb-4" />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">Retail Price</label>
              <div className="relative">
                <span className="absolute left-4 top-3 text-slate-400 font-bold text-sm">₱</span>
                <input type="number" step="0.01" required value={price} onChange={(e) => setPrice(e.target.value)} className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl pl-8 pr-4 py-3 text-sm focus:outline-none focus:border-cyan-400" />
              </div>
            </div>

            <button type="submit" disabled={loading} className="w-full mt-auto py-3.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 rounded-xl font-bold text-sm text-white shadow-lg transition duration-150">
              {loading ? 'Uploading Data & Coordinates...' : 'Save to Supabase'}
            </button>
          </form>
        </div>
      )}

      {appState === 'success' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-950">
          <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full flex items-center justify-center text-2xl mb-4 animate-bounce">✓</div>
          <h3 className="text-xl font-bold text-white mb-1">Item Logged Successfully</h3>
          <p className="text-slate-400 text-xs max-w-xs mx-auto mb-10">Image sizes minimized, and active GPS coordinates saved to database columns.</p>
          <button onClick={() => setAppState('scanning')} className="w-full max-w-xs py-3.5 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold text-sm text-white transition">Scan Next Item</button>
        </div>
      )}
    </main>
  );
}