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
// ============================================================================
// GỌI CLAUDE API — dùng chung cho cả đọc ảnh và đọc PDF. Có thử lại GIỚI HẠN
// (tối đa 2 lần, KHÔNG vô hạn) khi lỗi thật sự TẠM THỜI — mất mạng, quá tải máy
// chủ Anthropic (429/500/502/503/504). KHÔNG thử lại với lỗi CHẮC CHẮN sai (sai
// định dạng request, hết tiền, sai key, quá dung lượng...) — thử lại những lỗi
// đó chỉ tốn thêm tiền vô ích vì chắc chắn lại thất bại y hệt.
// ============================================================================
const MA_LOI_TAM_THOI = new Set([429, 500, 502, 503, 504]);
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
      resp = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body });
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
    if (Array.isArray(parsed)) return locHangMucHopLe(parsed);
    if (parsed && Array.isArray(parsed.items)) return locHangMucHopLe(parsed.items);
  } catch (e) { /* rơi xuống cách 2 */ }
  // Cách 2: AI có viết thêm chữ quanh JSON — tìm đoạn từ dấu [ đầu tiên tới ] cuối cùng
  const start = clean.indexOf("[");
  if (start !== -1) {
    const end = clean.lastIndexOf("]");
    if (end > start) {
      try {
        const parsed = JSON.parse(clean.slice(start, end + 1));
        if (Array.isArray(parsed)) return locHangMucHopLe(parsed);
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
        if (Array.isArray(parsed) && parsed.length) return locHangMucHopLe(parsed);
      } catch (e) { /* thật sự hỏng, rơi xuống trả rỗng */ }
    }
  }
  return [];
}

// VALIDATE toàn bộ hạng mục AI trả về TRƯỚC KHI gửi cho app ghi vào state (mục 2
// yêu cầu) — loại bỏ dòng rác: thiếu tên, khối lượng âm/NaN, đơn vị rỗng, group
// không hợp lệ. Không sửa/bịa giá trị — chỉ LOẠI những dòng rõ ràng hỏng, giữ
// nguyên các dòng hợp lệ. Đây là lưới an toàn cuối cùng trước khi dữ liệu vào app.
const NHOM_HOP_LE = new Set(["mong", "khung", "hoanthien", "mep"]);
function locHangMucHopLe(danhSach) {
  return danhSach.filter((item) => {
    if (!item || typeof item !== "object") return false;
    if (typeof item.name !== "string" || !item.name.trim()) return false;
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
  'BẮT BUỘC TỰ KIỂM CHỨNG (không cần dữ liệu công trình khác — chỉ đối chiếu NGAY TRONG bộ bản vẽ đang đọc): ' +
  'trường "note" của MỌI hạng mục PHẢI ghi rõ CÔNG THỨC TÍNH kèm số liệu cụ thể lấy từ đâu trên bản vẽ (VD "5m dài x 3m cao - 2m2 cửa = 13m2", ' +
  'hoặc "đọc trực tiếp số 23.90m2 ghi trong phòng"), KHÔNG được chỉ ghi 1 câu mô tả chung chung không có số. ' +
  'Nếu bản vẽ có ghi tổng diện tích sàn/công trình ở đâu đó (VD tiêu đề, bảng chỉ tiêu), SAU KHI liệt kê xong toàn bộ phòng, ' +
  'tự cộng lại tổng diện tích các phòng đã liệt kê và so với con số tổng đó — nếu lệch quá 10%, thêm 1 hạng mục cuối tên ' +
  '"CẢNH BÁO ĐỐI CHIẾU NỘI BỘ" (group "hoanthien", qty 0) ghi rõ trong note 2 con số lệch nhau bao nhiêu, để người kiểm tra biết cần xem lại. ' +
  'TUYỆT ĐỐI CHỈ trả lời bằng JSON thuần — không viết bất kỳ chữ giải thích, lời dẫn, hay ghi chú nào trước hoặc sau JSON, ' +
  'không dùng markdown ```. Tên hạng mục ngắn gọn, nhưng "note" phải đủ công thức+số liệu như yêu cầu trên (không cắt ngắn note). ' +
  'TRƯỚC KHI TRẢ LỜI — TỰ RÀ SOÁT LẠI TOÀN BỘ DANH SÁCH 1 LẦN: nếu có 2 hạng mục cùng tên (hoặc cùng ý nghĩa, chỉ khác cách gọi) ' +
  'xuất hiện ở nhiều trang khác nhau NHƯNG THỰC RA LÀ CÙNG 1 CẤU KIỆN (VD tường được nhìn thấy lặp lại ở mặt bằng và mặt cắt của CÙNG 1 vị trí) ' +
  '→ CHỈ giữ 1 dòng duy nhất, không liệt kê trùng. Ngược lại, nếu là các cấu kiện THỰC SỰ khác nhau dù trùng tên (VD "Xây tường Phòng 1" và ' +
  '"Xây tường Phòng 2" là 2 tường khác nhau dù cùng loại công tác) thì giữ nguyên riêng biệt, không gộp nhầm. ' +
  'Đúng định dạng: [{"name":"tên hạng mục ngắn gọn","unit":"đơn vị","qty":số,"group":"mong|khung|hoanthien|mep","note":"CÔNG THỨC + số liệu cụ thể"}]';

// Tạo prompt cho 1 lượt đọc.
// - ghiChuThem: người dùng gõ tay yêu cầu bổ sung (VD: "còn thiếu cầu thang").
// - danhSachChuan: danh sách TÊN đầu việc lấy từ mẫu dự toán đã lưu của ĐÚNG nhóm
//   công trình (nhà phố/shophouse/...) — khi có, AI được yêu cầu ưu tiên khớp số
//   liệu đọc được vào đúng các đầu việc này thay vì tự đặt tên mới tự do, để kết
//   quả bám sát cấu trúc dự toán chuẩn công ty đã lập sẵn (và nhờ vậy tự động có
//   đơn giá thật từ định mức đã khớp, không rơi vào định mức mới giá 0đ).
function taoPrompt(ghiChuThem, danhSachChuan) {
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
  const gc = (ghiChuThem || "").trim();
  if (gc) p += `\n\nYÊU CẦU BỔ SUNG TỪ NGƯỜI DÙNG (ưu tiên đọc kỹ theo yêu cầu này): ${gc}`;
  return p;
}

// ============================================================================
// POST /api/analyze-image   body: { base64, mediaType }
// ============================================================================
app.post("/api/analyze-image", aiLimiter, batBuocDangNhap, async (req, res) => {
  try {
    const { base64, mediaType, ghiChuThem, danhSachChuan, provider } = req.body || {};
    if (!base64 || !mediaType) return res.status(400).json({ error: "Thiếu base64 hoặc mediaType" });
    const data = await callUnifiedAI([
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: taoPrompt(ghiChuThem, danhSachChuan) },
    ], undefined, provider);
    const hangDaDung = provider || AI_PROVIDER;
    const chiPhi = tinhChiPhi(data.usage, undefined, hangDaDung);
    ghiNhatKy({ luc: new Date().toISOString(), nguoi: req.nguoiDung?.ten || "?", loai: "ảnh", ten: req.body?.name || "", ...chiPhi });
    res.json({ items: extractJsonArray(data), cost: chiPhi, model: hangDaDung === "claude" ? ANTHROPIC_MODEL : hangDaDung, provider: hangDaDung });
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
app.post("/api/analyze-images-batch", aiLimiter, batBuocDangNhap, async (req, res) => {
  try {
    const { images, ghiChuThem, danhSachChuan, provider } = req.body || {};
    if (!Array.isArray(images) || !images.length) return res.status(400).json({ error: "Thiếu danh sách ảnh" });
    if (images.length > 20) return res.status(400).json({ error: "Tối đa 20 ảnh mỗi lượt đọc gộp." });
    const contentBlocks = images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } }));
    const ghiChuGop = (ghiChuThem || "") +
      `\n\n(Lưu ý: đây là ${images.length} trang/ảnh THUỘC CÙNG 1 BỘ bản vẽ — đọc và đối chiếu chéo giữa các trang. ` +
      `PHÂN BIỆT RÕ 2 trường hợp: (1) CÙNG 1 cấu kiện nhìn thấy ở NHIỀU GÓC/NHIỀU LOẠI BẢN VẼ của CÙNG 1 tầng ` +
      `(VD tường xuất hiện cả ở mặt bằng lẫn mặt cắt của tầng 1) → chỉ tính 1 lần, KHÔNG trùng. (2) CÙNG LOẠI hạng mục ` +
      `lặp lại ở NHIỀU TẦNG KHÁC NHAU (VD "Hoàn thiện sàn" xuất hiện ở cả tầng 1, tầng 2, tầng 3...) → TUYỆT ĐỐI KHÔNG được ` +
      `cộng dồn thành 1 số duy nhất cho cả công trình — PHẢI tách thành TỪNG DÒNG RIÊNG cho MỖI TẦNG, ghi rõ số tầng ngay ` +
      `trong "name" (VD "Hoàn thiện sàn – Tầng 1", "Hoàn thiện sàn – Tầng 2"...), để kỹ sư QS đối chiếu được TỪNG DÒNG với ` +
      `ĐÚNG trang bản vẽ của tầng đó — không đưa 1 con số gộp mà không ai kiểm tra lại được đúng/sai từ đâu.)`;
    contentBlocks.push({ type: "text", text: taoPrompt(ghiChuGop, danhSachChuan) });
    // Cho phép đổi hãng AI NGAY TRONG 1 lần gọi (không cần đổi biến môi trường +
    // deploy lại) — để so sánh trực tiếp Claude vs Gemini trên CÙNG 1 bộ ảnh.
    const data = await callUnifiedAI(contentBlocks, undefined, provider);
    const hangDaDung = provider || AI_PROVIDER;
    const chiPhi = tinhChiPhi(data.usage, undefined, hangDaDung);
    const tenGop = images.map((i) => i.name || "?").join(", ");
    ghiNhatKy({ luc: new Date().toISOString(), nguoi: req.nguoiDung?.ten || "?", loai: `${images.length} ảnh gộp (${hangDaDung})`, ten: tenGop, ...chiPhi });
    res.json({ items: extractJsonArray(data), cost: chiPhi, model: hangDaDung === "claude" ? ANTHROPIC_MODEL : hangDaDung, provider: hangDaDung });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ============================================================================
// POST /api/analyze-pdf   body: { base64 }
// KHÔNG dùng callUnifiedAI ở đây — endpoint này dùng khối "document" (đặc thù
// của Claude, cần header beta riêng). Bộ chuyển đổi OpenAI/Gemini hiện chỉ xử
// lý được "text" và "image" — nếu đổi sang hãng khác, nội dung PDF sẽ ÂM THẦM
// BỊ RỚT MẤT (thành chữ rỗng) mà không báo lỗi gì. Giữ nguyên callClaude cho
// tới khi viết thêm phần chuyển đổi PDF riêng cho từng hãng.
// ============================================================================
app.post("/api/analyze-pdf", aiLimiter, batBuocDangNhap, async (req, res) => {
  try {
    const { base64, ghiChuThem, danhSachChuan } = req.body || {};
    if (!base64) return res.status(400).json({ error: "Thiếu base64" });
    const data = await callClaude(
      [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: taoPrompt(ghiChuThem, danhSachChuan) },
      ],
      "pdfs-2024-09-25"
    );
    const chiPhi = tinhChiPhi(data.usage, undefined, "claude");
    ghiNhatKy({ luc: new Date().toISOString(), nguoi: req.nguoiDung?.ten || "?", loai: "PDF", ten: req.body?.name || "", ...chiPhi });
    res.json({ items: extractJsonArray(data), cost: chiPhi, model: ANTHROPIC_MODEL });
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
app.get("/health", (req, res) => res.json({ status: "ok", hasApiKey: !!ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));

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
        return { type: "text", text: "" };
      }),
    }];
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
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
        return { text: "" };
      }),
    }];
    const modelName = process.env.GEMINI_MODEL || "gemini-1.5-pro";
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`, {
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

app.listen(PORT, () => {
  console.log(`QsEstimate backend đang chạy ở cổng ${PORT}`);
  console.log(ANTHROPIC_API_KEY ? "✓ Đã có ANTHROPIC_API_KEY" : "✗ CHƯA có ANTHROPIC_API_KEY — điền vào file .env");
});
