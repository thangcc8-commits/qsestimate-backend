// ============================================================================
// vision-google.js — Google Vision TEXT_DETECTION + tối ưu hiệu năng/chi phí
// ----------------------------------------------------------------------------
// Tối ưu:
//   1) Cache L1 RAM + L2 Redis (hash SHA-256 ảnh)
//   2) In-flight dedupe — cùng ảnh gọi song song → 1 request API
//   3) Timeout VISION_TIMEOUT_MS (mặc định 25s)
//   4) Batch annotate (tối đa 16 ảnh / 1 HTTP) — PDF đa trang
//   5) Bỏ qua ảnh quá lớn / quá nhỏ (tránh tốn tiền + timeout)
//   6) Feature TEXT_DETECTION | DOCUMENT_TEXT_DETECTION (env)
// ============================================================================

const crypto = require("crypto");

const GOOGLE_VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
const OCR_CACHE_TTL_MS = Number(process.env.VISION_CACHE_TTL_MS) || 2 * 60 * 60 * 1000;
const OCR_CACHE_MAX = Number(process.env.VISION_CACHE_MAX) || 120;
const VISION_TIMEOUT_MS = Math.max(5_000, Number(process.env.VISION_TIMEOUT_MS) || 25_000);
const VISION_FEATURE = (process.env.VISION_FEATURE || "TEXT_DETECTION").toUpperCase() === "DOCUMENT_TEXT_DETECTION"
  ? "DOCUMENT_TEXT_DETECTION"
  : "TEXT_DETECTION";
// Giới hạn kích thước payload (byte binary). ~4MB binary ≈ an toàn dưới trần Vision
const MAX_IMAGE_BYTES = Math.max(200_000, Number(process.env.VISION_MAX_IMAGE_BYTES) || 4_000_000);
const MIN_IMAGE_BYTES = Math.max(100, Number(process.env.VISION_MIN_IMAGE_BYTES) || 800);
const BATCH_MAX = Math.min(16, Math.max(1, Number(process.env.VISION_BATCH_MAX) || 8));

const ocrCache = new Map();
const inflight = new Map(); // key → Promise — dedupe concurrent
let cacheHits = 0, cacheMisses = 0, apiCalls = 0, batchCalls = 0, dedupeHits = 0, skippedLarge = 0;
let redisLayer = null;

function ganRedisLayer(mod) {
  redisLayer = mod || null;
}

function hashAnh(base64) {
  return crypto.createHash("sha256").update(String(base64 || "")).digest("hex");
}

function uocLuongBytes(base64) {
  // base64 length * 3/4
  return Math.floor((String(base64 || "").length * 3) / 4);
}

function layTuCacheRam(key) {
  const hit = ocrCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > OCR_CACHE_TTL_MS) {
    ocrCache.delete(key);
    return null;
  }
  // LRU touch
  ocrCache.delete(key);
  ocrCache.set(key, hit);
  return hit.result;
}

function ghiCacheRam(key, result) {
  while (ocrCache.size >= OCR_CACHE_MAX) {
    const first = ocrCache.keys().next().value;
    if (first == null) break;
    ocrCache.delete(first);
  }
  ocrCache.set(key, { at: Date.now(), result });
}

function thongKeCacheOcr() {
  return {
    layer1_ram: { size: ocrCache.size, max: OCR_CACHE_MAX, ttlMs: OCR_CACHE_TTL_MS },
    hits: cacheHits,
    misses: cacheMisses,
    apiCalls,
    batchCalls,
    dedupeHits,
    skippedLarge,
    feature: VISION_FEATURE,
    timeoutMs: VISION_TIMEOUT_MS,
    batchMax: BATCH_MAX,
    redis: redisLayer && redisLayer.thongKeRedis ? redisLayer.thongKeRedis() : { enabled: false, ready: false },
  };
}

async function xoaCacheOcr() {
  ocrCache.clear();
  inflight.clear();
  let redisCleared = 0;
  if (redisLayer && redisLayer.redisFlushPrefix) {
    redisCleared = await redisLayer.redisFlushPrefix();
  }
  return { ok: true, redisCleared };
}

function layKichThuocAnh(base64, mediaType) {
  const buf = Buffer.from(base64, "base64");
  if (mediaType === "image/png" || (buf[0] === 0x89 && buf[1] === 0x50)) {
    if (buf.length < 24) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (mediaType === "image/jpeg" || (buf[0] === 0xff && buf[1] === 0xd8)) {
    let offset = 2;
    while (offset < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      }
      const segLen = buf.readUInt16BE(offset + 2);
      offset += 2 + segLen;
    }
    return null;
  }
  return null;
}

const REGEX_SO_DO = /^\d{1,6}([.,]\d{1,3})?$|^\d+[:xX]\d+$|^1[:]\d{2,4}$/;

function parseAnnotations(textAnnotations, kichThuocAnh) {
  const ketQua = (textAnnotations || []).slice(1).map((t) => {
    const verts = t.boundingPoly?.vertices || [];
    const xs = verts.map((v) => v.x || 0);
    const ys = verts.map((v) => v.y || 0);
    const pixel = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
    const normalized = kichThuocAnh
      ? {
          x: +(pixel.x / kichThuocAnh.width).toFixed(4),
          y: +(pixel.y / kichThuocAnh.height).toFixed(4),
          w: +(pixel.w / kichThuocAnh.width).toFixed(4),
          h: +(pixel.h / kichThuocAnh.height).toFixed(4),
        }
      : null;
    return {
      text: t.description || "",
      pixel,
      evidence_region: normalized,
      laSoDoNghiNgo: REGEX_SO_DO.test((t.description || "").trim()),
    };
  });
  return {
    tongSoText: ketQua.length,
    kichThuocAnh,
    items: ketQua,
    goiYSoDo: ketQua.filter((t) => t.laSoDoNghiNgo),
  };
}

async function fetchVision(apiKey, requests) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  try {
    const res = await fetch(`${GOOGLE_VISION_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Google Vision API lỗi ${res.status}: ${errText.slice(0, 300)}`);
    }
    return await res.json();
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error(`Google Vision timeout sau ${VISION_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function docCache(key, skipCache) {
  if (skipCache) return null;
  const ram = layTuCacheRam(key);
  if (ram) {
    cacheHits++;
    return { ...ram, fromCache: true, cacheLayer: "ram" };
  }
  if (redisLayer && redisLayer.redisGet) {
    const remote = await redisLayer.redisGet(key);
    if (remote && typeof remote === "object") {
      ghiCacheRam(key, remote);
      cacheHits++;
      return { ...remote, fromCache: true, cacheLayer: "redis" };
    }
  }
  return null;
}

async function ghiCache(key, result) {
  ghiCacheRam(key, result);
  if (redisLayer && redisLayer.redisSet) {
    try {
      await redisLayer.redisSet(key, result);
    } catch (_) {}
  }
}

// Trích xuất textAnnotations-tương-đương TỪ fullTextAnnotation (dùng khi
// DOCUMENT_TEXT_DETECTION trả textAnnotations rỗng) — DÙNG CHUNG cho cả hàm
// đơn lẻ và batch, tránh 1 chỗ sửa mà chỗ kia quên (đã xảy ra thật — batch
// từng thiếu fallback này dù hàm đơn lẻ đã sửa).
function trichXuatTuFullTextAnnotation(fullTextAnnotation) {
  const anns = [{ description: "", boundingPoly: { vertices: [] } }]; // giữ chỗ — parseAnnotations() luôn slice(1)
  const pages = fullTextAnnotation?.pages || [];
  pages.forEach((page) => {
    (page.blocks || []).forEach((block) => {
      (block.paragraphs || []).forEach((para) => {
        (para.words || []).forEach((word) => {
          const text = (word.symbols || []).map((s) => s.text || "").join("");
          if (text && word.boundingBox?.vertices) {
            anns.push({ description: text, boundingPoly: { vertices: word.boundingBox.vertices } });
          }
        });
      });
    });
  });
  return anns;
}

/**
 * OCR 1 ảnh — có cache + in-flight dedupe
 */
async function ocrGoogleVision(base64, mediaType, apiKey, opts = {}) {
  if (!apiKey) throw new Error("Thiếu GOOGLE_VISION_API_KEY — đặt biến môi trường trước khi gọi OCR.");
  if (!base64 || String(base64).length < 32) {
    return { tongSoText: 0, kichThuocAnh: null, items: [], goiYSoDo: [], fromCache: false, skipped: "base64_qua_ngan" };
  }

  const bytes = uocLuongBytes(base64);
  if (bytes < MIN_IMAGE_BYTES) {
    return { tongSoText: 0, kichThuocAnh: null, items: [], goiYSoDo: [], fromCache: false, skipped: "anh_qua_nho" };
  }
  if (bytes > MAX_IMAGE_BYTES) {
    skippedLarge++;
    return {
      tongSoText: 0,
      kichThuocAnh: null,
      items: [],
      goiYSoDo: [],
      fromCache: false,
      skipped: "anh_qua_lon",
      bytes,
      maxBytes: MAX_IMAGE_BYTES,
      error: `Ảnh ~${Math.round(bytes / 1e6)}MB vượt VISION_MAX_IMAGE_BYTES — giảm DPI/resize trước khi OCR`,
    };
  }

  const key = hashAnh(base64);
  const cached = await docCache(key, opts.skipCache);
  if (cached) return cached;

  // In-flight dedupe
  if (!opts.skipCache && inflight.has(key)) {
    dedupeHits++;
    cacheHits++;
    const shared = await inflight.get(key);
    return { ...shared, fromCache: true, cacheLayer: "inflight" };
  }

  cacheMisses++;

  const run = (async () => {
    const data = await fetchVision(apiKey, [
      {
        image: { content: base64 },
        features: [{ type: VISION_FEATURE, maxResults: 300 }],
        imageContext: { languageHints: ["vi", "en"] },
      },
    ]);

    if (data.responses?.[0]?.error) {
      throw new Error(`Google Vision: ${data.responses[0].error.message}`);
    }
    apiCalls++;
    const textAnnotations = data.responses?.[0]?.textAnnotations || [];
    // DOCUMENT_TEXT_DETECTION: fullTextAnnotation; TEXT_DETECTION: textAnnotations
    let anns = textAnnotations;
    if ((!anns || anns.length === 0) && data.responses?.[0]?.fullTextAnnotation) {
      anns = trichXuatTuFullTextAnnotation(data.responses[0].fullTextAnnotation);
    }
    const kichThuocAnh = layKichThuocAnh(base64, mediaType);
    const result = parseAnnotations(anns, kichThuocAnh);
    await ghiCache(key, result);
    return result;
  })();

  if (!opts.skipCache) inflight.set(key, run);
  try {
    const result = await run;
    return { ...result, fromCache: false, cacheLayer: "api" };
  } finally {
    inflight.delete(key);
  }
}

/**
 * OCR nhiều ảnh — 1 HTTP batch (tối đa BATCH_MAX), vẫn dùng cache từng ảnh
 * @param {Array<{ base64: string, mediaType?: string }>} images
 * @returns {Promise<Array>} kết quả theo đúng thứ tự input
 */
async function ocrGoogleVisionBatch(images, apiKey, opts = {}) {
  if (!apiKey) throw new Error("Thiếu GOOGLE_VISION_API_KEY");
  if (!Array.isArray(images) || !images.length) return [];

  const results = new Array(images.length);
  const needApi = []; // { index, base64, mediaType, key }

  for (let i = 0; i < images.length; i++) {
    const img = images[i] || {};
    const base64 = img.base64;
    const mediaType = img.mediaType || "image/jpeg";
    if (!base64 || String(base64).length < 32) {
      results[i] = { tongSoText: 0, items: [], goiYSoDo: [], fromCache: false, skipped: "base64_qua_ngan" };
      continue;
    }
    const bytes = uocLuongBytes(base64);
    if (bytes > MAX_IMAGE_BYTES) {
      skippedLarge++;
      results[i] = { tongSoText: 0, items: [], goiYSoDo: [], fromCache: false, skipped: "anh_qua_lon", bytes };
      continue;
    }
    const key = hashAnh(base64);
    const cached = await docCache(key, opts.skipCache);
    if (cached) {
      results[i] = cached;
      continue;
    }
    needApi.push({ index: i, base64, mediaType, key });
  }

  // Chia chunk batch
  for (let c = 0; c < needApi.length; c += BATCH_MAX) {
    const chunk = needApi.slice(c, c + BATCH_MAX);
    cacheMisses += chunk.length;
    const requests = chunk.map((it) => ({
      image: { content: it.base64 },
      features: [{ type: VISION_FEATURE, maxResults: 300 }],
      imageContext: { languageHints: ["vi", "en"] },
    }));
    const data = await fetchVision(apiKey, requests);
    batchCalls++;
    apiCalls += chunk.length;
    const responses = data.responses || [];
    for (let j = 0; j < chunk.length; j++) {
      const it = chunk[j];
      const resp = responses[j] || {};
      if (resp.error) {
        results[it.index] = {
          tongSoText: 0,
          items: [],
          goiYSoDo: [],
          fromCache: false,
          error: resp.error.message,
        };
        continue;
      }
      const kichThuocAnh = layKichThuocAnh(it.base64, it.mediaType);
      // SỬA LỖI THẬT (phát hiện qua audit): batch trước đây CHỈ đọc
      // resp.textAnnotations, thiếu hẳn fallback fullTextAnnotation mà hàm
      // đơn lẻ đã có — dùng DOCUMENT_TEXT_DETECTION qua batch sẽ mất evidence.
      let annsBatch = resp.textAnnotations || [];
      if ((!annsBatch || annsBatch.length === 0) && resp.fullTextAnnotation) {
        annsBatch = trichXuatTuFullTextAnnotation(resp.fullTextAnnotation);
      }
      const result = parseAnnotations(annsBatch, kichThuocAnh);
      await ghiCache(it.key, result);
      results[it.index] = { ...result, fromCache: false, cacheLayer: "api_batch" };
    }
  }

  return results;
}

module.exports = {
  ocrGoogleVision,
  ocrGoogleVisionBatch,
  layKichThuocAnh,
  thongKeCacheOcr,
  xoaCacheOcr,
  ganRedisLayer,
};
