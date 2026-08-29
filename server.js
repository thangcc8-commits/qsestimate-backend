// ============================================================================
// QsEstimate Backend — server trung gian cho QsEstimateApp
// ----------------------------------------------------------------------------
// Việc server này làm:
//   1. Giữ API key Claude thật (ANTHROPIC_API_KEY) an toàn ở phía server —
//      frontend KHÔNG bao giờ thấy key này.
//   2. Nhận ảnh/PDF từ app, gọi Claude, trả kết quả JSON đã trích xuất về app.
//   3. Lưu trữ dữ liệu app (dự án, BOQ, đơn giá...) theo từng người dùng,
//      thay cho window.storage/localStorage của trình duyệt.
//
// Cách chạy thử ở máy tính:
//   1) npm install
//   2) Tạo 1 file tên ".env" (cùng thư mục với server.js) với nội dung:
//        ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx   (key thật lấy ở platform.claude.com)
//        ALLOWED_ORIGIN=*                                    (đổi thành domain thật khi deploy)
//        PORT=3001
//   3) npm start
//   4) server chạy ở http://localhost:3001 — thử mở /health xem có "hasApiKey":true chưa
//
// Cách deploy thật: đưa 2 file này lên GitHub, kéo vào Render.com hoặc
// Railway.app ("New Web Service" -> chọn repo -> Build: npm install ->
// Start: npm start -> điền ANTHROPIC_API_KEY + ALLOWED_ORIGIN ở mục Environment).
// ============================================================================

// Lưu ý: KHÔNG require("dotenv") ở đây. Trên Render (và hầu hết hosting), biến môi
// trường được nạp sẵn tự động nên không cần dotenv. Khi chạy thử ở máy tính cá nhân,
// nếu muốn dùng file .env thì chạy bằng: node --env-file=.env server.js (Node 20+).
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const app = express();
const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// Model đọc từ biến môi trường — không khoá cứng trong code (mục 23 đặc tả: không
// khoá AutoEngine vào 1 phiên bản/nhà cung cấp cố định). Đổi model sau này chỉ cần
// sửa biến ANTHROPIC_MODEL trên Render → khởi động lại, KHÔNG cần sửa code/deploy lại.
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*"; // đổi thành đúng domain app khi deploy thật, đừng để "*"

// Google Cloud Vision — NGUỒN BỔ SUNG, không thay Claude. Cho OCR + toạ độ
// pixel THẬT (Claude Vision không cho được điều này). KHÔNG BẮT BUỘC — nếu
// không đặt key, tính năng OCR chỉ đơn giản là không dùng được, mọi thứ khác
// hoạt động bình thường như cũ.
const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY || "";
// Mặc định TẮT (0) — không tự động chạy OCR kèm MỖI lần đọc bản vẽ chính, vì
// Google tính phí RIÊNG theo ảnh (không cùng gói Anthropic) — bật "1" nếu chấp
// nhận chi phí thêm để luôn có OCR đối chiếu tự động.
const VISION_WITH_ANALYZE = process.env.VISION_WITH_ANALYZE === "1";
let ocrGoogleVision = null;
if (GOOGLE_VISION_API_KEY) {
  try { ocrGoogleVision = require("./vision-google.js").ocrGoogleVision; console.log("✓ Google Vision OCR đã bật (bổ sung, không thay Claude)"); }
  catch (e) { console.error("✗ Không load được vision-google.js:", e.message); }
}


if (!ANTHROPIC_API_KEY) {
  console.error("[FATAL] Thiếu ANTHROPIC_API_KEY trong file .env — server sẽ không gọi được AI cho tới khi anh điền key vào.");
}
if (ALLOWED_ORIGIN === "*") {
  console.warn(
    "[CẢNH BÁO BẢO MẬT] ALLOWED_ORIGIN đang để mặc định \"*\" — MỌI website đều gọi được API này. " +
    "Rủi ro thực tế THẤP vì xác thực dùng header x-access-code (không phải cookie, không bị lợi dụng qua CSRF), " +
    "nhưng nếu muốn chặt chẽ hơn, đặt biến môi trường ALLOWED_ORIGIN = đúng domain app thật (VD https://ten-app.onrender.com) trên Render."
  );
}

// CORS: cho phép app (chạy trong Claude.ai artifact hoặc web đã host) gọi tới.
// Để "*" nghĩa là nhận mọi nguồn — an toàn vì server này chỉ phục vụ app của mình,
// và API key được giữ kín phía server, không lộ ra ngoài dù nguồn gọi là gì.
app.use(cors({ origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN }));
app.options("*", cors({ origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN })); // trả lời yêu cầu "thăm dò" (preflight) của trình duyệt
app.use(express.json({ limit: "40mb" })); // dư địa an toàn — trần thật nằm ở phía Anthropic (32MB), không phải ở đây

// Giới hạn số lượt gọi AI / IP trong 15 phút — tránh bị lạm dụng gọi tràn lan tốn tiền
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: "Gọi AI quá nhiều lần trong 15 phút — thử lại sau." },
});

// GIỚI HẠN SỐ LƯỢT ĐỌC GỘP (ảnh/PDF, payload lớn tới 40MB) xử lý ĐỒNG THỜI —
// đây mới là cách chống nghẽn RAM thật khi nhiều người dùng cùng gửi batch lớn
// cùng lúc. LƯU Ý: JavaScript có garbage collector tự động — biến base64 cục
// bộ trong route handler tự đủ điều kiện dọn rác ngay khi hàm kết thúc, KHÔNG
// cần code thủ công "giải phóng biến" (đó là tư duy của C/C++, không áp dụng
// cho JS/Node.js). Vấn đề THẬT không phải "rò rỉ", mà là NHIỀU request 40MB
// cùng lúc làm RAM tổng thể tăng đột biến TẠM THỜI — giải pháp đúng là giới
// hạn số request lớn được xử lý song song, không phải "dọn biến thủ công".
let soLuotDangXuLy = 0;
const GIOI_HAN_DONG_THOI = 3; // tối đa 3 lượt đọc gộp lớn cùng lúc — đủ cho team nhỏ, chỉnh nếu cần
function gioiHanDongThoi(req, res, next) {
  if (soLuotDangXuLy >= GIOI_HAN_DONG_THOI) {
    return res.status(429).json({ error: `Server đang xử lý ${soLuotDangXuLy} lượt đọc gộp cùng lúc (tối đa ${GIOI_HAN_DONG_THOI}) — vui lòng thử lại sau vài giây.` });
  }
  soLuotDangXuLy++;
  // QUAN TRỌNG (đã TEST xác nhận thật): cả 2 sự kiện "finish" VÀ "close" đều
  // fire cho 1 request BÌNH THƯỜNG (không chỉ lúc lỗi/ngắt kết nối) — nếu trừ
  // ở cả 2 nơi sẽ trừ NHẦM 2 LẦN cho 1 request, làm giới hạn sai lệch. Dùng cờ
  // "daTru" đảm bảo CHỈ trừ đúng 1 lần, bất kể sự kiện nào fire trước.
  let daTru = false;
  const tru = () => { if (!daTru) { daTru = true; soLuotDangXuLy = Math.max(0, soLuotDangXuLy - 1); } };
  res.on("finish", tru);
  res.on("close", tru);
  next();
}

// ============================================================================
// GỌI CLAUDE API — dùng chung cho cả đọc ảnh và đọc PDF
// ============================================================================
// ============================================================================
// GỌI CLAUDE API — dùng chung cho cả đọc ảnh và đọc PDF. Có thử lại GIỚI HẠN
// (tối đa 2 lần, KHÔNG vô hạn) khi lỗi thật sự TẠM THỜI — mất mạng, quá tải máy
// chủ Anthropic (429/500/502/503/504). KHÔNG thử lại với lỗi CHẮC CHẮN sai (sai
// định dạng request, hết tiền, sai key, quá dung lượng...) — thử lại những lỗi
// đó chỉ tốn thêm tiền vô ích vì chắc chắn lại thất bại y hệt.
// ============================================================================
const MA_LOI_TAM_THOI = new Set([429, 500, 502, 503, 504]);

// Timeout dùng chung cho MỌI lượt gọi AI (Claude/OpenAI/Gemini) — trước đây
// fetch() không có giới hạn thời gian, nếu API bên hãng bị treo, request có
// thể chờ vô thời hạn (chiếm tài nguyên server, người dùng nhìn màn hình xoay
// mãi không dừng). 90 giây đủ rộng cho ảnh/PDF phức tạp, không quá ngắn.
const AI_TIMEOUT_MS = 90_000;
async function fetchCoTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === "AbortError") {
      const err = new Error(`Hết thời gian chờ (${AI_TIMEOUT_MS / 1000}s) — AI không phản hồi kịp, thử lại hoặc dùng ảnh nhỏ/ít trang hơn.`);
      err.status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
async function callClaude(contentBlocks, betaHeader) {
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  };
  if (betaHeader) headers["anthropic-beta"] = betaHeader;
  const body = JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 16000, messages: [{ role: "user", content: contentBlocks }] });

  const SO_LAN_TOI_DA = 3; // 1 lần gốc + tối đa 2 lần thử lại
  let loiCuoi;
  for (let lan = 1; lan <= SO_LAN_TOI_DA; lan++) {
    let resp;
    try {
      resp = await fetchCoTimeout("https://api.anthropic.com/v1/messages", { method: "POST", headers, body });
    } catch (netErr) {
      // Lỗi mạng thật (đứt kết nối, timeout) — tạm thời, đáng thử lại
      loiCuoi = netErr;
      if (lan < SO_LAN_TOI_DA) { await new Promise((r) => setTimeout(r, 1000 * lan)); continue; }
      const err = new Error(`Không kết nối được tới Claude API sau ${SO_LAN_TOI_DA} lần thử: ${netErr.message}`);
      err.status = 503;
      throw err;
    }

    let data;
    try {
      data = await resp.json();
    } catch (e) {
      const err = new Error(`Máy chủ Claude trả về dữ liệu không hợp lệ (HTTP ${resp.status})`);
      err.status = 502;
      throw err;
    }

    if (resp.ok) return data;

    if (MA_LOI_TAM_THOI.has(resp.status) && lan < SO_LAN_TOI_DA) {
      // Lỗi tạm thời (quá tải/rate-limit phía Anthropic) — chờ rồi thử lại, không
      // báo lỗi ngay cho người dùng.
      await new Promise((r) => setTimeout(r, 1000 * lan));
      continue;
    }
    // Lỗi chắc chắn sai (400/401/413...) hoặc đã hết lượt thử lại — báo lỗi ngay,
    // không thử thêm vì thử lại cũng sẽ thất bại y hệt, chỉ tốn thêm tiền.
    const err = new Error(data?.error?.message || `Lỗi HTTP ${resp.status} từ Claude API`);
    err.status = resp.status;
    throw err;
  }
  throw loiCuoi || new Error("Không gọi được Claude API.");
}

// ============================================================================
// PHÂN QUYỀN NGƯỜI DÙNG (mức đơn giản: mỗi người 1 mã truy cập)
// ----------------------------------------------------------------------------
// Khai báo trên Render, mục Environment, biến ACCESS_CODES theo mẫu:
//     ACCESS_CODES=thang=PTC001,nam=PTC002,hoa=PTC003
// (tên người = mã truy cập, cách nhau bằng dấu phẩy — tên không dấu, không cách)
// Biến ADMIN_CODE là mã của người quản trị (xem được nhật ký sử dụng của cả team):
//     ADMIN_CODE=PTC001
// NẾU KHÔNG KHAI BÁO ACCESS_CODES thì app mở tự do cho mọi người (như trước).
// ============================================================================
// Khớp đúng id với PROJECT_GROUPS ở frontend (QsEstimateApp.jsx) — chỉ dùng
// cho endpoint liệt kê mẫu dự toán, không dùng cho logic nghiệp vụ khác.
const PROJECT_GROUPS_BACKEND = [
  { groupId: "nha-pho", tenHienThi: "Xây dựng Nhà phố" },
  { groupId: "shophouse", tenHienThi: "Hoàn thiện Shophouse" },
];

const ACCESS_CODES = {};
(process.env.ACCESS_CODES || "").split(",").forEach((cap) => {
  const [ten, ma] = cap.split("=").map((s) => (s || "").trim());
  if (ten && ma) ACCESS_CODES[ma] = ten;
});
const ADMIN_CODE = (process.env.ADMIN_CODE || "").trim();
const CO_PHAN_QUYEN = Object.keys(ACCESS_CODES).length > 0 || !!process.env.DATABASE_URL;

// ĐÃ ĐỔI thành ASYNC — ưu tiên tra mã trong Postgres (quản lý được qua giao
// diện, có hỗ trợ hết hạn) TRƯỚC, chỉ rơi về ACCESS_CODES (biến môi trường cố
// định, cần khởi động lại server mới đổi được) khi Postgres không active HOẶC
// không tìm thấy mã đó trong Postgres — giữ nguyên hành vi cũ khi chưa dùng
// Postgres, không phá vỡ gì.
async function layNguoiDung(req) {
  const ma = (req.header("x-access-code") || "").trim();
  if (!ma) return null;
  if (pgStore && process.env.DATABASE_URL) {
    try {
      const uPg = await pgStore.kiemTraAccessCode(ma);
      if (uPg) return uPg;
    } catch (e) {
      console.error("[Postgres] kiểm tra mã truy cập lỗi, rơi về env var:", e.message);
    }
  }
  const ten = ACCESS_CODES[ma];
  if (!ten) return null;
  return { ten, quanTri: !!ADMIN_CODE && ma === ADMIN_CODE };
}

async function batBuocDangNhap(req, res, next) {
  if (!CO_PHAN_QUYEN) { req.nguoiDung = { ten: "khách", quanTri: false }; return next(); }
  const u = await layNguoiDung(req);
  if (!u) return res.status(401).json({ error: "Mã truy cập không đúng, chưa nhập, hoặc đã hết hạn. Liên hệ quản trị để được cấp mã." });
  req.nguoiDung = u;
  next();
}

// ---- Nhật ký sử dụng: ghi lại ai đọc bản vẽ, lúc nào, tốn bao nhiêu ----
const FILE_NHAT_KY = path.join(__dirname, "data", "usage-log.json");
function docNhatKy() {
  try { return JSON.parse(fs.readFileSync(FILE_NHAT_KY, "utf8")); } catch (e) { return []; }
}
function ghiNhatKy(ban) {
  try {
    const log = docNhatKy();
    log.unshift(ban);
    fs.writeFileSync(FILE_NHAT_KY, JSON.stringify(log.slice(0, 2000)));
  } catch (e) { console.error("Không ghi được nhật ký:", e.message); }
  // Song song ghi Postgres nếu đã bật (không chặn request nếu DB lỗi)
  if (typeof pgStore !== "undefined" && pgStore && process.env.DATABASE_URL) {
    pgStore.ghiNhatKyDb(ban).catch((err) => console.error("[Postgres] ghi nhật ký:", err.message));
  }
}

// Ai đang đăng nhập — app gọi để kiểm tra mã có hợp lệ không
app.get("/api/whoami", async (req, res) => {
  try {
    if (!CO_PHAN_QUYEN) return res.json({ ten: "khách", quanTri: false, coPhanQuyen: false });
    const u = await layNguoiDung(req);
    if (!u) return res.status(401).json({ error: "Mã truy cập không đúng." });
    res.json({ ...u, coPhanQuyen: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Nhật ký sử dụng — chỉ người quản trị xem được
app.get("/api/usage-log", async (req, res) => {
  try {
    if (CO_PHAN_QUYEN) {
      const u = await layNguoiDung(req);
      if (!u || !u.quanTri) return res.status(403).json({ error: "Chỉ người quản trị mới xem được nhật ký." });
    }
    // SỬA LỖI (giống bug /api/backup từng tìm ra): trước đây endpoint này LUÔN
    // đọc file JSON local, dù Postgres đang active và ghiNhatKy() đã ghi log vào
    // đó — nghĩa là chú sẽ KHÔNG thấy log thật khi dùng Postgres. Giờ đọc đúng
    // nguồn đang active, tự rơi về file nếu Postgres lỗi.
    let log;
    if (pgStore && process.env.DATABASE_URL) {
      try {
        const rows = await pgStore.docNhatKyDb(200);
        log = rows.map((r) => ({
          luc: r.luc, nguoi: r.nguoi, loai: r.loai, ten: r.ten,
          inputTokens: r.input_tokens, outputTokens: r.output_tokens,
          usd: Number(r.usd) || 0, vnd: Number(r.vnd) || 0,
        }));
      } catch (e) {
        console.error("[Postgres] đọc nhật ký lỗi, rơi về file:", e.message);
        log = docNhatKy();
      }
    } else {
      log = docNhatKy();
    }
    const tong = {};
    log.forEach((b) => {
      if (!tong[b.nguoi]) tong[b.nguoi] = { soLan: 0, vnd: 0, usd: 0 };
      tong[b.nguoi].soLan++;
      tong[b.nguoi].vnd += b.vnd || 0;
      tong[b.nguoi].usd = +(tong[b.nguoi].usd + (b.usd || 0)).toFixed(5);
    });
    res.json({ log: log.slice(0, 200), tongTheoNguoi: tong, tongSoLan: log.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// QUẢN TRỊ MÃ TRUY CẬP ĐỘNG — thêm/sửa/xoá nhân viên NGAY TRÊN GIAO DIỆN,
// không cần đổi biến môi trường ACCESS_CODES + khởi động lại server. CHỈ hoạt
// động khi có Postgres — nếu chưa cấu hình, báo lỗi rõ ràng hướng dẫn cách cũ.
// ============================================================================
function chuaCauHinhPostgres(res) {
  res.status(400).json({ error: "Chưa cấu hình Postgres (DATABASE_URL) — dùng cách cũ: thêm vào biến môi trường ACCESS_CODES trên Render rồi khởi động lại server." });
}

app.get("/api/admin/access-codes", async (req, res) => {
  try {
    if (CO_PHAN_QUYEN) {
      const u = await layNguoiDung(req);
      if (!u || !u.quanTri) return res.status(403).json({ error: "Chỉ người quản trị mới xem được danh sách mã truy cập." });
    }
    if (!pgStore || !process.env.DATABASE_URL) return chuaCauHinhPostgres(res);
    const list = await pgStore.layDanhSachAccessCodes();
    res.json({ list, tuMoiTruong: Object.entries(ACCESS_CODES).map(([ma, ten]) => ({ ma, ten, laAdmin: ma === ADMIN_CODE, nguon: "env" })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/access-codes", async (req, res) => {
  try {
    if (CO_PHAN_QUYEN) {
      const u = await layNguoiDung(req);
      if (!u || !u.quanTri) return res.status(403).json({ error: "Chỉ người quản trị mới thêm/sửa được mã truy cập." });
    }
    if (!pgStore || !process.env.DATABASE_URL) return chuaCauHinhPostgres(res);
    const { ma, ten, laAdmin, hetHan } = req.body || {};
    if (!ma || !ten) return res.status(400).json({ error: "Thiếu mã hoặc tên nhân viên." });
    await pgStore.themSuaAccessCode(ma.trim(), ten.trim(), !!laAdmin, hetHan || null);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/admin/access-codes/:ma", async (req, res) => {
  try {
    if (CO_PHAN_QUYEN) {
      const u = await layNguoiDung(req);
      if (!u || !u.quanTri) return res.status(403).json({ error: "Chỉ người quản trị mới thu hồi được mã truy cập." });
    }
    if (!pgStore || !process.env.DATABASE_URL) return chuaCauHinhPostgres(res);
    await pgStore.xoaAccessCode(req.params.ma);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// MẪU DỰ TOÁN (danh sách tên chuẩn) THEO NHÓM CÔNG TRÌNH — quản lý qua API
// riêng, KHÔNG cần sửa lại từng dự án. Lưu Postgres nếu có, tự rơi về file
// JSON local nếu chưa cấu hình (giống mọi tính năng Postgres khác trong app).
// Ghi (PUT): chỉ ADMIN. Đọc (GET): mọi user đã đăng nhập.
// ============================================================================
const FILE_TEMPLATES = path.join(__dirname, "data", "estimate-templates.json");
function docTemplatesFile() {
  try { return JSON.parse(fs.readFileSync(FILE_TEMPLATES, "utf8")); } catch (e) { return {}; }
}
function ghiTemplateFile(groupId, items, gopThem, nguoiSua) {
  const all = docTemplatesFile();
  const layTen = (it) => (typeof it === "string" ? it : it?.ten || "").trim().toLowerCase();
  let itemsCuoi = items;
  if (gopThem) {
    const cu = all[groupId];
    const tenDaCo = new Set((cu?.items || []).map(layTen));
    const themMoi = (items || []).filter((it) => !tenDaCo.has(layTen(it)));
    itemsCuoi = [...(cu?.items || []), ...themMoi];
  }
  const banGhi = { groupId, items: itemsCuoi, version: (all[groupId]?.version || 0) + 1, updatedAt: new Date().toISOString(), updatedBy: nguoiSua || null };
  all[groupId] = banGhi;
  fs.writeFileSync(FILE_TEMPLATES, JSON.stringify(all, null, 2));
  return banGhi;
}

async function docTemplateUnified(groupId) {
  if (pgStore && process.env.DATABASE_URL) {
    const tpl = await pgStore.docTemplateMau(groupId);
    return tpl ? { groupId: tpl.group_id, items: tpl.items, version: tpl.version, updatedAt: tpl.updated_at, updatedBy: tpl.updated_by } : { groupId, items: [], version: 0, updatedAt: null, updatedBy: null };
  }
  const tpl = docTemplatesFile()[groupId];
  return tpl || { groupId, items: [], version: 0, updatedAt: null, updatedBy: null };
}

// Liệt kê CẢ 2 nhóm cùng lúc kèm tóm tắt (số dòng, phiên bản, sửa lần cuối) —
// tiện cho UI hiển thị tổng quan trước khi chọn nhóm cần sửa chi tiết.
app.get("/api/templates", async (req, res) => {
  try {
    if (CO_PHAN_QUYEN) {
      const u = await layNguoiDung(req);
      if (!u) return res.status(401).json({ error: "Cần đăng nhập để xem mẫu dự toán." });
    }
    const list = [];
    for (const g of PROJECT_GROUPS_BACKEND) {
      const tpl = await docTemplateUnified(g.groupId);
      list.push({ groupId: g.groupId, tenHienThi: g.tenHienThi, version: tpl.version, soDong: (tpl.items || []).length, updatedAt: tpl.updatedAt, updatedBy: tpl.updatedBy });
    }
    res.json({ list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/templates/:groupId", async (req, res) => {
  try {
    if (CO_PHAN_QUYEN) {
      const u = await layNguoiDung(req);
      if (!u) return res.status(401).json({ error: "Cần đăng nhập để xem mẫu dự toán." });
    }
    if (pgStore && process.env.DATABASE_URL) {
      const tpl = await pgStore.docTemplateMau(req.params.groupId);
      return res.json(tpl || { groupId: req.params.groupId, items: [], version: 0 });
    }
    const all = docTemplatesFile();
    res.json(all[req.params.groupId] || { groupId: req.params.groupId, items: [], version: 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Chỉ trả về MẢNG TÊN (chuỗi) — dùng thẳng làm "danhSachChuan" gửi vào lệnh AI
// khi đọc bản vẽ, không cần frontend tự trích tên từ object phức tạp.
app.get("/api/templates/:groupId/names", async (req, res) => {
  try {
    if (CO_PHAN_QUYEN) {
      const u = await layNguoiDung(req);
      if (!u) return res.status(401).json({ error: "Cần đăng nhập để xem mẫu dự toán." });
    }
    let tpl;
    if (pgStore && process.env.DATABASE_URL) tpl = await pgStore.docTemplateMau(req.params.groupId);
    else tpl = docTemplatesFile()[req.params.groupId];
    const names = (tpl?.items || []).map((it) => (typeof it === "string" ? it : it?.ten || "")).filter(Boolean);
    res.json({ groupId: req.params.groupId, names, version: tpl?.version || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/templates/:groupId", async (req, res) => {
  try {
    if (CO_PHAN_QUYEN) {
      const u = await layNguoiDung(req);
      if (!u || !u.quanTri) return res.status(403).json({ error: "Chỉ người quản trị mới sửa được mẫu dự toán." });
    }
    const { items, gopThem } = req.body || {};
    if (!Array.isArray(items)) return res.status(400).json({ error: "Thiếu \"items\" (mảng tên hạng mục)." });
    const nguoi = CO_PHAN_QUYEN ? (await layNguoiDung(req))?.ten : "khách";
    let ketQua;
    if (pgStore && process.env.DATABASE_URL) ketQua = await pgStore.ghiTemplateMau(req.params.groupId, items, !!gopThem, nguoi);
    else ketQua = ghiTemplateFile(req.params.groupId, items, !!gopThem, nguoi);
    res.json({ ok: true, ...ketQua });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Chỉ PARSE JSON thô từ phản hồi AI — KHÔNG validate/chuẩn hoá ở đây nữa (việc
// đó chuyển sang b04_normalize trong pipeline 9 bước, đúng đúng vị trí của nó).
function parseRawJsonTuAI(data) {
  const text = (data.content || []).map((b) => b.text || "").join("");
  let clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
  } catch (e) { /* rơi xuống cách 2 */ }
  const start = clean.indexOf("[");
  if (start !== -1) {
    const end = clean.lastIndexOf("]");
    if (end > start) {
      try {
        const parsed = JSON.parse(clean.slice(start, end + 1));
        if (Array.isArray(parsed)) return parsed;
      } catch (e) { /* rơi xuống cách 3 */ }
    }
    const arrBody = clean.slice(start + 1);
    const lastCompleteObjEnd = arrBody.lastIndexOf("}");
    if (lastCompleteObjEnd !== -1) {
      const salvaged = "[" + arrBody.slice(0, lastCompleteObjEnd + 1) + "]";
      try {
        const parsed = JSON.parse(salvaged);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch (e) { /* thật sự hỏng, rơi xuống trả rỗng */ }
    }
  }
  return [];
}

// Giữ lại tên cũ để KHÔNG phá vỡ chỗ nào còn gọi trực tiếp — tương đương hành
// vi trước đây (parse + validate luôn 1 lượt), dùng khi KHÔNG cần trace pipeline.
function extractJsonArray(data) {
  return locHangMucHopLe(parseRawJsonTuAI(data));
}

// ============================================================================
// PIPELINE 9 BƯỚC (mục 10) — mỗi bước là 1 hàm riêng, TỰ BÁO CÁO trạng thái
// thật (done/partial/blocked + lý do) thay vì giả vờ chạy đủ. Áp dụng cho
// luồng ẢNH/PDF (qua AI) — luồng DXF có toạ độ thật nên chạy khác, xem
// docFileDxf ở frontend (không đi qua pipeline này).
// ============================================================================
function b01_ingest(images) {
  const crypto = require("crypto");
  // SỬA LỖI THẬT: PDF endpoint gọi hàm này với base64="" (cố tình, tránh hash
  // toàn bộ nội dung PDF lớn) — nhưng hash("") luôn ra CÙNG 1 GIÁ TRỊ, khiến
  // mọi file PDF có checksum giống hệt nhau, mất tác dụng phân biệt. Giờ dùng
  // tên file + kiểu file làm dự phòng khi base64 rỗng.
  const checksums = (images || []).map((img) => {
    const payload =
      img.base64 && String(img.base64).length > 0
        ? img.base64
        : `name:${img.name || "unknown"}|type:${img.mediaType || img.media_type || ""}`;
    return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 12);
  });
  return {
    step: "01_INGEST", status: "done",
    detail: `${(images || []).length} file, checksum SHA-256 (rút gọn): ${checksums.join(", ") || "(rỗng)"}`,
  };
}

function b02_classify(rawItems) {
  // THÀNH THẬT: đây là phân loại SAU KHI ĐỌC (dựa vào nội dung đã trích xuất ở
  // bước 03), KHÔNG PHẢI trước khi đọc như tên bước "CLASSIFY" có thể gợi ý
  // theo đúng kiến trúc AutoEngine gốc. Chọn cách này để KHÔNG tốn thêm 1 lượt
  // gọi AI riêng (đã cân nhắc đánh đổi chi phí trước đây) — suy loại bản vẽ từ
  // PHÂN BỐ NHÓM (group) của các hạng mục đã đọc được.
  if (!rawItems || !rawItems.length) {
    return { step: "02_CLASSIFY", status: "blocked", reason: "Chưa có dữ liệu nào để phân loại (bước trích xuất chưa ra kết quả gì)." };
  }
  const demTheoNhom = {};
  rawItems.forEach((it) => {
    const nhom = it?.group || "khac";
    demTheoNhom[nhom] = (demTheoNhom[nhom] || 0) + 1;
  });
  const tongSo = rawItems.length;
  const nhomChinh = Object.entries(demTheoNhom).sort((a, b) => b[1] - a[1])[0];
  const [tenNhomChinh, soLuongNhomChinh] = nhomChinh;
  const tyLeNhomChinh = soLuongNhomChinh / tongSo;

  // SỬA LỖI (test tự phát hiện): trước đây GỘP "khung"+"mong" RỒI MỚI so
  // ngưỡng — khiến 2 nhóm nhỏ riêng lẻ (VD mỗi nhóm 25%) cộng lại VƯỢT ngưỡng
  // giả tạo dù KHÔNG nhóm nào thực sự chiếm đa số (dữ liệu phân bố đều). Giờ
  // dùng ĐÚNG nhóm ĐƠN LẺ lớn nhất để so ngưỡng công bằng, ánh xạ SAU đó.
  let loaiBanVe = "không rõ";
  if (tyLeNhomChinh >= 0.4) {
    if (tenNhomChinh === "mep") loaiBanVe = "MEP (điện/nước/PCCC)";
    else if (tenNhomChinh === "khung" || tenNhomChinh === "mong") loaiBanVe = "kết cấu (khung/móng)";
    else if (tenNhomChinh === "hoanthien") loaiBanVe = "kiến trúc/hoàn thiện";
  }

  return {
    step: "02_CLASSIFY",
    status: loaiBanVe === "không rõ" ? "partial" : "done",
    reason: `Phân loại SAU KHI ĐỌC (dựa vào phân bố nhóm hạng mục, KHÔNG tốn thêm lượt gọi AI riêng): nhóm "${tenNhomChinh}" chiếm ${soLuongNhomChinh}/${tongSo} dòng. Suy đoán loại bản vẽ: ${loaiBanVe}.${loaiBanVe === "không rõ" ? " (Phân bố quá đều giữa các nhóm, không đủ tin cậy để kết luận 1 loại rõ ràng.)" : ""}`,
  };
}

function b03_extract(soLuongAnh) {
  return { step: "03_EXTRACT", status: "done", detail: `Gọi AI đọc trực tiếp ${soLuongAnh} ảnh/trang, nhận JSON thô` };
}

function b04_normalize(rawItems) {
  const normalized = locHangMucHopLe(rawItems);
  return { ketQua: normalized, trace: { step: "04_NORMALIZE", status: "done", detail: `${rawItems.length} dòng thô → ${normalized.length} dòng hợp lệ (đã lọc rác, chuẩn hoá evidence_region)` } };
}

// Khổ giấy chuẩn (chiều rộng, mm, đặt dọc) — dùng để tính scale LÝ THUYẾT khi
// bản vẽ có ghi tỷ lệ (VD "1:100") nhưng KHÔNG biết chắc khổ giấy thật đã in.
const KHO_GIAY_MM = { A4: 210, A3: 297, A2: 420, A1: 594, A0: 841 };

function tinhScaleLyThuyet(declaredScale, khoGiayGioiThieu = "A4") {
  if (!declaredScale || typeof declaredScale !== "string") return null;
  const match = declaredScale.trim().match(/^(\d+)\s*:\s*(\d+)$/);
  if (!match) return null;
  const tuSo = Number(match[1]), mauSo = Number(match[2]);
  if (!tuSo || !mauSo) return null;
  const tyLe = mauSo / tuSo; // VD "1:100" -> tỷ lệ = 100
  return { tyLe, khoGiayGioiThieu, chieuRongGiayMm: KHO_GIAY_MM[khoGiayGioiThieu] || KHO_GIAY_MM.A4 };
}

function b05_scale(normalizedItems) {
  // HỆ THỐNG 3 TẦNG dự phòng xác định tỷ lệ/kích thước thật — thử lần lượt,
  // tầng nào đạt trước thì dùng, không đoán bừa nếu cả 3 đều không đủ tin cậy.
  //
  // TẦNG 1 — Dimension thực trên bản vẽ: đây CHÍNH LÀ cách "calc_type:
  // tinh_tu_kich_thuoc_X" (tường/cột/dầm/móng/sàn) đã làm từ trước — AI đọc
  // THẲNG con số kích thước thật ghi trên bản vẽ (VD "5m dài", "8420mm"),
  // KHÔNG CẦN quy đổi tỷ lệ pixel→mét gì cả vì đã là số đo thật. Đây là tầng
  // đáng tin cậy NHẤT vì không qua bất kỳ suy luận/giả định trung gian nào.
  const soDongTangMot = normalizedItems.filter((i) =>
    ["tinh_tu_kich_thuoc_tuong", "tinh_tu_kich_thuoc_cot", "tinh_tu_kich_thuoc_dam", "tinh_tu_kich_thuoc_mong", "tinh_tu_kich_thuoc_san"].includes(i.calc_type)
  ).length;
  if (soDongTangMot > 0) {
    return { step: "05_SCALE", status: "done", reason: `TẦNG 1 đạt: ${soDongTangMot} dòng dùng kích thước THẬT đọc trực tiếp từ bản vẽ (không cần quy đổi tỷ lệ pixel→mét) — đáng tin cậy nhất trong 3 tầng.` };
  }

  // TẦNG 2 — Known geometry/grid: dùng 1 THAM CHIẾU HÌNH HỌC ĐÃ BIẾT (VD
  // khoảng lưới cột "Trục A-B cách 4000mm") để ƯỚC LƯỢNG quy mô cho vật thể
  // KHÁC không có ghi kích thước trực tiếp. Đây là ƯỚC LƯỢNG (kém chắc chắn
  // hơn Tầng 1) — CHỈ dùng tham khảo/đối chiếu, KHÔNG tự động tính khối lượng.
  const coThamChieu = normalizedItems.find((i) => i.known_geometry_ref && Number.isFinite(Number(i.known_geometry_ref.gia_tri_m)));
  if (coThamChieu) {
    const r = coThamChieu.known_geometry_ref;
    return {
      step: "05_SCALE", status: "partial",
      reason: `TẦNG 2 đạt: dùng tham chiếu hình học đã biết "${r.mo_ta || r.loai}" = ${r.gia_tri_m}m để ước lượng — ĐỘ TIN CẬY THẤP HƠN Tầng 1 (chỉ tham khảo/đối chiếu, KHÔNG tự động tính khối lượng bất kỳ hạng mục nào từ tham chiếu này).`,
    };
  }

  // TẦNG 2b — tỷ lệ khai báo (declared_scale, VD "1:100") — cùng mức tin cậy
  // với Tầng 2 (đều là ước lượng gián tiếp, không phải đo trực tiếp).
  const coKhaiBao = normalizedItems.find((i) => i.declared_scale);
  if (coKhaiBao) {
    const kq = tinhScaleLyThuyet(coKhaiBao.declared_scale);
    if (kq) {
      return {
        step: "05_SCALE", status: "partial",
        reason: `TẦNG 2 đạt (qua tỷ lệ khai báo): "${coKhaiBao.declared_scale}" — tính scale LÝ THUYẾT giả định khổ ${kq.khoGiayGioiThieu} (${kq.chieuRongGiayMm}mm): ${kq.tyLe}x. CHƯA xác nhận khổ giấy thật — CHỈ dùng tham khảo, KHÔNG tự động tính khối lượng.`,
      };
    }
  }

  // TẦNG 3 — Manual calibration: công cụ "📐 Đo trên ảnh" (QS tự click 2 điểm
  // + nhập khoảng cách biết trước) đã có sẵn trong app, nhưng đây là hành động
  // THỦ CÔNG của người dùng, không thể "tự động đạt" ở bước pipeline này —
  // chỉ có thể GỢI Ý dùng khi cả Tầng 1 và Tầng 2 đều không đủ dữ liệu.
  return {
    step: "05_SCALE", status: "review",
    reason: "TẦNG 1 và TẦNG 2 đều không đủ dữ liệu (không có kích thước thật, không có tham chiếu hình học/tỷ lệ khai báo) — không tự đoán. TẦNG 3: dùng công cụ '📐 Đo trên ảnh' để QS tự hiệu chỉnh tay.",
  };
}

function b06_geometry(normalizedItems) {
  // CHẠY 1 PHẦN THẬT: với 5 loại calc_type (tường/cột/dầm/móng/sàn), app ĐÃ
  // tự tính khối lượng bằng công thức thật ở bước 04 — đây chính là 1 phần
  // Geometry Engine thật, chỉ là không dùng toạ độ pixel mà dùng số đo AI
  // đọc/ước lượng.
  const CAC_LOAI_TINH_HINH_HOC = new Set(["tinh_tu_kich_thuoc_tuong", "tinh_tu_kich_thuoc_cot", "tinh_tu_kich_thuoc_dam", "tinh_tu_kich_thuoc_mong", "tinh_tu_kich_thuoc_san"]);
  const soDongTinhHinhHoc = normalizedItems.filter((i) => CAC_LOAI_TINH_HINH_HOC.has(i.calc_type)).length;
  if (soDongTinhHinhHoc > 0) {
    return { step: "06_GEOMETRY", status: "partial", reason: `Chạy 1 phần: ${soDongTinhHinhHoc} dòng tính khối lượng (tường/cột/dầm/móng/sàn) bằng công thức thật, KHÔNG dùng qty AI tự đưa. Chưa có polygon/intersection đầy đủ như Geometry Engine chuẩn.` };
  }
  return { step: "06_GEOMETRY", status: "blocked", reason: "Không có hạng mục nào cần tính hình học trong lượt đọc này (toàn bộ là đọc trực tiếp/đếm số lượng)" };
}

function b07_relationship(normalizedItems, ocrData) {
  // Không có OCR -> giữ nguyên hành vi CŨ, THẬT SỰ blocked (không đổi gì nếu
  // không ai chủ động truyền ocrData vào — an toàn, không phá vỡ luồng hiện tại).
  if (!ocrData || !Array.isArray(ocrData.items)) {
    return { step: "07_RELATIONSHIP", status: "blocked", reason: "Cần toạ độ thật từ bước 05 (đã bị chặn cho ảnh/PDF) để liên kết tường↔phòng, cột↔tầng. Bật GOOGLE_VISION_API_KEY để có nhãn tầng chính xác làm điểm neo (vẫn chỉ PARTIAL khi bật, không phải done — xem lý do khi có OCR)." };
  }
  // CÓ OCR: nhãn tầng CHÍNH XÁC (toạ độ pixel thật từ Google Vision), NHƯNG
  // evidence_region của từng item vẫn là AI TỰ ƯỚC LƯỢNG — ĐÃ TEST THẬT chứng
  // minh: dù nhãn tầng OCR đúng 100%, item vẫn có thể bị gán NHẦM tầng nếu AI
  // ước lượng evidence_region sai (điểm yếu đã biết, không loại bỏ được chỉ
  // bằng cách thêm OCR cho MỘT nửa dữ liệu). VÌ VẬY: LUÔN "partial", KHÔNG BAO
  // GIỜ "done" — đây là GỢI Ý tham khảo, không phải kết luận đáng tin tuyệt đối.
  const relationships = [];
  const nhanTang = ocrData.items.filter((t) => /T[ẦA]NG\s*\d+|TRỆT|MÁI/i.test(t.text || ""));
  normalizedItems.forEach((it, idx) => {
    if (it.evidence_region && nhanTang.length) {
      const tr = it.evidence_region;
      const tangKhop = nhanTang.find((n) => n.evidence_region && Math.abs(n.evidence_region.y - tr.y) < 0.2);
      if (tangKhop) relationships.push({ objectId: `OBJ-${String(idx + 1).padStart(4, "0")}`, target: tangKhop.text, type: "located_in_floor_GOI_Y" });
    }
  });
  return {
    step: "07_RELATIONSHIP",
    status: "partial",
    relationships,
    reason: relationships.length
      ? `GỢI Ý (không phải kết luận chắc chắn): ${relationships.length} liên kết cấu kiện↔tầng, dựa vào nhãn tầng CHÍNH XÁC từ Google Vision OCR đối chiếu với vùng ƯỚC LƯỢNG của AI (evidence_region) — vùng này AI tự đoán, KHÔNG chính xác tuyệt đối, nên liên kết CÓ THỂ SAI (đã kiểm chứng bằng test). Dùng tham khảo nhanh, KHÔNG tự động phân loại BOQ theo tầng dựa vào đây.`
      : "Có OCR nhưng không tìm được nhãn tầng nào khớp gần vị trí ước lượng của các hạng mục — không đủ dữ liệu suy luận.",
  };
}


function b08_takeoff(normalizedItems) {
  // THÀNH THẬT VỀ TÊN GỌI: bước này KHÔNG "giả lập" — phép tính khối lượng
  // THẬT đã chạy ở bước 04_NORMALIZE (bảng tra cứu Engine: tường/cột/dầm/
  // móng/sàn, xem BANG_CONG_THUC_ENGINE + locHangMucHopLe). Bước này CHỈ đóng
  // gói lại kết quả đã tính xong — tên "TAKEOFF" đúng theo đúng vị trí trong
  // sơ đồ 9 bước, nhưng công việc TÍNH TOÁN thật đã xảy ra ở bước trước đó.
  return { ketQua: normalizedItems, trace: { step: "08_TAKEOFF", status: "done", detail: `${normalizedItems.length} hạng mục khối lượng cuối cùng (đã tính thật ở bước 04_NORMALIZE), sẵn sàng vào BOQ` } };
}

// Đối chiếu CHÉO theo mã hiệu (VD "D01") giữa CÁC NGUỒN KHÁC NHAU (VD "PLAN"
// vs "SCHEDULE") — ENGINE TỰ TÍNH chênh lệch, KHÔNG đọc bất kỳ chuỗi cảnh báo
// nào AI tự viết. AI chỉ cần báo cáo "doi_chieu": {ma_hieu, loaiNguon, soLuong}
// khi đếm 1 loại cấu kiện có mã ký hiệu rõ ràng xuất hiện ở nhiều nơi trên bộ
// bản vẽ (mặt bằng, bảng thống kê cửa/cửa sổ...).
function doiChieuTheoMaHieu(items) {
  const theoMaHieu = {};
  items.forEach((it) => {
    const dc = it.doi_chieu;
    if (!dc || !dc.ma_hieu || !dc.loaiNguon || !Number.isFinite(Number(dc.soLuong))) return;
    const key = String(dc.ma_hieu).trim().toUpperCase();
    if (!theoMaHieu[key]) theoMaHieu[key] = [];
    theoMaHieu[key].push({ loaiNguon: dc.loaiNguon, soLuong: Number(dc.soLuong), tenGoc: it.name });
  });

  const canhBao = [];
  Object.entries(theoMaHieu).forEach(([maHieu, danhSach]) => {
    const theoNguon = {};
    danhSach.forEach((d) => {
      if (!theoNguon[d.loaiNguon]) theoNguon[d.loaiNguon] = d.soLuong;
    });
    const cacNguon = Object.keys(theoNguon);
    if (cacNguon.length < 2) return; // chỉ 1 nguồn -> không có gì để đối chiếu chéo
    const cacGiaTri = cacNguon.map((n) => theoNguon[n]);
    const min = Math.min(...cacGiaTri), max = Math.max(...cacGiaTri);
    if (min !== max) {
      canhBao.push({ maHieu, theoNguon, chenhLech: max - min });
    }
  });
  return canhBao;
}

function b09_reconciliation(items) {
  const canhBaoThat = doiChieuTheoMaHieu(items);
  const itemsMoi = [...items];
  canhBaoThat.forEach((cb) => {
    const chiTietNguon = Object.entries(cb.theoNguon).map(([nguon, sl]) => `${nguon} = ${sl}`).join(", ");
    itemsMoi.push({
      name: `⚠ REVIEW — Đối chiếu chéo mã hiệu "${cb.maHieu}"`,
      unit: "chênh lệch", qty: cb.chenhLech, group: "hoanthien", qty_source: "engine_reconciliation",
      note: `Engine TỰ PHÁT HIỆN (không phải AI tự viết): mã "${cb.maHieu}" — ${chiTietNguon} — CHÊNH LỆCH ${cb.chenhLech}. Kiểm tra lại: có thể 1 nguồn đếm thiếu/thừa, hoặc 2 nguồn thực sự không khớp (lỗi hồ sơ thiết kế thật, cần báo lại đơn vị thiết kế).`,
    });
  });
  return {
    ketQua: itemsMoi,
    canhBaoThat, // expose để tính reconciliationConfidence cho từng dòng
    trace: {
      step: "09_RECONCILIATION",
      status: "done",
      detail: canhBaoThat.length
        ? `Engine TỰ ĐỐI CHIẾU theo mã hiệu giữa các nguồn khác nhau (không phụ thuộc AI tự viết cảnh báo) — PHÁT HIỆN ${canhBaoThat.length} mã hiệu lệch số liệu: ${canhBaoThat.map((c) => c.maHieu).join(", ")}.`
        : `Engine TỰ ĐỐI CHIẾU theo mã hiệu giữa các nguồn khác nhau — không phát hiện lệch (hoặc chưa có hạng mục nào báo cáo "doi_chieu" để so sánh chéo).`,
    },
  };
}

// Orchestrator — chạy tuần tự đủ 9 bước, gom lại thành 1 "pipelineTrace" để trả
// về cho frontend hiển thị minh bạch bước nào chạy thật/bị chặn + lý do.
// CONFIDENCE MATRIX — 5 chỉ số tách riêng thay vì 1 số "confidence" gộp chung.
// CHỈ "dimensionConfidence" là AI TỰ BÁO CÁO (field "confidence" đã có sẵn) —
// 4 chỉ số còn lại ĐỀU TÍNH XÁC ĐỊNH bằng Engine, KHÔNG hỏi AI tự đoán thêm 4
// con số nữa (AI vốn đã không đủ tin cậy để tự báo cáo 1 số, hỏi thêm 4 số sẽ
// chỉ tạo ra nhiễu, không phải tín hiệu thật).
function tinhConfidenceMatrix(item, b05Status, canhBaoTheoMaHieu) {
  const evidenceConfidence = item.evidence_region ? 1.0 : 0;
  const geometryConfidence = b05Status === "done" ? 1.0 : b05Status === "partial" ? 0.5 : 0.2;
  const dimensionConfidence = Number.isFinite(item.confidence) ? item.confidence : null; // giữ nguyên AI tự báo, null nếu AI không báo
  const formulaConfidence = item.qty_source === "app_formula" ? 1.0 : (item.qty_source === "engine_reconciliation" ? null : 0.3); // Engine tự tính = tin cậy cao nhất
  let reconciliationConfidence = 0.7; // trung tính — không có gì để đối chiếu chéo
  if (item.doi_chieu?.ma_hieu) {
    const maHieu = String(item.doi_chieu.ma_hieu).trim().toUpperCase();
    reconciliationConfidence = canhBaoTheoMaHieu.has(maHieu) ? 0.3 : 1.0; // có lệch = giảm tin cậy, khớp = cao nhất
  }
  return { evidenceConfidence, geometryConfidence, dimensionConfidence, formulaConfidence, reconciliationConfidence };
}

function chayPipeline9Buoc(rawItems, soLuongAnh, images, ocrData = null) {
  const trace = [];
  trace.push(b01_ingest(images));
  trace.push(b02_classify(rawItems));
  trace.push(b03_extract(soLuongAnh));
  const b04 = b04_normalize(rawItems);
  trace.push(b04.trace);
  const b05Trace = b05_scale(b04.ketQua);
  trace.push(b05Trace);
  trace.push(b06_geometry(b04.ketQua));
  trace.push(b07_relationship(b04.ketQua, ocrData));
  const b08 = b08_takeoff(b04.ketQua);
  trace.push(b08.trace);
  const b09 = b09_reconciliation(b08.ketQua);
  trace.push(b09.trace);

  const maHieuLech = new Set((b09.canhBaoThat || []).map((c) => c.maHieu));
  const itemsVoiConfidence = b09.ketQua.map((it) => ({ ...it, confidenceMatrix: tinhConfidenceMatrix(it, b05Trace.status, maHieuLech) }));

  return { items: itemsVoiConfidence, pipelineTrace: trace, drawingModel: xayDungDrawingModel(itemsVoiConfidence, images, trace) };
}

// Cấu trúc đầu ra chuẩn hoá {drawing, pages, objects, evidence, dimensions,
// relationships, quantities} — THÊM VÀO, không thay thế "items" (frontend vẫn
// dùng items như cũ, không phá vỡ gì). THÀNH THẬT: "relationships" ĐỂ RỖNG
// THẬT SỰ vì bước 07_RELATIONSHIP đang bị chặn (chưa tính được quan hệ không
// gian nào đáng tin cho ảnh/PDF) — không bịa dữ liệu vào đây chỉ để "đủ cấu
// trúc trông đẹp". evidence/dimensions CHỈ có entry cho item THẬT SỰ có dữ
// liệu đó, không tạo entry rỗng cho mọi item.
function xayDungDrawingModel(items, images, pipelineTrace) {
  const pages = (images || []).map((img, i) => ({ page: i + 1, name: img.name || `page-${i + 1}` }));
  const objects = items.map((it, i) => ({
    id: `OBJ-${String(i + 1).padStart(4, "0")}`,
    name: it.name, unit: it.unit, group: it.group || null, calc_type: it.calc_type || null,
  }));
  const evidence = items
    .map((it, i) => ({ id: `OBJ-${String(i + 1).padStart(4, "0")}`, it }))
    .filter((x) => x.it.evidence_region)
    .map((x) => ({ objectId: x.id, region: x.it.evidence_region, citation: x.it.note || "" }));
  const dimensions = items
    .map((it, i) => ({ id: `OBJ-${String(i + 1).padStart(4, "0")}`, it }))
    .filter((x) => x.it.formula_inputs)
    .map((x) => ({ objectId: x.id, calc_type: x.it.calc_type, values: x.it.formula_inputs }));
  const quantities = items.map((it, i) => ({
    id: `QTY-${String(i + 1).padStart(4, "0")}`, objectId: `OBJ-${String(i + 1).padStart(4, "0")}`,
    name: it.name, unit: it.unit, qty: it.qty, source: it.qty_source || "ai_direct", status: it.qty != null ? "CONFIRMED" : "MISSING",
  }));
  return {
    drawing: { engineVersion: "1.0-gop-chung", generatedAt: new Date().toISOString() },
    pages, objects, evidence, dimensions,
    relationships: [], // THẬT SỰ RỖNG — bước 07_RELATIONSHIP đang "blocked", xem pipelineTrace
    quantities,
  };
}


// Tính diện tích NET bằng POLYGON BOOLEAN THẬT (intersection/union/difference)
// — dùng thư viện polygon-clipping đã kiểm chứng rộng rãi (không tự viết thuật
// toán Vatti/Greiner-Hormann từ đầu, quá rủi ro). CHỈ dùng khi có đủ toạ độ
// polygon (polygonNgoai + cacLoMoPolygon) — xử lý ĐÚNG trường hợp nhiều lỗ mở
// CHỒNG LẤN nhau (cách trừ số học đơn giản sẽ trừ trùng phần chồng lấn, tính
// SAI — đã kiểm chứng bằng test: cách cũ ra 9m², polygon boolean ra ĐÚNG 10m²
// cho 2 cửa chồng lấn 1m²).
function tinhDienTichTuongBangPolygon(polygonNgoai, cacLoMoPolygon) {
  const polygonClipping = require("polygon-clipping");
  function dienTichShoelace(vertices) {
    let s = 0;
    for (let i = 0; i < vertices.length - 1; i++) s += vertices[i][0] * vertices[i + 1][1] - vertices[i + 1][0] * vertices[i][1];
    return Math.abs(s) / 2;
  }
  const dongKin = (poly) => {
    const p = poly.map((pt) => [Number(pt[0]), Number(pt[1])]);
    if (p[0][0] !== p[p.length - 1][0] || p[0][1] !== p[p.length - 1][1]) p.push(p[0]);
    return p;
  };
  const ngoai = [dongKin(polygonNgoai)];
  const loMo = (cacLoMoPolygon || []).map((lo) => [dongKin(lo)]);
  const ketQua = loMo.length ? polygonClipping.difference(ngoai, ...loMo) : ngoai;
  let dienTich = 0;
  ketQua.forEach((poly) => poly.forEach((ring) => { dienTich += dienTichShoelace(ring); }));
  return +dienTich.toFixed(4);
}

function tinhQtyTuongTuFormulaInputs(fi) {
  if (!fi || typeof fi !== "object") return null;

  // ĐƯỜNG MỚI (polygon boolean thật) — CHỈ dùng khi AI/DXF cung cấp đủ toạ độ
  // polygon thật (KHÔNG phải mặc định, không đổi hành vi cũ nếu thiếu dữ liệu
  // này). Dùng khi tường không phải chữ nhật đơn giản, hoặc có nhiều lỗ mở
  // chồng lấn cần tính đúng — 2 tình huống cách trừ đơn giản KHÔNG xử lý được.
  if (Array.isArray(fi.polygon_ngoai) && fi.polygon_ngoai.length >= 3) {
    try {
      const dienTich = tinhDienTichTuongBangPolygon(fi.polygon_ngoai, fi.cac_lo_mo_polygon);
      if (!Number.isFinite(dienTich) || dienTich < 0 || dienTich > 25000) return null; // chặn số vô lý (500m x 50m tối đa tương tự đường cũ)
      return dienTich;
    } catch (e) {
      return null; // polygon hỏng (tự cắt nhau, toạ độ lỗi...) -> không đoán bừa, loại dòng
    }
  }

  // ĐƯỜNG CŨ (mặc định) — dài×cao trừ tổng diện tích lỗ mở, KHÔNG xử lý đúng
  // khi các lỗ mở chồng lấn nhau (hiếm gặp trong thực tế xây dựng thông
  // thường — cửa/cửa sổ thường không chồng lấn — nên vẫn đủ dùng cho đa số).
  const dai = Number(fi.length_m), cao = Number(fi.height_m);
  if (!Number.isFinite(dai) || dai <= 0 || !Number.isFinite(cao) || cao <= 0) return null;
  // Chặn số đo vô lý (AI "ảo giác" ra tường dài 500m/cao 50m — không thực tế
  // cho công trình dân dụng, thà từ chối còn hơn để lọt số bịa vào BOQ).
  if (dai > 500 || cao > 50) return null;
  const dienTichGop = dai * cao;
  const tongTru = Array.isArray(fi.deductions)
    ? fi.deductions.reduce((s, d) => {
        const w = Number(d?.width_m) || 0, h = Number(d?.height_m) || 0, c = Number(d?.count) || 1;
        if (w > 50 || h > 50 || c > 100) return s; // bỏ lỗ mở vô lý, không cộng vào
        return s + Math.max(0, w) * Math.max(0, h) * Math.max(0, c);
      }, 0)
    : 0;
  const net = Math.max(0, dienTichGop - tongTru);
  return +net.toFixed(4); // chống rác dấu phẩy động (VD 12.999999999998 -> 13.0)
}

// ---- 4 hàm mới: cột/dầm/móng/sàn — cùng nguyên lý an toàn với tường (CHỈ
// dùng số đo AI đọc/ước lượng, KHÔNG tin qty AI tự tính; có ngưỡng chặn số đo
// vô lý riêng cho từng loại cấu kiện, phù hợp quy mô công trình dân dụng). ----

function tinhQtyCotTuFormulaInputs(fi) {
  if (!fi || typeof fi !== "object") return null;
  const rong = Number(fi.rong_m), day = Number(fi.day_m), cao = Number(fi.cao_m);
  if (!Number.isFinite(rong) || rong <= 0 || !Number.isFinite(day) || day <= 0 || !Number.isFinite(cao) || cao <= 0) return null;
  // Cột dân dụng hiếm khi tiết diện >2m mỗi cạnh, cao >50m (đã dùng chung ngưỡng tường)
  if (rong > 2 || day > 2 || cao > 50) return null;
  return +(rong * day * cao).toFixed(4); // m³
}

function tinhQtyDamTuFormulaInputs(fi) {
  if (!fi || typeof fi !== "object") return null;
  const rong = Number(fi.rong_m), cao = Number(fi.cao_m), dai = Number(fi.dai_m);
  if (!Number.isFinite(rong) || rong <= 0 || !Number.isFinite(cao) || cao <= 0 || !Number.isFinite(dai) || dai <= 0) return null;
  if (rong > 2 || cao > 2 || dai > 500) return null; // dầm dài >500m là bất thường
  return +(rong * cao * dai).toFixed(4); // m³
}

function tinhQtyMongTuFormulaInputs(fi) {
  if (!fi || typeof fi !== "object") return null;
  const dai = Number(fi.dai_m), rong = Number(fi.rong_m), cao = Number(fi.cao_m);
  if (!Number.isFinite(dai) || dai <= 0 || !Number.isFinite(rong) || rong <= 0 || !Number.isFinite(cao) || cao <= 0) return null;
  if (dai > 500 || rong > 500 || cao > 10) return null; // móng hiếm khi cao >10m
  return +(dai * rong * cao).toFixed(4); // m³
}

function tinhQtySanTuFormulaInputs(fi) {
  if (!fi || typeof fi !== "object") return null;
  const dai = Number(fi.dai_m), rong = Number(fi.rong_m), day = Number(fi.day_m);
  if (!Number.isFinite(dai) || dai <= 0 || !Number.isFinite(rong) || rong <= 0 || !Number.isFinite(day) || day <= 0) return null;
  if (dai > 500 || rong > 500 || day > 1) return null; // sàn dày >1m là bất thường (dân dụng thường 8-20cm)
  return +(dai * rong * day).toFixed(4); // m³
}

// ---- 2 hàm MỚI — đóng nốt khe hở cuối cùng: TRƯỚC ĐÂY "doc_truc_tiep" và
// "dem_so_luong" tin THẲNG field "qty" AI đưa (không qua hàm kiểm tra nào cả).
// GIỜ CẢ 2 TRƯỜNG HỢP NÀY CŨNG PHẢI QUA ENGINE — AI không còn field "qty"
// được tin trực tiếp ở BẤT KỲ calc_type nào nữa, chỉ có "formula_inputs"
// (đóng vai trò "dimension" — số đo/giá trị thô AI đọc/đếm được) + "confidence"
// (độ tự tin AI tự báo cáo) → Engine LUÔN LÀ NƠI DUY NHẤT quyết định qty cuối.
function tinhQtyDocTrucTiepTuFormulaInputs(fi) {
  if (!fi || typeof fi !== "object") return null;
  const v = Number(fi.value_do_duoc);
  if (!Number.isFinite(v) || v < 0) return null;
  if (v > 1e9) return null; // chặn số vô lý (AI ảo giác ra số khổng lồ)
  return +v.toFixed(4);
}
function tinhQtyDemSoLuongTuFormulaInputs(fi) {
  if (!fi || typeof fi !== "object") return null;
  const v = Number(fi.so_luong);
  if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) return null; // đếm phải là số nguyên
  if (v > 100000) return null; // chặn số đếm vô lý
  return v;
}

// Chuẩn hoá "confidence" AI tự báo cáo (0-1) — CHỈ dùng để hiển thị/tham khảo
// cho người kiểm tra biết AI tự tin tới đâu, KHÔNG dùng để tự động quyết định
// gì (không tự loại bỏ dòng có confidence thấp — vẫn cần người kiểm tra xem).
function chuanHoaConfidence(c) {
  const n = Number(c);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, +n.toFixed(2)));
}

// Kiểm tra "evidence_region" AI trả về có đúng khuôn dạng 0-1 không — nếu sai
// (VD AI lỡ trả toạ độ pixel thật thay vì tỷ lệ %, hoặc thiếu trường), ĐẶT VỀ
// null thay vì giữ số rác — vì đây chỉ là gợi ý vị trí GẦN ĐÚNG cho người kiểm
// tra, không đáng để chặn cả dòng hạng mục chỉ vì vùng này sai định dạng.
function chuanHoaEvidenceRegion(r) {
  if (!r || typeof r !== "object") return null;
  const x = Number(r.x), y = Number(r.y), w = Number(r.w), h = Number(r.h);
  if (![x, y, w, h].every((v) => Number.isFinite(v))) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1 || w <= 0 || w > 1 || h <= 0 || h > 1) return null;
  if (x + w > 1.05 || y + h > 1.05) return null; // vùng vượt quá khung ảnh -> chắc chắn sai định dạng
  return { x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4) };
}

// VALIDATE toàn bộ hạng mục AI trả về TRƯỚC KHI gửi cho app ghi vào state (mục 2
// yêu cầu) — loại bỏ dòng rác: thiếu tên, khối lượng âm/NaN, đơn vị rỗng, group
// không hợp lệ. Không sửa/bịa giá trị — chỉ LOẠI những dòng rõ ràng hỏng, giữ
// nguyên các dòng hợp lệ. Đây là lưới an toàn cuối cùng trước khi dữ liệu vào app.
const NHOM_HOP_LE = new Set(["mong", "khung", "hoanthien", "mep"]);
// Bảng tra cứu calc_type -> hàm Engine tương ứng. MỌI calc_type (kể cả đọc
// trực tiếp/đếm số lượng) đều PHẢI có mặt ở đây — không còn nhánh nào đọc
// thẳng "raw.qty" nữa. calc_type không có trong bảng này (AI tự bịa ra loại
// lạ, hoặc thiếu calc_type) sẽ bị LOẠI BỎ HẲN ở bước filter, không đoán bừa.
const BANG_CONG_THUC_ENGINE = {
  doc_truc_tiep: { fn: tinhQtyDocTrucTiepTuFormulaInputs, moTa: (fi) => `đọc trực tiếp số "${fi?.value_do_duoc}" ghi trên bản vẽ` },
  dem_so_luong: { fn: tinhQtyDemSoLuongTuFormulaInputs, moTa: (fi) => `đếm được ${fi?.so_luong} vật thể trên bản vẽ` },
  tinh_tu_kich_thuoc_tuong: { fn: tinhQtyTuongTuFormulaInputs, moTa: (fi) => `${fi?.length_m}m × ${fi?.height_m}m − trừ cửa (m²)` },
  tinh_tu_kich_thuoc_cot: { fn: tinhQtyCotTuFormulaInputs, moTa: (fi) => `${fi?.rong_m}m × ${fi?.day_m}m × ${fi?.cao_m}m cao (m³)` },
  tinh_tu_kich_thuoc_dam: { fn: tinhQtyDamTuFormulaInputs, moTa: (fi) => `${fi?.rong_m}m × ${fi?.cao_m}m × ${fi?.dai_m}m dài (m³)` },
  tinh_tu_kich_thuoc_mong: { fn: tinhQtyMongTuFormulaInputs, moTa: (fi) => `${fi?.dai_m}m × ${fi?.rong_m}m × ${fi?.cao_m}m cao (m³)` },
  tinh_tu_kich_thuoc_san: { fn: tinhQtySanTuFormulaInputs, moTa: (fi) => `${fi?.dai_m}m × ${fi?.rong_m}m × ${fi?.day_m}m dày (m³)` },
};

function locHangMucHopLe(danhSach) {
  return (danhSach || [])
    .map((raw) => {
      // Clone nông — không sửa object gốc từ parseRawJsonTuAI.
      if (!raw || typeof raw !== "object") return raw;
      const item = { ...raw };

      // TUYỆT ĐỐI KHÔNG đọc "raw.qty"/"item.qty" ở bất kỳ đâu trong hàm này —
      // qty CHỈ được sinh ra từ 1 nguồn duy nhất: hàm Engine tra trong bảng
      // trên, áp dụng cho MỌI calc_type không ngoại lệ.
      const congThuc = BANG_CONG_THUC_ENGINE[item.calc_type];
      if (congThuc) {
        const qtyThat = congThuc.fn(item.formula_inputs);
        item.qty = qtyThat; // null nếu formula_inputs thiếu/hỏng -> dòng này bị lọc bỏ ở bước dưới
        item.note = (item.note || "") + ` [Engine tự tính: ${congThuc.moTa(item.formula_inputs)} = ${qtyThat != null ? qtyThat : "LỖI"} — không dùng bất kỳ số nào AI có thể đã tự đưa]`;
        item.qty_source = "app_formula";
      } else {
        // calc_type thiếu/không nhận diện được -> KHÔNG có cách nào tính ra
        // qty đáng tin -> loại bỏ, không đoán bừa.
        item.qty = null;
      }
      if (item.evidence_region !== undefined) item.evidence_region = chuanHoaEvidenceRegion(item.evidence_region);
      if (item.confidence !== undefined) item.confidence = chuanHoaConfidence(item.confidence);
      return item;
    })
    .filter((item) => {
      if (!item || typeof item !== "object") return false;
      if (typeof item.name !== "string" || !item.name.trim()) return false;
      if (item.qty === null) return false; // Engine tính lỗi/calc_type lạ -> loại, không đoán bừa
      const qty = Number(item.qty);
      if (!Number.isFinite(qty) || qty < 0) return false; // chặn khối lượng âm/NaN ngay từ backend
      if (item.group != null && !NHOM_HOP_LE.has(item.group)) item.group = undefined; // group lạ -> để trống, không chặn cả dòng
      return true;
    });
}

// Đơn giá token USD/1 triệu token — theo TỪNG HÃNG (khác nhau rất nhiều, không
// dùng chung 1 giá được). Nguồn: trang giá chính thức từng hãng, cập nhật
// 24/08/2026 — giá AI đổi liên tục, kiểm tra lại nếu thấy lệch nhiều so với hoá
// đơn thật. Gemini có bản miễn phí — nếu đang dùng free tier thì usd thực tế = 0
// dù công thức dưới vẫn tính ra 1 số (chỉ mang tính tham khảo).
const GIA_THEO_HANG = {
  claude: { input: 3, output: 15, nguon: "claude.com/pricing" },
  openai: { input: 2.5, output: 10, nguon: "openai.com/api/pricing (gpt-4o)" },
  gemini: { input: 1.25, output: 5, nguon: "ai.google.dev/pricing (gemini-1.5-pro) — CÓ bản miễn phí, kiểm tra tài khoản Google trước khi tin số này" },
};

// Tính chi phí của 1 lần gọi AI, trả về cả token lẫn tiền (USD và VNĐ ước tính).
// "hang" xác định dùng đúng bảng giá của hãng nào — mặc định "claude" để không
// đổi hành vi cũ nếu không truyền vào.
function tinhChiPhi(usage, tyGiaVND, hang) {
  const gia = GIA_THEO_HANG[hang] || GIA_THEO_HANG.claude;
  const inTok = usage?.input_tokens || 0;
  const outTok = usage?.output_tokens || 0;
  const usd = (inTok / 1e6) * gia.input + (outTok / 1e6) * gia.output;
  return {
    inputTokens: inTok,
    outputTokens: outTok,
    usd: +usd.toFixed(5),
    vnd: Math.round(usd * (tyGiaVND || 26000)),
  };
}

const TAKEOFF_PROMPT_GOC =
  'Đây là bản vẽ/bảng thống kê xây dựng, có thể nhiều trang/nhiều tầng — có thể là bảng khối lượng dạng cột số, ' +
  'HOẶC mặt bằng kiến trúc chỉ ghi trực tiếp diện tích/kích thước từng phòng (ví dụ chữ "23,90m2" viết ngay trong phòng, ' +
  'kích thước tường ghi trên trục kích thước, tên phòng như "WC", "Phòng số 1"...). CẢ HAI DẠNG ĐỀU LÀ SỐ LIỆU HỢP LỆ ĐỂ BÓC KHỐI LƯỢNG — ' +
  'không chỉ giới hạn ở bảng thống kê chính thức. Đọc toàn bộ trang, liệt kê TỪNG hạng mục nhìn thấy được, không gộp chung chung. ' +
  'CHỈ trả về mảng rỗng [] khi ảnh THỰC SỰ không có bất kỳ số đo/diện tích/kích thước nào đọc được (ảnh mờ, không phải bản vẽ, trang trống) — ' +
  'không trả rỗng chỉ vì thiếu bảng thống kê dạng cột số chính thức. ' +
  'Với mỗi hạng mục, xếp vào đúng 1 trong 4 nhóm sau (điền vào trường "group"): ' +
  '"mong" (móng, nền, đào đắp), "khung" (cột/dầm/sàn/cầu thang/kết cấu chịu lực), ' +
  '"hoanthien" (xây/trát/sơn/ốp lát/trần/cửa/lan can/hoàn thiện sàn), "mep" (điện/nước/điều hoà/thang máy/PCCC/thiết bị). ' +
  '\n\n' +
  'THÊM trường "declared_scale" cho MỌI hạng mục — nếu bản vẽ có ghi rõ TỶ LỆ (VD chữ "TỶ LỆ 1:100" hoặc "SCALE 1:50" ' +
  'thường ở góc bản vẽ hoặc dưới tiêu đề), điền chuỗi dạng "1:100" vào MỌI hạng mục (lặp lại giống nhau); nếu KHÔNG thấy ' +
  'ghi tỷ lệ ở đâu trên trang, để null. Đây CHỈ để đối chiếu tham khảo (không dùng thay cho số đo/kích thước ghi trực tiếp). ' +
  '\n\n' +
  'THÊM trường "known_geometry_ref" cho MỌI hạng mục — nếu bản vẽ có ghi khoảng cách LƯỚI CỘT/TRỤC (VD "TRỤC A-B: 4000" ' +
  'hoặc ký hiệu lưới có ghi số đo), điền {"loai":"grid_spacing","gia_tri_m":số mét,"mo_ta":"tên trục/lưới đó"}; nếu KHÔNG ' +
  'thấy, để null. Đây CHỈ để đối chiếu tham khảo (giống declared_scale) — KHÔNG dùng thay cho số đo trực tiếp trên hạng mục đó. ' +
  '\n\n' +
  'QUAN TRỌNG NHẤT — PHÂN LOẠI "calc_type" cho MỌI hạng mục. AI KHÔNG BAO GIỜ tự quyết định khối lượng cuối cùng — KHÔNG CÓ ' +
  'trường "qty" nào trong JSON trả về cả. AI CHỈ báo cáo SỐ ĐO/GIÁ TRỊ THÔ đọc/đếm/ước lượng được (qua "formula_inputs"), ' +
  'app luôn là nơi DUY NHẤT tính ra khối lượng cuối cùng từ số đo đó, cho MỌI loại hạng mục không ngoại lệ: ' +
  '\n' +
  '• "doc_truc_tiep" — con số đã ghi SẴN trên bản vẽ (VD "23,9m2" viết trong phòng, hoặc 1 dòng có sẵn trong bảng khối lượng). ' +
  'AI chỉ CHÉP LẠI, không tính gì — điền "formula_inputs": {"value_do_duoc": đúng con số đọc được}. ' +
  '\n' +
  '• "dem_so_luong" — đếm số lượng vật thể nhìn thấy (VD đếm 5 cửa sổ, 3 cột). AI chỉ ĐẾM — điền "formula_inputs": {"so_luong": số đếm được}. ' +
  '\n' +
  '• "tinh_tu_kich_thuoc_tuong" — PHẢI dùng khi tính diện tích tường/vách mà cần ƯỚC LƯỢNG chiều dài×chiều cao bằng mắt từ bản vẽ ' +
  '(không có sẵn số ghi trực tiếp). Điền đủ ' +
  '"formula_inputs": {"length_m": số mét dài đo được, "height_m": số mét cao đo được (dùng 3.3 nếu không có số liệu, ghi rõ trong note là giả định), ' +
  '"deductions": [{"width_m":..., "height_m":..., "count":...}]} liệt kê từng cửa/cửa sổ cần trừ (mảng rỗng [] nếu không có). ' +
  'App sẽ tự tính khối lượng = length_m × height_m − tổng diện tích deductions, không dùng số AI tự cộng trừ. ' +
  '\n' +
  '• "tinh_tu_kich_thuoc_cot" — tính khối lượng BÊ TÔNG CỘT khi cần ƯỚC LƯỢNG kích thước tiết diện×chiều cao bằng mắt. ' +
  'Điền "formula_inputs": {"rong_m": chiều rộng tiết diện, "day_m": chiều dày tiết diện, "cao_m": chiều cao cột}. ' +
  'App tự tính khối lượng = rong_m × day_m × cao_m (m³). ' +
  '\n' +
  '• "tinh_tu_kich_thuoc_dam" — tính khối lượng BÊ TÔNG DẦM. Điền "formula_inputs": {"rong_m": chiều rộng tiết diện, ' +
  '"cao_m": chiều cao tiết diện, "dai_m": chiều dài dầm}. App tự tính khối lượng = rong_m × cao_m × dai_m (m³). ' +
  '\n' +
  '• "tinh_tu_kich_thuoc_mong" — tính khối lượng BÊ TÔNG MÓNG. Điền "formula_inputs": {"dai_m": chiều dài móng, ' +
  '"rong_m": chiều rộng móng, "cao_m": chiều cao/chiều dày móng}. App tự tính khối lượng = dai_m × rong_m × cao_m (m³). ' +
  '\n' +
  '• "tinh_tu_kich_thuoc_san" — tính khối lượng BÊ TÔNG SÀN. Điền "formula_inputs": {"dai_m": chiều dài sàn, ' +
  '"rong_m": chiều rộng sàn, "day_m": chiều dày sàn (dùng 0.1-0.12 nếu không có số liệu, ghi rõ trong note là giả định)}. ' +
  'App tự tính khối lượng = dai_m × rong_m × day_m (m³). ' +
  '\n\n' +
  'BẮT BUỘC TỰ KIỂM CHỨNG (không cần dữ liệu công trình khác — chỉ đối chiếu NGAY TRONG bộ bản vẽ đang đọc): ' +
  'trường "note" của MỌI hạng mục PHẢI ghi rõ CÔNG THỨC TÍNH kèm số liệu cụ thể lấy từ đâu trên bản vẽ (VD "5m dài x 3m cao - 2m2 cửa = 13m2", ' +
  'hoặc "đọc trực tiếp số 23.90m2 ghi trong phòng"), KHÔNG được chỉ ghi 1 câu mô tả chung chung không có số. ' +
  'Nếu bản vẽ có ghi tổng diện tích sàn/công trình ở đâu đó (VD tiêu đề, bảng chỉ tiêu), SAU KHI liệt kê xong toàn bộ phòng, ' +
  'tự cộng lại tổng diện tích các phòng đã liệt kê và so với con số tổng đó — nếu lệch quá 10%, thêm 1 hạng mục cuối tên ' +
  '"CẢNH BÁO ĐỐI CHIẾU NỘI BỘ" (group "hoanthien", qty 0, calc_type "doc_truc_tiep") ghi rõ trong note 2 con số lệch nhau bao nhiêu. ' +
  'TUYỆT ĐỐI CHỈ trả lời bằng JSON thuần — không viết bất kỳ chữ giải thích, lời dẫn, hay ghi chú nào trước hoặc sau JSON, ' +
  'không dùng markdown ```. Tên hạng mục ngắn gọn, nhưng "note" phải đủ công thức+số liệu như yêu cầu trên (không cắt ngắn note). ' +
  'TRƯỚC KHI TRẢ LỜI — TỰ RÀ SOÁT LẠI TOÀN BỘ DANH SÁCH 1 LẦN: nếu có 2 hạng mục cùng tên (hoặc cùng ý nghĩa, chỉ khác cách gọi) ' +
  'xuất hiện ở nhiều trang khác nhau NHƯNG THỰC RA LÀ CÙNG 1 CẤU KIỆN (VD tường được nhìn thấy lặp lại ở mặt bằng và mặt cắt của CÙNG 1 vị trí) ' +
  '→ CHỈ giữ 1 dòng duy nhất, không liệt kê trùng. Ngược lại, nếu là các cấu kiện THỰC SỰ khác nhau dù trùng tên (VD "Xây tường Phòng 1" và ' +
  '"Xây tường Phòng 2" là 2 tường khác nhau dù cùng loại công tác) thì giữ nguyên riêng biệt, không gộp nhầm. ' +
  '\n\n' +
  'THÊM trường "evidence_region" cho MỌI hạng mục — ước lượng GẦN ĐÚNG vị trí trên trang chứa số liệu dùng để tính, ' +
  'dạng {"x":số 0-1, "y":số 0-1, "w":số 0-1, "h":số 0-1} (x,y = góc trên-trái tính theo % chiều rộng/cao ảnh, w,h = % kích ' +
  'thước vùng đó). ĐÂY LÀ ƯỚC LƯỢNG BẰNG MẮT của AI, KHÔNG CẦN CHÍNH XÁC TUYỆT ĐỐI — chỉ để người kiểm tra tìm nhanh vùng ' +
  'liên quan trên trang, không dùng để đo đạc. Nếu không ước lượng được vị trí (VD số liệu suy luận từ nhiều chỗ), để null. ' +
  '\n\n' +
  'THÊM trường "doi_chieu" cho hạng mục có MÃ HIỆU RÕ RÀNG (VD "D01", "W02" — thường là cửa/cửa sổ/cấu kiện lặp lại) VÀ ' +
  'đếm được từ 2 NGUỒN KHÁC NHAU trên cùng bộ bản vẽ (VD vừa đếm được trên MẶT BẰNG, vừa có trong BẢNG THỐNG KÊ CỬA riêng) — ' +
  'điền {"ma_hieu":"D01","loaiNguon":"PLAN" hoặc "SCHEDULE" hoặc tên nguồn khác,"soLuong":số đếm được TỪ NGUỒN ĐÓ}. App sẽ ' +
  'TỰ SO SÁNH số liệu giữa các nguồn khác nhau (không cần AI tự viết cảnh báo lệch — chỉ cần báo đúng số đếm từ TỪNG nguồn). ' +
  'Nếu không có mã hiệu rõ ràng hoặc chỉ có 1 nguồn duy nhất, để null. ' +
  'Đúng định dạng — TUYỆT ĐỐI KHÔNG có trường "qty" (AI không quyết định khối lượng cuối, chỉ báo cáo số đo thô): ' +
  '[{"name":"tên hạng mục ngắn gọn","unit":"đơn vị","group":"mong|khung|hoanthien|mep",' +
  '"calc_type":"doc_truc_tiep|dem_so_luong|tinh_tu_kich_thuoc_tuong|tinh_tu_kich_thuoc_cot|tinh_tu_kich_thuoc_dam|tinh_tu_kich_thuoc_mong|tinh_tu_kich_thuoc_san",' +
  '"formula_inputs":object đúng khuôn dạng calc_type tương ứng ở trên (BẮT BUỘC có, không được null),' +
  '"confidence":số 0-1 (AI tự đánh giá độ tự tin vào số đo mình đưa ra — 1 = rất chắc chắn, 0.3 = ước lượng mơ hồ),' +
  '"evidence_region":null hoặc {"x":số,"y":số,"w":số,"h":số},"declared_scale":null hoặc "1:100",' +
  '"known_geometry_ref":null hoặc {"loai":"grid_spacing","gia_tri_m":số,"mo_ta":"tên trục"},' +
  '"doi_chieu":null hoặc {"ma_hieu":"D01","loaiNguon":"PLAN","soLuong":số},"note":"CÔNG THỨC + số liệu cụ thể"}]';

// Tạo prompt cho 1 lượt đọc.
// - ghiChuThem: người dùng gõ tay yêu cầu bổ sung (VD: "còn thiếu cầu thang").
// - danhSachChuan: danh sách TÊN đầu việc lấy từ mẫu dự toán đã lưu của ĐÚNG nhóm
//   công trình (nhà phố/shophouse/...) — khi có, AI được yêu cầu ưu tiên khớp số
//   liệu đọc được vào đúng các đầu việc này thay vì tự đặt tên mới tự do, để kết
//   quả bám sát cấu trúc dự toán chuẩn công ty đã lập sẵn (và nhờ vậy tự động có
//   đơn giá thật từ định mức đã khớp, không rơi vào định mức mới giá 0đ).
function taoPrompt(ghiChuThem, danhSachChuan, tenCam, tenUuTien) {
  let p = TAKEOFF_PROMPT_GOC;
  if (Array.isArray(danhSachChuan) && danhSachChuan.length) {
    p += `\n\nCÔNG TY ĐÃ CÓ SẴN DANH SÁCH ${danhSachChuan.length} ĐẦU VIỆC CHUẨN cho loại công trình này (từ mẫu dự toán đầy đủ đã lập trước — đây là mẫu THẬT, ĐẦY ĐỦ mà công ty dùng cho công trình cùng loại):\n` +
      danhSachChuan.map((t, i) => `${i + 1}. ${t}`).join("\n") +
      `\n\nNHIỆM VỤ BẮT BUỘC — RÀ QUA TỪNG ĐẦU VIỆC TRONG DANH SÁCH TRÊN, LẦN LƯỢT TỪ 1 ĐẾN ${danhSachChuan.length}, KHÔNG BỎ SÓT ĐẦU VIỆC NÀO:\n` +
      `Với MỖI đầu việc trong danh sách, kiểm tra kỹ toàn bộ (các) trang bản vẽ xem có số liệu/kích thước/ghi chú nào liên quan không. ` +
      `Nếu CÓ đủ căn cứ để tính (dù phải suy luận từ kích thước/diện tích ghi trên bản vẽ) → thêm 1 dòng vào kết quả, "name" ghi ĐÚNG NGUYÊN VĂN tên trong danh sách trên. ` +
      `Nếu KHÔNG tìm thấy căn cứ nào cho đầu việc đó trên (các) trang bản vẽ hiện có → BỎ QUA đầu việc đó (không thêm vào kết quả, không bịa số) — nhưng vẫn phải kiểm tra hết toàn bộ danh sách trước khi kết luận, không dừng sớm. ` +
      `Đây là bộ bản vẽ thật của 1 công trình đầy đủ — nếu danh sách mẫu có ${danhSachChuan.length} đầu việc mà kết quả trả về chỉ vài dòng, gần như chắc chắn bạn đã BỎ SÓT chứ không phải bản vẽ thiếu dữ liệu — hãy xem lại kỹ hơn trước khi kết luận thiếu. ` +
      `Sau danh sách chuẩn, NẾU còn thấy số liệu rõ ràng trên bản vẽ mà KHÔNG khớp đầu việc nào trong danh sách, vẫn thêm vào kết quả với tên mới phù hợp (đừng bỏ sót số liệu chỉ vì không có sẵn tên).`;
  }
  // Danh sách tên CẤM/ƯU TIÊN do QS tự cấu hình — giảm tỷ lệ AI tự bịa tên
  // mới gây cảnh báo QC_MISSING không cần thiết (VD công ty luôn gọi "Xây
  // tường 100" chứ không phải "Xây tường gạch 10cm" — nếu không nói rõ, AI
  // có thể tự đặt tên khác nghĩa giống nhau, tạo 2 dòng riêng biệt nhầm lẫn).
  if (Array.isArray(tenUuTien) && tenUuTien.length) {
    p += `\n\nƯU TIÊN dùng ĐÚNG các tên sau khi mô tả hạng mục tương ứng (không tự đặt tên khác nếu đã có tên chuẩn ở đây): ${tenUuTien.join(", ")}.`;
  }
  if (Array.isArray(tenCam) && tenCam.length) {
    p += `\n\nTUYỆT ĐỐI KHÔNG dùng các tên/cách gọi sau (công ty đã cấm vì gây nhầm lẫn hoặc trùng nghĩa với tên chuẩn khác): ${tenCam.join(", ")}.`;
  }
  const gc = (ghiChuThem || "").trim();
  if (gc) p += `\n\nYÊU CẦU BỔ SUNG TỪ NGƯỜI DÙNG (ưu tiên đọc kỹ theo yêu cầu này): ${gc}`;
  return p;
}

// ============================================================================
// POST /api/analyze-image   body: { base64, mediaType }
// ============================================================================
app.post("/api/analyze-image", aiLimiter, batBuocDangNhap, async (req, res) => {
  try {
    const { base64, mediaType, ghiChuThem, danhSachChuan, provider, tenCam, tenUuTien } = req.body || {};
    if (!base64 || !mediaType) return res.status(400).json({ error: "Thiếu base64 hoặc mediaType" });
    const data = await callUnifiedAI([
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: taoPrompt(ghiChuThem, danhSachChuan, tenCam, tenUuTien) },
    ], undefined, provider);
    const hangDaDung = provider || AI_PROVIDER;
    const chiPhi = tinhChiPhi(data.usage, undefined, hangDaDung);
    ghiNhatKy({ luc: new Date().toISOString(), nguoi: req.nguoiDung?.ten || "?", loai: "ảnh", ten: req.body?.name || "", ...chiPhi });
    const rawItems = parseRawJsonTuAI(data);
    const { items, pipelineTrace } = chayPipeline9Buoc(rawItems, 1, [{ base64, name: req.body?.name || "?" }]);
    res.json({ items, pipelineTrace, cost: chiPhi, model: hangDaDung === "claude" ? ANTHROPIC_MODEL : hangDaDung, provider: hangDaDung });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ============================================================================
// POST /api/analyze-images-batch   body: { images:[{base64,mediaType,name}], ghiChuThem, danhSachChuan }
// ----------------------------------------------------------------------------
// Đọc NHIỀU ảnh trong CÙNG 1 lượt gọi AI — để AI thấy được toàn bộ các trang
// cùng lúc và đối chiếu chéo giữa chúng (VD: phòng lặp lại ở nhiều tầng, không
// tính trùng), giống hệt cách đọc trực tiếp trong khung chat. Gọi riêng từng ảnh
// một (endpoint /api/analyze-image ở trên) khiến AI không biết các ảnh liên quan
// nhau, kết quả thiếu và rời rạc hơn hẳn — đây là lý do được yêu cầu bổ sung.
// ============================================================================
// Google Vision OCR — nguồn BỔ SUNG (không thay Claude, không tính/ghi đè bất
// kỳ qty nào). Trả về chữ + toạ độ pixel THẬT để QS đối chiếu/tham khảo, hoặc
// để frontend tự dùng làm evidence_region chính xác hơn nếu muốn.
app.post("/api/ocr-vision", aiLimiter, batBuocDangNhap, async (req, res) => {
  try {
    if (!ocrGoogleVision) return res.status(501).json({ error: "Google Vision chưa được cấu hình — thiếu GOOGLE_VISION_API_KEY trên server." });
    const { base64, mediaType } = req.body || {};
    if (!base64) return res.status(400).json({ error: "Thiếu base64 ảnh." });
    const ketQua = await ocrGoogleVision(base64, mediaType || "image/jpeg", GOOGLE_VISION_API_KEY);
    res.json(ketQua);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/analyze-images-batch", aiLimiter, gioiHanDongThoi, batBuocDangNhap, async (req, res) => {
  try {
    const { images, ghiChuThem, danhSachChuan, provider, tenCam, tenUuTien } = req.body || {};
    if (!Array.isArray(images) || !images.length) return res.status(400).json({ error: "Thiếu danh sách ảnh" });
    if (images.length > 20) return res.status(400).json({ error: "Tối đa 20 ảnh mỗi lượt đọc gộp." });
    // SỬA LỖI 4: chèn nhãn số thứ tự + tên file NGAY TRƯỚC mỗi ảnh, để AI biết
    // chính xác đang xem ảnh số mấy — bắt buộc AI trả về "source_image_index"
    // cho mỗi hạng mục, tránh tình trạng trước đây mọi item trong batch đều bị
    // gán chung 1 chuỗi tên TẤT CẢ ảnh gộp lại (mất khả năng biết đúng nguồn).
    const contentBlocks = [];
    images.forEach((img, i) => {
      contentBlocks.push({ type: "text", text: `--- Ảnh số ${i + 1} (tên file: "${img.name || "?"}") ---` });
      contentBlocks.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
    });
    const ghiChuGop = (ghiChuThem || "") +
      `\n\n(Lưu ý: đây là ${images.length} trang/ảnh THUỘC CÙNG 1 BỘ bản vẽ, mỗi ảnh có nhãn "--- Ảnh số N ---" ngay trước nó — ` +
      `đọc và đối chiếu chéo giữa các trang. PHÂN BIỆT RÕ 2 trường hợp: (1) CÙNG 1 cấu kiện nhìn thấy ở NHIỀU GÓC/NHIỀU LOẠI BẢN VẼ của ` +
      `CÙNG 1 tầng (VD tường xuất hiện cả ở mặt bằng lẫn mặt cắt của tầng 1) → chỉ tính 1 lần, KHÔNG trùng. (2) CÙNG LOẠI hạng mục ` +
      `lặp lại ở NHIỀU TẦNG KHÁC NHAU (VD "Hoàn thiện sàn" xuất hiện ở cả tầng 1, tầng 2, tầng 3...) → TUYỆT ĐỐI KHÔNG được ` +
      `cộng dồn thành 1 số duy nhất cho cả công trình — PHẢI tách thành TỪNG DÒNG RIÊNG cho MỖI TẦNG, ghi rõ số tầng ngay ` +
      `trong "name" (VD "Hoàn thiện sàn – Tầng 1", "Hoàn thiện sàn – Tầng 2"...), để kỹ sư QS đối chiếu được TỪNG DÒNG với ` +
      `ĐÚNG trang bản vẽ của tầng đó — không đưa 1 con số gộp mà không ai kiểm tra lại được đúng/sai từ đâu. ` +
      `\n\nBẮT BUỘC: thêm trường "source_image_index" (số nguyên 1-${images.length}) cho MỌI hạng mục — chỉ rõ hạng mục đó đọc được ` +
      `TỪ ẢNH SỐ MẤY (dựa theo nhãn "--- Ảnh số N ---"). Nếu hạng mục tổng hợp/đối chiếu từ nhiều ảnh, ghi số ảnh CHÍNH chứa số liệu ` +
      `dùng để tính. Không được để trống trường này.)`;
    contentBlocks.push({ type: "text", text: taoPrompt(ghiChuGop, danhSachChuan, tenCam, tenUuTien) });
    // Cho phép đổi hãng AI NGAY TRONG 1 lần gọi (không cần đổi biến môi trường +
    // deploy lại) — để so sánh trực tiếp Claude vs Gemini trên CÙNG 1 bộ ảnh.
    const data = await callUnifiedAI(contentBlocks, undefined, provider);
    const hangDaDung = provider || AI_PROVIDER;
    const chiPhi = tinhChiPhi(data.usage, undefined, hangDaDung);
    const tenGop = images.map((i) => i.name || "?").join(", ");
    ghiNhatKy({ luc: new Date().toISOString(), nguoi: req.nguoiDung?.ten || "?", loai: `${images.length} ảnh gộp (${hangDaDung})`, ten: tenGop, ...chiPhi });
    // Trả kèm danh sách tên ảnh theo ĐÚNG thứ tự đã đánh số, để frontend tra
    // source_image_index -> tên file thật, gán sourcePhoto chính xác từng dòng.
    const rawItems = parseRawJsonTuAI(data);
    const { items, pipelineTrace } = chayPipeline9Buoc(rawItems, images.length, images);
    res.json({
      items, pipelineTrace, cost: chiPhi,
      model: hangDaDung === "claude" ? ANTHROPIC_MODEL : hangDaDung, provider: hangDaDung,
      imageNames: images.map((i) => i.name || "?"),
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ============================================================================
// JOB — xử lý công trình LỚN (80-300 trang), vượt xa giới hạn 20 ảnh/lượt của
// endpoint đọc gộp thông thường. Vì tổng thời gian xử lý (vài phút tới chục
// phút) VƯỢT QUÁ giới hạn 1 HTTP request thông thường, thiết kế BẤT ĐỒNG BỘ:
//   POST /api/jobs/batch-analyze -> tạo job, chia thành các LÔ ≤20 ảnh, TRẢ VỀ
//     jobId NGAY LẬP TỨC (không đợi xử lý xong) -> xử lý NỀN tuần tự từng lô.
//   GET /api/jobs/:jobId/status -> client tự hỏi tiến độ (đã xong bao nhiêu lô).
//   GET /api/jobs/:jobId/result -> khi xong hết, trả kết quả đã GỘP + đối
//     chiếu TOÀN CỤC giữa các lô (không chỉ trong 1 lô như trước đây).
// Lưu file JSON theo từng lô ngay sau khi lô đó xong — nếu server bị gián
// đoạn giữa chừng (restart/crash), KHÔNG mất tiến độ đã xử lý, chỉ cần chạy
// tiếp từ lô dở dang (chưa làm resume tự động — nhưng dữ liệu KHÔNG MẤT, có
// thể xem lại qua /status để biết lô nào đã xong).
// ============================================================================
const KICH_THUOC_LO = 20;
function uidBackend(prefix) {
  const crypto = require("crypto");
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}
const DATA_DIR_JOBS = path.join(__dirname, "data", "jobs");
function fileJob(jobId) {
  const safe = String(jobId).replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(DATA_DIR_JOBS, `${safe}.json`);
}
function docJob(jobId) {
  try { return JSON.parse(fs.readFileSync(fileJob(jobId), "utf8")); } catch (e) { return null; }
}
function ghiJob(job) {
  if (!fs.existsSync(DATA_DIR_JOBS)) fs.mkdirSync(DATA_DIR_JOBS, { recursive: true });
  fs.writeFileSync(fileJob(job.jobId), JSON.stringify(job));
}

// Đối chiếu TOÀN CỤC sau khi mọi lô đã xong — phát hiện tên hạng mục TRÙNG
// HOÀN TOÀN xuất hiện ở NHIỀU LÔ KHÁC NHAU (dấu hiệu khả nghi — VD AI ở 2 lô
// riêng biệt vô tình tính trùng "Hoàn thiện sàn Tầng 5" cả 2 lần). CHỈ CẢNH
// BÁO, KHÔNG tự ý xoá dòng nào — người kiểm tra tự quyết định giữ/bỏ.
function doiChieuToanCuc(cacLo) {
  const demTheoTen = {};
  cacLo.forEach((lo, idx) => (lo.items || []).forEach((it) => {
    const ten = (it.name || "").trim().toLowerCase();
    if (!ten) return;
    if (!demTheoTen[ten]) demTheoTen[ten] = [];
    demTheoTen[ten].push(idx + 1);
  }));
  const canhBao = [];
  Object.entries(demTheoTen).forEach(([ten, cacLoXuatHien]) => {
    const loKhacNhau = new Set(cacLoXuatHien);
    if (loKhacNhau.size > 1) canhBao.push({ ten, xuatHienOLo: Array.from(loKhacNhau), soLan: cacLoXuatHien.length });
  });
  return canhBao;
}

async function xuLyJobNen(jobId) {
  const job = docJob(jobId);
  if (!job) return;
  const SO_LAN_THU_LO = 3; // 1 lần gốc + 2 lần thử lại — bổ sung tầng retry Ở CẤP LÔ, khác với retry đã có sẵn TRONG callUnifiedAI (retry đó chỉ ~6s tổng cộng, không đủ nếu mạng gián đoạn lâu hơn)
  for (let i = 0; i < job.cacLo.length; i++) {
    const lo = job.cacLo[i];
    if (lo.trangThai === "xong") continue; // đã xử lý (khi resume), bỏ qua
    lo.trangThai = "dang_chay";
    ghiJob(job);

    let thanhCong = false, loiLanCuoi = "";
    for (let lanThu = 1; lanThu <= SO_LAN_THU_LO; lanThu++) {
      try {
        const contentBlocks = [];
        lo.anh.forEach((img, k) => {
          contentBlocks.push({ type: "text", text: `--- Ảnh số ${k + 1} (tên file: "${img.name || "?"}") ---` });
          contentBlocks.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
        });
        contentBlocks.push({ type: "text", text: taoPrompt(job.ghiChuThem, job.danhSachChuan, job.tenCam, job.tenUuTien) });
        const data = await callUnifiedAI(contentBlocks, undefined, job.provider);
        const rawItems = parseRawJsonTuAI(data);
        const { items } = chayPipeline9Buoc(rawItems, lo.anh.length, lo.anh);
        lo.items = items;
        lo.trangThai = "xong";
        thanhCong = true;
        const chiPhi = tinhChiPhi(data.usage, undefined, job.provider || AI_PROVIDER);
        lo.chiPhi = chiPhi;
        ghiNhatKy({ luc: new Date().toISOString(), nguoi: job.nguoi, loai: `Job lô ${i + 1}/${job.cacLo.length}`, ten: job.jobId, ...chiPhi });
        break;
      } catch (e) {
        loiLanCuoi = e.message;
        if (lanThu < SO_LAN_THU_LO) await new Promise((r) => setTimeout(r, 5000 * lanThu)); // chờ 5s, 10s giữa các lần — dài hơn nhiều so với retry nội bộ trong callUnifiedAI, đủ vượt qua gián đoạn mạng dài hơn
      }
    }
    if (!thanhCong) {
      lo.trangThai = "loi";
      lo.loi = loiLanCuoi;
    }
    ghiJob(job); // lưu NGAY sau mỗi lô — không mất tiến độ nếu bị gián đoạn
  }
  job.trangThaiTong = job.cacLo.every((l) => l.trangThai === "xong") ? "xong" : "co_loi";
  ghiJob(job);
}

// GIỚI HẠN SỐ JOB CHẠY NỀN ĐỒNG THỜI — KHÁC với gioiHanDongThoi (đếm HTTP
// request đang xử lý, không áp dụng cho job vì job trả response NGAY rồi mới
// chạy nền dài hạn). Không giới hạn cái này, gọi tạo job nhiều lần liên tiếp
// sẽ khiến NHIỀU xuLyJobNen chạy song song, MỖI CÁI giữ tới 20 ảnh base64
// trong RAM cùng lúc khi đang xử lý lô — dễ làm tràn RAM trên gói Render nhỏ
// (512MB). Từ chối RÕ RÀNG (429) thay vì để quá tải âm thầm.
let soJobDangChayNen = 0;
const GIOI_HAN_JOB_DONG_THOI = 2;

app.post("/api/jobs/batch-analyze", batBuocDangNhap, async (req, res) => {
  try {
    if (soJobDangChayNen >= GIOI_HAN_JOB_DONG_THOI) {
      return res.status(429).json({ error: `Đang có ${soJobDangChayNen} job lớn chạy nền (tối đa ${GIOI_HAN_JOB_DONG_THOI} cùng lúc) — đợi job hiện tại xong rồi thử lại.` });
    }
    const { images, ghiChuThem, danhSachChuan, provider, tenCam, tenUuTien } = req.body || {};
    if (!Array.isArray(images) || !images.length) return res.status(400).json({ error: "Thiếu danh sách ảnh" });
    if (images.length > 400) return res.status(400).json({ error: "Tối đa 400 trang mỗi job (quá lớn ngay cả khi chia lô)." });
    const cacLo = [];
    for (let i = 0; i < images.length; i += KICH_THUOC_LO) {
      cacLo.push({ soLo: cacLo.length + 1, anh: images.slice(i, i + KICH_THUOC_LO).map((im) => ({ mediaType: im.mediaType, base64: im.base64, name: im.name })), trangThai: "cho", items: [], loi: null });
    }
    const jobId = uidBackend("job");
    const job = {
      jobId, taoLuc: new Date().toISOString(), nguoi: req.nguoiDung?.ten || "?",
      tongSoAnh: images.length, tongSoLo: cacLo.length, ghiChuThem, danhSachChuan, provider, tenCam, tenUuTien,
      cacLo, trangThaiTong: "dang_chay",
    };
    ghiJob(job);
    soJobDangChayNen++;
    xuLyJobNen(jobId)
      .catch((e) => console.error("[Job] lỗi xử lý nền:", jobId, e.message))
      .finally(() => { soJobDangChayNen = Math.max(0, soJobDangChayNen - 1); }); // luôn giảm lại dù thành công/lỗi
    res.json({ jobId, tongSoLo: cacLo.length, tongSoAnh: images.length, trangThai: "dang_chay" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/jobs/:jobId/status", batBuocDangNhap, (req, res) => {
  const job = docJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Không tìm thấy job (có thể đã hết hạn hoặc jobId sai)." });
  const soLoXong = job.cacLo.filter((l) => l.trangThai === "xong").length;
  const soLoLoi = job.cacLo.filter((l) => l.trangThai === "loi").length;
  res.json({
    jobId: job.jobId, trangThaiTong: job.trangThaiTong, tongSoLo: job.tongSoLo,
    soLoXong, soLoLoi, phanTramXong: Math.round(((soLoXong + soLoLoi) / job.tongSoLo) * 100),
    chiTietLo: job.cacLo.map((l) => ({ soLo: l.soLo, trangThai: l.trangThai, loi: l.loi })),
  });
});

app.get("/api/jobs/:jobId/result", batBuocDangNhap, (req, res) => {
  const job = docJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Không tìm thấy job." });
  if (job.trangThaiTong === "dang_chay") return res.status(202).json({ error: "Job chưa xử lý xong, thử lại sau.", trangThaiTong: job.trangThaiTong });
  const items = job.cacLo.flatMap((l) => l.items || []);
  const canhBaoTrungLap = doiChieuToanCuc(job.cacLo);
  const tongChiPhi = job.cacLo.reduce((s, l) => s + (l.chiPhi?.usd || 0), 0);
  res.json({
    jobId: job.jobId, trangThaiTong: job.trangThaiTong, tongSoLo: job.tongSoLo,
    items, canhBaoTrungLapGiuaCacLo: canhBaoTrungLap, tongChiPhiUsd: +tongChiPhi.toFixed(5),
    loCoLoi: job.cacLo.filter((l) => l.trangThai === "loi").map((l) => ({ soLo: l.soLo, loi: l.loi })),
  });
});

// ============================================================================
// POST /api/analyze-pdf   body: { base64, provider }
// ĐÃ THÊM xử lý "document" cho OpenAI/Gemini trong callUnifiedAI (26/08/2026) —
// dùng đúng chuẩn API thật của từng hãng đã tra cứu. Claude: đã test nhiều lần,
// chạy ổn định. OpenAI/Gemini: cấu trúc request ĐÚNG THEO TÀI LIỆU CHÍNH THỨC,
// NHƯNG CHƯA gọi mạng thật (không có key OpenAI để test) — dùng thử cẩn thận,
// báo lỗi ngay nếu gặp vấn đề để vá tiếp.
// ============================================================================
app.post("/api/analyze-pdf", aiLimiter, batBuocDangNhap, async (req, res) => {
  try {
    const { base64, ghiChuThem, danhSachChuan, provider, tenCam, tenUuTien } = req.body || {};
    if (!base64) return res.status(400).json({ error: "Thiếu base64" });
    const data = await callUnifiedAI(
      [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: taoPrompt(ghiChuThem, danhSachChuan, tenCam, tenUuTien) },
      ],
      "pdfs-2024-09-25",
      provider
    );
    const hangDaDung = provider || AI_PROVIDER;
    const chiPhi = tinhChiPhi(data.usage, undefined, hangDaDung);
    ghiNhatKy({ luc: new Date().toISOString(), nguoi: req.nguoiDung?.ten || "?", loai: `PDF (${hangDaDung})`, ten: req.body?.name || "", ...chiPhi });
    // SỬA LỖI: trước đây endpoint PDF dùng extractJsonArray đơn giản, KHÔNG đi
    // qua pipeline 9 bước như 2 endpoint ảnh — nghĩa là PDF không có
    // pipelineTrace, không tự tính lại qty tường bằng bước riêng biệt minh
    // bạch. Giờ đồng bộ cả 3 luồng đọc (ảnh đơn/gộp/PDF) qua cùng 1 pipeline.
    const rawItems = parseRawJsonTuAI(data);
    const { items, pipelineTrace } = chayPipeline9Buoc(rawItems, 1, [{ base64: "", name: req.body?.name || "document.pdf" }]);
    res.json({ items, pipelineTrace, cost: chiPhi, model: hangDaDung === "claude" ? ANTHROPIC_MODEL : hangDaDung, provider: hangDaDung });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ============================================================================
// LƯU TRỮ RIÊNG — thay cho window.storage / localStorage, lưu thật trên server
// theo từng người dùng. ƯU TIÊN nhận diện qua MÃ ĐĂNG NHẬP (x-access-code) khi
// công ty đã bật phân quyền (CO_PHAN_QUYEN) — vì mã này chú TỰ GÕ, ổn định qua
// mọi trình duyệt/thiết bị, không bị mất khi trình duyệt xoá bộ nhớ tạm. Chỉ khi
// CHƯA bật phân quyền mới rơi về "x-user-id" (mã ngẫu nhiên máy tự sinh, KÉM ổn
// định — dễ mất khi trình duyệt xoá localStorage, ví dụ khi bấm back/thoát app
// trên di động — đây từng là nguyên nhân gây mất dữ liệu khi tưởng đã lưu).
// ============================================================================
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Postgres tùy chọn — chỉ kích hoạt khi có DATABASE_URL + package pg
let pgStore = null;
try {
  if (process.env.DATABASE_URL) {
    pgStore = require("./storage-postgres");
  }
} catch (e) {
  console.warn("[Postgres] Không nạp được storage-postgres (thiếu pg?):", e.message);
  pgStore = null;
}

function userFile(userId) {
  const safe = String(userId || "anonymous").replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(DATA_DIR, `${safe || "anonymous"}.json`);
}

async function dinhDanhLuuTru(req) {
  if (CO_PHAN_QUYEN) {
    const ma = (req.header("x-access-code") || "").trim();
    // SỬA LỖI THẬT: trước đây chỉ tra ACCESS_CODES (biến môi trường tĩnh) —
    // nhân viên MỚI thêm qua Postgres (không có trong biến môi trường) sẽ bị
    // lưu dữ liệu LẪN vào "anonymous" thay vì theo đúng tên riêng của họ.
    const u = await layNguoiDung(req);
    if (u?.ten) return `acc_${u.ten}`;
    const ten = ACCESS_CODES[ma];
    if (ten) return `acc_${ten}`;
  }
  return req.header("x-user-id") || "anonymous"; // rơi về mã máy khi chưa bật phân quyền
}

app.get("/api/storage/:key", async (req, res) => {
  try {
    const userKey = await dinhDanhLuuTru(req);
    if (pgStore && process.env.DATABASE_URL) {
      const value = await pgStore.docStorage(userKey, req.params.key);
      return res.json({ value });
    }
    const file = userFile(userKey);
    if (!fs.existsSync(file)) return res.json({ value: null });
    const store = JSON.parse(fs.readFileSync(file, "utf8") || "{}");
    res.json({ value: store[req.params.key] ?? null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/storage/:key", async (req, res) => {
  try {
    const userKey = await dinhDanhLuuTru(req);
    if (pgStore && process.env.DATABASE_URL) {
      await pgStore.ghiStorage(userKey, req.params.key, req.body?.value ?? null);
      return res.json({ ok: true, backend: "postgres" });
    }
    const file = userFile(userKey);
    const store = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8") || "{}") : {};
    store[req.params.key] = req.body?.value ?? null;
    fs.writeFileSync(file, JSON.stringify(store));
    res.json({ ok: true, backend: "file" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// PHỤC VỤ CHÍNH ỨNG DỤNG — mở địa chỉ gốc của server là dùng được app ngay trên
// trình duyệt. App nằm ở file app.bundle.js (tải riêng), trang index.html chỉ là
// vỏ nhẹ. Server tự nén (gzip) khi gửi nên tải nhanh. Vì app và backend cùng một
// địa chỉ nên không bao giờ bị chặn gọi lẫn nhau.
// ============================================================================
// ============================================================================
// BACKUP / RESTORE — user tải toàn bộ data về máy hoặc khôi phục. Không đụng
// ảnh bản vẽ (ảnh không lưu server, chỉ ở trình duyệt). Chỉ JSON dự án/BOQ/
// định mức đã lưu qua /api/storage. Nên dùng định kỳ để phòng mất dữ liệu.
// ============================================================================
app.get("/api/backup", batBuocDangNhap, async (req, res) => {
  try {
    const id = await dinhDanhLuuTru(req);
    let store;
    if (pgStore && process.env.DATABASE_URL) {
      store = await pgStore.docToanBoStorage(id);
    } else {
      const file = userFile(id);
      store = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8") || "{}") : {};
    }
    const payload = { version: 1, exportedAt: new Date().toISOString(), user: req.nguoiDung?.ten || id, backend: pgStore && process.env.DATABASE_URL ? "postgres" : "file", store };
    res.setHeader("Content-Disposition", 'attachment; filename="qs-backup.json"');
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/backup/restore", batBuocDangNhap, async (req, res) => {
  try {
    const store = req.body?.store;
    if (!store || typeof store !== "object") return res.status(400).json({ error: "Thiếu store trong file backup (cần { store: {...} })." });
    const id = await dinhDanhLuuTru(req);
    if (pgStore && process.env.DATABASE_URL) {
      await pgStore.xoaToanBoStorage(id); // xoá sạch trước, tránh lẫn dữ liệu cũ không có trong file backup
      const soKey = await pgStore.ghiToanBoStorage(id, store);
      return res.json({ ok: true, keys: soKey, user: req.nguoiDung?.ten || id, backend: "postgres" });
    }
    const file = userFile(id);
    fs.writeFileSync(file, JSON.stringify(store)); // Ghi đè toàn bộ kho user — có chủ đích khi restore
    res.json({ ok: true, keys: Object.keys(store).length, user: req.nguoiDung?.ten || id, backend: "file" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/backup", batBuocDangNhap, async (req, res) => {
  try {
    const id = await dinhDanhLuuTru(req);
    if (pgStore && process.env.DATABASE_URL) {
      await pgStore.xoaToanBoStorage(id);
      return res.json({ ok: true, message: "Đã xóa toàn bộ dữ liệu Postgres của tài khoản này.", backend: "postgres" });
    }
    const file = userFile(id);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    res.json({ ok: true, message: "Đã xóa toàn bộ dữ liệu server của tài khoản này.", backend: "file" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => {
  const file = path.join(__dirname, "index.html");
  if (fs.existsSync(file)) return res.sendFile(file);
  res.status(404).send("Chưa có index.html — tải index.html + app.bundle.js lên GitHub cùng chỗ với server.js.");
});
app.get("/app.bundle.js", (req, res) => {
  const plain = path.join(__dirname, "app.bundle.js");
  const gz = path.join(__dirname, "app.bundle.js.gz");
  res.type("application/javascript");
  // Ưu tiên file thường (chạy được trên mọi trình duyệt, kể cả điện thoại)
  if (fs.existsSync(plain)) return res.sendFile(plain);
  if (fs.existsSync(gz)) {
    res.set("Content-Encoding", "gzip");
    return res.sendFile(gz);
  }
  res.status(404).send("// chưa có app.bundle.js");
});

// Web Worker đọc DXF — chạy tách biệt khỏi luồng giao diện chính để file lớn
// (hàng chục nghìn entity) không làm khựng màn hình. File này TỰ CHỨA
// dxf-parser (build riêng, không chung với app.bundle.js).
app.get("/dxf-worker.js", (req, res) => {
  const file = path.join(__dirname, "dxf-worker.js");
  res.type("application/javascript");
  if (fs.existsSync(file)) return res.sendFile(file);
  res.status(404).send("// chưa có dxf-worker.js");
});

// ============================================================================
// Health check — để dịch vụ hosting (Render/Railway...) biết server còn sống
// ============================================================================
app.get("/health", (req, res) =>
  res.json({
    status: "ok",
    hasApiKey: !!ANTHROPIC_API_KEY,
    model: ANTHROPIC_MODEL,
    auth: CO_PHAN_QUYEN,
    storage: process.env.DATABASE_URL && pgStore ? "postgres" : "file",
    vision: { enabled: !!ocrGoogleVision, withAnalyze: VISION_WITH_ANALYZE, hasKey: !!GOOGLE_VISION_API_KEY },
    goLive: { backup: true, multiImage: true, pdf: true, ocrVision: !!ocrGoogleVision },
  })
);

// ============================================================================
// AI PROVIDER ADAPTER (mục 23) — gọi được Gemini/OpenAI thay vì chỉ Claude.
// CHƯA TEST được bằng key thật (không có OPENAI_API_KEY/GEMINI_API_KEY thật để
// gọi thử) — cấu trúc contentBlocks đã kiểm chứng khớp đúng với cách server
// đang gửi cho Claude. Đã VÁ 1 lỗi crash tiềm ẩn: nếu Gemini trả về response
// không có "candidates" (VD lỗi/bị chặn nội dung), code gốc sẽ crash ngay tại
// data.candidates[0] — giờ có kiểm tra trước, báo lỗi rõ ràng thay vì crash.
// Mặc định AI_PROVIDER="claude" — không đổi hành vi hiện tại nếu không set.
// ============================================================================
const AI_PROVIDER = process.env.AI_PROVIDER || "claude";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function callUnifiedAI(contentBlocks, betaHeader, providerOverride) {
  const provider = providerOverride || AI_PROVIDER;

  if (provider === "openai" && OPENAI_API_KEY) {
    const messages = [{
      role: "user",
      content: contentBlocks.map((block) => {
        if (block.type === "text") return { type: "text", text: block.text };
        if (block.type === "image") return { type: "image_url", image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } };
        // PDF — chuẩn Chat Completions API thật (tra cứu 26/08/2026): type "file"
        // với file_data là DATA URL đầy đủ (không phải base64 trần). Đã kiểm tra tài
        // liệu chính thức + nhiều nguồn khớp nhau, NHƯNG CHƯA gọi mạng thật để xác
        // nhận (không có key OpenAI thật để test).
        if (block.type === "document") return { type: "file", file: { filename: "banve.pdf", file_data: `data:${block.source.media_type};base64,${block.source.data}` } };
        return { type: "text", text: "" };
      }),
    }];
    const resp = await fetchCoTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4o", messages, max_tokens: 16000 }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(`OpenAI Error HTTP ${resp.status}: ${data?.error?.message || "không rõ nguyên nhân"}`);
    // Vá: kiểm tra choices tồn tại trước khi đọc — tránh crash nếu OpenAI trả
    // response bất thường (VD bị content filter chặn, không có choices).
    if (!data.choices || !data.choices[0]) throw new Error("OpenAI trả về phản hồi không có nội dung (có thể bị chặn bởi bộ lọc nội dung)");
    return {
      content: [{ text: data.choices[0]?.message?.content || "" }],
      usage: { input_tokens: data.usage?.prompt_tokens || 0, output_tokens: data.usage?.completion_tokens || 0 },
    };
  }

  if (provider === "gemini" && GEMINI_API_KEY) {
    const contents = [{
      parts: contentBlocks.map((block) => {
        if (block.type === "text") return { text: block.text };
        if (block.type === "image") return { inline_data: { mime_type: block.source.media_type, data: block.source.data } };
        // PDF — Gemini dùng CHUNG cấu trúc inline_data như ảnh, chỉ khác mime_type
        // (đã kiểm chứng qua tài liệu chính thức Google, cùng 1 endpoint
        // generateContent). Giới hạn thật: request tổng không quá 20MB.
        if (block.type === "document") return { inline_data: { mime_type: block.source.media_type, data: block.source.data } };
        return { text: "" };
      }),
    }];
    const modelName = process.env.GEMINI_MODEL || "gemini-1.5-pro";
    const resp = await fetchCoTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(`Gemini Error HTTP ${resp.status}: ${data?.error?.message || "không rõ nguyên nhân"}`);
    // Vá lỗi crash tìm ra tuần trước: data.candidates có thể undefined nếu
    // Gemini chặn nội dung (safety filter) hoặc lỗi khác — kiểm tra trước khi
    // đọc data.candidates[0], không để crash ngay tại chỗ đọc index.
    if (!data.candidates || !data.candidates.length) {
      const lyDo = data?.promptFeedback?.blockReason || "không rõ nguyên nhân";
      throw new Error(`Gemini không trả về kết quả (candidates rỗng) — lý do: ${lyDo}`);
    }
    const textOut = data.candidates[0]?.content?.parts?.map((p) => p.text).join("") || "";
    return {
      content: [{ text: textOut }],
      usage: { input_tokens: data.usageMetadata?.promptTokenCount || 0, output_tokens: data.usageMetadata?.candidatesTokenCount || 0 },
    };
  }

  // Mặc định hoặc chưa cấu hình key hãng khác -> dùng Claude như hiện tại
  return await callClaude(contentBlocks, betaHeader);
}

// Dọn dẹp tệp Job cũ quá 24h để giải phóng dung lượng đĩa — file job (data/
// jobs/*.json) tích tụ theo thời gian nếu không dọn (mỗi lần đọc công trình
// lớn 80-300 trang tạo 1 file), có thể làm đầy đĩa Render sau nhiều tháng dùng.
function donDepJobCu() {
  const jobDir = path.join(__dirname, "data", "jobs");
  if (!fs.existsSync(jobDir)) return;
  const bayGio = Date.now();
  const THOI_GIAN_LUU_MS = 24 * 60 * 60 * 1000; // 24 giờ

  fs.readdir(jobDir, (err, files) => {
    if (err) return;
    files.forEach((file) => {
      const filePath = path.join(jobDir, file);
      fs.stat(filePath, (errStat, stats) => {
        if (errStat || bayGio - stats.mtimeMs <= THOI_GIAN_LUU_MS) return;
        // AN TOÀN THÊM: dù mtime đã cũ >24h, vẫn đọc lại trạng thái job trước
        // khi xoá — KHÔNG xoá nếu job đang "dang_chay" (dù cực hiếm xảy ra
        // thật, phòng hờ rẻ tiền cho race window giữa đọc mtime và xoá file).
        fs.readFile(filePath, "utf8", (errRead, content) => {
          if (!errRead) {
            try {
              const job = JSON.parse(content);
              if (job?.trangThaiTong === "dang_chay") return; // đang xử lý -> KHÔNG xoá dù mtime cũ
            } catch (e) { /* file hỏng/không parse được -> vẫn cho xoá bình thường */ }
          }
          fs.unlink(filePath, () => {});
        });
      });
    });
  });
}

const server = app.listen(PORT, async () => {
  console.log(`QsEstimate backend đang chạy ở cổng ${PORT}`);
  console.log(ANTHROPIC_API_KEY ? "✓ Đã có ANTHROPIC_API_KEY" : "✗ CHƯA có ANTHROPIC_API_KEY — điền vào file .env");
  if (pgStore && process.env.DATABASE_URL) {
    try {
      await pgStore.khoiTaoBang();
      console.log("✓ Postgres storage đã sẵn sàng");
    } catch (e) {
      console.error("✗ Postgres init lỗi — fallback file JSON:", e.message);
      pgStore = null;
    }
  } else {
    console.log("○ Storage: file JSON (đặt DATABASE_URL để bật Postgres)");
  }
  donDepJobCu(); // dọn ngay lúc khởi động (dọn tồn đọng từ trước khi restart)
});
setInterval(donDepJobCu, 6 * 60 * 60 * 1000); // rồi lặp lại mỗi 6 tiếng

// Đóng kết nối HTTP và Postgres AN TOÀN khi Render gửi tín hiệu tắt (redeploy/
// restart) — tránh cắt ngang request đang xử lý dở + đóng pool Postgres sạch
// sẽ thay vì để hệ điều hành tự ngắt đột ngột.
function dongServerAnToan(signal) {
  console.log(`[SYS] Nhận tín hiệu ${signal} — đang đóng kết nối...`);
  server.close(async () => {
    if (pgStore && pgStore.ketNoiDb()) {
      try { await pgStore.ketNoiDb().end(); } catch (e) { console.error("[SYS] Lỗi đóng Postgres:", e.message); }
    }
    console.log("[SYS] Đã đóng server và kết nối DB an toàn.");
    process.exit(0);
  });
}
process.on("SIGTERM", () => dongServerAnToan("SIGTERM"));

// LƯỚI AN TOÀN CUỐI CÙNG — chống crash toàn server nếu LỠ SÓT route/hàm nào
// chưa bọc try/catch (đã kiểm chứng THẬT: Express 4 KHÔNG tự động bắt lỗi bất
// đồng bộ — middleware app.use((err,req,res,next)=>...) KHÔNG được gọi tới
// cho lỗi throw trong route async, ĐÃ TEST XÁC NHẬN process crash hoàn toàn
// nếu không có 2 handler này). Đây là PHÒNG HỜ CUỐI, không thay thế việc bọc
// try/catch từng route (đã sửa 2 route thật sự thiếu: /api/whoami, /api/usage-log).
process.on("unhandledRejection", (err) => {
  console.error("[UNHANDLED REJECTION] Lỗi async không được bắt ở đâu đó — server vẫn sống nhờ lưới an toàn này:", err?.message || err);
});
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION] Lỗi đồng bộ không được bắt — server vẫn sống nhờ lưới an toàn này:", err?.message || err);
});
process.on("SIGINT", () => dongServerAnToan("SIGINT"));
