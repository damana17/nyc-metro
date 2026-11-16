/*  Rule sets compared in the "fun" experiment. All start from the recommended fixes:
 *  base-price scoring, 2 shares per turn, snake turn order. */
const FIXED = { scoring: "base", investPerTurn: 2, snake: true };
export const VARIANTS = {
  fixed: { label: "Today's rules, seat-fixed", settings: { ...FIXED } },
  merges: { label: "+ merges", settings: { ...FIXED, merges: true, mergeAt: 4 } },
  merges3: { label: "+ merges at 3 stations", settings: { ...FIXED, merges: true, mergeAt: 3 } },
  mergesDiv: { label: "+ merges + caller picks the line that pays", settings: { ...FIXED, merges: true, mergeAt: 4, divOne: true } },
  merges5: { label: "+ merges at 5 stations", settings: { ...FIXED, merges: true, mergeAt: 5 } },
  merges6: { label: "+ merges at 6 stations", settings: { ...FIXED, merges: true, mergeAt: 6 } },
  mergesSafe: { label: "+ merges at 4, safe at 8", settings: { ...FIXED, merges: true, mergeAt: 4, safeAt: 8 } },
  divOne: { label: "+ caller picks the line that pays", settings: { ...FIXED, divOne: true } },
};
