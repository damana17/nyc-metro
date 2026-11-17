/*  Rule sets compared in the "fun" experiment. All start from the recommended fixes:
 *  base-price scoring, 2 shares per turn, snake turn order. */
const FIXED = { scoring: "base", investPerTurn: 2, snake: true };
const APP = { scoring: "acq", merges: true, mergeAt: 4, safeAt: 8, rotateStart: true, investPerTurn: 1,
              goals: true, goalsPublic: 3, goalBonus: 30, goalPrice: 5, secretRoutes: 2, secretValue: 30 };
export const VARIANTS = {
  fixed: { label: "Today's rules, seat-fixed", settings: { ...FIXED } },
  merges: { label: "+ merges", settings: { ...FIXED, merges: true, mergeAt: 4 } },
  merges3: { label: "+ merges at 3 stations", settings: { ...FIXED, merges: true, mergeAt: 3 } },
  mergesDiv: { label: "+ merges + caller picks the line that pays", settings: { ...FIXED, merges: true, mergeAt: 4, divOne: true } },
  merges5: { label: "+ merges at 5 stations", settings: { ...FIXED, merges: true, mergeAt: 5 } },
  merges6: { label: "+ merges at 6 stations", settings: { ...FIXED, merges: true, mergeAt: 6 } },
  mergesSafe: { label: "+ merges at 4, safe at 8", settings: { ...FIXED, merges: true, mergeAt: 4, safeAt: 8 } },
  /* today's app rules, and the three gameplay ideas on top of them */
  app: { label: "App today", settings: { ...APP } },
  directors: { label: "+ line directors", settings: { ...APP, directors: true } },
  selling: { label: "+ selling, automatic dividends", settings: { ...APP, sellShares: true, autoDiv: true } },
  sellingMarket: { label: "+ selling at market price, automatic dividends", settings: { ...APP, sellShares: true, autoDiv: true, sellAt: "market" } },
  events: { label: "+ city events deck", settings: { ...APP, events: true } },
  all3: { label: "+ all three", settings: { ...APP, directors: true, sellShares: true, autoDiv: true, sellAt: "market", events: true } },
  divOne: { label: "+ caller picks the line that pays", settings: { ...FIXED, divOne: true } },
};
