// ============================================================================
// pdf-ocr.js — Raster PDF (Poppler pdftoppm) + Google Vision OCR từng trang
// ----------------------------------------------------------------------------
// Claude đọc PDF trực tiếp (text/layout). Module này BỔ SUNG toạ độ chữ/số đo
// theo TỪNG TRANG khi bật OCR — phục vụ b07_relationship + goiYSoDo.
//
// Yêu cầu host: poppler-utils (pdftoppm) trên PATH.
// Render: thêm build command cài poppler HOẶC dùng Docker image có sẵn.
// Không có pdftoppm → trả lỗi rõ, không crash analyze Claude.
//
// Chi phí: 1 unit Google Vision / trang (có cache hash ảnh trang trong vision-google).
// ============================================================================

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile, execFileSync } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const MAX_PAGES = Math.max(1, Number(process.env.VISION_PDF_MAX_PAGES) || 8);
const DPI = Math.max(72, Math.min(200, Number(process.env.VISION_PDF_DPI) || 150));
const CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.VISION_PDF_CONCURRENCY) || 2));

let pdftoppmOk = null;
function kiemTraPdftoppm() {
  if (pdftoppmOk !== null) return pdftoppmOk;
  try {
    execFileSync("pdftoppm", ["-v"], { stdio: "pipe" });
    pdftoppmOk = true;
  } catch (e) {
    pdftoppmOk = false;
  }
  return pdftoppmOk;
}

function thuMucTam() {
  const dir = path.join(os.tmpdir(), "qs-pdf-ocr-" + crypto.randomBytes(6).toString("hex"));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function xoaThuMuc(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) { /* ignore */ }
}

/**
 * Raster PDF base64 → mảng { page, base64, mediaType }
 * @param {string} pdfBase64
 * @param {{ maxPages?: number, dpi?: number }} [opts]
 */
async function rasterPdfToImages(pdfBase64, opts = {}) {
  if (!kiemTraPdftoppm()) {
    const err = new Error("Host chưa có pdftoppm (poppler-utils). Cài poppler-utils hoặc bỏ OCR PDF.");
    err.code = "NO_PDFTOPPM";
    throw err;
  }
  const maxPages = opts.maxPages || MAX_PAGES;
  const dpi = opts.dpi || DPI;
  const dir = thuMucTam();
  const pdfPath = path.join(dir, "in.pdf");
  const prefix = path.join(dir, "page");

  try {
    fs.writeFileSync(pdfPath, Buffer.from(pdfBase64, "base64"));
    // -jpeg -r DPI -f 1 -l maxPages
    await execFileAsync(
      "pdftoppm",
      ["-jpeg", "-r", String(dpi), "-f", "1", "-l", String(maxPages), pdfPath, prefix],
      { timeout: 120_000, maxBuffer: 20 * 1024 * 1024 }
    );

    const files = fs.readdirSync(dir)
      .filter((f) => /^page-\d+\.jpg$/i.test(f) || /^page\d+\.jpg$/i.test(f))
      .sort((a, b) => {
        const na = Number((a.match(/(\d+)/) || [])[1] || 0);
        const nb = Number((b.match(/(\d+)/) || [])[1] || 0);
        return na - nb;
      });

    // pdftoppm đặt tên page-1.jpg hoặc page1.jpg tùy bản
    const images = files.map((f, idx) => {
      const buf = fs.readFileSync(path.join(dir, f));
      const m = f.match(/(\d+)/);
      const page = m ? Number(m[1]) : idx + 1;
      return {
        page,
        base64: buf.toString("base64"),
        mediaType: "image/jpeg",
        bytes: buf.length,
      };
    });

    return {
      soTrangRaster: images.length,
      maxPages,
      dpi,
      truncated: images.length >= maxPages,
      images,
    };
  } finally {
    xoaThuMuc(dir);
  }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/**
 * OCR toàn bộ (hoặc giới hạn) trang PDF.
 * @param {string} pdfBase64
 * @param {function} ocrFn - (base64, mediaType) => Promise<ocrResult>
 * @param {object} [opts]
 */
async function ocrPdfNhieuTrang(pdfBase64, ocrFn, opts = {}) {
  const raster = await rasterPdfToImages(pdfBase64, opts);
  // Ưu tiên batch 1 HTTP (ocrFn.batch) — ít RTT hơn gọi từng trang
  let pages;
  if (typeof ocrFn.batch === "function") {
    try {
      const batchResults = await ocrFn.batch(
        raster.images.map((img) => ({ base64: img.base64, mediaType: img.mediaType }))
      );
      pages = raster.images.map((img, i) => {
        const kq = batchResults[i] || {};
        const ok = !kq.error && !kq.skipped;
        return {
          page: img.page,
          ok,
          fromCache: !!(kq && kq.fromCache),
          tongSoText: kq?.tongSoText || 0,
          goiYSoDo: (kq?.goiYSoDo || []).map((t) => ({ ...t, page: img.page })),
          items: (kq?.items || []).map((t) => ({ ...t, page: img.page })),
          error: kq?.error || kq?.skipped || null,
        };
      });
    } catch (e) {
      // fallback từng trang
      pages = null;
    }
  }
  if (!pages) {
  pages = await mapPool(raster.images, CONCURRENCY, async (img) => {
    try {
      const kq = await ocrFn(img.base64, img.mediaType);
      return {
        page: img.page,
        ok: true,
        fromCache: !!(kq && kq.fromCache),
        tongSoText: kq?.tongSoText || 0,
        goiYSoDo: (kq?.goiYSoDo || []).map((t) => ({ ...t, page: img.page })),
        items: (kq?.items || []).map((t) => ({ ...t, page: img.page })),
        error: kq?.error || null,
      };
    } catch (e) {
      return {
        page: img.page,
        ok: false,
        tongSoText: 0,
        goiYSoDo: [],
        items: [],
        error: e.message || String(e),
      };
    }
  });
  }

  const allItems = pages.flatMap((p) => p.items || []);
  const allGoiY = pages.flatMap((p) => p.goiYSoDo || []);

  return {
    loai: "pdf_multipage",
    soTrangRaster: raster.soTrangRaster,
    maxPages: raster.maxPages,
    dpi: raster.dpi,
    truncated: raster.truncated,
    soTrangOcrOk: pages.filter((p) => p.ok).length,
    pages,
    // Format khớp b07_relationship (cần items[].text + evidence_region)
    items: allItems,
    goiYSoDo: allGoiY,
    tongSoText: allItems.length,
  };
}

// Convenience: ocrPdf(base64, apiKey) — wrapper cho snippet / client cũ
async function ocrPdf(pdfBase64, apiKeyOrOcrFn, opts = {}) {
  let ocrFn = apiKeyOrOcrFn;
  if (typeof apiKeyOrOcrFn === "string") {
    const key = apiKeyOrOcrFn;
    const vg = require("./vision-google.js");
    ocrFn = (b64, mt) => vg.ocrGoogleVision(b64, mt, key);
    if (vg.ocrGoogleVisionBatch) {
      ocrFn.batch = (imgs) => vg.ocrGoogleVisionBatch(imgs, key);
    }
  }
  return ocrPdfNhieuTrang(pdfBase64, ocrFn, opts);
}

module.exports = {
  kiemTraPdftoppm,
  rasterPdfToImages,
  ocrPdfNhieuTrang,
  ocrPdf,
  MAX_PAGES,
  DPI,
};
