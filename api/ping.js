export default function handler(req, res) {
  const allow = "*";
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  if (req.method === "OPTIONS") return res.status(200).end();

  const hasKey = !!process.env.OPENAI_API_KEY;
  const hasSecret = !!process.env.SHARED_SECRET;
  res.status(200).json({ ok: true, hasKey, hasSecret });
}
