import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Compteur du Quartier : nombre de foyers confirmés pour la prochaine tournée de chaque zone.
// GET  /api/compteur            -> public, renvoie { A, B, C, updatedAt }
// POST /api/compteur            -> admin : { pin, zone: "A"|"B"|"C", delta: 1|-1 }  ou  { pin, zone, set: 0..3 }
// Le code PIN est stocké dans la variable d'environnement BF_ADMIN_PIN (jamais dans le code).

const ZONES = ["A", "B", "C"] as const;
const MAX = 3;
const KEY = "compteur";

type Counts = { A: number; B: number; C: number; updatedAt: string | null };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function read(): Promise<Counts> {
  const store = getStore("blackfriday");
  const data = (await store.get(KEY, { type: "json" })) as Partial<Counts> | null;
  return {
    A: clamp(data?.A ?? 0),
    B: clamp(data?.B ?? 0),
    C: clamp(data?.C ?? 0),
    updatedAt: data?.updatedAt ?? null,
  };
}

function clamp(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(MAX, v));
}

export default async (req: Request, _context: Context) => {
  if (req.method === "GET") {
    return json(await read());
  }

  if (req.method === "POST") {
    const expected = Netlify.env.get("BF_ADMIN_PIN");
    if (!expected) return json({ error: "Code admin non configuré sur le serveur." }, 500);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Requête invalide." }, 400);
    }

    if (String(body?.pin ?? "") !== expected) {
      return json({ error: "Code incorrect." }, 401);
    }
    if (!ZONES.includes(body?.zone)) {
      return json({ error: "Zone inconnue." }, 400);
    }

    const counts = await read();
    const zone = body.zone as (typeof ZONES)[number];
    if (typeof body.set === "number") counts[zone] = clamp(body.set);
    else if (body.delta === 1 || body.delta === -1) counts[zone] = clamp(counts[zone] + body.delta);
    else return json({ error: "Action inconnue." }, 400);

    counts.updatedAt = new Date().toISOString();
    await getStore("blackfriday").setJSON(KEY, counts);
    return json(counts);
  }

  return json({ error: "Méthode non autorisée." }, 405);
};

export const config: Config = {
  path: "/api/compteur",
  method: ["GET", "POST"],
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
