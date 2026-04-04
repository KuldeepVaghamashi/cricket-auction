import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import { getDb } from "@/lib/mongodb";
import { isAuthenticated } from "@/lib/auth";
import type { Auction, Player, Team } from "@/lib/types";
import { generateAuctionResultsPdf, type PdfTeam } from "@/lib/generateAuctionResultsPdf";
import { getPdfThemeForTeamIndex } from "@/lib/pdfTeamThemes";

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

    const allTeamsForPalette =
      teamObjectId !== null
        ? await db.collection<Team>("teams").find({ auctionId }).toArray()
        : teams;
    const sortedPalette = [...allTeamsForPalette].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const pdfThemeIndexByTeamId = new Map<string, number>();
    sortedPalette.forEach((t, i) => {
      if (t._id) pdfThemeIndexByTeamId.set(t._id.toString(), i);
    });

    // Use your provided dark IPL design (one page per team).
    const getTeamShort = (name: string) => {
      const parts = name.split(" ").filter(Boolean);
      if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
      return parts.map((p) => p[0]).join("").toUpperCase();
    };

    const teamsSortedPdf = [...teams].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const pdfTeams: PdfTeam[] = teamsSortedPdf.map((team) => {
      const t = team as Team;
      const teamIdKey = t._id?.toString() ?? "";
      const soldPlayers = (soldByTeam.get(teamIdKey) ?? []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));

      const captainName = (t.captainName ?? "").trim();
      const captainLower = captainName.toLowerCase();

      const players = soldPlayers.map((p) => {
        const raw = p.soldPrice as unknown;
        const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 0;
        const safeN = Number.isFinite(n) ? n : 0;
        return {
          name: p.name,
          price: `${safeN} pts`,
          captain: captainLower ? p.name.toLowerCase() === captainLower : false,
        };
      });

      const theme = getPdfThemeForTeamIndex(pdfThemeIndexByTeamId.get(teamIdKey) ?? 0);
      return {
        name: t.name,
        short: getTeamShort(t.name),
        captain: captainName || "-",
        colorPrimary: theme.colorPrimary,
        colorSecondary: theme.colorSecondary,
        colorAccent: theme.colorAccent,
        colorPoints: theme.colorPoints,
        players,
      };
    });

    const pdfBufferPdf = await generateAuctionResultsPdf({
      tournamentName: auction.name,
      teams: pdfTeams,
    });

    const pdfBytesPdf = new Uint8Array(pdfBufferPdf);
    return new NextResponse(pdfBytesPdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="auction-${id}${teamObjectId ? `-team-${teamObjectId.toString()}` : ""}-results.pdf"`,
        "Cache-Control": "no-store",
      },
    });

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

    const BASE_COLORS = {
      // Page & text colors (dark theme like your sample)
      background: "#0B1220",
      ink: "#E5E7EB",
      muted: "#94A3B8",
      border: "#263244",
      soft: "#0F172A",
      brand: "#0F766E",
      brandSoft: "#0B2F2D",
      tableHeader: "#0F172A",
      tableRowAlt: "#0B1220",

      // Accent
      bidGreen: "#22C55E",
    };

    const TEAM_THEMES: Record<string, Partial<typeof BASE_COLORS>> = {
      // Known sample themes (to match your provided design)
      "Mumbai Warriors": {
        brand: "#1D4ED8",
      },
      "Chennai Super Kings": {
        brand: "#F59E0B",
      },
    };

    // Fallback: assign a deterministic theme for any team name.
    const THEME_PALETTE: Array<Partial<typeof BASE_COLORS>> = [
      { brand: "#1D4ED8" },
      { brand: "#F59E0B" },
      { brand: "#7C3AED" },
      { brand: "#DC2626" },
      { brand: "#0891B2" },
      { brand: "#16A34A" },
    ];

    const stableHash = (s: string) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return h;
    };

    const getColorsForTeam = (teamName?: string) => {
      const preset = teamName ? TEAM_THEMES[teamName] : undefined;
      if (preset) return { ...BASE_COLORS, ...preset };
      const idx = teamName ? stableHash(teamName) % THEME_PALETTE.length : 0;
      return { ...BASE_COLORS, ...THEME_PALETTE[idx] };
    };

    // Header/stat section: only use a team theme if teamId is provided.
    const headerTeamName = teamObjectId && teams.length > 0 ? teams[0]?.name : undefined;

    let COLORS = getColorsForTeam(headerTeamName);

    const drawPageBackground = () => {
      doc.save();
      doc.rect(0, 0, page().width, page().height).fill(COLORS.background);
      doc.restore();
    };

    // Ensure every new page also has the dark background.
    doc.on("pageAdded", () => {
      // When pdfkit switches pages, our helpers will continue to use updated `doc.page`.
      drawPageBackground();
      // Reset the Y position so subsequent drawing starts at the expected margin.
      doc.y = doc.page.margins.top;
    });
    // First page background
    drawPageBackground();

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

    const getTeamCode = (name?: string) => {
      if (!name) return "";
      const parts = name.split(" ").filter(Boolean);
      if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    };

    const drawHeader = () => {
      const headerH = 110;
      const y = 0;
      const teamName = headerTeamName;
      const teamCode = getTeamCode(teamName);

      doc.save();
      // Sample-like: dark header + top accent stripe
      doc.rect(0, y, page().width, 16).fill(COLORS.brand);
      doc.rect(0, y, page().width, headerH).fill(COLORS.background);

      // Small tournament label
      doc
        .fillColor("white")
        .fontSize(10)
        .text("IPL Mega Auction 2025", x0(), 22, {
          width: contentWidth(),
          align: "center",
        });

      // Big centered team / auction title
      doc
        .fillColor("white")
        .fontSize(24)
        .text(teamName || auction!.name, x0(), 40, {
          width: contentWidth(),
          align: "center",
        });

      // Centered pill with team code (MW / CSK style)
      if (teamCode) {
        const pillW = 60;
        const pillH = 22;
        const centerX = x0() + contentWidth() / 2 - pillW / 2;
        const pillY = 74;
        doc
          .roundedRect(centerX, pillY, pillW, pillH, 6)
          .fillColor(COLORS.brand)
          .strokeColor("white")
          .lineWidth(1)
          .stroke();
        doc
          .fillColor(COLORS.background)
          .fontSize(11)
          .text(teamCode, centerX, pillY + 5, { width: pillW, align: "center" });
      }

      doc.restore();
      doc.y = headerH + 24;
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
      doc
        .roundedRect(x0(), y, contentWidth(), h, 10)
        .fill(COLORS.soft)
        .strokeColor(COLORS.brand)
        .lineWidth(1.2)
        .stroke();
      doc.fillColor("white").fontSize(13).text(teamName, x0() + 14, y + 10, {
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

    const drawPlayersTable = (players: Array<{ name: string; price: number }>) => {
      const tableX = x0();
      const tableW = contentWidth();
      const rowH = 22;
      const headerH = 24;
      const colIndexW = Math.floor(tableW * 0.08);
      const colNameW = Math.floor(tableW * 0.6);
      const colBidW = tableW - colIndexW - colNameW;

      // Header
      ensureSpace(headerH + rowH * Math.min(players.length, 3) + 20);
      const y0 = doc.y;
      doc.save();
      doc
        .roundedRect(tableX, y0, tableW, headerH, 8)
        .fill(COLORS.tableHeader)
        .strokeColor(COLORS.brand)
        .lineWidth(1)
        .stroke();
      doc.fillColor("white").fontSize(10);
      doc.text("#", tableX + 8, y0 + 7, { width: colIndexW - 12 });
      doc.text("Player Name", tableX + colIndexW, y0 + 7, {
        width: colNameW - 16,
      });
      doc.text("Bid Points", tableX + colIndexW + colNameW, y0 + 7, {
        width: colBidW - 10,
        align: "right",
      });
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
        doc.text(`${i + 1}`, tableX + 8, y + 6, { width: colIndexW - 12 });
        doc.text(p.name, tableX + colIndexW, y + 6, {
          width: colNameW - 16,
        });
        doc.fillColor(COLORS.bidGreen);
        doc.text(`${p.price} pts`, tableX + colIndexW + colNameW, y + 6, {
          width: colBidW - 10,
          align: "right",
        });
        doc.fillColor(COLORS.ink);
        doc.restore();

        y += rowH;
        doc.y = y;
      }

      doc.moveDown(0.8);
    };

    // -------- Cover / Summary --------
    drawHeader();
    drawInfoRow(
      `Date: ${formatDateTime(new Date(auction!.date))}`,
      `Generated: ${formatDateTime(new Date())}`
    );

    const totalSold = playersSold.length;
    const totalSoldPoints = playersSold.reduce((sum, p) => {
      const raw = p.soldPrice as unknown;
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 0;
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    drawStatCards(
      teamObjectId
        ? [
            { label: "Sold Players", value: `${totalSold}` },
            { label: "Bid Points", value: `${totalSoldPoints}` },
          ]
        : [
            { label: "Teams", value: `${teams.length}` },
            { label: "Sold Players", value: `${totalSold}` },
            { label: "Total Bid Points", value: `${totalSoldPoints}` },
          ]
    );

    // In team-wise PDF, the team header + table already provides context.
    // Skipping this title improves alignment and matches your requested look.
    if (!teamObjectId) {
      drawSectionTitle(
        "Teams Summary",
        "Players bought list with bid price and remaining budget"
      );
    }

    // Stable order for PDF
    const teamsSorted = [...teams].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    for (const team of teamsSorted) {
      const t = team as TeamLike;
      // Apply per-team theme so every team section has different colors.
      COLORS = getColorsForTeam(team.name);

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
        .map((p) => {
          const raw = p.soldPrice as unknown;
          const n =
            typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 0;
          return { name: p.name, price: Number.isFinite(n) ? n : 0 };
        });
      drawPlayersTable(rows);

      const teamSpent = rows.reduce((s, r) => s + r.price, 0);
      doc.save();
      doc
        .fillColor(COLORS.ink)
        .fontSize(11)
        .text(`Total Bid Points: ${teamSpent}`, {
          align: "right",
        });
      doc.restore();
      doc.moveDown(0.8);
      hr(6);
    }

    // Reset to default before footer (avoid "last team" color leak).
    COLORS = BASE_COLORS;

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
      doc.text(auction!.name, x0(), footerY, { width: contentWidth() / 2, align: "left" });
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

