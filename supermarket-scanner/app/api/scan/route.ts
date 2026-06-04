import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { image } = await request.json(); // base64 image data
    if (!image) {
      return NextResponse.json({ error: 'No image data provided' }, { status: 400 });
    }

    // Clean up the base64 string
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    // Prepare the payload for an AI Vision API (e.g., Gemini API / OpenAI API)
    // Using an AI model allows us to request structural JSON back from messy text environments
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "You are a supermarket price tag reading assistant. Analyze this retail shelf tag image. Extract the primary product description/name text and the numerical retail price. Return the data strictly as a valid JSON object matching this schema: {\"product_name\": \"string\", \"price\": 0.00}. Do not include markdown block formatting, wrap-around code tags, or text outside the JSON object." },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Data
              }
            }
          ]
        }]
      })
    });

    const result = await response.json();
    const outputText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";
    
    // Parse response cleanly
    const parsedData = JSON.parse(outputText.replace(/```json|```/g, ""));
    return NextResponse.json(parsedData);

  } catch (error: any) {
    console.error("Vision Processing Error:", error);
    return NextResponse.json({ error: 'Failed to process shelf tag image accurately' }, { status: 500 });
  }
}