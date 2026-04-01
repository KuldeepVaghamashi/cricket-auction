import PDFDocument from "pdfkit";

// ─── PDF-specific types ───────────────────────────────────────────────────

export interface PdfPlayer {
  name: string;
  price: string; // e.g. "18 pts"
  captain?: boolean;
}

export interface PdfTeam {
  name: string; // Full team name
  short: string; // e.g. "MW"
  captain: string;

  colorPrimary: string;
  colorSecondary: string;
  colorAccent: string;

  players: PdfPlayer[];
}

export interface AuctionPdfInput {
  tournamentName: string;
  teams: PdfTeam[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 51; // ~18mm in points

// ─── Helpers ───────────────────────────────────────────────────────────────

function roundedRect(
  doc: PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fillHex?: string,
  strokeHex?: string,
  strokeWidth = 1,
  opacity = 1
) {
  doc.save();
  doc.opacity(opacity);
  if (fillHex) doc.fillColor(fillHex);
  if (strokeHex) doc.strokeColor(strokeHex).lineWidth(strokeWidth);
  const path = doc.roundedRect(x, y, w, h, r);
  if (fillHex && strokeHex) path.fillAndStroke();
  else if (fillHex) path.fill();
  else if (strokeHex) path.stroke();
  doc.restore();
}

function polygon(
  doc: PDFDocument,
  points: [number, number][],
  fillHex: string,
  opacity: number
) {
  doc.save();
  doc.opacity(opacity);
  doc.fillColor(fillHex);
  doc.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) doc.lineTo(points[i][0], points[i][1]);
  doc.closePath().fill();
  doc.restore();
}

function centredText(
  doc: PDFDocument,
  text: string,
  y: number,
  font: string,
  size: number,
  color: string
) {
  doc.font(font).fontSize(size).fillColor(color);
  const w = doc.widthOfString(text);
  doc.text(text, (A4_W - w) / 2, y, { lineBreak: false });
}

// ─── Drawing sections ─────────────────────────────────────────────────────

function drawBackground(doc: PDFDocument, team: PdfTeam) {
  // Main dark background
  doc.rect(0, 0, A4_W, A4_H).fillColor("#0A0E1A").fill();

  // Decorative circles
  doc.save();
  doc.opacity(0.08);
  doc.circle(A4_W - 85, -57, 340).fillColor(team.colorPrimary).fill();
  doc.restore();

  doc.save();
  doc.opacity(0.06);
  doc.circle(-57, A4_H + 57, 255).fillColor(team.colorSecondary).fill();
  doc.restore();

  // Diagonal accents
  polygon(
    doc,
    [
      [0, A4_H * 0.68],
      [A4_W * 0.55, A4_H],
      [A4_W * 0.65, A4_H],
      [0, A4_H * 0.60],
    ],
    team.colorPrimary,
    0.12
  );

  polygon(
    doc,
    [
      [A4_W * 0.3, 0],
      [A4_W, A4_H * 0.4],
      [A4_W, A4_H * 0.5],
      [A4_W * 0.35, 0],
    ],
    team.colorSecondary,
    0.07
  );
}

function drawHeader(doc: PDFDocument, team: PdfTeam, tournamentName: string) {
  const headerH = 147; // ~52mm
  const bx = MARGIN - 6;
  const bw = A4_W - 2 * MARGIN + 12;

  // Header card background
  roundedRect(doc, bx, MARGIN, bw, headerH, 23, "#111827");

  // Coloured top bar
  roundedRect(doc, bx, MARGIN, bw, 23, 8, team.colorPrimary);

  // Tournament name
  const tournLabel = "  " + tournamentName.toUpperCase();
  centredText(doc, tournLabel, MARGIN + 32, "Helvetica-Bold", 9, team.colorAccent);

  // Divider line
  const lineY = MARGIN + 54;
  doc.save();
  doc.strokeColor(team.colorPrimary).lineWidth(0.8);
  doc.moveTo(MARGIN + 57, lineY);
  doc.lineTo(A4_W - MARGIN - 57, lineY);
  doc.stroke();
  doc.restore();

  // Remove duplicated team name in the header and show it only once
  // in a larger, well-sized badge (matches your sample requirement).
  const badgeText = (team.name || team.short).toUpperCase();
  const badgeFontSize = 15;
  doc.font("Helvetica-Bold").fontSize(badgeFontSize);
  const badgeTextW = doc.widthOfString(badgeText);
  const badgeW = Math.min(bw - 80, Math.max(120, badgeTextW + 40));
  const badgeH = 38;
  const badgeX = A4_W / 2 - badgeW / 2;
  // Move badge closer to divider for tighter header spacing.
  const badgeY = MARGIN + 84;
  roundedRect(doc, badgeX, badgeY, badgeW, badgeH, 8, team.colorPrimary);
  centredText(doc, badgeText, badgeY + 11, "Helvetica-Bold", badgeFontSize, "#FFFFFF");
}

function drawCaptainBanner(doc: PDFDocument, team: PdfTeam) {
  const by = MARGIN + 162; // just below header
  const bh = 40;
  const bx = MARGIN - 6;
  const bw = A4_W - 2 * MARGIN + 12;

  // Banner background
  roundedRect(doc, bx, by, bw, bh, 11, "#1E2A3A");

  // Left accent bar
  roundedRect(doc, bx, by, 11, bh, 6, team.colorAccent);

  // "CAPTAIN" label
  doc.font("Helvetica-Bold").fontSize(8).fillColor(team.colorAccent).text("  CAPTAIN", bx + 22, by + 8);

  // Captain name centred
  centredText(doc, (team.captain || "").toUpperCase(), by + 18, "Helvetica-Bold", 14, "#FFFFFF");

  // Right accent bar
  roundedRect(doc, bx + bw - 11, by, 11, bh, 6, team.colorAccent);
}

function drawPlayerTable(doc: PDFDocument, team: PdfTeam): number {
  const tableTop = MARGIN + 216; // just below captain banner
  const rowH = 38;
  const colW = [28, 360, 99]; // # | Player Name | Bid Price
  const tableW = colW[0] + colW[1] + colW[2];
  const tx = (A4_W - tableW) / 2;

  // Header row
  const hdrH = 23;
  roundedRect(doc, tx, tableTop, tableW, hdrH, 6, team.colorPrimary);

  const headers = ["#", "PLAYER NAME", "BID PRICE"];
  const hdrX = [
    tx + colW[0] / 2,
    tx + colW[0] + colW[1] * 0.05,
    tx + colW[0] + colW[1] + colW[2] / 2,
  ];
  const hdrAlign: Array<"center" | "left"> = ["center", "left", "center"];

  doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF");
  headers.forEach((h, i) => {
    if (hdrAlign[i] === "center") {
      const textW = doc.widthOfString(h);
      doc.text(h, hdrX[i] - textW / 2, tableTop + 8);
    } else {
      doc.text(h, hdrX[i], tableTop + 8);
    }
  });

  // Player rows
  let finalY = tableTop + hdrH;
  team.players.forEach((player, idx) => {
    const ry = tableTop + hdrH + idx * rowH;
    const isCapt = !!player.captain;
    const isEven = idx % 2 === 0;

    const rowBg = isCapt ? "#1A2535" : isEven ? "#111827" : "#0D1520";
    doc.rect(tx, ry, tableW, rowH).fillColor(rowBg).fill();

    // Left accent bar for captain
    if (isCapt) doc.rect(tx, ry, 3, rowH).fillColor(team.colorAccent).fill();

    // Row number
    const numStr = String(idx + 1);
    const numW = doc.font(isCapt ? "Helvetica-Bold" : "Helvetica").fontSize(8).widthOfString(numStr);
    doc.fillColor(isCapt ? team.colorAccent : "#6B7280").text(numStr, tx + colW[0] / 2 - numW / 2, ry + rowH / 2 - 5);

    // Player name (no extra "(C)" so it matches your table)
    doc
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .fillColor(isCapt ? team.colorAccent : "#E5E7EB")
      .text(player.name, tx + colW[0] + 9, ry + rowH / 2 - 5, { lineBreak: false });

    // Bid price (centred)
    const priceW = doc.font("Helvetica-Bold").fontSize(9).widthOfString(player.price);
    const priceX = tx + colW[0] + colW[1] + colW[2] / 2 - priceW / 2;
    doc.fillColor("#4ADE80").text(player.price, priceX, ry + rowH / 2 - 5, { lineBreak: false });

    // Separator
    doc
      .save()
      .strokeColor("#1F2937")
      .lineWidth(0.4)
      .moveTo(tx, ry)
      .lineTo(tx + tableW, ry)
      .stroke()
      .restore();

    finalY = ry + rowH;
  });

  // Bottom border of table
  doc.save().strokeColor(team.colorPrimary).lineWidth(1).moveTo(tx, finalY).lineTo(tx + tableW, finalY).stroke().restore();

  return finalY;
}

function drawFooter(doc: PDFDocument, team: PdfTeam, tableBotY: number) {
  // Parse total from price strings like "18 pts"
  const total = team.players.reduce((sum, p) => {
    const numeric = p.price.replace(/[^\d.]/g, "");
    const n = parseFloat(numeric);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const fy = tableBotY + 16;
  const fh = 57;
  const fx = MARGIN - 6;
  const fw = A4_W - 2 * MARGIN + 12;

  roundedRect(doc, fx, fy, fw, fh, 11, "#111827");

  // Total bid amount (left)
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(team.colorAccent).text("TOTAL BID AMOUNT", fx + 22, fy + 10);
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#4ADE80").text(`${total} pts`, fx + 22, fy + 28);

  // Total players (right)
  const playerCountStr = String(team.players.length);
  const labelStr = "TOTAL PLAYERS";
  const labelW = doc.font("Helvetica-Bold").fontSize(7.5).widthOfString(labelStr);
  const countW = doc.font("Helvetica-Bold").fontSize(14).widthOfString(playerCountStr);
  const rightEdge = fx + fw - 22;

  doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#6B7280").text(labelStr, rightEdge - labelW, fy + 10);
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#FFFFFF").text(playerCountStr, rightEdge - countW, fy + 28);

  // Branding (matches the dark look; adjust as needed)
  centredText(
    doc,
    "Generated by Cricket Auction App  \u2022  Official Results\nDesigned and developed by Kuldeep Ahir",
    A4_H - MARGIN / 2 - 6,
    "Helvetica",
    7,
    "#4B5563"
  );
}

// ─── Main export ───────────────────────────────────────────────────────────

export function generateAuctionResultsPdf(input: AuctionPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: { Title: "Cricket Auction Results" },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    input.teams.forEach((team, i) => {
      if (i > 0) doc.addPage();
      drawBackground(doc, team);
      drawHeader(doc, team, input.tournamentName);
      drawCaptainBanner(doc, team);
      const tableBottom = drawPlayerTable(doc, team);
      drawFooter(doc, team, tableBottom);
    });

    doc.end();
  });
}

