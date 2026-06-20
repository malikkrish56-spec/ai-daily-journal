import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(request) {
  try {
    const { scope, entries, language, history, userMessage } = await request.json();

    if (!entries || entries.length === 0) {
      return new Response(JSON.stringify({ error: "No entry text provided." }), { status: 400 });
    }

    const combinedJournalText = entries
      .map(e => `Date: ${e.date}\nEntry: ${e.text}`)
      .join('\n\n---\n\n');

    let languageInstruction = "Respond entirely in plain English.";
    if (language === 'hi') {
      languageInstruction = "Respond entirely in formal Hindi (Devanagari script).";
    } else if (language === 'hinglish') {
      languageInstruction = "Respond entirely in casual Hinglish using Roman script (e.g., 'aaj', 'kal', 'feeling', 'tension mat lo'). No Devanagari script. Natural tone, like a close friend.";
    }

    const baseTone = `You're texting back as the one friend who actually has their life somewhat figured out — older-sibling energy, a bit of "level up" framing (treat rough patches like a stage you grind through, not a wound to sit with), but never cringe or gamer-speak overload, just one light touch of it max.

HARD RULES — DO NOT:
- Do NOT ask reflective questions back ("is it more like X or Y?", "what does that feel like?"). You are not a therapist running an intake session. If you're curious about something, just say what YOU think it probably is, stated as a guess, not a question.
- Do NOT mirror their words back at them in a soft, validating way ("that really hits", "that sounds disorienting"). Skip the validation lap entirely — go straight to the actual point.
- Do NOT end with an open invitation like "I'm here if you want to talk more" — that's filler, not a real reply.
- Do NOT leave them with just a read on the situation and nothing to act on — vibes alone aren't enough.

DO:
- Always give at least one concrete, doable "try this" move — something specific they could actually do today or right now, not vague encouragement. Make it small and realistic, tied to what they actually wrote.
- Say something a sharp, experienced friend would actually say: a read on what's going on, a blunt but kind observation, AND a next move. Real opinions, not open-ended exploration.
- Use contractions. Talk like a text message, not an essay.
- Be specific to what they actually wrote — reference real details, not generic moods.
- Simple, everyday words.`;

    let scopeContext = '';
    if (scope === 'today') {
      scopeContext = "You're looking at their journal entry from today.";
    } else if (scope === 'weekly') {
      scopeContext = "You're looking at their journal entries from the past 7 days — look for real patterns.";
    } else if (scope === 'monthly') {
      scopeContext = "You're looking at their journal entries from the past month — look for the bigger picture and what keeps repeating.";
    }

    let finalPrompt;

    if (!history || history.length === 0) {
      const formatInstruction = `
FORMAT RULES:
- Around 5 short points (can be a bit more or less), each on its own new line.
- Each point is ONE short, casual sentence. No headers, no bold labels.
- At least one of the points must be a concrete "try this" action, not just an observation.
- No long intro or wrap-up paragraph. Just the points, maybe one short line at the very start max.
`;
      finalPrompt = `
        ${baseTone}
        ${scopeContext}
        ${formatInstruction}
        Language: ${languageInstruction}

        Here is the user's journal data:
        ${combinedJournalText}
      `;
    } else {
      const historyText = history
        .map(h => `${h.role === 'user' ? 'User' : 'You'}: ${h.text}`)
        .join('\n');

      finalPrompt = `
        ${baseTone}
        ${scopeContext}
        Language: ${languageInstruction}

        Here is the user's journal data (for context):
        ${combinedJournalText}

        Here is the conversation so far:
        ${historyText}

        The user just replied: "${userMessage}"

        Reply naturally, like you're continuing a real text conversation. Keep it short — a few sentences max, no bullet list needed unless it genuinely helps. Stay specific to what they're saying. Remember the hard rules above — no reflective questions, no soft mirroring, no "I'm here for you" filler, and give them something concrete to do if it fits.
      `;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: finalPrompt,
    });

    const adviceText = response.text;

    return new Response(JSON.stringify({ advice: adviceText }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Gemini API Error:", error);
    return new Response(JSON.stringify({ error: "Failed to generate advice. Please try again later." }), { status: 500 });
  }
}