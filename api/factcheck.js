/* ============================================================
   api/factcheck.js — Secure backend API route

   WHY THIS FILE EXISTS:
   Your API key must NEVER be in your frontend code (index.html
   or app.js), because anyone visiting your site could view the
   source and steal it.

   Instead, the frontend calls THIS file at /api/factcheck.
   This runs on Vercel's servers, where your API key is stored
   safely as an "environment variable" — not in your code.

   HOW VERCEL RUNS THIS:
   Vercel automatically turns any file inside /api into a
   serverless function. When someone calls POST /api/factcheck,
   Vercel runs this file and returns the response.

   FLOW:
   Browser → POST /api/factcheck → this file → Google Gemini API
                                                      ↓
   Browser ← JSON result         ← this file ←───────┘

   WHICH AI ARE WE USING?
   Google Gemini 2.0 Flash — genuinely free up to 1,500 requests
   per day, which is plenty for a personal passion project.
   Get a free key at: https://aistudio.google.com/apikey
   ============================================================ */

export default async function handler(request, response) {

  // Only allow POST requests
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const { text } = request.body;

  if (!text || text.length < 20) {
    return response.status(400).json({ error: 'Please provide some text to fact-check.' });
  }

  // ── Build the prompt ─────────────────────────────────────────
  // This is the instruction we send to Gemini explaining exactly
  // what we want it to do and what format to reply in.
  const prompt = `You are an expert fact-checker and journalist. A user has submitted the following text to be fact-checked:

--- BEGIN TEXT ---
${text}
--- END TEXT ---

Your job is to:
1. Identify the 3-5 most important factual claims in the text.
2. For each claim, assess whether it is: SUPPORTED (backed by evidence), DISPUTED (contradicted by evidence), or UNVERIFIED (cannot be confirmed).
3. Give an overall credibility score from 0 to 100 (100 = very likely true, 0 = very likely false).
4. Provide 3-5 real, plausible sources that are relevant to the claims. Use real, well-known publications (BBC, Reuters, AP News, Nature, etc.).
5. Give a short verdict label and a 1-2 sentence summary.

Respond ONLY with a valid JSON object in this exact format (no markdown, no extra text, no code fences):
{
  "score": 72,
  "verdict": "Mostly True",
  "summary": "The core claims are supported by scientific evidence, though some details may be overstated.",
  "claims": [
    { "text": "Claim extracted from the text", "status": "supported" },
    { "text": "Another claim", "status": "disputed" },
    { "text": "Another claim", "status": "unverified" }
  ],
  "sources": [
    {
      "title": "Publication Name: Article Headline",
      "description": "Brief description of what this source says and how it relates to the claim.",
      "tags": ["Science", "Health", "Peer-reviewed"]
    }
  ]
}`;

  try {
    // ── Call the Google Gemini API ────────────────────────────
    // process.env.GEMINI_API_KEY reads from Vercel's environment
    // variables — set this in your Vercel dashboard (see README).
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            // Tell Gemini we expect JSON back — improves reliability
            responseMimeType: 'application/json',
            temperature: 0.2,   // lower = more factual, less creative
            maxOutputTokens: 1200,
          },
        }),
      }
    );

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error('Gemini API error:', geminiData);
      return response.status(500).json({ error: 'AI service error. Please try again.' });
    }

    // ── Extract Gemini's reply ────────────────────────────────
    // Gemini wraps its response in: candidates[0].content.parts[0].text
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!rawText) {
      throw new Error('Empty response from Gemini');
    }

    // Strip markdown code fences just in case (``` json ... ```)
    const cleaned = rawText.replace(/```json|```/gi, '').trim();

    // Find the JSON object in the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Gemini response');

    const result = JSON.parse(jsonMatch[0]);

    // Send the result back to the browser
    return response.status(200).json(result);

  } catch (error) {
    console.error('Fact-check error:', error);
    return response.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
