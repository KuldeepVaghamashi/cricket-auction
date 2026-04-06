import { ObjectId } from "mongodb";

export interface Auction {
  _id?: ObjectId;
  name: string;
  date: Date;
  budget: number;
  minIncrement: number;
  minBid: number;
  maxPlayersPerTeam: number;
  status: "draft" | "active" | "completed";
  createdAt: Date;
  updatedAt: Date;
}

export interface Team {
  _id?: ObjectId;
  auctionId: ObjectId;
  name: string;
  captainName?: string;
  totalBudget: number;
  remainingBudget: number;
  playersBought: ObjectId[];
  createdAt: Date;
}

export interface Player {
  _id?: ObjectId;
  auctionId: ObjectId;
  name: string;
  basePrice: number;
  status: "available" | "sold" | "unsold";
  soldTo?: ObjectId;
  soldPrice?: number;
  /** Digits-only phone from public self-registration link */
  phone?: string;
  /** Added via /auction/[id]/register (not admin form) */
  selfRegistered?: boolean;
  // Legacy replay marker retained for backward compatibility with existing data.
  unsoldReplayed?: boolean;
  createdAt: Date;
}

export interface BidHistoryEntry {
  teamId: ObjectId;
  teamName: string;
  amount: number;
  timestamp: Date;
}

export interface AuctionState {
  _id?: ObjectId;
  auctionId: ObjectId;
  currentPlayerId: ObjectId | null;
  currentBid: number;
  currentTeamId: ObjectId | null;
  currentTeamName: string | null;
  bidHistory: BidHistoryEntry[];
  updatedAt: Date;
  // Used by viewer to trigger "sold/unsold" animations without reading logs.
  lastAction?: "sold" | "unsold" | null;
  lastActionAt?: Date | null;
  lastActionPlayerName?: string | null;
  lastActionTeamName?: string | null;
  lastActionPrice?: number | null;
}

export interface Admin {
  _id?: ObjectId;
  username: string;
  passwordHash: string;
  createdAt: Date;
}

export interface AuctionLog {
  _id?: ObjectId;
  auctionId: ObjectId;
  action: string;
  details: Record<string, unknown>;
  timestamp: Date;
}

// API Response types
export interface TeamWithStats extends Omit<Team, "_id" | "auctionId" | "playersBought"> {
  _id: string;
  auctionId: string;
  playersBought: string[];
  playersCount: number;
  remainingSlots: number;
  maxBid: number;
}

export interface PlayerWithId extends Omit<Player, "_id" | "auctionId" | "soldTo"> {
  _id: string;
  auctionId: string;
  soldTo?: string;
}

export interface AuctionWithId extends Omit<Auction, "_id"> {
  _id: string;
}

export interface AuctionStateWithId extends Omit<AuctionState, "_id" | "auctionId" | "currentPlayerId" | "currentTeamId" | "bidHistory"> {
  _id: string;
  auctionId: string;
  currentPlayerId: string | null;
  currentTeamId: string | null;
  bidHistory: Array<{
    teamId: string;
    teamName: string;
    amount: number;
    timestamp: string;
  }>;
}
