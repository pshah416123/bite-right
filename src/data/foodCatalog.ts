/**
 * Curated catalog of common dish + drink names, used by the food
 * autocomplete dropdown in the Discover search bar and the log-visit
 * dish input. Strict food/drink only — no restaurants, no cuisines as
 * standalone entries (those are handled by other autocomplete sources).
 *
 * Maintenance: when adding entries, keep the casing how a user would see
 * it on a menu. The matcher is case-insensitive but the suggestion is
 * displayed verbatim.
 */

export const FOOD_CATALOG: readonly string[] = [
  // ─── American / Burgers / Sandwiches ────────────────────────────
  'Burger', 'Cheeseburger', 'Bacon Cheeseburger', 'Smash Burger',
  'Double Cheeseburger', 'Veggie Burger', 'Impossible Burger',
  'Hot Dog', 'Chili Dog', 'Corn Dog',
  'BLT', 'Club Sandwich', 'Reuben', 'Grilled Cheese', 'Patty Melt',
  'Philly Cheesesteak', 'French Dip', 'Sloppy Joe',
  'French Fries', 'Sweet Potato Fries', 'Truffle Fries', 'Loaded Fries',
  'Onion Rings', 'Tater Tots', 'Mac and Cheese',
  'Chicken Wings', 'Buffalo Wings', 'Boneless Wings',
  'Chicken Tenders', 'Chicken Strips', 'Chicken Nuggets',
  'Fried Chicken', 'Chicken Sandwich', 'Spicy Chicken Sandwich',
  'Chicken & Waffles', 'Pulled Pork Sandwich',

  // ─── BBQ & Smoked ────────────────────────────────────────────
  'Brisket', 'Pulled Pork', 'Smoked Ribs', 'Baby Back Ribs',
  'Burnt Ends', 'Smoked Sausage', 'Smoked Turkey', 'BBQ Platter',

  // ─── Pizza ─────────────────────────────────────────────────────
  'Margherita Pizza', 'Pepperoni Pizza', 'Cheese Pizza',
  'Hawaiian Pizza', 'Meat Lovers Pizza', 'Veggie Pizza',
  'White Pizza', 'BBQ Chicken Pizza', 'Detroit Style Pizza',
  'Deep Dish Pizza', 'Neapolitan Pizza', 'Sicilian Pizza',
  'Calzone', 'Stromboli', 'Garlic Knots',

  // ─── Italian Pasta ─────────────────────────────────────────────
  'Spaghetti', 'Spaghetti Bolognese', 'Spaghetti Carbonara',
  'Cacio e Pepe', 'Fettuccine Alfredo', 'Penne Vodka', 'Penne Arrabiata',
  'Lasagna', 'Ravioli', 'Tortellini', 'Linguine with Clams',
  'Pesto Pasta', 'Truffle Pasta', 'Gnocchi', 'Tagliatelle al Ragù',
  'Orecchiette', 'Mafaldine', 'Risotto', 'Mushroom Risotto',
  'Saffron Risotto', 'Burrata', 'Caprese Salad', 'Bruschetta',
  'Eggplant Parmesan', 'Chicken Parmesan', 'Osso Buco', 'Tiramisu',
  'Cannoli', 'Panna Cotta',

  // ─── Mexican / Latin ───────────────────────────────────────────
  'Tacos', 'Al Pastor Tacos', 'Carnitas Tacos', 'Barbacoa Tacos',
  'Carne Asada Tacos', 'Fish Tacos', 'Shrimp Tacos', 'Birria Tacos',
  'Breakfast Tacos', 'Burrito', 'Bean Burrito', 'Breakfast Burrito',
  'Chimichanga', 'Quesadilla', 'Enchiladas', 'Tamales', 'Tostadas',
  'Mole', 'Mole Poblano', 'Chiles Rellenos', 'Pozole', 'Menudo',
  'Carne Asada', 'Carnitas', 'Barbacoa', 'Cochinita Pibil',
  'Elote', 'Esquites', 'Guacamole', 'Chips & Salsa', 'Queso Fundido',
  'Ceviche', 'Aguachile', 'Empanadas', 'Arepas', 'Churros', 'Flan',

  // ─── Japanese ─────────────────────────────────────────────────
  'Sushi', 'Nigiri', 'Sashimi', 'Salmon Nigiri', 'Tuna Nigiri',
  'Yellowtail Nigiri', 'Uni', 'Ikura', 'Maki Roll', 'Rainbow Roll',
  'Dragon Roll', 'Spicy Tuna Roll', 'California Roll', 'Hand Roll',
  'Chirashi Bowl', 'Poke Bowl', 'Omakase',
  'Ramen', 'Tonkotsu Ramen', 'Shoyu Ramen', 'Miso Ramen', 'Spicy Ramen',
  'Tsukemen', 'Udon', 'Soba', 'Tempura', 'Shrimp Tempura',
  'Vegetable Tempura', 'Yakitori', 'Karaage', 'Tonkatsu', 'Katsu Curry',
  'Gyoza', 'Edamame', 'Agedashi Tofu', 'Takoyaki', 'Okonomiyaki',
  'Mochi', 'Matcha Ice Cream',

  // ─── Chinese ──────────────────────────────────────────────────
  'Xiao Long Bao', 'Soup Dumplings', 'Pork Dumplings', 'Potstickers',
  'Wontons', 'Wonton Soup', 'Hot and Sour Soup', 'Egg Drop Soup',
  'Dim Sum', 'Har Gow', 'Shumai', 'BBQ Pork Bun', 'Egg Roll', 'Spring Roll',
  'General Tso Chicken', 'Orange Chicken', 'Sesame Chicken',
  'Kung Pao Chicken', 'Mongolian Beef', 'Beef and Broccoli',
  'Mapo Tofu', 'Ma Po Tofu', 'Peking Duck', 'Dan Dan Noodles',
  'Lo Mein', 'Chow Mein', 'Fried Rice', 'Yang Chow Fried Rice',
  'Salt and Pepper Shrimp', 'Cumin Lamb', 'Twice Cooked Pork',

  // ─── Thai ─────────────────────────────────────────────────────
  'Pad Thai', 'Pad See Ew', 'Drunken Noodles', 'Khao Soi',
  'Green Curry', 'Red Curry', 'Massaman Curry', 'Panang Curry',
  'Tom Yum Soup', 'Tom Kha Gai', 'Thai Iced Tea', 'Mango Sticky Rice',

  // ─── Vietnamese ───────────────────────────────────────────────
  'Pho', 'Pho Bo', 'Pho Ga', 'Banh Mi', 'Bun Bo Hue', 'Bun Cha',
  'Spring Rolls', 'Vietnamese Iced Coffee',

  // ─── Korean ───────────────────────────────────────────────────
  'Bibimbap', 'Bulgogi', 'Galbi', 'Korean BBQ', 'Korean Fried Chicken',
  'Kimchi Jjigae', 'Soondubu Jjigae', 'Sundubu', 'Tteokbokki', 'Japchae',
  'Bossam', 'Samgyeopsal', 'Banchan',

  // ─── Indian / South Asian ────────────────────────────────────
  'Butter Chicken', 'Chicken Tikka Masala', 'Chicken Tikka',
  'Tandoori Chicken', 'Lamb Vindaloo', 'Lamb Rogan Josh',
  'Saag Paneer', 'Palak Paneer', 'Paneer Tikka',
  'Chana Masala', 'Dal Makhani', 'Dal', 'Aloo Gobi',
  'Biryani', 'Chicken Biryani', 'Lamb Biryani', 'Vegetable Biryani',
  'Samosa', 'Pakora', 'Dosa', 'Masala Dosa', 'Idli', 'Vada Pav',
  'Naan', 'Garlic Naan', 'Roti', 'Paratha',
  'Gulab Jamun', 'Mango Lassi', 'Chai',

  // ─── Mediterranean / Middle Eastern ──────────────────────────
  'Hummus', 'Baba Ganoush', 'Falafel', 'Tabbouleh', 'Fattoush',
  'Pita', 'Shawarma', 'Chicken Shawarma', 'Lamb Shawarma',
  'Kebab', 'Chicken Kebab', 'Lamb Kebab', 'Kofta', 'Shish Tawook',
  'Gyro', 'Souvlaki', 'Moussaka', 'Spanakopita', 'Dolmas',
  'Mezze Platter', 'Manakish', 'Lahmajun',
  'Baklava', 'Knafeh', 'Turkish Coffee',

  // ─── French ───────────────────────────────────────────────────
  'Steak Frites', 'Coq au Vin', 'Boeuf Bourguignon', 'Duck Confit',
  'Cassoulet', 'Ratatouille', 'Salade Niçoise', 'French Onion Soup',
  'Quiche Lorraine', 'Croque Monsieur', 'Croque Madame',
  'Crepe', 'Nutella Crepe', 'Crème Brûlée', 'Macaron', 'Eclair',

  // ─── Seafood ──────────────────────────────────────────────────
  'Oysters', 'Oysters on the Half Shell', 'Shrimp Cocktail',
  'Lobster Roll', 'Lobster Bisque', 'Whole Lobster',
  'Crab Cakes', 'King Crab', 'Snow Crab', 'Crab Boil',
  'Salmon', 'Grilled Salmon', 'Smoked Salmon', 'Salmon Bowl',
  'Tuna Steak', 'Halibut', 'Branzino', 'Whole Branzino',
  'Cioppino', 'Bouillabaisse', 'Paella', 'Fish & Chips',
  'Clam Chowder', 'Lobster Mac and Cheese', 'Shrimp Scampi',

  // ─── Steakhouse ───────────────────────────────────────────────
  'Ribeye', 'Bone-In Ribeye', 'Filet Mignon', 'NY Strip',
  'T-Bone', 'Porterhouse', 'Tomahawk', 'Skirt Steak', 'Hanger Steak',
  'Wagyu', 'A5 Wagyu', 'Dry-Aged Steak', 'Steak Tartare',
  'Surf and Turf', 'Prime Rib', 'Wedge Salad', 'Creamed Spinach',

  // ─── Brunch / Breakfast ──────────────────────────────────────
  'Pancakes', 'Buttermilk Pancakes', 'Blueberry Pancakes',
  'Waffles', 'Belgian Waffle', 'Chicken and Waffles',
  'French Toast', 'Stuffed French Toast', 'Eggs Benedict',
  'Avocado Toast', 'Omelette', 'Western Omelette', 'Frittata',
  'Shakshuka', 'Huevos Rancheros', 'Hash Browns', 'Bacon',
  'Sausage', 'Breakfast Sandwich', 'Bagel and Lox', 'Lox Bagel',
  'Cinnamon Roll', 'Croissant', 'Pain au Chocolat',

  // ─── Salads / Bowls ──────────────────────────────────────────
  'Caesar Salad', 'Greek Salad', 'Cobb Salad', 'Caprese Salad',
  'Kale Caesar', 'Beet Salad', 'Burrata Salad',
  'Grain Bowl', 'Buddha Bowl', 'Acai Bowl', 'Smoothie Bowl',
  'Chicken Caesar Wrap',

  // ─── Soups ───────────────────────────────────────────────────
  'Chicken Noodle Soup', 'Tomato Soup', 'Minestrone',
  'Lobster Bisque', 'New England Clam Chowder', 'Gazpacho',

  // ─── Desserts ────────────────────────────────────────────────
  'Cheesecake', 'New York Cheesecake', 'Strawberry Cheesecake',
  'Chocolate Cake', 'Molten Chocolate Cake', 'Lava Cake',
  'Carrot Cake', 'Red Velvet Cake', 'Tres Leches Cake',
  'Key Lime Pie', 'Apple Pie', 'Pecan Pie', 'Pumpkin Pie',
  'Banana Pudding', 'Bread Pudding', 'Sticky Toffee Pudding',
  'Ice Cream', 'Gelato', 'Sorbet', 'Affogato',
  'Brownie', 'Cookie', 'Chocolate Chip Cookie', 'Donut',
  'Cupcake', 'Sundae', 'Banana Split', 'Milkshake',

  // ─── Drinks — Cocktails ──────────────────────────────────────
  'Old Fashioned', 'Manhattan', 'Negroni', 'Aperol Spritz',
  'Hugo Spritz', 'Margarita', 'Spicy Margarita', 'Mezcal Margarita',
  'Paloma', 'Mojito', 'Daiquiri', 'Hemingway Daiquiri', 'Pina Colada',
  'Mai Tai', 'Espresso Martini', 'Dirty Martini', 'Vesper',
  'Whiskey Sour', 'Sazerac', 'Boulevardier', 'French 75',
  'Moscow Mule', 'Bloody Mary', 'Mimosa',

  // ─── Drinks — Wine / Beer / NA ───────────────────────────────
  'Red Wine', 'White Wine', 'Rosé', 'Champagne', 'Prosecco', 'Sake',
  'IPA', 'Lager', 'Pilsner', 'Stout',
  'Coffee', 'Espresso', 'Latte', 'Cappuccino', 'Americano',
  'Cold Brew', 'Iced Latte', 'Flat White', 'Cortado', 'Macchiato',
  'Matcha Latte', 'Chai Latte', 'Hot Chocolate', 'Iced Tea',
  'Boba Tea', 'Bubble Tea',
];

/**
 * Filter the catalog for a free-text query. Returns up to `limit` items,
 * sorted by match quality (prefix > word-start > substring).
 */
export function searchFoodCatalog(query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return [];

  const prefix: string[] = [];
  const wordStart: string[] = [];
  const substring: string[] = [];

  for (const item of FOOD_CATALOG) {
    const lower = item.toLowerCase();
    if (lower.startsWith(q)) prefix.push(item);
    else if (lower.split(/\s+/).some((w) => w.startsWith(q))) wordStart.push(item);
    else if (lower.includes(q)) substring.push(item);
    if (prefix.length + wordStart.length + substring.length >= limit * 3) break;
  }
  return [...prefix, ...wordStart, ...substring].slice(0, limit);
}
