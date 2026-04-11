import type { Team, Auction } from "./types";

/**
 * Calculate the maximum allowed bid for a team
 * Formula: remainingBudget - ((remainingSlots - 1) * minBid)
 * This ensures the team can still buy remaining players at minimum price
 */
export function calculateMaxBid(
  team: Pick<Team, "remainingBudget" | "playersBought">,
  auction: Pick<Auction, "maxPlayersPerTeam" | "minBid">
): number {
  const playersOwned = team.playersBought.length;
  const remainingSlots = auction.maxPlayersPerTeam - playersOwned;
  
  if (remainingSlots <= 0) return 0;
  if (remainingSlots === 1) return team.remainingBudget;
  
  // Reserve minimum bid for each remaining slot (except current)
  const reservedBudget = (remainingSlots - 1) * auction.minBid;
  const maxBid = team.remainingBudget - reservedBudget;
  
  return Math.max(0, maxBid);
}

/**
 * Returns the effective bid increment for a given current bid level.
 * Switches to thresholdIncrement once currentBid >= thresholdAmount (if both are set).
 */
export function effectiveIncrement(
  currentBid: number,
  auction: Pick<Auction, "minIncrement" | "thresholdAmount" | "thresholdIncrement">
): number {
  if (
    auction.thresholdAmount !== undefined &&
    auction.thresholdIncrement !== undefined &&
    currentBid >= auction.thresholdAmount
  ) {
    return auction.thresholdIncrement;
  }
  return auction.minIncrement;
}

/**
 * Validate if a bid is allowed
 */
export function validateBid(
  bidAmount: number,
  team: Pick<Team, "remainingBudget" | "playersBought">,
  auction: Pick<Auction, "maxPlayersPerTeam" | "minBid" | "minIncrement" | "thresholdAmount" | "thresholdIncrement">,
  currentBid: number,
  opts?: { isFirstBid?: boolean }
): { valid: boolean; error?: string } {
  const maxBid = calculateMaxBid(team, auction);
  const remainingSlots = auction.maxPlayersPerTeam - team.playersBought.length;
  const isFirstBid = opts?.isFirstBid ?? false;

  if (remainingSlots <= 0) {
    return { valid: false, error: "Team has reached maximum players limit" };
  }

  if (bidAmount > team.remainingBudget) {
    return { valid: false, error: "Bid exceeds remaining budget" };
  }

  if (bidAmount > maxBid) {
    return {
      valid: false,
      error: `Bid exceeds maximum allowed (${maxBid}). Must reserve budget for remaining ${remainingSlots - 1} players.`
    };
  }

  // First bid for a player can be the base price; subsequent bids must respect effective increment.
  if (isFirstBid) {
    if (bidAmount < currentBid) {
      return {
        valid: false,
        error: `First bid must be at least ${currentBid} (base price)`,
      };
    }
  } else {
    const incr = effectiveIncrement(currentBid, auction);
    if (bidAmount < currentBid + incr) {
      return {
        valid: false,
        error: `Bid must be at least ${currentBid + incr} (current bid + increment)`
      };
    }
  }

  return { valid: true };
}

/**
 * Format currency for display
 */
export function formatBudget(amount: number): string {
  return `${amount} pts`;
}
