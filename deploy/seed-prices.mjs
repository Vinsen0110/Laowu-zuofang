// Loads the agreed selling prices into the price table (safe to re-run).
//   sudo -u laowu bash -c 'set -a; . /etc/laowu/laowu.env; node deploy/seed-prices.mjs'
import { priceCatalog } from "../account/catalog.js";
import { savePrices } from "../account/channels.js";
import { getDatabase } from "../account/db.js";

const R = (a, b, c) => ({ "1k": a, "2k": b, "4k": c });
const all = (v) => R(v, v, v);
const plan = {
    tudou: {
        "Nano Banana 2.1": R(0.2, 0.2, 0.25), "Nano Banana Pro": R(0.3, 0.3, 0.45),
        "GPT Image 2 · low": R(0.08, 0.1, 0.15), "GPT Image 2 · medium": R(0.1, 0.15, 0.2), "GPT Image 2 · high": R(0.15, 0.2, 0.25),
        "文本 · Gemini 3.8 Flash": 0.02,
    },
    apimart: { "Nano Banana 2.1": R(0.2, 0.2, 0.25), "Nano Banana Pro": R(0.3, 0.3, 0.45), "文本 · Gemini 3.8 Flash": 0.02 },
    grsai: { "Nano Banana 2.1": all(0.25), "Nano Banana Pro": all(0.35), "GPT Image 2 VIP": 0.4 },
    runninghub: { "Nano Banana Pro": R(0.7, 0.7, 0.8), "文本 · Gemini 3.8 Flash": 0.02 },
};
// GPT Image 2.6 (土豆 and Mart) has no seeded price yet: set it in the admin price table.

const items = [];
for (const r of priceCatalog()) {
    const p = plan[r.channel]?.[r.label];
    const price = typeof p === "number" ? p : p?.[r.spec.split("/")[0]];
    if (price == null) continue;
    items.push({ channel: r.channel, model: r.model, spec: r.spec, price: String(price), cost: r.costText, note: r.label });
}
const db = await getDatabase();
const saved = await savePrices(db, items);
console.log(`prices saved: ${items.length} (table now has ${saved.length})`);
await db.close();
