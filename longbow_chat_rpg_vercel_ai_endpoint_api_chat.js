// File: api/chat.js
// Minimal plug‑and‑play serverless endpoint for your Twine game.
// Deploy on Vercel (or any Node serverless) and paste the live URL into
// setup.chatEndpoint in your Twine file.

// --- Configuration via environment variables ---
// Required: OPENAI_API_KEY
// Optional: MODEL (default: "gpt-4o-mini"),
//          PUBLIC_CORS (comma-separated origins; default "*")
//          SHARED_SECRET (if you want your game to send X-API-Key and check here)

export default async function handler(req, res) {
  // CORS (browser fetch from file/itch/etc.)
  const origins = (process.env.PUBLIC_CORS || "*").split(",").map(s => s.trim());
  const origin = req.headers.origin || "*";
  const allowOrigin = origins.includes("*") || origins.includes(origin) ? origin : origins[0] || "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    if (process.env.SHARED_SECRET) {
      const headerKey = req.headers["x-api-key"]; // Twine can send this
      if (headerKey !== process.env.SHARED_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const body = req.body || {};
    const { system, npc, player, scene, message } = body;

    if (!message || !npc || !npc.name) {
      return res.status(400).json({ error: "Missing message or npc" });
    }

    const model = process.env.MODEL || "gpt-4o-mini";

    const sysPrimer = [
      (system || ""),
      "You are the NPC described below. Always reply in grounded medieval English (c. 1194).",
      "Keep replies brief (1–4 sentences). Avoid modern slang. Be helpful but stay in character.",
      "When asked for out-of-scope facts, deflect with plausible period knowledge.",
      "Return ONLY valid minified JSON with keys: reply (string), intent (unlock_gate|give_item|advance_quest|none), targets (array of strings)."
    ].filter(Boolean).join("\n");

    const userPayload = {
      npc,
      player,
      scene,
      message
    };

    const messages = [
      { role: "system", content: sysPrimer },
      { role: "user", content: `NPC Persona:\n${npc.persona}\n\nCurrent Scene (JSON):\n${JSON.stringify({ scene, player }, null, 2)}\n\nPlayer says: ${message}\n\nRespond as JSON ONLY with this TypeScript type:\n{ reply: string; intent: 'unlock_gate'|'give_item'|'advance_quest'|'none'; targets?: string[] }` }
    ];

    // Call OpenAI (compatible) Chat Completions
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY missing" });

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        messages,
        response_format: { type: "json_object" }
      })
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(502).json({ error: "LLM upstream error", detail: text });
    }

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      // Fallback: wrap raw text
      parsed = { reply: String(content).slice(0, 600), intent: "none", targets: [] };
    }

    // Normalize
    const reply = typeof parsed.reply === "string" ? parsed.reply : "(nods in silence)";
    const intent = ["unlock_gate", "give_item", "advance_quest", "none"].includes(parsed.intent) ? parsed.intent : "none";
    const targets = Array.isArray(parsed.targets) ? parsed.targets.map(String) : [];

    return res.status(200).json({ reply, intent, targets });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
