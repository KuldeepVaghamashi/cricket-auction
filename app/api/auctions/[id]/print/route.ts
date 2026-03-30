import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { Auction, Player, Team } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TeamLike = Team & {
  remainingBudget?: number;
  playersBought?: unknown[];
};

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
    const teamIdParam = request.nextUrl.searchParams.get("teamId");
    const teamObjectId = teamIdParam && ObjectId.isValid(teamIdParam) ? new ObjectId(teamIdParam) : null;
    if (teamIdParam && !teamObjectId) {
      return NextResponse.json({ error: "Invalid team ID" }, { status: 400 });
    }

    const auction = await db.collection<Auction>("auctions").findOne({ _id: auctionId });
    if (!auction) {
      return NextResponse.json({ error: "Auction not found" }, { status: 404 });
    }

    const teams = teamObjectId
      ? await db.collection<Team>("teams").find({ _id: teamObjectId, auctionId }).toArray()
      : await db.collection<Team>("teams").find({ auctionId }).toArray();

    if (teamObjectId && teams.length === 0) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    const playersSold = await db
      .collection<Player>("players")
      .find(teamObjectId ? { auctionId, status: "sold", soldTo: teamObjectId } : { auctionId, status: "sold" })
      .toArray();

    const soldByTeam = new Map<string, Player[]>();
    for (const p of playersSold) {
      const teamId = p.soldTo?.toString();
      if (!teamId) continue;
      const list = soldByTeam.get(teamId) ?? [];
      list.push(p);
      soldByTeam.set(teamId, list);
    }

    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    const pdfBufferPromise = new Promise<Buffer>((resolve, reject) => {
      const finalize = () => resolve(Buffer.concat(chunks));

      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on("error", reject);

      // pdfkit emits 'end' when the document has finished rendering.
      // Depending on runtime, stream 'end'/'finish' may vary, so we finalize on multiple signals.
      doc.on("error", reject);
      doc.on("end", finalize);
      stream.on("end", finalize);
      stream.on("finish", finalize);
    });
    doc.pipe(stream);

    // -------- PDF Theme helpers --------
    const page = () => doc.page;
    const contentWidth = () => page().width - doc.page.margins.left - doc.page.margins.right;
    const x0 = () => doc.page.margins.left;

    const COLORS = {
      ink: "#0F172A",
      muted: "#475569",
      border: "#E2E8F0",
      soft: "#F1F5F9",
      brand: "#0F766E",
      brandSoft: "#CCFBF1",
      tableHeader: "#0B2F2D",
      tableRowAlt: "#F8FAFC",
    } as const;

    const ensureSpace = (minHeight: number) => {
      const bottom = page().height - doc.page.margins.bottom;
      if (doc.y + minHeight > bottom) doc.addPage();
    };

    const hr = (gap = 10) => {
      const y = doc.y + gap;
      doc
        .save()
        .moveTo(x0(), y)
        .lineTo(x0() + contentWidth(), y)
        .lineWidth(1)
        .strokeColor(COLORS.border)
        .stroke()
        .restore();
      doc.y = y + gap;
    };

    const formatDateTime = (d: Date) => {
      const v = d.toLocaleString();
      return v;
    };

    const drawHeader = () => {
      const headerH = 76;
      const y = 0;
      doc.save();
      doc.rect(0, y, page().width, headerH).fill(COLORS.brand);

      doc
        .fillColor("white")
        .fontSize(22)
        .text(teamObjectId ? "Team Auction Results" : "Cricket Auction Results", x0(), 24, {
          width: contentWidth(),
          align: "left",
        });

      doc
        .fillColor("white")
        .fontSize(11)
        .text(auction.name, x0(), 50, { width: contentWidth(), align: "left" });

      doc.restore();
      doc.y = headerH + 18;
    };

    const drawInfoRow = (left: string, right: string) => {
      doc.save();
      doc.fillColor(COLORS.muted).fontSize(10);
      doc.text(left, x0(), doc.y, { width: contentWidth() / 2, align: "left" });
      doc.text(right, x0() + contentWidth() / 2, doc.y, {
        width: contentWidth() / 2,
        align: "right",
      });
      doc.restore();
      doc.moveDown(0.8);
    };

    const drawStatCards = (items: Array<{ label: string; value: string }>) => {
      const gap = 10;
      const cardH = 52;
      const cardW = (contentWidth() - gap * (items.length - 1)) / items.length;
      ensureSpace(cardH + 10);

      const y = doc.y;
      items.forEach((it, i) => {
        const x = x0() + i * (cardW + gap);
        doc.save();
        doc.roundedRect(x, y, cardW, cardH, 10).fill(COLORS.soft);
        doc.roundedRect(x, y, cardW, cardH, 10).lineWidth(1).strokeColor(COLORS.border).stroke();
        doc.fillColor(COLORS.muted).fontSize(10).text(it.label, x + 12, y + 10, { width: cardW - 24 });
        doc.fillColor(COLORS.ink).fontSize(16).text(it.value, x + 12, y + 26, { width: cardW - 24 });
        doc.restore();
      });
      doc.y = y + cardH + 16;
    };

    const drawSectionTitle = (title: string, subtitle?: string) => {
      ensureSpace(42);
      doc.save();
      doc.fillColor(COLORS.ink).fontSize(14).text(title, { continued: false });
      if (subtitle) {
        doc.fillColor(COLORS.muted).fontSize(10).text(subtitle);
      }
      doc.restore();
      doc.moveDown(0.4);
    };

    const drawTeamHeader = (teamName: string) => {
      ensureSpace(50);
      const y = doc.y;
      const h = 34;
      doc.save();
      doc.roundedRect(x0(), y, contentWidth(), h, 10).fill(COLORS.brandSoft);
      doc.roundedRect(x0(), y, contentWidth(), h, 10).lineWidth(1).strokeColor(COLORS.border).stroke();
      doc.fillColor(COLORS.tableHeader).fontSize(13).text(teamName, x0() + 14, y + 10, {
        width: contentWidth() - 28,
      });
      doc.restore();
      doc.y = y + h + 10;
    };

    const drawKeyValues = (rows: Array<{ k: string; v: string }>) => {
      const colGap = 18;
      const colW = (contentWidth() - colGap) / 2;
      const startY = doc.y;
      let leftY = startY;
      let rightY = startY;

      doc.save();
      doc.fontSize(10);
      rows.forEach((r, idx) => {
        const isLeft = idx % 2 === 0;
        const x = isLeft ? x0() : x0() + colW + colGap;
        const y = isLeft ? leftY : rightY;
        doc.fillColor(COLORS.muted).text(r.k, x, y, { width: colW });
        doc.fillColor(COLORS.ink).text(r.v, x, y + 12, { width: colW });
        if (isLeft) leftY = y + 30;
        else rightY = y + 30;
      });
      doc.restore();
      doc.y = Math.max(leftY, rightY) + 2;
    };

    const drawPlayersTable = (players: Array<{ name: string; points: number }>) => {
      const tableX = x0();
      const tableW = contentWidth();
      const rowH = 22;
      const headerH = 24;
      const colNameW = Math.floor(tableW * 0.72);
      const colPtsW = tableW - colNameW;

      // Header
      ensureSpace(headerH + rowH * Math.min(players.length, 3) + 20);
      const y0 = doc.y;
      doc.save();
      doc.roundedRect(tableX, y0, tableW, headerH, 8).fill(COLORS.tableHeader);
      doc.fillColor("white").fontSize(10);
      doc.text("Player", tableX + 10, y0 + 7, { width: colNameW - 20 });
      doc.text("Points", tableX + colNameW, y0 + 7, { width: colPtsW - 10, align: "right" });
      doc.restore();

      let y = y0 + headerH;
      for (let i = 0; i < players.length; i++) {
        ensureSpace(rowH + 10);
        const p = players[i];
        const isAlt = i % 2 === 1;

        doc.save();
        if (isAlt) {
          doc.rect(tableX, y, tableW, rowH).fill(COLORS.tableRowAlt);
        }
        doc
          .rect(tableX, y, tableW, rowH)
          .lineWidth(1)
          .strokeColor(COLORS.border)
          .stroke();
        doc.fillColor(COLORS.ink).fontSize(10);
        doc.text(p.name, tableX + 10, y + 6, { width: colNameW - 20 });
        doc.text(`${p.points}`, tableX + colNameW, y + 6, { width: colPtsW - 10, align: "right" });
        doc.restore();

        y += rowH;
        doc.y = y;
      }

      doc.moveDown(0.8);
    };

    // -------- Cover / Summary --------
    drawHeader();
    drawInfoRow(`Date: ${formatDateTime(new Date(auction.date))}`, `Generated: ${formatDateTime(new Date())}`);

    const totalSold = playersSold.length;
    const totalSoldPoints = playersSold.reduce((sum, p) => sum + (typeof p.soldPrice === "number" ? p.soldPrice : 0), 0);
    drawStatCards(
      teamObjectId
        ? [
            { label: "Sold Players", value: `${totalSold}` },
            { label: "Points Spent", value: `${totalSoldPoints}` },
            { label: "Report", value: "Team wise" },
          ]
        : [
            { label: "Teams", value: `${teams.length}` },
            { label: "Sold Players", value: `${totalSold}` },
            { label: "Total Points Spent", value: `${totalSoldPoints}` },
          ]
    );

    drawSectionTitle(teamObjectId ? "Team Summary" : "Teams Summary", "Players bought list with points and remaining budget");

    // Stable order for PDF
    const teamsSorted = [...teams].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    for (const team of teamsSorted) {
      const t = team as TeamLike;
      const remainingBudget =
        typeof t.remainingBudget === "number" ? t.remainingBudget : 0;
      const playersBoughtCount = Array.isArray(t.playersBought)
        ? t.playersBought.length
        : 0;

      drawTeamHeader(team.name);
      drawKeyValues([
        { k: "Captain", v: team.captainName || "-" },
        { k: "Remaining Budget", v: `${remainingBudget} pts` },
        { k: "Players Bought", v: `${playersBoughtCount}` },
      ]);

      const soldPlayers = soldByTeam.get(team._id?.toString() ?? "") ?? [];
      if (soldPlayers.length === 0) {
        doc.save();
        doc.fillColor(COLORS.muted).fontSize(10).text("No players sold for this team.");
        doc.restore();
        doc.moveDown(0.8);
        hr(6);
        continue;
      }

      const rows = [...soldPlayers]
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
        .map((p) => ({ name: p.name, points: typeof p.soldPrice === "number" ? p.soldPrice : 0 }));
      drawPlayersTable(rows);

      const teamSpent = rows.reduce((s, r) => s + r.points, 0);
      doc.save();
      doc.fillColor(COLORS.muted).fontSize(10).text(`Team spent: ${teamSpent} pts`, { align: "right" });
      doc.restore();
      doc.moveDown(0.8);
      hr(6);
    }

    // -------- Footer with page numbers --------
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - doc.page.margins.bottom + 18;
      doc.save();
      doc
        .moveTo(x0(), footerY - 8)
        .lineTo(x0() + contentWidth(), footerY - 8)
        .lineWidth(1)
        .strokeColor(COLORS.border)
        .stroke();
      doc.fillColor(COLORS.muted).fontSize(9);
      doc.text(auction.name, x0(), footerY, { width: contentWidth() / 2, align: "left" });
      doc.text(`Page ${i - range.start + 1} / ${range.count}`, x0() + contentWidth() / 2, footerY, {
        width: contentWidth() / 2,
        align: "right",
      });
      doc.restore();
    }

    doc.end();

    const pdfBuffer = await pdfBufferPromise;
    const pdfBytes = new Uint8Array(pdfBuffer);
    return new NextResponse(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="auction-${id}${teamIdParam ? `-team-${teamIdParam}` : ""}-results.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Print PDF error:", error);
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown error";
    return NextResponse.json(
      { error: "Failed to generate PDF", details: message },
      { status: 500 }
    );
  }
}

