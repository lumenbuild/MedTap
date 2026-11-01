// Common foods and home-cooked dishes, measured in things you can see (a usual plate, a palm, a cup, a slice), so a
// meal can be logged without knowing its weight or its numbers. Typical values for a usual serving, from Australian
// and US food composition tables, rounded: estimates, close enough to see the pattern over a week (and the calorie
// target corrects itself from weigh-ins). Pure.
import type { Nutrients } from '../db/schema';

export type CommonGroup = 'Meals' | 'Takeaway' | 'Breakfast' | 'Protein' | 'Carbs' | 'Veg and fruit' | 'Dairy' | 'Fats and sauces' | 'Snacks' | 'Drinks';
export const COMMON_GROUPS: CommonGroup[] = ['Meals', 'Takeaway', 'Breakfast', 'Protein', 'Carbs', 'Veg and fruit', 'Dairy', 'Fats and sauces', 'Snacks', 'Drinks'];

export interface CommonFood {
  id: string; name: string; group: CommonGroup;
  /** Other words people use for it. */
  also?: string;
  /** One serving, in words: "a usual plate (about 450 g)", "1 palm (about 120 g cooked)". */
  serving: string;
  /** A plate or bowl: sized smaller / usual / bigger. Otherwise counted (1, 2, half). */
  plate?: boolean;
  n: Nutrients;
}

// kcal, protein, carbs, fat, fibre (g), sodium (mg); caffeine (mg) where it has some.
const f = (id: string, name: string, group: CommonGroup, serving: string, [kcal, protein, carbs, fat, fibre, sodium]: number[], o: { also?: string; plate?: boolean; caffeine?: number } = {}): CommonFood =>
  ({ id, name, group, serving, plate: o.plate, also: o.also, n: { kcal, protein, carbs, fat, fibre, sodium, ...(o.caffeine ? { caffeine: o.caffeine } : {}) } });
const P = 'a usual plate', B = 'a usual bowl';

export const COMMON_FOODS: CommonFood[] = [
  // ── Meals (home-cooked) ──
  f('spag-bol', 'Spaghetti bolognese', 'Meals', `${P} (about 450 g)`, [600, 32, 70, 20, 7, 900], { plate: true, also: 'spag bol pasta mince meat sauce' }),
  f('lasagne', 'Lasagne', 'Meals', 'a usual piece (about 300 g)', [520, 30, 40, 26, 4, 900], { plate: true }),
  f('chicken-stirfry-rice', 'Chicken stir fry with rice', 'Meals', `${P} (about 450 g)`, [600, 38, 75, 15, 5, 1200], { plate: true, also: 'stirfry asian' }),
  f('beef-stirfry-noodles', 'Beef stir fry with noodles', 'Meals', `${P} (about 450 g)`, [650, 35, 75, 22, 5, 1400], { plate: true, also: 'stirfry asian' }),
  f('chicken-curry-rice', 'Chicken curry with rice', 'Meals', `${P} (about 500 g)`, [700, 38, 80, 24, 5, 1100], { plate: true, also: 'indian thai green red' }),
  f('butter-chicken', 'Butter chicken with rice', 'Meals', `${P} (about 500 g)`, [800, 38, 80, 35, 4, 1200], { plate: true, also: 'indian creamy curry' }),
  f('beef-curry-rice', 'Beef curry with rice', 'Meals', `${P} (about 500 g)`, [720, 36, 80, 27, 5, 1100], { plate: true, also: 'massaman rendang' }),
  f('fried-rice', 'Fried rice', 'Meals', `${P} (about 400 g)`, [650, 20, 85, 24, 3, 1500], { plate: true }),
  f('roast-chicken-veg', 'Roast chicken and vegetables', 'Meals', `${P}`, [550, 45, 35, 24, 7, 700], { plate: true, also: 'roast dinner' }),
  f('roast-lamb-veg', 'Roast lamb and vegetables', 'Meals', `${P}`, [650, 42, 35, 36, 6, 600], { plate: true, also: 'roast dinner' }),
  f('roast-beef-veg', 'Roast beef and vegetables', 'Meals', `${P}`, [600, 45, 35, 28, 6, 650], { plate: true, also: 'roast dinner' }),
  f('steak-chips', 'Steak and chips', 'Meals', `${P}`, [850, 50, 60, 45, 5, 700], { plate: true, also: 'fries' }),
  f('steak-salad', 'Steak and salad', 'Meals', `${P}`, [500, 50, 8, 28, 4, 500], { plate: true }),
  f('steak-veg', 'Steak and vegetables', 'Meals', `${P}`, [550, 50, 25, 26, 7, 500], { plate: true, also: 'mash' }),
  f('chicken-salad', 'Grilled chicken salad', 'Meals', `${B}`, [400, 40, 12, 20, 5, 700], { plate: true }),
  f('schnitzel', 'Chicken schnitzel, chips and salad', 'Meals', `${P}`, [950, 50, 80, 45, 6, 1300], { plate: true, also: 'parmi parmigiana' }),
  f('parmi', 'Chicken parmigiana, chips and salad', 'Meals', `${P}`, [1150, 60, 85, 60, 6, 1900], { plate: true, also: 'parma pub' }),
  f('fish-veg', 'Grilled fish and vegetables', 'Meals', `${P}`, [400, 40, 25, 14, 6, 500], { plate: true }),
  f('salmon-rice-veg', 'Salmon with rice and vegetables', 'Meals', `${P}`, [600, 38, 50, 26, 5, 500], { plate: true }),
  f('chilli', 'Chilli con carne with rice', 'Meals', `${P}`, [650, 35, 75, 20, 12, 1000], { plate: true, also: 'beans mince' }),
  f('cottage-pie', "Shepherd's or cottage pie", 'Meals', `${P} (about 400 g)`, [520, 30, 40, 26, 6, 900], { plate: true, also: 'mince mash' }),
  f('sausages-mash', 'Sausages and mash', 'Meals', `${P} (2 sausages)`, [700, 25, 45, 45, 5, 1500], { plate: true, also: 'bangers' }),
  f('carbonara', 'Pasta carbonara', 'Meals', `${P}`, [800, 32, 80, 38, 4, 1300], { plate: true, also: 'creamy bacon' }),
  f('pasta-tomato', 'Pasta with tomato sauce', 'Meals', `${P}`, [500, 16, 85, 10, 7, 700], { plate: true, also: 'napolitana arrabbiata vegetarian' }),
  f('creamy-chicken-pasta', 'Creamy chicken pasta', 'Meals', `${P}`, [750, 40, 75, 30, 4, 1000], { plate: true, also: 'alfredo' }),
  f('mac-cheese', 'Macaroni cheese', 'Meals', `${P}`, [650, 25, 70, 30, 3, 1100], { plate: true }),
  f('risotto', 'Risotto', 'Meals', `${P}`, [600, 18, 80, 22, 3, 1100], { plate: true, also: 'mushroom chicken' }),
  f('veg-soup', 'Vegetable soup', 'Meals', `${B}`, [200, 6, 30, 6, 6, 900], { plate: true, also: 'minestrone' }),
  f('pumpkin-soup', 'Pumpkin soup', 'Meals', `${B}`, [250, 6, 30, 12, 5, 800], { plate: true }),
  f('chicken-soup', 'Chicken soup', 'Meals', `${B}`, [250, 20, 20, 8, 3, 1000], { plate: true, also: 'noodle' }),
  f('burger-home', 'Burger (home-made)', 'Meals', '1 burger with bun', [550, 32, 40, 28, 3, 900], { also: 'hamburger beef patty' }),
  f('tacos', 'Tacos', 'Meals', '2 tacos', [450, 25, 35, 22, 5, 800], { also: 'mexican' }),
  f('burrito-bowl', 'Burrito bowl', 'Meals', `${B}`, [650, 35, 75, 22, 12, 1300], { plate: true, also: 'mexican rice beans' }),
  f('omelette', 'Omelette (3 eggs, cheese)', 'Meals', '1 omelette', [400, 28, 2, 31, 0, 600], { also: 'eggs' }),
  f('poke-bowl', 'Poke bowl', 'Meals', `${B}`, [600, 30, 75, 18, 5, 1300], { plate: true, also: 'sushi bowl tuna salmon' }),
  f('salad-side', 'Side salad with dressing', 'Meals', 'a side bowl', [150, 3, 10, 11, 3, 250], { plate: true }),
  f('caesar', 'Caesar salad', 'Meals', `${B}`, [450, 25, 20, 30, 3, 1000], { plate: true }),
  f('sandwich-ham', 'Ham and cheese sandwich', 'Meals', '1 sandwich', [400, 22, 38, 17, 4, 1200], { also: 'sanga sandwhich' }),
  f('sandwich-chicken', 'Chicken sandwich', 'Meals', '1 sandwich', [400, 25, 38, 15, 4, 900], { also: 'sanga' }),
  f('toastie', 'Cheese toastie', 'Meals', '1 toasted sandwich', [380, 16, 36, 19, 3, 800], { also: 'toasted sandwich jaffle' }),
  f('wrap-chicken', 'Chicken wrap', 'Meals', '1 wrap', [450, 30, 40, 18, 4, 1000]),
  f('dumplings', 'Dumplings', 'Meals', '6 dumplings', [350, 15, 40, 14, 2, 900], { also: 'gyoza dim sum' }),
  // ── Takeaway ──
  f('pizza-slice', 'Pizza', 'Takeaway', '1 slice of a large pizza', [290, 12, 33, 12, 2, 650]),
  f('fish-chips', 'Fish and chips', 'Takeaway', '1 piece of fish and a serve of chips', [900, 35, 85, 45, 6, 1200]),
  f('kebab', 'Kebab or souvlaki wrap', 'Takeaway', '1 wrap', [700, 40, 60, 32, 5, 1700], { also: 'doner gyros hsp' }),
  f('burrito', 'Burrito', 'Takeaway', '1 burrito', [700, 35, 80, 26, 10, 1600], { also: 'mexican' }),
  f('fast-burger', 'Fast-food burger', 'Takeaway', '1 burger', [550, 26, 45, 30, 3, 1000], { also: 'cheeseburger double' }),
  f('chicken-burger', 'Chicken burger', 'Takeaway', '1 burger', [550, 28, 50, 26, 3, 1100]),
  f('fries', 'Hot chips or fries', 'Takeaway', 'a medium serve', [330, 4, 42, 16, 4, 260], { also: 'chips' }),
  f('fried-chicken', 'Fried chicken', 'Takeaway', '2 pieces', [500, 36, 16, 32, 1, 1100], { also: 'kfc' }),
  f('pad-thai', 'Pad thai', 'Takeaway', `${P}`, [700, 28, 85, 26, 4, 1600], { plate: true, also: 'noodles thai' }),
  f('chow-mein', 'Fried noodles', 'Takeaway', `${P}`, [650, 25, 80, 24, 4, 1700], { plate: true, also: 'chow mein lo mein mi goreng' }),
  f('sushi', 'Sushi', 'Takeaway', '8 pieces (a roll)', [350, 12, 65, 5, 3, 900], { also: 'hand roll' }),
  f('pho', 'Pho', 'Takeaway', 'a large bowl', [450, 30, 60, 8, 2, 1800], { plate: true, also: 'vietnamese noodle soup' }),
  f('ramen', 'Ramen', 'Takeaway', 'a bowl', [600, 25, 70, 22, 3, 2500], { plate: true }),
  f('meat-pie', 'Meat pie', 'Takeaway', '1 pie', [450, 15, 35, 28, 2, 800], { also: 'pie' }),
  f('sausage-roll', 'Sausage roll', 'Takeaway', '1 large', [400, 11, 30, 26, 2, 700]),
  f('nuggets', 'Chicken nuggets', 'Takeaway', '6 nuggets', [280, 15, 17, 17, 1, 550]),
  f('instant-noodles', 'Instant noodles', 'Takeaway', '1 packet', [450, 10, 60, 18, 3, 1800], { also: 'mi goreng 2 minute' }),
  // ── Breakfast ──
  f('eggs-toast', 'Eggs on toast', 'Breakfast', '2 eggs, 2 slices of toast', [420, 22, 30, 22, 3, 700], { also: 'scrambled poached fried' }),
  f('bacon-eggs', 'Bacon and eggs', 'Breakfast', '2 eggs, 2 rashers', [380, 26, 1, 30, 0, 1100]),
  f('big-breakfast', 'Big breakfast', 'Breakfast', 'a plate (eggs, bacon, sausage, toast, hash brown)', [900, 45, 50, 55, 4, 2000], { plate: true, also: 'fry up' }),
  f('porridge', 'Porridge with milk', 'Breakfast', `${B}`, [300, 12, 45, 8, 5, 120], { plate: true, also: 'oats oatmeal' }),
  f('cereal', 'Cereal with milk', 'Breakfast', `${B}`, [300, 10, 50, 6, 4, 300], { plate: true, also: 'weetbix cornflakes muesli' }),
  f('toast-spread', 'Toast with spread', 'Breakfast', '2 slices', [250, 7, 32, 10, 3, 400], { also: 'vegemite jam butter' }),
  f('avo-toast', 'Avocado toast', 'Breakfast', '2 slices', [380, 10, 34, 22, 9, 450], { also: 'smashed avo' }),
  f('smoothie', 'Smoothie (fruit and yoghurt)', 'Breakfast', 'a large glass (400 mL)', [300, 12, 50, 5, 4, 120]),
  f('pancakes', 'Pancakes', 'Breakfast', '3 pancakes with syrup', [520, 12, 85, 14, 2, 900]),
  // ── Protein ──
  f('chicken-breast', 'Chicken breast', 'Protein', '1 palm (about 120 g cooked)', [190, 36, 0, 4, 0, 90]),
  f('chicken-thigh', 'Chicken thigh', 'Protein', '1 palm (about 120 g cooked)', [230, 30, 0, 12, 0, 110]),
  f('roast-chicken', 'Roast chicken (with skin)', 'Protein', '1 palm (about 120 g)', [260, 30, 0, 15, 0, 300], { also: 'bbq chook' }),
  f('steak', 'Beef steak', 'Protein', '1 palm (about 120 g cooked)', [220, 34, 0, 9, 0, 70], { also: 'rump scotch' }),
  f('mince', 'Beef mince (cooked)', 'Protein', 'a cupped hand (about 100 g)', [250, 26, 0, 16, 0, 80], { also: 'ground beef' }),
  f('lamb', 'Lamb', 'Protein', '1 palm (about 120 g cooked)', [280, 28, 0, 18, 0, 80], { also: 'chops' }),
  f('pork', 'Pork', 'Protein', '1 palm (about 120 g cooked)', [230, 34, 0, 10, 0, 70], { also: 'chop loin' }),
  f('salmon', 'Salmon', 'Protein', '1 palm (about 120 g)', [250, 27, 0, 15, 0, 70]),
  f('white-fish', 'White fish', 'Protein', '1 palm (about 120 g)', [130, 28, 0, 2, 0, 100], { also: 'barramundi snapper basa' }),
  f('tuna-can', 'Tuna (tin)', 'Protein', '1 small tin (95 g)', [110, 24, 0, 1, 0, 350]),
  f('prawns', 'Prawns', 'Protein', 'a cupped hand (about 100 g)', [100, 23, 0, 1, 0, 500], { also: 'shrimp' }),
  f('egg', 'Egg', 'Protein', '1 large egg', [75, 6.5, 0.5, 5, 0, 70], { also: 'eggs' }),
  f('tofu', 'Tofu', 'Protein', '1 palm (about 120 g)', [170, 17, 3, 10, 1, 15]),
  f('bacon', 'Bacon', 'Protein', '1 rasher', [70, 6, 0, 5, 0, 350]),
  f('sausage', 'Sausage', 'Protein', '1 thick sausage', [220, 10, 4, 18, 0, 550], { also: 'snag' }),
  f('ham', 'Ham', 'Protein', '2 slices (40 g)', [50, 8, 1, 1.5, 0, 450]),
  f('whey', 'Protein shake', 'Protein', '1 scoop with water', [120, 24, 3, 1.5, 0, 100], { also: 'whey powder' }),
  f('lentils', 'Lentils or beans', 'Protein', 'a cupped hand (½ cup cooked)', [115, 9, 20, 0.5, 8, 5], { also: 'chickpeas kidney' }),
  // ── Carbs ──
  f('rice', 'Rice (cooked)', 'Carbs', '1 cup', [205, 4, 45, 0.5, 1, 0]),
  f('pasta', 'Pasta (cooked)', 'Carbs', '1 cup', [220, 8, 43, 1.3, 3, 0]),
  f('noodles', 'Noodles (cooked)', 'Carbs', '1 cup', [220, 7, 43, 2, 2, 100]),
  f('potato', 'Potato', 'Carbs', '1 medium', [160, 4, 36, 0, 4, 10], { also: 'boiled baked roast' }),
  f('mash', 'Mashed potato', 'Carbs', '1 cup', [240, 4, 35, 9, 3, 600]),
  f('sweet-potato', 'Sweet potato', 'Carbs', '1 medium', [115, 2, 27, 0, 4, 40]),
  f('bread', 'Bread', 'Carbs', '1 slice', [90, 3.5, 16, 1, 1.5, 160], { also: 'toast white' }),
  f('wholemeal', 'Wholemeal or grain bread', 'Carbs', '1 slice', [85, 4, 14, 1, 2.5, 150], { also: 'toast multigrain' }),
  f('roll', 'Bread roll', 'Carbs', '1 roll', [200, 7, 38, 2, 2, 380], { also: 'bun' }),
  f('wrap', 'Wrap or tortilla', 'Carbs', '1 wrap', [180, 5, 30, 4, 2, 400]),
  f('oats', 'Oats', 'Carbs', '½ cup dry', [150, 5, 27, 3, 4, 0]),
  f('corn', 'Corn', 'Carbs', '1 cob', [90, 3, 19, 1, 2, 15]),
  // ── Veg and fruit ──
  f('veg', 'Mixed vegetables', 'Veg and fruit', '1 cup', [60, 3, 10, 0.5, 4, 40], { also: 'steamed frozen' }),
  f('salad-leaves', 'Salad leaves', 'Veg and fruit', '2 cups', [15, 1, 2, 0, 1, 20], { also: 'lettuce spinach' }),
  f('broccoli', 'Broccoli', 'Veg and fruit', '1 cup', [55, 4, 11, 0.5, 5, 30]),
  f('banana', 'Banana', 'Veg and fruit', '1 medium', [105, 1.3, 27, 0.4, 3, 0]),
  f('apple', 'Apple', 'Veg and fruit', '1 medium', [95, 0.5, 25, 0.3, 4, 0]),
  f('orange', 'Orange', 'Veg and fruit', '1 medium', [65, 1, 15, 0.2, 3, 0], { also: 'mandarin' }),
  f('berries', 'Berries', 'Veg and fruit', '1 cup', [70, 1, 17, 0.5, 4, 0], { also: 'strawberries blueberries' }),
  f('grapes', 'Grapes', 'Veg and fruit', '1 cup', [100, 1, 27, 0.2, 1, 0]),
  f('avocado', 'Avocado', 'Veg and fruit', 'half an avocado', [120, 1.5, 6, 11, 5, 5], { also: 'avo' }),
  // ── Dairy ──
  f('milk', 'Milk (full cream)', 'Dairy', '1 cup (250 mL)', [160, 8.5, 12, 9, 0, 110]),
  f('milk-skim', 'Milk (skim or light)', 'Dairy', '1 cup (250 mL)', [90, 9, 13, 0.2, 0, 110]),
  f('greek-yoghurt', 'Greek yoghurt (plain)', 'Dairy', '¾ cup (170 g)', [150, 16, 7, 6, 0, 70]),
  f('yoghurt-tub', 'Flavoured yoghurt', 'Dairy', '1 tub (170 g)', [160, 7, 25, 3, 0, 80]),
  f('cottage', 'Cottage cheese', 'Dairy', '½ cup', [100, 13, 4, 4, 0, 400]),
  f('cheese-slice', 'Cheese', 'Dairy', '1 slice (20 g)', [80, 5, 0, 6.5, 0, 160], { also: 'tasty cheddar' }),
  f('grated-cheese', 'Grated cheese', 'Dairy', '¼ cup', [120, 8, 0, 10, 0, 200]),
  f('ice-cream', 'Ice cream', 'Dairy', '2 scoops', [270, 5, 32, 14, 0, 100]),
  // ── Fats and sauces ──
  f('oil', 'Oil', 'Fats and sauces', '1 tablespoon', [120, 0, 0, 14, 0, 0], { also: 'olive cooking' }),
  f('butter', 'Butter', 'Fats and sauces', '1 thumb (10 g)', [72, 0, 0, 8, 0, 60]),
  f('peanut-butter', 'Peanut butter', 'Fats and sauces', '1 tablespoon', [95, 4, 3, 8, 1, 70]),
  f('nuts', 'Nuts', 'Fats and sauces', 'a handful (30 g)', [180, 6, 6, 16, 2, 0], { also: 'almonds cashews' }),
  f('mayo', 'Mayonnaise', 'Fats and sauces', '1 tablespoon', [100, 0, 1, 11, 0, 90], { also: 'aioli' }),
  f('ketchup', 'Tomato or BBQ sauce', 'Fats and sauces', '1 tablespoon', [20, 0, 5, 0, 0, 160], { also: 'ketchup' }),
  f('gravy', 'Gravy', 'Fats and sauces', '¼ cup', [30, 1, 4, 1, 0, 300]),
  f('soy', 'Soy sauce', 'Fats and sauces', '1 tablespoon', [10, 1, 1, 0, 0, 900]),
  f('cream-sauce', 'Creamy sauce', 'Fats and sauces', '½ cup', [200, 2, 6, 18, 0, 400], { also: 'pasta sauce cream' }),
  // ── Snacks ──
  f('chocolate', 'Chocolate', 'Snacks', '1 bar (50 g)', [260, 3, 30, 14, 2, 40]),
  f('biscuits', 'Sweet biscuits', 'Snacks', '2 biscuits', [140, 2, 20, 6, 1, 90], { also: 'cookies tim tam' }),
  f('crisps', 'Chips (packet)', 'Snacks', 'a small packet (45 g)', [240, 3, 24, 15, 2, 300], { also: 'crisps' }),
  f('muesli-bar', 'Muesli bar', 'Snacks', '1 bar', [140, 3, 20, 5, 2, 50]),
  f('protein-bar', 'Protein bar', 'Snacks', '1 bar', [200, 20, 20, 7, 3, 200]),
  f('muffin', 'Muffin', 'Snacks', '1 café muffin', [420, 6, 55, 20, 2, 350]),
  f('donut', 'Doughnut', 'Snacks', '1', [260, 4, 30, 14, 1, 250]),
  f('cake', 'Cake', 'Snacks', '1 slice', [350, 4, 45, 17, 1, 300]),
  // ── Drinks ──
  f('flat-white', 'Flat white, latte or cappuccino', 'Drinks', '1 regular (full cream)', [130, 7, 10, 7, 0, 100], { caffeine: 110, also: 'coffee' }),
  f('soft-drink', 'Soft drink', 'Drinks', '1 can (375 mL)', [160, 0, 40, 0, 0, 30], { caffeine: 36, also: 'coke soda' }),
  f('juice', 'Juice', 'Drinks', '1 glass (250 mL)', [110, 1, 26, 0, 0, 10], { also: 'orange apple' }),
  f('energy-drink', 'Energy drink', 'Drinks', '1 can (250 mL)', [115, 0, 28, 0, 0, 100], { caffeine: 80, also: 'red bull monster' }),
  f('beer', 'Beer', 'Drinks', '1 can or stubby (375 mL)', [150, 1, 11, 0, 0, 15]),
  f('wine', 'Wine', 'Drinks', '1 glass (150 mL)', [125, 0, 4, 0, 0, 5]),
  f('spirit-mixer', 'Spirit and mixer', 'Drinks', '1 drink', [180, 0, 20, 0, 0, 20], { also: 'rum coke vodka bourbon' }),
];

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

/** Foods matching what was typed: every word found in the name or its other words. Name starts first. */
export function searchCommon(q: string, limit = 8): CommonFood[] {
  const qs = words(q);
  if (!qs.length) return [];
  const scored = COMMON_FOODS.map((x) => {
    const hay = words(`${x.name} ${x.also ?? ''}`);
    const all = qs.every((w) => hay.some((h) => h.startsWith(w)));
    if (!all) return null;
    const name = words(x.name);
    const score = (name[0]?.startsWith(qs[0]) ? 3 : 0) + qs.filter((w) => name.some((h) => h.startsWith(w))).length;
    return { x, score };
  }).filter((v): v is { x: CommonFood; score: number } => !!v);
  return scored.sort((a, b) => b.score - a.score || a.x.name.localeCompare(b.x.name)).slice(0, limit).map((v) => v.x);
}
