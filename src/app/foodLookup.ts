// Look a barcode up in Open Food Facts (a free, open database of packaged food). Only the barcode number is sent, and
// only when you scan; the result is saved on the phone, so the same product is offline next time.
import { fromOpenFoodFacts, type OffProduct, type ProductData } from '../logic/nutrition';

const FIELDS = 'product_name,product_name_en,generic_name,brands,serving_size,serving_quantity,serving_quantity_unit,quantity,nutriments';

export type Lookup = { ok: true; product: ProductData } | { ok: false; reason: 'not-found' | 'offline' };

export async function lookUpBarcode(code: string): Promise<Lookup> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`, { signal: ctl.signal });
    if (r.status === 404) return { ok: false, reason: 'not-found' };
    if (!r.ok) return { ok: false, reason: 'offline' };
    const j = (await r.json()) as { status?: number; product?: OffProduct };
    if (j.status !== 1 || !j.product) return { ok: false, reason: 'not-found' };
    return { ok: true, product: fromOpenFoodFacts(j.product) };
  } catch {
    return { ok: false, reason: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}
