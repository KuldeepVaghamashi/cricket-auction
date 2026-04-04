import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

// ─── PDF-specific types ───────────────────────────────────────────────────

export interface PdfPlayer {
  name: string;
  price: string; // e.g. "18 pts"
  captain?: boolean;
}

export interface PdfTeam {
  name: string;
  short: string;
  captain: string;
  colorPrimary: string;
  colorSecondary: string;
  colorAccent: string;
  colorPoints: string;
  players: PdfPlayer[];
}

export interface AuctionPdfInput {
  tournamentName: string;
  teams: PdfTeam[];
}

export type PdfFonts = { reg: string; bold: string };

// ─── Surface tokens (aligned with app dark arena / globals) ────────────────

const SURFACE_BG = "#0b0f17";
const SURFACE_CARD = "#101722";
const SURFACE_CARD_DEEP = "#0d121c";
const SURFACE_MUTED = "#64748b";
const SURFACE_TEXT = "#e2e8f0";
const SURFACE_BORDER = "#1e293b";

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 48;

// ─── Outfit (same family as UI via next/font Outfit) ───────────────────────

function resolvePdfFonts(doc: PDFDocument): PdfFonts {
  const dir = path.join(process.cwd(), "lib", "fonts", "outfit");
  const regular = path.join(dir, "Outfit-Regular.ttf");
  const bold = path.join(dir, "Outfit-Bold.ttf");
  if (fs.existsSync(regular) && fs.existsSync(bold)) {
    doc.registerFont("Outfit", regular);
    doc.registerFont("Outfit-Bold", bold);
    return { reg: "Outfit", bold: "Outfit-Bold" };
  }
  return { reg: "Helvetica", bold: "Helvetica-Bold" };
}

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
  const rr = doc.roundedRect(x, y, w, h, r);
  if (fillHex && strokeHex) rr.fillAndStroke();
  else if (fillHex) rr.fill();
  else if (strokeHex) rr.stroke();
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
  fonts: PdfFonts,
  text: string,
  y: number,
  bold: boolean,
  size: number,
  color: string,
  charSpace = 0
) {
  doc.save();
  doc.font(bold ? fonts.bold : fonts.reg).fontSize(size).fillColor(color);
  const measureOpts = charSpace ? { characterSpacing: charSpace } : {};
  const textOpts = charSpace
    ? { lineBreak: false as const, characterSpacing: charSpace }
    : { lineBreak: false as const };
  const w = doc.widthOfString(text, measureOpts);
  doc.text(text, (A4_W - w) / 2, y, textOpts);
  doc.restore();
}

function drawBackground(doc: PDFDocument, team: PdfTeam) {
  doc.rect(0, 0, A4_W, A4_H).fillColor(SURFACE_BG).fill();

  doc.save();
  doc.opacity(0.09);
  doc.circle(A4_W - 72, -48, 320).fillColor(team.colorPrimary).fill();
  doc.restore();

  doc.save();
  doc.opacity(0.055);
  doc.circle(-52, A4_H + 52, 240).fillColor(team.colorSecondary).fill();
  doc.restore();

  polygon(
    doc,
    [
      [0, A4_H * 0.72],
      [A4_W * 0.52, A4_H],
      [A4_W * 0.62, A4_H],
      [0, A4_H * 0.64],
    ],
    team.colorPrimary,
    0.11
  );

  polygon(
    doc,
    [
      [A4_W * 0.28, 0],
      [A4_W, A4_H * 0.38],
      [A4_W, A4_H * 0.48],
      [A4_W * 0.32, 0],
    ],
    team.colorSecondary,
    0.065
  );

  // Soft top wash
  doc.save();
  doc.opacity(0.04);
  doc.rect(0, 0, A4_W, 120).fillColor(team.colorAccent).fill();
  doc.restore();
}

function drawHeader(doc: PDFDocument, fonts: PdfFonts, team: PdfTeam, tournamentName: string) {
  const headerH = 158;
  const bx = MARGIN - 4;
  const bw = A4_W - 2 * MARGIN + 8;
  const rCard = 20;

  // Shadow slab
  roundedRect(doc, bx + 3, MARGIN + 4, bw, headerH, rCard, "#000000", undefined, 0, 0.35);

  roundedRect(doc, bx, MARGIN, bw, headerH, rCard, SURFACE_CARD, SURFACE_BORDER, 0.55, 1);

  const barH = 26;
  roundedRect(doc, bx, MARGIN, bw, barH, 10, team.colorPrimary);

  doc
    .font(fonts.bold)
    .fontSize(6.5)
    .fillColor("#ffffff")
    .text("AUCTIONARENA", bx + 18, MARGIN + 8, { lineBreak: false, characterSpacing: 1.8 });

  const tourn = tournamentName.toUpperCase();
  centredText(doc, fonts, tourn, MARGIN + 36, true, 8.5, team.colorAccent, 0.9);

  const lineY = MARGIN + 58;
  doc.save();
  doc.strokeColor(team.colorPrimary).opacity(0.45).lineWidth(0.75);
  doc.moveTo(bx + 40, lineY).lineTo(bx + bw - 40, lineY).stroke();
  doc.restore();

  const badgeText = (team.name || team.short).toUpperCase();
  doc.font(fonts.bold).fontSize(16);
  const badgeTextW = doc.widthOfString(badgeText);
  const badgeW = Math.min(bw - 72, Math.max(132, badgeTextW + 48));
  const badgeH = 42;
  const badgeX = A4_W / 2 - badgeW / 2;
  const badgeY = MARGIN + 88;

  roundedRect(doc, badgeX + 2, badgeY + 2, badgeW, badgeH, 11, "#000000", undefined, 0, 0.2);
  roundedRect(doc, badgeX, badgeY, badgeW, badgeH, 11, team.colorPrimary);
  doc.save();
  doc.rect(badgeX, badgeY, badgeW, badgeH * 0.42).fillColor("#ffffff").opacity(0.08).fill();
  doc.restore();

  centredText(doc, fonts, badgeText, badgeY + 12, true, 16, "#FFFFFF");
}

function drawCaptainBanner(doc: PDFDocument, fonts: PdfFonts, team: PdfTeam) {
  const by = MARGIN + 172;
  const bh = 44;
  const bx = MARGIN - 4;
  const bw = A4_W - 2 * MARGIN + 8;

  roundedRect(doc, bx + 2, by + 2, bw, bh, 12, "#000000", undefined, 0, 0.22);
  roundedRect(doc, bx, by, bw, bh, 12, "#151d2e", SURFACE_BORDER, 0.5, 1);

  roundedRect(doc, bx, by, 5, bh, 3, team.colorAccent);
  roundedRect(doc, bx + bw - 5, by, 5, bh, 3, team.colorAccent);

  doc
    .font(fonts.bold)
    .fontSize(7)
    .fillColor(team.colorAccent)
    .text("CAPTAIN", bx + 18, by + 10, { lineBreak: false, characterSpacing: 1.4 });

  centredText(doc, fonts, (team.captain || "—").toUpperCase(), by + 20, true, 13.5, SURFACE_TEXT);
}

function drawPlayerTable(doc: PDFDocument, fonts: PdfFonts, team: PdfTeam): number {
  const tableTop = MARGIN + 232;
  const rowH = 40;
  const colW = [32, 348, 108];
  const tableW = colW[0] + colW[1] + colW[2];
  const tx = (A4_W - tableW) / 2;
  const pad = 4;
  const hdrH = 28;

  roundedRect(doc, tx, tableTop, tableW, hdrH, 8, team.colorPrimary);

  const headers = ["#", "PLAYER", "BID (PTS)"];
  const hdrX = [
    tx + colW[0] / 2,
    tx + colW[0] + colW[1] * 0.06,
    tx + colW[0] + colW[1] + colW[2] / 2,
  ];
  const hdrAlign: Array<"center" | "left"> = ["center", "left", "center"];
  const hdrTextOpts = { characterSpacing: 1.1 };

  doc.font(fonts.bold).fontSize(7.5).fillColor("#ffffff");
  headers.forEach((h, i) => {
    const textW = doc.widthOfString(h, hdrTextOpts);
    if (hdrAlign[i] === "center") {
      doc.text(h, hdrX[i] - textW / 2, tableTop + 9, { lineBreak: false, ...hdrTextOpts });
    } else {
      doc.text(h, hdrX[i], tableTop + 9, { lineBreak: false, ...hdrTextOpts });
    }
  });

  let finalY = tableTop + hdrH;
  team.players.forEach((player, idx) => {
    const ry = tableTop + hdrH + idx * rowH;
    const isCapt = !!player.captain;
    const isEven = idx % 2 === 0;

    const rowBg = isCapt ? "#141c2e" : isEven ? SURFACE_CARD : SURFACE_CARD_DEEP;
    doc.rect(tx, ry, tableW, rowH).fillColor(rowBg).fill();

    if (isCapt) doc.rect(tx, ry, 4, rowH).fillColor(team.colorAccent).fill();

    const numStr = String(idx + 1);
    const numW = doc
      .font(isCapt ? fonts.bold : fonts.reg)
      .fontSize(8.5)
      .widthOfString(numStr);
    doc
      .fillColor(isCapt ? team.colorAccent : SURFACE_MUTED)
      .text(numStr, tx + colW[0] / 2 - numW / 2, ry + rowH / 2 - 5);

    doc
      .font(fonts.bold)
      .fontSize(10)
      .fillColor(isCapt ? team.colorAccent : SURFACE_TEXT)
      .text(player.name, tx + colW[0] + 12, ry + rowH / 2 - 5, { lineBreak: false });

    const priceW = doc.font(fonts.bold).fontSize(9.5).widthOfString(player.price);
    const priceX = tx + colW[0] + colW[1] + colW[2] / 2 - priceW / 2;
    doc.fillColor(team.colorPoints).text(player.price, priceX, ry + rowH / 2 - 5, { lineBreak: false });

    doc.save().strokeColor(SURFACE_BORDER).opacity(0.85).lineWidth(0.35).moveTo(tx, ry).lineTo(tx + tableW, ry).stroke().restore();

    finalY = ry + rowH;
  });

  doc.save().strokeColor(team.colorPrimary).opacity(0.55).lineWidth(1.1).moveTo(tx, finalY).lineTo(tx + tableW, finalY).stroke().restore();

  const frameTop = tableTop - pad;
  const frameH = finalY - frameTop + pad;
  roundedRect(
    doc,
    tx - pad,
    frameTop,
    tableW + pad * 2,
    frameH,
    14,
    undefined,
    team.colorPrimary,
    0.75,
    0.28
  );

  return finalY;
}

function drawFooter(doc: PDFDocument, fonts: PdfFonts, team: PdfTeam, tableBotY: number) {
  const total = team.players.reduce((sum, p) => {
    const numeric = p.price.replace(/[^\d.]/g, "");
    const n = parseFloat(numeric);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const fy = tableBotY + 20;
  const fh = 62;
  const fx = MARGIN - 4;
  const fw = A4_W - 2 * MARGIN + 8;

  roundedRect(doc, fx + 2, fy + 2, fw, fh, 14, "#000000", undefined, 0, 0.2);
  roundedRect(doc, fx, fy, fw, fh, 14, SURFACE_CARD, SURFACE_BORDER, 0.55, 1);

  const midX = fx + fw * 0.52;
  doc.save();
  doc.strokeColor(team.colorPrimary).opacity(0.25).lineWidth(0.6);
  doc.moveTo(midX, fy + 14).lineTo(midX, fy + fh - 14).stroke();
  doc.restore();

  const labelTrack = { lineBreak: false as const, characterSpacing: 1.2 };

  doc.font(fonts.bold).fontSize(7).fillColor(team.colorAccent);
  doc.text("TOTAL BID", fx + 22, fy + 12, labelTrack);
  doc.font(fonts.bold).fontSize(17).fillColor(team.colorPoints).text(`${total} pts`, fx + 22, fy + 30);

  const playerCountStr = String(team.players.length);
  doc.font(fonts.bold).fontSize(7).fillColor(SURFACE_MUTED);
  doc.text("SQUAD SIZE", midX + 18, fy + 12, labelTrack);
  doc.font(fonts.bold).fontSize(17).fillColor(SURFACE_TEXT).text(playerCountStr, midX + 18, fy + 30);

  doc.font(fonts.reg).fontSize(6.8).fillColor("#475569");
  const footTrack = { lineBreak: false as const, characterSpacing: 0.4 };
  const foot1 = "AuctionArena · Official results";
  const w1 = doc.widthOfString(foot1, { characterSpacing: 0.4 });
  doc.text(foot1, (A4_W - w1) / 2, A4_H - 52, footTrack);
  const foot2 = "Designed and developed by Kuldeep Ahir";
  const w2 = doc.widthOfString(foot2, { characterSpacing: 0.4 });
  doc.text(foot2, (A4_W - w2) / 2, A4_H - 40, footTrack);
}

// ─── Main export ───────────────────────────────────────────────────────────

export function generateAuctionResultsPdf(input: AuctionPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: {
        Title: `${input.tournamentName} · Results`,
        Author: "AuctionArena",
        Subject: "Auction results",
      },
    });

    const fonts = resolvePdfFonts(doc);

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    input.teams.forEach((team, i) => {
      if (i > 0) doc.addPage();
      drawBackground(doc, team);
      drawHeader(doc, fonts, team, input.tournamentName);
      drawCaptainBanner(doc, fonts, team);
      const tableBottom = drawPlayerTable(doc, fonts, team);
      drawFooter(doc, fonts, team, tableBottom);
    });

    doc.end();
  });
}
