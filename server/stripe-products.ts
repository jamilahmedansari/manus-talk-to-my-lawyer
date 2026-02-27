/**
 * Stripe Products & Pricing Configuration
 * Talk-to-My-Lawyer — Legal Letter Generation Platform
 *
 * Plans:
 *  per_letter  — $200 one-time per letter (pay-as-you-go)
 *
 * Every letter requires payment: submit → AI pipeline → generated_locked → $200 unlock → attorney review.
 */

export interface PlanConfig {
  id: "per_letter";
  name: string;
  description: string;
  price: number; // in cents
  interval: "one_time";
  lettersAllowed: number;
  badge?: string;
  features: string[];
}

/** Price in cents for a single letter unlock (attorney review) */
export const LETTER_UNLOCK_PRICE_CENTS = 20000; // $200

export const PLANS: Record<string, PlanConfig> = {
  per_letter: {
    id: "per_letter",
    name: "Pay Per Letter",
    description: "One professional legal letter, no commitment",
    price: LETTER_UNLOCK_PRICE_CENTS, // $200
    interval: "one_time",
    lettersAllowed: 1,
    features: [
      "1 professional legal letter",
      "AI-powered research (Perplexity)",
      "Attorney review & approval",
      "Final approved PDF",
      "Email delivery",
    ],
  },
};

export const PLAN_LIST = Object.values(PLANS);

export function getPlanConfig(planId: string): PlanConfig | undefined {
  return PLANS[planId];
}

export function canSubmitLetter(
  plan: string,
  lettersAllowed: number,
  lettersUsed: number,
  status: string
): { allowed: boolean; reason?: string } {
  if (status !== "active") {
    return { allowed: false, reason: "No active subscription. Please subscribe to submit a letter." };
  }
  if (lettersAllowed === -1) {
    return { allowed: true }; // unlimited
  }
  if (lettersUsed >= lettersAllowed) {
    return {
      allowed: false,
      reason: `You have used all ${lettersAllowed} letter(s) in your ${plan} plan. Please upgrade to continue.`,
    };
  }
  return { allowed: true };
}
