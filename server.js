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
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*"; // đổi thành đúng domain app khi deploy thật, đừng để "*"

if (!ANTHROPIC_API_KEY) {
  console.error("[FATAL] Thiếu ANTHROPIC_API_KEY trong file .env — server sẽ không gọi được AI cho tới khi anh điền key vào.");
}

// CORS: cho phép app (chạy trong Claude.ai artifact hoặc web đã host) gọi tới.
// Để "*" nghĩa là nhận mọi nguồn — an toàn vì server này chỉ phục vụ app của mình,
// và API key được giữ kín phía server, không lộ ra ngoài dù nguồn gọi là gì.
app.use(cors({ origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN }));
app.options("*", cors({ origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN })); // trả lời yêu cầu "thăm dò" (preflight) của trình duyệt
app.use(express.json({ limit: "35mb" })); // đủ chỗ cho ảnh/PDF mã hoá base64 (~26MB file gốc)

// Giới hạn số lượt gọi AI / IP trong 15 phút — tránh bị lạm dụng gọi tràn lan tốn tiền
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: "Gọi AI quá nhiều lần trong 15 phút — thử lại sau." },
});

// ============================================================================
// GỌI CLAUDE API — dùng chung cho cả đọc ảnh và đọc PDF
// ============================================================================
async function callClaude(contentBlocks, betaHeader) {
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  };
  if (betaHeader) headers["anthropic-beta"] = betaHeader;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: contentBlocks }],
    }),
  });

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    const err = new Error(`Máy chủ Claude trả về dữ liệu không hợp lệ (HTTP ${resp.status})`);
    err.status = 502;
    throw err;
  }
  if (!resp.ok) {
    const err = new Error(data?.error?.message || `Lỗi HTTP ${resp.status} từ Claude API`);
    err.status = resp.status;
    throw err;
  }
  return data;
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
const ACCESS_CODES = {};
(process.env.ACCESS_CODES || "").split(",").forEach((cap) => {
  const [ten, ma] = cap.split("=").map((s) => (s || "").trim());
  if (ten && ma) ACCESS_CODES[ma] = ten;
});
const ADMIN_CODE = (process.env.ADMIN_CODE || "").trim();
const CO_PHAN_QUYEN = Object.keys(ACCESS_CODES).length > 0;

function layNguoiDung(req) {
  const ma = (req.header("x-access-code") || "").trim();
  if (!ma) return null;
  const ten = ACCESS_CODES[ma];
  if (!ten) return null;
  return { ten, quanTri: !!ADMIN_CODE && ma === ADMIN_CODE };
}

function batBuocDangNhap(req, res, next) {
  if (!CO_PHAN_QUYEN) { req.nguoiDung = { ten: "khách", quanTri: false }; return next(); }
  const u = layNguoiDung(req);
  if (!u) return res.status(401).json({ error: "Mã truy cập không đúng hoặc chưa nhập. Liên hệ quản trị để được cấp mã." });
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
}

// Ai đang đăng nhập — app gọi để kiểm tra mã có hợp lệ không
app.get("/api/whoami", (req, res) => {
  if (!CO_PHAN_QUYEN) return res.json({ ten: "khách", quanTri: false, coPhanQuyen: false });
  const u = layNguoiDung(req);
  if (!u) return res.status(401).json({ error: "Mã truy cập không đúng." });
  res.json({ ...u, coPhanQuyen: true });
});

// Nhật ký sử dụng — chỉ người quản trị xem được
app.get("/api/usage-log", (req, res) => {
  if (CO_PHAN_QUYEN) {
    const u = layNguoiDung(req);
    if (!u || !u.quanTri) return res.status(403).json({ error: "Chỉ người quản trị mới xem được nhật ký." });
  }
  const log = docNhatKy();
  const tong = {};
  log.forEach((b) => {
    if (!tong[b.nguoi]) tong[b.nguoi] = { soLan: 0, vnd: 0, usd: 0 };
    tong[b.nguoi].soLan++;
    tong[b.nguoi].vnd += b.vnd || 0;
    tong[b.nguoi].usd = +(tong[b.nguoi].usd + (b.usd || 0)).toFixed(5);
  });
  res.json({ log: log.slice(0, 200), tongTheoNguoi: tong, tongSoLan: log.length });
});

function extractJsonArray(data) {
  const text = (data.content || []).map((b) => b.text || "").join("");
  let clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  // Cách 1: thử parse trực tiếp (AI trả JSON thuần)
  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return parsed.items; // phòng khi AI trả {items:[...]}
  } catch (e) { /* rơi xuống cách 2 */ }
  // Cách 2: AI có viết thêm chữ quanh JSON — tìm đoạn từ dấu [ đầu tiên tới ] cuối cùng
  const start = clean.indexOf("[");
  const end = clean.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    const slice = clean.slice(start, end + 1);
    try {
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) { /* rơi xuống cách 3 */ }
  }
  // Cách 3: thực sự không có mảng nào -> trả rỗng (không ném lỗi, để app báo "không đọc được hạng mục")
  return [];
}

// Đơn giá token của model đang dùng (Claude Sonnet 4.6), USD cho mỗi 1 triệu token.
// Nguồn: trang giá chính thức của Anthropic — xem lại tại https://claude.com/pricing
// nếu Anthropic thay đổi giá thì sửa 2 số dưới đây cho khớp.
const GIA_INPUT_USD_PER_MTOK = 3;
const GIA_OUTPUT_USD_PER_MTOK = 15;

// Tính chi phí của 1 lần gọi AI, trả về cả token lẫn tiền (USD và VNĐ ước tính)
function tinhChiPhi(usage, tyGiaVND) {
  const inTok = usage?.input_tokens || 0;
  const outTok = usage?.output_tokens || 0;
  const usd = (inTok / 1e6) * GIA_INPUT_USD_PER_MTOK + (outTok / 1e6) * GIA_OUTPUT_USD_PER_MTOK;
  return {
    inputTokens: inTok,
    outputTokens: outTok,
    usd: +usd.toFixed(5),
    vnd: Math.round(usd * (tyGiaVND || 26000)),
  };
}

const TAKEOFF_PROMPT =
  'Đây là bản vẽ/bảng thống kê xây dựng, có thể nhiều trang. Đọc toàn bộ, tìm bảng khối lượng, ' +
  "bảng thống kê thép, bảng kích thước cấu kiện, hoặc ghi chú đủ để ước tính khối lượng thi công, " +
  "rồi trích xuất thành danh sách hạng mục. Nếu không đủ số liệu để bóc khối lượng, trả về mảng rỗng []. " +
  'Chỉ trả lời bằng JSON thuần, không giải thích, đúng định dạng: [{"name":"tên hạng mục ngắn gọn",' +
  '"unit":"đơn vị","qty":số,"note":"cơ sở/giả định khi đọc"}]';

// ============================================================================
// POST /api/analyze-image   body: { base64, mediaType }
// ============================================================================
app.post("/api/analyze-image", aiLimiter, batBuocDangNhap, async (req, res) => {
  try {
    const { base64, mediaType } = req.body || {};
    if (!base64 || !mediaType) return res.status(400).json({ error: "Thiếu base64 hoặc mediaType" });
    const data = await callClaude([
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: TAKEOFF_PROMPT },
    ]);
    const chiPhi = tinhChiPhi(data.usage);
    ghiNhatKy({ luc: new Date().toISOString(), nguoi: req.nguoiDung?.ten || "?", loai: "ảnh", ten: req.body?.name || "", ...chiPhi });
    res.json({ items: extractJsonArray(data), cost: chiPhi });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ============================================================================
// POST /api/analyze-pdf   body: { base64 }
// ============================================================================
app.post("/api/analyze-pdf", aiLimiter, batBuocDangNhap, async (req, res) => {
  try {
    const { base64 } = req.body || {};
    if (!base64) return res.status(400).json({ error: "Thiếu base64" });
    const data = await callClaude(
      [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: TAKEOFF_PROMPT },
      ],
      "pdfs-2024-09-25"
    );
    const chiPhi = tinhChiPhi(data.usage);
    ghiNhatKy({ luc: new Date().toISOString(), nguoi: req.nguoiDung?.ten || "?", loai: "PDF", ten: req.body?.name || "", ...chiPhi });
    res.json({ items: extractJsonArray(data), cost: chiPhi });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ============================================================================
// LƯU TRỮ RIÊNG — thay cho window.storage / localStorage, lưu thật trên server
// theo từng người dùng. Nhận diện người dùng qua header "x-user-id" — frontend
// tự sinh 1 mã ngẫu nhiên, lưu vào localStorage của trình duyệt, gửi kèm mỗi
// request. LƯU Ý: đây CHƯA phải hệ thống đăng nhập/xác thực thật — chỉ đủ để
// mỗi máy/mỗi trình duyệt có 1 kho dữ liệu riêng, không lẫn với người khác.
// Muốn dùng rộng rãi nhiều người an toàn hơn thì cần thêm đăng nhập thật
// (email/mật khẩu hoặc OAuth) và đổi từ file JSON sang database thật
// (Postgres/MySQL/SQLite) — phần này chỉ là bản đơn giản để chạy được ngay.
// ============================================================================
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function userFile(userId) {
  const safe = String(userId || "anonymous").replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(DATA_DIR, `${safe || "anonymous"}.json`);
}

app.get("/api/storage/:key", (req, res) => {
  try {
    const userId = req.header("x-user-id") || "anonymous";
    const file = userFile(userId);
    if (!fs.existsSync(file)) return res.json({ value: null });
    const store = JSON.parse(fs.readFileSync(file, "utf8") || "{}");
    res.json({ value: store[req.params.key] ?? null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/storage/:key", (req, res) => {
  try {
    const userId = req.header("x-user-id") || "anonymous";
    const file = userFile(userId);
    const store = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8") || "{}") : {};
    store[req.params.key] = req.body?.value ?? null;
    fs.writeFileSync(file, JSON.stringify(store));
    res.json({ ok: true });
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
app.get("/", (req, res) => {
  const file = path.join(__dirname, "index.html");
  if (fs.existsSync(file)) return res.sendFile(file);
  res.status(404).send("Chưa có index.html — tải index.html + app.bundle.js lên GitHub cùng chỗ với server.js.");
});
app.get("/app.bundle.js", (req, res) => {
  const gz = path.join(__dirname, "app.bundle.js.gz");
  const plain = path.join(__dirname, "app.bundle.js");
  res.type("application/javascript");
  // Ưu tiên file nén .gz (nhẹ, up qua điện thoại không treo); nếu không có thì dùng file thường
  if (fs.existsSync(gz)) {
    res.set("Content-Encoding", "gzip");
    return res.sendFile(gz);
  }
  if (fs.existsSync(plain)) return res.sendFile(plain);
  res.status(404).send("// chưa có app.bundle.js");
});

// ============================================================================
// Health check — để dịch vụ hosting (Render/Railway...) biết server còn sống
// ============================================================================
app.get("/health", (req, res) => res.json({ status: "ok", hasApiKey: !!ANTHROPIC_API_KEY }));

app.listen(PORT, () => {
  console.log(`QsEstimate backend đang chạy ở cổng ${PORT}`);
  console.log(ANTHROPIC_API_KEY ? "✓ Đã có ANTHROPIC_API_KEY" : "✗ CHƯA có ANTHROPIC_API_KEY — điền vào file .env");
});
