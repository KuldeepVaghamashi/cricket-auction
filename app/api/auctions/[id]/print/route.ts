import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import PDFDocument from "pdfkit";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { Auction, Player, Team } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Admin-only endpoint
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid auction ID" }, { status: 400 });
  }

  try {
    const db = await getDb();
    const auctionId = new ObjectId(id);

    const auction = await db.collection<Auction>("auctions").findOne({ _id: auctionId });
    if (!auction) {
      return NextResponse.json({ error: "Auction not found" }, { status: 404 });
    }

    const teams = await db.collection<Team>("teams").find({ auctionId }).toArray();
    const playersSold = await db
      .collection<Player>("players")
      .find({ auctionId, status: "sold" })
      .toArray();

    const soldByTeam = new Map<string, Player[]>();
    for (const p of playersSold) {
      const teamId = p.soldTo?.toString();
      if (!teamId) continue;
      const list = soldByTeam.get(teamId) ?? [];
      list.push(p);
      soldByTeam.set(teamId, list);
    }

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));

    doc.fontSize(20).text("Cricket Auction Results", { align: "center" });
    doc.moveDown(0.5);
    doc
      .fontSize(12)
      .text(`Auction: ${auction.name}`)
      .text(`Date: ${new Date(auction.date).toLocaleString()}`)
      .moveDown(0.5);

    doc.fontSize(12).text(`Generated at: ${new Date().toLocaleString()}`).moveDown();

    for (const team of teams) {
      doc
        .fontSize(14)
        .text(team.name, { underline: true })
        .moveDown(0.25);

      if (team.captainName) {
        doc.fontSize(11).text(`Captain: ${team.captainName}`).moveDown(0.2);
      }

      doc
        .fontSize(11)
        .fillColor("black")
        .text(`Remaining Budget: ${team.remainingBudget} pts`)
        .text(`Players Bought: ${team.playersBought.length}`)
        .moveDown(0.25);

      const soldPlayers = soldByTeam.get(team._id?.toString() ?? "") ?? [];
      if (soldPlayers.length === 0) {
        doc.fontSize(11).text("No players sold for this team.").moveDown(0.75);
        continue;
      }

      if (team.captainName) {
        doc.fontSize(11).text(`Captain: ${team.captainName}`).moveDown(0.1);
      }
      doc.fontSize(11).text("Players:");
      for (const p of soldPlayers) {
        doc
          .fontSize(11)
          .text(`- ${p.name} (${p.soldPrice ?? 0} pts)`);
      }
      doc.moveDown(0.75);
    }

    doc.end();

    await new Promise<void>((resolve, reject) => {
      doc.on("end", () => resolve());
      doc.on("error", (err) => reject(err));
    });

    const pdfBuffer = Buffer.concat(chunks);
    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="auction-${id}-results.pdf"`,
      },
    });
  } catch (error) {
    console.error("Print PDF error:", error);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}

