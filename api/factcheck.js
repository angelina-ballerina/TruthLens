export default async function handler(request, response) {

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const { text } = request.body;

  if (!text || text.length < 20) {
    return response.status(400).json({ error: 'Please provide some text to fact-check.' });
  }

  const prompt = `You are an expert fact-checker and journalist. A user has submitted the following text to be fact-checked:

--- BEGIN TEXT ---
${text}
--- END TEXT ---

Your job is to:
1. Identify the 3-5 most important factual claims in the text.
2. For each claim, assess whether it is: SUPPORTED (backed by evidence), DISPUTED (contradicted by evidence), or UNVERIFIED (cannot be confirmed).
3. Give an overall credibility score from 0 to 100 (100 = very likely true, 0 = very likely false). You MUST follow these rules strictly: 0-20 = completely false, 21-40 = mostly false, 41-59 = disputed or unverifiable, 60-79 = mostly true, 80-100 = completely true. The score MUST match your verdict. If you say "False" the score must be under 20
4. Provide 3-5 real, plausible sources relevant to the claims. Use real well-known publications (BBC, Reuters, AP News, Nature, etc.).
5. Give a short verdict label and a 1-2 sentence summary.

Respond ONLY with a valid JSON object in this exact format (no markdown, no code fences, no extra text):
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
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are an expert fact-checker. Always respond with valid JSON only — no markdown, no code fences, no extra text.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 1200,
      }),
    });

    const groqData = await groqResponse.json();

    if (!groqResponse.ok) {
      console.error('Groq API error:', JSON.stringify(groqData));
      return response.status(500).json({ error: 'AI service error. Please try again.' });
    }

    const rawText = groqData?.choices?.[0]?.message?.content || '';
    if (!rawText) throw new Error('Empty response from Groq');

    const cleaned = rawText.replace(/```json|```/gi, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Groq response');

    const result = JSON.parse(jsonMatch[0]);

    // Force the score to match the verdict if they contradict each other
    const verdict = (result.verdict || '').toLowerCase();
    if (verdict.includes('false') || verdict.includes('fake') || verdict.includes('incorrect')) {
      result.score = Math.min(result.score, 20);
    } else if (verdict.includes('misleading') || verdict.includes('disputed') || verdict.includes('partly')) {
      result.score = Math.min(result.score, 45);
      result.score = Math.max(result.score, 25);
    } else if (verdict.includes('true') || verdict.includes('accurate') || verdict.includes('correct')) {
      result.score = Math.max(result.score, 65);
    }

    return response.status(200).json(result);

  } catch (error) {
    console.error('Fact-check error:', error);
    return response.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
