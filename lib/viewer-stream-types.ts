/** Same shape as the public viewer SSE payload and WebSocket snapshot fetches. */
export type ViewerStreamPayload = {
  auction: {
    _id: string;
    name: string;
    status: string;
    minIncrement: number;
    maxPlayersPerTeam: number;
  };
  state: {
    currentBid: number;
    currentTeamId: string | null;
    currentTeamName: string | null;
    updatedAt: string | null;
    lastAction: "sold" | "unsold" | null;
    lastActionAt: string | null;
    lastActionPlayerName: string | null;
    lastActionTeamName: string | null;
    lastActionPrice: number | null;
    bidHistory: Array<{ teamName: string; amount: number; timestamp?: string }>;
  } | null;
  currentPlayer: { _id: string; name: string; basePrice: number } | null;
  teams: Array<{
    _id?: string;
    name: string;
    captainName?: string;
    totalBudget: number;
    remainingBudget: number;
    playersCount: number;
    remainingSlots: number;
    maxBid: number;
  }>;
  playerStats: { available: number; sold: number; unsold: number };
  timestamp: string;
  error?: string;
};
