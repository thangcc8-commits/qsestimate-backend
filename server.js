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

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");

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

function extractJsonArray(data) {
  const text = (data.content || []).map((b) => b.text || "").join("");
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    throw new Error("AI không trả về JSON hợp lệ — thử lại hoặc dùng ảnh/file khác");
  }
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
app.post("/api/analyze-image", aiLimiter, async (req, res) => {
  try {
    const { base64, mediaType } = req.body || {};
    if (!base64 || !mediaType) return res.status(400).json({ error: "Thiếu base64 hoặc mediaType" });
    const data = await callClaude([
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: TAKEOFF_PROMPT },
    ]);
    res.json({ items: extractJsonArray(data) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ============================================================================
// POST /api/analyze-pdf   body: { base64 }
// ============================================================================
app.post("/api/analyze-pdf", aiLimiter, async (req, res) => {
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
    res.json({ items: extractJsonArray(data) });
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
// Health check — để dịch vụ hosting (Render/Railway...) biết server còn sống
// ============================================================================
app.get("/health", (req, res) => res.json({ status: "ok", hasApiKey: !!ANTHROPIC_API_KEY }));

app.listen(PORT, () => {
  console.log(`QsEstimate backend đang chạy ở cổng ${PORT}`);
  console.log(ANTHROPIC_API_KEY ? "✓ Đã có ANTHROPIC_API_KEY" : "✗ CHƯA có ANTHROPIC_API_KEY — điền vào file .env");
});
