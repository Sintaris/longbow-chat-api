// File: api/chat.js
// Serverless endpoint for your Twine game on Vercel.

export default async function handler(req, res) {
  // --- CORS (allow file:// and localhost) ---
  const origins = (process.env.PUBLIC_CORS || "*").split(",").map(s => s.trim());
  const origin = req.headers.origin || "";
  const allowOrigin = origins.includes("*")
    ? "*"
    : (origin && origins.includes(origin) ? origin : (origins[0] || "*"));
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    // --- Optional auth via shared secret ---
    if (process.env.SHARED_SECRET) {
      const headerKey = req.headers["x-api-key"];
      if (headerKey !== process.env.SHARED_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    // 🔴 This is the line that *reads* your fields from the request body
    const {
      system,
      npc,
      player,
      scene,
      message,
      messageType,   // <- 'speech' | 'action'
      history        // <- [{who:'player'|'npc', type:'speech'|'action', text:string}, ...]
    } = req.body || {};

    if (!message || !npc || !npc.name) {
      return res.status(400).json({ error: "Missing message or npc" });
    }

    const model = process.env.MODEL || "gpt-4o-mini";
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY missing" });

    // --- Prompt building (includes actions + transcript) ---
    const sysPrimer = [
      system || "",
      "You are the NPC described below. Stay in grounded medieval English (c. 1194).",
      "Player may send actions (messageType='action'). React in-character to actions.",
      "Keep replies brief (1–4 sentences). Avoid modern slang.",
      "Return ONLY minified JSON with keys: reply (string), intent ('unlock_gate'|'give_item'|'advance_quest'|'none'), targets (string[])."
    ].filter(Boolean).join("\n");

    const historyText = Array.isArray(history)
      ? history.map(h => {
          const tag = h.who === "player"
            ? (h.type === "action" ? "PLAYER_ACTION" : "PLAYER")
            : "NPC";
          return `${tag}: ${h.text}`;
        }).join("\n")
      : "(none)";

    const userBlock =
      `NPC Persona:\n${npc.persona}\n\n` +
      `Recent Transcript (oldest→newest):\n${historyText}\n\n` +
      `Current Scene (JSON):\n${JSON.stringify({ scene, player }, null, 2)}\n\n` +
      `Incoming ${messageType === "action" ? "PLAYER_ACTION" : "PLAYER"}: ${message}\n\n` +
      `Respond as JSON ONLY with: { reply: string, intent: 'unlock_gate'|'give_item'|'advance_quest'|'none', targets?: string[] }`;

    const messages = [
      { role: "system", content: sysPrimer },
      { role: "user", content: userBlock }
    ];

    // --- Call OpenAI ---
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
      const detail = await r.text().catch(() => "");
      return res.status(502).json({ error: "LLM upstream error", detail });
    }

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || "{}";

    let parsed;
    try { parsed = JSON.parse(content); }
    catch { parsed = { reply: String(content).slice(0, 600), intent: "none", targets: []
