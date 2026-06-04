'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import Tesseract from 'tesseract.js';

// Initialize Supabase Client
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mjaeopdoclmwtaswjdvp.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qYWVvcGRvY2xtd3Rhc3dqZHZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NjQ5OTIsImV4cCI6MjA5NjE0MDk5Mn0.PHvm-rgPVMia-tn6ZQI2H8KsY3jroY6aZOyVJqHLK5E";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function SupermarketScanner() {
  const [appState, setAppState] = useState<'scanning' | 'processing' | 'teaching' | 'success'>('scanning');
  const [loading, setLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [productName, setProductName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('Grocery');
  const [location, setLocation] = useState('Locating...'); 
  const [capturedImageBlob, setCapturedImageBlob] = useState<Blob | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>('');

  // Start Camera - Forced to high resolution
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
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
          setLocation(`Lat: ${position.coords.latitude.toFixed(4)}, Lng: ${position.coords.longitude.toFixed(4)}`);
        },
        () => setLocation("Location access denied")
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

  // Capture and CROP image for better OCR
  const handleCaptureAndScan = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setAppState('processing');
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // CROP LOGIC: Only grab the center 60% of the image where the reticle is
    const cropWidth = video.videoWidth * 0.8;
    const cropHeight = video.videoHeight * 0.4;
    const cropX = (video.videoWidth - cropWidth) / 2;
    const cropY = (video.videoHeight - cropHeight) / 2;

    canvas.width = cropWidth;
    canvas.height = cropHeight;
    
    // Draw only the cropped area
    ctx.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    
    canvas.toBlob((blob) => {
      if (blob) {
        setCapturedImageBlob(blob);
        setImagePreviewUrl(URL.createObjectURL(blob));
      }
    }, 'image/jpeg', 0.9);

    const imageDataUrl = canvas.toDataURL('image/jpeg');

    try {
      const result = await Tesseract.recognize(
        imageDataUrl,
        'eng',
        {
          logger: m => {
            if (m.status === 'recognizing text') setOcrProgress(Math.round(m.progress * 100));
          }
        }
      );

      const scannedText = result.data.text;
      console.log("Raw OCR Text:", scannedText); // Check browser console to see what it actually read
      
      // Improved Regex: Looks for numbers with decimals, even without currency symbols
      // Matches: 105.00, ₱105, 1,200.50
      const priceRegex = /(?:₱|PHP|P)?\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i; 
      const priceMatch = scannedText.match(priceRegex);
      
      if (priceMatch && priceMatch[1]) {
        // Clean up common OCR mistakes (like 'S' instead of '5')
        const cleanedPrice = priceMatch[1].replace(/S/gi, '5').replace(/O/gi, '0');
        setPrice(cleanedPrice);
      }

      const lines = scannedText.split('\n').filter(line => line.trim().length > 3);
      if (lines.length > 0) {
        const nameCandidates = lines.filter(line => !priceRegex.test(line));
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
        const { error: uploadError } = await supabase.storage
          .from('product-images')
          .upload(fileName, capturedImageBlob, { contentType: 'image/jpeg' });

        if (uploadError) throw uploadError;
        const { data: publicUrlData } = supabase.storage.from('product-images').getPublicUrl(fileName);
        imageUrl = publicUrlData.publicUrl;
      }

      const { error: dbError } = await supabase
        .from('supermarket_items')
        .upsert([
          { 
            product_name: productName, 
            price: parseFloat(price), 
            category, 
            location,
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
      alert(`Error saving item: ${error.message}`);
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
          <div className="absolute inset-0 bg-black/40 z-10"></div>

          <div className="relative z-20 flex flex-col h-full justify-between p-6">
            <div className="flex justify-center pt-8">
              <div className="bg-cyan-500/80 backdrop-blur-md px-4 py-1.5 rounded-full border border-cyan-500 flex items-center gap-2 text-xs font-bold shadow-lg">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span> 
                {location !== 'Locating...' ? 'GPS Active' : 'Locating...'}
              </div>
            </div>

            {/* Clear center area to show the user exactly what is being cropped */}
            <div className="flex-1 flex items-center justify-center">
              <div className="w-[80%] h-[40%] shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] border-2 border-cyan-400 rounded-lg relative flex items-center justify-center bg-transparent backdrop-blur-none">
                <div className="text-white/70 text-xs font-bold uppercase tracking-widest text-center px-4">
                  Fill this box with the price tag
                </div>
              </div>
            </div>

            <div className="pb-8">
              <button onClick={handleCaptureAndScan} className="w-20 h-20 mx-auto bg-white rounded-full flex items-center justify-center border-4 border-slate-300 shadow-[0_0_20px_rgba(255,255,255,0.4)] active:scale-95 transition">
                <div className="w-16 h-16 bg-cyan-500 rounded-full"></div>
              </button>
            </div>
          </div>
        </div>
      )}

      {appState === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-20 h-20 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-6"></div>
          <h2 className="text-2xl font-bold mb-2">Analyzing Tag...</h2>
          <div className="w-full max-w-xs bg-slate-800 rounded-full h-2 mt-6">
            <div className="bg-cyan-500 h-2 rounded-full transition-all duration-300" style={{ width: `${ocrProgress}%` }}></div>
          </div>
        </div>
      )}

      {appState === 'teaching' && (
        <div className="flex-1 flex flex-col h-full bg-slate-900 overflow-y-auto pb-10">
          {imagePreviewUrl && (
            <div className="w-full h-48 bg-slate-800 relative">
               {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreviewUrl} alt="Captured tag" className="w-full h-full object-contain p-2" />
              <button onClick={() => setAppState('scanning')} className="absolute top-4 left-4 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white">←</button>
            </div>
          )}

          <form onSubmit={handleSaveToDatabase} className="flex flex-col flex-1 px-6 pt-4 space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white">Verify Details</h2>
            </div>

            <div>
              <label className="block text-xs uppercase font-bold text-slate-500 mb-2">Product Name (Unique)</label>
              <input type="text" required value={productName} onChange={(e) => setProductName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-cyan-400 transition" />
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs uppercase font-bold text-slate-500 mb-2">Price</label>
                <div className="relative">
                  <span className="absolute left-4 top-3 text-slate-500 font-bold">₱</span>
                  <input type="number" step="0.01" required value={price} onChange={(e) => setPrice(e.target.value)} className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl pl-8 pr-4 py-3 focus:outline-none focus:border-cyan-400 transition" />
                </div>
              </div>
            </div>

            <button type="submit" disabled={loading} className="w-full mt-auto py-4 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-bold text-white shadow-lg disabled:opacity-50">
              {loading ? 'Saving to Database...' : 'Upload & Save Data'}
            </button>
          </form>
        </div>
      )}

      {appState === 'success' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-24 h-24 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center text-4xl mb-6">✓</div>
          <h3 className="text-2xl font-bold text-white mb-2">Item Logged!</h3>
          <button onClick={() => setAppState('scanning')} className="w-full max-w-xs py-4 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold text-white mt-10">Scan Next Item</button>
        </div>
      )}
    </main>
  );
}