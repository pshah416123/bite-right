export type VibeTag =
  | 'solo dining'
  | 'casual'
  | 'fine dining'
  | 'date night'
  | 'group dinner'
  | 'brunch'
  | 'drinks'
  | 'quick bite'
  | 'special occasion';

interface InferVibeParams {
  name?: string | null;
  cuisine?: string | null;
  priceLevel?: number | null;
  neighborhood?: string | null;
}

export function inferVibeTags({
  name,
  cuisine,
  priceLevel,
}: InferVibeParams): VibeTag[] {
  const tags = new Set<VibeTag>();
  const text = `${name ?? ''} ${cuisine ?? ''}`.toLowerCase();

  // Casual / quick bite
  if (/diner|burger|pizza|bbq|taco|sandwich|noodles|ramen|chicken|hot dog/.test(text)) {
    tags.add('casual');
    tags.add('quick bite');
  }

  // Brunch / drinks
  if (/brunch|coffee|cafe|breakfast|bakery/.test(text)) {
    tags.add('brunch');
  }
  if (/bar|wine|cocktail|tavern|pub/.test(text)) {
    tags.add('drinks');
  }

  // Date night / special occasion / fine dining (price heuristic)
  if (priceLevel != null && priceLevel >= 3) {
    tags.add('date night');
    tags.add('special occasion');
    tags.add('fine dining');
  }

  // Group dinner
  if (/bbq|pizza|tapas|family|hall|beer|brewery/.test(text)) {
    tags.add('group dinner');
  }

  // Solo dining
  if (/ramen|noodle|counter|cafe|bar/.test(text)) {
    tags.add('solo dining');
  }

  // Fallbacks
  if (tags.size === 0) {
    tags.add('casual');
  }

  return Array.from(tags);
}

