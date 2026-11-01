import type { Food, Nutrients } from '../../db/schema';

/** A food being checked before it's saved: a product, or a recipe from a web page. */
export interface Draft {
  name: string; brand?: string; barcode?: string; serving: string; servingQty?: number; servingUnit?: 'g' | 'mL';
  nutrients: Nutrients; per100?: Nutrients; source: Food['source'];
  /** A recipe (per serve), with how many it serves and its ingredient lines. */
  kind?: Food['kind']; recipe?: Food['recipe']; sourceUrl?: string;
}
