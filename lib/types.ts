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
  // When a player is selected again in the "unsold replay" phase,
  // we mark it so it doesn't appear repeatedly.
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
  // Optional countdown for "under the hammer" player.
  // Stored as epoch milliseconds so multiple clients can render consistently.
  playerTimerEndsAt?: number;
  playerTimerSeconds?: number;
  updatedAt: Date;
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
