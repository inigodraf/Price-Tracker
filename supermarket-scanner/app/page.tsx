'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import Tesseract from 'tesseract.js';

// Initialize Supabase Client
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://your-project-id.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "your-anon-key";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function SupermarketScanner() {
  // Application states
  const [appState, setAppState] = useState<'scanning' | 'processing' | 'teaching' | 'success'>('scanning');
  const [loading, setLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  
  // Hardware refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Form States
  const [productName, setProductName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('Grocery');
  const [location, setLocation] = useState('Locating...'); 
  const [capturedImageBlob, setCapturedImageBlob] = useState<Blob | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>('');

  // Start Camera
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' } // Forces the back camera on mobile
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("Could not access the camera. Please check your browser permissions.");
    }
  }, []);

  // Stop Camera
  const stopCamera = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
  }, []);

  // Get Location
  const fetchLocation = useCallback(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation(`Lat: ${position.coords.latitude.toFixed(4)}, Lng: ${position.coords.longitude.toFixed(4)}`);
        },
        (error) => {
          console.warn("Location error:", error.message);
          setLocation("Location access denied");
        }
      );
    }
  }, []);

  // Initialize on mount
  useEffect(() => {
    if (appState === 'scanning') {
      startCamera();
      fetchLocation();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [appState, startCamera, stopCamera, fetchLocation]);

  // Capture Image & Process OCR
  const handleCaptureAndScan = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setAppState('processing');
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Draw current video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert to Blob for upload
    canvas.toBlob((blob) => {
      if (blob) {
        setCapturedImageBlob(blob);
        setImagePreviewUrl(URL.createObjectURL(blob));
      }
    }, 'image/jpeg', 0.8);

    const imageDataUrl = canvas.toDataURL('image/jpeg');

    try {
      // Run Tesseract OCR
      const result = await Tesseract.recognize(
        imageDataUrl,
        'eng',
        {
          logger: m => {
            if (m.status === 'recognizing text') {
              setOcrProgress(Math.round(m.progress * 100));
            }
          }
        }
      );

      const scannedText = result.data.text;
      
      // Smart parsing based on the image format
      // Look for a price format: optional ₱/PHP/P, followed by numbers and decimals
      const priceRegex = /(?:₱|PHP|P)?\s?(\d+\.\d{2})/i; 
      const priceMatch = scannedText.match(priceRegex);
      
      if (priceMatch && priceMatch[1]) {
        setPrice(priceMatch[1]);
      }

      // Very basic text cleanup for product name (grab the first long line)
      const lines = scannedText.split('\n').filter(line => line.trim().length > 5);
      if (lines.length > 0) {
        // Exclude the line if it looks like a price or barcode
        const nameCandidates = lines.filter(line => !priceRegex.test(line) && !/^\d{8,}$/.test(line.replace(/\s/g, '')));
        if (nameCandidates.length > 0) {
           setProductName(nameCandidates[0].trim());
        }
      }

      setAppState('teaching');
    } catch (error) {
      console.error("OCR Error:", error);
      alert("Failed to read text. Please enter manually.");
      setAppState('teaching');
    }
  };

  // Upload Photo & Save to DB
  const handleSaveToDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName || !price) {
      alert("Please fill in the product name and price");
      return;
    }

    setLoading(true);

    try {
      let imageUrl = null;

      // 1. Upload Image to Supabase Storage
      if (capturedImageBlob) {
        const fileName = `scan_${Date.now()}.jpg`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('product-images')
          .upload(fileName, capturedImageBlob, { contentType: 'image/jpeg' });

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: publicUrlData } = supabase.storage
          .from('product-images')
          .getPublicUrl(fileName);
          
        imageUrl = publicUrlData.publicUrl;
      }

      // 2. Upsert Database Record (Overwrites if product_name exists)
      const { error: dbError } = await supabase
        .from('supermarket_items')
        .upsert([
          { 
            product_name: productName, // Must be marked as UNIQUE in Supabase
            price: parseFloat(price), 
            category, 
            location,
            image_url: imageUrl
          },
        ], { onConflict: 'product_name' }); // Specify the column to check for duplicates

      if (dbError) throw dbError;

      setAppState('success');
      setProductName('');
      setPrice('');
      setCapturedImageBlob(null);
      setImagePreviewUrl('');
    } catch (error: any) {
      alert(`Error saving item: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    // Mobile-first full screen container
    <main className="flex flex-col h-screen w-full bg-slate-900 text-white overflow-hidden relative">
      
      {/* Hidden Canvas for processing the image */}
      <canvas ref={canvasRef} className="hidden" />

      {/* STATE 1: SCANNING MODE */}
      {appState === 'scanning' && (
        <div className="relative w-full h-full flex flex-col">
          {/* Camera Feed */}
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            className="absolute inset-0 w-full h-full object-cover"
          />
          
          <div className="absolute inset-0 bg-black/20 z-10"></div>

          {/* UI Overlay */}
          <div className="relative z-20 flex flex-col h-full justify-between p-6">
            <div className="flex justify-between items-center pt-8">
              <div className="bg-cyan-500/80 backdrop-blur-md px-4 py-1.5 rounded-full border border-cyan-500 flex items-center gap-2 text-xs font-bold text-white shadow-lg">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span> {location !== 'Locating...' ? 'GPS Active' : 'Locating...'}
              </div>
            </div>

            {/* Reticle / Target Scanner */}
            <div className="flex-1 flex items-center justify-center">
              <div className="w-64 h-32 border-2 border-white/50 rounded-lg relative">
                <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-cyan-400"></div>
                <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-cyan-400"></div>
                <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-cyan-400"></div>
                <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-cyan-400"></div>
                <div className="absolute inset-0 flex items-center justify-center text-white/50 text-xs font-bold uppercase tracking-widest">
                  Align Price Tag
                </div>
              </div>
            </div>

            <div className="pb-8">
              <button 
                onClick={handleCaptureAndScan}
                className="w-20 h-20 mx-auto bg-white rounded-full flex items-center justify-center border-4 border-slate-300 shadow-[0_0_20px_rgba(255,255,255,0.4)] active:scale-95 transition"
              >
                <div className="w-16 h-16 bg-cyan-500 rounded-full"></div>
              </button>
              <p className="text-center text-xs mt-4 font-medium text-white/80">Tap to capture and extract text</p>
            </div>
          </div>
        </div>
      )}

      {/* STATE 2: OCR PROCESSING */}
      {appState === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-20 h-20 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-6"></div>
          <h2 className="text-2xl font-bold mb-2">Analyzing Image...</h2>
          <p className="text-slate-400">Extracting product name and price tags</p>
          <div className="w-full max-w-xs bg-slate-800 rounded-full h-2 mt-6">
            <div className="bg-cyan-500 h-2 rounded-full transition-all duration-300" style={{ width: `${ocrProgress}%` }}></div>
          </div>
        </div>
      )}

      {/* STATE 3: TEACHING / CONFIRMING DATA */}
      {appState === 'teaching' && (
        <div className="flex-1 flex flex-col h-full bg-slate-900 overflow-y-auto pb-10">
          {imagePreviewUrl && (
            <div className="w-full h-48 bg-slate-800 relative">
               {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreviewUrl} alt="Captured tag" className="w-full h-full object-cover opacity-60" />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900 to-transparent"></div>
              <button 
                onClick={() => setAppState('scanning')}
                className="absolute top-6 left-4 w-10 h-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center text-white"
              >
                ←
              </button>
            </div>
          )}

          <form onSubmit={handleSaveToDatabase} className="flex flex-col flex-1 px-6 pt-4 space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white">Verify Details</h2>
              <p className="text-xs text-slate-400 mt-1">Review OCR results. Save will update existing items.</p>
            </div>

            <div>
              <label className="block text-xs uppercase font-bold text-slate-500 tracking-wider mb-2">Product Name (Unique)</label>
              <input 
                type="text" 
                required
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-cyan-400 transition"
              />
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs uppercase font-bold text-slate-500 tracking-wider mb-2">Price</label>
                <div className="relative">
                  <span className="absolute left-4 top-3 text-slate-500 font-bold">₱</span>
                  <input 
                    type="number" 
                    step="0.01"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl pl-8 pr-4 py-3 focus:outline-none focus:border-cyan-400 transition"
                  />
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-xs uppercase font-bold text-slate-500 tracking-wider mb-2">Category</label>
                <select 
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-3 focus:outline-none focus:border-cyan-400 transition"
                >
                  <option value="Grocery">Grocery</option>
                  <option value="Household">Household</option>
                  <option value="Produce">Produce</option>
                </select>
              </div>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 flex items-center gap-3">
              <div className="truncate flex-1">
                <p className="text-[10px] uppercase font-bold text-cyan-500 tracking-wider mb-1">Detected Location</p>
                <p className="text-sm font-semibold text-slate-300">{location}</p>
              </div>
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className="w-full mt-auto py-4 bg-cyan-600 hover:bg-cyan-500 active:scale-95 transition rounded-xl font-bold text-white shadow-lg shadow-cyan-900 disabled:opacity-50"
            >
              {loading ? 'Saving to Database...' : 'Upload & Save Data'}
            </button>
          </form>
        </div>
      )}

      {/* STATE 4: SUCCESS */}
      {appState === 'success' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-24 h-24 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center text-4xl mb-6">
            ✓
          </div>
          <h3 className="text-2xl font-bold text-white mb-2">Item Logged!</h3>
          <p className="text-slate-400 max-w-xs mx-auto mb-10">
            Database updated successfully with image and location data.
          </p>
          <button 
            onClick={() => setAppState('scanning')}
            className="w-full max-w-xs py-4 bg-slate-800 hover:bg-slate-700 transition rounded-xl font-bold text-white"
          >
            Scan Next Item
          </button>
        </div>
      )}
    </main>
  );
}