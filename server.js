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
app.use(express.json({ limit: "40mb" })); // dư địa an toàn — trần thật nằm ở phía Anthropic (32MB), không phải ở đây

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
      max_tokens: 16000,
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
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
  } catch (e) { /* rơi xuống cách 2 */ }
  // Cách 2: AI có viết thêm chữ quanh JSON — tìm đoạn từ dấu [ đầu tiên tới ] cuối cùng
  const start = clean.indexOf("[");
  if (start !== -1) {
    const end = clean.lastIndexOf("]");
    if (end > start) {
      try {
        const parsed = JSON.parse(clean.slice(start, end + 1));
        if (Array.isArray(parsed)) return parsed;
      } catch (e) { /* rơi xuống cách 3 */ }
    }
    // Cách 3: phản hồi bị CẮT CỤT giữa chừng (hết max_tokens, không có ] đóng) —
    // cứu lấy các object hoàn chỉnh cuối cùng thay vì mất trắng toàn bộ kết quả.
    const arrBody = clean.slice(start + 1); // phần sau dấu [
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

const TAKEOFF_PROMPT_GOC =
  'Đây là bản vẽ/bảng thống kê xây dựng, có thể nhiều trang/nhiều tầng — có thể là bảng khối lượng dạng cột số, ' +
  'HOẶC mặt bằng kiến trúc chỉ ghi trực tiếp diện tích/kích thước từng phòng (ví dụ chữ "23,90m2" viết ngay trong phòng, ' +
  'kích thước tường ghi trên trục kích thước, tên phòng như "WC", "Phòng số 1"...). CẢ HAI DẠNG ĐỀU LÀ SỐ LIỆU HỢP LỆ ĐỂ BÓC KHỐI LƯỢNG — ' +
  'không chỉ giới hạn ở bảng thống kê chính thức. Với mặt bằng kiến trúc: mỗi phòng có ghi diện tích là 1 hạng mục ' +
  '"Hoàn thiện sàn [tên phòng]" (đơn vị m2, qty = số diện tích ghi trên bản vẽ); nếu đọc được kích thước tường/chu vi phòng, ' +
  'tính thêm hạng mục xây tường (ghi rõ trong "note" là ước tính từ chu vi, giả định chiều cao tường 3.3m nếu không có số liệu); ' +
  'WC/phòng có ký hiệu riêng thì tính 1 hạng mục thiết bị vệ sinh theo số lượng phòng đó. ' +
  'Đọc toàn bộ trang, liệt kê TỪNG hạng mục nhìn thấy được, không gộp chung chung. ' +
  'CHỈ trả về mảng rỗng [] khi ảnh THỰC SỰ không có bất kỳ số đo/diện tích/kích thước nào đọc được (ảnh mờ, không phải bản vẽ, trang trống) — ' +
  'không trả rỗng chỉ vì thiếu bảng thống kê dạng cột số chính thức. ' +
  'Với mỗi hạng mục, xếp vào đúng 1 trong 4 nhóm sau (điền vào trường "group"): ' +
  '"mong" (móng, nền, đào đắp), "khung" (cột/dầm/sàn/cầu thang/kết cấu chịu lực), ' +
  '"hoanthien" (xây/trát/sơn/ốp lát/trần/cửa/lan can/hoàn thiện sàn), "mep" (điện/nước/điều hoà/thang máy/PCCC/thiết bị). ' +
  'TUYỆT ĐỐI CHỈ trả lời bằng JSON thuần — không viết bất kỳ chữ giải thích, lời dẫn, hay ghi chú nào trước hoặc sau JSON, ' +
  'không dùng markdown ```. Giữ tên hạng mục và ghi chú thật ngắn gọn để tiết kiệm độ dài phản hồi. ' +
  'Đúng định dạng: [{"name":"tên hạng mục ngắn gọn","unit":"đơn vị","qty":số,"group":"mong|khung|hoanthien|mep","note":"cơ sở/giả định khi đọc, ngắn gọn"}]';

// Tạo prompt cho 1 lượt đọc — nếu người dùng có ghi chú bổ sung (VD: "còn thiếu
// phần cầu thang, đọc kỹ thêm khu vực đó"), gắn thêm vào cuối để AI đọc lại có
// định hướng, không cần đọc lại từ đầu vô định.
function taoPrompt(ghiChuThem) {
  const gc = (ghiChuThem || "").trim();
  if (!gc) return TAKEOFF_PROMPT_GOC;
  return TAKEOFF_PROMPT_GOC + `\n\nYÊU CẦU BỔ SUNG TỪ NGƯỜI DÙNG (ưu tiên đọc kỹ theo yêu cầu này): ${gc}`;
}

// ============================================================================
// POST /api/analyze-image   body: { base64, mediaType }
// ============================================================================
app.post("/api/analyze-image", aiLimiter, batBuocDangNhap, async (req, res) => {
  try {
    const { base64, mediaType, ghiChuThem } = req.body || {};
    if (!base64 || !mediaType) return res.status(400).json({ error: "Thiếu base64 hoặc mediaType" });
    const data = await callClaude([
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: taoPrompt(ghiChuThem) },
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
    const { base64, ghiChuThem } = req.body || {};
    if (!base64) return res.status(400).json({ error: "Thiếu base64" });
    const data = await callClaude(
      [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: taoPrompt(ghiChuThem) },
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
// theo từng người dùng. ƯU TIÊN nhận diện qua MÃ ĐĂNG NHẬP (x-access-code) khi
// công ty đã bật phân quyền (CO_PHAN_QUYEN) — vì mã này chú TỰ GÕ, ổn định qua
// mọi trình duyệt/thiết bị, không bị mất khi trình duyệt xoá bộ nhớ tạm. Chỉ khi
// CHƯA bật phân quyền mới rơi về "x-user-id" (mã ngẫu nhiên máy tự sinh, KÉM ổn
// định — dễ mất khi trình duyệt xoá localStorage, ví dụ khi bấm back/thoát app
// trên di động — đây từng là nguyên nhân gây mất dữ liệu khi tưởng đã lưu).
// ============================================================================
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function userFile(userId) {
  const safe = String(userId || "anonymous").replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(DATA_DIR, `${safe || "anonymous"}.json`);
}

function dinhDanhLuuTru(req) {
  if (CO_PHAN_QUYEN) {
    const ma = (req.header("x-access-code") || "").trim();
    const ten = ACCESS_CODES[ma];
    if (ten) return `acc_${ten}`; // định danh ổn định theo mã đăng nhập thật
  }
  return req.header("x-user-id") || "anonymous"; // rơi về mã máy khi chưa bật phân quyền
}

app.get("/api/storage/:key", (req, res) => {
  try {
    const file = userFile(dinhDanhLuuTru(req));
    if (!fs.existsSync(file)) return res.json({ value: null });
    const store = JSON.parse(fs.readFileSync(file, "utf8") || "{}");
    res.json({ value: store[req.params.key] ?? null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/storage/:key", (req, res) => {
  try {
    const file = userFile(dinhDanhLuuTru(req));
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

// ============================================================================
// Health check — để dịch vụ hosting (Render/Railway...) biết server còn sống
// ============================================================================
app.get("/health", (req, res) => res.json({ status: "ok", hasApiKey: !!ANTHROPIC_API_KEY }));

app.listen(PORT, () => {
  console.log(`QsEstimate backend đang chạy ở cổng ${PORT}`);
  console.log(ANTHROPIC_API_KEY ? "✓ Đã có ANTHROPIC_API_KEY" : "✗ CHƯA có ANTHROPIC_API_KEY — điền vào file .env");
});
