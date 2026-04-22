/**
 * Professional receipt PDF generator — raw PDF 1.4 spec.
 *
 * Layout:
 *  - Black header bar with "PLUTO" wordmark + "OFFICIAL RECEIPT"
 *  - Payment amount hero (large, centered)
 *  - Status badge
 *  - Details table (label / value rows with alternating shading)
 *  - Diagonal "CONFIRMED" watermark
 *  - Signature block with decorative line
 *  - Footer with payment ID and legal note
 */

export interface ReceiptPdfData {
  merchantName?: string | null;
  paymentId: string;
  amount: string;
  asset: string;
  status: string;
  date: string;
  recipient: string;
  transactionHash: string;
  description?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 3) + "...";
}

// ── PDF builder ───────────────────────────────────────────────────────────────

export function createReceiptPdf(data: ReceiptPdfData): Blob {
  const W = 612; // letter width pts
  const H = 792; // letter height pts

  const merchant = esc(data.merchantName?.trim() || "PLUTO");
  const amount   = esc(`${data.amount} ${data.asset}`);
  const status   = esc(data.status.toUpperCase());
  const date     = esc(data.date);
  const txHash   = esc(truncate(data.transactionHash, 60));
  const payId    = esc(truncate(data.paymentId, 60));
  const recip    = esc(truncate(data.recipient, 60));
  const desc     = data.description?.trim() ? esc(truncate(data.description.trim(), 80)) : null;

  // ── Stream content ──────────────────────────────────────────────────────────
  const ops: string[] = [];

  // ── 1. Black header bar ─────────────────────────────────────────────────────
  ops.push("0 0 0 rg");                          // fill black
  ops.push(`0 ${H - 80} ${W} 80 re f`);          // rect: full width, 80pt tall

  // Header text — white
  ops.push("1 1 1 rg");
  ops.push("BT");
  ops.push("/F2 22 Tf");                          // Bold font
  ops.push(`40 ${H - 52} Td`);
  ops.push(`(${merchant}) Tj`);
  ops.push("ET");

  ops.push("BT");
  ops.push("/F1 9 Tf");
  ops.push(`40 ${H - 68} Td`);
  ops.push("(OFFICIAL PAYMENT RECEIPT) Tj");
  ops.push("ET");

  // Right-aligned date in header
  ops.push("BT");
  ops.push("/F1 9 Tf");
  ops.push(`${W - 160} ${H - 52} Td`);
  ops.push(`(${date}) Tj`);
  ops.push("ET");

  // ── 2. Amount hero ──────────────────────────────────────────────────────────
  ops.push("0 0 0 rg");
  ops.push("BT");
  ops.push("/F2 36 Tf");
  // Center the amount (approximate — PDF has no native centering without measuring)
  const amountX = Math.max(40, Math.floor((W - amount.length * 20) / 2));
  ops.push(`${amountX} ${H - 150} Td`);
  ops.push(`(${amount}) Tj`);
  ops.push("ET");

  ops.push("BT");
  ops.push("/F1 11 Tf");
  ops.push(`${Math.floor(W / 2) - 30} ${H - 170} Td`);
  ops.push("(AMOUNT DUE) Tj");
  ops.push("ET");

  // ── 3. Status badge (rounded rect approximated with filled rect) ────────────
  const isConfirmed = data.status.toLowerCase() === "confirmed" || data.status.toLowerCase() === "completed";
  if (isConfirmed) {
    ops.push("0.18 0.8 0.44 rg");               // green
  } else {
    ops.push("0.95 0.6 0.1 rg");                // amber
  }
  const badgeX = Math.floor(W / 2) - 40;
  ops.push(`${badgeX} ${H - 205} 80 20 re f`);

  ops.push("1 1 1 rg");
  ops.push("BT");
  ops.push("/F2 9 Tf");
  ops.push(`${badgeX + 12} ${H - 199} Td`);
  ops.push(`(${status}) Tj`);
  ops.push("ET");

  // ── 4. Divider line ─────────────────────────────────────────────────────────
  ops.push("0.85 0.85 0.85 RG");               // light gray stroke
  ops.push("0.5 w");
  ops.push(`40 ${H - 225} m ${W - 40} ${H - 225} l S`);

  // ── 5. Details table ────────────────────────────────────────────────────────
  const rows: [string, string][] = [
    ["Payment ID",        payId],
    ["Transaction Hash",  txHash],
    ["Recipient",         recip],
    ["Asset",             esc(`${data.asset}`)],
    ["Date",              date],
  ];
  if (desc) rows.push(["Description", desc]);

  const tableTop = H - 240;
  const rowH = 28;
  const labelX = 40;
  const valueX = 200;

  rows.forEach(([label, value], i) => {
    const y = tableTop - i * rowH;

    // Alternating row background
    if (i % 2 === 0) {
      ops.push("0.97 0.97 0.97 rg");
      ops.push(`${labelX - 4} ${y - 8} ${W - 80} ${rowH} re f`);
    }

    // Label
    ops.push("0.4 0.4 0.4 rg");
    ops.push("BT");
    ops.push("/F2 9 Tf");
    ops.push(`${labelX} ${y + 6} Td`);
    ops.push(`(${esc(label.toUpperCase())}) Tj`);
    ops.push("ET");

    // Value
    ops.push("0 0 0 rg");
    ops.push("BT");
    ops.push("/F1 10 Tf");
    ops.push(`${valueX} ${y + 6} Td`);
    ops.push(`(${value}) Tj`);
    ops.push("ET");
  });

  // ── 6. Divider ──────────────────────────────────────────────────────────────
  const afterTable = tableTop - rows.length * rowH - 20;
  ops.push("0.85 0.85 0.85 RG");
  ops.push(`40 ${afterTable} m ${W - 40} ${afterTable} l S`);

  // ── 7. Signature block ──────────────────────────────────────────────────────
  const sigY = afterTable - 60;

  // Signature line
  ops.push("0 0 0 RG");
  ops.push("0.5 w");
  ops.push(`40 ${sigY} m 220 ${sigY} l S`);

  // Cursive-style "signature" using italic Helvetica-Oblique
  ops.push("0 0 0 rg");
  ops.push("BT");
  ops.push("/F3 18 Tf");
  ops.push(`44 ${sigY + 8} Td`);
  ops.push("(PLUTO Payments) Tj");
  ops.push("ET");

  ops.push("BT");
  ops.push("/F1 8 Tf");
  ops.push(`44 ${sigY - 12} Td`);
  ops.push("(Authorized Signatory) Tj");
  ops.push("ET");

  ops.push("BT");
  ops.push("/F1 8 Tf");
  ops.push(`44 ${sigY - 22} Td`);
  ops.push("(PLUTO Payment Infrastructure) Tj");
  ops.push("ET");

  // Stamp circle (right side)
  const stampX = W - 120;
  const stampY = sigY - 10;
  ops.push("0.9 0.9 0.9 RG");
  ops.push("1 w");
  // Draw circle approximation with 4 bezier curves
  const r = 40;
  const k = 0.5523 * r;
  ops.push(`${stampX} ${stampY + r} m`);
  ops.push(`${stampX + k} ${stampY + r} ${stampX + r} ${stampY + k} ${stampX + r} ${stampY} c`);
  ops.push(`${stampX + r} ${stampY - k} ${stampX + k} ${stampY - r} ${stampX} ${stampY - r} c`);
  ops.push(`${stampX - k} ${stampY - r} ${stampX - r} ${stampY - k} ${stampX - r} ${stampY} c`);
  ops.push(`${stampX - r} ${stampY + k} ${stampX - k} ${stampY + r} ${stampX} ${stampY + r} c S`);

  ops.push("0.7 0.7 0.7 rg");
  ops.push("BT");
  ops.push("/F2 7 Tf");
  ops.push(`${stampX - 22} ${stampY + 8} Td`);
  ops.push("(VERIFIED) Tj");
  ops.push("ET");
  ops.push("BT");
  ops.push("/F1 6 Tf");
  ops.push(`${stampX - 26} ${stampY - 2} Td`);
  ops.push("(STELLAR NETWORK) Tj");
  ops.push("ET");
  ops.push("BT");
  ops.push("/F1 6 Tf");
  ops.push(`${stampX - 18} ${stampY - 12} Td`);
  ops.push("(BLOCKCHAIN) Tj");
  ops.push("ET");

  // ── 8. Diagonal "CONFIRMED" watermark ──────────────────────────────────────
  ops.push("q");                                 // save graphics state
  ops.push("0.93 0.93 0.93 rg");
  // Rotate 45° around page center
  const cx = W / 2;
  const cy = H / 2;
  ops.push(`1 0 0 1 ${cx} ${cy} cm`);           // translate to center
  ops.push("0.707 0.707 -0.707 0.707 0 0 cm");  // rotate 45°
  ops.push("BT");
  ops.push("/F2 72 Tf");
  ops.push("-160 -30 Td");
  ops.push("(CONFIRMED) Tj");
  ops.push("ET");
  ops.push("Q");                                 // restore graphics state

  // ── 9. Footer bar ───────────────────────────────────────────────────────────
  ops.push("0.95 0.95 0.95 rg");
  ops.push(`0 0 ${W} 50 re f`);

  ops.push("0.5 0.5 0.5 rg");
  ops.push("BT");
  ops.push("/F1 7 Tf");
  ops.push(`40 32 Td`);
  ops.push(`(Payment ID: ${payId}) Tj`);
  ops.push("ET");

  ops.push("BT");
  ops.push("/F1 7 Tf");
  ops.push(`40 20 Td`);
  ops.push("(This receipt is automatically generated and serves as proof of payment on the Stellar blockchain.) Tj");
  ops.push("ET");

  ops.push("BT");
  ops.push("/F1 7 Tf");
  ops.push(`40 10 Td`);
  ops.push("(Verify this transaction at stellar.expert) Tj");
  ops.push("ET");

  // ── Assemble PDF ─────────────────────────────────────────────────────────────
  const stream = ops.join("\n");

  const objects = [
    // 1: Catalog
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    // 2: Pages
    "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj",
    // 3: Page — three fonts: regular, bold, oblique
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>\nendobj`,
    // 4: Helvetica (regular)
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj",
    // 5: Helvetica-Bold
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj",
    // 6: Helvetica-Oblique (signature)
    "6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>\nendobj",
    // 7: Content stream
    `7 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];

  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += `${obj}\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
}
