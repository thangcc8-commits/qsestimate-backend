import React, { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import {
  Building2, Layers, Wrench, DollarSign, ClipboardList, ShieldAlert,
  BarChart3, FileSpreadsheet, Plus, Trash2, AlertTriangle, CheckCircle2,
  Save, X, TrendingDown, TrendingUp, FolderPlus, Info, Camera,
  Image as ImageIcon, HelpCircle, FileText, Eye, Printer, Sparkles,
  Star, RotateCcw,
} from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
// dxf-parser KHÔNG còn import ở đây — việc đọc DXF đã chuyển hẳn sang Web
// Worker (public/dxf-worker.js) để không làm khựng giao diện với file lớn.
// XLSX/pdf-lib/fontkit CỐ TÌNH giữ qua CDN (window.XLSX/window.PDFLib/window.
// fontkit) — bundle trực tiếp sẽ +1.48MB (fontkit riêng đã 919KB, ~40% tổng
// tăng thêm), làm MỌI lượt mở app chậm hơn dù chỉ đọc bản vẽ, không xuất file
// gì. Rủi ro CDN chỉ ảnh hưởng ĐÚNG lúc bấm xuất Excel/PDF — hẹp hơn nhiều so
// với ảnh hưởng "mọi lần mở app" nếu bundle cả 3 thư viện nặng này vào.
const XLSX = (typeof window !== "undefined" && window.XLSX) ? window.XLSX : {};

// ============================================================================
// CẤU HÌNH BACKEND RIÊNG (điền vào khi đã thuê hosting cho server trung gian)
// ----------------------------------------------------------------------------
// Để trống "" = app dùng cơ chế tạm của Claude.ai (mượn quyền gọi AI trong
// khung xem trước — đang có lỗi "Invalid response format" ngoài tầm kiểm soát
// của code app). Khi đã deploy xong "server.js" (backend riêng), điền địa chỉ
// thật vào đây — VD: "https://qsestimate-backend.onrender.com" — app sẽ TỰ
// ĐỘNG chuyển sang gọi qua backend đó cho cả AI đọc bản vẽ lẫn lưu trữ dữ liệu,
// không cần sửa gì thêm ở chỗ khác.
// ============================================================================
const BACKEND_URL = "https://qsestimate-backend-1.onrender.com"; // <-- điền địa chỉ backend thật vào đây khi đã có hosting

// Mã định danh máy/trình duyệt — để backend phân biệt dữ liệu từng người dùng
// (chỉ dùng khi có BACKEND_URL; không ảnh hưởng gì khi đang chạy trên Claude.ai)
function getUserId() {
  try {
    let id = localStorage.getItem("qs_user_id");
    if (!id) {
      id = "u" + Math.random().toString(36).slice(2, 12);
      localStorage.setItem("qs_user_id", id);
    }
    return id;
  } catch (e) {
    return "u_anonymous";
  }
}

// ============================================================================
// STORAGE FALLBACK BRIDGE (Sửa lỗi crash window.storage trên trình duyệt)
// ----------------------------------------------------------------------------
// Có BACKEND_URL -> lưu thật trên server riêng (bền, xem được từ máy khác).
// Không có -> ưu tiên window.storage (Claude.ai cấp), rồi mới tới localStorage.
// ============================================================================
// SỬA LỖI THẬT (nguyên nhân gốc của "Lỗi lưu" — xác nhận qua thông báo lỗi
// thật hiện ra: "Can't find variable: authHeaders"): appStorage.set() nằm ở
// PHẠM VI MODULE (chạy khi file vừa tải, TRƯỚC CẢ KHI component chính tồn
// tại), nhưng lại gọi authHeaders() — 1 hàm CHỈ được định nghĩa BÊN TRONG
// component chính (qua useCallback, rất xa phía dưới) — nên không thể truy
// cập được, luôn crash ngay lập tức = LƯU LUÔN LUÔN THẤT BẠI 100% các lần,
// không phải thỉnh thoảng. Sửa: đọc thẳng "qs_access_code" từ localStorage
// (đúng nơi accessCode của component cũng đọc/ghi) — không cần phụ thuộc
// biến của component nữa, dùng được ở cả 2 nơi.
function layAuthHeaderModule() {
  try {
    const ma = localStorage.getItem("qs_access_code");
    return ma ? { "x-access-code": ma } : {};
  } catch (e) {
    return {};
  }
}

const appStorage = BACKEND_URL ? {
  get: async (key) => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/storage/${key}`, { headers: { "x-user-id": getUserId(), ...layAuthHeaderModule() } });
      const d = await r.json();
      return { value: d.value };
    } catch (e) {
      return { value: null };
    }
  },
  set: async (key, val) => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/storage/${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": getUserId(), ...layAuthHeaderModule() },
        body: JSON.stringify({ value: val }),
      });
      // SỬA LỖI THẬT (chẩn đoán từ triệu chứng thật: "Lỗi lưu" hiện đỏ nhưng
      // không rõ vì sao — server ĐÃ trả về error.message cụ thể trong thân JSON
      // khi lưu thất bại, nhưng trước đây chỉ đọc r.ok rồi vứt bỏ toàn bộ nội
      // dung phản hồi, không có cách nào biết lý do thật để tự sửa/báo đúng
      // chỗ). Giờ đọc và giữ lại thông báo lỗi thật, gắn vào window để hiển thị.
      if (!r.ok) {
        let lyDo = `HTTP ${r.status}`;
        try { const d = await r.json(); if (d?.error) lyDo = d.error; } catch (e) {}
        if (typeof window !== "undefined") window.__qsLastSaveError = lyDo;
      }
      return r.ok;
    } catch (e) {
      if (typeof window !== "undefined") window.__qsLastSaveError = e.message;
      return false;
    }
  },
} : (typeof window !== "undefined" && window.storage) ? window.storage : {
  get: async (key) => {
    try {
      const val = localStorage.getItem(key);
      return { value: val };
    } catch (e) {
      return { value: null };
    }
  },
  set: async (key, val) => {
    try {
      localStorage.setItem(key, val);
      return true;
    } catch (e) {
      return false;
    }
  }
};

// ============================================================================
// DESIGN TOKENS
// ============================================================================
const NAVY = "#1F3B57";
const NAVY_DARK = "#152A40";
const AMBER = "#D9822B";
const AMBER_DARK = "#B4691E";
const PAPER = "#F6F3EC";
const LINE = "#D8D2C4";
const INK = "#26313C";
const GREEN = "#2F7D57";
const RED = "#B23A2E";
const SLATE = "#5C6B7A";
const CHART_COLORS = [NAVY, AMBER, SLATE, "#8FA31E", RED];

const fmt = (n) => Math.round(n || 0).toLocaleString("vi-VN");
const fmtPct = (n) => `${((n || 0) * 100).toFixed(1)}%`;
const uid = (p) => p + Math.random().toString(36).slice(2, 9);

// SỬA LỖI THẬT (chẩn đoán từ triệu chứng "treo ở 90%, bấm lại vẫn treo" trên
// mạng di động): fetch() KHÔNG có timeout mặc định — nếu kết nối rớt âm thầm
// giữa chừng (mất sóng, proxy cắt lặng lẽ...), promise chờ VÔ THỜI HẠN, app
// không có cách nào biết để báo lỗi/thử lại. Hàm này bọc fetch bằng
// AbortController — quá thời gian quy định thì TỰ HUỶ, ném lỗi rõ ràng thay vì
// treo mãi. Dùng cho MỌI lệnh gọi tới backend riêng (đọc bản vẽ, poll job...).
async function fetchCoTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`Kết nối tới server quá ${Math.round(timeoutMs / 1000)}s không có phản hồi — có thể mạng chập chờn hoặc server đang quá tải. Thử lại.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// 5 NHÓM CÔNG TRÌNH (đúng mục 3.6 đặc tả)
// ============================================================================
const PROJECT_GROUPS = [
  { id: "nha-pho", name: "Xây dựng Nhà phố", note: "Làm từ móng đến mái — xây, tô, hoàn thiện trọn gói" },
  { id: "shophouse", name: "Hoàn thiện Shophouse", note: "Nhà đã có khung BTCT sẵn — xây tường bao ngoài, tô + sơn nước MẶT NGOÀI; CHƯA gồm tô trong và gắn cửa mặt ngoài" },
];

// Phân nhóm hạng mục công trình (WBS) cho BOQ — 1 dòng BOQ thuộc đúng 1 nhóm,
// giúp bảng dự toán trình bày theo cấu trúc công trình chuẩn thay vì danh sách
// phẳng. Đổi được cho từng dòng bất cứ lúc nào ở thẻ "Điều chỉnh dự toán/khối lượng".
const STANDARD_CATEGORIES = [
  { id: "cat-mong", name: "1. Công tác Phần Móng" },
  { id: "cat-khung", name: "2. Công tác Khung Kết Cấu" },
  { id: "cat-hoanthien", name: "3. Công tác Hoàn Thiện" },
  { id: "cat-mep", name: "4. Công tác Điện Nước (MEP)" },
];

// ============================================================================
// MASTER DATABASE — hạt giống ban đầu (mỗi nhóm vài định mức mẫu để minh hoạ
// cơ chế; anh bổ sung thêm qua mục "Dự toán mẫu" (trong thẻ "Dự án") theo
// Định mức 1091/Thông tư BXD hoặc định mức nội bộ công ty).
// ============================================================================
const SEED_MATERIALS = [
  { id: "mat001", code: "BT-M250-1X2", name: "Bê tông thương phẩm đá 1x2 mác 250", spec: "Mác 250, đá 1x2, độ sụt 12±2cm", unit: "m3", prices: { "nha-pho": 1650000 }, supplier: "Trạm trộn khu vực", coCq: false },
  { id: "mat002", code: "THEP-CDT-D10-25", name: "Thép thanh vằn D10-D25 CB300", spec: "CB300-V, TCVN 1651-2:2018", unit: "kg", prices: { "nha-pho": 19500 }, supplier: "Hoà Phát/Pomina", coCq: true },
  { id: "mat004", code: "GACH-XD-8X8X18", name: "Gạch xây đặc 8x8x18", spec: "Mác 75, TCVN 1450:2009", unit: "viên", prices: { "nha-pho": 1450 }, supplier: "Lò gạch địa phương", coCq: false },
  { id: "mat005", code: "SON-NUOC-NT", name: "Sơn nước nội thất phủ bóng mờ", spec: "Gốc Acrylic, phủ 2 lớp", unit: "lít", prices: { "shophouse": 185000 }, supplier: "Dulux/Jotun", coCq: false },
  { id: "mat006", code: "GACH-LAT-60X60", name: "Gạch lát nền Granite 60x60", spec: "Granite bóng kiếng, mài cạnh", unit: "m2", prices: { "shophouse": 285000 }, supplier: "Đồng Tâm/Viglacera", coCq: false },
];

const SEED_LABOR = [
  { id: "lb001", name: "Thợ bê tông bậc 3.5/7", region: "TP.HCM", prices: { "nha-pho": 320000 }, unit: "công" },
  { id: "lb002", name: "Thợ sắt bậc 3.5/7", region: "TP.HCM", prices: { "nha-pho": 340000 }, unit: "công" },
  { id: "lb003", name: "Thợ nề (xây, tô) bậc 3/7", region: "TP.HCM", prices: { "nha-pho": 300000 }, unit: "công" },
  { id: "lb004", name: "Thợ sơn bậc 3/7", region: "TP.HCM", prices: { "shophouse": 290000 }, unit: "công" },
  { id: "lbmay001", name: "Máy đầm bê tông", region: "-", prices: { "nha-pho": 450000 }, unit: "ca" },
];

const SEED_NORMS = [
  {
    id: "nm001", code: "AF.11110", name: "Bê tông cột, dầm, sàn đá 1x2 mác 250", unit: "m3",
    groups: ["nha-pho", "shophouse"], standard: "TCVN 4453:1995", scope: "master",
    vt: [{ materialId: "mat001", haoPhi: 1.015 }],
    nc: [{ laborId: "lb001", cong: 1.8 }],
    may: [{ laborId: "lbmay001", ca: 0.15 }],
  },
  {
    id: "nm002", code: "AF.61110", name: "Gia công lắp dựng cốt thép cột dầm sàn D10-D18", unit: "kg",
    groups: ["nha-pho", "shophouse"], standard: "TCVN 1651-2:2018", scope: "master",
    vt: [{ materialId: "mat002", haoPhi: 1.02 }],
    nc: [{ laborId: "lb002", cong: 0.012 }],
    may: [],
  },
  {
    id: "nm003", code: "AE.22110", name: "Xây tường gạch đặc dày 100mm, cao ≤4m", unit: "m2",
    groups: ["nha-pho", "shophouse"], standard: "TCVN 4085:2011", scope: "master",
    vt: [{ materialId: "mat004", haoPhi: 66 }],
    nc: [{ laborId: "lb003", cong: 0.35 }],
    may: [],
  },
  {
    id: "nm004", code: "AK.21100", name: "Sơn nước 2 lớp phủ nội thất (đã bả)", unit: "m2",
    groups: ["shophouse", "nha-pho"], standard: "TCVN 9404:2012", scope: "master",
    vt: [{ materialId: "mat005", haoPhi: 0.12 }],
    nc: [{ laborId: "lb004", cong: 0.06 }],
    may: [],
  },
  {
    id: "nm005", code: "AK.51100", name: "Lát nền gạch Granite 60x60", unit: "m2",
    groups: ["shophouse", "nha-pho"], standard: "TCVN 7132:2020", scope: "master",
    vt: [{ materialId: "mat006", haoPhi: 1.05 }],
    nc: [{ laborId: "lb003", cong: 0.28 }],
    may: [],
  },
  // 3 định mức nội bộ MỚI (KHÔNG phải mã TCVN — chú xác nhận không cần tra
  // đúng mã chuẩn quốc gia cho các mục này) — dùng đơn giá TRỌN GÓI thật lấy
  // từ dự toán mẫu Shophouse thật (BOQ_V1.1, đã duyệt CĐT) thay vì build-up
  // vật tư/nhân công chi tiết. "standard" ghi rõ là nội bộ, không giả TCVN.
  {
    id: "nm101", code: "PTC-TOTRAT", name: "Tô trát tường (vữa M75)", unit: "m2",
    groups: ["shophouse"], standard: "Nội bộ PT CONS — không phải mã TCVN", scope: "master",
    vt: [], nc: [], may: [],
  },
  {
    id: "nm102", code: "PTC-CHONGTHAM", name: "Chống thấm (màng gốc xi măng polymer 2 lớp)", unit: "m2",
    groups: ["shophouse"], standard: "Nội bộ PT CONS — không phải mã TCVN", scope: "master",
    vt: [], nc: [], may: [],
  },
  {
    id: "nm103", code: "PTC-CANNEN", name: "Cán nền vữa xi măng cát M75 dày 30-50mm", unit: "m2",
    groups: ["shophouse"], standard: "Nội bộ PT CONS — không phải mã TCVN", scope: "master",
    vt: [], nc: [], may: [],
  },
  // Định mức nội bộ MỚI cho Nhà phố — nguồn dự toán THẬT đã duyệt CĐT (Lô M6,
  // đường 36, An Khánh, Thủ Đức — GĐ Cai Văn Thắng ký 1/3/2024). KHÔNG phải
  // mã TCVN — chú xác nhận không cần tra đúng mã chuẩn quốc gia.
  { id: "nm201", code: "PTC-PHANTHOTRONGOI", name: "Phần thô trọn gói (móng+khung+xây bao+MEP âm tường+chống thấm)", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm202", code: "PTC-GACHLATNEN", name: "Gạch lát nền trong nhà 80x80", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm203", code: "PTC-GACHOPSANSAU", name: "Gạch ốp tường sân sau 30x60", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm204", code: "PTC-GACHOPWC", name: "Gạch ốp tường WC 30x60", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm205", code: "PTC-GACHNENWC", name: "Gạch nền WC 30x60", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm206", code: "PTC-LENCHANTUONG", name: "Len chân tường", unit: "md", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm207", code: "PTC-TRANTHACHCAO", name: "Trần thạch cao", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm208", code: "PTC-VIENCHITRAN", name: "Viền chỉ trần", unit: "md", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm209", code: "PTC-SONNUOCTRAN", name: "Sơn nước trần", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm210", code: "PTC-SONTUONGTRONG", name: "Sơn nước tường trong nhà", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  // Nhóm hạng mục CHỈ 1 LẦN cho cả công trình (sân trước/sau, mặt tiền, tam
  // cấp, cầu thang, bếp, cổng) — KHÔNG lặp lại mỗi tầng, dùng basis="manual".
  { id: "nm211", code: "PTC-GACHSANVIAHE", name: "Gạch sân vỉa hè ngoài cổng", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm212", code: "PTC-DAGRANITSAN", name: "Đá granite lát sân trước/sau 30x30x3cm", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm213", code: "PTC-DAOPSANTRUOC", name: "Đá ốp tường sân trước", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm214", code: "PTC-DAOPMATTIEN", name: "Đá ốp tường vách mặt tiền 10x20", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm215", code: "PTC-GACHHOAGIO", name: "Gạch hoa gió xây tường rào trang trí mặt tiền", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm216", code: "PTC-DATAMCAP", name: "Đá granite tam cấp trước cửa", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm217", code: "PTC-DAGACHCUA", name: "Đá granite gạch cửa", unit: "cai", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm218", code: "PTC-DACAUTHANG", name: "Đá granite cầu thang (bậc + len tường + chỉ mũi bậc)", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS — gộp 3 dòng gốc (bậc+chỉ+len)", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm219", code: "PTC-DABEP", name: "Đá granite bếp (mặt bếp + chỉ)", unit: "md", groups: ["nha-pho"], standard: "Nội bộ PT CONS — gộp 2 dòng gốc", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm220", code: "PTC-LANCANGO", name: "Lan can gỗ (trụ + tay vịn)", unit: "md", groups: ["nha-pho"], standard: "Nội bộ PT CONS — gộp 2 dòng gốc", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm221", code: "PTC-KHUNGSATSANSAU", name: "Khung sắt che khoảng sân sau", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm222", code: "PTC-CUASOW1", name: "Cửa sổ nhôm W1 (kèm khung sắt bảo vệ)", unit: "m2", groups: ["nha-pho"], standard: "Nội bộ PT CONS — gộp cửa+khung bảo vệ", scope: "master", vt: [], nc: [], may: [] },
  { id: "nm223", code: "PTC-CONGSAT", name: "Cổng sắt + khoá tay nắm", unit: "bo", groups: ["nha-pho"], standard: "Nội bộ PT CONS", scope: "master", vt: [], nc: [], may: [] },
];

// ============================================================================
// MẪU DỰ TOÁN MẶC ĐỊNH — có sẵn cho 2 loại công trình đang dùng, không cần tự
// tạo/upload từ đầu. Dùng basis "gfa" + ratio (không phải số cứng) để khối
// lượng TỰ CO GIÃN đúng theo diện tích thật của từng dự án (W×L×floors) —
// không bị sai khi dự án mới có kích thước khác dự án mẫu ban đầu.
//
// LƯU Ý QUAN TRỌNG: các tỷ lệ (ratio) dưới đây là ƯỚC LƯỢNG KINH NGHIỆM PHỔ
// BIẾN ngành xây dựng dân dụng — dùng làm ĐIỂM KHỞI ĐẦU hợp lý, KHÔNG phải số
// tuyệt đối chính xác cho mọi công trình. QS vẫn cần đối chiếu với bản vẽ thật
// và điều chỉnh lại khi cần. Cập nhật mẫu: thẻ Dự án → "Mẫu dự toán trọn bộ" →
// đặt ĐÚNG tên "Nhà phố mặc định" hoặc "Shophouse mặc định" rồi lưu đè lên.
// ============================================================================
// Dự toán mẫu THAM CHIẾU tích hợp sẵn theo từng nhóm công trình — dùng ĐÚNG
// nguồn dữ liệu thật đã dùng để xây SEED_TEMPLATES ở trên (Shophouse S6-38,
// Nhà phố Lô M6 Thủ Đức), viết theo đúng phong cách "Assumptions" đã kiểm
// chứng hiệu quả (có số liệu cụ thể + lý do suy luận, không chỉ liệt kê tên).
// Đây LÀ MẶC ĐỊNH — dùng ngay không cần ai nạp gì. Nếu dự án tự nạp "dự toán
// mẫu tuỳ chỉnh" riêng (activeProject.duToanMauThamChieu), bản tuỳ chỉnh đó
// THAY THẾ hoàn toàn bản mặc định này (xem layDuToanMauThamChieu()).
const SEED_DU_TOAN_MAU_MAC_DINH = {
  shophouse:
    "A1 | Bản vẽ gốc chỉ có MBKT (kiến trúc), KHÔNG có bản vẽ kết cấu, MEP, mặt cắt, bảng thống kê cửa. Toàn bộ khối lượng V1.1 được suy luận theo quy tắc QS chuẩn (định mức m²/m² sàn, % lỗ mở), KHÔNG phải bóc tách 100% từ hồ sơ thi công.\n" +
    "A2 | Diện tích sàn gộp (GFA) mỗi tầng điển hình = 6.000mm x 13.100mm = 78,6 m² (theo lưới trục A-D và 4-5).\n" +
    "A3 | Cao độ tầng: Tầng 1 (±0.000 → +3.900) = 3,9m. Do cao độ Tầng 3/4 không đọc rõ trên bản vẽ, suy luận đều module 3,3m cho Tầng 2→Áp mái: Tầng2=+3.900, Tầng3=+7.200, Tầng4=+10.500, Tầng5=+13.800, Áp mái=+17.100 (khớp 2 mốc rõ nhất +13.800 và +17.100). ĐỀ NGHỊ ĐỐI CHIẾU LẠI FILE CAD GỐC.\n" +
    "A4 | Tỷ lệ lỗ mở (cửa đi, cửa sổ) trừ vào tường xây: 30% cho tường ngoài (mặt tiền hướng biển, nhiều kính theo tiêu chuẩn resort 4 sao), 15% cho tường ngăn phòng.\n" +
    "A6 | Cơ cấu tường: 70% tường 100mm (ngăn phòng khô), 30% tường 200mm (bao che ngoài + khu ướt).\n" +
    "A8 | Chống thấm: sàn WC + chân tường lên 300mm, sàn mái BTCT, sân thượng/vườn Áp mái, sàn window seat/ban công. WC mỗi tầng ước ~4-5m²/WC theo tỷ lệ hình trên MBKT.\n" +
    "A10 | Tầng Áp mái: theo bản vẽ có khu vườn/sân trồng cây (không mái che) chiếm ~50% diện tích; phần còn lại (Kho quản gia, Phòng KT, WC, Heat pump) là khu kín 50%.\n" +
    "A12 | VAT áp dụng 8% theo chính sách giảm thuế hiện hành cho nhóm hàng hóa/dịch vụ xây dựng (cần xác nhận lại tại thời điểm ký hợp đồng).\n" +
    "A13 | Dự phòng phí: 5% cho khối lượng phát sinh + 3% trượt giá (do vận chuyển vật tư ra đảo Phú Quốc, biến động giá) = tổng 8% trên giá trị trước VAT.\n" +
    "A14 | Phân vùng gạch nền theo tầng: Tầng 1 = 40% diện tích sàn net là khu công cộng (Sảnh/Reception/Kho); Tầng 2-5 = 15% là hành lang/cầu thang; Áp mái = 50% là khu kỹ thuật (Kho quản gia/Phòng KT). Phần còn lại tính là gạch phòng.\n" +
    "A17 | Gạch ốp tường WC: hệ số quy đổi 3,2 m² ốp tường / 1 m² sàn WC (tương ứng phòng WC ~4-5m², ốp cao đến trần ~2,4-2,7m, trừ cửa/thiết bị).\n" +
    "A18 | Đơn giá gạch/sơn/trần tham khảo phân khúc vật liệu granite/porcelain nhập khẩu hoặc sản xuất trong nước cao cấp phù hợp khách sạn 4 sao, CHƯA VAT, đã gồm nhân công + vật tư phụ, CHƯA gồm vận chuyển đặc thù ra đảo (đã tính trong dự phòng trượt giá 3% tại Tổng hợp).\n" +
    "A20 | Định mức điểm điện/phòng khách (Lighting 14, Socket 12, Power 4 mạch, ELV 1 bộ, Internet 2, TV 1) tham khảo tiêu chuẩn phòng khách sạn 4 sao diện tích ~24m² có bếp nhỏ (pantry). CẦN đối chiếu lại khi có bản vẽ điện chi tiết.\n" +
    "A22 | Cáp trục đứng feeder (từ MSB lên các tủ tầng) ước lượng 120m dựa theo chiều cao công trình 17,1m và hệ số đi dây ngang+dự phòng ~x1,4. Cần xác định lại khi có sơ đồ nguyên lý điện.\n" +
    "A25 | Hệ số ống nhánh cấp nước 6m/điểm và thoát nước 5m/điểm là ước tính khoảng cách trung bình từ trục đứng đến thiết bị trong 1 phòng ~24m². Cần xác nhận khi có bản vẽ MEP.\n" +
    "A26 | Chiều cao công trình dùng cho ống trục đứng lấy bằng cao độ đỉnh Tầng 5 = 17,1m (tham chiếu Takeoff_Input); bố trí 2 trục cấp nước + 2 trục thoát nước/thông hơi phục vụ các khối WC chồng tầng.\n" +
    "A27 | Dung tích bể nước ngầm 5.000L + bồn mái 2.000L tính theo định mức 200L/người/ngày x ước lượng 25-30 khách lưu trú (5 phòng x tối đa 2 khách + dự phòng sinh hoạt). Cần tính toán lại theo công suất kinh doanh thực tế. [LƯU Ý: số '5 phòng' trong công thức này là số CŨ trước khi sửa — công trình thực tế có 10 phòng (xem A54), cần tính lại dung tích bể theo đúng 10 phòng nếu áp dụng cho công trình mới.]\n" +
    "A29 | SỬA LỖI: Diện tích phòng khách Tầng 2-5 lấy trực tiếp theo nhãn diện tích trên bản vẽ gốc = 23,90 m²/phòng (thay vì suy luận theo tỷ lệ hành lang trước đây cho kết quả sai lệch ~57m²/phòng). Diện tích Tầng 1 (35,39m²) và Áp mái vẫn dùng phương pháp tỷ lệ do không có nhãn rõ ràng.\n" +
    "A30 | Định mức tải lạnh 650 BTU/m² (phòng khách) và 500 BTU/m² (khu công cộng) theo tiêu chuẩn khí hậu nhiệt đới Phú Quốc, phòng cách nhiệt tốt (tường 200mm bao che, kính hạn chế bức xạ). Công suất máy chọn làm tròn lên bậc tiêu chuẩn gần nhất (9.000/12.000/18.000/24.000 BTU).\n" +
    "A31 | Khoảng cách trung bình dàn nóng-dàn lạnh 5m (ống đồng), bảo ôn bọc cả 2 đường ống cùng chiều dài, ống nước ngưng 6m/máy đấu về điểm thoát gần nhất. Các hệ số này cần điều chỉnh khi có bản vẽ bố trí dàn nóng thực tế (vị trí ban công/mặt ngoài).\n" +
    "A33 | Gói nội thất chuẩn hóa áp dụng đồng nhất cho cả 10 phòng khách [ĐÃ SỬA từ 5 phòng ban đầu - xem A54] (Giường, 2 tủ đầu giường, Wardrobe 4,8m², bàn+2 ghế, window seat, Pantry 3,5m²+1,2m² mặt đá+thiết bị âm tủ, TV Cabinet 1,6m²). Bản vẽ gốc có ghi chú riêng biệt một số nội thất đặc thù (BÀN XẾP TƯỜNG - Tầng 1, GIƯỜNG XẾP - Tầng 5, Sofa Bed - khu vực gần Tầng 4) CHƯA được bóc tách riêng do thiếu bản vẽ nội thất chi tiết (Interior Design Drawing/Shop Drawing).\n" +
    "A39 | Công trình cao 17,1m (5 tầng + Áp mái), thuộc nhóm nhà ở kết hợp thương mại dịch vụ quy mô nhỏ. Bóc khối lượng PCCC giả định công trình THUỘC diện phải trang bị hệ Sprinkler tự động + bơm chữa cháy dự phòng Diesel theo QCVN 06:2022/BXD.\n" +
    "A41 | Bán kính bảo vệ Sprinkler 12m²/đầu áp dụng cho khu vực nguy cơ cháy thấp (Light Hazard) theo tiêu chuẩn khách sạn; số lượng đầu phun là ước tính theo tổng GFA, chưa bố trí chi tiết theo mặt bằng trần từng phòng.\n" +
    "A43 | Thang máy phục vụ 6 điểm dừng (Tầng 1 → Áp mái), hành trình lấy theo cao độ đỉnh Tầng 5 = 17,1m (đồng bộ giả định chiều cao công trình tại A3/A26). Áp mái là khu BOH (Kho quản gia/Phòng KT) nên thang máy có dừng tại đây để phục vụ vận chuyển đồ dùng/bảo trì.\n" +
    "A44 | Đơn giá thang máy 650kg trọn bộ (680 triệu) là đơn giá gói cơ bản tham khảo dòng thang nội địa Việt Nam (lắp ráp trong nước, linh kiện nhập khẩu hoặc sản xuất nội địa) thương hiệu Phát Thành/Pacific, cho hành trình và số điểm dừng tiêu chuẩn; CHƯA VAT. Đơn giá thực tế phụ thuộc báo giá chính thức của NCC theo hồ sơ kỹ thuật cụ thể (kích thước hố thang, phòng máy nếu có, đặc điểm công trình đảo).\n" +
    "A45 | Chi phí vận chuyển thiết bị thang máy ra đảo Phú Quốc (45 triệu) là ước tính riêng biệt do đặc thù thiết bị cồng kềnh (đối trọng, ray dẫn hướng dài), cao hơn đáng kể so với hệ số dự phòng trượt giá chung 3% áp dụng cho các hạng mục khác - đã tách riêng thành dòng chi phí độc lập thay vì dựa vào dự phòng chung.\n" +
    "A48 | Diện tích đá ốp sảnh thang máy (4,5m² tường + 3,5m² sàn + 2,0m² khung bao cửa /tầng) là ước tính theo quy mô sảnh chờ nhỏ (công trình 78,6m²/tầng); không có bản vẽ nội thất sảnh thang máy chi tiết để bóc chính xác.\n" +
    "A49 | Số bậc cầu thang tính theo chiều cao tầng / 170mm (chiều cao bậc tiêu chuẩn TCVN), làm tròn lên; chiều rộng vế thang giả định 1,0m theo quan sát các số thứ tự bậc thang (1-19) thể hiện trên MBKT các tầng. Tay vịn lan can tính bằng chiều dài vế thang + 15% cho chiếu nghỉ/góc; tay vịn phụ gắn tường ước 50% chiều dài.\n" +
    "A50 | Hệ thống hút mùi bếp tính riêng biệt cho từng Pantry (không có bếp trung tâm); ống gió thải ngắn (2,5m/phòng) do giả định Pantry bố trí gần tường ngoài để thoát khí trực tiếp.\n" +
    "A54 | SỬA LỖI: Số phòng khách thực tế = 10 phòng (không phải 5 như các phiên bản trước): Tầng 1 = Phòng số 1 (1 phòng); Tầng 2 = Phòng số 2+3; Tầng 3 = Phòng số 4+5; Tầng 4 = Phòng số 6+7; Tầng 5 = Phòng số 8+9; Áp mái = Phòng số 10. Tổng 12 WC = 11 WC khách (Phòng 1 có 2 WC: WC1+WC1-1; các phòng còn lại 1 WC/phòng) + 1 WC nhân viên (WC11, khu Kho-quản gia/Phòng KT Áp mái).\n" +
    "A55 | Diện tích các phòng Tầng 2-5 lấy trực tiếp theo nhãn trên bản vẽ: 23,90m² (7 phòng: số 2,3,4,5,6,7,8) và 28,90m² (2 phòng: số 9,10 - phòng lớn hơn). Diện tích WC từng tầng ước theo tổng 2 WC/tầng dựa trên nhãn diện tích từng WC khi đọc được (WC2=4,95m², WC3=3,95m², WC4=4,5m², WC6=5,7m², WC7=3,95m², WC8=4,8m², WC9=3,4m², WC10=4,8m²); WC5 và WC11 không có nhãn diện tích rõ ràng trên bản vẽ - ước theo WC liền kề cùng tầng.\n" +
    "A56 | ĐIỀU CHỈNH CÔNG SUẤT MÁY LẠNH THỰC TẾ theo kinh nghiệm thi công của CĐT: công suất lý thuyết tính theo 650 BTU/m² cho phòng trống, nhưng khi lắp đầy nội thất (giường, tủ, sofa...) thể tích không khí cần làm lạnh giảm đáng kể so với phòng trống. Do đó BOQ áp dụng công suất THỰC TẾ thấp hơn 1 bậc so với lý thuyết: phòng 23,9m² dùng 12.000 BTU (1,5HP) thay vì 18.000 BTU (2HP); phòng 28,9m² và Phòng số 1 (35,4m²) dùng 18.000 BTU (2HP) thay vì 24.000 BTU (2,5HP). Cột 'Công suất lý thuyết' vẫn giữ lại tại Takeoft_HVAC để đối chiếu/kiểm toán. Đây là quyết định kỹ thuật dựa trên kinh nghiệm hiện trường, khác biệt so với tính toán lý thuyết thuần túy - đề nghị CĐT xác nhận trước khi thi công, đặc biệt với phòng có hướng nắng gắt hoặc cách nhiệt kém.\n" +
    "A58 | SỬA LỖI QUAN TRỌNG: Công trình là shophouse được CĐT/Sun Group bàn giao đã hoàn thiện kết cấu + hoàn thiện mặt NGOÀI của tường bao che (sơn/tô mặt ngoài, mặt tiền). Nhà thầu KHÔNG xây và KHÔNG tô mặt ngoài tường bao - chỉ thi công: (a) tô bổ sung mặt TRONG tường bao ngoài (1 mặt), và (b) xây + tô 2 mặt toàn bộ tường ngăn nội bộ. Khối lượng 'Xây tường' và 'Tô trát' tại BOQ_V1.1 đã được tách riêng theo đúng phạm vi công việc thực tế này (xem Revision R13). Diện tích tường ngoài (Ext_net, Takeoff_Input cột I) vẫn được giữ lại trong Takeoff_Input để tính SƠN NGOẠI THẤT tại BOQ_V1.2 - CẦN XÁC NHẬN LẠI với CĐT liệu sơn ngoại thất mặt ngoài có nằm trong phạm vi bàn giao hay không; nếu CĐT đã sơn ngoại thất luôn thì mục Sơn ngoại thất (FIN-SON-020, BOQ_V1.2) cũng cần loại bỏ tương tự.\n" +
    "A59 | SỬA ĐƠN GIÁ: Đơn giá sơn nước phiên bản trước (68.000đ/m² nội thất, 92.000đ/m² ngoại thất) chỉ phản ánh chi phí NHÂN CÔNG, chưa gồm vật tư sơn (bột bả 2 lớp, sơn lót, sơn phủ 2-3 lớp). Đã điều chỉnh lên đơn giá TRỌN GÓI (vật tư+nhân công) 145.000đ/m² (nội thất) và 175.000đ/m² (ngoại thất chống thấm kiềm/chịu mặn), tham khảo dòng sơn cao cấp Dulux/Jotun/Kova phù hợp khách sạn 4 sao. CẦN xin báo giá đại lý sơn chính thức kèm định mức phủ (m²/lít) để chốt đơn giá cuối trước khi phát hành mời thầu.\n" +
    "A60 | SỬA XÁC NHẬN: Trả lời câu hỏi treo tại A58 - mặt ngoài tường bao ĐÃ được Sun Group sơn hoàn thiện khi bàn giao (khoảng 5 năm trước), nay đã xuống cấp do khí hậu biển Phú Quốc (rêu mốc, bạc màu, nứt/bong tróc cục bộ) nên CẦN sơn sửa chữa lại - không phải sơn mới. Phạm vi: vệ sinh bề mặt (phun áp lực loại bỏ rêu mốc) + xử lý cục bộ vết nứt/bong tróc (không bả toàn bộ như sơn mới) + sơn lót lại tại vị trí xử lý + 2 lớp phủ ngoại thất mới. Đơn giá 110.000đ/m² thấp hơn sơn mới (175.000đ/m²) do không cần bả matit toàn bộ bề mặt, nhưng CẦN khảo sát thực tế hiện trạng mặt ngoài (mức độ xuống cấp thực tế) để xác nhận lại phạm vi và đơn giá trước khi thi công - nếu xuống cấp nặng (nứt kết cấu, bong tróc lan rộng) có thể cần bả sửa chữa toàn bộ, chi phí sẽ tăng.\n" +
    "A64 | Gương bàn trang điểm có đèn cảm biến TÁCH RIÊNG khỏi giá bàn trang điểm (FUR-BANGHE-010 giảm từ 4.200.000 xuống 3.600.000đ/bộ do không còn gồm gương cơ bản); gương WC (SAN-PHUKIEN-010) nâng cấp lên loại có cảm biến, giá tăng từ 1.450.000 lên 1.950.000đ/cái; bộ phụ kiện WC (SAN-PHUKIEN-020) làm rõ đủ 7 món, giá tăng từ 980.000 lên 1.450.000đ/bộ phản ánh đúng số lượng phụ kiện.\n" +
    "A65 | THAY ĐỔI THIẾT KẾ HVAC QUAN TRỌNG: Dàn nóng máy lạnh chuyển từ lắp đặt tại ban công/mặt ngoài từng phòng sang TẬP TRUNG trên MÁI công trình (giữ mỹ quan mặt tiền, tránh dàn nóng lộ trên các tầng). Ống đồng mỗi phòng tính theo cao độ thực tế từ sàn phòng đến cao độ mái (17,1m) cộng hệ số đi ngang trên mái 6m/máy - phòng Tầng 1 cần ~23m ống đồng, phòng Tầng 5 chỉ cần ~9m. Tổng ống đồng toàn công trình 168,2m (thay vì 55m theo hệ số cố định 5m/máy trước đây). Phương án này giả định TẤT CẢ dàn nóng đặt tại 1 khu vực trên mái.\n" +
    "A66 | Diện tích sơn tường trong (BOQ_V1.2 FIN-SON-020) nay trừ đi diện tích ốp gạch tường WC (M23×D29=165m²) vì khu vực đã ốp gạch không cần sơn - tránh trùng lặp chi phí hoàn thiện giữa 2 hạng mục Sơn và Gạch ốp WC.\n" +
    "A68 | RÀ SOÁT ĐƠN GIÁ PHẦN THÔ theo phản hồi thực tế CĐT: Xây tường 100mm tính theo cấu thành chi phí cụ thể (gạch+vữa+nhân công+lợi nhuận 10%) thay vì đơn giá thị trường tham khảo chung chung - phản ánh đúng hơn chi phí thực tế thi công tại Phú Quốc. Tường 200mm khu ẩm ướt được loại bỏ hoàn toàn do bản vẽ cập nhật không còn thể hiện hạng mục này (toàn bộ tường ngăn nội bộ dùng thống nhất 100mm).\n" +
    "A69 | Gói mua sắm khách sạn (OS&E - nệm/chăn/ga/gối/khăn) là ƯỚC TÍNH LUMP-SUM 8,5 triệu/phòng, CHƯA phải danh mục FF&E chi tiết. Cần bộ phận vận hành khách sạn (hoặc đơn vị F&B/Housekeeping) lập danh mục cụ thể theo tiêu chuẩn thương hiệu (số lượng bộ dự phòng, chất liệu, nhà cung cấp) trước khi mua sắm thực tế. Rèm cửa ước 4m/phòng (cửa sổ+cửa ban công).\n" +
    "A70 | SỬA HỆ SỐ TƯỜNG NGĂN: hệ số 0,45 m/m² sàn ban đầu (tham khảo tổng quát) cho khối lượng tường quá lớn so với mặt bằng thực tế (mỗi tầng chỉ có 1-2 phòng, số vách ngăn không nhiều). Đã điều chỉnh xuống 0,26 m/m² sàn - ước tính dựa trên bố trí thực tế: 1 tường ngăn 2 phòng/tầng + vách ngăn WC trong từng phòng + vách hành lang. CẦN đối chiếu lại với bản vẽ mặt bằng kết cấu/tường ngăn chi tiết (nếu có) để xác nhận chính xác hệ số này.",
  "nha-pho":
    "N1 | Công trình tham chiếu: Nhà phố Lô M6, đường 36, An Khánh, Thủ Đức — 4 tầng (Trệt+3 lầu), footprint 8,73m × 8,9m.\n" +
    "N2 | Method luận: PHẦN THÔ (móng+khung+xây bao+MEP âm tường+chống thấm) tính theo đơn giá TRỌN GÓI đồng nhất/m² sàn (không tách xây/tô riêng như Shophouse) — mức tham khảo ~4.900.000đ/m² GFA (theo công thức GFA=dài×rộng×số tầng, KHÔNG nhân hệ số quy đổi móng/mái). Đây là mức tham khảo tại thời điểm lập, CẦN cập nhật theo biến động giá vật tư/nhân công thực tế khi áp dụng.\n" +
    "N3 | Vật tư hoàn thiện (gạch/sơn/trần...) LẶP LẠI THEO TỪNG TẦNG nhưng CÓ THỂ khác nhau đáng kể giữa các tầng (VD gạch ốp WC tầng trệt và tầng lầu có thể chênh lệch nhiều lần do khác số lượng/kích thước WC mỗi tầng) — KHÔNG mặc định đồng đều mọi tầng, cần đọc riêng từng tầng nếu bản vẽ có đủ chi tiết.\n" +
    "N4 | Có 1 nhóm hạng mục CHỈ TÍNH 1 LẦN CHO CẢ CÔNG TRÌNH (không lặp theo tầng): sân trước/sau, mặt tiền, tam cấp, cầu thang, bếp, cổng — đây là các cấu kiện đơn nhất của công trình, không scale theo số tầng/diện tích.\n" +
    "N5 | Nhà phố riêng lẻ (không phải khách sạn/công trình công cộng) THƯỜNG KHÔNG cần PCCC hệ thống lớn hay thang máy — chỉ tính nếu bản vẽ thể hiện rõ.",
};

const SEED_TEMPLATES = {
  "Nhà phố mặc định": {
    groupId: "nha-pho",
    dims: { W: 8.73, L: 8.9, floors: 4, rooms: 6, wc: 4 }, // đúng công trình mẫu thật: Nhà phố Lô M6, đường 36, An Khánh, Thủ Đức
    pcts: { quanLyPct: 0.08, khacPct: 0.01, loiNhuanPct: 0.12, vatPct: 0.08, khoanThreshold: -0.05 },
    // NGUỒN: dự toán mẫu Nhà phố THẬT đã duyệt CĐT (Lô M6, đường 36, An Khánh,
    // Thủ Đức — GĐ Cai Văn Thắng ký 1/3/2024). Khác Shophouse: đây dùng đơn giá
    // TRỌN GÓI đồng nhất/m² cho phần thô (không tách xây/tô riêng). "Phần thô
    // trọn gói" dùng basis=gfa với ratio ĐÃ QUY ĐỔI theo công thức GFA=W×L×floors
    // của app (không phải m² thực có hệ số) — TỰ CO GIÃN đúng khi W/L/floors dự
    // án mới khác. Vật tư hoàn thiện dùng basis=floor (lặp lại mỗi tầng, dữ liệu
    // lấy từ Tầng trệt — LƯU Ý: 1 số mục (VD gạch ốp WC) khác biệt đáng kể giữa
    // các tầng thật (Trệt 20.28m² vs Lầu 1 73.76m²) — app không hỗ trợ ratio
    // khác nhau theo từng tầng cụ thể, số ở đây là mức Tầng trệt, QS CẦN kiểm
    // tra lại nếu áp dụng nguyên trạng. Mục chỉ-1-lần-cho-cả-công-trình (sân
    // trước/sau, mặt tiền, tam cấp, cầu thang, bếp, cổng) dùng basis=manual,
    // giữ nguyên số lượng thật — KHÔNG tự scale, QS cần điều chỉnh cho dự án
    // khác kích thước.
    items: [
      { normId: "nm201", basis: "gfa", ratio: 1.4409, qty: 0, category: "cat-khung", khoanPrice: 4900000 }, // Phần thô trọn gói — 447.81m² (có hệ số) / 310.79m² GFA công thức
      // --- Lặp lại mỗi tầng (basis=floor, dữ liệu Tầng trệt) ---
      { normId: "nm202", basis: "floor", ratio: 97.755, qty: 0, category: "cat-hoanthien", khoanPrice: 420000 }, // Gạch lát nền trong nhà 80x80
      { normId: "nm203", basis: "floor", ratio: 56.7, qty: 0, category: "cat-hoanthien", khoanPrice: 320000 }, // Gạch ốp tường sân sau
      { normId: "nm204", basis: "floor", ratio: 20.284, qty: 0, category: "cat-hoanthien", khoanPrice: 320000 }, // Gạch ốp tường WC (mức Tầng trệt — Lầu 1 thực tế cao hơn nhiều, xem ghi chú)
      { normId: "nm205", basis: "floor", ratio: 3.366, qty: 0, category: "cat-hoanthien", khoanPrice: 320000 }, // Gạch nền WC
      { normId: "nm206", basis: "floor", ratio: 45, qty: 0, category: "cat-hoanthien", khoanPrice: 55000 }, // Len chân tường
      { normId: "nm207", basis: "floor", ratio: 90, qty: 0, category: "cat-hoanthien", khoanPrice: 145000 }, // Trần thạch cao (hệ số riêng đã gồm trong đơn giá)
      { normId: "nm208", basis: "floor", ratio: 70, qty: 0, category: "cat-hoanthien", khoanPrice: 55000 }, // Viền chỉ trần
      { normId: "nm209", basis: "floor", ratio: 112.5, qty: 0, category: "cat-hoanthien", khoanPrice: 45000 }, // Sơn nước trần
      { normId: "nm210", basis: "floor", ratio: 372, qty: 0, category: "cat-hoanthien", khoanPrice: 65000 }, // Sơn nước tường trong nhà
      // --- Chỉ 1 lần cho cả công trình (basis=manual, KHÔNG tự scale) ---
      { normId: "nm211", basis: "manual", ratio: 0, qty: 35, category: "cat-hoanthien", khoanPrice: 250000 }, // Gạch sân vỉa hè ngoài cổng
      { normId: "nm212", basis: "manual", ratio: 0, qty: 68.28, category: "cat-hoanthien", khoanPrice: 420000 }, // Đá granite lát sân trước/sau
      { normId: "nm213", basis: "manual", ratio: 0, qty: 44.1, category: "cat-hoanthien", khoanPrice: 380000 }, // Đá ốp tường sân trước
      { normId: "nm214", basis: "manual", ratio: 0, qty: 26.25, category: "cat-hoanthien", khoanPrice: 380000 }, // Đá ốp tường vách mặt tiền
      { normId: "nm215", basis: "manual", ratio: 0, qty: 10, category: "cat-hoanthien", khoanPrice: 550000 }, // Gạch hoa gió xây tường rào
      { normId: "nm216", basis: "manual", ratio: 0, qty: 10.39, category: "cat-hoanthien", khoanPrice: 1480000 }, // Đá granite tam cấp trước cửa
      { normId: "nm217", basis: "manual", ratio: 0, qty: 2, category: "cat-hoanthien", khoanPrice: 350000 }, // Đá granite gạch cửa
      { normId: "nm218", basis: "manual", ratio: 0, qty: 14.7, category: "cat-hoanthien", khoanPrice: 1250000 }, // Đá granite cầu thang (giá bậc chính, chỉ+len tính gộp tham khảo)
      { normId: "nm219", basis: "manual", ratio: 0, qty: 4, category: "cat-hoanthien", khoanPrice: 1250000 }, // Đá granite bếp
      { normId: "nm220", basis: "manual", ratio: 0, qty: 9.1, category: "cat-hoanthien", khoanPrice: 2700000 }, // Lan can gỗ (tay vịn, trụ tính gộp tham khảo)
      { normId: "nm221", basis: "manual", ratio: 0, qty: 22.5, category: "cat-hoanthien", khoanPrice: 700000 }, // Khung sắt che khoảng sân sau
      { normId: "nm222", basis: "manual", ratio: 0, qty: 2.88, category: "cat-hoanthien", khoanPrice: 2100000 }, // Cửa sổ nhôm W1
      { normId: "nm223", basis: "manual", ratio: 0, qty: 1, category: "cat-hoanthien", khoanPrice: 11000000 }, // Cổng sắt + khoá tay nắm
    ],
  },
  "Shophouse mặc định": {
    groupId: "shophouse",
    dims: { W: 6, L: 13.1, floors: 6, rooms: 10, wc: 12 }, // đúng công trình mẫu thật: Shophouse S6-38 Phú Quốc, 5 tầng + Áp mái
    pcts: { quanLyPct: 0.08, khacPct: 0.01, loiNhuanPct: 0.12, vatPct: 0.08, khoanThreshold: -0.05 },
    // NGUỒN: dự toán mẫu Shophouse THẬT đã duyệt CĐT (BOQ_V1.1 "Phần thô",
    // GDĐ Cai Văn Thắng ký 19/07/2026) — GFA công trình gốc = 471.6m² (6 tầng
    // x 78.6m²). Tỷ lệ (ratio) = khối lượng thật ÷ GFA gốc, TỰ CO GIÃN đúng
    // theo diện tích của dự án mới. LƯU Ý QUAN TRỌNG (Revision R13 của file
    // gốc): công trình mẫu này là shophouse ĐÃ ĐƯỢC BÀN GIAO hoàn thiện phần
    // thô + hoàn thiện MẶT NGOÀI tường bao (Sun Group bàn giao) — nên "xây
    // tường"/"tô trát" ở đây CHỈ tính tường ngăn NỘI BỘ + tô bổ sung mặt
    // TRONG tường bao, KHÔNG bao gồm xây/tô tường bao ngoài. Nếu dự án mới
    // KHÔNG ở tình huống bàn giao tương tự (cần xây cả tường bao ngoài), QS
    // PHẢI điều chỉnh lại — đây không phải công thức phổ quát cho mọi
    // shophouse, chỉ đúng cho đúng tình huống "nhận bàn giao vỏ bao che".
    items: [
      { normId: "nm003", basis: "gfa", ratio: 0.6343, qty: 0, category: "cat-hoanthien", khoanPrice: 345000 }, // Xây tường ngăn nội bộ 100mm — 299.12m²/471.6m² GFA, 345.000đ/m²
      { normId: "nm101", basis: "gfa", ratio: 1.38, qty: 0, category: "cat-hoanthien", khoanPrice: 165000 }, // Tô mặt trong tường bao ngoài — 650.82m²/471.6m² GFA, 165.000đ/m²
      { normId: "nm101", basis: "gfa", ratio: 1.2685, qty: 0, category: "cat-hoanthien", khoanPrice: 165000 }, // Tô tường ngăn nội bộ (2 mặt) — 598.24m²/471.6m² GFA, 165.000đ/m²
      { normId: "nm102", basis: "gfa", ratio: 0.1421, qty: 0, category: "cat-hoanthien", khoanPrice: 255000 }, // Chống thấm sàn WC + chân tường — 67.02m²/471.6m² GFA, 255.000đ/m²
      { normId: "nm102", basis: "gfa", ratio: 0.0509, qty: 0, category: "cat-hoanthien", khoanPrice: 255000 }, // Chống thấm ban công/window seat — 24m²/471.6m² GFA, 255.000đ/m²
      { normId: "nm103", basis: "gfa", ratio: 0.8406, qty: 0, category: "cat-hoanthien", khoanPrice: 145000 }, // Cán nền — 396.41m²/471.6m² GFA, 145.000đ/m²
    ],
  },
};

const TABS = [
  { id: "projects", label: "Dự án", icon: Building2 },
  { id: "vendors", label: "Nhà thầu", icon: Star },
  { id: "drawings", label: "Đọc bản vẽ", icon: Camera },
  { id: "exportHub", label: "Xuất file", icon: FileSpreadsheet },
  { id: "adjust", label: "Điều chỉnh dự toán/khối lượng", icon: Layers },
  { id: "dashboard", label: "Hiệu quả giá vốn", icon: BarChart3 },
];

// ============================================================================
// PURE CALC ENGINE (đã kiểm thử độc lập bằng Node trước khi đưa vào component
// — xem log kiểm thử trong phần giải thích gửi kèm)
// ============================================================================
// ---- ưu tiên 1: giá đúng theo nhóm công trình đang dùng; ưu tiên 2: mượn giá
// từ nhóm công trình khác nếu nhóm hiện tại chưa có (đã kiểm thử) ----
// ============================================================================
// 4 HÀM PORT TỪ THƯ VIỆN "BOQ AutoEngine" (do người khác viết, chú gửi kiểm tra
// ngày 23/08/2026) — CHỈ lấy các hàm THUẦN TUÝ, đã kiểm chứng đúng bằng số liệu
// thật, không phụ thuộc gì bên ngoài. Không import cả file 164 hàm (tránh phình
// app + rủi ro không kiểm soát được code không rõ nguồn) — chỉ copy đúng 4 hàm
// cốt lõi cần dùng, giữ nguyên logic gốc.
// ----------------------------------------------------------------------------
// Diện tích tường tổng (chưa trừ cửa/cửa sổ)
function wallGrossArea(length, height) {
  return Math.max(0, length) * Math.max(0, height);
}
// Trừ tổng diện tích các lỗ mở (cửa, cửa sổ...) khỏi diện tích gộp
function subtractAreas(gross, openings) {
  const totalOpen = openings.reduce((s, v) => s + Math.max(0, v), 0);
  return Math.max(0, gross - totalOpen);
}
// Diện tích tường THỰC (đã trừ cửa/cửa sổ) — openings: [{width,height,count}]
function wallNetArea(length, height, openings) {
  const gross = wallGrossArea(length, height);
  const openingAreas = (openings || []).map((o) => (Number(o.width) || 0) * (Number(o.height) || 0) * (Number(o.count) || 1));
  return subtractAreas(gross, openingAreas);
}
// Đối chiếu khối lượng AI đọc được với khối lượng tính bằng công thức xác định
// (từ kích thước chú nhập tay) — sai số > 2% thì cảnh báo, > 10% thì cảnh báo NẶNG.
const SAI_SO_CHO_PHEP = 0.02;
function doiChieuAiVaCongThuc(soLuongAI, soLuongCongThuc) {
  if (soLuongCongThuc === 0 && soLuongAI === 0) return null;
  const saiSoTuyetDoi = Math.abs(soLuongAI - soLuongCongThuc);
  const saiSoTuongDoi = soLuongCongThuc !== 0 ? saiSoTuyetDoi / Math.abs(soLuongCongThuc) : (saiSoTuyetDoi > 0 ? 1 : 0);
  if (saiSoTuongDoi <= SAI_SO_CHO_PHEP) return null;
  return {
    mucDo: saiSoTuongDoi > 0.1 ? "cao" : "vua",
    saiSoTuongDoi,
    thongBao: `AI đọc ${soLuongAI} nhưng tính theo kích thước ra ${soLuongCongThuc.toFixed(2)} — lệch ${(saiSoTuongDoi * 100).toFixed(1)}%`,
  };
}

function resolvePrice(item, groupId, vendorId, vendorPrices) {
  if (!item) return { price: 0, source: null, borrowed: false, vendor: false };
  // Nếu đang chọn 1 nhà thầu (khác "internal") và nhà thầu đó đã báo giá cho đúng
  // vật tư/nhân công này, ưu tiên dùng giá đó thay vì bảng giá nội bộ theo nhóm.
  if (vendorId && vendorId !== "internal" && vendorPrices && vendorPrices[vendorId] && vendorPrices[vendorId][item.id] != null) {
    return { price: vendorPrices[vendorId][item.id], source: null, borrowed: false, vendor: true };
  }
  if (!item.prices) return { price: 0, source: null, borrowed: false, vendor: false };
  if (item.prices[groupId] > 0) return { price: item.prices[groupId], source: groupId, borrowed: false, vendor: false };
  // Chưa có giá riêng cho nhóm này — mượn tạm từ nhóm khác. Lấy giá CAO NHẤT trong
  // các nhóm đã có (không phải nhóm đầu tiên tình cờ gặp) — nguyên tắc an toàn QS:
  // thà báo giá hơi cao còn hơn báo thấp hơn thực tế khi chưa chắc chắn.
  const cacNhomCoGia = Object.keys(item.prices).filter((g) => item.prices[g] > 0);
  if (cacNhomCoGia.length) {
    const otherGid = cacNhomCoGia.reduce((max, g) => (item.prices[g] > item.prices[max] ? g : max), cacNhomCoGia[0]);
    return { price: item.prices[otherGid], source: otherGid, borrowed: true, vendor: false };
  }
  return { price: 0, source: null, borrowed: false, vendor: false };
}

function computeAnalyzedPrice(norm, materialsById, laborById, groupId, vendorId, vendorPrices) {
  let vlCost = 0, ncCost = 0, mayCost = 0;
  const vlDetail = [], ncDetail = [], mayDetail = [];
  let anyBorrowed = false;
  (norm.vt || []).forEach((row) => {
    const mat = materialsById[row.materialId];
    const r = resolvePrice(mat, groupId, vendorId, vendorPrices);
    if (r.borrowed) anyBorrowed = true;
    const wastagePct = mat?.wastagePct || 0; // hao hụt vật tư khi thi công (VD: gạch vỡ, thép cắt dư)
    const haoPhiThucTe = row.haoPhi * (1 + wastagePct / 100);
    const cost = haoPhiThucTe * r.price;
    vlCost += cost;
    vlDetail.push({ name: mat ? mat.name : "(vật tư đã xoá)", haoPhi: row.haoPhi, wastagePct, haoPhiThucTe, price: r.price, cost, borrowed: r.borrowed, source: r.source, vendor: r.vendor });
  });
  (norm.nc || []).forEach((row) => {
    const lb = laborById[row.laborId];
    const r = resolvePrice(lb, groupId, vendorId, vendorPrices);
    if (r.borrowed) anyBorrowed = true;
    const cost = row.cong * r.price;
    ncCost += cost;
    ncDetail.push({ name: lb ? lb.name : "(nhân công đã xoá)", cong: row.cong, price: r.price, cost, borrowed: r.borrowed, source: r.source, vendor: r.vendor });
  });
  (norm.may || []).forEach((row) => {
    const lb = laborById[row.laborId];
    const r = resolvePrice(lb, groupId, vendorId, vendorPrices);
    if (r.borrowed) anyBorrowed = true;
    const cost = row.ca * r.price;
    mayCost += cost;
    mayDetail.push({ name: lb ? lb.name : "(máy đã xoá)", ca: row.ca, price: r.price, cost, borrowed: r.borrowed, source: r.source, vendor: r.vendor });
  });
  return { vlCost, ncCost, mayCost, total: vlCost + ncCost + mayCost, vlDetail, ncDetail, mayDetail, anyBorrowed };
}

function computeBoqLine(boqItem, norm, materialsById, laborById, groupId, vendorId, vendorPrices) {
  if (!norm) return null;
  const analyzed = computeAnalyzedPrice(norm, materialsById, laborById, groupId, vendorId, vendorPrices);
  const thanhTienPhanTich = boqItem.qty * analyzed.total;
  const donGiaKhoan = boqItem.khoanPrice != null && boqItem.khoanPrice !== "" ? Number(boqItem.khoanPrice) : analyzed.total;
  const thanhTienKhoan = boqItem.qty * donGiaKhoan;
  const chenhLechPct = analyzed.total > 0 ? (donGiaKhoan - analyzed.total) / analyzed.total : 0;
  // Trạng thái đơn giản kiểu "exception review" — không cần hạ tầng phức tạp:
  // REVIEW = định mức được tự tạo lúc duyệt hàng loạt (mã bắt đầu "AI", chưa có giá
  // thật) HOẶC giá cuối = 0đ — cần QS xem lại trước khi tin. CONFIRMED = có giá
  // thật, không phải placeholder tự tạo. Giúp chú chỉ cần soi các dòng REVIEW,
  // không phải đọc lại toàn bộ BOQ mỗi lần.
  const laDinhMucTuTao = /^AI/i.test(norm.code || "");
  // Trạng thái chi tiết hơn (mục 12 — Exception Dashboard nhiều loại):
  // PRICE_MISSING = giá cuối 0đ (thiếu giá, nhưng định mức/tên đã đúng)
  // QC_MISSING = định mức tự tạo lúc duyệt hàng loạt (mã bắt đầu "AI") — cả tên
  //   lẫn giá đều chưa qua kiểm tra kỹ thuật (QC), rủi ro cao hơn PRICE_MISSING
  // CONFIRMED = có giá thật, không phải placeholder tự tạo
  let trangThai;
  if (laDinhMucTuTao) trangThai = "QC_MISSING";
  else if (donGiaKhoan <= 0) trangThai = "PRICE_MISSING";
  else trangThai = "CONFIRMED";
  return { analyzed, thanhTienPhanTich, donGiaKhoan, thanhTienKhoan, chenhLechPct, trangThai, coGiaMuon: analyzed.anyBorrowed };
}

// ---- so khớp tên hạng mục AI đọc từ bản vẽ với tên định mức có sẵn (đã kiểm thử) ----
// Danh sách CẶP TỪ ĐỐI NGHỊCH thường gặp trong xây dựng — nếu 2 tên có chứa
// từ thuộc 2 phe ĐỐI LẬP nhau, ÉP similarity = 0 dù các từ khác trùng nhiều
// (VD "Xây tường 200" và "Đục tường 200" trùng 2/3 từ nhưng là 2 CÔNG TÁC ĐỐI
// NGHỊCH — xây dựng vs phá dỡ — TUYỆT ĐỐI không được tự động khớp định mức).
// Test THẬT xác nhận: không có bước chặn này, "Lắp cửa đi" vs "Tháo cửa đi"
// đạt điểm 0.75 — vượt xa ngưỡng 0.3 dùng để TỰ ĐỘNG gán định mức + đánh dấu
// "confirmed" (không cần người dùng xem lại) trong luồng duyệt hàng loạt.
const CAC_CAP_TU_DOI_NGHICH = [
  ["xây", "đục"], ["xây", "phá"], ["xây", "tháo"], ["xây", "dỡ"], ["xây", "tô"],
  ["lắp", "tháo"], ["lắp", "dỡ"], ["lắp đặt", "tháo dỡ"],
  ["trong", "ngoài"], ["trên", "dưới"], ["trước", "sau"],
  ["tô", "đục"], ["sơn", "tẩy"], ["đổ", "phá"], ["xây dựng", "phá dỡ"],
];
function coTuDoiNghich(a, b) {
  const la = String(a).toLowerCase(), lb = String(b).toLowerCase();
  return CAC_CAP_TU_DOI_NGHICH.some(([x, y]) => (la.includes(x) && lb.includes(y)) || (la.includes(y) && lb.includes(x)));
}

function similarity(a, b) {
  if (coTuDoiNghich(a, b)) return 0; // chặn cứng TRƯỚC — không cho các công tác đối nghịch khớp nhau dù trùng từ khác nhiều
  const cleanWords = (s) => String(s).toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1);
  const wa = new Set(cleanWords(a));
  const wb = new Set(cleanWords(b));
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  wa.forEach((w) => { if (wb.has(w)) common++; });
  return common / Math.max(wa.size, wb.size);
}

// Chuẩn hoá đơn vị để so sánh an toàn (m2/M2/m²/M² đều cùng 1 đơn vị).
function chuanHoaDonVi(u) {
  return String(u || "").toLowerCase().trim().replace(/²/g, "2").replace(/³/g, "3").replace(/\s+/g, "");
}

// Chuẩn hoá TÊN để so khớp CHÍNH XÁC (không phải so mờ) — chỉ gộp khoảng
// trắng thừa + hoa/thường, KHÔNG bỏ dấu/ký tự vì đây là so khớp tuyệt đối,
// không phải Jaccard — sai lệch dù nhỏ vẫn phải rơi về khớp mờ, không tự nhận.
function chuanHoaTen(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// SỬA LỖI THẬT (phát hiện qua review độc lập): "Dự toán mẫu" (estimate_templates,
// sửa qua TemplateEditorPanel) và "Định mức gốc" (projectNorms, có đơn giá) là 2
// danh sách được duy trì HOÀN TOÀN ĐỘC LẬP — admin gõ tên mẫu tự do, không có gì
// đảm bảo trùng khớp chữ với tên trong định mức gốc. AI được yêu cầu dùng tên
// NGUYÊN VĂN theo mẫu -> tên đó có thể không khớp mờ đủ điểm với định mức gốc ->
// mất đơn giá dù QS đã lập mẫu rất kỹ. Sửa: khi lưu mẫu, mỗi dòng CÓ THỂ gắn sẵn
// 1 normId (chọn từ định mức gốc, xem TemplateEditorPanel) -> nếu AI trả về đúng
// tên đó (nguyên văn, chỉ khác khoảng trắng/hoa-thường), dùng THẲNG normId đã gắn
// sẵn, KHÔNG qua khớp mờ nữa -> tin cậy tuyệt đối, không thể trật vì đây là liên
// kết do chính QS xác nhận trước, không phải suy đoán của thuật toán.
function khopTheoLienKetMau(tenAI, tenToNormId) {
  if (!tenToNormId) return "";
  const key = chuanHoaTen(tenAI);
  if (!key) return "";
  return tenToNormId[key] || "";
}

// Khớp định mức ĐA TIÊU CHÍ — thay thế cách CHỈ so tên (Jaccard đơn thuần) đã
// dùng trước đây ở 5 chỗ khác nhau trong file. Xét: (1) tên công tác — Jaccard,
// vẫn là tín hiệu chính; (2) đơn vị tính — KHÁC HẲN (m2 vs m3) là dấu hiệu MẠNH
// rằng đây SAI định mức dù tên nghe giống, phạt điểm nặng; (3) nhóm công trình
// (group AI báo cáo, nếu có) — cộng điểm nhẹ nếu norm cùng nhóm; (4) KHOẢNG
// CÁCH giữa ứng viên #1 và #2 — nếu 2 ứng viên gần điểm nhau, đây là dấu hiệu
// KHÔNG CHẮC CHẮN dù ứng viên #1 vượt ngưỡng, phải đưa về Review thay vì tự
// gán, tránh đúng lỗi "AI đọc tên gần giống rồi gán nhầm định mức" đã biết.
// KHÔNG dùng "mã hiệu" làm tiêu chí — mã hiệu AI đọc từ bản vẽ (VD "D01") và
// mã định mức TCVN (VD "AF.11110") là 2 không gian mã hoàn toàn khác nhau,
// không có cách so sánh trực tiếp hợp lý; đưa "mã hiệu" vào đây sẽ là số liệu
// giả tạo trông có vẻ khoa học nhưng không thực sự đo được gì.
function timDinhMucPhuHopDaTieuChi(tenAI, unitAI, projectGroupId, projectNorms) {
  const donViAI = chuanHoaDonVi(unitAI);
  const ungVien = (projectNorms || [])
    .map((n) => {
      const diemTen = similarity(tenAI || "", n.name); // 0..1, tín hiệu CHÍNH — luôn là gốc để nhân hệ số, không cộng/trừ tuyệt đối
      const donViNorm = chuanHoaDonVi(n.unit);
      let heSoDonVi = 1;
      if (donViAI && donViNorm) {
        // SỬA LỖI THẬT (phát hiện qua test): dùng NHÂN hệ số thay vì cộng/trừ
        // tuyệt đối — nếu trừ tuyệt đối, 1 norm KHÔNG LIÊN QUAN GÌ VỀ TÊN
        // nhưng tình cờ trùng đơn vị có thể thắng norm ĐÚNG TÊN nhưng sai đơn
        // vị (vì điểm tên bị trừ âm gần hết). Nhân hệ số giữ tên luôn là yếu
        // tố quyết định chính — sai đơn vị chỉ hạ điểm xuống mức không tự xác
        // nhận được, không đảo ngược thứ hạng so với ứng viên không liên quan.
        heSoDonVi = donViAI === donViNorm ? 1.1 : 0.25;
      }
      let diem = diemTen * heSoDonVi;
      // SỬA LỖI THẬT (phát hiện qua review độc lập ở chat khác): trước đây so
      // sánh n.groups (LOẠI công trình: "nha-pho"/"shophouse") với groupAI
      // (GIAI ĐOẠN thi công AI báo cáo: "mong"/"khung"/"hoanthien"/"mep") — 2
      // tập giá trị KHÔNG BAO GIỜ giao nhau, điều kiện luôn false, code chết
      // hoàn toàn. Sửa đúng: so với projectGroupId (loại công trình CỦA DỰ ÁN
      // đang xử lý, VD "shophouse") — đúng cùng không gian giá trị với n.groups.
      if (projectGroupId && n.groups && n.groups.includes(projectGroupId)) diem += 0.03; // cùng nhóm công trình -> cộng nhẹ, không đủ để đảo thứ hạng
      return { normId: n.id, score: Math.max(0, diem) };
    })
    .sort((a, b) => b.score - a.score);

  const top1 = ungVien[0] || { normId: "", score: 0 };
  const top2 = ungVien[1] || { normId: "", score: 0 };
  const NGUONG_TU_XAC_NHAN = 0.4; // cao hơn ngưỡng cũ 0.3 — chặt hơn, ít gán nhầm hơn
  const NGUONG_KHOANG_CACH_TOI_THIEU = 0.08; // top1 phải hơn top2 ít nhất chừng này mới coi là CHẮC CHẮN

  const duDiem = top1.score >= NGUONG_TU_XAC_NHAN;
  const duChacChan = (top1.score - top2.score) >= NGUONG_KHOANG_CACH_TOI_THIEU;
  const tuXacNhan = duDiem && duChacChan;

  return {
    normId: tuXacNhan ? top1.normId : "",
    score: top1.score,
    goiYNormId: top1.score > 0 ? top1.normId : "", // vẫn gợi ý cho QS chọn tay dù không tự xác nhận (chỉ khi có ít nhất 1 tín hiệu > 0)
    tuXacNhan,
    lyDoKhongTuXacNhan: !duDiem ? "Điểm khớp thấp, chưa đủ tin cậy" : !duChacChan ? `2 ứng viên hàng đầu quá gần điểm nhau (${top1.score.toFixed(2)} vs ${top2.score.toFixed(2)}) — không chắc chắn, cần QS xác nhận tay` : "",
  };
}

// Lưới an toàn chống trùng lặp — chạy SAU khi AI trả kết quả, KHÔNG tin AI tự
// soát trùng 100% (đã yêu cầu trong prompt nhưng AI vẫn có thể sót). Đánh dấu
// "nghiTrung" cho các dòng giống nhau ≥85% TÊN và CÙNG khối lượng (chênh <1%) —
// đây là dấu hiệu mạnh của trùng lặp thật (không phải 2 cấu kiện khác nhau tình
// cờ cùng khối lượng). KHÔNG tự xoá — chỉ cảnh báo, để người dùng tự quyết định
// (an toàn hơn, tránh xoá nhầm dòng thực sự khác nhau chỉ vì tên giống).
function ganhDauNghiTrung(danhSach) {
  return danhSach.map((item, i) => {
    for (let j = 0; j < danhSach.length; j++) {
      if (j === i) continue;
      const other = danhSach[j];
      const tenGiong = similarity(item.name, other.name) >= 0.85;
      const qtyGoc = Number(item.qty) || 0, qtyKhac = Number(other.qty) || 0;
      const qtyGiong = qtyGoc === qtyKhac || (qtyGoc > 0 && Math.abs(qtyGoc - qtyKhac) / qtyGoc < 0.01);
      if (tenGiong && qtyGiong) return { ...item, nghiTrung: true };
    }
    return item;
  });
}

// ---- đọc số kiểu Việt Nam (1.950.000) lẫn số thập phân chuẩn (450.5) — đã kiểm thử ----
function parseNum(v) {
  if (typeof v === "number") return v;
  if (v === "" || v == null) return NaN;
  let s = String(v).trim().replace(/\s/g, ""); // Loại bỏ toàn bộ khoảng trắng thừa
  if (!s) return NaN;

  // Trường hợp số chứa cả dấu chấm lẫn dấu phẩy (Ví dụ: 1,250.50 hoặc 1.250,50)
  if (s.includes(",") && s.includes(".")) {
    if (s.indexOf(",") < s.indexOf(".")) {
      s = s.replace(/,/g, ""); // Định dạng Anh/Mỹ: Xoá phân cách hàng ngàn, giữ dấu chấm thập phân
    } else {
      s = s.replace(/\./g, "").replace(",", "."); // Định dạng Việt/Đức: Xoá dấu chấm, đổi phẩy thành chấm
    }
    return Number(s);
  }

  const commaCount = (s.match(/,/g) || []).length;
  const dotCount = (s.match(/\./g) || []).length;

  // Nếu xuất hiện nhiều dấu phẩy/chấm -> Chắc chắn là dấu phân cách hàng ngàn
  if (commaCount > 1) return Number(s.replace(/,/g, ""));
  if (dotCount > 1) return Number(s.replace(/\./g, ""));

  // Nếu chỉ có duy nhất 1 dấu phẩy và nằm ở vị trí thập phân (3 chữ số cuối)
  if (commaCount === 1 && s.indexOf(",") > s.length - 4) {
    return Number(s.replace(",", "."));
  }

  return Number(s.replace(/,/g, ""));
}

// ---- đọc file dự toán mẫu (.xlsx/.csv), quét TẤT CẢ sheet, tự nhận diện cột
// "tên vật tư/nhân công" + "đơn giá" theo từ khoá tiếng Việt, so khớp mờ với danh
// sách vật tư/nhân công hiện có (đã kiểm thử bằng file giả lập nhiều sheet) ----
function parsePriceFile(rows_by_sheet, kind, existingList) {
  const cleanText = (s) => String(s).toLowerCase().normalize("NFC").trim();
  const H = {
    name: kind === "material"
      ? ["tên vật tư", "ten vat tu", "tên hàng", "ten hang", "vật tư", "vat tu", "tên"]
      : ["loại thợ", "loai tho", "tên nhân công", "ten nhan cong", "nhân công", "nhan cong"],
    code: ["mã hiệu", "ma hieu", "mã", "ma"],
    unit: ["đơn vị", "don vi", "đvt", "dvt"],
    price: ["đơn giá", "don gia", "giá", "gia"],
  };
  const matchCol = (row, kws) => {
    for (let c = 0; c < row.length; c++) {
      const cell = cleanText(row[c]);
      if (cell && kws.some((k) => cell.includes(k))) return c;
    }
    return -1;
  };
  const results = [];
  const sheetReport = [];
  for (const { sheetName, rows } of rows_by_sheet) {
    if (!rows.length) { sheetReport.push({ name: sheetName, status: "trống", count: 0 }); continue; }
    let headerIdx = -1, cols = null;
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const nameCol = matchCol(rows[r], H.name);
      const priceCol = matchCol(rows[r], H.price);
      if (nameCol >= 0 && priceCol >= 0 && nameCol !== priceCol) {
        headerIdx = r;
        cols = { name: nameCol, code: matchCol(rows[r], H.code), unit: matchCol(rows[r], H.unit), price: priceCol };
        break;
      }
    }
    let count = 0;
    if (headerIdx >= 0) {
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        const nameVal = String(row[cols.name] || "").trim();
        const priceVal = parseNum(row[cols.price]);
        if (!nameVal || nameVal.length < 3 || isNaN(priceVal) || priceVal <= 0) continue;
        if (/^(tổng|cộng|total|stt)/i.test(nameVal)) continue;
        let best = { id: "", score: 0 };
        existingList.forEach((x) => { const sc = similarity(nameVal, x.name); if (sc > best.score) best = { id: x.id, score: sc }; });
        results.push({
          key: uid("pi"),
          name: nameVal,
          code: cols.code >= 0 ? String(row[cols.code] || "").trim() : "",
          unit: cols.unit >= 0 ? String(row[cols.unit] || "").trim() : "",
          price: priceVal,
          matchedId: best.score >= 0.5 ? best.id : "",
          matchScore: best.score,
          sheet: sheetName,
        });
        count++;
      }
      sheetReport.push({ name: sheetName, status: `${count} dòng`, count });
    } else {
      sheetReport.push({ name: sheetName, status: "không nhận diện được", count: 0 });
    }
  }
  return { results, sheetReport };
}

// ---- đọc file "dự toán mẫu"/bảng khối lượng đã bóc sẵn (Tên hạng mục + Khối
// lượng), khớp mờ với định mức có sẵn — dùng để nạp thêm khối lượng vào BOQ mà
// KHÔNG cần AI đọc bản vẽ (đường dự phòng khi AI đọc ảnh/PDF gặp trục trặc) ----
function parseTakeoffFile(rows_by_sheet, existingNorms) {
  const cleanText = (s) => String(s).toLowerCase().normalize("NFC").trim();
  const H = {
    name: ["tên hạng mục", "ten hang muc", "hạng mục", "hang muc", "công tác", "cong tac", "tên công việc", "ten cong viec", "nội dung", "noi dung", "tên"],
    unit: ["đơn vị", "don vi", "đvt", "dvt"],
    qty: ["khối lượng", "khoi luong", "số lượng", "so luong", "kl"],
  };
  const matchCol = (row, kws) => {
    for (let c = 0; c < row.length; c++) {
      const cell = cleanText(row[c]);
      if (cell && kws.some((k) => cell.includes(k))) return c;
    }
    return -1;
  };
  const results = [];
  const sheetReport = [];
  for (const { sheetName, rows } of rows_by_sheet) {
    if (!rows.length) { sheetReport.push({ name: sheetName, status: "trống", count: 0 }); continue; }
    let headerIdx = -1, cols = null;
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const nameCol = matchCol(rows[r], H.name);
      const qtyCol = matchCol(rows[r], H.qty);
      if (nameCol >= 0 && qtyCol >= 0 && nameCol !== qtyCol) {
        headerIdx = r;
        cols = { name: nameCol, unit: matchCol(rows[r], H.unit), qty: qtyCol };
        break;
      }
    }
    let count = 0;
    if (headerIdx >= 0) {
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        const nameVal = String(row[cols.name] || "").trim();
        const qtyVal = parseNum(row[cols.qty]);
        if (!nameVal || nameVal.length < 3 || isNaN(qtyVal) || qtyVal <= 0) continue;
        if (/^(tổng|cộng|total|stt)/i.test(nameVal)) continue;
        let best = { id: "", score: 0 };
        existingNorms.forEach((n) => { const sc = similarity(nameVal, n.name); if (sc > best.score) best = { id: n.id, score: sc }; });
        results.push({
          key: uid("ti"),
          name: nameVal,
          unit: cols.unit >= 0 ? String(row[cols.unit] || "").trim() : "",
          qty: qtyVal,
          matchedId: best.score >= 0.3 ? best.id : "",
          matchScore: best.score,
          sheet: sheetName,
        });
        count++;
      }
      sheetReport.push({ name: sheetName, status: `${count} dòng`, count });
    } else {
      sheetReport.push({ name: sheetName, status: "không nhận diện được", count: 0 });
    }
  }
  return { results, sheetReport };
}

// ============================================================================
// MAIN APP
// ============================================================================
export default function QsEstimateApp() {
  const [projects, setProjects] = useState([
    { id: "pj001", name: "Dự án mới", groupId: "nha-pho", createdAt: new Date().toISOString().slice(0, 10), quanLyPct: 0.08, khacPct: 0.01, loiNhuanPct: 0.12, vatPct: 0.08, khoanThreshold: -0.05 },
  ]);
  const [activeProjectId, setActiveProjectId] = useState("pj001");
  const [materials, setMaterials] = useState(SEED_MATERIALS);
  const [labor, setLabor] = useState(SEED_LABOR);
  const [norms, setNorms] = useState(SEED_NORMS);
  const [boqItems, setBoqItems] = useState([]);
  const [changeLog, setChangeLog] = useState([]);
  const [priceLog, setPriceLog] = useState([]); // nhật ký trượt giá hàng loạt
  const [adjustHistory, setAdjustHistory] = useState([]); // hoàn tác lần điều chỉnh giá hàng loạt gần nhất

  // ---- Nhà thầu / NCC — mỗi nhà thầu có 1 bảng báo giá riêng, tách biệt với giá
  // nội bộ theo nhóm công trình. Chọn 1 nhà thầu "đang hoạt động" thì toàn bộ BOQ/
  // xuất file dùng giá của nhà thầu đó cho vật tư/nhân công đã có báo giá.
  const [vendors, setVendors] = useState([{ id: "internal", name: "Giá nội bộ (đang dùng)", contact: "" }]);
  const [activeVendorId, setActiveVendorId] = useState("internal");
  const [vendorPrices, setVendorPrices] = useState({}); // { [vendorId]: { [itemId]: price } }
  const [vendorImportResults, setVendorImportResults] = useState([]);
  const [vendorImportReport, setVendorImportReport] = useState(null);
  const [vendorImportKind, setVendorImportKind] = useState("material");
  const [vendorImportBatch, setVendorImportBatch] = useState([]);

  // ---- Nhập file "dự toán mẫu"/bảng khối lượng đã bóc sẵn — nạp khối lượng vào
  // BOQ mà không cần AI đọc bản vẽ (đường dự phòng, dùng bất cứ lúc nào) ----
  const [takeoffImportResults, setTakeoffImportResults] = useState([]);
  const [takeoffImportReport, setTakeoffImportReport] = useState(null);
  const [takeoffImportBatch, setTakeoffImportBatch] = useState([]); // các boqId vừa thêm — để hoàn tác

  // ---- Mẫu dự toán trọn bộ: lưu cả (thông số công trình + danh sách BOQ) thành
  // mẫu có tên; dự án mới tạo từ mẫu là có sẵn mọi thứ, chỉ đổi thông số là ra giá ----
  const [boqTemplates, setBoqTemplates] = useState(SEED_TEMPLATES); // { [tên]: { groupId, dims, items:[{normId,basis,ratio,qty,category,khoanPrice}] } }
  const [revisionSnapshots, setRevisionSnapshots] = useState([]); // [{id, projectId, ten, when, items:[{normId,qty,khoanPrice}]}] — mục 13b: lưu 1 lát cắt BOQ để so sánh sau này
  const [activeTab, setActiveTab] = useState("projects");
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [toast, setToast] = useState(null);
  const [lastExport, setLastExport] = useState(null);
  const [drawingVersions, setDrawingVersions] = useState([]); // [{id, projectId, label, date}]
  const [photos, setPhotos] = useState([]); // [{id, projectId, versionId, dataUrl, name}]
  const [drawingFiles, setDrawingFiles] = useState([]); // [{id, projectId, versionId, name, size, url}] — PDF
  const [aiResults, setAiResults] = useState([]); // hạng mục AI đọc được, chờ khớp định mức + xác nhận
  const [lastRawDebug, setLastRawDebug] = useState("");  // hiển thị backend trả về gì (giúp chẩn đoán không cần F12)
  // SỬA LỖI THẬT (phát hiện qua audit): backend đã tính pipelineTrace (trạng
  // thái 9 bước) và drawingModel (object/relationships) từ lâu, nhưng frontend
  // trước đây CHỈ đọc data.items, bỏ qua hoàn toàn 2 trường này.
  const [lastPipelineTrace, setLastPipelineTrace] = useState(null);
  const [lastDrawingModel, setLastDrawingModel] = useState(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(null);
  const [aiProgress, setAiProgress] = useState(0); // % tiến độ giả lập trong lúc chờ AI đọc ảnh
  // ---- Phân quyền: mã truy cập từng người ----
  const [accessCode, setAccessCode] = useState(() => { try { return localStorage.getItem("qs_access_code") || ""; } catch (e) { return ""; } });
  const [authUser, setAuthUser] = useState(null);   // { ten, quanTri, coPhanQuyen }
  const [authChecking, setAuthChecking] = useState(!!BACKEND_URL);
  const [authError, setAuthError] = useState("");
  const authHeaders = useCallback(() => (accessCode ? { "x-access-code": accessCode } : {}), [accessCode]);

  const kiemTraMa = useCallback(async (ma) => {
    if (!BACKEND_URL) { setAuthChecking(false); return; }
    setAuthChecking(true);
    setAuthError("");
    try {
      const r = await fetch(`${BACKEND_URL}/api/whoami`, { headers: ma ? { "x-access-code": ma } : {} });
      const d = await r.json();
      if (!r.ok) { setAuthUser(null); setAuthError(d?.error || "Mã truy cập không đúng."); }
      else setAuthUser(d);
    } catch (e) {
      setAuthUser(null);
      setAuthError(`Không gọi được server (${e.message}). Server có thể đang ngủ — chờ ~50 giây rồi thử lại.`);
    } finally {
      setAuthChecking(false);
    }
  }, []);

  useEffect(() => { if (BACKEND_URL) kiemTraMa(accessCode); }, []);

  const dangNhap = (ma) => {
    const m = (ma || "").trim();
    try { localStorage.setItem("qs_access_code", m); } catch (e) {}
    setAccessCode(m);
    kiemTraMa(m);
  };
  const dangXuat = () => {
    try { localStorage.removeItem("qs_access_code"); } catch (e) {}
    setAccessCode("");
    setAuthUser(null);
  };

  const [aiError, setAiError] = useState(null);
  // Theo dõi chi phí token AI: lần đọc gần nhất + cộng dồn cả phiên làm việc
  const [aiCostLast, setAiCostLast] = useState(null);
  const [aiCostTotal, setAiCostTotal] = useState({ usd: 0, vnd: 0, count: 0 });
  const ghiNhanChiPhi = useCallback((cost) => {
    if (!cost) return;
    setAiCostLast(cost);
    setAiCostTotal((t) => ({ usd: +(t.usd + (cost.usd || 0)).toFixed(5), vnd: t.vnd + (cost.vnd || 0), count: t.count + 1 }));
  }, []);

  // Kiểm tra kết nối tới backend riêng — cho biết chính xác gọi được hay không,
  // và nếu không thì lỗi gì (server ngủ / bị chặn / sai địa chỉ).
  const [connTest, setConnTest] = useState(null);
  const [connTesting, setConnTesting] = useState(false);
  const testBackend = useCallback(async () => {
    if (!BACKEND_URL) return;
    setConnTesting(true);
    setConnTest(null);
    const t0 = Date.now();
    try {
      const r = await fetch(`${BACKEND_URL}/health`);
      const giay = ((Date.now() - t0) / 1000).toFixed(1);
      let d = null;
      try { d = await r.json(); } catch (e) { /* không phải JSON */ }
      if (!r.ok) {
        setConnTest({ ok: false, msg: `Gọi được server nhưng server trả lỗi HTTP ${r.status} (sau ${giay}s).` });
      } else {
        setConnTest({ ok: true, msg: `Kết nối OK sau ${giay}s — server: ${d?.status || "?"}, API key: ${d?.hasApiKey ? "đã có ✓" : "CHƯA có ✗"}` });
      }
    } catch (e) {
      const giay = ((Date.now() - t0) / 1000).toFixed(1);
      setConnTest({ ok: false, msg: `Không gọi được server (${e.message}) sau ${giay}s. Nếu thất bại rất nhanh (dưới 2s) thì nhiều khả năng môi trường đang chạy app chặn gọi ra ngoài; nếu chờ lâu rồi mới lỗi thì server đang ngủ — mở ${BACKEND_URL}/health trên trình duyệt cho server thức rồi thử lại.` });
    } finally {
      setConnTesting(false);
    }
  }, []);
  const [priceImportResults, setPriceImportResults] = useState([]); // dòng chờ xác nhận sau khi đọc file dự toán mẫu
  const [priceImportKind, setPriceImportKind] = useState("material"); // "material" | "labor"
  const [priceImportGroupId, setPriceImportGroupId] = useState("nha-pho"); // nhóm công trình mà file đang nhập áp dụng cho
  const [priceImportReport, setPriceImportReport] = useState(null);
  const [importBatch, setImportBatch] = useState([]); // [{type:'update'|'create', kind, id, prevPrice}] — để hoàn tác cả lần nhập

  const showToast = useCallback((msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  }, []);

  // SỬA LỖI THẬT (chẩn đoán từ triệu chứng mất tiền không rõ nguyên nhân): nếu
  // trang bị tải lại/đóng giữa lúc đang chờ job PDF lớn, job đó vẫn chạy ngầm
  // trên server (tốn tiền AI thật) nhưng không ai còn theo dõi được kết quả —
  // cảnh báo NGAY khi mở lại app, không để âm thầm mất dấu lần nữa.
  // SỬA LỚN (theo yêu cầu chú: "không phụ thuộc web bị cắt giữa chừng khi chờ
  // lâu không thao tác") — trước đây chỉ CẢNH BÁO rồi xoá dấu vết, người dùng
  // vẫn phải tự nhớ báo người khác kiểm tra tay. Giờ TỰ ĐỘNG NỐI LẠI theo dõi
  // job đó ngay khi mở lại app — vì job vẫn chạy tiếp ở server (Postgres, bền
  // vững) bất kể điện thoại/trình duyệt có bị hệ điều hành tạm dừng/tải lại
  // hay không. Chỉ tự động ÁP kết quả vào BOQ nếu vẫn đang mở ĐÚNG dự án lúc
  // tạo job (so activeProjectId) — nếu đã chuyển dự án khác, chỉ cảnh báo,
  // không tự áp nhầm vào dự án đang mở.
  useEffect(() => {
    if (!activeProjectId) return; // chờ activeProjectId có giá trị thật (sau khi load xong) mới kiểm tra
    let huy = false;
    (async () => {
      let raw;
      try { raw = localStorage.getItem("qs_job_dang_cho"); } catch (e) { return; }
      if (!raw) return;
      let thongTin;
      try { thongTin = JSON.parse(raw); } catch (e) { localStorage.removeItem("qs_job_dang_cho"); return; }
      const { jobId, tenFile, projectId, luc } = thongTin;
      const phutTruoc = Math.round((Date.now() - luc) / 60000);
      if (!jobId) { localStorage.removeItem("qs_job_dang_cho"); return; }
      showToast(`⏳ Phát hiện lần đọc "${tenFile}" bị ngắt ${phutTruoc} phút trước — đang tự động nối lại theo dõi (không cần đọc lại, không tốn thêm tiền)…`, "warn");
      try {
        const dataResult = await theoDoiJobToiKhiXong(jobId);
        if (huy) return;
        localStorage.removeItem("qs_job_dang_cho");
        const items = Array.isArray(dataResult?.items) ? dataResult.items : [];
        if (!items.length) { showToast(`Lần đọc "${tenFile}" đã xong nhưng không có hạng mục nào (có thể bản vẽ lỗi hoặc AI không đọc được gì).`, "warn"); return; }
        const moiDocKhoiPhuc = items.map((p) => ({
          key: uid("air"), projectId: projectId || activeProjectId,
          name: p.name || "Hạng mục chưa đặt tên", unit: p.unit || "", qty: Number(p.qty) || 0, note: p.note || "",
          category: NHOM_TU_AI[p.group] || "cat-hoanthien", sourcePhoto: tenFile, model: p.model || null,
          evidence_region: p.evidence_region || null, confidenceMatrix: p.confidenceMatrix || null,
        }));
        setAiResults((prev) => [...prev, ...moiDocKhoiPhuc]);
        if (projectId && projectId === activeProjectId) {
          apDungDanhSachVaoBoq(moiDocKhoiPhuc, { imLang: true });
          showToast(`✅ Đã tự động nối lại và thêm ${items.length} hạng mục từ "${tenFile}" vào BOQ — không mất gì cả.`);
        } else {
          showToast(`✅ Lần đọc "${tenFile}" đã có kết quả (${items.length} hạng mục) — nhưng khác dự án đang mở, chưa tự thêm vào BOQ. Xem ở "Bước 2 — Duyệt khối lượng" của đúng dự án đó.`);
        }
      } catch (e) {
        if (huy) return;
        localStorage.removeItem("qs_job_dang_cho");
        showToast(`Lần đọc "${tenFile}" bị ngắt trước đó — thử nối lại nhưng lỗi: ${e.message}. Có thể job đã hết hạn, cần đọc lại từ đầu.`, "error");
      }
    })();
    return () => { huy = true; };
  }, [activeProjectId]);

  // ---- load/save (window.storage) ----
  useEffect(() => {
    (async () => {
      try {
        const res = await appStorage.get("qsapp-state-v1");
        if (res && res.value) {
          const p = JSON.parse(res.value);
          if (p.projects) setProjects(p.projects);
          if (p.activeProjectId) setActiveProjectId(p.activeProjectId);
          if (p.materials) setMaterials(p.materials);
          if (p.labor) setLabor(p.labor);
          if (p.norms) setNorms(p.norms);
          if (p.boqItems) setBoqItems(p.boqItems);
          if (p.changeLog) setChangeLog(p.changeLog);
          if (p.drawingVersions) setDrawingVersions(p.drawingVersions);
          if (p.boqTemplates) setBoqTemplates(p.boqTemplates);
          if (p.aiResults) setAiResults(p.aiResults);
          if (p.vendors) setVendors(p.vendors);
          if (p.activeVendorId) setActiveVendorId(p.activeVendorId);
          if (p.vendorPrices) setVendorPrices(p.vendorPrices);
          if (p.revisionSnapshots) setRevisionSnapshots(p.revisionSnapshots);
        }
      } catch (e) {
        // chưa có dữ liệu lưu trước đó — dùng seed mặc định
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      let ok = false;
      const payload = JSON.stringify({ projects, activeProjectId, materials, labor, norms, boqItems, changeLog, drawingVersions, boqTemplates, aiResults, vendors, activeVendorId, vendorPrices, revisionSnapshots });
      // Thử lưu tối đa 2 lần — lần đầu có thể thất bại nếu server (gói miễn phí)
      // vừa ngủ dậy; chờ 3 giây rồi thử lại trước khi báo "Lỗi lưu".
      for (let lan = 0; lan < 2 && !ok; lan++) {
        try {
          const kq = await appStorage.set("qsapp-state-v1", payload);
          ok = kq !== false;
        } catch (e) { ok = false; }
        if (!ok && lan === 0) await new Promise((r) => setTimeout(r, 3000));
      }
      setSaveState(ok ? "saved" : "error");
    }, 600);
    return () => clearTimeout(t);
  }, [projects, activeProjectId, materials, labor, norms, boqItems, changeLog, drawingVersions, boqTemplates, aiResults, vendors, activeVendorId, vendorPrices, revisionSnapshots, loaded]);

  // Cảnh báo trước khi rời trang (bấm back/đóng tab) nếu còn dữ liệu chưa kịp lưu
  // xong hoặc còn kết quả AI đọc chưa duyệt vào BOQ — giảm rủi ro mất việc do lỡ tay.
  useEffect(() => {
    const canhBao = (e) => {
      if (saveState === "saving" || saveState === "error" || aiResults.length > 0) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", canhBao);
    return () => window.removeEventListener("beforeunload", canhBao);
  }, [saveState, aiResults.length]);

  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];
  useEffect(() => {
    if (activeProject) setPriceImportGroupId(activeProject.groupId);
  }, [activeProject?.groupId]);
  const materialsById = useMemo(() => Object.fromEntries(materials.map((m) => [m.id, m])), [materials]);
  const laborById = useMemo(() => Object.fromEntries(labor.map((l) => [l.id, l])), [labor]);
  const normsById = useMemo(() => Object.fromEntries(norms.map((n) => [n.id, n])), [norms]);

  const projectBoq = useMemo(
    () => boqItems.filter((b) => b.projectId === activeProjectId),
    [boqItems, activeProjectId]
  );

  // SỬA LỖI THẬT (phát hiện qua phản ánh người dùng): kết quả AI đọc được (chờ
  // duyệt vào BOQ) trước đây KHÔNG lọc theo dự án — đọc bản vẽ dự án A xong
  // chưa duyệt hết, chuyển sang dự án B, "Bước 2 — Duyệt khối lượng" vẫn hiện
  // lẫn kết quả của dự án A, gây đúng cảm giác "không xoá được, phải thoát
  // app". Lọc đúng theo dự án đang mở, giống cách projectBoq đã làm ở trên.
  const projectAiResults = useMemo(
    () => aiResults.filter((r) => r.projectId === activeProjectId),
    [aiResults, activeProjectId]
  );

  const projectNorms = useMemo(
    () => norms.filter((n) => (n.scope === "master" && n.groups.includes(activeProject?.groupId)) || (n.scope === "local" && n.projectId === activeProjectId)),
    [norms, activeProject, activeProjectId]
  );

  // Khối lượng theo tham số công trình: hạng mục gắn "cơ sở tính" (GFA/phòng/WC/
  // tầng) × hệ số thì khối lượng TỰ TÍNH từ thông số dự án — đổi kích thước là
  // toàn bộ BOQ tự cập nhật, không phải sửa từng dòng. basis "manual" = nhập tay.
  const GFA = (Number(activeProject?.W) || 0) * (Number(activeProject?.L) || 0) * (Number(activeProject?.floors) || 0);
  const basisValue = useCallback((basis) => {
    if (basis === "gfa") return GFA;
    if (basis === "room") return Number(activeProject?.rooms) || 0;
    if (basis === "wc") return Number(activeProject?.wc) || 0;
    if (basis === "floor") return Number(activeProject?.floors) || 0;
    return 1;
  }, [GFA, activeProject]);

  const boqLines = useMemo(
    () => projectBoq.map((b) => {
      const effQty = (!b.basis || b.basis === "manual") ? b.qty : +(basisValue(b.basis) * (Number(b.ratio) || 0)).toFixed(2);
      const bEff = { ...b, qty: effQty };
      return { boq: bEff, norm: normsById[b.normId], calc: computeBoqLine(bEff, normsById[b.normId], materialsById, laborById, activeProject?.groupId, activeVendorId, vendorPrices) };
    }).filter((l) => l.calc),
    [projectBoq, normsById, materialsById, laborById, activeProject, activeVendorId, vendorPrices, basisValue]
  );

  const includedBoqLines = useMemo(() => boqLines.filter((l) => l.boq.included !== false), [boqLines]);

  const totals = useMemo(() => {
    let VL = 0, NC = 0, May = 0, phanTich = 0, khoan = 0;
    includedBoqLines.forEach(({ boq, calc }) => {
      VL += boq.qty * calc.analyzed.vlCost;
      NC += boq.qty * calc.analyzed.ncCost;
      May += boq.qty * calc.analyzed.mayCost;
      phanTich += calc.thanhTienPhanTich;
      khoan += calc.thanhTienKhoan;
    });
    const truc_tiep = VL + NC + May;
    const quanLy = truc_tiep * (activeProject?.quanLyPct || 0);
    const khac = truc_tiep * (activeProject?.khacPct || 0);
    const giaThanh = truc_tiep + quanLy + khac;
    const loiNhuan = giaThanh * (activeProject?.loiNhuanPct || 0);
    const giaBanTruocVAT = giaThanh + loiNhuan;
    const vat = giaBanTruocVAT * (activeProject?.vatPct || 0);
    const giaBanSauVAT = giaBanTruocVAT + vat;
    return { VL, NC, May, truc_tiep, quanLy, khac, giaThanh, loiNhuan, giaBanTruocVAT, vat, giaBanSauVAT, phanTich, khoan };
  }, [includedBoqLines, activeProject]);

  // SỬA LỖI THẬT (phát hiện qua phản ánh người dùng): trước đây yêu cầu CẢ
  // totals.truc_tiep > 0 — nếu AI đọc ra hạng mục CHƯA khớp định mức sẵn có,
  // app tự tạo định mức mới với vt/nc/may RỖNG (giá 0đ, đúng thiết kế — không
  // bịa giá) → truc_tiep = 0 DÙ ĐÃ CÓ DÒNG BOQ THẬT (đã duyệt đúng ở Bước 2) →
  // hasData = false → toàn bộ tab "Xuất file"/Dashboard biến mất, người dùng
  // tưởng app lỗi dù thực ra chỉ cần vào bổ sung giá. Giá 0đ vẫn LÀ dữ liệu —
  // chỉ cần có dòng BOQ là đủ để hiển thị, không cần giá đã đầy đủ.
  const hasData = includedBoqLines.length > 0;

  // ---- mutations ----
  const addProject = (name, groupId) => {
    const id = uid("pj");
    setProjects((prev) => [...prev, { id, name, groupId, createdAt: new Date().toISOString().slice(0, 10), quanLyPct: 0.08, khacPct: 0.01, loiNhuanPct: 0.12, vatPct: 0.08, khoanThreshold: -0.05, W: 0, L: 0, floors: 1, rooms: 0, wc: 0 }]);
    setActiveProjectId(id);
    // SỬA THEO YÊU CẦU: BỎ HẲN việc tự động thêm dòng mẫu (basis="gfa"/"floor")
    // khi tạo dự án mới — trước đây tự thêm 6 dòng có tên nhưng KL=0 (vì công
    // thức basis chờ "Thông số công trình" của DỰ ÁN MỚI, mặc định W=L=0), gây
    // hiểu lầm liên tục nhiều lần là "app lỗi" dù đây vốn là tính năng cố ý.
    // Dự án mới giờ BẮT ĐẦU TRỐNG — chỉ có dòng khi AI đọc bản vẽ (tự động vào
    // BOQ ngay) hoặc người dùng tự thêm tay. Ai muốn dùng mẫu có sẵn vẫn dùng
    // được qua đúng nút "Tạo dự án từ mẫu" riêng (lựa chọn rõ ràng, không tự
    // động ngầm).
    showToast(`Đã tạo dự án "${name}" — đọc bản vẽ để AI tự điền khối lượng, hoặc thêm hạng mục thủ công.`);
  };

  const updateProjectSetting = (field, value) => {
    setProjects((prev) => prev.map((p) => (p.id === activeProjectId ? { ...p, [field]: value } : p)));
  };

  // Chọn đúng dự toán mẫu tham chiếu để gửi kèm khi đọc bản vẽ: nếu dự án CÓ
  // tự nạp mẫu TUỲ CHỈNH riêng (activeProject.duToanMauThamChieu, không rỗng)
  // -> dùng bản đó, THAY THẾ HOÀN TOÀN bản mặc định (không gộp cả 2, tránh
  // AI bị rối vì 2 nguồn có thể mâu thuẫn nhau). Nếu KHÔNG nạp gì -> tự động
  // dùng bản MẶC ĐỊNH tích hợp sẵn theo đúng nhóm công trình của dự án -
  // người dùng KHÔNG cần nạp gì cả, vẫn có tham chiếu ngay từ đầu.
  const layDuToanMauThamChieu = (project) => {
    const tuyChinh = (project?.duToanMauThamChieu || "").trim();
    if (tuyChinh) return tuyChinh;
    return SEED_DU_TOAN_MAU_MAC_DINH[project?.groupId] || "";
  };

  // ---- Mẫu dự toán trọn bộ ----
  const saveAsTemplate = (name) => {
    const tplName = (name || "").trim();
    if (!tplName || !activeProject) { showToast("Đặt tên mẫu trước khi lưu.", "warn"); return; }
    const items = boqItems.filter((b) => b.projectId === activeProjectId).map(({ normId, basis, ratio, qty, category, khoanPrice }) => ({ normId, basis: basis || "manual", ratio: ratio || 0, qty: qty || 0, category: category || STANDARD_CATEGORIES[0].id, khoanPrice: khoanPrice ?? null }));
    if (!items.length) { showToast("Dự án hiện tại chưa có dòng BOQ nào để lưu làm mẫu.", "warn"); return; }
    setBoqTemplates((prev) => ({ ...prev, [tplName]: {
      groupId: activeProject.groupId,
      dims: { W: activeProject.W || 0, L: activeProject.L || 0, floors: activeProject.floors || 1, rooms: activeProject.rooms || 0, wc: activeProject.wc || 0 },
      pcts: { quanLyPct: activeProject.quanLyPct, khacPct: activeProject.khacPct, loiNhuanPct: activeProject.loiNhuanPct, vatPct: activeProject.vatPct, khoanThreshold: activeProject.khoanThreshold },
      items,
    }}));
    showToast(`Đã lưu mẫu "${tplName}" (${items.length} dòng BOQ + thông số công trình). Dự án sau tạo từ mẫu này là có sẵn mọi thứ.`);
  };
  const createProjectFromTemplate = (tplName, projectName) => {
    const tpl = boqTemplates[tplName];
    const pName = (projectName || "").trim();
    if (!tpl || !pName) { showToast("Chọn mẫu và đặt tên dự án mới trước.", "warn"); return; }
    const id = uid("pj");
    setProjects((prev) => [...prev, { id, name: pName, groupId: tpl.groupId, createdAt: new Date().toISOString().slice(0, 10), ...(tpl.pcts || {}), ...(tpl.dims || {}) }]);
    setBoqItems((prev) => [...prev, ...tpl.items.map((it) => ({ id: uid("boq"), projectId: id, included: true, ...it }))]);
    setActiveProjectId(id);
    showToast(`Đã tạo dự án "${pName}" từ mẫu "${tplName}" — ${tpl.items.length} dòng BOQ sẵn sàng, đọc bản vẽ để AI tự điền khối lượng thật.`);
  };
  // ---- Tìm mẫu dự toán khớp đúng nhóm công trình của dự án đang chọn, lấy ra
  // danh sách TÊN đầu việc chuẩn — gửi kèm khi đọc bản vẽ để AI bám theo đúng
  // cấu trúc công ty đã lập sẵn, thay vì tự đặt tên mới mỗi lần đọc. Nếu có nhiều
  // mẫu cùng nhóm, gộp tên (không trùng) từ tất cả các mẫu đó lại.
  const layDanhSachChuanTheoNhom = useCallback(() => {
    if (!activeProject) return { danhSach: [], tenMauDaDung: [], tenToNormId: {} };
    // Ưu tiên TUYỆT ĐỐI: mẫu đã gắn rõ ràng cho dự án này (thẻ Dự án → "Mẫu dự toán
    // liên kết") — không tự dò quét nhiều mẫu cùng nhóm để tránh lẫn lộn không kiểm
    // soát được. Chỉ khi CHƯA gắn mẫu nào mới rơi về cách cũ (dò theo nhóm công trình).
    // Nguồn này LUÔN có sẵn liên kết tên→normId (tên lấy trực tiếp từ normsById
    // theo đúng it.normId đã lưu trong BOQ mẫu) — không cần đoán, ghi thẳng vào
    // tenToNormId để bước khớp định mức sau này dùng ngay, khỏi qua khớp mờ.
    if (activeProject.mauLienKet && boqTemplates[activeProject.mauLienKet]) {
      const tpl = boqTemplates[activeProject.mauLienKet];
      const tenSet = new Set();
      const tenToNormId = {};
      tpl.items.forEach((it) => { const n = normsById[it.normId]?.name; if (n) { tenSet.add(n); tenToNormId[chuanHoaTen(n)] = it.normId; } });
      return { danhSach: Array.from(tenSet), tenMauDaDung: [activeProject.mauLienKet], tenToNormId };
    }
    const tenMauKhop = Object.entries(boqTemplates).filter(([, tpl]) => tpl.groupId === activeProject.groupId).map(([ten]) => ten);
    const tenSet = new Set();
    const tenToNormId = {};
    tenMauKhop.forEach((ten) => {
      boqTemplates[ten].items.forEach((it) => {
        const n = normsById[it.normId]?.name;
        if (n) { tenSet.add(n); tenToNormId[chuanHoaTen(n)] = it.normId; }
      });
    });
    return { danhSach: Array.from(tenSet), tenMauDaDung: tenMauKhop, tenToNormId };
  }, [boqTemplates, activeProject, normsById]);

  // Ưu tiên lấy DANH SÁCH TÊN CHUẨN từ backend (mục "Thay đổi dự toán mẫu",
  // quản lý qua API riêng — thêm mới) — chỉ rơi về cách cũ (dò từ boqTemplates
  // cục bộ) khi backend chưa có dữ liệu cho nhóm này hoặc gọi lỗi (offline...).
  // KHÔNG đụng tới boqTemplates/layDanhSachChuanTheoNhom — cơ chế đó vẫn giữ
  // nguyên, dùng riêng để tự tính khối lượng theo diện tích khi tạo dự án mới.
  const layDanhSachChuanTuBackend = useCallback(async () => {
    if (!activeProject) return layDanhSachChuanTheoNhom();
    try {
      // SỬA: trước đây gọi "/names" (chỉ trả mảng chuỗi tên, KHÔNG có normId) —
      // giờ gọi endpoint ĐẦY ĐỦ "/api/templates/:groupId" (trả nguyên "items",
      // mỗi phần tử CÓ THỂ là {ten, normId} nếu QS đã gắn liên kết trong
      // TemplateEditorPanel) — để dựng được tenToNormId dùng cho khớp chính xác.
      const r = await fetch(`${BACKEND_URL}/api/templates/${activeProject.groupId}`, { headers: authHeaders() });
      if (r.ok) {
        const data = await r.json();
        const items = Array.isArray(data.items) ? data.items : [];
        const danhSach = items.map((it) => (typeof it === "string" ? it : it?.ten || "")).filter(Boolean);
        if (danhSach.length) {
          const tenToNormId = {};
          items.forEach((it) => {
            if (it && typeof it === "object" && it.ten && it.normId) tenToNormId[chuanHoaTen(it.ten)] = it.normId;
          });
          return { danhSach, tenMauDaDung: [`(backend v${data.version})`], tenToNormId };
        }
      }
    } catch (e) { /* offline/lỗi mạng -> rơi về cách cũ bên dưới, không chặn luồng đọc */ }
    return layDanhSachChuanTheoNhom();
  }, [activeProject, authHeaders, layDanhSachChuanTheoNhom]);

  const deleteTemplate = (tplName) => {
    setBoqTemplates((prev) => { const next = { ...prev }; delete next[tplName]; return next; });
    showToast(`Đã xoá mẫu "${tplName}".`, "warn");
  };

  // ---- So sánh dự án hiện tại với 1 mẫu dự toán cùng nhóm công trình ----
  // Trả về: dòng THIẾU (có trong mẫu, chưa có trong dự án) và dòng THỪA (có trong
  // dự án nhưng không nằm trong mẫu) — để chú tự quyết định thêm/bớt, KHÔNG tự
  // động âm thầm sửa dữ liệu (để tránh sai lệch không kiểm soát được).
  const soSanhVoiMau = useCallback((tplName) => {
    const tpl = boqTemplates[tplName];
    if (!tpl) return null;
    const hienTai = boqItems.filter((b) => b.projectId === activeProjectId);
    const normIdHienTai = new Set(hienTai.map((b) => b.normId));
    const normIdMau = new Set(tpl.items.map((it) => it.normId));
    const thieu = tpl.items.filter((it) => !normIdHienTai.has(it.normId)).map((it) => ({ ...it, normName: normsById[it.normId]?.name || "(định mức đã xoá)" }));
    const thua = hienTai.filter((b) => !normIdMau.has(b.normId)).map((b) => ({ id: b.id, normId: b.normId, normName: normsById[b.normId]?.name || "(định mức đã xoá)" }));
    return { thieu, thua, tenMau: tplName };
  }, [boqTemplates, boqItems, activeProjectId, normsById]);

  // Lưu 1 "lát cắt" (snapshot) của toàn bộ BOQ dự án hiện tại — không phải bản sao
  // sâu (deep copy) đầy đủ, chỉ giữ đủ dữ liệu để so sánh sau này: normId, qty,
  // khoanPrice. Dùng khi muốn chốt 1 mốc (VD "Trước khi gửi thầu lần 1") để sau
  // này so với bản hiện tại xem đã đổi những gì.
  const luuSnapshotBoq = (ten) => {
    if (!ten.trim()) { showToast("Cần đặt tên cho phiên bản trước khi lưu.", "warn"); return; }
    const itemsHienTai = boqItems.filter((b) => b.projectId === activeProjectId).map((b) => ({ normId: b.normId, qty: b.qty, khoanPrice: b.khoanPrice }));
    setRevisionSnapshots((prev) => [{ id: uid("rev"), projectId: activeProjectId, ten, when: new Date().toLocaleString("vi-VN"), items: itemsHienTai }, ...prev]);
    showToast(`Đã lưu phiên bản "${ten}" (${itemsHienTai.length} dòng) — có thể so sánh với bản hiện tại sau này.`);
  };

  // So sánh BOQ HIỆN TẠI với 1 snapshot đã lưu — trả về 3 nhóm: THÊM (có ở hiện
  // tại, không có ở snapshot cũ), BỚT (có ở snapshot cũ, không còn ở hiện tại),
  // ĐỔI (cùng định mức nhưng khối lượng/giá khác nhau).
  const soSanhSnapshot = (snapshotId) => {
    const snap = revisionSnapshots.find((s) => s.id === snapshotId);
    if (!snap) return null;
    const hienTai = boqItems.filter((b) => b.projectId === activeProjectId);
    const cuMap = new Map(snap.items.map((it) => [it.normId, it]));
    const moiMap = new Map(hienTai.map((it) => [it.normId, it]));
    const them = hienTai.filter((it) => !cuMap.has(it.normId)).map((it) => ({ normId: it.normId, qty: it.qty }));
    const bot = snap.items.filter((it) => !moiMap.has(it.normId)).map((it) => ({ normId: it.normId, qty: it.qty }));
    const doi = hienTai.filter((it) => {
      const cu = cuMap.get(it.normId);
      return cu && (cu.qty !== it.qty || cu.khoanPrice !== it.khoanPrice);
    }).map((it) => ({ normId: it.normId, quaKhu: cuMap.get(it.normId), hienTai: { qty: it.qty, khoanPrice: it.khoanPrice } }));
    return { tenSnap: snap.ten, khiNao: snap.when, them, bot, doi };
  };

  const themDauViecThieu = (tplName, danhSachThieu) => {
    const themVao = danhSachThieu.map((it) => {
      const laManual = !it.basis || it.basis === "manual";
      // Khối lượng "manual" trong mẫu là số TUYỆT ĐỐI của công trình gốc (VD 299m2
      // của khách sạn S6-38) — copy nguyên sang dự án khác là SAI, vì công trình
      // khác kích thước khác. Đặt về 0, buộc phải nhập tay khối lượng thật của dự
      // án đang làm. Chỉ giữ nguyên khi basis là tham số (gfa/room/wc/floor × hệ
      // số) vì loại đó tự tính lại đúng theo kích thước dự án hiện tại.
      return { id: uid("boq"), projectId: activeProjectId, normId: it.normId, basis: it.basis || "manual", ratio: it.ratio || 0, qty: laManual ? 0 : (it.qty || 0), khoanPrice: it.khoanPrice ?? null, included: true, category: it.category || STANDARD_CATEGORIES[0].id };
    });
    setBoqItems((prev) => [...prev, ...themVao]);
    showToast(`Đã thêm ${themVao.length} đầu việc còn thiếu từ mẫu "${tplName}" vào dự án — khối lượng để 0 (trừ dòng tính theo tham số công trình), BẮT BUỘC kiểm tra bản vẽ rồi nhập khối lượng thật ở thẻ "Điều chỉnh dự toán/khối lượng".`, "warn");
  };
  const xoaDauViecThua = (idsThua) => {
    setBoqItems((prev) => prev.filter((b) => !idsThua.includes(b.id)));
    showToast(`Đã bỏ ${idsThua.length} đầu việc không có trong mẫu.`, "warn");
  };

  const addMaterial = (data, reason) => {
    const id = uid("mat");
    setMaterials((prev) => [...prev, { id, ...data }]);
    setChangeLog((prev) => [{ id: uid("log"), when: new Date().toLocaleString("vi-VN"), who: "QS (chưa đăng nhập)", what: `Thêm vật tư mới: ${data.name} (${data.code})`, reason: reason || "" }, ...prev]);
    return id;
  };

  const addLabor = (data) => {
    const id = uid("lb");
    setLabor((prev) => [...prev, { id, ...data }]);
    return id;
  };

  // ---- Nhà thầu / NCC ----
  const addVendor = (name, contact) => {
    const id = uid("vd");
    setVendors((prev) => [...prev, { id, name, contact }]);
    return id;
  };
  const removeVendor = (id) => {
    if (id === "internal") return; // không xoá được "giá nội bộ"
    setVendors((prev) => prev.filter((v) => v.id !== id));
    setVendorPrices((prev) => { const next = { ...prev }; delete next[id]; return next; });
    if (activeVendorId === id) setActiveVendorId("internal");
    showToast("Đã xoá nhà thầu.");
  };
  const updateVendorPrice = (vendorId, itemId, value) => {
    setVendorPrices((prev) => ({ ...prev, [vendorId]: { ...(prev[vendorId] || {}), [itemId]: value } }));
  };

  const addNorm = (data, scope, reason, imLang) => {
    const id = uid("nm");
    const norm = { id, ...data, scope, projectId: scope === "local" ? activeProjectId : undefined };
    setNorms((prev) => [...prev, norm]);
    setChangeLog((prev) => [{ id: uid("log"), when: new Date().toLocaleString("vi-VN"), who: "QS (chưa đăng nhập)", what: `Thêm định mức ${scope === "master" ? "MASTER" : "LOCAL (riêng dự án)"}: ${data.name} (${data.code})`, reason: reason || "" }, ...prev]);
    if (!imLang) showToast(`Đã thêm định mức "${data.name}" vào ${scope === "master" ? "Master (dùng chung mọi dự án)" : "Local (chỉ riêng dự án này)"}.`);
    return id;
  };

  const addBoqItem = (normId, category) => {
    const id = uid("boq");
    setBoqItems((prev) => [...prev, { id, projectId: activeProjectId, normId, qty: 0, khoanPrice: null, included: true, category: category || STANDARD_CATEGORIES[0].id }]);
  };
  const updateBoqItem = (id, field, value) => {
    if (activeProject?.khoaBoq) { showToast(`Dự án "${activeProject.name}" đang KHOÁ (đã chốt phiên bản) — không sửa được. Mở khoá ở thẻ Dự án nếu thực sự cần sửa.`, "error"); return; }
    const truoc = boqItems.find((b) => b.id === id);
    setBoqItems((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
    // Chỉ ghi log audit cho 2 trường ảnh hưởng trực tiếp tới tiền (khối lượng, giá
    // khoán) — đổi nhóm/cơ sở tính là thao tác kỹ thuật thường xuyên, không cần
    // audit dày như sửa số liệu tính tiền. Không bắt nhập lý do mỗi lần sửa (sẽ
    // làm chậm thao tác) — chỉ ghi lại giá trị cũ/mới để truy vết khi cần.
    if (truoc && (field === "qty" || field === "khoanPrice" || field === "qtyNghiemThu") && truoc[field] !== value) {
      const norm = normsById[truoc.normId];
      const tenTruong = field === "qty" ? "khối lượng" : field === "khoanPrice" ? "giá khoán" : "khối lượng nghiệm thu thực tế";
      setChangeLog((prev) => [{
        id: uid("log"), when: new Date().toLocaleString("vi-VN"), who: authUser?.ten || "QS (chưa đăng nhập)",
        what: `Sửa ${tenTruong} — "${norm?.name || "?"}": ${truoc[field] ?? "(trống)"} → ${value}`,
        reason: "Sửa tay tại thẻ Điều chỉnh dự toán/khối lượng",
      }, ...prev]);
    }
  };
  const removeBoqItem = (id) => {
    if (activeProject?.khoaBoq) { showToast(`Dự án "${activeProject?.name}" đang KHOÁ — không xoá được. Mở khoá ở thẻ Dự án nếu thực sự cần.`, "error"); return; }
    const truoc = boqItems.find((b) => b.id === id);
    setBoqItems((prev) => prev.filter((b) => b.id !== id));
    if (truoc) {
      const norm = normsById[truoc.normId];
      setChangeLog((prev) => [{
        id: uid("log"), when: new Date().toLocaleString("vi-VN"), who: authUser?.ten || "QS (chưa đăng nhập)",
        what: `XOÁ dòng BOQ — "${norm?.name || "?"}" (khối lượng ${truoc.qty} ${norm?.unit || ""})`,
        reason: "Xoá tại thẻ Điều chỉnh dự toán/khối lượng",
      }, ...prev]);
    }
  };
  // THÊM MỚI (theo yêu cầu người dùng): xoá TOÀN BỘ khối lượng BOQ của dự án
  // ĐANG MỞ trong 1 lần — trước đây muốn làm lại từ đầu phải xoá tay từng
  // dòng, hoặc thoát app. Chỉ xoá đúng dự án hiện tại (không đụng dự án khác),
  // và xoá luôn kết quả AI đọc được CHƯA duyệt của dự án này (nếu còn) để
  // tránh tình trạng bản vẽ cũ vẫn "lởn vởn" chờ duyệt sau khi đã xoá BOQ.
  const xoaToanBoBoqDuAn = () => {
    if (activeProject?.khoaBoq) { showToast(`Dự án "${activeProject?.name}" đang KHOÁ — không xoá được. Mở khoá ở thẻ Dự án nếu thực sự cần.`, "error"); return; }
    const soDong = projectBoq.length;
    const soAiChoDuyet = projectAiResults.length;
    if (!soDong && !soAiChoDuyet) { showToast("Dự án này chưa có khối lượng nào để xoá.", "warn"); return; }
    if (!window.confirm(`Xoá TOÀN BỘ ${soDong} dòng khối lượng BOQ${soAiChoDuyet ? ` + ${soAiChoDuyet} dòng AI đang chờ duyệt` : ""} của dự án "${activeProject?.name}"?\n\nKhông thể hoàn tác — chỉ dùng khi thực sự muốn làm lại từ đầu.`)) return;
    setBoqItems((prev) => prev.filter((b) => b.projectId !== activeProjectId));
    setAiResults((prev) => prev.filter((r) => r.projectId !== activeProjectId));
    setChangeLog((prev) => [{
      id: uid("log"), when: new Date().toLocaleString("vi-VN"), who: authUser?.ten || "QS (chưa đăng nhập)",
      what: `XOÁ TOÀN BỘ ${soDong} dòng BOQ của dự án (làm lại từ đầu)`,
      reason: "Xoá hàng loạt tại thẻ Điều chỉnh dự toán/khối lượng",
    }, ...prev]);
    showToast(`Đã xoá toàn bộ ${soDong} dòng khối lượng của dự án "${activeProject?.name}" — có thể đọc bản vẽ mới ngay, không cần thoát app.`, "warn");
  };
  // Tạm loại 1 dòng khỏi tổng/BOQ xuất file mà KHÔNG xoá dữ liệu — ví dụ chỉ báo giá
  // gói Điện + Nước, các mục khác vẫn giữ nguyên số liệu, bật lại tick là tính ngay.
  const toggleBoqItemIncluded = (id) => {
    setBoqItems((prev) => prev.map((b) => (b.id === id ? { ...b, included: b.included === false ? true : false } : b)));
  };

  const updateMaterialPrice = (id, groupId, value) => {
    setMaterials((prev) => prev.map((m) => (m.id === id ? { ...m, prices: { ...m.prices, [groupId]: value } } : m)));
  };
  // Sửa hao hụt vật tư (%) hoặc các trường khác của 1 vật tư — không đụng tới giá theo nhóm
  const updateMaterialField = (id, field, value) => {
    setMaterials((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: value } : m)));
  };
  const updateLaborPrice = (id, groupId, value) => {
    setLabor((prev) => prev.map((l) => (l.id === id ? { ...l, prices: { ...l.prices, [groupId]: value } } : l)));
  };
  // Vật tư/nhân công lên hoặc xuống giá theo thời điểm? Đổi hàng loạt giá đã có sẵn
  // của 1 nhóm công trình trong 1 lần — theo % hoặc đặt thẳng 1 mức giá cố định.
  // Có chụp snapshot trước khi đổi để hoàn tác được lần gần nhất nếu lỡ tay.
  const applyPriceSlide = (mode, value, target, groupId, reason) => {
    let p = null, fixedVal = null;
    if (mode === "pct") {
      p = Number(value);
      if (!p) { showToast("Nhập % trượt giá trước khi áp dụng.", "warn"); return; }
    } else {
      fixedVal = Number(value);
      if (isNaN(fixedVal) || fixedVal < 0) { showToast("Nhập đơn giá hợp lệ trước khi áp dụng.", "warn"); return; }
    }
    const snapshot = {
      materials: materials.map((m) => ({ id: m.id, price: m.prices?.[groupId] })),
      labor: labor.map((l) => ({ id: l.id, price: l.prices?.[groupId] })),
    };
    const factor = p != null ? 1 + p / 100 : null;
    if (target !== "labor") {
      setMaterials((prev) => prev.map((m) => {
        if (mode === "pct") return m.prices?.[groupId] != null ? { ...m, prices: { ...m.prices, [groupId]: Math.round(m.prices[groupId] * factor) } } : m;
        return { ...m, prices: { ...m.prices, [groupId]: fixedVal } };
      }));
    }
    if (target !== "material") {
      setLabor((prev) => prev.map((l) => {
        if (mode === "pct") return l.prices?.[groupId] != null ? { ...l, prices: { ...l.prices, [groupId]: Math.round(l.prices[groupId] * factor) } } : l;
        return { ...l, prices: { ...l.prices, [groupId]: fixedVal } };
      }));
    }
    const groupName = PROJECT_GROUPS.find((g) => g.id === groupId)?.name || groupId;
    const targetLabel = target === "material" ? "vật tư" : target === "labor" ? "nhân công" : "vật tư & nhân công";
    const note = mode === "pct"
      ? `Trượt giá ${p > 0 ? "+" : ""}${p}% cho nhóm "${groupName}" (${targetLabel})${reason ? " — " + reason : ""}`
      : `Đặt giá cố định ${fmt(fixedVal)}đ cho nhóm "${groupName}" (${targetLabel})${reason ? " — " + reason : ""}`;
    setPriceLog((prev) => [{ id: uid("slog"), when: new Date().toLocaleString("vi-VN"), pct: p, target, groupId, note }, ...prev].slice(0, 50));
    setAdjustHistory((prev) => [...prev, { groupId, target, snapshot }].slice(-10));
    showToast(mode === "pct"
      ? `Đã áp dụng trượt giá ${p > 0 ? "+" : ""}${p}% cho ${targetLabel} — nhóm "${groupName}".`
      : `Đã đặt giá cố định ${fmt(fixedVal)}đ cho ${targetLabel} — nhóm "${groupName}".`);
  };
  const undoLastAdjustment = () => {
    if (!adjustHistory.length) return;
    const last = adjustHistory[adjustHistory.length - 1];
    setMaterials((prev) => prev.map((m) => {
      const snap = last.snapshot.materials.find((s) => s.id === m.id);
      return snap ? { ...m, prices: { ...m.prices, [last.groupId]: snap.price } } : m;
    }));
    setLabor((prev) => prev.map((l) => {
      const snap = last.snapshot.labor.find((s) => s.id === l.id);
      return snap ? { ...l, prices: { ...l.prices, [last.groupId]: snap.price } } : l;
    }));
    setAdjustHistory((prev) => prev.slice(0, -1));
    showToast("Đã hoàn tác lần điều chỉnh giá hàng loạt gần nhất.", "warn");
  };
  const removeMaterial = (id) => {
    const used = norms.some((n) => (n.vt || []).some((r) => r.materialId === id));
    if (used) {
      showToast("Vật tư này đang được dùng trong ít nhất 1 định mức — không xoá để tránh làm sai đơn giá phân tích. Sửa định mức trước.", "error");
      return;
    }
    setMaterials((prev) => prev.filter((m) => m.id !== id));
    showToast("Đã xoá vật tư.", "warn");
  };
  const removeLabor = (id) => {
    const used = norms.some((n) => (n.nc || []).some((r) => r.laborId === id) || (n.may || []).some((r) => r.laborId === id));
    if (used) {
      showToast("Nhân công/máy này đang được dùng trong ít nhất 1 định mức — không xoá để tránh làm sai đơn giá phân tích. Sửa định mức trước.", "error");
      return;
    }
    setLabor((prev) => prev.filter((l) => l.id !== id));
    showToast("Đã xoá nhân công/máy.", "warn");
  };

  // ---- Đọc bản vẽ: tạo phiên bản, upload ảnh, phân tích AI, khớp định mức, sinh BOQ ----
  const projectVersions = useMemo(() => drawingVersions.filter((v) => v.projectId === activeProjectId), [drawingVersions, activeProjectId]);
  const projectPhotos = useMemo(() => photos.filter((p) => p.projectId === activeProjectId), [photos, activeProjectId]);
  const projectDrawingFiles = useMemo(() => drawingFiles.filter((f) => f.projectId === activeProjectId), [drawingFiles, activeProjectId]);

  const addDrawingVersion = (label) => {
    const id = uid("ver");
    const autoLabel = label && label.trim() ? label.trim() : `V${projectVersions.length + 1}`;
    setDrawingVersions((prev) => [...prev, { id, projectId: activeProjectId, label: autoLabel, date: new Date().toLocaleString("vi-VN") }]);
    showToast(`Đã tạo phiên bản bản vẽ "${autoLabel}".`);
    return id;
  };

  // Nén/resize ảnh phía trình duyệt TRƯỚC KHI gửi lên server — giảm băng
  // thông + RAM server khi nhiều người dùng cùng lúc. CẨN THẬN: đây là bản vẽ
  // kỹ thuật có chữ số nhỏ (VD "8420") — nén quá tay sẽ làm AI đọc sai số liệu.
  // Chỉ nén khi ảnh THỰC SỰ lớn (>2400px cạnh dài HOẶC >4MB), giữ chất lượng
  // JPEG cao (0.92) để không mất nét chữ. Ảnh vốn đã nhỏ thì giữ nguyên,
  // không nén thêm (tránh giảm chất lượng không cần thiết).
  const NGUONG_CANH_DAI_PX = 2400;
  const NGUONG_DUNG_LUONG_BYTE = 4 * 1024 * 1024;
  function nenAnhNeuCanThiet(file) {
    return new Promise((resolve) => {
      if (!file.type.startsWith("image/") || file.type === "image/gif") { resolve(null); return; } // GIF động không nén qua canvas
      if (file.size <= NGUONG_DUNG_LUONG_BYTE) {
        // Vẫn cần kiểm tra kích thước pixel dù dung lượng nhỏ (ảnh chụp điện
        // thoại độ phân giải cao nhưng nén JPEG sẵn có thể vẫn nhẹ dung lượng)
      }
      const img = new Image();
      const urlTam = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(urlTam);
        // SỬA LỖI THẬT (phát hiện qua audit): trước đây không kiểm tra
        // width/height sau khi load — ảnh trắng/hỏng (0 hoặc gần 0 pixel)
        // vẫn lọt qua, chỉ phát hiện sau khi gọi AI thất bại.
        if (!img.width || !img.height) {
          resolve({ loi: "anh_rong", ten: file.name });
          return;
        }
        const canhDaiNhat = Math.max(img.width, img.height);
        if (canhDaiNhat <= NGUONG_CANH_DAI_PX && file.size <= NGUONG_DUNG_LUONG_BYTE) {
          resolve(null); // ảnh đã đủ nhỏ, không cần nén
          return;
        }
        const tiLe = Math.min(1, NGUONG_CANH_DAI_PX / canhDaiNhat);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * tiLe);
        canvas.height = Math.round(img.height * tiLe);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (!blob) { resolve(null); return; }
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          },
          "image/jpeg",
          0.92
        );
      };
      // SỬA LỖI THẬT (phát hiện qua audit): trước đây onerror chỉ resolve(null)
      // im lặng — file HEIC (iPhone) không nén được, THAM SỐ NULL khiến
      // handlePhotoFiles hiểu nhầm là "không cần nén, dùng nguyên bản", rồi
      // VẪN THÊM file HEIC lỗi vào photos qua FileReader thô — người dùng chỉ
      // biết lỗi sau khi gọi AI thất bại, không có cảnh báo ngay lúc tải lên.
      img.onerror = () => { URL.revokeObjectURL(urlTam); resolve({ loi: "khong_doc_duoc", ten: file.name }); };
      img.src = urlTam;
    });
  }

  const handlePhotoFiles = (fileList, versionId) => {
    const files = Array.from(fileList || []);
    files.forEach(async (f) => {
      const ketQua = await nenAnhNeuCanThiet(f);
      if (ketQua && ketQua.loi) {
        const laHeicNghiNgo = /\.heic$|\.heif$/i.test(f.name) || ketQua.loi === "khong_doc_duoc";
        showToast(
          laHeicNghiNgo
            ? `Ảnh "${f.name}" không đọc được — có thể là định dạng HEIC (mặc định của iPhone). Vào Cài đặt > Camera > Định dạng > chọn "Tương thích nhất" (Most Compatible) trên iPhone, hoặc xuất lại thành JPEG/PNG trước khi tải lên.`
            : `Ảnh "${f.name}" trống/hỏng (kích thước 0) — không thêm vào danh sách. Thử chụp/xuất lại ảnh.`,
          "error"
        );
        return; // KHÔNG thêm ảnh lỗi vào photos
      }
      if (ketQua) {
        setPhotos((prev) => [...prev, { id: uid("ph"), projectId: activeProjectId, versionId, dataUrl: ketQua, name: f.name }]);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setPhotos((prev) => [...prev, { id: uid("ph"), projectId: activeProjectId, versionId, dataUrl: reader.result, name: f.name }]);
      };
      reader.readAsDataURL(f);
    });
  };

  const handleDrawingFiles = (fileList, versionId) => {
    const files = Array.from(fileList || []);
    files.forEach((f) => {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      if (ext !== "pdf") {
        showToast(`"${f.name}" không phải file PDF — chỉ hỗ trợ tải lên PDF ở đây.`, "warn");
        return;
      }
      const url = URL.createObjectURL(f);
      setDrawingFiles((prev) => [...prev, { id: uid("pdf"), projectId: activeProjectId, versionId, name: f.name, size: f.size, url, file: f }]);
      showToast(`Đã tải "${f.name}" — xem trước bên dưới, bấm "Bắt đầu đọc AI" trên file để chuyển từng trang thành ảnh và cho AI đọc số liệu.`);
    });
  };

  const removeDrawingFile = (id) => {
    setDrawingFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f && f.url) URL.revokeObjectURL(f.url);
      return prev.filter((x) => x.id !== id);
    });
  };

  // Xoá ảnh đã tải lên — dùng khi lỡ chọn nhầm ảnh không phải bản vẽ.
  // Xoá luôn cả kết quả AI đã đọc từ ảnh đó để không còn dấu vết trong BOQ.
  const removePhoto = (id) => {
    setPhotos((prev) => {
      const p = prev.find((x) => x.id === id);
      if (p) setAiResults((r) => r.filter((x) => x.sourcePhoto !== p.name));
      return prev.filter((x) => x.id !== id);
    });
    showToast("Đã xoá ảnh khỏi phiên bản này.", "warn");
  };
  const removeAllPhotos = (versionId) => {
    setPhotos((prev) => {
      const bo = prev.filter((p) => p.projectId === activeProjectId && p.versionId === versionId);
      const ten = new Set(bo.map((p) => p.name));
      if (ten.size) setAiResults((r) => r.filter((x) => !ten.has(x.sourcePhoto)));
      return prev.filter((p) => !(p.projectId === activeProjectId && p.versionId === versionId));
    });
    showToast("Đã xoá toàn bộ ảnh của phiên bản này.", "warn");
  };

  const [pdfAiAnalyzing, setPdfAiAnalyzing] = useState(null); // id file PDF đang xử lý
  const [pdfAiProgress, setPdfAiProgress] = useState(0); // % tiến độ hiển thị cho người dùng
  // THÊM MỚI (theo yêu cầu chú: "không biết thật sự có đang chạy hay không"):
  // mốc thời gian bắt đầu đọc — dùng để hiển thị đồng hồ đếm giờ THẬT (giây
  // nhảy số liên tục), khác hẳn % tiến độ (có thể đứng yên lâu khi AI đang
  // suy luận sâu — nay đã bật thinking — nhưng đồng hồ giây vẫn nhảy đều, cho
  // thấy rõ trình duyệt vẫn còn sống và đang thực sự chờ, không phải treo).
  const [pdfAiStartedAt, setPdfAiStartedAt] = useState(null);
  const [dongHoGiay, setDongHoGiay] = useState(0);
  useEffect(() => {
    if (!pdfAiStartedAt) { setDongHoGiay(0); return; }
    const t = setInterval(() => setDongHoGiay(Math.floor((Date.now() - pdfAiStartedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [pdfAiStartedAt]);

  // Gửi thẳng file PDF cho AI đọc (Claude đọc PDF trực tiếp, không cần thư viện
  // ngoài / CDN nào cả — tránh lỗi mạng khi tải pdf.js). AI đọc toàn bộ các trang
  // trong 1 lượt gọi, tự tìm bảng khối lượng/thống kê rồi trích xuất hạng mục.
  // ============================================================================
  // ĐỌC FILE DXF THẬT — KHÔNG DÙNG AI, đọc thẳng toạ độ chính xác từ file CAD
  // (giải pháp cho mục 1/3/5 khi có file DXF thay vì chỉ có ảnh/PDF). Gom theo
  // layer, tính chiều dài (LINE/polyline hở) hoặc diện tích+chu vi (polyline
  // khép kín) bằng công thức Shoelace chuẩn — đã kiểm chứng đúng bằng test
  // riêng trước khi viết vào đây. Đơn vị bản vẽ thường là mm — có ô cho QS chọn
  // lại hệ số quy đổi vì không phải file DXF nào cũng khai đúng $INSUNITS.
  // dienTichDaGiac/chuViDaGiac ĐÃ CHUYỂN sang dxf-worker-src.js (Web Worker) —
  // không còn dùng ở đây, xoá để tránh code chết.

  const docFileDxf = async (file, heSoQuyDoi, chieuCaoTuong, soMatToSon) => {
    // Đọc file DXF trong WEB WORKER (luồng riêng) — file lớn (hàng chục nghìn
    // entity) sẽ KHÔNG làm màn hình bị khựng/giật trong lúc xử lý, vì phần
    // tính toán nặng chạy tách biệt khỏi luồng giao diện chính. Worker không
    // truy cập được React state — chỉ nhận text file + tham số, trả về mảng
    // items thuần qua postMessage, rồi MỚI cập nhật state ở đây (main thread).
    try {
      const text = await file.text();
      const ketQua = await new Promise((resolve, reject) => {
        const worker = new Worker("/dxf-worker.js");
        const timer = setTimeout(() => { worker.terminate(); reject(new Error("Worker đọc DXF quá lâu (>60s) — file có thể quá lớn hoặc phức tạp bất thường.")); }, 60000);
        worker.onmessage = (e) => { clearTimeout(timer); worker.terminate(); e.data.ok ? resolve(e.data) : reject(new Error(e.data.error)); };
        worker.onerror = (err) => { clearTimeout(timer); worker.terminate(); reject(new Error(err.message || "Lỗi worker không rõ.")); };
        worker.postMessage({ text, heSoQuyDoi, chieuCaoTuong, soMatToSon, tenFile: file.name });
      });

      if (!ketQua.items.length) {
        showToast(ketQua.thongBao || `File "${file.name}" không đọc được entity nào.`, ketQua.loaiThongBao || "error");
        return;
      }
      setAiResults((prev) => [...prev, ...ganhDauNghiTrung(ketQua.items)]);
      if (ketQua.thongBao) showToast(ketQua.thongBao, ketQua.loaiThongBao || "ok");
    } catch (e) {
      showToast(`Lỗi đọc file DXF: ${e.message}. Có thể file bị lỗi hoặc chứa entity chưa hỗ trợ.`, "error");
    }
  };

  // THÊM MỚI (theo yêu cầu chú: app không phụ thuộc việc web bị cắt giữa
  // chừng khi chờ lâu không thao tác) — tách vòng lặp poll thành hàm DÙNG
  // CHUNG, chỉ cần jobId (không phụ thuộc file cụ thể nào) — dùng được cho cả
  // lần đọc mới VÀ lúc tự động nối lại theo dõi 1 job cũ bị bỏ dở (xem
  // useEffect khôi phục bên dưới). Trả về kết quả cuối; ném lỗi nếu quá hạn.
  const theoDoiJobToiKhiXong = async (jobId, onTienDo) => {
    let trangThaiTong = "dang_chay";
    let soVongCho = 0;
    while (trangThaiTong === "dang_chay" && soVongCho < 2400) { // tối đa ~2400×3s = 120 phút chờ
      await new Promise((r) => setTimeout(r, 3000));
      soVongCho++;
      let resStatus;
      try {
        resStatus = await fetchCoTimeout(`${BACKEND_URL}/api/jobs/${jobId}/status`, { headers: { "x-user-id": getUserId(), ...authHeaders() } }, 15000);
      } catch (e) { continue; }
      const dataStatus = await resStatus.json().catch(() => null);
      if (!dataStatus) continue;
      trangThaiTong = dataStatus.trangThaiTong;
      if (onTienDo) onTienDo(dataStatus);
    }
    if (trangThaiTong === "dang_chay") throw new Error("PDF lớn xử lý quá lâu (>120 phút) — có thể server đang quá tải hoặc file quá nhiều trang, thử tách nhỏ file rồi đọc từng phần.");
    const resResult = await fetchCoTimeout(`${BACKEND_URL}/api/jobs/${jobId}/result`, { headers: { "x-user-id": getUserId(), ...authHeaders() } }, 20000);
    const dataResult = await resResult.json().catch(() => null);
    if (!resResult.ok || !dataResult) throw new Error(dataResult?.error || "Không lấy được kết quả job PDF lớn.");
    return dataResult;
  };

  const analyzePdfAI = async (pdfEntry, ghiChuThem) => {
    // Trần THẬT của Anthropic API là 32MB cho TOÀN BỘ dữ liệu request — nhưng dữ
    // liệu phải mã hoá base64 trước khi gửi, làm phình to thêm ~33%. Giới hạn file
    // GỐC dưới đây đã tính trừ hao phần phình đó + chừa dư cho phần JSON/prompt,
    // để không bao giờ vượt trần thật (nguồn: platform.claude.com/docs — Vision).
    const HARD_MAX = 40 * 1024 * 1024; // SỬA LỖI THẬT: tăng từ 22MB — giờ đã có Files API (server tự upload file lớn, né trần 32MB của Anthropic) + express.json đã tăng lên 60mb, 22MB cũ là điểm nghẽn không cần thiết nữa. 40MB base64 hoá ~54.8MB, an toàn dưới trần 60mb.
    const SOFT_MAX = 10 * 1024 * 1024; // trên mức này chỉ cảnh báo, vẫn cho gửi bình thường
    if (pdfEntry.size > HARD_MAX) {
      const maxMB = Math.round(HARD_MAX / 1e6);
      const msg = `File "${pdfEntry.name}" nặng ${(pdfEntry.size / 1e6).toFixed(1)} MB — vượt giới hạn ${maxMB}MB hiện tại của app. Cách xử lý: (1) tách PDF thành các phần nhỏ hơn (mỗi phần vài trang), đọc từng phần rồi gộp kết quả; hoặc (2) giảm chất lượng quét/DPI khi xuất PDF — file nặng hơn do quét độ phân giải quá cao KHÔNG giúp AI đọc chính xác hơn, vì hệ thống tự chuẩn hoá ảnh về độ phân giải chuẩn trước khi đọc bất kể file gốc nặng nhẹ.`;
      setAiError(msg);
      showToast(msg, "error");
      return;
    }
    if (pdfEntry.size > SOFT_MAX) {
      showToast(`File nặng ${(pdfEntry.size / 1e6).toFixed(1)} MB — AI có thể mất lâu hơn bình thường để đọc hết, chờ chút nhé. Nếu lỗi mạng giữa chừng, thử nén nhỏ lại hoặc tách bớt trang rồi gửi lại.`, "warn");
    }
    setPdfAiAnalyzing(pdfEntry.id);
    setPdfAiStartedAt(Date.now());
    setAiError(null);
    setPdfAiProgress(2);
    const tick = setInterval(() => {
      setPdfAiProgress((p) => (p < 90 ? p + Math.max(1, Math.round((90 - p) * 0.1)) : p));
    }, 350);
    try {
      if (!(pdfEntry.file instanceof Blob) || pdfEntry.file.size === 0) {
        throw new Error('Không lấy được dữ liệu gốc của file PDF này (có thể do đổi thẻ/tải lại trang làm mất dữ liệu tạm). Hãy bấm nút "Chọn file PDF" và tải LẠI đúng file đó lên (không dùng file đã có sẵn trong danh sách cũ), rồi bấm "Bắt đầu đọc AI" ngay sau khi tải xong.');
      }
      // SỬA LỖI THẬT (nghi vấn cao nhất cho triệu chứng "im lặng hoàn toàn,
      // không log gì" trên di động): TRƯỚC ĐÂY dùng FileReader.readAsDataURL
      // để tự mã hoá base64 NGAY TRONG TRÌNH DUYỆT trước khi gửi — với file
      // vài MB, giữ cùng lúc 2-3 bản sao trong RAM (base64 + JSON bọc quanh +
      // bản đang chờ gửi) — điện thoại RAM thấp có thể ÂM THẦM giết/tải lại
      // tab NGAY TẠI BƯỚC NÀY, trước khi có bất kỳ request nào rời khỏi máy —
      // khớp đúng "log không ghi nhận gì" (Render không thấy vì chưa từng có
      // request tới). Giờ gửi THẲNG file gốc dạng nhị phân — trình duyệt
      // không tự mã hoá gì cả, server (RAM dồi dào hơn nhiều) mới là nơi mã
      // hoá base64.
      let parsed;
      let modelDaDung = null; // model AI đã dùng để đọc — truy vết sau này (mục 25 Versioning)
      // Gọi 1 LẦN, giữ lại cả .danhSach (gửi AI) VÀ .tenToNormId (dùng khớp
      // chính xác sau khi AI trả kết quả, xem khopTheoLienKetMau bên dưới) —
      // trước đây chỉ lấy .danhSach rồi bỏ, mất luôn liên kết QS đã gắn sẵn.
      const mauChuanPdf = await layDanhSachChuanTuBackend();

      if (BACKEND_URL) {
        // ---- Chế độ backend riêng (ổn định — dùng khi đã có hosting) ----
        let response;
        try {
          // Bước 1/2: gửi phần dữ liệu NHỎ (JSON metadata) trước, nhận uploadId.
          const initRes = await fetchCoTimeout(`${BACKEND_URL}/api/analyze-file/init`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-user-id": getUserId(), ...authHeaders() },
            body: JSON.stringify({ ghiChuThem, name: pdfEntry.name, danhSachChuan: mauChuanPdf.danhSach, tenCam: activeProject?.tenCam, tenUuTien: activeProject?.tenUuTien, duToanMauThamChieu: layDuToanMauThamChieu(activeProject) }),
          }, 15000);
          const initData = await initRes.json().catch(() => null);
          if (!initRes.ok || !initData?.uploadId) throw new Error(initData?.error || `Không khởi tạo được lượt upload (HTTP ${initRes.status})`);
          // Bước 2/2: gửi THẲNG byte file gốc — không qua FileReader/base64.
          // Timeout dài hơn hẳn bước 1 vì đây là bước truyền dữ liệu nặng thật,
          // co giãn theo dung lượng file (mạng di động chậm cần thêm thời gian).
          const timeoutTaiLen = Math.max(30000, Math.round(pdfEntry.file.size / (150 * 1024)) * 1000); // ước lượng ~150KB/s tối thiểu, sàn 30s
          response = await fetchCoTimeout(`${BACKEND_URL}/api/analyze-file/${initData.uploadId}`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream", "x-user-id": getUserId(), ...authHeaders() },
            body: pdfEntry.file,
          }, timeoutTaiLen);
        } catch (netErr) {
          throw new Error(`Không gọi được backend riêng (${netErr.message}). Kiểm tra lại địa chỉ BACKEND_URL trong code và server có đang chạy không.`);
        }
        let data;
        try { data = await response.json(); } catch (e) { throw new Error(response.status === 413 ? 'File quá nặng, bị máy chủ từ chối trước khi tới AI đọc — thử file nhỏ hơn hoặc tách bớt trang.' : `Backend trả về dữ liệu không hợp lệ (HTTP ${response.status})`); }
        if (!response.ok) throw new Error(data?.error || `Lỗi HTTP ${response.status} từ backend`);
        // SỬA LỖI THẬT (phát hiện qua chẩn đoán triệu chứng người dùng — PDF lớn
        // trả về jobId thay vì items trực tiếp, nhưng trước đây KHÔNG CÓ code
        // nào chờ/đọc kết quả job — người dùng thấy "0 hạng mục" im lặng, không
        // báo lỗi gì). Giờ tự động chờ job xong bằng cách hỏi lại định kỳ.
        if (data.jobId && !Array.isArray(data.items)) {
          setLastRawDebug(data.ghiChu || `PDF lớn (${data.tongSoTrang} trang) — đang xử lý nền, vui lòng đợi...`);
          const jobId = data.jobId;
          // SỬA LỖI THẬT (nguyên nhân khả năng cao của tiền mất mà không ra kết
          // quả): jobId trước đây CHỈ tồn tại trong biến tạm — nếu chú refresh/
          // đóng tab giữa lúc đang chờ (đã làm nhiều lần khi debug), job vẫn
          // CHẠY NGẦM TRÊN SERVER (không bị huỷ, tốn tiền AI thật), nhưng KHÔNG
          // AI CÒN THEO DÕI ĐƯỢC KẾT QUẢ nữa — bấm đọc lại sẽ tạo job MỚI, cả 2
          // job cùng tốn tiền. Lưu jobId vào localStorage để có thể phát hiện.
          try { localStorage.setItem("qs_job_dang_cho", JSON.stringify({ jobId, tenFile: pdfEntry.name, projectId: activeProjectId, luc: Date.now() })); } catch (e) {}
          let dataResult;
          try {
            dataResult = await theoDoiJobToiKhiXong(jobId, (dataStatus) => {
              setAiProgress(Math.min(95, dataStatus.phanTramXong || 0));
              setLastRawDebug(`PDF lớn — đang xử lý nền: ${dataStatus.soLoXong}/${dataStatus.tongSoLo} phần xong (${dataStatus.phanTramXong}%)${dataStatus.soLoLoi ? `, ${dataStatus.soLoLoi} phần lỗi` : ""}.`);
            });
          } finally {
            try { localStorage.removeItem("qs_job_dang_cho"); } catch (e) {} // xong (dù đúng hạn, lỗi, hay hết 120 phút) — xoá dấu vết chờ
          }
          data = dataResult; // dùng kết quả thật thay cho response ban đầu (chỉ có jobId)
          // SỬA LỖI THẬT (phát hiện khi thêm hiển thị chi phí): dataResult chỉ có
          // tongChiPhiUsd (số thô, từ job PDF/ảnh nền) — KHÁC với "cost: {usd,vnd}"
          // mà các đường phân tích trực tiếp trả về. Gọi ghiNhanChiPhi(data.cost) ở
          // dòng dưới với data=dataResult sẽ luôn là undefined (bị chặn ngay bởi
          // "if (!cost) return"), khiến chi phí đọc PDF/qua job nền CHƯA TỪNG được
          // ghi nhận dù hàm đã được gọi. Gắn thêm field "cost" đúng định dạng ngay
          // tại đây để dòng ghiNhanChiPhi(data.cost) phía dưới hoạt động đúng.
          if (Number.isFinite(dataResult.tongChiPhiUsd)) data.cost = { usd: dataResult.tongChiPhiUsd, vnd: Math.round(dataResult.tongChiPhiUsd * 26000) };
        }
        const parsedTho = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
        parsed = parsedTho.filter((it) => !it?.laCanhBao);
        const canhBaoDoiChieu1 = parsedTho.filter((it) => it?.laCanhBao);
        if (typeof console !== "undefined") console.log("[AI doc] backend tra ve:", data, "-> so hang muc:", parsed.length);
        setLastRawDebug(`Backend tra ve ${parsed.length} hang muc.` + (parsed.length===0 ? " Chi tiet: " + JSON.stringify(data).slice(0,400) : "") + (canhBaoDoiChieu1.length ? ` ⚠ ${canhBaoDoiChieu1.length} cảnh báo đối chiếu chéo mã hiệu (xem chi tiết dưới BOQ).` : ""));
        setLastPipelineTrace(data.pipelineTrace || null);
        setLastDrawingModel(data.drawingModel || null);
        ghiNhanChiPhi(data.cost);
        modelDaDung = data.model || null;
      } else {
        // ---- Chế độ tạm của Claude.ai (mượn quyền gọi AI trong khung xem trước) ----
        let response;
        try {
          response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: 2000,
              messages: [{
                role: "user",
                content: [
                  { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
                  { type: "text", text: 'Đây là file PDF bản vẽ/bảng thống kê xây dựng, có thể nhiều trang. Đọc toàn bộ các trang, tìm bảng khối lượng, bảng thống kê thép, bảng kích thước cấu kiện, hoặc ghi chú đủ để ước tính khối lượng thi công, rồi trích xuất thành danh sách hạng mục. Nếu không có trang nào đủ số liệu để bóc khối lượng, trả về mảng rỗng []. Chỉ trả lời bằng JSON thuần, không giải thích, đúng định dạng: [{"name":"tên hạng mục ngắn gọn","unit":"đơn vị","qty":số,"note":"cơ sở/giả định khi đọc, ghi rõ đọc từ trang nào nếu biết"}]' },
                ],
              }],
            }),
          });
        } catch (netErr) {
          throw new Error(`Gửi file thất bại do lỗi mạng/kết nối (${netErr.message}). Thử: kiểm tra lại wifi/4G, đóng mở lại app, hoặc thử file nhỏ hơn/ít trang hơn rồi bấm lại.`);
        }
        let data;
        try { data = await response.json(); } catch (e) { throw new Error(`Máy chủ trả về dữ liệu không hợp lệ (HTTP ${response.status})`); }
        if (!response.ok) throw new Error(data?.error?.message || `Lỗi HTTP ${response.status}`);
        if (data?.error) throw new Error(data.error.message || "Lỗi không xác định từ API");
        if (!Array.isArray(data?.content)) throw new Error("Phản hồi API không đúng định dạng mong đợi");
        const text = data.content.map((b) => b.text || "").join("");
        if (!text.trim()) throw new Error("AI không trả về nội dung văn bản nào");
        const clean = text.replace(/```json|```/g, "").trim();
        try { parsed = JSON.parse(clean); } catch (e) { throw new Error("Không đọc được kết quả AI dưới dạng JSON — thử lại hoặc dùng file khác"); }
      }

      if (Array.isArray(parsed) && parsed.length) {
        const withMatch = parsed.map((p) => {
          // Ưu tiên TUYỆT ĐỐI: nếu tên AI trả về khớp NGUYÊN VĂN 1 dòng trong
          // mẫu đã được QS gắn sẵn normId (TemplateEditorPanel) -> dùng thẳng,
          // KHÔNG qua khớp mờ (score=1, đã được QS xác nhận trước, không phải
          // thuật toán suy đoán). Chỉ khi không có liên kết mới rơi về khớp mờ.
          const normIdTheoMau = khopTheoLienKetMau(p.name || "", mauChuanPdf.tenToNormId);
          const match = normIdTheoMau
            ? { normId: normIdTheoMau, score: 1, goiYNormId: normIdTheoMau, tuXacNhan: true, lyDoKhongTuXacNhan: "" }
            : timDinhMucPhuHopDaTieuChi(p.name || "", p.unit || "", activeProject?.groupId || "", projectNorms);
          return {
            key: uid("air"), projectId: activeProjectId,
            name: p.name || "Hạng mục chưa đặt tên",
            unit: p.unit || "",
            qty: Number(p.qty) || 0,
            note: p.note || "",
            category: NHOM_TU_AI[p.group] || "cat-hoanthien",
            sourcePhoto: pdfEntry.name,
            matchedNormId: match.normId,
            matchScore: match.score,
            goiYNormId: match.goiYNormId,
            lyDoKhongTuXacNhan: match.lyDoKhongTuXacNhan,
            model: modelDaDung,
          };
        });
        const moiDoc0 = ganhDauNghiTrung(withMatch);
        setAiResults((prev) => [...prev, ...moiDoc0]);
        // SỬA THEO YÊU CẦU: tự động đưa thẳng vào BOQ ngay sau khi đọc xong —
        // bỏ hẳn bước phải bấm "Duyệt tất cả" tay, giống hệt cách chat Claude
        // thường (gửi bản vẽ + mẫu, nhận thẳng kết quả cuối, không có bước
        // duyệt tay ở giữa).
        apDungDanhSachVaoBoq(moiDoc0);
        showToast(`AI đọc được ${parsed.length} hạng mục từ "${pdfEntry.name}"${ghiChuThem ? " (đã đọc theo yêu cầu bổ sung)" : ""} — đã tự động thêm vào BOQ, kiểm tra lại khối lượng/giá ở thẻ "Điều chỉnh dự toán/khối lượng".`, "warn");
      } else {
        showToast(`File "${pdfEntry.name}" không có bảng số liệu rõ ràng để AI đọc khối lượng.`, "warn");
      }
      setPdfAiProgress(100);
    } catch (e) {
      setAiError(e.message);
      showToast(`Lỗi đọc PDF bằng AI: ${e.message}`, "error");
    } finally {
      clearInterval(tick);
      setPdfAiAnalyzing(null);
      setPdfAiStartedAt(null);
      setTimeout(() => setPdfAiProgress(0), 700);
    }
  };

  // ============================================================================
  // NHẬP TOÀN BỘ MẪU DỰ TOÁN THẬT từ file BOQ nhiều sheet (VD: file S6-38 27 sheet)
  // ----------------------------------------------------------------------------
  // Khác với handlePriceImportFile bên dưới (chỉ đọc đơn giá vật tư/nhân công lẻ):
  // hàm này đọc CẢ BỘ dự toán — quét mọi sheet tên "BOQ_V*", tự tìm dòng tiêu đề
  // (không cố định ở dòng 1), map cột theo TÊN (không theo vị trí, vì số cột thay
  // đổi giữa các sheet), bỏ đúng dòng nhóm (STT là chữ A/B/C) và dòng "TỔNG CỘNG"
  // (STT rỗng) — chỉ giữ dòng hạng mục thật (STT là số). Mỗi dòng tạo 1 định mức
  // MASTER (dùng chung mọi dự án cùng nhóm công trình) với giá khoán = đúng đơn
  // giá thật trong file — không bịa giá. Đã test bằng file S6-38 thật: 175/175
  // dòng đọc đúng khớp Cost Code, ĐVT, Khối lượng, Đơn giá.
  // ============================================================================
  const timDongTieuDeBoq = (rows) => {
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const hang = (rows[r] || []).map((v) => String(v || "").trim());
      const coDonGia = hang.some((v) => /đơn\s*giá/i.test(v));
      const coDVT = hang.some((v) => /đvt|đơn\s*vị/i.test(v));
      if (coDonGia && coDVT) return r;
    }
    return -1;
  };
  const mapCotBoq = (headerRow) => {
    const idx = {};
    (headerRow || []).forEach((v, i) => {
      const t = String(v || "").trim().toLowerCase();
      if (/^stt/.test(t)) idx.stt = i;
      else if (/cost\s*code/.test(t)) idx.costCode = i;
      else if (/mô\s*tả/.test(t)) idx.mota = i;
      else if (/đvt|đơn\s*vị/.test(t)) idx.dvt = i;
      else if (/khối\s*lượng/.test(t)) idx.qty = i;
      else if (/đơn\s*giá/.test(t)) idx.gia = i;
      else if (/spec/.test(t)) idx.spec = i;
      else if (/ghi\s*chú/.test(t)) idx.ghichu = i;
    });
    return idx;
  };
  const NHOM_TU_PREFIX_COSTCODE = {
    STR: "cat-khung", PRE: "cat-mong", MAS: "cat-hoanthien", FIN: "cat-hoanthien", FUR: "cat-hoanthien",
    ELE: "cat-mep", PLB: "cat-mep", MEP: "cat-mep", HVAC: "cat-mep", SAN: "cat-mep", PCCC: "cat-mep", TM: "cat-mep",
  };
  const parseBoqTemplateFile = (rows_by_sheet) => {
    const ketQua = [];
    const baoCao = [];
    rows_by_sheet.forEach(({ sheetName, rows }) => {
      if (!/^BOQ_V/i.test(sheetName)) return;
      const hr = timDongTieuDeBoq(rows);
      if (hr === -1) { baoCao.push({ sheet: sheetName, ok: false, dem: 0 }); return; }
      const idx = mapCotBoq(rows[hr]);
      if (idx.mota == null || idx.gia == null) { baoCao.push({ sheet: sheetName, ok: false, dem: 0 }); return; }
      let dem = 0;
      for (let r = hr + 1; r < rows.length; r++) {
        const row = rows[r];
        // Dừng hẳn khi gặp dòng "TỔNG CỘNG" hoặc bảng "đọc số tiền thành chữ" (luôn
        // nằm SAU bảng hạng mục thật trong file BOQ chuẩn) — nếu không dừng, các
        // dòng số lẻ tẻ của bảng đọc chữ (VD cột STT phụ 1,2,3...) sẽ lọt qua bộ lọc
        // STT-là-số và bị hiểu nhầm thành hạng mục thật (đã phát hiện qua kiểm tra
        // chéo với 1 bộ code khác, cùng file thật — lỗi có thật, không phải giả định).
        const rowText = row.map((c) => String(c || "").toLowerCase()).join(" ");
        if (/tổng cộng|số cần đọc|đọc thành tiền/.test(rowText)) break;
        const stt = row[idx.stt];
        const mota = row[idx.mota];
        if (typeof stt !== "number" || !mota) continue; // bỏ dòng nhóm (chữ) + dòng tổng cộng (rỗng)
        const costCode = String(row[idx.costCode] || "").trim();
        const prefix = costCode.split("-")[0];
        ketQua.push({
          sheet: sheetName, costCode, name: String(mota).trim(),
          unit: String(row[idx.dvt] || "").trim() || "-",
          qty: Number(row[idx.qty]) || 0, price: Number(row[idx.gia]) || 0,
          spec: row[idx.spec] || "", note: row[idx.ghichu] || "",
          category: NHOM_TU_PREFIX_COSTCODE[prefix] || "cat-hoanthien",
        });
        dem++;
      }
      baoCao.push({ sheet: sheetName, ok: true, dem });
    });
    return { ketQua, baoCao };
  };

  const [boqTplImportResults, setBoqTplImportResults] = useState(null); // {items, baoCao, fileName}
  const handleBoqTemplateImportFile = async (file) => {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) { showToast(`"${file.name}" không phải file Excel.`, "warn"); return; }
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const rows_by_sheet = wb.SheetNames.map((sheetName) => ({ sheetName, rows: XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" }) }));
      const { ketQua, baoCao } = parseBoqTemplateFile(rows_by_sheet);
      setBoqTplImportResults({ items: ketQua, baoCao, fileName: file.name });
      if (ketQua.length) {
        showToast(`Đã quét ${rows_by_sheet.length} sheet trong "${file.name}" — đọc được ${ketQua.length} dòng hạng mục thật (có Cost Code, khối lượng, đơn giá). Kiểm tra bên dưới rồi đặt tên + tạo mẫu.`);
      } else {
        showToast(`Không tìm thấy sheet nào tên "BOQ_V*" có cấu trúc hợp lệ trong "${file.name}".`, "warn");
      }
    } catch (e) {
      showToast(`Lỗi đọc file "${file.name}": ${e.message}`, "error");
    }
  };

  const taoMauTuFileImport = (tenMau, groupId) => {
    if (!boqTplImportResults || !boqTplImportResults.items.length) return;
    if (!tenMau.trim()) { showToast("Cần đặt tên cho mẫu trước khi tạo.", "warn"); return; }
    if (boqTemplates[tenMau]) { showToast(`Đã có mẫu tên "${tenMau}" — đặt tên khác.`, "warn"); return; }
    const templateItems = boqTplImportResults.items.map((it) => {
      const normId = addNorm(
        { code: it.costCode || uid("TPL").toUpperCase(), name: it.name, unit: it.unit, standard: it.spec || "", groups: [groupId], vt: [], nc: [], may: [] },
        "master",
        `Nhập từ file mẫu "${boqTplImportResults.fileName}" (sheet ${it.sheet}) — giá khoán lấy đúng đơn giá thật trong file, ghi chú gốc: ${it.note || "(không có)"}`,
        true
      );
      return { normId, basis: "manual", ratio: 0, qty: it.qty, category: it.category, khoanPrice: it.price };
    });
    setBoqTemplates((prev) => ({ ...prev, [tenMau]: { groupId, dims: {}, items: templateItems } }));
    setBoqTplImportResults(null);
    showToast(`Đã tạo mẫu "${tenMau}" với ${templateItems.length} đầu việc thật (giá khoán đúng file gốc). Vào thẻ Dự án, gắn mẫu này cho dự án cùng nhóm để AI đọc bám theo.`);
  };

  const huyBoqTplImport = () => setBoqTplImportResults(null);

  const handlePriceImportFile = async (file, kind) => {
    if (!file) return;
    const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
    const isCsv = /\.csv$/i.test(file.name);
    if (!isXlsx && !isCsv) {
      showToast(`"${file.name}" không phải file Excel/CSV.`, "warn");
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const rows_by_sheet = wb.SheetNames.map((sheetName) => ({
        sheetName,
        rows: XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" }),
      }));
      const existingList = kind === "material" ? materials : labor;
      const { results, sheetReport } = parsePriceFile(rows_by_sheet, kind, existingList);
      setPriceImportResults(results);
      setPriceImportReport({ fileName: file.name, sheetReport, total: wb.SheetNames.length });
      setImportBatch([]); // file mới — reset lịch sử hoàn tác của lần nhập trước
      if (results.length) {
        const okSheets = sheetReport.filter((s) => s.count > 0);
        showToast(`Đã quét ${wb.SheetNames.length} sheet trong "${file.name}" — đọc được ${results.length} dòng đơn giá từ sheet: ${okSheets.map((s) => s.name).join(", ")}. Kiểm tra khớp bên dưới rồi áp dụng — nếu nhầm file, bấm "Huỷ, xoá kết quả này".`);
      } else {
        showToast(`Đã quét ${wb.SheetNames.length} sheet trong "${file.name}" nhưng không nhận diện được bảng đơn giá nào (cần cột "Tên ${kind === "material" ? "vật tư" : "nhân công"}" và "Đơn giá").`, "warn");
      }
    } catch (e) {
      showToast(`Lỗi đọc file "${file.name}": ${e.message}`, "error");
    }
  };

  // ---- Huỷ toàn bộ kết quả đang chờ (upload nhầm file, chưa áp dụng gì) ----
  const cancelPriceImport = () => {
    setPriceImportResults([]);
    setPriceImportReport(null);
    showToast("Đã huỷ kết quả file vừa tải lên — chưa có gì được áp dụng.", "warn");
  };

  // ---- Bỏ qua 1 dòng cụ thể, không áp dụng ----
  const skipPriceImportRow = (key) => {
    setPriceImportResults((prev) => prev.filter((x) => x.key !== key));
  };

  const applyPriceImportRow = (key, action, targetId) => {
    const r = priceImportResults.find((x) => x.key === key);
    if (!r) return;
    const gid = priceImportGroupId;
    if (priceImportKind === "material") {
      if (action === "update" && targetId) {
        const prev = materials.find((m) => m.id === targetId);
        const prevPrice = prev?.prices?.[gid];
        setMaterials((p) => p.map((m) => (m.id === targetId ? { ...m, prices: { ...m.prices, [gid]: r.price } } : m)));
        setImportBatch((b) => [...b, { type: "update", kind: "material", id: targetId, groupId: gid, prevPrice }]);
        showToast(`Đã cập nhật đơn giá "${prev?.name}" (nhóm ${PROJECT_GROUPS.find((g) => g.id === gid)?.name}) = ${fmt(r.price)}đ.`);
      } else if (action === "create") {
        const newId = addMaterial({ code: r.code || uid("mat").toUpperCase(), name: r.name, spec: "", unit: r.unit || "-", prices: { [gid]: r.price }, supplier: "", coCq: false }, `Nhập từ file dự toán mẫu`);
        setImportBatch((b) => [...b, { type: "create", kind: "material", id: newId }]);
      }
    } else {
      if (action === "update" && targetId) {
        const prev = labor.find((l) => l.id === targetId);
        const prevPrice = prev?.prices?.[gid];
        setLabor((p) => p.map((l) => (l.id === targetId ? { ...l, prices: { ...l.prices, [gid]: r.price } } : l)));
        setImportBatch((b) => [...b, { type: "update", kind: "labor", id: targetId, groupId: gid, prevPrice }]);
        showToast(`Đã cập nhật đơn giá "${prev?.name}" (nhóm ${PROJECT_GROUPS.find((g) => g.id === gid)?.name}) = ${fmt(r.price)}đ.`);
      } else if (action === "create") {
        const newId = addLabor({ name: r.name, region: "-", prices: { [gid]: r.price }, unit: r.unit || "công" });
        setImportBatch((b) => [...b, { type: "create", kind: "labor", id: newId }]);
        showToast(`Đã thêm nhân công mới "${r.name}".`);
      }
    }
    setPriceImportResults((prev) => prev.filter((x) => x.key !== key));
  };

  const applyAllPriceImport = () => {
    let count = 0;
    priceImportResults.forEach((r) => {
      if (r.matchedId) {
        applyPriceImportRow(r.key, "update", r.matchedId);
      } else {
        applyPriceImportRow(r.key, "create");
      }
      count++;
    });
    if (count) showToast(`Đã áp dụng ${count} dòng đơn giá.`);
  };

  // ---- Hoàn tác toàn bộ thay đổi từ lần nhập file gần nhất (đã áp dụng rồi nhưng lỡ nhầm file) ----
  const undoImportBatch = () => {
    if (!importBatch.length) return;
    [...importBatch].reverse().forEach((c) => {
      if (c.kind === "material") {
        if (c.type === "update") setMaterials((p) => p.map((m) => (m.id === c.id ? { ...m, prices: { ...m.prices, [c.groupId]: c.prevPrice } } : m)));
        else setMaterials((p) => p.filter((m) => m.id !== c.id));
      } else {
        if (c.type === "update") setLabor((p) => p.map((l) => (l.id === c.id ? { ...l, prices: { ...l.prices, [c.groupId]: c.prevPrice } } : l)));
        else setLabor((p) => p.filter((l) => l.id !== c.id));
      }
    });
    showToast(`Đã hoàn tác ${importBatch.length} thay đổi từ lần nhập file gần nhất.`, "warn");
    setImportBatch([]);
  };

  // ---- Nhập file báo giá NCC — dùng lại parsePriceFile, nhưng chỉ khớp với vật tư/
  // nhân công CÓ SẴN (không tự tạo mới), ghi vào bảng giá riêng của nhà thầu đang chọn ----
  const handleVendorImportFile = async (file, kind, vendorId) => {
    if (!file) return;
    const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
    const isCsv = /\.csv$/i.test(file.name);
    if (!isXlsx && !isCsv) {
      showToast(`"${file.name}" không phải file Excel/CSV.`, "warn");
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const rows_by_sheet = wb.SheetNames.map((sheetName) => ({
        sheetName,
        rows: XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" }),
      }));
      const existingList = kind === "material" ? materials : labor;
      const { results, sheetReport } = parsePriceFile(rows_by_sheet, kind, existingList);
      setVendorImportResults(results);
      setVendorImportReport({ fileName: file.name, sheetReport, total: wb.SheetNames.length, vendorId });
      setVendorImportBatch([]);
      if (results.length) {
        const okSheets = sheetReport.filter((s) => s.count > 0);
        showToast(`Đã quét ${wb.SheetNames.length} sheet trong "${file.name}" — đọc được ${results.length} dòng báo giá từ sheet: ${okSheets.map((s) => s.name).join(", ")}. Dòng nào chưa khớp đúng vật tư/nhân công thì tự chọn lại rồi mới áp dụng.`);
      } else {
        showToast(`Không nhận diện được bảng báo giá nào trong "${file.name}" (cần cột "Tên ${kind === "material" ? "vật tư" : "nhân công"}" và "Đơn giá").`, "warn");
      }
    } catch (e) {
      showToast(`Lỗi đọc file "${file.name}": ${e.message}`, "error");
    }
  };
  const cancelVendorImport = () => { setVendorImportResults([]); setVendorImportReport(null); };
  const skipVendorImportRow = (key) => setVendorImportResults((prev) => prev.filter((x) => x.key !== key));
  const applyVendorImportRow = (key, targetId) => {
    const r = vendorImportResults.find((x) => x.key === key);
    if (!r || !targetId) return;
    const vendorId = vendorImportReport?.vendorId;
    if (!vendorId) return;
    const prevPrice = vendorPrices[vendorId]?.[targetId];
    updateVendorPrice(vendorId, targetId, r.price);
    setVendorImportBatch((b) => [...b, { itemId: targetId, prevPrice }]);
    setVendorImportResults((prev) => prev.filter((x) => x.key !== key));
  };
  const applyAllVendorImport = () => {
    let count = 0;
    vendorImportResults.forEach((r) => { if (r.matchedId) { applyVendorImportRow(r.key, r.matchedId); count++; } });
    if (count) showToast(`Đã áp dụng ${count} dòng báo giá.`);
    const skipped = vendorImportResults.length - count;
    if (skipped > 0) showToast(`${skipped} dòng chưa khớp được vật tư/nhân công nào — cần chọn tay hoặc bỏ qua.`, "warn");
  };
  const undoVendorImportBatch = () => {
    if (!vendorImportBatch.length || !vendorImportReport?.vendorId) return;
    const vendorId = vendorImportReport.vendorId;
    [...vendorImportBatch].reverse().forEach((c) => updateVendorPrice(vendorId, c.itemId, c.prevPrice));
    showToast(`Đã hoàn tác ${vendorImportBatch.length} dòng báo giá vừa áp dụng.`, "warn");
    setVendorImportBatch([]);
  };

  // ---- Nhập file dự toán mẫu / bảng khối lượng đã bóc sẵn (Tên hạng mục + Khối
  // lượng) — nạp thẳng vào BOQ, khớp mờ với định mức, không cần AI đọc bản vẽ ----
  const handleTakeoffImportFile = async (file) => {
    if (!file) return;
    const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
    const isCsv = /\.csv$/i.test(file.name);
    if (!isXlsx && !isCsv) {
      showToast(`"${file.name}" không phải file Excel/CSV.`, "warn");
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const rows_by_sheet = wb.SheetNames.map((sheetName) => ({
        sheetName,
        rows: XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" }),
      }));
      const { results, sheetReport } = parseTakeoffFile(rows_by_sheet, projectNorms);
      setTakeoffImportResults(results);
      setTakeoffImportReport({ fileName: file.name, sheetReport, total: wb.SheetNames.length });
      setTakeoffImportBatch([]);
      if (results.length) {
        const okSheets = sheetReport.filter((s) => s.count > 0);
        showToast(`Đã quét ${wb.SheetNames.length} sheet trong "${file.name}" — đọc được ${results.length} dòng khối lượng từ sheet: ${okSheets.map((s) => s.name).join(", ")}. Xác nhận khớp định mức rồi mới thêm vào BOQ.`);
      } else {
        showToast(`Không nhận diện được bảng khối lượng nào trong "${file.name}" (cần cột "Tên hạng mục" và "Khối lượng").`, "warn");
      }
    } catch (e) {
      showToast(`Lỗi đọc file "${file.name}": ${e.message}`, "error");
    }
  };
  const cancelTakeoffImport = () => { setTakeoffImportResults([]); setTakeoffImportReport(null); };
  const skipTakeoffImportRow = (key) => setTakeoffImportResults((prev) => prev.filter((x) => x.key !== key));
  const applyTakeoffImportRow = (key, normId) => {
    const r = takeoffImportResults.find((x) => x.key === key);
    if (!r || !normId) return;
    const boqId = uid("boq");
    setBoqItems((prev) => [...prev, { id: boqId, projectId: activeProjectId, normId, qty: r.qty, khoanPrice: null, included: true }]);
    setTakeoffImportBatch((b) => [...b, boqId]);
    setTakeoffImportResults((prev) => prev.filter((x) => x.key !== key));
    showToast(`Đã thêm "${r.name}" vào BOQ (khối lượng ${r.qty} ${r.unit}).`);
  };
  const applyAllTakeoffImport = () => {
    const matched = takeoffImportResults.filter((r) => r.matchedId);
    if (!matched.length) { showToast("Chưa có dòng nào khớp định mức để thêm hàng loạt — chọn tay từng dòng bên dưới.", "warn"); return; }
    const newIds = matched.map(() => uid("boq"));
    setBoqItems((prev) => [...prev, ...matched.map((r, i) => ({ id: newIds[i], projectId: activeProjectId, normId: r.matchedId, qty: r.qty, khoanPrice: null, included: true }))]);
    setTakeoffImportBatch((b) => [...b, ...newIds]);
    setTakeoffImportResults((prev) => prev.filter((x) => !x.matchedId));
    showToast(`Đã thêm ${matched.length} dòng vào BOQ.`);
  };
  const undoTakeoffImportBatch = () => {
    if (!takeoffImportBatch.length) return;
    setBoqItems((prev) => prev.filter((b) => !takeoffImportBatch.includes(b.id)));
    showToast(`Đã hoàn tác ${takeoffImportBatch.length} dòng vừa thêm từ file khối lượng.`, "warn");
    setTakeoffImportBatch([]);
  };

  const NHOM_TU_AI = { mong: "cat-mong", khung: "cat-khung", hoanthien: "cat-hoanthien", mep: "cat-mep" };

  const analyzePhotoAI = async (photo, ghiChuThem, provider) => {
    const approxBytes = Math.round((photo.dataUrl.length - photo.dataUrl.indexOf(",") - 1) * 0.75);
    if (approxBytes > 15 * 1024 * 1024) {
      const msg = `Ảnh "${photo.name}" nặng khoảng ${(approxBytes / 1e6).toFixed(1)} MB — vượt quá 15MB nên rất dễ bị lỗi gửi thất bại. Chụp lại ở độ phân giải thấp hơn hoặc chỉ chụp đúng phần bảng số liệu cần đọc rồi thử lại.`;
      setAiError(msg);
      showToast(msg, "error");
      return false;
    }
    if (approxBytes > 5 * 1024 * 1024) {
      showToast(`Ảnh "${photo.name}" khá nặng (${(approxBytes / 1e6).toFixed(1)}MB) — nếu bị lỗi gửi thất bại, thử chụp lại nhỏ/nhẹ hơn.`, "warn");
    }
    setAiAnalyzing(photo.id);
    setAiError(null);
    setAiProgress(3);
    const tick = setInterval(() => {
      setAiProgress((p) => (p < 90 ? p + Math.max(1, Math.round((90 - p) * 0.15)) : p));
    }, 250);
    try {
      const match = photo.dataUrl.match(/^data:(.*?);base64,(.*)$/);
      if (!match) throw new Error("Không đọc được dữ liệu ảnh");
      const mediaType = match[1];
      const base64 = match[2];
      let parsed;
      let modelDaDung = null; // model AI đã dùng để đọc — truy vết sau này (mục 25 Versioning)
      const mauChuanAnh = await layDanhSachChuanTuBackend(); // giữ .tenToNormId dùng cho khớp chính xác bên dưới

      if (BACKEND_URL) {
        // ---- Chế độ backend riêng (ổn định — dùng khi đã có hosting) ----
        let response;
        try {
          response = await fetch(`${BACKEND_URL}/api/analyze-image`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-user-id": getUserId(), ...authHeaders() },
            body: JSON.stringify({ base64, mediaType, ghiChuThem, name: photo.name, danhSachChuan: mauChuanAnh.danhSach, provider, tenCam: activeProject?.tenCam, tenUuTien: activeProject?.tenUuTien, duToanMauThamChieu: layDuToanMauThamChieu(activeProject) }),
          });
        } catch (netErr) {
          throw new Error(`Không gọi được backend riêng (${netErr.message}). Kiểm tra lại địa chỉ BACKEND_URL trong code và server có đang chạy không.`);
        }
        let data;
        try { data = await response.json(); } catch (e) { throw new Error(response.status === 413 ? 'File quá nặng, bị máy chủ từ chối trước khi tới AI đọc — thử file nhỏ hơn hoặc tách bớt trang.' : `Backend trả về dữ liệu không hợp lệ (HTTP ${response.status})`); }
        if (!response.ok) throw new Error(data?.error || `Lỗi HTTP ${response.status} từ backend`);
        const parsedTho2 = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
        parsed = parsedTho2.filter((it) => !it?.laCanhBao);
        const canhBaoDoiChieu2 = parsedTho2.filter((it) => it?.laCanhBao);
        if (typeof console !== "undefined") console.log("[AI doc] backend tra ve:", data, "-> so hang muc:", parsed.length);
        setLastRawDebug(`Backend tra ve ${parsed.length} hang muc.` + (parsed.length===0 ? " Chi tiet: " + JSON.stringify(data).slice(0,400) : "") + (canhBaoDoiChieu2.length ? ` ⚠ ${canhBaoDoiChieu2.length} cảnh báo đối chiếu chéo mã hiệu (xem chi tiết dưới BOQ).` : ""));
        setLastPipelineTrace(data.pipelineTrace || null);
        setLastDrawingModel(data.drawingModel || null);
        ghiNhanChiPhi(data.cost);
        modelDaDung = data.model || null;
      } else {
        // ---- Chế độ tạm của Claude.ai (mượn quyền gọi AI trong khung xem trước) ----
        let response;
        try {
          response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: 1000,
              messages: [{
                role: "user",
                content: [
                  { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
                  { type: "text", text: 'Đây là ảnh chụp bản vẽ/bảng thống kê xây dựng. Nếu ảnh có bảng khối lượng, bảng thống kê thép, bảng kích thước cấu kiện, hoặc ghi chú đủ để ước tính khối lượng thi công, hãy trích xuất thành danh sách hạng mục. Nếu ảnh KHÔNG chứa đủ số liệu để bóc khối lượng, trả về mảng rỗng []. Chỉ trả lời bằng JSON thuần, không giải thích, đúng định dạng: [{"name":"tên hạng mục ngắn gọn","unit":"đơn vị","qty":số,"note":"cơ sở/giả định khi đọc"}]' },
                ],
              }],
            }),
          });
        } catch (netErr) {
          throw new Error(`Gửi ảnh thất bại do lỗi mạng/kết nối (${netErr.message}). Thử: kiểm tra lại wifi/4G, đóng mở lại app, hoặc chụp ảnh nhỏ/nhẹ hơn rồi bấm lại.`);
        }
        let data;
        try { data = await response.json(); } catch (e) { throw new Error(`Máy chủ trả về dữ liệu không hợp lệ (HTTP ${response.status})`); }
        if (!response.ok) throw new Error(data?.error?.message || `Lỗi HTTP ${response.status}`);
        if (data?.error) throw new Error(data.error.message || "Lỗi không xác định từ API");
        if (!Array.isArray(data?.content)) throw new Error("Phản hồi API không đúng định dạng mong đợi");
        const text = data.content.map((b) => b.text || "").join("");
        if (!text.trim()) throw new Error("AI không trả về nội dung văn bản nào");
        const clean = text.replace(/```json|```/g, "").trim();
        try { parsed = JSON.parse(clean); } catch (e) { throw new Error("Không đọc được kết quả AI dưới dạng JSON — thử lại hoặc dùng ảnh khác"); }
      }

      if (Array.isArray(parsed) && parsed.length) {
        const withMatch = parsed.map((p) => {
          const normIdTheoMau = khopTheoLienKetMau(p.name || "", mauChuanAnh.tenToNormId);
          const match = normIdTheoMau
            ? { normId: normIdTheoMau, score: 1, goiYNormId: normIdTheoMau, tuXacNhan: true, lyDoKhongTuXacNhan: "" }
            : timDinhMucPhuHopDaTieuChi(p.name || "", p.unit || "", activeProject?.groupId || "", projectNorms);
          return {
            key: uid("air"), projectId: activeProjectId,
            name: p.name || "Hạng mục chưa đặt tên",
            unit: p.unit || "",
            qty: Number(p.qty) || 0,
            note: p.note || "",
            category: NHOM_TU_AI[p.group] || "cat-hoanthien",
            sourcePhoto: photo.name,
            matchedNormId: match.normId,
            matchScore: match.score,
            goiYNormId: match.goiYNormId,
            lyDoKhongTuXacNhan: match.lyDoKhongTuXacNhan,
            model: modelDaDung,
          };
        });
        const moiDoc1 = ganhDauNghiTrung(withMatch);
        setAiResults((prev) => [...prev, ...moiDoc1]);
        // SỬA THEO YÊU CẦU: tự động đưa thẳng vào BOQ — xem giải thích đầy đủ
        // ở lần dùng đầu tiên của mẫu này (analyzePdfAI) phía trên.
        apDungDanhSachVaoBoq(moiDoc1);
        showToast(`AI đọc được ${parsed.length} hạng mục từ "${photo.name}"${ghiChuThem ? " (đã đọc theo yêu cầu bổ sung)" : ""} — đã tự động thêm vào BOQ (không thay thế bóc tách chuyên môn, cần kiểm tra lại).`, "warn");
      } else {
        showToast(`Ảnh "${photo.name}" không có bảng số liệu rõ ràng để AI đọc khối lượng.`, "warn");
      }
      setAiProgress(100);
      return true;
    } catch (e) {
      setAiError(e.message);
      showToast(`Lỗi phân tích AI: ${e.message}`, "error");
      return false;
    } finally {
      clearInterval(tick);
      setAiAnalyzing(null);
      setTimeout(() => setAiProgress(0), 500);
    }
  };

  // Đọc GỘP nhiều ảnh trong CÙNG 1 lượt gọi AI — để AI thấy toàn bộ các trang
  // cùng lúc, đối chiếu chéo giữa chúng (VD: phòng lặp lại ở nhiều tầng, không
  // tính trùng) — giống hệt cách đọc trực tiếp trong khung chat, thay vì gọi
  // rời rạc từng ảnh khiến kết quả thiếu sót (đây là gốc rễ được yêu cầu sửa).
  const analyzePhotosBatchAI = async (danhSachAnh, ghiChuThem, provider) => {
    if (!danhSachAnh.length) return false;
    setAiAnalyzing("batch");
    setAiError(null);
    setAiProgress(5);
    const tick = setInterval(() => setAiProgress((p) => (p < 90 ? p + Math.max(1, Math.round((90 - p) * 0.1)) : p)), 300);
    try {
      const images = danhSachAnh.map((photo) => {
        const match = photo.dataUrl.match(/^data:(.*?);base64,(.*)$/);
        if (!match) throw new Error(`Không đọc được dữ liệu ảnh "${photo.name}"`);
        return { base64: match[2], mediaType: match[1], name: photo.name };
      });
      if (!BACKEND_URL) throw new Error("Đọc gộp nhiều ảnh chỉ hoạt động khi đã cấu hình backend riêng.");
      const mauChuanBatch = await layDanhSachChuanTuBackend(); // giữ .tenToNormId dùng cho khớp chính xác bên dưới
      let response;
      try {
        response = await fetch(`${BACKEND_URL}/api/analyze-images-batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-user-id": getUserId(), ...authHeaders() },
          body: JSON.stringify({ images, ghiChuThem, danhSachChuan: mauChuanBatch.danhSach, provider, tenCam: activeProject?.tenCam, tenUuTien: activeProject?.tenUuTien, duToanMauThamChieu: layDuToanMauThamChieu(activeProject) }),
        });
      } catch (netErr) {
        throw new Error(`Không gọi được backend riêng (${netErr.message}).`);
      }
      let data;
      try { data = await response.json(); } catch (e) { throw new Error(response.status === 413 ? "Tổng dung lượng nhiều ảnh gộp lại quá nặng, bị máy chủ từ chối — thử đọc thành 2 đợt ít ảnh hơn." : `Backend trả về dữ liệu không hợp lệ (HTTP ${response.status})`); }
      if (!response.ok) throw new Error(data?.error || `Lỗi HTTP ${response.status} từ backend`);
      const parsedTho3 = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
      const parsed = parsedTho3.filter((it) => !it?.laCanhBao);
      const canhBaoDoiChieu3 = parsedTho3.filter((it) => it?.laCanhBao);
      if (typeof console !== "undefined") console.log("[AI doc gop]", danhSachAnh.length, "anh -> backend tra ve:", data, "-> so hang muc:", parsed.length);
      const tenGop = danhSachAnh.map((p) => p.name).join(", ");
      const tenTheoAnh = Array.isArray(data.imageNames) ? data.imageNames : danhSachAnh.map((p) => p.name);
      setLastRawDebug(`Đọc gộp ${danhSachAnh.length} ảnh — backend trả về ${parsed.length} hạng mục.` + (parsed.length === 0 ? " Chi tiết: " + JSON.stringify(data).slice(0, 400) : "") + (canhBaoDoiChieu3.length ? ` ⚠ ${canhBaoDoiChieu3.length} cảnh báo đối chiếu chéo mã hiệu (xem chi tiết dưới BOQ).` : ""));
      setLastPipelineTrace(data.pipelineTrace || null);
      setLastDrawingModel(data.drawingModel || null);
      ghiNhanChiPhi(data.cost);
      if (parsed.length) {
        const withMatch = parsed.map((p) => {
          const normIdTheoMau = khopTheoLienKetMau(p.name || "", mauChuanBatch.tenToNormId);
          const match = normIdTheoMau
            ? { normId: normIdTheoMau, score: 1, goiYNormId: normIdTheoMau, tuXacNhan: true, lyDoKhongTuXacNhan: "" }
            : timDinhMucPhuHopDaTieuChi(p.name || "", p.unit || "", activeProject?.groupId || "", projectNorms);
          // SỬA LỖI 4: ưu tiên dùng "source_image_index" AI trả về để gán ĐÚNG tên
          // ảnh nguồn cho riêng dòng này — chỉ dùng tenGop (tất cả ảnh gộp) làm dự
          // phòng khi AI không trả chỉ số hợp lệ (không phải mặc định như trước).
          const idx = Number(p.source_image_index);
          const dungNguon = Number.isInteger(idx) && idx >= 1 && idx <= tenTheoAnh.length ? tenTheoAnh[idx - 1] : null;
          return {
            key: uid("air"), projectId: activeProjectId, name: p.name || "Hạng mục chưa đặt tên", unit: p.unit || "", qty: Number(p.qty) || 0, note: p.note || "",
            category: NHOM_TU_AI[p.group] || "cat-hoanthien", sourcePhoto: dungNguon || tenGop,
            nguonKhongRoRang: !dungNguon, // đánh dấu để hiện cảnh báo nếu AI không trả đúng chỉ số ảnh
            matchedNormId: match.normId, matchScore: match.score, goiYNormId: match.goiYNormId, lyDoKhongTuXacNhan: match.lyDoKhongTuXacNhan, model: data.model || null,
          };
        });
        const moiDoc2 = ganhDauNghiTrung(withMatch);
        setAiResults((prev) => [...prev, ...moiDoc2]);
        // SỬA THEO YÊU CẦU: tự động đưa thẳng vào BOQ — xem giải thích đầy đủ
        // ở lần dùng đầu tiên của mẫu này (analyzePdfAI) phía trên.
        apDungDanhSachVaoBoq(moiDoc2);
        showToast(`AI đọc gộp ${danhSachAnh.length} ảnh cùng lúc, đối chiếu chéo giữa các trang — ra ${parsed.length} hạng mục, đã tự động thêm vào BOQ.`);
      } else {
        showToast(`AI đã đọc gộp ${danhSachAnh.length} ảnh nhưng không trích được hạng mục nào.`, "warn");
      }
      setAiProgress(100);
      return true;
    } catch (e) {
      setAiError(e.message);
      showToast(`Lỗi đọc gộp: ${e.message}`, "error");
      return false;
    } finally {
      clearInterval(tick);
      setAiAnalyzing(null);
      setTimeout(() => setAiProgress(0), 500);
    }
  };

  const applyAiResult = (key, normId) => {
    if (activeProject?.khoaBoq) { showToast(`Dự án đang KHOÁ — không thêm được dòng mới vào BOQ.`, "error"); return; }
    const r = aiResults.find((x) => x.key === key);
    if (!r || !normId) return;
    const boqId = uid("boq");
    // Trạng thái: khớp đúng định mức đã có (thường đã có giá thật từ mẫu) -> CONFIRMED;
    // dòng nào KHÔNG khớp mẫu (kể cả nếu chọn tay 1 định mức khác) -> vẫn coi REVIEW vì
    // là do AI tự đọc, chưa được đối chiếu chuẩn hoá.
    const trangThai = r.matchedNormId === normId ? "confirmed" : "review";
    setBoqItems((prev) => [...prev, { id: boqId, projectId: activeProjectId, normId, qty: r.qty, khoanPrice: null, included: true, category: r.category || "cat-hoanthien", ghiChu: r.note || "", trangThai, sourcePhoto: r.sourcePhoto || "", model: r.model || null, ngayDoc: new Date().toISOString(), evidence_region: r.evidence_region || null, confidenceMatrix: r.confidenceMatrix || null }]);
    setAiResults((prev) => prev.filter((x) => x.key !== key));
    showToast(`Đã thêm "${r.name}" vào BOQ (khối lượng ${r.qty} ${r.unit}) theo định mức đã khớp.`);
  };

  // Bỏ 1 dòng AI đọc được (đọc sai/thừa/trùng) — KHÔNG thêm vào BOQ, không xoá ảnh
  // hay các dòng khác. Khác với xoá ảnh (mất hết): đây chỉ bỏ đúng 1 dòng.
  const skipAiResult = (key) => {
    setAiResults((prev) => prev.filter((x) => x.key !== key));
  };

  // Duyệt hàng loạt — thêm TẤT CẢ dòng AI đọc được vào BOQ trong 1 lượt, kể cả
  // dòng CHƯA khớp định mức có sẵn: với dòng chưa khớp, tự tạo 1 định mức LOCAL
  // (riêng dự án này) mang đúng tên AI đọc được, giá 0đ và đánh dấu rõ "CHƯA ĐỊNH
  // GIÁ" — không bịa số, chỉ giúp chú không phải chọn tay từng dòng một; sau đó
  // vào thẻ "Dự án" bổ sung đơn giá thật cho các định mức mới này.
  // Mỗi dòng gắn trạng thái CONFIRMED (khớp mẫu, đã có giá) hoặc REVIEW (mới tạo,
  // cần chú tự kiểm tra) — để biết ngay dòng nào tin được, dòng nào phải xem lại.
  // SỬA THEO YÊU CẦU (bỏ bước duyệt tay — giống cách chat Claude thường: gửi
  // bản vẽ + mẫu, nhận thẳng kết quả cuối, không có bước duyệt tay ở giữa):
  // tách phần "áp kết quả vào BOQ" thành hàm dùng lại được, NHẬN THẲNG mảng
  // kết quả làm tham số — thay vì chỉ đọc từ state "aiResults" (vốn cập nhật
  // BẤT ĐỒNG BỘ, không dùng ngay lập tức được sau khi vừa setAiResults). Nhờ
  // vậy có thể gọi NGAY sau khi đọc xong (tự động), không cần người bấm nữa.
  const apDungDanhSachVaoBoq = (danhSach, { imLang } = {}) => {
    if (activeProject?.khoaBoq) { if (!imLang) showToast(`Dự án đang KHOÁ — không thêm được dòng mới vào BOQ. Mở khoá ở thẻ Dự án nếu cần.`, "error"); return 0; }
    if (!danhSach || !danhSach.length) return 0;
    let soTaoMoi = 0;
    const newBoqItems = danhSach.map((r) => {
      let normId = r.matchedNormId;
      let trangThai = "confirmed";
      if (!normId) {
        normId = addNorm(
          { code: uid("AI").toUpperCase(), name: r.name, unit: r.unit || "-", standard: "", groups: [activeProject?.groupId], vt: [], nc: [], may: [] },
          "local",
          `Tự tạo khi AI đọc bản vẽ "${r.sourcePhoto}" — CHƯA CÓ GIÁ, cần bổ sung đơn giá vật tư/nhân công thật.`,
          true
        );
        soTaoMoi++;
        trangThai = "review";
      }
      return { id: uid("boq"), projectId: activeProjectId, normId, qty: r.qty, khoanPrice: null, included: true, category: r.category || "cat-hoanthien", ghiChu: r.note || "", trangThai, sourcePhoto: r.sourcePhoto || "", model: r.model || null, ngayDoc: new Date().toISOString(), evidence_region: r.evidence_region || null, confidenceMatrix: r.confidenceMatrix || null };
    });
    setBoqItems((prev) => [...prev, ...newBoqItems]);
    if (!imLang) {
      showToast(
        `Đã tự động thêm ${danhSach.length} dòng vào BOQ` +
        (soTaoMoi > 0 ? ` (trong đó ${soTaoMoi} dòng chưa có định mức sẵn — GIÁ ĐANG LÀ 0Đ, vào thẻ "Dự án → Định mức" bổ sung giá thật trước khi xuất báo giá chính thức).` : "."),
        soTaoMoi > 0 ? "warn" : "ok"
      );
    }
    return danhSach.length;
  };

  const applyAllAiResults = () => {
    // SỬA THEO YÊU CẦU: kết quả giờ đã TỰ ĐỘNG vào BOQ ngay lúc đọc xong (xem
    // apDungDanhSachVaoBoq gọi ngay sau setAiResults ở các hàm đọc PDF/ảnh) —
    // nút này giờ chỉ còn tác dụng "đã xem xong, ẩn danh sách đi", KHÔNG được
    // thêm lại lần nữa (nếu thêm lại sẽ tạo trùng dòng BOQ, vì bản ghi gốc đã
    // được thêm tự động từ trước rồi). Chỉ ẩn đúng phần của dự án đang mở,
    // giữ nguyên kết quả chờ xem của dự án khác (nếu có).
    setAiResults((prev) => prev.filter((r) => r.projectId !== activeProjectId));
  };

  // ---- Xuất PDF THẬT — dùng pdf-lib (không phải chỉ "In" trình duyệt như trước).
  // Nhúng font DejaVu Sans (tải qua CDN) để hiển thị đúng tiếng Việt có dấu — đã
  // kiểm chứng font này hỗ trợ đủ dấu tiếng Việt bằng test riêng trước khi viết.
  const FONT_URL = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf";
  const FONT_BOLD_URL = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf";
  const exportPdfThat = async () => {
    if (!includedBoqLines.length) {
      showToast("Chưa có dòng BOQ nào cho dự án này — thêm ít nhất 1 dòng trước khi xuất.", "warn");
      return;
    }
    const PDFLib = window.PDFLib;
    const fontkit = window.fontkit;
    if (!PDFLib || !fontkit) {
      showToast("Thư viện tạo PDF chưa tải xong (cần mạng ổn định) — thử lại sau vài giây, hoặc dùng nút Xuất Excel rồi in ra PDF từ Excel.", "error");
      return;
    }
    showToast("Đang tạo file PDF, vui lòng đợi...", "warn");
    try {
      const { PDFDocument, rgb } = PDFLib;
      const doc = await PDFDocument.create();
      doc.registerFontkit(fontkit);
      const [fontBytes, fontBoldBytes] = await Promise.all([
        fetch(FONT_URL).then((r) => { if (!r.ok) throw new Error("Không tải được font"); return r.arrayBuffer(); }),
        fetch(FONT_BOLD_URL).then((r) => { if (!r.ok) throw new Error("Không tải được font đậm"); return r.arrayBuffer(); }),
      ]);
      const font = await doc.embedFont(fontBytes);
      const fontBold = await doc.embedFont(fontBoldBytes);

      const A4W = 841.89, A4H = 595.28; // A4 ngang (landscape) — bảng nhiều cột
      const MARGIN = 36;
      const COLS = [
        { key: "name", label: "Hạng mục", w: 260, align: "left" },
        { key: "unit", label: "ĐVT", w: 45, align: "center" },
        { key: "qty", label: "Khối lượng", w: 75, align: "right" },
        { key: "donGia", label: "Đơn giá", w: 90, align: "right" },
        { key: "thanhTien", label: "Thành tiền", w: 110, align: "right" },
      ];
      const ROW_H = 16, HEADER_H = 20;
      const fmt = (n) => Math.round(n).toLocaleString("vi-VN");

      let page, y;
      const veTieuDeCot = () => {
        page.drawRectangle({ x: MARGIN, y: y - HEADER_H, width: A4W - MARGIN * 2, height: HEADER_H, color: rgb(0.12, 0.23, 0.34) });
        let x = MARGIN;
        COLS.forEach((c) => {
          page.drawText(c.label, { x: x + 4, y: y - HEADER_H + 6, size: 9, font: fontBold, color: rgb(1, 1, 1) });
          x += c.w;
        });
        y -= HEADER_H;
      };

      // TRANG DASHBOARD — tổng hợp giá thành A→B→C→D, trang đầu tiên trước bảng
      // BOQ chi tiết. Dùng đúng biến "totals" đã tính sẵn (cùng nguồn với UI
      // chính) — không tính lại riêng, tránh lệch số.
      const pageDb = doc.addPage([A4W, A4H]);
      pageDb.drawText(`DASHBOARD GIÁ THÀNH — ${activeProject?.name || ""}`, { x: MARGIN, y: A4H - MARGIN, size: 15, font: fontBold, color: rgb(0.12, 0.23, 0.34) });
      const dongDb = [
        ["A. Chi phí trực tiếp (Vật liệu + Nhân công + Máy)", totals.truc_tiep, true],
        [`   Chi phí quản lý (${fmtPct(activeProject?.quanLyPct)})`, totals.quanLy, false],
        [`   Chi phí khác/rủi ro (${fmtPct(activeProject?.khacPct)})`, totals.khac, false],
        ["B. Giá thành (A + quản lý + khác)", totals.giaThanh, true],
        [`   Lợi nhuận (${fmtPct(activeProject?.loiNhuanPct)})`, totals.loiNhuan, false],
        ["C. Giá bán trước VAT (B + lợi nhuận)", totals.giaBanTruocVAT, true],
        [`   VAT (${fmtPct(activeProject?.vatPct)})`, totals.vat, false],
        ["D. GIÁ BÁN SAU VAT (TỔNG CUỐI CÙNG)", totals.giaBanSauVAT, true],
      ];
      let yDb = A4H - MARGIN - 50;
      dongDb.forEach(([nhan, gia, noiBat]) => {
        pageDb.drawText(nhan, { x: MARGIN, y: yDb, size: noiBat ? 11 : 9.5, font: noiBat ? fontBold : font, color: noiBat ? rgb(0.12, 0.23, 0.34) : rgb(0.2, 0.2, 0.2) });
        const soTien = Math.round(gia).toLocaleString("vi-VN") + " đ";
        const w = (noiBat ? fontBold : font).widthOfTextAtSize(soTien, noiBat ? 11 : 9.5);
        pageDb.drawText(soTien, { x: A4W - MARGIN - w, y: yDb, size: noiBat ? 11 : 9.5, font: noiBat ? fontBold : font, color: noiBat ? rgb(0.12, 0.23, 0.34) : rgb(0.2, 0.2, 0.2) });
        yDb -= noiBat ? 26 : 20;
      });

      const trangMoi = (tieuDe) => {
        page = doc.addPage([A4W, A4H]);
        y = A4H - MARGIN;
        page.drawText(tieuDe, { x: MARGIN, y, size: 13, font: fontBold, color: rgb(0.12, 0.23, 0.34) });
        y -= 22;
        veTieuDeCot();
      };

      trangMoi(`BẢNG KHỐI LƯỢNG (BOQ) — ${activeProject?.name || ""}`);
      let tongTien = 0;
      let dongTrongTrang = 0;
      const soDongMotTrang = Math.floor((y - MARGIN) / ROW_H) - 1;

      STANDARD_CATEGORIES.forEach((cat) => {
        const linesInCat = includedBoqLines.filter((l) => (l.boq.category || STANDARD_CATEGORIES[0].id) === cat.id);
        if (!linesInCat.length) return;
        if (dongTrongTrang >= soDongMotTrang - 1) { trangMoi(`BẢNG KHỐI LƯỢNG (tiếp theo) — ${activeProject?.name || ""}`); dongTrongTrang = 0; }
        page.drawText(cat.name, { x: MARGIN + 4, y: y - ROW_H + 4, size: 9.5, font: fontBold, color: rgb(0.12, 0.23, 0.34) });
        y -= ROW_H; dongTrongTrang++;

        linesInCat.forEach(({ boq, norm, calc }) => {
          if (dongTrongTrang >= soDongMotTrang) { trangMoi(`BẢNG KHỐI LƯỢNG (tiếp theo) — ${activeProject?.name || ""}`); dongTrongTrang = 0; }
          const thanhTien = boq.qty * (calc.donGiaKhoan || 0);
          tongTien += thanhTien;
          const rowVals = { name: norm.name, unit: norm.unit, qty: boq.qty.toLocaleString("vi-VN"), donGia: fmt(calc.donGiaKhoan || 0), thanhTien: fmt(thanhTien) };
          let x = MARGIN;
          COLS.forEach((c) => {
            const text = String(rowVals[c.key] ?? "");
            const textW = font.widthOfTextAtSize(text.length > 42 ? text.slice(0, 42) + "…" : text, 8.5);
            const tx = c.align === "right" ? x + c.w - textW - 4 : c.align === "center" ? x + (c.w - textW) / 2 : x + 4;
            page.drawText(text.length > 42 ? text.slice(0, 42) + "…" : text, { x: tx, y: y - ROW_H + 4, size: 8.5, font, color: rgb(0.1, 0.1, 0.1) });
            x += c.w;
          });
          page.drawLine({ start: { x: MARGIN, y: y - ROW_H }, end: { x: A4W - MARGIN, y: y - ROW_H }, thickness: 0.4, color: rgb(0.85, 0.85, 0.85) });
          y -= ROW_H; dongTrongTrang++;
        });
      });

      if (dongTrongTrang >= soDongMotTrang - 1) { trangMoi(`BẢNG KHỐI LƯỢNG (tiếp theo) — ${activeProject?.name || ""}`); }
      y -= 6;
      page.drawText(`TỔNG CỘNG: ${fmt(tongTien)} đ`, { x: A4W - MARGIN - 220, y, size: 11, font: fontBold, color: rgb(0.12, 0.23, 0.34) });

      // Đánh số trang ở mọi trang
      const pages = doc.getPages();
      pages.forEach((p, i) => {
        p.drawText(`Trang ${i + 1}/${pages.length} — Xuất ngày ${new Date().toLocaleDateString("vi-VN")}`, { x: MARGIN, y: 16, size: 7.5, font, color: rgb(0.4, 0.4, 0.4) });
      });

      const bytes = await doc.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `BOQ_${(activeProject?.name || "duan").replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Đã tạo file PDF thật (${pages.length} trang) — không phải bản in trình duyệt.`, "ok");
    } catch (e) {
      showToast(`Lỗi tạo PDF: ${e.message}. Có thể do mạng chặn tải font — dùng tạm nút Xuất Excel rồi in từ Excel.`, "error");
    }
  };

  // ---- Xuất Excel — công thức thật, liên kết chéo 4 sheet (đã kiểm thử độc lập) ----
  const exportExcel = () => {
    if (!includedBoqLines.length) {
      showToast("Chưa có dòng BOQ nào cho dự án này — thêm ít nhất 1 dòng trước khi xuất.", "warn");
      return;
    }
    // Kiểm tra lại NGAY LÚC BẤM (không dùng biến đã chốt cứng lúc mở trang) — thư
    // viện Excel tải từ internet, có thể chưa kịp xong lúc trang mới mở lên.
    const XLSXLive = (typeof window !== "undefined" && window.XLSX && window.XLSX.utils) ? window.XLSX : null;
    if (!XLSXLive) {
      showToast('Thư viện tạo file Excel chưa tải xong (cần internet). Đợi vài giây rồi thử lại — nếu vẫn lỗi, tải lại trang bằng Ctrl+Shift+R (máy tính) hoặc kéo màn hình xuống làm mới (điện thoại).', "error");
      return;
    }
    try {
      exportExcelThat(XLSXLive);
    } catch (e) {
      showToast(`Lỗi khi tạo file Excel: ${e.message}. Báo lại đúng dòng lỗi này để được hỗ trợ.`, "error");
    }
  };

  const exportExcelThat = (XLSX) => {
    // THÊM MỚI (theo yêu cầu chú: xuất đủ các sheet có trong R1-25): phân loại
    // TỪNG dòng BOQ vào đúng 1 trong 9 phase chuẩn công ty (BOQ_V1.1→V4.1),
    // gán đúng mã Cost Code — đọc trực tiếp từ cấu trúc thật của file mẫu
    // R1-25 (WBS-CostCode + tên từng sheet BOQ_V*), không tự bịa quy tắc.
    const PHASE_DINH_NGHIA = [
      { sheet: "BOQ_V1.1", tieuDe: "BOQ_V1.1 - PHẦN THÔ: XÂY - TÔ - CHỐNG THẤM - CÁN NỀN", tuKhoa: /xây\s*tường|tô\s*trát|trát\s*tường|chống\s*thấm|cán\s*nền/i, maGoc: "MAS" },
      { sheet: "BOQ_V1.2", tieuDe: "BOQ_V1.2 - HOÀN THIỆN: SƠN - TRẦN THẠCH CAO - GẠCH ĐÁ ỐP LÁT", tuKhoa: /sơn|trần\s*thạch\s*cao|gạch|đá\s*ốp|ốp\s*lát|lát\s*nền/i, maGoc: "FIN" },
      { sheet: "BOQ_V2.0", tieuDe: "BOQ_V2.0 - ĐIỆN NHẸ & ĐỘNG LỰC", tuKhoa: /đèn|chiếu\s*sáng|ổ\s*cắm|công\s*tắc|dây\s*dẫn|dây\s*điện|tủ\s*điện|mạch\s*động\s*lực/i, maGoc: "ELE" },
      { sheet: "BOQ_V2.1", tieuDe: "BOQ_V2.1 - MEP: CẤP NƯỚC - THOÁT NƯỚC", tuKhoa: /cấp\s*nước|thoát\s*nước|ống\s*ppr|ống\s*pvc|bồn\s*nước|máy\s*bơm/i, maGoc: "PLB" },
      { sheet: "BOQ_V2.2", tieuDe: "BOQ_V2.2 - HVAC: MÁY LẠNH - ỐNG ĐỒNG - BẢO ÔN", tuKhoa: /máy\s*lạnh|điều\s*hòa|ống\s*đồng|bảo\s*ôn|hvac/i, maGoc: "HVAC" },
      { sheet: "BOQ_V3.0", tieuDe: "BOQ_V3.0 - NỘI THẤT: GIƯỜNG - TỦ - BÀN - PANTRY", tuKhoa: /giường|tủ\s|bàn\s|pantry|nội\s*thất|mdf/i, maGoc: "FUR" },
      { sheet: "BOQ_V3.1", tieuDe: "BOQ_V3.1 - THIẾT BỊ VỆ SINH: LAVABO - BỒN CẦU - SEN", tuKhoa: /lavabo|bồn\s*cầu|sen\s*vòi|thiết\s*bị\s*vệ\s*sinh|gương\s*wc/i, maGoc: "SAN" },
      { sheet: "BOQ_V4.0", tieuDe: "BOQ_V4.0 - PCCC TRỌN GÓI", tuKhoa: /pccc|báo\s*cháy|chữa\s*cháy|bình\s*chữa\s*cháy/i, maGoc: "PCCC" },
      { sheet: "BOQ_V4.1", tieuDe: "BOQ_V4.1 - THANG MÁY", tuKhoa: /thang\s*máy/i, maGoc: "TM" },
    ];
    // Nhóm "group" hiện có (mong/khung/hoanthien/mep) chỉ dùng làm gợi ý phụ khi
    // từ khoá tên không khớp phase nào — ưu tiên từ khoá tên trước vì chính xác hơn.
    function phanLoaiPhase(norm) {
      const ten = norm?.name || "";
      const match = PHASE_DINH_NGHIA.find((p) => p.tuKhoa.test(ten));
      if (match) return match;
      // Không khớp từ khoá nào — xếp tạm theo group thô, đánh dấu rõ để QS tự xác nhận lại
      if (norm?.group === "mep") return PHASE_DINH_NGHIA[2]; // tạm về ELE, phổ biến nhất trong mep
      return PHASE_DINH_NGHIA[0]; // mặc định V1.1 (phần thô) — nhóm rộng nhất, ít rủi ro nhất khi đoán sai
    }

    const usedMatIds = new Set();
    const usedLaborIds = new Set();
    includedBoqLines.forEach(({ norm }) => {
      (norm.vt || []).forEach((r) => usedMatIds.add(r.materialId));
      (norm.nc || []).forEach((r) => usedLaborIds.add(r.laborId));
      (norm.may || []).forEach((r) => usedLaborIds.add(r.laborId));
    });
    const usedMats = materials.filter((m) => usedMatIds.has(m.id));
    const usedLabor = labor.filter((l) => usedLaborIds.has(l.id));
    const gid = activeProject.groupId;

    // Sheet 1: Đơn giá
    const matStart = 2;
    const matCellMap = {};
    const matPriceMap = {}; // giá trị THẬT song song với ô tham chiếu — dùng để tính sẵn "v" cho mọi ô công thức bên dưới
    const activeVendorName = vendors.find((v) => v.id === activeVendorId)?.name;
    const dgAoa = [["MÃ HIỆU NSX", "TÊN VẬT TƯ", "QUY CÁCH", "ĐVT", "ĐƠN GIÁ", "NGUỒN GIÁ", "NCC", "CO/CQ"]];
    usedMats.forEach((m, i) => {
      matCellMap[m.id] = `E${matStart + i}`;
      const rp = resolvePrice(m, gid, activeVendorId, vendorPrices);
      matPriceMap[m.id] = Number(rp.price) || 0;
      const nguon = rp.vendor ? `Báo giá NCC: ${activeVendorName}` : rp.borrowed ? `Mượn từ nhóm ${PROJECT_GROUPS.find((g) => g.id === rp.source)?.name || rp.source}` : "Giá riêng nhóm này";
      dgAoa.push([m.code, m.name, m.spec, m.unit, rp.price, nguon, m.supplier, m.coCq ? "Có" : "CHƯA CÓ"]);
    });
    const laborStart = matStart + usedMats.length + 2;
    const laborCellMap = {};
    const laborPriceMap = {};
    dgAoa.push([]);
    dgAoa.push(["NHÂN CÔNG / MÁY", "", "VÙNG MIỀN", "ĐVT", "ĐƠN GIÁ"]);
    usedLabor.forEach((l, i) => {
      laborCellMap[l.id] = `E${laborStart + i}`;
      const rp = resolvePrice(l, gid, activeVendorId, vendorPrices);
      laborPriceMap[l.id] = Number(rp.price) || 0;
      dgAoa.push([l.name, "", l.region, l.unit, rp.price]);
    });
    const wsDonGia = XLSX.utils.aoa_to_sheet(dgAoa);
    wsDonGia["!cols"] = [{ wch: 20 }, { wch: 36 }, { wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 24 }, { wch: 18 }, { wch: 10 }];

    // Sheet 2: Phân tích đơn giá
    const wsPhanTich = XLSX.utils.aoa_to_sheet([["Mã ĐM", "Tên định mức", "Thành phần", "Hao phí", "Đơn giá (ref)", "Thành tiền"]]);
    let r = 2;
    const normTotalCell = {};
    const normTotalValue = {}; // giá trị thật song song — dùng tính "v" cho sheet BOQ bên dưới
    const usedNorms = [...new Map(includedBoqLines.map(({ norm }) => [norm.id, norm])).values()];
    usedNorms.forEach((n) => {
      const comps = [
        // Vật tư: hao phí THỰC TẾ = hao phí gốc × (1 + % hao hụt) — PHẢI khớp đúng
        // công thức trong computeAnalyzedPrice() (dùng cho UI "Phân tích giá vốn"),
        // nếu không Excel sẽ tính RA GIÁ THẤP HƠN UI với mọi vật tư có khai báo hao
        // hụt — đúng lỗi "Excel tính 1 kiểu, UI tính 1 kiểu" mà chuẩn hồ sơ cấm.
        ...(n.vt || []).map((v) => {
          const mat = materialsById[v.materialId];
          const wastagePct = mat?.wastagePct || 0;
          const haoPhiThucTe = v.haoPhi * (1 + wastagePct / 100);
          return { label: mat?.name || "?", haoPhi: haoPhiThucTe, haoPhiGoc: v.haoPhi, wastagePct, priceCell: matCellMap[v.materialId], gia: matPriceMap[v.materialId] || 0 };
        }),
        ...(n.nc || []).map((v) => ({ label: laborById[v.laborId]?.name || "?", haoPhi: v.cong, priceCell: laborCellMap[v.laborId], gia: laborPriceMap[v.laborId] || 0 })),
        ...(n.may || []).map((v) => ({ label: laborById[v.laborId]?.name || "?", haoPhi: v.ca, priceCell: laborCellMap[v.laborId], gia: laborPriceMap[v.laborId] || 0 })),
      ];
      const firstRow = r;
      let tongDinhMuc = 0;
      comps.forEach((c, idx) => {
        const nhanGhiChu = c.wastagePct > 0 ? ` (hao phí gốc ${c.haoPhiGoc} × hao hụt ${c.wastagePct}%)` : "";
        XLSX.utils.sheet_add_aoa(wsPhanTich, [[idx === 0 ? n.code : "", idx === 0 ? n.name : "", c.label + nhanGhiChu]], { origin: `A${r}` });
        const thanhTien = (Number(c.haoPhi) || 0) * c.gia;
        wsPhanTich[`D${r}`] = { t: "n", v: c.haoPhi };
        wsPhanTich[`E${r}`] = { t: "n", f: `DonGia!${c.priceCell}`, v: c.gia };
        wsPhanTich[`F${r}`] = { t: "n", f: `D${r}*E${r}`, v: thanhTien };
        tongDinhMuc += thanhTien;
        r++;
      });
      const lastRow = r - 1;
      XLSX.utils.sheet_add_aoa(wsPhanTich, [["", "TỔNG ĐƠN GIÁ PHÂN TÍCH", "", "", "", ""]], { origin: `A${r}` });
      wsPhanTich[`F${r}`] = { t: "n", f: `SUM(F${firstRow}:F${lastRow})`, v: tongDinhMuc };
      normTotalCell[n.id] = `F${r}`;
      normTotalValue[n.id] = tongDinhMuc;
      r += 2;
    });
    wsPhanTich["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r + 2, c: 5 } });
    wsPhanTich["!cols"] = [{ wch: 12 }, { wch: 34 }, { wch: 30 }, { wch: 10 }, { wch: 14 }, { wch: 16 }];

    // Sheet 3: BOQ — nhóm theo hạng mục công trình (WBS)
    const wsBoq = XLSX.utils.aoa_to_sheet([["Hạng mục", "ĐVT", "Khối lượng", "Đơn giá phân tích", "Thành tiền phân tích", "Đơn giá khoán", "Thành tiền khoán", "Chênh lệch %", "Tiêu chuẩn tham chiếu"]]);
    let row = 2;
    const subtotalRows = []; // dòng "Cộng nhóm" của từng hạng mục WBS — TỔNG CỘNG chỉ cần cộng các dòng này (tối đa 4 đối số, không bao giờ chạm trần 255 đối số của Excel dù dự án ngàn dòng)
    const subtotalCats = []; // [{row, name, giaTri}] — song song với subtotalRows, để sheet Dashboard tham chiếu đúng nhóm
    let tongTatCaPhanTich = 0, tongTatCaKhoan = 0;
    STANDARD_CATEGORIES.forEach((cat) => {
      const linesInCat = includedBoqLines.filter((l) => (l.boq.category || STANDARD_CATEGORIES[0].id) === cat.id);
      if (!linesInCat.length) return;
      const catStartRow = row;
      XLSX.utils.sheet_add_aoa(wsBoq, [[cat.name]], { origin: `A${row}` });
      wsBoq[`A${row}`].s = { font: { bold: true } };
      row++;
      let congNhomPhanTich = 0, congNhomKhoan = 0;
      linesInCat.forEach(({ boq, norm, calc }) => {
        XLSX.utils.sheet_add_aoa(wsBoq, [[norm.name, norm.unit]], { origin: `A${row}` });
        const donGiaPhanTich = normTotalValue[norm.id] || 0;
        const thanhTienPhanTich = boq.qty * donGiaPhanTich;
        const donGiaKhoan = Number(calc.donGiaKhoan) || 0;
        const thanhTienKhoan = boq.qty * donGiaKhoan;
        const chenhLech = donGiaPhanTich ? (donGiaKhoan - donGiaPhanTich) / donGiaPhanTich : 0;
        wsBoq[`C${row}`] = { t: "n", v: boq.qty };
        wsBoq[`D${row}`] = { t: "n", f: `PhanTich!${normTotalCell[norm.id]}`, v: donGiaPhanTich };
        wsBoq[`E${row}`] = { t: "n", f: `C${row}*D${row}`, v: thanhTienPhanTich };
        wsBoq[`F${row}`] = { t: "n", v: donGiaKhoan };
        wsBoq[`G${row}`] = { t: "n", f: `C${row}*F${row}`, v: thanhTienKhoan };
        wsBoq[`H${row}`] = { t: "n", f: `(F${row}-D${row})/D${row}`, v: chenhLech };
        wsBoq[`I${row}`] = { t: "s", v: norm.standard || "" };
        congNhomPhanTich += thanhTienPhanTich;
        congNhomKhoan += thanhTienKhoan;
        row++;
      });
      // Dòng tổng phụ cho từng nhóm hạng mục
      XLSX.utils.sheet_add_aoa(wsBoq, [[`Cộng ${cat.name}`]], { origin: `A${row}` });
      wsBoq[`E${row}`] = { t: "n", f: `SUM(E${catStartRow + 1}:E${row - 1})`, v: congNhomPhanTich };
      wsBoq[`G${row}`] = { t: "n", f: `SUM(G${catStartRow + 1}:G${row - 1})`, v: congNhomKhoan };
      subtotalRows.push(row);
      subtotalCats.push({ row, name: cat.name, giaTri: congNhomPhanTich });
      tongTatCaPhanTich += congNhomPhanTich;
      tongTatCaKhoan += congNhomKhoan;
      row++;
    });
    const totalRow = row + 1;
    XLSX.utils.sheet_add_aoa(wsBoq, [["TỔNG CỘNG"]], { origin: `A${totalRow}` });
    // Tổng cộng = cộng các dòng "Cộng nhóm" (mỗi dòng dữ liệu đều thuộc đúng 1 nhóm nên không sót/không trùng)
    wsBoq[`E${totalRow}`] = { t: "n", f: `SUM(${subtotalRows.map((r) => `E${r}`).join(",")})`, v: tongTatCaPhanTich };
    wsBoq[`G${totalRow}`] = { t: "n", f: `SUM(${subtotalRows.map((r) => `G${r}`).join(",")})`, v: tongTatCaKhoan };
    wsBoq["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow, c: 8 } });
    wsBoq["!cols"] = [{ wch: 36 }, { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 22 }];

    // THÊM MỚI (theo yêu cầu chú: xuất đủ các sheet có trong R1-25) — 9 sheet
    // BOQ_V1.1→V4.1 theo đúng form công ty (STT | Cost Code | Mô tả | ĐVT | KL
    // | Đơn giá | Thành tiền | Spec | Ghi chú). Đây là BẢN TRÌNH BÀY LẠI cùng
    // dữ liệu includedBoqLines, KHÔNG tính toán lại gì — nguồn số liệu THẬT
    // vẫn là sheet "BOQ"/"TongHop_DuToan" phía trên (đã có công thức liên kết,
    // đã test kỹ) để tránh 2 nơi tính ra 2 số khác nhau.
    const wsBoqPhaseMap = {};
    PHASE_DINH_NGHIA.forEach((p) => {
      const linesCuaPhase = includedBoqLines.filter(({ norm }) => phanLoaiPhase(norm).sheet === p.sheet);
      const aoa = [
        [p.tieuDe],
        [`Dự án: ${activeProject.name} — xuất tự động từ khối lượng đã duyệt`],
        ["STT", "Cost Code", "Mô tả công tác", "ĐVT", "Khối lượng", "Đơn giá (VNĐ)", "Thành tiền (VNĐ)", "Spec", "Ghi chú"],
      ];
      let stt = 1, tongPhase = 0;
      linesCuaPhase.forEach(({ boq, norm, calc }) => {
        const donGia = Number(calc.donGiaKhoan) || normTotalValue[norm.id] || 0;
        const thanhTien = boq.qty * donGia;
        tongPhase += thanhTien;
        aoa.push([stt++, `${p.maGoc}-${String(stt).padStart(3, "0")}`, norm.name, norm.unit, boq.qty, donGia, thanhTien, norm.standard || "", boq.ghiChu || ""]);
      });
      aoa.push(["", "", "TỔNG " + p.sheet, "", "", "", tongPhase, "", ""]);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 5 }, { wch: 14 }, { wch: 36 }, { wch: 6 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 24 }];
      wsBoqPhaseMap[p.sheet] = ws;
    });

    // Sheet 4: Dự toán tổng hợp — có thêm lớp "Dự phòng" theo đúng công thức
    // A→B→C→D trong đặc tả chuẩn (mục 10): (A) trực tiếp -> (B) dự phòng ->
    // (C) sau dự phòng -> (D) VAT -> tổng. Đặt dự phòng giữa "Giá thành" và
    // "Lợi nhuận" — sau khi đã cộng quản lý+khác, trước khi cộng lợi nhuận.
    // THEO YÊU CẦU: bỏ 2 khoản dự phòng này — không còn ý nghĩa khi khối lượng
    // đã lấy trực tiếp từ AI đọc bản vẽ thật (không phải ước lượng theo tỷ lệ
    // nữa). Đặt về 0 (không phải giữ mặc định 5%/3% cũ) để không còn âm thầm
    // cộng thêm vào giá — nếu cần điều chỉnh giá, dùng mẫu dự toán tham chiếu
    // mới thay vì % cài đặt nhỏ lẻ này.
    const duPhongKL = activeProject.duPhongKLPct ?? 0;
    const duPhongTruotGia = activeProject.duPhongTruotGiaPct ?? 0;
    const wsDuToan = XLSX.utils.aoa_to_sheet([
      ["DỰ TOÁN TỔNG HỢP", activeProject.name],
      [activeVendorId !== "internal" ? `Đơn giá theo báo giá nhà thầu: ${activeVendorName}` : "Đơn giá nội bộ (chưa chọn nhà thầu ngoài)"],
      ["Khoản mục", "Giá trị (VNĐ)", "Ghi chú"],
    ]);
    wsDuToan["A4"] = { t: "s", v: "(A) Chi phí trực tiếp (VL+NC+Máy)" };
    const v4 = tongTatCaPhanTich;
    wsDuToan["B4"] = { t: "n", f: `BOQ!E${totalRow}`, v: v4 };
    wsDuToan["A5"] = { t: "s", v: `Chi phí quản lý (${fmtPct(activeProject.quanLyPct)})` };
    const v5 = v4 * (activeProject.quanLyPct || 0);
    wsDuToan["B5"] = { t: "n", f: `B4*${activeProject.quanLyPct}`, v: v5 };
    wsDuToan["A6"] = { t: "s", v: `Chi phí khác (${fmtPct(activeProject.khacPct)})` };
    const v6 = v4 * (activeProject.khacPct || 0);
    wsDuToan["B6"] = { t: "n", f: `B4*${activeProject.khacPct}`, v: v6 };
    wsDuToan["A7"] = { t: "s", v: "Giá thành" };
    const v7 = v4 + v5 + v6;
    wsDuToan["B7"] = { t: "n", f: "B4+B5+B6", v: v7 };
    wsDuToan["A8"] = { t: "s", v: `Dự phòng khối lượng phát sinh (${fmtPct(duPhongKL)})` };
    const v8 = v7 * duPhongKL;
    wsDuToan["B8"] = { t: "n", f: `B7*${duPhongKL}`, v: v8 };
    wsDuToan["A9"] = { t: "s", v: `Dự phòng trượt giá (${fmtPct(duPhongTruotGia)})` };
    const v9 = v7 * duPhongTruotGia;
    wsDuToan["B9"] = { t: "n", f: `B7*${duPhongTruotGia}`, v: v9 };
    wsDuToan["A10"] = { t: "s", v: "(B) Tổng giá trị dự phòng" };
    const v10 = v8 + v9;
    wsDuToan["B10"] = { t: "n", f: "B8+B9", v: v10 };
    wsDuToan["A11"] = { t: "s", v: "(C) Giá thành sau dự phòng" };
    const v11 = v7 + v10;
    wsDuToan["B11"] = { t: "n", f: "B7+B10", v: v11 };
    wsDuToan["A12"] = { t: "s", v: `Lợi nhuận (${fmtPct(activeProject.loiNhuanPct)})` };
    const v12 = v11 * (activeProject.loiNhuanPct || 0);
    wsDuToan["B12"] = { t: "n", f: `B11*${activeProject.loiNhuanPct}`, v: v12 };
    wsDuToan["A13"] = { t: "s", v: "GIÁ BÁN DỰ THẦU (trước VAT)" };
    const v13 = v11 + v12;
    wsDuToan["B13"] = { t: "n", f: "B11+B12", v: v13 };
    wsDuToan["A14"] = { t: "s", v: `(D) VAT (${fmtPct(activeProject.vatPct)})` };
    const v14 = v13 * (activeProject.vatPct || 0);
    wsDuToan["B14"] = { t: "n", f: `B13*${activeProject.vatPct}`, v: v14 };
    wsDuToan["A15"] = { t: "s", v: "TỔNG DỰ TOÁN SAU THUẾ" };
    const v15 = v13 + v14;
    wsDuToan["B15"] = { t: "n", f: "B13+B14", v: v15 };
    wsDuToan["!ref"] = "A1:C15";
    wsDuToan["!cols"] = [{ wch: 40 }, { wch: 20 }, { wch: 30 }];

    // Sheet Dashboard (mục 1-2 đặc tả) — tổng hợp theo từng nhóm công tác, %
    // tỷ trọng trên (A), rồi lũy kế xuống tổng sau dự phòng + VAT. Công thức
    // tham chiếu SỐNG tới BOQ và DuToanTongHop — không hardcode số, sửa 1 chỗ
    // là toàn Dashboard tự cập nhật theo (đúng nguyên tắc chống lệch số liệu).
    const wsDashboard = XLSX.utils.aoa_to_sheet([
      ["DASHBOARD — TỔNG HỢP DỰ TOÁN", activeProject.name],
      [`Ngày xuất: ${new Date().toLocaleDateString("vi-VN")}`],
      [],
      ["Nhóm công tác", "Giá trị (VNĐ)", "% tỷ trọng"],
    ]);
    let dRow = 5;
    subtotalCats.forEach(({ row: r, name, giaTri }) => {
      wsDashboard[`A${dRow}`] = { t: "s", v: name };
      wsDashboard[`B${dRow}`] = { t: "n", f: `BOQ!E${r}`, v: giaTri };
      wsDashboard[`C${dRow}`] = { t: "n", f: `B${dRow}/BOQ!E${totalRow}`, v: v4 ? giaTri / v4 : 0, z: "0.0%" };
      dRow++;
    });
    wsDashboard[`A${dRow}`] = { t: "s", v: "(A) TỔNG CHI PHÍ TRỰC TIẾP" };
    wsDashboard[`A${dRow}`].s = { font: { bold: true } };
    wsDashboard[`B${dRow}`] = { t: "n", f: `BOQ!E${totalRow}`, v: v4 };
    wsDashboard[`C${dRow}`] = { t: "n", v: 1, z: "0.0%" };
    dRow += 2;
    [
      ["(B) Dự phòng (KL phát sinh + trượt giá)", "DuToanTongHop!B10", v10],
      ["(C) Giá thành sau dự phòng", "DuToanTongHop!B11", v11],
      ["Lợi nhuận", "DuToanTongHop!B12", v12],
      ["GIÁ BÁN TRƯỚC VAT", "DuToanTongHop!B13", v13],
      ["(D) VAT", "DuToanTongHop!B14", v14],
      ["TỔNG DỰ TOÁN SAU THUẾ", "DuToanTongHop!B15", v15],
    ].forEach(([label, ref, val]) => {
      wsDashboard[`A${dRow}`] = { t: "s", v: label };
      wsDashboard[`B${dRow}`] = { t: "n", f: ref, v: val };
      dRow++;
    });
    wsDashboard["!ref"] = `A1:C${dRow}`;
    wsDashboard["!cols"] = [{ wch: 40 }, { wch: 20 }, { wch: 14 }];

    // Sheet Assumptions — theo mục 7 đặc tả: liệt kê toàn bộ giả định/căn cứ khi
    // AI đọc bản vẽ ra khối lượng, đánh số A1, A2... để chủ đầu tư/thẩm tra dễ tra
    // cứu nguồn gốc số liệu, không phải "số từ trên trời rơi xuống".
    const dongGiaDinh = includedBoqLines.filter((l) => l.boq.ghiChu && l.boq.ghiChu.trim());
    const wsGiaDinh = XLSX.utils.aoa_to_sheet([
      ["No.", "Hạng mục", "Assumption / Diễn giải", "Căn cứ"],
      ...dongGiaDinh.map((l, i) => [`A${i + 1}`, l.norm.name, l.boq.ghiChu, "Đọc từ bản vẽ (AI hỗ trợ) — cần kiểm tra lại bởi kỹ sư QS"]),
    ]);
    wsGiaDinh["!cols"] = [{ wch: 8 }, { wch: 34 }, { wch: 50 }, { wch: 40 }];

    // Sheet hướng dẫn thiết lập in A4 — thư viện Excel miễn phí (SheetJS Community)
    // KHÔNG lưu được khổ giấy/vùng in/dòng tiêu đề lặp lại khi ghi file (đây là giới
    // hạn thật của bản miễn phí, đã kiểm chứng — các tính năng đó chỉ có ở bản trả
    // phí). Nên hướng dẫn chú tự set 1 lần trong Excel — chỉ mất dưới 1 phút, và chỉ
    // cần làm lại nếu đổi cấu trúc bảng. Đặt sheet này riêng, không phải sheet dữ
    // Sheet hướng dẫn in A4 — thư viện Excel miễn phí không tự lưu được khổ giấy/
    // hướng in/vùng in (chỉ bản trả phí mới làm được, đã kiểm chứng), nên in sẵn
    // hướng dẫn 1 lần ngay trong file để chú/nhân viên không quên mỗi lần in.
    const wsHuongDanIn = XLSX.utils.aoa_to_sheet([
      ["HƯỚNG DẪN THIẾT LẬP IN A4 (làm 1 lần, mất dưới 1 phút)"],
      [""],
      ["File này do phần mềm miễn phí tạo ra — chưa tự set sẵn khổ giấy/vùng in được (giới hạn của thư viện miễn phí). Chú làm theo các bước sau trên sheet \"BOQ\" (hoặc sheet muốn in):"],
      [""],
      ["1. Mở sheet cần in (VD: BOQ) → vào tab \"Page Layout\" (Bố cục trang)"],
      ["2. Orientation (Hướng giấy) → chọn \"Landscape\" (Ngang) — vì bảng nhiều cột"],
      ["3. Size (Cỡ giấy) → chọn \"A4\""],
      ["4. Bôi đen toàn bộ vùng bảng cần in → Print Area (Vùng in) → \"Set Print Area\""],
      ["5. Sheet BOQ đã TỰ ĐỘNG lặp dòng tiêu đề mỗi trang khi in (không cần set tay) — sheet khác nếu cần thì tự làm như bước 4-5 cũ"],
      ["6. Vào File → Print → xem Print Preview → nếu bảng bị cắt ngang, chọn \"Fit Sheet on One Page\" hoặc \"Scale to Fit\" → Width = 1 page"],
      [""],
      ["Làm xong 1 lần, Excel tự nhớ thiết lập cho lần lưu/in sau (trừ khi mở file mới xuất lại từ app)."],
    ]);
    wsHuongDanIn["!cols"] = [{ wch: 100 }];
    wsHuongDanIn["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];

    const wb = XLSX.utils.book_new();
    // Đặt lề trang chuẩn cho các sheet dữ liệu chính — margins LÀ thứ duy nhất thư
    // viện miễn phí giữ được khi ghi file (đã test xác nhận), nên set sẵn cho đỡ
    // phải chỉnh tay phần này.
    const LE_CHUAN = { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
    wsBoq["!margins"] = LE_CHUAN;
    wsDashboard["!margins"] = LE_CHUAN;
    wsDuToan["!margins"] = LE_CHUAN;

    // Sheet Tổng hợp khối lượng theo tầng — sau khi bắt AI tách riêng từng dòng
    // theo từng tầng (để KS/QS tự đối chiếu, không tin 1 số gộp mù mờ), app TỰ
    // CỘNG LẠI bằng phép tính đơn giản (không phải AI cộng — chắc chắn không sai
    // số học) để ra tổng cuối cùng theo từng hạng mục, không cần cộng tay.
    const bocTachTenGocVaTang = (tenDay) => {
      const m = tenDay.match(/^(.*?)\s*[-–—]\s*T[aầ]ng\s*(\d+)\s*$/iu);
      return m ? { tenGoc: m[1].trim(), tang: m[2] } : { tenGoc: tenDay, tang: null };
    };
    const nhomTheoTang = {};
    includedBoqLines.forEach(({ norm, boq }) => {
      const { tenGoc, tang } = bocTachTenGocVaTang(norm.name);
      if (!tang) return; // chỉ gom các dòng THẬT SỰ có tách theo tầng
      if (!nhomTheoTang[tenGoc]) nhomTheoTang[tenGoc] = { unit: norm.unit, theoTang: {}, tong: 0 };
      nhomTheoTang[tenGoc].theoTang[tang] = (nhomTheoTang[tenGoc].theoTang[tang] || 0) + boq.qty;
      nhomTheoTang[tenGoc].tong += boq.qty;
    });
    const tenNhom = Object.keys(nhomTheoTang);
    let wsTongHopTang = null;
    if (tenNhom.length) {
      const tatCaTang = [...new Set(tenNhom.flatMap((t) => Object.keys(nhomTheoTang[t].theoTang)))].sort((a, b) => Number(a) - Number(b));
      const header = ["Hạng mục", "ĐVT", ...tatCaTang.map((t) => `Tầng ${t}`), "TỔNG CỘNG"];
      const aoa = [
        ["TỔNG HỢP KHỐI LƯỢNG THEO TẦNG — " + (activeProject?.name || "")],
        ["Tự động cộng dồn từ các dòng đã tách riêng theo từng tầng (không phải AI cộng — phép tính số học đơn giản, không sai)"],
        [],
        header,
      ];
      tenNhom.forEach((tg) => {
        const nhom = nhomTheoTang[tg];
        aoa.push([tg, nhom.unit, ...tatCaTang.map((t) => nhom.theoTang[t] ? +nhom.theoTang[t].toFixed(2) : ""), +nhom.tong.toFixed(2)]);
      });
      wsTongHopTang = XLSX.utils.aoa_to_sheet(aoa);
      wsTongHopTang["!cols"] = [{ wch: 35 }, { wch: 8 }, ...tatCaTang.map(() => ({ wch: 10 })), { wch: 12 }];
    }

    // Sheet Đối chiếu nghiệm thu — CHỈ tạo khi có ít nhất 1 dòng đã nhập khối
    // lượng nghiệm thu thực tế. Đây chính là dữ liệu tích luỹ dần cho "Golden
    // Dataset" tự thân của công ty — không cần chờ dữ liệu công trình mẫu ngoài,
    // mỗi dự án xây xong nhập vào đây là có thêm 1 điểm dữ liệu thật.
    const dongCoNghiemThu = includedBoqLines.filter((l) => l.boq.qtyNghiemThu != null && l.boq.qtyNghiemThu > 0);
    let wsNghiemThu = null;
    if (dongCoNghiemThu.length) {
      const aoaNt = [
        ["ĐỐI CHIẾU KHỐI LƯỢNG NGHIỆM THU THỰC TẾ — " + (activeProject?.name || "")],
        ["Dùng để tự đánh giá độ chính xác dự toán ban đầu — tích luỹ dần qua từng dự án đã hoàn thành"],
        [],
        ["Hạng mục", "ĐVT", "KL dự toán ban đầu", "KL nghiệm thu thực tế", "Sai số tuyệt đối", "Sai số %"],
      ];
      let sumSaiSoPhanTram = 0;
      dongCoNghiemThu.forEach(({ norm, boq }) => {
        const saiSoTuyetDoi = Math.abs(boq.qty - boq.qtyNghiemThu);
        const saiSoPhanTram = (saiSoTuyetDoi / boq.qtyNghiemThu) * 100;
        sumSaiSoPhanTram += saiSoPhanTram;
        aoaNt.push([norm.name, norm.unit, boq.qty, boq.qtyNghiemThu, +saiSoTuyetDoi.toFixed(2), +saiSoPhanTram.toFixed(1)]);
      });
      aoaNt.push([]);
      aoaNt.push(["Sai số trung bình toàn dự án:", "", "", "", "", +(sumSaiSoPhanTram / dongCoNghiemThu.length).toFixed(1)]);
      wsNghiemThu = XLSX.utils.aoa_to_sheet(aoaNt);
      wsNghiemThu["!cols"] = [{ wch: 40 }, { wch: 8 }, { wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 12 }];
    }

    // PRICE_MISSING), không cần thêm khái niệm dữ liệu mới nào. Đây là bằng chứng
    // sheet này KHÔNG bị chặn kỹ thuật gì — chỉ đơn giản là trước đây chưa viết.
    const soConfirmedQc = includedBoqLines.filter((l) => l.calc?.trangThai === "CONFIRMED").length;
    const soQcMissingQc = includedBoqLines.filter((l) => l.calc?.trangThai === "QC_MISSING").length;
    const soPriceMissingQc = includedBoqLines.filter((l) => l.calc?.trangThai === "PRICE_MISSING").length;
    const wsQc = XLSX.utils.aoa_to_sheet([
      ["BÁO CÁO QC — " + (activeProject?.name || "")],
      [`Xuất ngày: ${new Date().toLocaleDateString("vi-VN")}`],
      [],
      ["Trạng thái", "Số dòng", "Ý nghĩa"],
      ["CONFIRMED", soConfirmedQc, "Đã có giá thật, không phải định mức tự tạo"],
      ["QC_MISSING", soQcMissingQc, "Định mức tự tạo khi duyệt hàng loạt — CẦN kỹ sư kiểm tra lại tên + giá"],
      ["PRICE_MISSING", soPriceMissingQc, "Định mức/tên đã đúng nhưng giá cuối = 0đ — CẦN bổ sung giá"],
      [],
      ["CHI TIẾT CÁC DÒNG CẦN XỬ LÝ (QC_MISSING + PRICE_MISSING)"],
      ["Hạng mục", "Trạng thái", "Khối lượng", "Nguồn/căn cứ"],
    ]);
    let qcRow = 11;
    includedBoqLines.filter((l) => l.calc?.trangThai !== "CONFIRMED").forEach(({ norm, boq, calc }) => {
      XLSX.utils.sheet_add_aoa(wsQc, [[norm.name, calc.trangThai, boq.qty, boq.ghiChu || boq.sourcePhoto || ""]], { origin: `A${qcRow}` });
      qcRow++;
    });
    wsQc["!cols"] = [{ wch: 45 }, { wch: 15 }, { wch: 25 }, { wch: 12 }, { wch: 50 }];

    // Sheet Revision — dùng ĐÚNG dữ liệu revisionSnapshots đã có sẵn từ mục 13
    // (BOQ Lock + Revision Delta) — không cần dữ liệu mới, chỉ xuất ra Excel.
    const cacSnapshotDuAn = revisionSnapshots.filter((s) => s.projectId === activeProjectId);
    const wsRevision = XLSX.utils.aoa_to_sheet([
      ["LỊCH SỬ PHIÊN BẢN (REVISION) — " + (activeProject?.name || "")],
      [`Trạng thái khoá hiện tại: ${activeProject?.khoaBoq ? "🔒 ĐANG KHOÁ (đã chốt)" : "🔓 Đang mở, sửa được"}`],
      [],
      ["Tên phiên bản", "Thời điểm lưu", "Số dòng BOQ lúc đó"],
    ]);
    let revRow = 5;
    cacSnapshotDuAn.forEach((s) => {
      XLSX.utils.sheet_add_aoa(wsRevision, [[s.ten, s.when, s.items.length]], { origin: `A${revRow}` });
      revRow++;
    });
    if (!cacSnapshotDuAn.length) {
      XLSX.utils.sheet_add_aoa(wsRevision, [["(Chưa lưu phiên bản nào — vào thẻ Điều chỉnh dự toán → \"Chốt phiên bản\" để bắt đầu lưu mốc)"]], { origin: "A5" });
    }
    wsRevision["!cols"] = [{ wch: 30 }, { wch: 20 }, { wch: 18 }];

    XLSX.utils.book_append_sheet(wb, wsHuongDanIn, "HuongDanIn");
    XLSX.utils.book_append_sheet(wb, wsDashboard, "Dashboard");
    XLSX.utils.book_append_sheet(wb, wsDuToan, "TongHop_DuToan");
    XLSX.utils.book_append_sheet(wb, wsBoq, "BOQ");
    // THÊM MỚI (theo yêu cầu chú): 9 sheet BOQ_V1.1→V4.1 đúng tên/thứ tự file mẫu R1-25
    PHASE_DINH_NGHIA.forEach((p) => XLSX.utils.book_append_sheet(wb, wsBoqPhaseMap[p.sheet], p.sheet));
    XLSX.utils.book_append_sheet(wb, wsPhanTich, "PhanTich");
    XLSX.utils.book_append_sheet(wb, wsDonGia, "DonGia");
    XLSX.utils.book_append_sheet(wb, wsQc, "QC");
    XLSX.utils.book_append_sheet(wb, wsRevision, "Revision History");
    if (wsTongHopTang) XLSX.utils.book_append_sheet(wb, wsTongHopTang, "TongHopTheoTang");

    // Sheet WBS-CostCode — KHÔNG chờ công ty chốt quy tắc mã hoá chính thức nữa.
    // Dùng TẠM mã định mức đã có sẵn (VD "AK.21100") làm mã WBS, gom theo đúng 4
    // nhóm công tác chuẩn (Móng/Khung/Hoàn thiện/MEP) đã dùng xuyên suốt app. Khi
    // công ty chốt được quy tắc mã riêng, chỉ cần đổi cột "Mã WBS tạm" — cấu trúc
    // sheet không đổi.
    const wbsRows = [
      ["WBS - COST CODE (mã tạm, dùng mã định mức có sẵn — CHƯA phải mã chính thức của công ty)"],
      ["Khi công ty chốt quy tắc mã hoá riêng, thay cột \"Mã WBS tạm\" — không cần đổi cấu trúc sheet này"],
      [],
      ["STT", "Mã WBS tạm", "Tên hạng mục", "Nhóm công tác", "ĐVT"],
    ];
    let wbsStt = 1;
    STANDARD_CATEGORIES.forEach((cat) => {
      const normsTrongNhom = includedBoqLines
        .filter((l) => (l.boq.category || STANDARD_CATEGORIES[0].id) === cat.id)
        .map((l) => l.norm)
        .filter((n, i, arr) => arr.findIndex((x) => x.id === n.id) === i); // loại trùng định mức
      if (!normsTrongNhom.length) return;
      normsTrongNhom.forEach((n) => {
        wbsRows.push([wbsStt++, n.code || `TAM-${n.id}`, n.name, cat.name, n.unit]);
      });
    });
    const wsWbs = XLSX.utils.aoa_to_sheet(wbsRows);
    wsWbs["!cols"] = [{ wch: 6 }, { wch: 18 }, { wch: 45 }, { wch: 28 }, { wch: 8 }];
    if (wbsRows.length > 4) XLSX.utils.book_append_sheet(wb, wsWbs, "WBS-CostCode");

    if (wsNghiemThu) XLSX.utils.book_append_sheet(wb, wsNghiemThu, "DoiChieuNghiemThu");
    if (dongGiaDinh.length) XLSX.utils.book_append_sheet(wb, wsGiaDinh, "Assumptions");

    // Lặp lại dòng tiêu đề đầu sheet BOQ trên MỌI trang khi in — thư viện Excel
    // miễn phí không hỗ trợ "!pageSetup" (đã kiểm chứng, bị bỏ qua khi ghi file),
    // nhưng CÓ hỗ trợ cấp thấp hơn qua tên định nghĩa "_xlnm.Print_Titles" của
    // chính Excel — đã test ghi+đọc lại, sống sót nguyên vẹn.
    if (!wb.Workbook) wb.Workbook = {};
    if (!wb.Workbook.Names) wb.Workbook.Names = [];
    wb.Workbook.Names.push({ Sheet: wb.SheetNames.indexOf("BOQ"), Name: "_xlnm.Print_Titles", Ref: "'BOQ'!$1:$1" });

    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([out], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const filename = `BOQ_${activeProject.name.replace(/[^\w]+/g, "_").slice(0, 40)}.xlsx`;
    setLastExport({ url, filename });
    let tuTaiDuoc = false;
    try {
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      tuTaiDuoc = true;
    } catch (e) {
      tuTaiDuoc = false;
    }
    showToast(
      tuTaiDuoc
        ? 'Đã tạo file Excel — CÓ CÔNG THỨC LIÊN KẾT thật giữa 4 sheet. Trên iPhone/Safari, file thường chỉ MỞ XEM TRƯỚC chứ chưa tự lưu — bấm nút "Tải xuống" bên dưới, rồi bấm biểu tượng Chia sẻ (hộp mũi tên) → "Lưu vào Tệp" để lưu thật vào máy.'
        : 'File Excel đã tạo xong nhưng trình duyệt CHẶN tự tải xuống. Bấm nút "Tải xuống" bên dưới để lưu thủ công (trên iPhone: sau khi mở, bấm biểu tượng Chia sẻ → "Lưu vào Tệp").',
      tuTaiDuoc ? "ok" : "warn"
    );
  };

  // ---- Xuất báo cáo NỘI BỘ (giá vốn & lợi nhuận) — tách riêng khỏi file gửi khách hàng ----
  const exportInternalExcel = () => {
    if (!includedBoqLines.length) {
      showToast("Chưa có dòng BOQ nào để xuất báo cáo nội bộ.", "warn");
      return;
    }
    const XLSXLive = (typeof window !== "undefined" && window.XLSX && window.XLSX.utils) ? window.XLSX : null;
    if (!XLSXLive) {
      showToast('Thư viện tạo file Excel chưa tải xong (cần internet). Đợi vài giây rồi thử lại, hoặc tải lại trang.', "error");
      return;
    }
    try {
      exportInternalExcelThat(XLSXLive);
    } catch (e) {
      showToast(`Lỗi khi tạo file Excel nội bộ: ${e.message}.`, "error");
    }
  };

  const exportInternalExcelThat = (XLSX) => {
    const money = "#,##0";
    const aoa = [
      ["TÀI LIỆU NỘI BỘ - KHÔNG GỬI CHO KHÁCH HÀNG"],
      [`${activeProject.name} — Phân tích Giá vốn & Lợi nhuận`],
      [`Ngày lập: ${new Date().toLocaleDateString("vi-VN")}`],
      [],
      ["Hạng mục", "ĐVT", "Khối lượng", "Giá vốn VT", "Giá vốn NC", "Giá vốn Máy", "Chi phí trực tiếp", "ĐG khoán", "Thành tiền khoán", "Lợi nhuận (đ)", "Biên LN %"],
    ];
    const start = aoa.length;
    let tVt = 0, tNc = 0, tMay = 0, tDirect = 0, tKhoan = 0, tLN = 0;
    includedBoqLines.forEach(({ boq, norm, calc }) => {
      const vtCost = boq.qty * calc.analyzed.vlCost;
      const ncCost = boq.qty * calc.analyzed.ncCost;
      const mayCost = boq.qty * calc.analyzed.mayCost;
      const directCost = vtCost + ncCost + mayCost;
      const loiNhuan = calc.thanhTienKhoan - directCost;
      const bienLN = calc.thanhTienKhoan ? (loiNhuan / calc.thanhTienKhoan) * 100 : 0;
      tVt += Math.round(vtCost); tNc += Math.round(ncCost); tMay += Math.round(mayCost);
      tDirect += Math.round(directCost); tKhoan += Math.round(calc.thanhTienKhoan); tLN += Math.round(loiNhuan);
      aoa.push([
        norm.name, norm.unit, boq.qty,
        Math.round(vtCost), Math.round(ncCost), Math.round(mayCost), Math.round(directCost),
        Math.round(calc.donGiaKhoan), Math.round(calc.thanhTienKhoan), Math.round(loiNhuan), +bienLN.toFixed(1),
      ]);
    });
    const end = aoa.length - 1;
    aoa.push([
      "", "TỔNG CỘNG", "",
      { t: "n", f: `SUM(D${start + 1}:D${end + 1})`, v: tVt }, { t: "n", f: `SUM(E${start + 1}:E${end + 1})`, v: tNc }, { t: "n", f: `SUM(F${start + 1}:F${end + 1})`, v: tMay },
      { t: "n", f: `SUM(G${start + 1}:G${end + 1})`, v: tDirect }, "", { t: "n", f: `SUM(I${start + 1}:I${end + 1})`, v: tKhoan }, { t: "n", f: `SUM(J${start + 1}:J${end + 1})`, v: tLN }, "",
    ]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 34 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 15 }, { wch: 14 }, { wch: 15 }, { wch: 14 }, { wch: 10 }];
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 10 } },
    ];
    for (let r = start; r <= end + 1; r++) {
      for (const c of [3, 4, 5, 6, 7, 8, 9]) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell) cell.z = money;
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "NoiBo_GiaVon_LoiNhuan");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([out], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const filename = `BOQ_${activeProject.name.replace(/[^\w]+/g, "_").slice(0, 40)}_NOIBO.xlsx`;
    try {
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {}
    showToast('Đã tạo báo cáo NỘI BỘ (giá vốn & lợi nhuận) — CHỈ dùng nội bộ, không gửi khách hàng. File "Xuất Excel" thường vẫn chỉ có giá bán như bình thường, an toàn để gửi báo giá.');
  };

  // ==========================================================================
  // Màn hình nhập mã truy cập — chỉ hiện khi server có bật phân quyền và chưa
  // đăng nhập. Nếu quản trị chưa khai báo ACCESS_CODES thì app mở bình thường.
  if (BACKEND_URL && authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: PAPER, color: SLATE, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <div className="text-sm">Đang kiểm tra quyền truy cập… (nếu server vừa ngủ dậy, chờ khoảng 50 giây)</div>
      </div>
    );
  }
  if (BACKEND_URL && !authUser) {
    return <LoginGate onSubmit={dangNhap} error={authError} onRetry={() => kiemTraMa(accessCode)} />;
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: PAPER, color: INK, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <style>{`
        .num-input::-webkit-outer-spin-button,.num-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-3" style={{ background: NAVY, color: "white" }}>
        <div className="flex items-center gap-4 min-w-0">
          <div>
            <div className="text-white font-bold text-sm tracking-wide">QS/QC ESTIMATE</div>
            <div className="text-xs" style={{ color: "#9FB2C4" }}>Master Database · 5 nhóm công trình</div>
          </div>
          <div className="border-l pl-4" style={{ borderColor: "rgba(255,255,255,0.15)" }}>
            <select
              value={activeProjectId}
              onChange={(e) => setActiveProjectId(e.target.value)}
              className="text-white text-sm font-semibold outline-none"
              style={{ background: NAVY_DARK, border: "1px solid rgba(255,255,255,0.2)", borderRadius: 4, padding: "4px 8px" }}
            >
              {projects.map((p) => <option key={p.id} value={p.id} style={{ color: INK }}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <MiniStat label="Giá vốn" value={hasData ? fmt(totals.truc_tiep) : "—"} />
          <MiniStat label="Giá bán dự thầu" value={hasData ? fmt(totals.giaBanTruocVAT) : "—"} highlight />
          <div className="text-xs flex items-center gap-1.5" style={{ color: "#9FB2C4" }}>
            {saveState === "saving" && <><Save size={12} className="animate-pulse" /> Đang lưu…</>}
            {saveState === "saved" && <><CheckCircle2 size={12} color={GREEN} /> Đã lưu</>}
            {saveState === "error" && <><AlertTriangle size={12} color={RED} /> Lỗi lưu</>}
          </div>
          {authUser?.coPhanQuyen && (
            <div className="text-xs flex items-center gap-2" style={{ color: "#9FB2C4" }}>
              <span>👤 {authUser.ten}{authUser.quanTri ? " (quản trị)" : ""}</span>
              <button onClick={dangXuat} className="underline">Thoát</button>
            </div>
          )}
        </div>
      </div>

      <div className="no-print flex overflow-x-auto" style={{ background: NAVY_DARK }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className="flex items-center gap-2 px-4 py-2.5 shrink-0"
              style={{ background: active ? "rgba(217,130,43,0.16)" : "transparent", borderBottom: active ? `3px solid ${AMBER}` : "3px solid transparent" }}
            >
              <Icon size={16} color={active ? AMBER : "#9FB2C4"} />
              <span className="text-sm font-medium whitespace-nowrap" style={{ color: active ? "white" : "#D7E1EA" }}>{t.label}</span>
            </button>
          );
        })}
      </div>

      {toast && (
        <div
          className="no-print mx-6 mt-4 px-4 py-3 rounded text-sm flex items-center gap-2"
          style={{
            background: toast.kind === "error" ? "#FBE7E4" : toast.kind === "warn" ? "#FCF1DC" : "#E7F3EC",
            color: toast.kind === "error" ? RED : toast.kind === "warn" ? AMBER_DARK : GREEN,
            border: `1px solid ${toast.kind === "error" ? RED : toast.kind === "warn" ? AMBER : GREEN}`,
          }}
        >
          {toast.kind === "error" ? <AlertTriangle size={16} /> : toast.kind === "warn" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          {toast.msg}
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {activeTab === "projects" && (
          <ProjectsTab
            projects={projects} activeProjectId={activeProjectId} setActiveProjectId={setActiveProjectId} addProject={addProject} updateProjectSetting={updateProjectSetting} activeProject={activeProject} boqLines={boqLines}
            materials={materials} labor={labor}
            priceImportKind={priceImportKind} setPriceImportKind={setPriceImportKind}
            priceImportGroupId={priceImportGroupId} setPriceImportGroupId={setPriceImportGroupId}
            handlePriceImportFile={handlePriceImportFile}
            priceImportResults={priceImportResults} priceImportReport={priceImportReport}
            applyPriceImportRow={applyPriceImportRow} applyAllPriceImport={applyAllPriceImport}
            cancelPriceImport={cancelPriceImport} skipPriceImportRow={skipPriceImportRow}
            importBatch={importBatch} undoImportBatch={undoImportBatch}
            updateMaterialPrice={updateMaterialPrice} updateMaterialField={updateMaterialField} updateLaborPrice={updateLaborPrice}
            addMaterial={addMaterial} removeMaterial={removeMaterial} removeLabor={removeLabor}
            norms={projectNorms} materialsById={materialsById} laborById={laborById} addNorm={addNorm} changeLog={changeLog}
            priceLog={priceLog} applyPriceSlide={applyPriceSlide} undoLastAdjustment={undoLastAdjustment} adjustHistory={adjustHistory}
            boqTemplates={boqTemplates} saveAsTemplate={saveAsTemplate} createProjectFromTemplate={createProjectFromTemplate} deleteTemplate={deleteTemplate} soSanhVoiMau={soSanhVoiMau} themDauViecThieu={themDauViecThieu} xoaDauViecThua={xoaDauViecThua}
            handleBoqTemplateImportFile={handleBoqTemplateImportFile} boqTplImportResults={boqTplImportResults} taoMauTuFileImport={taoMauTuFileImport} huyBoqTplImport={huyBoqTplImport}
          />
        )}
        {activeTab === "vendors" && (
          <VendorTab
            vendors={vendors} activeVendorId={activeVendorId} setActiveVendorId={setActiveVendorId} addVendor={addVendor} removeVendor={removeVendor}
            vendorPrices={vendorPrices} updateVendorPrice={updateVendorPrice}
            materials={materials} labor={labor} activeProject={activeProject}
            vendorImportKind={vendorImportKind} setVendorImportKind={setVendorImportKind} handleVendorImportFile={handleVendorImportFile}
            vendorImportResults={vendorImportResults} vendorImportReport={vendorImportReport}
            applyVendorImportRow={applyVendorImportRow} applyAllVendorImport={applyAllVendorImport}
            cancelVendorImport={cancelVendorImport} skipVendorImportRow={skipVendorImportRow}
            vendorImportBatch={vendorImportBatch} undoVendorImportBatch={undoVendorImportBatch}
          />
        )}
        {activeTab === "drawings" && (
          <DrawingsTab
            versions={projectVersions} photos={projectPhotos} addDrawingVersion={addDrawingVersion} handlePhotoFiles={handlePhotoFiles}
            analyzePhotoAI={analyzePhotoAI} analyzePhotosBatchAI={analyzePhotosBatchAI} aiAnalyzing={aiAnalyzing} aiProgress={aiProgress} aiError={aiError} aiResults={projectAiResults} lastRawDebug={lastRawDebug} lastPipelineTrace={lastPipelineTrace} lastDrawingModel={lastDrawingModel} applyAiResult={applyAiResult} skipAiResult={skipAiResult} applyAllAiResults={applyAllAiResults}
            projects={projects} activeProjectId={activeProjectId} setActiveProjectId={setActiveProjectId}
            projectNorms={projectNorms}
            drawingFiles={projectDrawingFiles} handleDrawingFiles={handleDrawingFiles} removeDrawingFile={removeDrawingFile} removePhoto={removePhoto} removeAllPhotos={removeAllPhotos}
            analyzePdfAI={analyzePdfAI} pdfAiAnalyzing={pdfAiAnalyzing} pdfAiProgress={pdfAiProgress} dongHoGiay={dongHoGiay}
            docFileDxf={docFileDxf}
            boqLines={boqLines} activeProject={activeProject} setActiveTab={setActiveTab} aiCostLast={aiCostLast} aiCostTotal={aiCostTotal} testBackend={testBackend} connTest={connTest} connTesting={connTesting} authUser={authUser} authHeaders={authHeaders}
            danhSachChuanInfo={layDanhSachChuanTheoNhom()}
            soSanhMauLienKet={activeProject?.mauLienKet ? soSanhVoiMau(activeProject.mauLienKet) : null}
            themDauViecThieu={themDauViecThieu}
          />
        )}
        {activeTab === "exportHub" && (
          <ExportHubTab boqLines={includedBoqLines} totals={totals} hasData={hasData} activeProject={activeProject} exportExcel={exportExcel} exportInternalExcel={exportInternalExcel} exportPdfThat={exportPdfThat} lastExport={lastExport} setActiveTab={setActiveTab} projectBoqTho={projectBoq} normsById={normsById} />
        )}
        {activeTab === "adjust" && (
          <AdjustTab
            boqLines={boqLines} projectNorms={projectNorms} addBoqItem={addBoqItem} updateBoqItem={updateBoqItem} removeBoqItem={removeBoqItem} toggleBoqItemIncluded={toggleBoqItemIncluded} activeProject={activeProject}
            xoaToanBoBoqDuAn={xoaToanBoBoqDuAn}
            handleTakeoffImportFile={handleTakeoffImportFile} takeoffImportResults={takeoffImportResults} takeoffImportReport={takeoffImportReport}
            applyTakeoffImportRow={applyTakeoffImportRow} applyAllTakeoffImport={applyAllTakeoffImport} cancelTakeoffImport={cancelTakeoffImport} skipTakeoffImportRow={skipTakeoffImportRow}
            takeoffImportBatch={takeoffImportBatch} undoTakeoffImportBatch={undoTakeoffImportBatch}
            changeLog={changeLog}
            revisionSnapshots={revisionSnapshots} luuSnapshotBoq={luuSnapshotBoq} soSanhSnapshot={soSanhSnapshot} normsById={normsById}
          />
        )}
        {activeTab === "dashboard" && (
          <DashboardTab totals={totals} hasData={hasData} />
        )}
      </div>
    </div>
  );
}

// ============================================================================
function MiniStat({ label, value, highlight }) {
  return (
    <div>
      <div className="text-xs" style={{ color: "#B9CADA" }}>{label}</div>
      <div className="font-mono font-bold" style={{ fontSize: highlight ? 16 : 14, color: highlight ? AMBER : "white" }}>{value}</div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, desc }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <div className="p-2 rounded" style={{ background: NAVY }}><Icon size={18} color="white" /></div>
      <div>
        <h2 className="text-lg font-bold" style={{ color: NAVY }}>{title}</h2>
        <p className="text-sm" style={{ color: SLATE }}>{desc}</p>
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="text-center py-14 border rounded bg-white" style={{ borderColor: LINE, color: SLATE }}>
      <Info size={22} className="mx-auto mb-2" style={{ opacity: 0.4 }} />
      <p className="text-sm">{text}</p>
    </div>
  );
}

// ============================================================================
// TAB 1: DỰ ÁN (Project Hub)
// ============================================================================
function ProjectsTab({
  projects, activeProjectId, setActiveProjectId, addProject, updateProjectSetting, activeProject, boqLines,
  materials, labor, priceImportKind, setPriceImportKind, priceImportGroupId, setPriceImportGroupId,
  handlePriceImportFile, priceImportResults, priceImportReport, applyPriceImportRow, applyAllPriceImport,
  cancelPriceImport, skipPriceImportRow, importBatch, undoImportBatch,
  updateMaterialPrice, updateMaterialField, updateLaborPrice, addMaterial, removeMaterial, removeLabor,
  norms, materialsById, laborById, addNorm, changeLog,
  priceLog, applyPriceSlide, undoLastAdjustment, adjustHistory,
  boqTemplates, saveAsTemplate, createProjectFromTemplate, deleteTemplate, soSanhVoiMau, themDauViecThieu, xoaDauViecThua,
  handleBoqTemplateImportFile, boqTplImportResults, taoMauTuFileImport, huyBoqTplImport,
}) {
  const [name, setName] = useState("");
  const [tplSaveName, setTplSaveName] = useState("");
  const [tplImportName, setTplImportName] = useState("");
  const [tplImportGroupId, setTplImportGroupId] = useState(PROJECT_GROUPS[0].id);
  const [tplPick, setTplPick] = useState("");
  const [tplNewProjectName, setTplNewProjectName] = useState("");
  const [groupId, setGroupId] = useState(PROJECT_GROUPS[0].id);
  const [tabMauThamChieu, setTabMauThamChieu] = useState(null); // null = tự chọn theo trạng thái hiện có

  return (
    <div>
      <SectionHeader icon={Building2} title="Quản lý Dự án (Project Hub)" desc="Chọn nhóm công trình khi tạo dự án — app tự nạp định mức Master áp dụng cho nhóm đó. Dữ liệu Master dùng chung cho mọi dự án; sửa riêng cho 1 dự án (Local) không ảnh hưởng dự án khác." />

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        {projects.map((p) => {
          const grp = PROJECT_GROUPS.find((g) => g.id === p.groupId);
          const active = p.id === activeProjectId;
          const lineCount = active ? boqLines.length : null;
          return (
            <div key={p.id} className="bg-white border-2 rounded p-4" style={{ borderColor: active ? AMBER : LINE }}>
              <div className="font-semibold text-sm">{p.name}</div>
              <div className="text-xs mt-1" style={{ color: SLATE }}>Nhóm: {grp?.name} · Tạo ngày {p.createdAt}</div>
              {lineCount !== null && <div className="text-xs mt-1" style={{ color: NAVY }}>{lineCount} dòng BOQ</div>}
              <button
                onClick={() => setActiveProjectId(p.id)}
                disabled={active}
                className="mt-3 w-full py-1.5 rounded text-xs font-medium disabled:opacity-50"
                style={{ background: active ? LINE : NAVY, color: active ? SLATE : "white" }}
              >
                {active ? "Đang làm việc" : "Chọn dự án này"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-8 items-start">
        <div className="bg-white border rounded p-4" style={{ borderColor: LINE }}>
          <div className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: NAVY }}><FolderPlus size={15} /> Tạo dự án mới</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên dự án" className="border rounded px-3 py-2 text-sm w-full mb-2" style={{ borderColor: LINE }} />
          <div className="text-xs mb-1" style={{ color: SLATE }}>Loại công trình</div>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="border rounded px-3 py-2 text-sm w-full mb-2" style={{ borderColor: LINE }}>
            {PROJECT_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <p className="text-xs mb-3" style={{ color: SLATE }}>{PROJECT_GROUPS.find((g) => g.id === groupId)?.note}</p>
          <button
            onClick={() => { if (name.trim()) { addProject(name.trim(), groupId); setName(""); } }}
            disabled={!name.trim()}
            className="w-full py-2 rounded text-white text-sm font-medium disabled:opacity-40"
            style={{ background: NAVY }}
          >
            Tạo dự án
          </button>
          <p className="text-xs mt-2" style={{ color: AMBER_DARK }}>
            Chọn "Loại công trình" ở đây sẽ tự liên kết xuống mục "Dự toán mẫu" bên dưới — đơn giá/định mức hiển thị luôn đúng theo nhóm vừa chọn.
          </p>
        </div>

        {activeProject && (
          <div className="bg-white border rounded p-4" style={{ borderColor: LINE }}>
            <div className="text-sm font-semibold mb-3" style={{ color: NAVY }}>Tham số dự toán — "{activeProject.name}"</div>

            <div className="p-3 rounded border mb-4 flex items-center justify-between" style={{ borderColor: activeProject.khoaBoq ? RED : LINE, background: activeProject.khoaBoq ? "#FCEBEA" : "#F6F8FA" }}>
              <div>
                <div className="text-sm font-semibold" style={{ color: activeProject.khoaBoq ? RED : NAVY }}>{activeProject.khoaBoq ? "🔒 BOQ đang KHOÁ" : "🔓 BOQ đang mở, sửa được"}</div>
                <div className="text-xs" style={{ color: SLATE }}>{activeProject.khoaBoq ? "Đã chốt phiên bản — không sửa/xoá/thêm dòng được nữa. Mở khoá nếu thực sự cần sửa lại." : "Khoá lại khi đã chốt BOQ để gửi khách/chủ đầu tư, tránh sửa nhầm sau khi đã gửi."}</div>
              </div>
              <button
                onClick={() => updateProjectSetting("khoaBoq", !activeProject.khoaBoq)}
                className="text-xs px-3 py-1.5 rounded text-white font-semibold shrink-0"
                style={{ background: activeProject.khoaBoq ? GREEN : RED }}
              >
                {activeProject.khoaBoq ? "Mở khoá" : "🔒 Khoá BOQ (chốt phiên bản)"}
              </button>
            </div>

            <div className="p-3 rounded border mb-4" style={{ borderColor: NAVY, background: "#EEF3F8" }}>
              <div className="text-sm font-semibold mb-1" style={{ color: NAVY }}>Mẫu dự toán liên kết (bắt buộc để đọc bản vẽ đúng)</div>
              <p className="text-xs mb-2" style={{ color: SLATE }}>Gắn CHÍNH XÁC 1 mẫu cho dự án này — mọi lần đọc bản vẽ + so sánh khối lượng sau đó CHỈ dùng đúng mẫu đã gắn, không tự dò tìm lung tung giữa nhiều mẫu cùng loại.</p>
              <select
                value={activeProject.mauLienKet || ""}
                onChange={(e) => updateProjectSetting("mauLienKet", e.target.value)}
                className="border rounded px-2 py-1.5 text-sm w-full"
                style={{ borderColor: activeProject.mauLienKet ? GREEN : AMBER }}
              >
                <option value="">— Chưa gắn mẫu nào —</option>
                {Object.entries(boqTemplates || {}).map(([ten, tpl]) => (
                  <option key={ten} value={ten}>
                    {ten} {tpl.groupId !== activeProject.groupId ? `⚠ khác nhóm (${PROJECT_GROUPS.find((g) => g.id === tpl.groupId)?.name})` : `(${tpl.items.length} đầu việc)`}
                  </option>
                ))}
              </select>
              {activeProject.mauLienKet && !boqTemplates[activeProject.mauLienKet] && (
                <div className="text-xs mt-1" style={{ color: RED }}>⚠ Mẫu đã gắn ("{activeProject.mauLienKet}") không còn tồn tại (có thể đã bị xoá) — chọn lại mẫu khác.</div>
              )}
              {activeProject.mauLienKet && boqTemplates[activeProject.mauLienKet] && boqTemplates[activeProject.mauLienKet].groupId !== activeProject.groupId && (
                <div className="text-xs mt-1" style={{ color: AMBER_DARK }}>⚠ Mẫu này thuộc nhóm công trình khác — đơn giá vẫn tính theo nhóm của dự án ("{PROJECT_GROUPS.find((g) => g.id === activeProject.groupId)?.name}"), chỉ mượn tên đầu việc từ mẫu để đọc bản vẽ.</div>
              )}
            </div>

            <div className="p-3 rounded border mt-3" style={{ borderColor: LINE, background: "#FAFAF7" }}>
              <div className="text-sm font-semibold mb-1" style={{ color: NAVY }}>Tên ưu tiên / tên cấm khi AI đọc bản vẽ</div>
              <p className="text-xs mb-2" style={{ color: SLATE }}>
                Giúp giảm cảnh báo "QC_MISSING" do AI tự đặt tên khác nghĩa giống nhau (VD công ty luôn gọi "Xây tường 100"
                chứ không phải "Xây tường gạch 10cm"). Mỗi dòng 1 tên.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium" style={{ color: GREEN }}>✓ Tên ưu tiên (dùng đúng tên này)</label>
                  <textarea
                    rows={3} className="border rounded px-2 py-1.5 text-xs w-full mt-1"
                    style={{ borderColor: LINE }} placeholder="Xây tường 100&#10;Bê tông đá 1x2 M250"
                    value={(activeProject.tenUuTien || []).join("\n")}
                    onChange={(e) => updateProjectSetting("tenUuTien", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium" style={{ color: RED }}>✗ Tên cấm (không dùng)</label>
                  <textarea
                    rows={3} className="border rounded px-2 py-1.5 text-xs w-full mt-1"
                    style={{ borderColor: LINE }} placeholder="Xây tường gạch 10cm&#10;Bê tông mác 250"
                    value={(activeProject.tenCam || []).join("\n")}
                    onChange={(e) => updateProjectSetting("tenCam", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
                  />
                </div>
              </div>
            </div>

            <div className="p-3 rounded border mt-3" style={{ borderColor: LINE, background: "#FAFAF7" }}>
              <div className="text-sm font-semibold mb-1" style={{ color: NAVY }}>Dự toán mẫu tham chiếu (đã kiểm chứng — quan trọng nhất để đọc bản vẽ đúng)</div>
              <p className="text-xs mb-2" style={{ color: SLATE }}>
                AI dùng bản này làm ví dụ tham khảo phương pháp luận + đơn giá khi đọc bản vẽ mới — nhưng vẫn PHẢI tính
                lại khối lượng riêng theo đúng bản vẽ đang đọc, không copy nguyên số.
              </p>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  className="px-3 py-1 rounded text-xs font-medium"
                  style={{ background: !(activeProject.duToanMauThamChieu || "").trim() ? NAVY : "#EEF1F5", color: !(activeProject.duToanMauThamChieu || "").trim() ? "#fff" : SLATE }}
                  onClick={() => setTabMauThamChieu("mac-dinh")}
                >
                  📦 Mẫu tích hợp sẵn {!(activeProject.duToanMauThamChieu || "").trim() && "— ĐANG DÙNG"}
                </button>
                <button
                  type="button"
                  className="px-3 py-1 rounded text-xs font-medium"
                  style={{ background: (activeProject.duToanMauThamChieu || "").trim() ? AMBER_DARK : "#EEF1F5", color: (activeProject.duToanMauThamChieu || "").trim() ? "#fff" : SLATE }}
                  onClick={() => setTabMauThamChieu("tuy-chinh")}
                >
                  ✏️ Mẫu tuỳ chỉnh {(activeProject.duToanMauThamChieu || "").trim() && "— ĐANG DÙNG (đã khoá mẫu tích hợp sẵn)"}
                </button>
              </div>

              {(tabMauThamChieu || (!(activeProject.duToanMauThamChieu || "").trim() ? "mac-dinh" : "tuy-chinh")) === "mac-dinh" ? (
                <div>
                  <p className="text-xs mb-1" style={{ color: SLATE }}>
                    Có sẵn theo đúng nhóm công trình đang chọn ("{PROJECT_GROUPS.find((g) => g.id === activeProject.groupId)?.name}") — không cần nạp gì, dùng ngay.
                    Muốn dùng mẫu khác (VD dự toán thật của chính công ty cho công trình khác), chuyển sang thẻ "Mẫu tuỳ chỉnh" bên trên.
                  </p>
                  <textarea
                    rows={8} className="border rounded px-2 py-1.5 text-xs w-full font-mono bg-gray-50" style={{ borderColor: LINE, color: SLATE }}
                    readOnly value={SEED_DU_TOAN_MAU_MAC_DINH[activeProject.groupId] || "(Nhóm công trình này chưa có mẫu tích hợp sẵn — hãy dùng thẻ \"Mẫu tuỳ chỉnh\".)"}
                  />
                </div>
              ) : (
                <div>
                  <p className="text-xs mb-1" style={{ color: SLATE }}>
                    Dán TOÀN VĂN 1 dự toán/BOQ THẬT đã làm trước cho công trình TƯƠNG TỰ (VD toàn bộ ghi chú "Assumptions" —
                    số liệu, tỷ lệ/hệ số, lý do suy luận từng mục). Khi có nội dung ở đây, mẫu này THAY THẾ HOÀN TOÀN mẫu tích hợp sẵn.
                  </p>
                  <textarea
                    rows={8} className="border rounded px-2 py-1.5 text-xs w-full font-mono" style={{ borderColor: LINE }}
                    placeholder={`VD dán nguyên văn:\nD1 | BOQ này tính theo phương pháp luận và ĐƠN GIÁ đồng bộ với BOQ_xxx...\nD2 | Footprint: 6,0m x 13,1m = 78,6m²/tầng...\n...`}
                    value={activeProject.duToanMauThamChieu || ""}
                    onChange={(e) => updateProjectSetting("duToanMauThamChieu", e.target.value)}
                  />
                  {(activeProject.duToanMauThamChieu || "").trim() ? (
                    <div className="text-xs mt-1" style={{ color: GREEN }}>✓ Đã gắn ({(activeProject.duToanMauThamChieu || "").length.toLocaleString("vi-VN")} ký tự) — đang THAY THẾ mẫu tích hợp sẵn cho dự án này.</div>
                  ) : (
                    <div className="text-xs mt-1" style={{ color: SLATE }}>Chưa nạp gì — dự án đang tự động dùng mẫu tích hợp sẵn (thẻ bên trái).</div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <PctField label="Chi phí quản lý" value={activeProject.quanLyPct} onChange={(v) => updateProjectSetting("quanLyPct", v)} />
              <PctField label="Chi phí khác" value={activeProject.khacPct} onChange={(v) => updateProjectSetting("khacPct", v)} />
              <PctField label="Lợi nhuận" value={activeProject.loiNhuanPct} onChange={(v) => updateProjectSetting("loiNhuanPct", v)} />
              <PctField label="VAT" value={activeProject.vatPct} onChange={(v) => updateProjectSetting("vatPct", v)} />
              <PctField label="Ngưỡng cảnh báo giá khoán" value={activeProject.khoanThreshold} onChange={(v) => updateProjectSetting("khoanThreshold", v)} />
            </div>

            <div className="text-sm font-semibold mt-4 mb-1" style={{ color: NAVY }}>Nhập TOÀN BỘ mẫu dự toán từ file BOQ thật (nhiều sheet)</div>
            <p className="text-xs mb-2" style={{ color: SLATE }}>Dùng khi đã có sẵn 1 bộ BOQ hoàn chỉnh (VD file mẫu S6-38, nhiều sheet "BOQ_V1.1", "BOQ_V2.0"...) — app tự quét toàn bộ sheet, đọc đúng khối lượng + đơn giá thật, tạo thành mẫu đầy đủ (không phải 40-42 dòng như tự gõ tay).</p>
            <input type="file" accept=".xlsx,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBoqTemplateImportFile(f); e.target.value = ""; }} className="text-xs mb-2" />

            {boqTplImportResults && (
              <div className="p-3 rounded border mb-2" style={{ borderColor: boqTplImportResults.items.length ? GREEN : RED, background: boqTplImportResults.items.length ? "#F0FBF4" : "#FCEBEA" }}>
                <div className="text-xs font-semibold mb-1">File "{boqTplImportResults.fileName}" — {boqTplImportResults.items.length} dòng hạng mục đọc được:</div>
                <div className="text-xs mb-2" style={{ color: SLATE }}>
                  {boqTplImportResults.baoCao.map((b, i) => (
                    <div key={i}>{b.ok ? "✓" : "✗"} {b.sheet}: {b.ok ? `${b.dem} dòng` : "không nhận diện được cấu trúc"}</div>
                  ))}
                </div>
                {boqTplImportResults.items.length > 0 && (
                  <>
                    <div className="max-h-40 overflow-y-auto mb-2 border rounded bg-white" style={{ borderColor: LINE }}>
                      <table className="w-full text-xs">
                        <tbody>
                          {boqTplImportResults.items.slice(0, 8).map((it, i) => (
                            <tr key={i} className="border-b" style={{ borderColor: LINE }}>
                              <td className="px-2 py-1 font-mono">{it.costCode}</td>
                              <td className="px-2 py-1">{it.name}</td>
                              <td className="px-2 py-1 text-right">{it.qty} {it.unit}</td>
                              <td className="px-2 py-1 text-right">{fmt(it.price)}đ</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {boqTplImportResults.items.length > 8 && <div className="text-xs text-center py-1" style={{ color: SLATE }}>... và {boqTplImportResults.items.length - 8} dòng khác</div>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input value={tplImportName} onChange={(e) => setTplImportName(e.target.value)} placeholder="Tên mẫu (vd: S6-38 Khách sạn 4 sao chuẩn)" className="border rounded px-2 py-1.5 text-sm flex-1" style={{ borderColor: LINE, minWidth: 160 }} />
                      <select value={tplImportGroupId} onChange={(e) => setTplImportGroupId(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE }}>
                        {PROJECT_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                      <button onClick={() => { taoMauTuFileImport(tplImportName, tplImportGroupId); setTplImportName(""); }} disabled={!tplImportName.trim()} className="px-3 py-1.5 rounded text-white text-xs font-medium disabled:opacity-40" style={{ background: GREEN }}>
                        Tạo mẫu ({boqTplImportResults.items.length} dòng, giá thật)
                      </button>
                      <button onClick={huyBoqTplImport} className="px-3 py-1.5 rounded text-xs font-medium border" style={{ borderColor: LINE }}>Huỷ</button>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="text-sm font-semibold mt-4 mb-1" style={{ color: NAVY }}>Mẫu dự toán trọn bộ</div>
            <p className="text-xs mb-2" style={{ color: SLATE }}>Lưu dự án hiện tại (thông số + toàn bộ dòng BOQ + hệ số) thành mẫu — dự án sau tạo từ mẫu là có sẵn mọi thứ, chỉ đổi thông số công trình là ra giá ngay.</p>
            <div className="p-2 mb-2 rounded text-xs" style={{ background: "#EEF3F8", color: NAVY }}>
              ℹ️ Mẫu chỉ lưu <strong>đầu việc + khối lượng</strong>, KHÔNG lưu đóng băng đơn giá. Dự án tạo từ mẫu luôn tính theo <strong>bảng đơn giá hiện tại</strong> của nhóm công trình (mục "Định mức" bên dưới) — nếu giá vật tư đã đổi từ lúc lưu mẫu, dự án mới sẽ ra giá mới, không phải giá lúc lưu mẫu.
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              <input value={tplSaveName} onChange={(e) => setTplSaveName(e.target.value)} placeholder="Tên mẫu (vd: KS Studio 4 sao)" className="border rounded px-2 py-1.5 text-sm flex-1" style={{ borderColor: LINE, minWidth: 160 }} />
              <button onClick={() => { saveAsTemplate(tplSaveName); setTplSaveName(""); }} className="px-3 py-1.5 rounded text-white text-xs font-medium" style={{ background: NAVY }}>
                <Save size={12} className="inline mr-1 -mt-0.5" /> Lưu dự án này làm mẫu
              </button>
            </div>
            {Object.keys(boqTemplates || {}).length > 0 && (
              <div className="flex flex-wrap gap-2 items-center">
                <select value={tplPick} onChange={(e) => setTplPick(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, minWidth: 140 }}>
                  <option value="">— chọn mẫu —</option>
                  {Object.entries(boqTemplates).map(([n, t]) => <option key={n} value={n}>{n} ({t.items.length} dòng)</option>)}
                </select>
                <input value={tplNewProjectName} onChange={(e) => setTplNewProjectName(e.target.value)} placeholder="Tên dự án mới" className="border rounded px-2 py-1.5 text-sm flex-1" style={{ borderColor: LINE, minWidth: 140 }} />
                <button onClick={() => { createProjectFromTemplate(tplPick, tplNewProjectName); setTplNewProjectName(""); }} disabled={!tplPick || !tplNewProjectName.trim()} className="px-3 py-1.5 rounded text-white text-xs font-medium disabled:opacity-40" style={{ background: GREEN }}>
                  <FolderPlus size={12} className="inline mr-1 -mt-0.5" /> Tạo dự án từ mẫu
                </button>
                {tplPick && (
                  <button onClick={() => { deleteTemplate(tplPick); setTplPick(""); }} title="Xoá mẫu đang chọn"><Trash2 size={14} color={RED} /></button>
                )}
              </div>
            )}
            {Object.keys(boqTemplates || {}).length > 0 && (
              <SoSanhMauBlock boqTemplates={boqTemplates} soSanhVoiMau={soSanhVoiMau} themDauViecThieu={themDauViecThieu} xoaDauViecThua={xoaDauViecThua} />
            )}
          </div>
        )}
      </div>

      <div className="pt-6 border-t-2" style={{ borderColor: LINE }}>
        <ImportPricesTab
          materials={materials} labor={labor}
          priceImportKind={priceImportKind} setPriceImportKind={setPriceImportKind}
          priceImportGroupId={priceImportGroupId} setPriceImportGroupId={setPriceImportGroupId}
          handlePriceImportFile={handlePriceImportFile}
          priceImportResults={priceImportResults} priceImportReport={priceImportReport}
          applyPriceImportRow={applyPriceImportRow} applyAllPriceImport={applyAllPriceImport}
          cancelPriceImport={cancelPriceImport} skipPriceImportRow={skipPriceImportRow}
          importBatch={importBatch} undoImportBatch={undoImportBatch}
          updateMaterialPrice={updateMaterialPrice} updateMaterialField={updateMaterialField} updateLaborPrice={updateLaborPrice}
          addMaterial={addMaterial} removeMaterial={removeMaterial} removeLabor={removeLabor}
          activeProject={activeProject}
          norms={norms} materialsById={materialsById} laborById={laborById} addNorm={addNorm} changeLog={changeLog}
          priceLog={priceLog} applyPriceSlide={applyPriceSlide} undoLastAdjustment={undoLastAdjustment} adjustHistory={adjustHistory}
        />
      </div>
    </div>
  );
}

function PctField({ label, value, onChange }) {
  return (
    <div>
      <div className="text-xs mb-1" style={{ color: SLATE }}>{label}</div>
      <div className="flex items-center gap-1">
        <input
          type="number" step="0.5" value={(value * 100).toFixed(1)}
          onChange={(e) => onChange((parseFloat(e.target.value) || 0) / 100)}
          className="num-input border rounded px-2 py-1.5 text-sm w-full font-mono"
          style={{ borderColor: LINE }}
        />
        <span className="text-sm" style={{ color: SLATE }}>%</span>
      </div>
    </div>
  );
}

// ============================================================================
// TAB 2: ĐỊNH MỨC (Norm Database — Master/Local)
// ============================================================================
// ============================================================================
// TAB: ĐỌC BẢN VẼ (Drawing Intake — upload ảnh, AI đọc khối lượng, khớp định mức)
// ============================================================================
function DrawingsTab({ versions, photos, addDrawingVersion, handlePhotoFiles, analyzePhotoAI, analyzePhotosBatchAI, aiAnalyzing, aiProgress, aiError, aiResults, lastRawDebug, lastPipelineTrace, lastDrawingModel, applyAiResult, skipAiResult, applyAllAiResults, projectNorms, drawingFiles, handleDrawingFiles, removeDrawingFile, removePhoto, removeAllPhotos, analyzePdfAI, pdfAiAnalyzing, pdfAiProgress, dongHoGiay, docFileDxf, boqLines, activeProject, setActiveTab, aiCostLast, aiCostTotal, testBackend, connTest, connTesting, authUser, authHeaders, danhSachChuanInfo, soSanhMauLienKet, themDauViecThieu, projects, activeProjectId, setActiveProjectId }) {
  const [activeVersionId, setActiveVersionId] = useState(versions[0]?.id || "");
  const [newVersionLabel, setNewVersionLabel] = useState("");
  const [mode, setMode] = useState("photo"); // "photo" | "pdf"
  const [analyzedIds, setAnalyzedIds] = useState(() => new Set());
  const [ghiChuTheoAnh, setGhiChuTheoAnh] = useState({}); // {photoId: "ghi chú bổ sung khi đọc lại"}
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const [doTrenAnhPhoto, setDoTrenAnhPhoto] = useState(null); // ảnh đang mở công cụ đo
  const [heSoQuyDoiDxf, setHeSoQuyDoiDxf] = useState(0.001); // mặc định mm -> m
  const [chieuCaoTuongDxf, setChieuCaoTuongDxf] = useState(""); // để trống = KHÔNG tự tính m2, chỉ ra mét dài
  const [soMatToSonDxf, setSoMatToSonDxf] = useState(""); // để trống = KHÔNG tự tính tô/sơn, chỉ tính xây tường
  const [hangAiChon, setHangAiChon] = useState(""); // "" = Claude mặc định, "gemini"/"openai" để so sánh
  const fileRef = useRef(null);
  const pdfRef = useRef(null);

  useEffect(() => {
    if (!activeVersionId && versions.length) setActiveVersionId(versions[0].id);
  }, [versions, activeVersionId]);

  const versionPhotos = photos.filter((p) => p.versionId === activeVersionId);
  const versionPdfs = drawingFiles.filter((f) => f.versionId === activeVersionId);
  const unanalyzedPhotos = versionPhotos.filter((p) => !analyzedIds.has(p.id));
  const groups = {};
  aiResults.forEach((r) => { if (!groups[r.sourcePhoto]) groups[r.sourcePhoto] = []; groups[r.sourcePhoto].push(r); });
  const fmtSize = (b) => (b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : (b / 1e3).toFixed(0) + " KB");

  const runOneAI = async (p, ghiChuThem, provider) => {
    const ok = await analyzePhotoAI(p, ghiChuThem, provider);
    if (ok) setAnalyzedIds((prev) => new Set(prev).add(p.id));
  };

  const runAllAI = async (provider) => {
    setBatchAnalyzing(true);
    // Đọc GỘP tất cả ảnh chưa đọc — nhưng chia thành từng nhóm nhỏ nếu tổng dung
    // lượng quá nặng (an toàn dưới trần thật ~32MB của API, chừa dư cho JSON), để
    // vẫn tận dụng đối chiếu chéo trong từng nhóm mà không vượt giới hạn gây lỗi.
    const GIOI_HAN_NHOM = 16 * 1024 * 1024; // ~16MB raw/nhóm -> ~21MB base64, an toàn
    const nhomAnh = [];
    let nhomHienTai = [], sizeHienTai = 0;
    unanalyzedPhotos.forEach((p) => {
      const size = Math.round((p.dataUrl.length * 3) / 4); // ước lượng byte gốc từ base64
      if (sizeHienTai + size > GIOI_HAN_NHOM && nhomHienTai.length) {
        nhomAnh.push(nhomHienTai);
        nhomHienTai = []; sizeHienTai = 0;
      }
      nhomHienTai.push(p); sizeHienTai += size;
    });
    if (nhomHienTai.length) nhomAnh.push(nhomHienTai);

    let tatCaOk = true;
    for (const nhom of nhomAnh) {
      const ok = await analyzePhotosBatchAI(nhom, undefined, provider);
      if (ok) setAnalyzedIds((prev) => { const next = new Set(prev); nhom.forEach((p) => next.add(p.id)); return next; });
      else tatCaOk = false;
    }
    setBatchAnalyzing(false);
  };

  return (
    <div>
      <SectionHeader icon={Camera} title="Đọc bản vẽ — Upload ảnh/PDF" desc='Bước 1 — tải ảnh/PDF rồi bấm "Bắt đầu đọc AI". Quy trình đủ 4 bước: (1) Đọc bản vẽ → (2) Duyệt khối lượng AI đọc được → (3) Điều chỉnh khối lượng nếu cần → (4) Xem BOQ đã tính giá tự động theo nhóm công trình/nhà thầu đang chọn, rồi xuất file. Tải ảnh/PDF lên chưa tự động tính gì cả — phải bấm nút AI mới ra kết quả. Mỗi lần thiết kế thay đổi, tạo 1 phiên bản mới để so sánh.' />

      {/* THÊM MỚI (theo yêu cầu): chuyển dự án ngay tại đây — trước đây phải rời
          tab này, vào thẻ "Dự án" chọn/tạo dự án khác rồi quay lại mới đọc bản
          vẽ tiếp được. Chỉ hiện khi có từ 2 dự án trở lên. */}
      {Array.isArray(projects) && projects.length > 1 && (
        <div className="mb-3 p-2.5 rounded flex items-center gap-2 flex-wrap" style={{ background: "#EEF3F8", border: `1px solid ${LINE}` }}>
          <span className="text-xs font-semibold" style={{ color: NAVY }}>📁 Đang đọc cho dự án:</span>
          <select
            value={activeProjectId}
            onChange={(e) => setActiveProjectId(e.target.value)}
            className="text-xs px-2 py-1.5 rounded border flex-1 min-w-0"
            style={{ borderColor: LINE, background: "#fff", color: NAVY }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span className="text-xs" style={{ color: SLATE }}>Đọc file mới cho dự án khác? Chọn ở đây, không cần rời trang.</span>
        </div>
      )}

      <div className="mb-3 inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold" style={{ background: BACKEND_URL ? "#F0FBF4" : "#FFF4E5", color: BACKEND_URL ? GREEN : AMBER_DARK }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: BACKEND_URL ? GREEN : AMBER_DARK, display: "inline-block" }} />
        {BACKEND_URL ? "Đang chạy qua backend riêng (ổn định)" : "Đang chạy tạm qua Claude.ai — chưa cấu hình backend riêng"}
      </div>

      {danhSachChuanInfo && (
        danhSachChuanInfo.danhSach.length > 0 ? (
          <div className="mb-3 p-2 rounded text-xs" style={{ background: "#F0FBF4", color: GREEN, border: `1px solid ${GREEN}` }}>
            ✓ AI sẽ đọc bám theo <strong>{danhSachChuanInfo.danhSach.length} đầu việc chuẩn</strong> từ mẫu dự toán cùng nhóm công trình ({danhSachChuanInfo.tenMauDaDung.map((t) => `"${t}"`).join(", ")}) — ưu tiên khớp đúng tên có sẵn (đã có giá) thay vì tự đặt tên mới.
          </div>
        ) : (
          <div className="mb-3 p-2 rounded text-xs" style={{ background: "#FFF4E5", color: AMBER_DARK, border: `1px solid ${AMBER}` }}>
            ⚠ Chưa có mẫu dự toán nào cho nhóm công trình "{PROJECT_GROUPS.find((g) => g.id === activeProject?.groupId)?.name}" — AI sẽ tự đặt tên hạng mục tự do, dòng chưa khớp định mức sẽ có giá 0đ. Vào thẻ "Dự án" lưu 1 dự án đã hoàn chỉnh làm mẫu cho nhóm này để lần đọc sau bám sát hơn.
          </div>
        )
      )}

      <div className="mb-3 p-3 rounded border flex items-center justify-between" style={{ borderColor: boqLines.length > 0 ? GREEN : LINE, background: boqLines.length > 0 ? "#F0FBF4" : "#F6F8FA" }}>
        <div className="text-sm">
          <strong style={{ color: boqLines.length > 0 ? GREEN : SLATE }}>Dự án "{activeProject?.name}" hiện có {boqLines.length} dòng trong BOQ</strong>
          {boqLines.length === 0 && <span style={{ color: SLATE }}> — chưa có dòng nào (đọc bản vẽ rồi bấm "Duyệt tất cả" ở Bước 2 bên dưới để thêm vào).</span>}
          {boqLines.length > 0 && (() => {
            const soConfirmed = boqLines.filter((l) => l.boq.trangThai === "confirmed").length;
            const soReview = boqLines.filter((l) => l.boq.trangThai === "review").length;
            return (soConfirmed || soReview) ? (
              <div className="text-xs mt-1" style={{ color: SLATE }}>
                {soConfirmed > 0 && <span style={{ color: GREEN }}>🟢 {soConfirmed} Confirmed</span>}
                {soConfirmed > 0 && soReview > 0 && "  ·  "}
                {soReview > 0 && <span style={{ color: AMBER_DARK }}>🟡 {soReview} cần Review (chưa có giá thật)</span>}
              </div>
            ) : null;
          })()}
          {soSanhMauLienKet && soSanhMauLienKet.thieu.length > 0 && (
            <div className="text-xs mt-1 flex items-center gap-2 flex-wrap">
              <span style={{ color: RED }}>🔴 {soSanhMauLienKet.thieu.length} Missing (có trong mẫu "{soSanhMauLienKet.tenMau}" nhưng chưa có trong BOQ — chưa đọc thấy trên bản vẽ, hoặc chưa duyệt)</span>
              <button
                onClick={() => { themDauViecThieu(soSanhMauLienKet.tenMau, soSanhMauLienKet.thieu); }}
                className="text-xs px-2 py-0.5 rounded text-white font-semibold"
                style={{ background: RED }}
                title="Thêm các đầu việc thiếu vào BOQ (khối lượng để 0, tự điền tay sau khi kiểm tra bản vẽ)"
              >
                + Thêm {soSanhMauLienKet.thieu.length} dòng thiếu vào BOQ
              </button>
            </div>
          )}
        </div>
        {boqLines.length > 0 && (
          <button onClick={() => setActiveTab("exportHub")} className="text-xs px-3 py-1.5 rounded text-white font-semibold shrink-0" style={{ background: NAVY }}>
            Xem BOQ / Xuất file →
          </button>
        )}
      </div>

      {/* THÊM MỚI (theo yêu cầu): hiển thị chi phí USD ngay trên màn hình — trước
          đây backend đã tính sẵn (tongChiPhiUsd/cost) nhưng chưa hiển thị, người
          dùng phải tự tra console.anthropic.com mới biết. */}
      {aiCostLast && (
        <div className="mb-3 p-2 rounded text-xs flex flex-wrap items-center gap-x-4 gap-y-1" style={{ background: "#FFF8E8", color: NAVY, border: `1px solid ${AMBER}` }}>
          <span><strong>💰 Chi phí lần đọc gần nhất:</strong> ~${aiCostLast.usd?.toFixed(4)} (~{Math.round(aiCostLast.vnd || 0).toLocaleString("vi-VN")}đ)</span>
          {aiCostTotal && aiCostTotal.count > 1 && (
            <span style={{ color: SLATE }}>Tổng cộng phiên này ({aiCostTotal.count} lần đọc): ~${aiCostTotal.usd?.toFixed(4)}</span>
          )}
          <span style={{ color: SLATE, fontStyle: "italic" }}>Ước tính từ token thật — số chính xác 100% xem ở console.anthropic.com/settings/usage.</span>
        </div>
      )}

      {lastRawDebug && (
        <div className="mb-3 p-2 rounded text-xs" style={{ background: "#EEF3F8", color: NAVY, border: `1px solid ${LINE}`, wordBreak: "break-all" }}>
          <strong>Chẩn đoán lần đọc gần nhất:</strong> {lastRawDebug}
        </div>
      )}

      {Array.isArray(lastPipelineTrace) && lastPipelineTrace.length > 0 && (
        <div className="mb-3 p-2 rounded text-xs" style={{ background: "#F7F7F9", color: NAVY, border: `1px solid ${LINE}` }}>
          <strong>Trạng thái pipeline 9 bước (lần đọc gần nhất):</strong>
          <div className="flex flex-wrap gap-1 mt-1">
            {lastPipelineTrace.map((b, i) => {
              const trangThai = b?.status || b?.trangThai || "?";
              const mau = trangThai === "done" ? GREEN : trangThai === "partial" ? AMBER : trangThai === "blocked" ? RED : "#999";
              return (
                <span key={i} className="px-2 py-0.5 rounded-full" style={{ background: mau + "22", color: mau, border: `1px solid ${mau}` }} title={b?.detail || b?.reason || ""}>
                  {b?.buoc || b?.step || `#${i + 1}`}: {trangThai}
                </span>
              );
            })}
          </div>
          {(() => {
            const b04 = lastPipelineTrace.find((b) => (b?.step || "").includes("NORMALIZE"));
            const chiTiet = b04?.detail || "";
            if (!chiTiet.includes("⚠")) return null;
            // Hiển thị RÕ RÀNG, KHÔNG cần hover — đây là điều rất dễ bị hiểu
            // nhầm là "AI không đọc được bản vẽ" trong khi thực ra AI ĐÃ đọc
            // được, chỉ là app không phân loại được nên tự loại bỏ dòng đó.
            return (
              <div className="mt-2 p-2 rounded" style={{ background: AMBER + "15", border: `1px solid ${AMBER}`, color: NAVY }}>
                <strong style={{ color: AMBER_DARK }}>⚠ Có hạng mục AI đã đọc được nhưng KHÔNG vào được BOQ:</strong>
                <div className="mt-1">{chiTiet.slice(chiTiet.indexOf("⚠"))}</div>
              </div>
            );
          })()}
        </div>
      )}

      {lastDrawingModel && (
        <div className="mb-3 p-2 rounded text-xs" style={{ background: "#F7F7F9", color: NAVY, border: `1px solid ${LINE}` }}>
          <strong>Drawing Model (chỉ xem):</strong>{" "}
          {lastDrawingModel.objects?.length || 0} object, {lastDrawingModel.relationships?.length || 0} relationship, {lastDrawingModel.quantities?.length || 0} khối lượng.
          {lastDrawingModel.relationships?.length > 0 && (
            <span> Gợi ý vị trí (chưa xác nhận, cần QS kiểm tra): {lastDrawingModel.relationships.map((r) => r.target).filter((v, i, a) => a.indexOf(v) === i).join(", ")}.</span>
          )}
        </div>
      )}

      {BACKEND_URL && (
        <div className="mb-4 p-3 rounded border bg-white" style={{ borderColor: LINE }}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="text-sm font-semibold" style={{ color: NAVY }}>Chi phí AI đọc bản vẽ</div>
            <div className="flex items-center gap-2">
              <button onClick={testBackend} disabled={connTesting} className="text-xs font-semibold px-3 py-1.5 rounded border disabled:opacity-50" style={{ borderColor: NAVY, color: NAVY, background: "white" }}>
                {connTesting ? "Đang kiểm tra..." : "Kiểm tra kết nối server"}
              </button>
              <a href="https://platform.claude.com/settings/billing" target="_blank" rel="noopener noreferrer" className="text-xs font-semibold px-3 py-1.5 rounded" style={{ background: NAVY, color: "white", textDecoration: "none" }}>
                Nạp tiền / Xem số dư
              </a>
            </div>
          </div>

          {connTest && (
            <div className="mb-2 p-2 rounded text-xs" style={{ background: connTest.ok ? "#F0FBF4" : "#FCEBEA", color: connTest.ok ? GREEN : RED, border: `1px solid ${connTest.ok ? GREEN : RED}` }}>
              {connTest.msg}
            </div>
          )}
          {aiCostLast ? (
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div className="p-2 rounded" style={{ background: PAPER }}>
                <div className="text-xs" style={{ color: SLATE }}>Lần đọc gần nhất</div>
                <div className="font-mono font-bold text-sm" style={{ color: NAVY }}>{fmt(aiCostLast.vnd)} đ</div>
                <div className="text-xs" style={{ color: SLATE }}>{aiCostLast.inputTokens?.toLocaleString("vi-VN")} token vào · {aiCostLast.outputTokens?.toLocaleString("vi-VN")} token ra</div>
              </div>
              <div className="p-2 rounded" style={{ background: PAPER }}>
                <div className="text-xs" style={{ color: SLATE }}>Cộng dồn phiên này ({aiCostTotal.count} lần đọc)</div>
                <div className="font-mono font-bold text-sm" style={{ color: AMBER_DARK }}>{fmt(aiCostTotal.vnd)} đ</div>
                <div className="text-xs" style={{ color: SLATE }}>≈ {aiCostTotal.usd.toFixed(4)} USD</div>
              </div>
            </div>
          ) : (
            <p className="text-xs mb-2" style={{ color: SLATE }}>Chưa có lượt đọc AI nào trong phiên này. Sau mỗi lần đọc, chi phí token thực tế sẽ hiện ở đây.</p>
          )}
          <p className="text-xs" style={{ color: SLATE }}>
            Tiền trừ vào số dư tài khoản API (platform.claude.com) — không phải gói thuê bao Claude thường. Số tiền trên là <strong>ước tính</strong> theo đơn giá công bố của model đang dùng (Sonnet 4.6: 3 USD/triệu token vào, 15 USD/triệu token ra), quy đổi tạm 26.000đ/USD. Số liệu chính thức xem ở mục Usage trên platform.claude.com.
          </p>
        </div>
      )}

      {authUser?.quanTri && <TemplateEditorPanel authHeaders={authHeaders} projectNorms={projectNorms} />}
      {authUser?.quanTri && <UsageLogPanel authHeaders={authHeaders} />}

      <div className="mb-5 p-3 rounded border flex items-start gap-2" style={{ borderColor: AMBER, background: "#FFF8ED" }}>
        <AlertTriangle size={15} color={AMBER_DARK} className="mt-0.5 shrink-0" />
        <div className="text-xs" style={{ color: SLATE }}>
          <strong>Ảnh và PDF đều đọc được qua backend riêng.</strong> Bấm "Bắt đầu đọc AI" trên ảnh hoặc file PDF — có thể chụp ảnh mới, chọn ảnh có sẵn, hoặc tải thẳng file PDF. Nếu báo lỗi gọi backend, bấm nút "Kiểm tra kết nối server" ở khung trên để biết nguyên nhân (thường do server gói miễn phí đang ngủ — chờ ~50 giây lần đầu). File càng nặng càng lâu; PDF nhiều trang nên tách nhỏ. Bản vẽ/ảnh cần có bảng số liệu/kích thước rõ nét (không phải bản scan quá mờ). Kết quả AI đọc luôn cần kiểm tra lại, không thay thế bóc tách chuyên môn.
        </div>
      </div>

      {aiError && (
        <div className="mb-5 p-3 rounded border flex items-start gap-2" style={{ borderColor: RED, background: "#FCEBEA" }}>
          <AlertTriangle size={15} color={RED} className="mt-0.5 shrink-0" />
          <div className="text-xs" style={{ color: RED }}><strong>Lỗi lần phân tích gần nhất:</strong> {aiError}</div>
        </div>
      )}

      <div className="bg-white border rounded p-4 mb-5" style={{ borderColor: LINE }}>
        <div className="text-sm font-semibold mb-3" style={{ color: NAVY }}>Phiên bản bản vẽ</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {versions.map((v) => (
            <button
              key={v.id}
              onClick={() => setActiveVersionId(v.id)}
              className="px-3 py-1.5 rounded text-xs font-medium border"
              style={{ borderColor: v.id === activeVersionId ? AMBER : LINE, background: v.id === activeVersionId ? "#FFF4E5" : "white", color: v.id === activeVersionId ? AMBER_DARK : INK }}
            >
              {v.label} <span style={{ color: SLATE }}>· {v.date.split(",")[0]}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={newVersionLabel} onChange={(e) => setNewVersionLabel(e.target.value)} placeholder="Tên phiên bản (vd: Rev.A, Kết cấu-V2...) — để trống sẽ tự đặt V1, V2..." className="border rounded px-2 py-1.5 text-sm flex-1" style={{ borderColor: LINE }} />
          <button
            onClick={() => { const id = addDrawingVersion(newVersionLabel); setActiveVersionId(id); setNewVersionLabel(""); }}
            className="px-3 py-1.5 rounded text-white text-xs font-medium"
            style={{ background: NAVY }}
          >
            <Plus size={13} className="inline mr-1" /> Tạo phiên bản mới
          </button>
        </div>
      </div>

      {!activeVersionId ? (
        <EmptyState text="Tạo 1 phiên bản bản vẽ trước khi tải file lên." />
      ) : (
        <>
          <div className="flex rounded overflow-hidden border mb-3 w-fit" style={{ borderColor: NAVY }}>
            <button onClick={() => setMode("photo")} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium" style={{ background: mode === "photo" ? NAVY : "white", color: mode === "photo" ? "white" : NAVY }}>
              <ImageIcon size={14} /> Hình ảnh
            </button>
            <button onClick={() => setMode("pdf")} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium" style={{ background: mode === "pdf" ? NAVY : "white", color: mode === "pdf" ? "white" : NAVY }}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={() => setMode("dxf")} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium" style={{ background: mode === "dxf" ? GREEN : "white", color: mode === "dxf" ? "white" : GREEN }}>
              📐 File DXF (chính xác, không AI)
            </button>
          </div>

          <details className="mb-4 text-xs" style={{ color: SLATE }}>
            <summary className="cursor-pointer font-semibold" style={{ color: NAVY }}>📲 Lấy file từ Zalo/Viber/Mail trên điện thoại — làm sao?</summary>
            <div className="mt-2 leading-relaxed pl-1">
              <div className="font-semibold mb-0.5" style={{ color: INK }}>Điện thoại Android:</div>
              <ol className="list-decimal pl-4 mb-2">
                <li>Mở Zalo/Viber/Gmail, bấm vào file/ảnh bản vẽ.</li>
                <li>Bấm biểu tượng <strong>Tải xuống ⬇</strong> (hoặc "Lưu về máy").</li>
                <li>Quay lại đây, bấm nút chọn ảnh/PDF ở dưới → chọn <strong>Files/Tệp</strong> (cho PDF) hoặc <strong>Ảnh/Gallery</strong> (cho ảnh) → mục <strong>Tải xuống/Download</strong> vừa lưu.</li>
              </ol>
              <div className="font-semibold mb-0.5" style={{ color: INK }}>iPhone:</div>
              <ol className="list-decimal pl-4">
                <li>Mở Zalo/Viber/Mail, bấm vào file/ảnh.</li>
                <li>Bấm biểu tượng <strong>Chia sẻ</strong> (hình vuông có mũi tên) → chọn <strong>"Lưu vào Files"</strong> (PDF) hoặc <strong>"Lưu ảnh"</strong> (ảnh).</li>
                <li>Quay lại đây, bấm nút chọn ảnh/PDF ở dưới → chọn <strong>Duyệt/Browse → On My iPhone</strong> (PDF) hoặc <strong>Thư viện ảnh</strong> (ảnh).</li>
              </ol>
              <div className="mt-1" style={{ color: SLATE }}>Không có sẵn file? Chụp thẳng màn hình hoặc bản in bằng nút "Chụp ảnh" — nhanh hơn nhiều.</div>
            </div>
          </details>

          {mode === "photo" && (
            <>
              <div className="flex gap-3 mb-6">
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handlePhotoFiles(e.target.files, activeVersionId)} />
                <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 px-4 py-2.5 rounded text-white font-medium" style={{ background: NAVY }}>
                  <Camera size={16} /> Chụp / chọn ảnh cho phiên bản này
                </button>
              </div>

              {versionPhotos.length === 0 ? (
                <EmptyState text="Phiên bản này chưa có ảnh nào." />
              ) : (
                <>
                  <div className="mb-4 p-4 rounded border-2 flex flex-wrap items-center justify-between gap-3" style={{ borderColor: AMBER, background: "#FFF8ED" }}>
                    <div className="text-sm" style={{ color: AMBER_DARK }}>
                      {unanalyzedPhotos.length > 0
                        ? <>Đã tải lên {versionPhotos.length} ảnh — <strong>{unanalyzedPhotos.length} ảnh chưa được AI đọc số liệu</strong>. Bấm nút bên phải để AI tự đọc và bóc tách khối lượng, chưa bấm thì ảnh chỉ nằm đó chứ chưa tính được gì.</>
                        : <>Cả {versionPhotos.length} ảnh đã được AI đọc — xem kết quả bên dưới để xác nhận rồi thêm vào BOQ.</>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <select value={hangAiChon} onChange={(e) => setHangAiChon(e.target.value)} className="text-xs border rounded px-2 py-2" style={{ borderColor: LINE }} title="Chọn hãng AI để đọc — áp dụng cho MỌI nút đọc AI bên dưới (cả đọc gộp lẫn đọc từng ảnh riêng)">
                        <option value="">Claude (mặc định)</option>
                        <option value="gemini">Gemini (cần đã cấu hình GEMINI_API_KEY)</option>
                        <option value="openai">OpenAI (cần đã cấu hình OPENAI_API_KEY)</option>
                      </select>
                      <button
                        onClick={() => runAllAI(hangAiChon || undefined)}
                        disabled={batchAnalyzing || unanalyzedPhotos.length === 0 || aiAnalyzing}
                        className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded text-white font-semibold disabled:opacity-50"
                        style={{ background: AMBER_DARK }}
                      >
                        <Sparkles size={16} /> {batchAnalyzing ? `AI đang đọc… ${aiProgress}%` : `Bắt đầu đọc AI (${unanalyzedPhotos.length} ảnh)`}
                      </button>
                    </div>
                    <button
                      onClick={() => { if (window.confirm(`Xoá toàn bộ ${versionPhotos.length} ảnh của phiên bản này?`)) removeAllPhotos(activeVersionId); }}
                      disabled={batchAnalyzing || aiAnalyzing}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded text-xs font-semibold border disabled:opacity-50"
                      style={{ borderColor: RED, color: RED, background: "white" }}
                      title="Xoá hết ảnh — dùng khi lỡ chọn nhầm ảnh không phải bản vẽ"
                    >
                      <Trash2 size={14} /> Xoá tất cả ảnh
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    {versionPhotos.map((p) => {
                      const done = analyzedIds.has(p.id);
                      const thisBusy = aiAnalyzing === p.id;
                      const ghiChu = ghiChuTheoAnh[p.id] || "";
                      return (
                        <div key={p.id} className="rounded overflow-hidden border bg-white" style={{ borderColor: done ? GREEN : LINE }}>
                          <div className="relative">
                            <img src={p.dataUrl} alt={p.name} className="w-full h-36 object-cover" />
                            <button
                              onClick={() => removePhoto(p.id)}
                              disabled={thisBusy || batchAnalyzing}
                              className="absolute top-1.5 left-1.5 inline-flex items-center justify-center rounded-full text-white disabled:opacity-40"
                              style={{ background: RED, width: 26, height: 26 }}
                              title="Xoá ảnh này"
                            >
                              <X size={15} />
                            </button>
                            {done && (
                              <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold text-white" style={{ background: GREEN }}>
                                <CheckCircle2 size={11} /> Đã đọc
                              </span>
                            )}
                            <button
                              onClick={() => setDoTrenAnhPhoto(p)}
                              className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold text-white"
                              style={{ background: NAVY }}
                              title="Đo khoảng cách thật trên ảnh (khi bản vẽ không ghi sẵn kích thước)"
                            >
                              📏 Đo
                            </button>
                          </div>
                          <div className="p-2">
                            {done && (
                              <input
                                value={ghiChu}
                                onChange={(e) => setGhiChuTheoAnh((prev) => ({ ...prev, [p.id]: e.target.value }))}
                                placeholder="AI đọc thiếu gì? VD: còn thiếu cầu thang..."
                                disabled={thisBusy || batchAnalyzing}
                                className="w-full text-xs border rounded px-2 py-1 mb-1"
                                style={{ borderColor: LINE }}
                              />
                            )}
                            <button
                              onClick={() => runOneAI(p, ghiChu, hangAiChon || undefined)}
                              disabled={aiAnalyzing === p.id || batchAnalyzing}
                              className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium text-white disabled:opacity-60"
                              style={{ background: done ? NAVY : AMBER }}
                              title={(done && ghiChu ? "Đọc lại — AI sẽ ưu tiên đọc kỹ theo ghi chú bổ sung" : "Đọc bằng hãng AI đang chọn ở ô phía trên")}
                            >
                              {thisBusy ? `${aiProgress}%` : done ? <><Sparkles size={12} /> {ghiChu ? "Đọc lại (có ghi chú)" : "Đọc lại"}</> : <><Sparkles size={12} /> Bắt đầu đọc AI</>}
                            </button>
                            <button
                              onClick={() => removePhoto(p.id)}
                              disabled={thisBusy || batchAnalyzing}
                              className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded text-xs font-medium mt-1 border disabled:opacity-50"
                              style={{ borderColor: RED, color: RED, background: "white" }}
                            >
                              <Trash2 size={12} /> Xoá ảnh
                            </button>
                            {thisBusy && (
                              <div className="w-full h-1 rounded overflow-hidden mt-1" style={{ background: LINE }}>
                                <div className="h-full transition-all" style={{ width: `${aiProgress}%`, background: AMBER }} />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {mode === "pdf" && (
            <>
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center mb-6"
                style={{ borderColor: LINE, background: "white" }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); handleDrawingFiles(e.dataTransfer.files, activeVersionId); }}
              >
                <FileText size={24} color={SLATE} className="mx-auto mb-2" />
                <p className="text-sm mb-3" style={{ color: SLATE }}>Kéo-thả file PDF vào đây, hoặc</p>
                <input ref={pdfRef} type="file" accept=".pdf,application/pdf" multiple className="hidden" onChange={(e) => handleDrawingFiles(e.target.files, activeVersionId)} />
                <button onClick={() => pdfRef.current?.click()} className="inline-flex items-center gap-2 px-4 py-2.5 rounded text-white font-medium" style={{ background: NAVY }}>
                  <Plus size={15} /> Chọn file PDF cho phiên bản này
                </button>
              </div>

              {versionPdfs.length === 0 ? (
                <EmptyState text="Phiên bản này chưa có file PDF nào." />
              ) : (
                <div className="grid md:grid-cols-2 gap-4 mb-6">
                  {versionPdfs.map((f) => {
                    const busy = pdfAiAnalyzing === f.id;
                    return (
                      <div key={f.id} className="bg-white border rounded p-3" style={{ borderColor: LINE }}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText size={15} color={RED} className="shrink-0" />
                            <div className="min-w-0">
                              <div className="text-sm truncate">{f.name}</div>
                              <div className="text-xs" style={{ color: SLATE }}>{fmtSize(f.size)}</div>
                            </div>
                          </div>
                          <button onClick={() => removeDrawingFile(f.id)}><Trash2 size={14} color={RED} /></button>
                        </div>
                        <button
                          onClick={() => analyzePdfAI(f)}
                          disabled={!!pdfAiAnalyzing}
                          className="w-full mb-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-semibold text-white disabled:opacity-60"
                          style={{ background: AMBER_DARK }}
                        >
                          <Sparkles size={13} /> {busy ? `AI đang đọc… ${pdfAiProgress}% · ${String(Math.floor(dongHoGiay / 60)).padStart(2, "0")}:${String(dongHoGiay % 60).padStart(2, "0")}` : "Bắt đầu đọc AI (AI đọc trực tiếp cả file PDF)"}
                        </button>
                        {busy && (
                          <div className="text-xs mb-1 text-center" style={{ color: SLATE }}>
                            ⏱ Đã chờ {String(Math.floor(dongHoGiay / 60)).padStart(2, "0")}:{String(dongHoGiay % 60).padStart(2, "0")} — đồng hồ vẫn nhảy nghĩa là app còn sống, không phải treo (AI có thể đang suy luận sâu, % có lúc đứng yên là bình thường).
                          </div>
                        )}
                        {busy && (
                          <div className="w-full h-1.5 rounded overflow-hidden mb-2" style={{ background: LINE }}>
                            <div className="h-full transition-all" style={{ width: `${pdfAiProgress}%`, background: AMBER }} />
                          </div>
                        )}
                        <a href={f.url} download={f.name} target="_blank" rel="noreferrer" className="flex flex-col items-center justify-center gap-2 rounded" style={{ height: 160, background: PAPER, border: `1px dashed ${LINE}`, color: SLATE }}>
                          <FileText size={28} color={RED} />
                          <span className="text-xs">Bấm để mở/tải xuống xem toàn bộ file</span>
                        </a>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {mode === "dxf" && (
            <div className="p-4 rounded border" style={{ borderColor: GREEN, background: "#F0FBF4" }}>
              <div className="text-sm font-semibold mb-1" style={{ color: GREEN }}>📐 Đọc file DXF — số liệu CHÍNH XÁC, không phải AI đoán</div>
              <p className="text-xs mb-3" style={{ color: SLATE }}>
                Chỉ nhận file <strong>.dxf</strong> (không phải .dwg — nếu chỉ có .dwg, dùng phần mềm CAD hoặc AutoCAD "Save As → DXF" trước).
                App đọc thẳng toạ độ, tính đúng <strong>chiều dài tường (mét)</strong> — bản vẽ mặt bằng KHÔNG có chiều cao nên KHÔNG tự tính ra m² trừ khi chú nhập chiều cao bên dưới.
              </p>
              <div className="flex items-center gap-2 mb-3">
                <label className="text-xs" style={{ color: SLATE }}>Hệ số quy đổi đơn vị bản vẽ → mét:</label>
                <select value={heSoQuyDoiDxf} onChange={(e) => setHeSoQuyDoiDxf(Number(e.target.value))} className="border rounded px-2 py-1 text-sm" style={{ borderColor: LINE }}>
                  <option value={0.001}>÷1000 (bản vẽ đơn vị mm — phổ biến nhất)</option>
                  <option value={0.01}>÷100 (bản vẽ đơn vị cm)</option>
                  <option value={1}>×1 (bản vẽ đã là mét)</option>
                </select>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <label className="text-xs" style={{ color: SLATE }}>Chiều cao tường (m) — để trống nếu chỉ muốn lấy mét dài, không tự tính m²:</label>
                <input type="number" value={chieuCaoTuongDxf} onChange={(e) => setChieuCaoTuongDxf(e.target.value)} placeholder="VD: 3.3" className="border rounded px-2 py-1 text-sm w-24" style={{ borderColor: LINE }} />
              </div>
              <div className="flex items-center gap-2 mb-3">
                <label className="text-xs" style={{ color: SLATE }}>Số mặt tính Tô/Sơn (1 hoặc 2) — chỉ tính khi CÓ nhập cả chiều cao trên:</label>
                <select value={soMatToSonDxf} onChange={(e) => setSoMatToSonDxf(e.target.value)} className="border rounded px-2 py-1 text-sm" style={{ borderColor: LINE }}>
                  <option value="">Không tính Tô/Sơn</option>
                  <option value="1">1 mặt (chỉ mặt ngoài — VD phạm vi Shophouse)</option>
                  <option value="2">2 mặt (trong + ngoài — VD Nhà phố)</option>
                </select>
              </div>
              <input
                type="file" accept=".dxf" multiple
                onChange={(e) => { Array.from(e.target.files || []).forEach((f) => docFileDxf(f, heSoQuyDoiDxf, chieuCaoTuongDxf, soMatToSonDxf)); e.target.value = ""; }}
                className="text-sm"
              />
              <p className="text-xs mt-2" style={{ color: SLATE }}>
                Sau khi đọc, kết quả hiện ở khung "Bước 2" bên dưới. Dòng <strong>"mét dài"</strong> là số THẬT từ DXF —
                dòng "Số lượng cột" cũng là số THẬT (đếm block). Dòng <strong>"SUY LUẬN"</strong> (xây tường/tô/sơn, nếu có
                nhập chiều cao) là ước tính, <strong>CHƯA trừ cửa/cửa sổ</strong> — luôn kiểm tra tay trước khi dùng chính thức.
              </p>
            </div>
          )}
        </>
      )}

      {Object.keys(groups).length > 0 && (
        <div className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="text-sm font-semibold" style={{ color: AMBER_DARK }}>Bước 2 — Duyệt khối lượng AI đọc được</div>
            <button onClick={applyAllAiResults} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-white text-xs font-semibold" style={{ background: GREEN }}>
              <CheckCircle2 size={13} /> Duyệt tất cả (dòng đã khớp định mức)
            </button>
          </div>
          {(() => {
            const soChuaKhop = aiResults.filter((r) => !r.matchedNormId).length;
            return soChuaKhop > 0 ? (
              <div className="mb-3 p-2 rounded text-xs" style={{ background: "#FFF4E5", color: AMBER_DARK, border: `1px solid ${AMBER}` }}>
                <strong>{soChuaKhop} dòng chưa tự khớp được định mức</strong> (nền cam bên dưới) — nút "Duyệt tất cả" KHÔNG gồm các dòng này. Với mỗi dòng cam: mở ô dropdown "— Chưa khớp, chọn thủ công —" → chọn đúng định mức → bấm nút xanh "Thêm vào BOQ" riêng của dòng đó.
              </div>
            ) : null;
          })()}
          <p className="text-xs mb-3" style={{ color: SLATE }}>
            Dòng nào khớp đúng định mức thì bấm "Duyệt tất cả" cho nhanh, hoặc xác nhận/sửa khớp từng dòng rồi bấm "Thêm vào BOQ". Dòng nào AI đọc sai khối lượng thì cứ duyệt trước — sang <strong>Bước 3</strong> sửa lại khối lượng sau, không cần sửa ở đây. Bản vẽ kiến trúc thường chỉ cho đủ số liệu để bóc một phần đầu việc (kết cấu, xây trát, phòng/WC) — các đầu việc khác (PCCC, MEP chi tiết, hoàn thiện...) cần nhập tay theo mẫu dự toán chuẩn của công ty ở thẻ "Điều chỉnh dự toán/khối lượng".
          </p>
          {Object.entries(groups).map(([photoName, rows]) => (
            <div key={photoName} className="bg-white border-2 rounded overflow-hidden mb-4" style={{ borderColor: AMBER }}>
              <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: LINE, background: "#FFF8ED" }}>
                <ImageIcon size={14} /> <span className="text-sm font-semibold" style={{ color: NAVY }}>Từ ảnh: "{photoName}"</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: PAPER }}>
                    <th className="text-left px-3 py-2" style={{ color: SLATE }}>Hạng mục AI đọc</th>
                    <th className="text-right px-3 py-2 w-24" style={{ color: SLATE }}>Khối lượng</th>
                    <th className="text-left px-3 py-2 w-64" style={{ color: SLATE }}>Khớp với định mức</th>
                    <th className="w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <RowMatch key={r.key} r={r} projectNorms={projectNorms} applyAiResult={applyAiResult} skipAiResult={skipAiResult} photos={photos} />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {boqLines.length > 0 && (
        <div className="p-4 rounded border-2" style={{ borderColor: GREEN, background: "#F0FBF4" }}>
          <div className="text-sm font-semibold mb-1" style={{ color: NAVY }}>
            Đã có {boqLines.length} dòng trong BOQ — đơn giá đã tự áp theo nhóm công trình "{PROJECT_GROUPS.find((g) => g.id === activeProject?.groupId)?.name}"{activeProject ? "" : ""} (hoặc theo nhà thầu đang chọn nếu có).
          </div>
          <p className="text-xs mb-3" style={{ color: SLATE }}>Không cần bấm áp giá riêng — cứ có dòng BOQ là đơn giá tự tính theo đúng nhóm công trình/nhà thầu đang chọn ở thẻ "Dự án". Kiểm tra khối lượng đã đúng chưa rồi mới nên xuất file.</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setActiveTab("adjust")} className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium border" style={{ borderColor: LINE, color: NAVY, background: "white" }}>
              <Layers size={14} /> Bước 3 — Điều chỉnh khối lượng nếu cần
            </button>
            <button onClick={() => setActiveTab("exportHub")} className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-white text-sm font-medium" style={{ background: GREEN }}>
              <Eye size={14} /> Bước 4 — Khối lượng OK, xem BOQ đã tính giá
            </button>
          </div>
        </div>
      )}
      {doTrenAnhPhoto && (
        <DoTrenAnhModal
          photo={doTrenAnhPhoto}
          onDong={() => setDoTrenAnhPhoto(null)}
          onApDung={(met) => {
            alert(`Khoảng cách đo được: ${met} m\n\nGhi lại số này, dùng khi nhập tay khối lượng ở thẻ "Điều chỉnh dự toán" hoặc ô "ghi chú bổ sung" khi đọc lại ảnh.`);
            setDoTrenAnhPhoto(null);
          }}
        />
      )}
    </div>
  );
}

// Hiển thị GỌN 5 chỉ số Confidence Matrix — mỗi chỉ số 1 chấm màu (xanh=cao,
// vàng=trung bình, đỏ=thấp, xám=không có dữ liệu). Hover xem chi tiết từng
// chỉ số nghĩa là gì — tránh người dùng phải nhớ 5 khái niệm kỹ thuật.
function ConfidenceMatrixBadge({ cm }) {
  const items = [
    { key: "evidenceConfidence", label: "Bằng chứng", giaTri: cm.evidenceConfidence, giaiThich: "Có vùng ảnh minh chứng cho số liệu này không" },
    { key: "geometryConfidence", label: "Tỷ lệ/hình học", giaTri: cm.geometryConfidence, giaiThich: "Độ tin cậy của tỷ lệ bản vẽ dùng để tính (xem chi tiết ở bước 05_SCALE)" },
    { key: "dimensionConfidence", label: "Số đo", giaTri: cm.dimensionConfidence, giaiThich: "AI tự đánh giá độ chắc chắn khi đọc/ước lượng số đo — null nghĩa là AI không tự báo cáo" },
    { key: "formulaConfidence", label: "Công thức", giaTri: cm.formulaConfidence, giaiThich: "Khối lượng có được Engine tự tính bằng công thức thật hay không" },
    { key: "reconciliationConfidence", label: "Đối chiếu chéo", giaTri: cm.reconciliationConfidence, giaiThich: "So sánh với nguồn khác (VD Plan vs Schedule) có khớp không — 0.7 nghĩa là không có gì để đối chiếu" },
  ];
  const mauCham = (v) => v == null ? "#CBD5E1" : v >= 0.8 ? GREEN : v >= 0.5 ? AMBER : RED;
  const tooltipText = items.map((i) => `${i.label}: ${i.giaTri == null ? "không có" : i.giaTri.toFixed(1)} — ${i.giaiThich}`).join("\n");
  return (
    <div className="flex items-center gap-1 mt-0.5" title={tooltipText}>
      <span className="text-xs" style={{ color: SLATE }}>Độ tin cậy:</span>
      {items.map((i) => (
        <span key={i.key} style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: mauCham(i.giaTri) }} />
      ))}
    </div>
  );
}

function RowMatch({ r, projectNorms, applyAiResult, skipAiResult, photos }) {
  const [normId, setNormId] = useState(r.matchedNormId);
  const [xemEvidence, setXemEvidence] = useState(false);
  useEffect(() => { setNormId(r.matchedNormId); }, [r.matchedNormId]);
  const anhGoc = photos?.find((p) => p.name === r.sourcePhoto);
  const coTheXemEvidence = !!(r.evidence_region && anhGoc);
  return (
    <tr className="border-t" style={{ borderColor: LINE, background: r.nghiTrung ? "#FCEBEA" : (normId ? "transparent" : "#FFF4E5") }}>
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          {r.name}
          {r.nghiTrung && (
            <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{ background: RED, color: "white" }} title="Có 1 dòng khác cùng tên + cùng khối lượng — có thể AI đọc trùng cùng 1 cấu kiện ở nhiều trang. Kiểm tra kỹ trước khi thêm cả 2, tránh tính 2 lần.">⚠️ Nghi trùng</span>
          )}
          {coTheXemEvidence && (
            <button onClick={() => setXemEvidence(true)} className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{ background: NAVY, color: "white" }} title="Xem đúng vùng trên bản vẽ mà AI dùng để đọc/tính dòng này">
              📍 Xem vị trí
            </button>
          )}
        </div>
        <div className="text-xs" style={{ color: SLATE }}>{r.note} {r.unit && `· ${r.unit}`}</div>
        {r.confidenceMatrix && <ConfidenceMatrixBadge cm={r.confidenceMatrix} />}
      </td>
      <td className="px-3 py-1.5 text-right font-mono">{r.qty}</td>
      <td className="px-3 py-1.5">
        <select value={normId} onChange={(e) => setNormId(e.target.value)} className="border rounded px-2 py-1 text-xs w-full" style={{ borderColor: normId ? LINE : AMBER }}>
          <option value="">— Chưa khớp, chọn thủ công —</option>
          {projectNorms.map((n) => <option key={n.id} value={n.id}>{n.code} — {n.name}</option>)}
        </select>
      </td>
      {xemEvidence && createPortal(
        <EvidenceViewerModal anhGoc={anhGoc} evidenceRegion={r.evidence_region} tenHangMuc={r.name} onDong={() => setXemEvidence(false)} />,
        document.body
      )}
      <td className="px-2 py-1.5 text-center">
        <div className="flex items-center gap-1 justify-center">
          <button onClick={() => applyAiResult(r.key, normId)} disabled={!normId} className="text-xs px-2 py-1 rounded text-white font-medium disabled:opacity-40" style={{ background: GREEN }}>
            Thêm vào BOQ
          </button>
          <button onClick={() => skipAiResult(r.key)} title="Bỏ dòng này — AI đọc sai/thừa/trùng, không thêm vào BOQ" className="text-xs px-2 py-1 rounded border" style={{ borderColor: RED, color: RED, background: "white" }}>
            Bỏ
          </button>
        </div>
      </td>
    </tr>
  );
}


function NormsTab({ norms, materials, labor, materialsById, laborById, addNorm, activeProject, changeLog }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", unit: "m2", standard: "", groups: [], scope: "local", vt: [], nc: [], may: [], reason: "" });

  const resetForm = () => setForm({ code: "", name: "", unit: "m2", standard: "", groups: [], scope: "local", vt: [], nc: [], may: [], reason: "" });

  const addRow = (kind) => {
    setForm((f) => ({ ...f, [kind]: [...f[kind], kind === "may" ? { laborId: labor[0]?.id, ca: 0 } : kind === "nc" ? { laborId: labor[0]?.id, cong: 0 } : { materialId: materials[0]?.id, haoPhi: 0 }] }));
  };
  const updateRow = (kind, idx, field, value) => {
    setForm((f) => ({ ...f, [kind]: f[kind].map((row, i) => (i === idx ? { ...row, [field]: value } : row)) }));
  };
  const removeRow = (kind, idx) => setForm((f) => ({ ...f, [kind]: f[kind].filter((_, i) => i !== idx) }));

  const submit = () => {
    if (!form.code || !form.name) return;
    const groups = form.scope === "master" ? form.groups : [activeProject.groupId];
    addNorm({ code: form.code, name: form.name, unit: form.unit, standard: form.standard, groups, vt: form.vt, nc: form.nc, may: form.may }, form.scope, form.reason);
    resetForm();
    setShowForm(false);
  };

  return (
    <div>
      <SectionHeader icon={ClipboardList} title="Định mức Dự toán (Master / Local)" desc={`Danh sách định mức áp dụng cho dự án đang chọn (nhóm: ${PROJECT_GROUPS.find((g) => g.id === activeProject?.groupId)?.name}). "Master" dùng chung mọi dự án, "Local" chỉ áp dụng riêng dự án này.`} />

      <button onClick={() => setShowForm((s) => !s)} className="mb-4 inline-flex items-center gap-2 px-4 py-2 rounded text-white text-sm font-medium" style={{ background: NAVY }}>
        <Plus size={15} /> {showForm ? "Đóng form" : "Thêm định mức mới"}
      </button>

      {showForm && (
        <div className="bg-white border-2 rounded p-4 mb-6" style={{ borderColor: AMBER }}>
          <div className="grid md:grid-cols-3 gap-3 mb-3">
            <div>
              <div className="text-xs mb-1" style={{ color: SLATE }}>Mã công tác</div>
              <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} className="border rounded px-2 py-1.5 text-sm w-full" style={{ borderColor: LINE }} />
            </div>
            <div className="md:col-span-2">
              <div className="text-xs mb-1" style={{ color: SLATE }}>Tên công tác</div>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="border rounded px-2 py-1.5 text-sm w-full" style={{ borderColor: LINE }} />
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: SLATE }}>Đơn vị tính</div>
              <input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} className="border rounded px-2 py-1.5 text-sm w-full" style={{ borderColor: LINE }} />
            </div>
            <div className="md:col-span-2">
              <div className="text-xs mb-1" style={{ color: SLATE }}>Tiêu chuẩn tham chiếu (TCVN/ASTM/JIS...)</div>
              <input value={form.standard} onChange={(e) => setForm((f) => ({ ...f, standard: e.target.value }))} className="border rounded px-2 py-1.5 text-sm w-full" style={{ borderColor: LINE }} />
            </div>
          </div>

          {["vt", "nc", "may"].map((kind) => (
            <div key={kind} className="mb-3">
              <div className="text-xs font-semibold mb-1" style={{ color: NAVY }}>
                {kind === "vt" ? "Hao phí vật tư" : kind === "nc" ? "Hao phí nhân công" : "Hao phí máy thi công"}
                <button onClick={() => addRow(kind)} className="ml-2 text-xs" style={{ color: AMBER_DARK }}>+ thêm dòng</button>
              </div>
              {form[kind].map((row, idx) => (
                <div key={idx} className="flex items-center gap-2 mb-1">
                  <select
                    value={kind === "vt" ? row.materialId : row.laborId}
                    onChange={(e) => updateRow(kind, idx, kind === "vt" ? "materialId" : "laborId", e.target.value)}
                    className="border rounded px-2 py-1 text-xs flex-1"
                    style={{ borderColor: LINE }}
                  >
                    {(kind === "vt" ? materials : labor).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <input
                    type="number" step="0.001" value={kind === "vt" ? row.haoPhi : kind === "nc" ? row.cong : row.ca}
                    onChange={(e) => updateRow(kind, idx, kind === "vt" ? "haoPhi" : kind === "nc" ? "cong" : "ca", parseFloat(e.target.value) || 0)}
                    className="num-input border rounded px-2 py-1 text-xs w-24 font-mono" style={{ borderColor: LINE }}
                  />
                  <button onClick={() => removeRow(kind, idx)}><X size={13} color={RED} /></button>
                </div>
              ))}
            </div>
          ))}

          <div className="flex items-center gap-4 mb-3 mt-4 pt-3 border-t" style={{ borderColor: LINE }}>
            <div className="text-sm font-semibold" style={{ color: NAVY }}>Phạm vi áp dụng:</div>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="radio" checked={form.scope === "master"} onChange={() => setForm((f) => ({ ...f, scope: "master" }))} /> Master (dùng chung mọi dự án)
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="radio" checked={form.scope === "local"} onChange={() => setForm((f) => ({ ...f, scope: "local" }))} /> Local (chỉ dự án này)
            </label>
          </div>
          {form.scope === "master" && (
            <div className="mb-3">
              <div className="text-xs mb-1" style={{ color: SLATE }}>Áp dụng cho các nhóm công trình</div>
              <div className="flex flex-wrap gap-2">
                {PROJECT_GROUPS.map((g) => (
                  <label key={g.id} className="flex items-center gap-1 text-xs px-2 py-1 rounded border" style={{ borderColor: LINE }}>
                    <input type="checkbox" checked={form.groups.includes(g.id)} onChange={(e) => setForm((f) => ({ ...f, groups: e.target.checked ? [...f.groups, g.id] : f.groups.filter((x) => x !== g.id) }))} />
                    {g.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Lý do thêm định mức này (phục vụ ghi log)" className="border rounded px-2 py-1.5 text-sm w-full mb-3" style={{ borderColor: LINE }} />
          <button onClick={submit} disabled={!form.code || !form.name} className="px-4 py-2 rounded text-white text-sm font-medium disabled:opacity-40" style={{ background: GREEN }}>Lưu định mức</button>
        </div>
      )}

      {norms.length === 0 ? (
        <EmptyState text="Chưa có định mức nào áp dụng cho nhóm công trình của dự án này." />
      ) : (
        <div className="bg-white border rounded overflow-hidden mb-6" style={{ borderColor: LINE }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: PAPER }}>
                <th className="text-left px-3 py-2" style={{ color: SLATE }}>Mã</th>
                <th className="text-left px-3 py-2" style={{ color: SLATE }}>Tên công tác</th>
                <th className="text-left px-3 py-2" style={{ color: SLATE }}>ĐVT</th>
                <th className="text-left px-3 py-2" style={{ color: SLATE }}>Tiêu chuẩn</th>
                <th className="text-right px-3 py-2" style={{ color: SLATE }}>Đơn giá phân tích</th>
                <th className="text-center px-3 py-2" style={{ color: SLATE }}>Phạm vi</th>
              </tr>
            </thead>
            <tbody>
              {norms.map((n) => (
                <NormDetailRow key={n.id} n={n} materialsById={materialsById} laborById={laborById} groupId={activeProject?.groupId} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {changeLog.length > 0 && (
        <div>
          <div className="text-sm font-semibold mb-2" style={{ color: NAVY }}>Lịch sử thay đổi (định mức + khối lượng/giá BOQ)</div>
          <div className="bg-white border rounded overflow-hidden" style={{ borderColor: LINE }}>
            {changeLog.slice(0, 10).map((l) => (
              <div key={l.id} className="px-3 py-2 text-xs border-b" style={{ borderColor: LINE }}>
                <span style={{ color: SLATE }}>{l.when}</span> — <strong>{l.who}</strong>: {l.what} {l.reason && <span style={{ color: SLATE }}>({l.reason})</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Dòng định mức có thể bấm mở rộng — hiện chi tiết phân tích giá vốn từng vật tư/
// nhân công/máy, kèm dòng hao hụt TƯỜNG MINH (Định mức + Hao hụt % = Thực tế) để
// thuyết phục chủ đầu tư/hội đồng thẩm định về tính chính xác của hồ sơ dự toán.
function NormDetailRow({ n, materialsById, laborById, groupId }) {
  const [open, setOpen] = useState(false);
  const analyzed = computeAnalyzedPrice(n, materialsById, laborById, groupId);
  return (
    <Fragment>
      <tr className="border-t cursor-pointer" style={{ borderColor: LINE, background: open ? "#F6F8FA" : "transparent" }} onClick={() => setOpen((o) => !o)}>
        <td className="px-3 py-2 font-mono text-xs">{n.code}</td>
        <td className="px-3 py-2">
          <span className="mr-1.5 text-xs" style={{ color: SLATE }}>{open ? "▼" : "▶"}</span>{n.name}
        </td>
        <td className="px-3 py-2">{n.unit}</td>
        <td className="px-3 py-2 text-xs" style={{ color: SLATE }}>{n.standard}</td>
        <td className="px-3 py-2 text-right font-mono">{fmt(analyzed.total)}</td>
        <td className="px-3 py-2 text-center">
          <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: n.scope === "master" ? "#E2E9F0" : "#FFF4E5", color: n.scope === "master" ? NAVY : AMBER_DARK }}>
            {n.scope === "master" ? "Master" : "Local"}
          </span>
        </td>
      </tr>
      {open && (
        <tr style={{ background: "#F6F8FA" }}>
          <td colSpan={6} className="px-4 py-3">
            <div className="text-xs font-semibold mb-1.5" style={{ color: NAVY }}>Phân tích giá vốn cho 1 {n.unit} — nhóm hiện tại</div>
            {analyzed.vlDetail.length > 0 && (
              <div className="mb-2">
                <div className="text-xs font-semibold mb-1" style={{ color: SLATE }}>Vật tư: {fmt(analyzed.vlCost)} đ</div>
                {analyzed.vlDetail.map((d, i) => (
                  <div key={i} className="text-xs pl-3 py-0.5" style={{ color: INK }}>
                    • {d.name} — {d.wastagePct > 0
                      ? <>Định mức: <strong>{d.haoPhi}</strong> + Hao hụt: <strong style={{ color: AMBER_DARK }}>{d.wastagePct}%</strong> = Thực tế: <strong>{+d.haoPhiThucTe.toFixed(4)}</strong></>
                      : <>Định mức: <strong>{d.haoPhi}</strong> (không tính hao hụt)</>}
                    {" "}× {fmt(d.price)}đ = <span className="font-mono font-semibold">{fmt(d.cost)}đ</span>
                    {d.vendor && <span className="ml-1" style={{ color: GREEN }}>(giá NCC)</span>}
                    {d.borrowed && <span className="ml-1" style={{ color: AMBER_DARK }}>(mượn giá nhóm khác)</span>}
                  </div>
                ))}
              </div>
            )}
            {analyzed.ncDetail.length > 0 && (
              <div className="mb-2">
                <div className="text-xs font-semibold mb-1" style={{ color: SLATE }}>Nhân công: {fmt(analyzed.ncCost)} đ</div>
                {analyzed.ncDetail.map((d, i) => (
                  <div key={i} className="text-xs pl-3 py-0.5" style={{ color: INK }}>
                    • {d.name} — Hao phí: <strong>{d.cong}</strong> công × {fmt(d.price)}đ = <span className="font-mono font-semibold">{fmt(d.cost)}đ</span>
                    {d.vendor && <span className="ml-1" style={{ color: GREEN }}>(giá NCC)</span>}
                  </div>
                ))}
              </div>
            )}
            {analyzed.mayDetail.length > 0 && (
              <div>
                <div className="text-xs font-semibold mb-1" style={{ color: SLATE }}>Máy thi công: {fmt(analyzed.mayCost)} đ</div>
                {analyzed.mayDetail.map((d, i) => (
                  <div key={i} className="text-xs pl-3 py-0.5" style={{ color: INK }}>
                    • {d.name} — Hao phí: <strong>{d.ca}</strong> ca × {fmt(d.price)}đ = <span className="font-mono font-semibold">{fmt(d.cost)}đ</span>
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// ============================================================================
// MÀN HÌNH NHẬP MÃ TRUY CẬP
// ============================================================================
function LoginGate({ onSubmit, error, onRetry }) {
  const [ma, setMa] = useState("");
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: PAPER, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="w-full max-w-sm bg-white border rounded-lg p-6" style={{ borderColor: LINE }}>
        <div className="font-bold text-lg mb-1" style={{ color: NAVY }}>QS/QC ESTIMATE</div>
        <div className="text-xs mb-5" style={{ color: SLATE }}>Phần mềm dự toán nội bộ — vui lòng nhập mã truy cập được cấp.</div>

        <div className="text-xs mb-1" style={{ color: SLATE }}>Mã truy cập</div>
        <input
          value={ma}
          onChange={(e) => setMa(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSubmit(ma); }}
          placeholder="VD: PTC001"
          className="border rounded px-3 py-2 text-sm w-full mb-3 font-mono"
          style={{ borderColor: LINE }}
        />
        <button onClick={() => onSubmit(ma)} disabled={!ma.trim()} className="w-full py-2.5 rounded text-white text-sm font-semibold disabled:opacity-40" style={{ background: NAVY }}>
          Vào phần mềm
        </button>

        {error && (
          <div className="mt-3 p-2 rounded text-xs" style={{ background: "#FCEBEA", color: RED, border: `1px solid ${RED}` }}>
            {error}
            <button onClick={onRetry} className="block mt-2 underline font-semibold">Thử lại</button>
          </div>
        )}
        <div className="mt-4 text-xs" style={{ color: SLATE }}>Chưa có mã? Liên hệ người quản trị của công ty để được cấp.</div>
      </div>
    </div>
  );
}

// ============================================================================
// SO SÁNH DỰ ÁN HIỆN TẠI VỚI 1 MẪU DỰ TOÁN CÙNG NHÓM CÔNG TRÌNH
// ----------------------------------------------------------------------------
// Dùng khi dự toán mẫu (làm trước, hoặc mẫu chuẩn công ty) có nhiều/ít hơn đầu
// việc so với dự án đang làm. Hiện rõ đầu việc THIẾU (có trong mẫu, chưa có ở
// đây) và THỪA (có ở đây, không có trong mẫu) — chú tự quyết định thêm/bỏ,
// KHÔNG tự động âm thầm sửa dữ liệu để tránh sai lệch không kiểm soát được.
// ============================================================================
function SoSanhMauBlock({ boqTemplates, soSanhVoiMau, themDauViecThieu, xoaDauViecThua }) {
  const [tpl, setTpl] = useState("");
  const [ketQua, setKetQua] = useState(null);

  const chay = () => { if (tpl) setKetQua(soSanhVoiMau(tpl)); };

  return (
    <div className="mt-4 pt-4 border-t" style={{ borderColor: LINE }}>
      <div className="text-sm font-semibold mb-1" style={{ color: NAVY }}>So sánh với mẫu dự toán (kiểm tra thiếu/dư đầu việc)</div>
      <p className="text-xs mb-2" style={{ color: SLATE }}>Đối chiếu dự án đang chọn với 1 mẫu công trình cùng loại — thấy ngay đầu việc nào thiếu so với mẫu, đầu việc nào dư ra không có trong mẫu.</p>
      <div className="flex flex-wrap gap-2 mb-2">
        <select value={tpl} onChange={(e) => { setTpl(e.target.value); setKetQua(null); }} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE, minWidth: 160 }}>
          <option value="">— chọn mẫu để so sánh —</option>
          {Object.keys(boqTemplates).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button onClick={chay} disabled={!tpl} className="px-3 py-1.5 rounded text-white text-xs font-medium disabled:opacity-40" style={{ background: NAVY }}>So sánh</button>
      </div>

      {ketQua && (
        <div className="space-y-3">
          {ketQua.thieu.length === 0 && ketQua.thua.length === 0 ? (
            <div className="p-2 rounded text-xs" style={{ background: "#F0FBF4", color: GREEN }}>✓ Dự án đang khớp đủ đầu việc với mẫu "{ketQua.tenMau}" — không thiếu, không dư.</div>
          ) : (
            <>
              {ketQua.thieu.length > 0 && (
                <div className="p-2 rounded border" style={{ borderColor: AMBER, background: "#FFF8ED" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs font-semibold" style={{ color: AMBER_DARK }}>Thiếu {ketQua.thieu.length} đầu việc so với mẫu "{ketQua.tenMau}"</div>
                    <button onClick={() => { themDauViecThieu(ketQua.tenMau, ketQua.thieu); setKetQua(null); setTpl(""); }} className="text-xs px-2 py-1 rounded text-white font-medium" style={{ background: GREEN }}>+ Thêm tất cả vào dự án</button>
                  </div>
                  {ketQua.thieu.map((it, i) => (
                    <div key={i} className="text-xs py-0.5" style={{ color: INK }}>• {it.normName}</div>
                  ))}
                </div>
              )}
              {ketQua.thua.length > 0 && (
                <div className="p-2 rounded border" style={{ borderColor: "#D0B0AA", background: "#FCEBEA" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs font-semibold" style={{ color: RED }}>Dư {ketQua.thua.length} đầu việc không có trong mẫu "{ketQua.tenMau}"</div>
                    <button onClick={() => { xoaDauViecThua(ketQua.thua.map((t) => t.id)); setKetQua(null); setTpl(""); }} className="text-xs px-2 py-1 rounded text-white font-medium" style={{ background: RED }}>Bỏ tất cả các dòng dư</button>
                  </div>
                  {ketQua.thua.map((t, i) => (
                    <div key={i} className="text-xs py-0.5" style={{ color: INK }}>• {t.normName}</div>
                  ))}
                  <div className="text-xs mt-1" style={{ color: SLATE }}>Dòng dư có thể hợp lý cho riêng dự án này (khác mẫu) — kiểm tra kỹ trước khi bỏ.</div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// BẢNG NHẬT KÝ SỬ DỤNG (chỉ người quản trị xem được)
// ============================================================================
function UsageLogPanel({ authHeaders }) {
  const [data, setData] = useState(null);
  const [dangTai, setDangTai] = useState(false);
  const [loi, setLoi] = useState("");
  const tai = async () => {
    setDangTai(true); setLoi("");
    try {
      const r = await fetch(`${BACKEND_URL}/api/usage-log`, { headers: authHeaders() });
      const d = await r.json();
      if (!r.ok) setLoi(d?.error || `Lỗi HTTP ${r.status}`);
      else setData(d);
    } catch (e) { setLoi(`Không gọi được server: ${e.message}`); }
    finally { setDangTai(false); }
  };
  return (
    <div className="mb-4 p-3 rounded border bg-white" style={{ borderColor: LINE }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="text-sm font-semibold" style={{ color: NAVY }}>Nhật ký sử dụng của cả team (quản trị)</div>
        <button onClick={tai} disabled={dangTai} className="text-xs font-semibold px-3 py-1.5 rounded text-white disabled:opacity-50" style={{ background: NAVY }}>
          {dangTai ? "Đang tải…" : "Xem nhật ký"}
        </button>
      </div>
      {loi && <div className="p-2 rounded text-xs mb-2" style={{ background: "#FCEBEA", color: RED }}>{loi}</div>}
      {data && (
        <>
          <div className="text-xs mb-2" style={{ color: SLATE }}>Tổng cộng {data.tongSoLan} lượt đọc bản vẽ từ trước tới nay.</div>
          <table className="w-full text-xs mb-3">
            <thead><tr style={{ background: PAPER }}>
              <th className="text-left px-2 py-1" style={{ color: SLATE }}>Người dùng</th>
              <th className="text-right px-2 py-1" style={{ color: SLATE }}>Số lượt</th>
              <th className="text-right px-2 py-1" style={{ color: SLATE }}>Chi phí</th>
            </tr></thead>
            <tbody>
              {Object.entries(data.tongTheoNguoi || {}).map(([ten, t]) => (
                <tr key={ten} className="border-t" style={{ borderColor: LINE }}>
                  <td className="px-2 py-1 font-medium">{ten}</td>
                  <td className="px-2 py-1 text-right font-mono">{t.soLan}</td>
                  <td className="px-2 py-1 text-right font-mono" style={{ color: AMBER_DARK }}>{fmt(t.vnd)} đ</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-xs font-semibold mb-1" style={{ color: NAVY }}>20 lượt gần nhất</div>
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {(data.log || []).slice(0, 20).map((b, i) => (
              <div key={i} className="text-xs py-1 border-b" style={{ borderColor: LINE, color: SLATE }}>
                <strong style={{ color: INK }}>{b.nguoi}</strong> · {b.loai} · {new Date(b.luc).toLocaleString("vi-VN")} · <span className="font-mono">{fmt(b.vnd)} đ</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Thay đổi dự toán mẫu — quản trị GET/PUT trực tiếp qua API, áp dụng cho MỌI
// dự án mới thuộc đúng nhóm ngay lập tức, không cần sửa lại từng dự án.
// SỬA LỖI THẬT (phát hiện qua review độc lập, xác nhận bằng code thật): trước
// đây đây là 1 ô textarea gõ tự do, tên mẫu KHÔNG có gì đảm bảo trùng chữ với
// tên trong database định mức (projectNorms) — AI được yêu cầu dùng tên mẫu
// NGUYÊN VĂN, nhưng sau đó bước khớp định mức lại so với database định mức
// KHÁC, dẫn tới lệch tên/mất đơn giá dù QS đã lập mẫu rất kỹ (VD placeholder
// cũ ghi "Xây tường 100" nhưng định mức thật tên "Xây tường gạch đặc dày
// 100mm, cao ≤4m" — không đủ điểm khớp mờ). Giờ mỗi dòng mẫu CÓ THỂ gắn thẳng
// 1 normId — khi đã gắn, AI trả đúng tên đó sẽ lấy normId này NGUYÊN, không
// qua khớp mờ nữa (xem khopTheoLienKetMau ở phần đọc bản vẽ).
function TemplateEditorPanel({ authHeaders, projectNorms }) {
  const [groupId, setGroupId] = useState("nha-pho");
  const [rows, setRows] = useState([]); // [{key, ten, normId}]
  const [textDanNhanh, setTextDanNhanh] = useState(""); // dán nhanh nhiều dòng, chưa gắn định mức
  const [gopThem, setGopThem] = useState(false);
  const [thongTin, setThongTin] = useState(null); // { version, updatedAt, updatedBy }
  const [dangTai, setDangTai] = useState(false);
  const [loi, setLoi] = useState("");

  const tai = async (gid) => {
    setDangTai(true); setLoi("");
    try {
      // Gọi endpoint ĐẦY ĐỦ (không phải /names) để lấy được normId đã gắn sẵn
      // của từng dòng, nếu có — /names chỉ trả tên, sẽ mất liên kết khi tải lại.
      const r = await fetch(`${BACKEND_URL}/api/templates/${gid}`, { headers: authHeaders() });
      const d = await r.json();
      if (!r.ok) { setLoi(d?.error || `Lỗi HTTP ${r.status}`); return; }
      const items = Array.isArray(d.items) ? d.items : [];
      setRows(items.map((it) => ({
        key: uid("tplrow"),
        ten: typeof it === "string" ? it : (it?.ten || ""),
        normId: typeof it === "object" && it?.normId ? it.normId : "",
      })).filter((r) => r.ten));
      setThongTin({ version: d.version, updatedAt: d.updatedAt, updatedBy: d.updatedBy });
    } catch (e) { setLoi(`Không gọi được server: ${e.message}`); }
    finally { setDangTai(false); }
  };

  useEffect(() => { tai(groupId); }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  const luu = async () => {
    setDangTai(true); setLoi("");
    try {
      const items = rows.map((r) => ({ ten: r.ten.trim(), normId: r.normId || null })).filter((it) => it.ten);
      const r = await fetch(`${BACKEND_URL}/api/templates/${groupId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ items, gopThem }),
      });
      const d = await r.json();
      if (!r.ok) { setLoi(d?.error || `Lỗi HTTP ${r.status}`); return; }
      setThongTin({ version: d.version, updatedAt: d.updatedAt, updatedBy: d.updatedBy });
      const itemsMoi = Array.isArray(d.items) ? d.items : items;
      setRows(itemsMoi.map((it) => ({
        key: uid("tplrow"),
        ten: typeof it === "string" ? it : (it?.ten || ""),
        normId: typeof it === "object" && it?.normId ? it.normId : "",
      })).filter((r) => r.ten));
    } catch (e) { setLoi(`Không gọi được server: ${e.message}`); }
    finally { setDangTai(false); }
  };

  const themTuDanNhanh = () => {
    const tenMoi = textDanNhanh.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!tenMoi.length) return;
    const tenDaCo = new Set(rows.map((r) => chuanHoaTen(r.ten)));
    const rowsMoi = tenMoi.filter((t) => !tenDaCo.has(chuanHoaTen(t))).map((t) => ({ key: uid("tplrow"), ten: t, normId: "" }));
    setRows((prev) => [...prev, ...rowsMoi]);
    setTextDanNhanh("");
  };

  const xoaDong = (key) => setRows((prev) => prev.filter((r) => r.key !== key));
  const suaTen = (key, ten) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ten } : r)));
  const ganNormId = (key, normId) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, normId } : r)));

  // Norm ứng viên để gợi ý — ưu tiên đúng nhóm công trình (n.groups chứa groupId
  // hiện tại), rơi về toàn bộ database nếu norm chưa gắn nhóm nào.
  const normUngVien = useMemo(
    () => (projectNorms || []).filter((n) => !Array.isArray(n.groups) || !n.groups.length || n.groups.includes(groupId)),
    [projectNorms, groupId]
  );

  // Tự động khớp CÁC DÒNG CHƯA GẮN — chỉ GỢI Ý (đổ vào ô chọn), KHÔNG tự lưu
  // ngay, để QS luôn là người xác nhận cuối cùng trước khi bấm "Lưu mẫu".
  const tuDongKhop = () => {
    setRows((prev) => prev.map((r) => {
      if (r.normId) return r; // đã gắn tay rồi thì không ghi đè
      let bestId = "", bestScore = 0;
      for (const n of normUngVien) {
        const sc = similarity(r.ten, n.name);
        if (sc > bestScore) { bestScore = sc; bestId = n.id; }
      }
      return bestScore >= 0.5 ? { ...r, normId: bestId } : r;
    }));
  };

  const soChuaGan = rows.filter((r) => !r.normId).length;

  return (
    <div className="mb-4 p-3 rounded border bg-white" style={{ borderColor: LINE }}>
      <div className="text-sm font-semibold mb-2" style={{ color: NAVY }}>Thay đổi dự toán mẫu (quản trị)</div>
      <p className="text-xs mb-2" style={{ color: SLATE }}>
        Sửa 1 lần, áp dụng ngay cho mọi dự án mới thuộc đúng nhóm. Mỗi dòng là 1 tên hạng mục — gắn thêm <strong>định mức liên kết</strong> để khi AI đọc bản vẽ trả về đúng tên này, app tự lấy đúng đơn giá NGAY, không cần khớp mờ (dễ trật khi tên gõ tay không trùng hệt tên định mức).
      </p>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE }}>
          {PROJECT_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        {thongTin && <span className="text-xs" style={{ color: SLATE }}>Phiên bản v{thongTin.version}{thongTin.updatedBy ? ` · sửa lần cuối bởi ${thongTin.updatedBy}` : ""}</span>}
        {rows.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded" style={{ background: soChuaGan ? "#FFF3CD" : "#E8F5E9", color: soChuaGan ? "#8A6300" : GREEN }}>
            {rows.length - soChuaGan}/{rows.length} dòng đã gắn định mức
          </span>
        )}
      </div>
      {loi && <div className="p-2 rounded text-xs mb-2" style={{ background: "#FCEBEA", color: RED }}>{loi}</div>}

      <datalist id="template-norm-options">
        {normUngVien.map((n) => <option key={n.id} value={n.name} />)}
      </datalist>

      <div className="border rounded mb-2 max-h-80 overflow-y-auto" style={{ borderColor: LINE }}>
        {rows.length === 0 && <div className="p-3 text-xs text-center" style={{ color: SLATE }}>Chưa có dòng nào — dán nhanh tên hạng mục ở ô bên dưới rồi bấm "Thêm vào danh sách".</div>}
        {rows.map((r) => {
          const normHienTai = r.normId ? projectNorms.find((n) => n.id === r.normId) : null;
          return (
            <div key={r.key} className="flex items-center gap-1.5 p-1.5 border-b last:border-b-0" style={{ borderColor: LINE }}>
              <input
                value={r.ten} onChange={(e) => suaTen(r.key, e.target.value)}
                className="border rounded px-2 py-1 text-xs flex-1 min-w-0" style={{ borderColor: LINE }}
                placeholder="Tên hạng mục"
              />
              <input
                list="template-norm-options"
                value={normHienTai ? normHienTai.name : ""}
                onChange={(e) => {
                  const found = normUngVien.find((n) => n.name === e.target.value);
                  ganNormId(r.key, found ? found.id : "");
                }}
                className="border rounded px-2 py-1 text-xs flex-1 min-w-0"
                style={{ borderColor: r.normId ? GREEN : AMBER }}
                placeholder="Gõ để tìm định mức liên kết…"
              />
              {r.normId && (
                <button onClick={() => ganNormId(r.key, "")} title="Bỏ liên kết" className="text-xs px-1.5 py-1 rounded border shrink-0" style={{ borderColor: LINE, color: SLATE }}>✕liên kết</button>
              )}
              <button onClick={() => xoaDong(r.key)} title="Xoá dòng" className="text-xs px-1.5 py-1 rounded border shrink-0" style={{ borderColor: LINE, color: RED }}>Xoá</button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <button onClick={tuDongKhop} disabled={dangTai || !rows.length} className="text-xs font-semibold px-3 py-1.5 rounded border disabled:opacity-50" style={{ borderColor: LINE, color: NAVY }}>
          Tự động khớp {soChuaGan > 0 ? `(${soChuaGan} dòng chưa gắn)` : ""}
        </button>
        <span className="text-xs" style={{ color: SLATE }}>Chỉ gợi ý các dòng chưa gắn — kiểm tra lại trước khi Lưu mẫu, không tự lưu ngay.</span>
      </div>

      <textarea
        rows={4} className="border rounded px-2 py-1.5 text-xs w-full font-mono" style={{ borderColor: LINE }}
        placeholder="Dán nhanh nhiều dòng (mỗi dòng 1 tên, chưa gắn định mức)&#10;Đào móng&#10;Đổ bê tông móng"
        value={textDanNhanh} onChange={(e) => setTextDanNhanh(e.target.value)}
      />
      <div className="flex items-center justify-between mt-2">
        <button onClick={themTuDanNhanh} disabled={!textDanNhanh.trim()} className="text-xs font-semibold px-3 py-1.5 rounded border disabled:opacity-50" style={{ borderColor: LINE, color: NAVY }}>
          Thêm vào danh sách
        </button>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs" style={{ color: SLATE }}>
            <input type="checkbox" checked={gopThem} onChange={(e) => setGopThem(e.target.checked)} />
            Chỉ thêm dòng mới — bỏ chọn để ghi đè toàn bộ
          </label>
          <button onClick={() => tai(groupId)} disabled={dangTai} className="text-xs font-semibold px-3 py-1.5 rounded border disabled:opacity-50" style={{ borderColor: LINE, color: NAVY }}>
            Tải lại
          </button>
          <button onClick={luu} disabled={dangTai} className="text-xs font-semibold px-3 py-1.5 rounded text-white disabled:opacity-50" style={{ background: GREEN }}>
            {dangTai ? "Đang lưu…" : "Lưu mẫu"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TAB: NHÀ THẦU / NCC — mỗi nhà thầu có 1 bảng báo giá riêng, tách biệt với giá
// nội bộ theo nhóm công trình. Chọn 1 nhà thầu "đang hoạt động" thì Đơn giá/
// Phân tích/BOQ/Xuất file tự dùng giá của nhà thầu đó cho vật tư/nhân công đã có
// báo giá — vật tư nào nhà thầu chưa báo giá thì tự rơi về giá nội bộ như cũ.
// ============================================================================
function VendorTab({
  vendors, activeVendorId, setActiveVendorId, addVendor, removeVendor, vendorPrices, updateVendorPrice,
  materials, labor, activeProject,
  vendorImportKind, setVendorImportKind, handleVendorImportFile, vendorImportResults, vendorImportReport,
  applyVendorImportRow, applyAllVendorImport, cancelVendorImport, skipVendorImportRow, vendorImportBatch, undoVendorImportBatch,
}) {
  const [view, setView] = useState("list"); // "list" | "edit" | "import"
  const [newName, setNewName] = useState("");
  const [newContact, setNewContact] = useState("");
  const [editingVendorId, setEditingVendorId] = useState(null);
  const gid = activeProject?.groupId;

  const stats = (vendorId) => {
    const book = vendorPrices[vendorId] || {};
    const allItems = [...materials, ...labor];
    const quoted = allItems.filter((it) => book[it.id] != null).length;
    return { quoted, total: allItems.length, pct: allItems.length ? quoted / allItems.length : 0 };
  };

  const submitAdd = () => {
    if (!newName.trim()) return;
    const id = addVendor(newName.trim(), newContact.trim());
    setActiveVendorId(id);
    setNewName(""); setNewContact("");
  };

  return (
    <div>
      <SectionHeader icon={Building2} title="Nhà thầu / NCC — so sánh &amp; chọn giá chào" desc='Mỗi nhà thầu/NCC có 1 bảng đơn giá báo giá riêng cho vật tư, nhân công. Chọn 1 nhà thầu "đang hoạt động" — toàn bộ Đơn giá phân tích, BOQ, Xuất file sẽ tự dùng giá của nhà thầu đó cho hạng mục đã có báo giá; hạng mục nào nhà thầu chưa báo giá thì tự dùng giá nội bộ như bình thường.' />

      <div className="no-print flex gap-2 mb-5 border-b flex-wrap" style={{ borderColor: LINE }}>
        <button onClick={() => setView("list")} className="px-4 py-2 text-sm font-medium" style={{ color: view === "list" ? NAVY : SLATE, borderBottom: view === "list" ? `2px solid ${AMBER}` : "2px solid transparent" }}>
          <Building2 size={14} className="inline mr-1.5 -mt-0.5" /> Danh sách nhà thầu
        </button>
        <button onClick={() => setView("import")} className="px-4 py-2 text-sm font-medium" style={{ color: view === "import" ? NAVY : SLATE, borderBottom: view === "import" ? `2px solid ${AMBER}` : "2px solid transparent" }}>
          <FileSpreadsheet size={14} className="inline mr-1.5 -mt-0.5" /> Nhập file báo giá
        </button>
      </div>

      {view === "import" ? (
        <VendorImportPanel
          vendors={vendors} materials={materials} labor={labor}
          vendorImportKind={vendorImportKind} setVendorImportKind={setVendorImportKind}
          handleVendorImportFile={handleVendorImportFile} vendorImportResults={vendorImportResults} vendorImportReport={vendorImportReport}
          applyVendorImportRow={applyVendorImportRow} applyAllVendorImport={applyAllVendorImport}
          cancelVendorImport={cancelVendorImport} skipVendorImportRow={skipVendorImportRow}
          vendorImportBatch={vendorImportBatch} undoVendorImportBatch={undoVendorImportBatch}
        />
      ) : (
        <>
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            {vendors.map((v) => {
              const s = stats(v.id);
              const active = v.id === activeVendorId;
              return (
                <div key={v.id} className="bg-white border-2 rounded p-4" style={{ borderColor: active ? AMBER : LINE }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {active && <Star size={14} color={AMBER} fill={AMBER} />}
                        <span className="font-semibold text-sm truncate">{v.name}</span>
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: SLATE }}>{v.contact || "—"}</div>
                    </div>
                    {v.id !== "internal" && (
                      <button onClick={() => removeVendor(v.id)} title="Xoá nhà thầu"><Trash2 size={14} color={RED} /></button>
                    )}
                  </div>

                  {v.id !== "internal" && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs mb-1" style={{ color: SLATE }}>
                        <span>Đã có giá: {s.quoted}/{s.total} hạng mục</span>
                        <span>{(s.pct * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: LINE }}>
                        <div className="h-full" style={{ width: `${s.pct * 100}%`, background: s.pct === 1 ? GREEN : AMBER }} />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-3">
                    {v.id !== "internal" && (
                      <button onClick={() => setEditingVendorId(v.id)} className="px-3 py-1.5 rounded text-xs font-medium border" style={{ borderColor: LINE, color: NAVY }}>
                        Sửa giá tay
                      </button>
                    )}
                    <button
                      onClick={() => setActiveVendorId(v.id)}
                      disabled={active}
                      className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50 ml-auto"
                      style={{ background: active ? LINE : NAVY, color: active ? SLATE : "white" }}
                    >
                      {active ? "Đang chọn" : "Chọn để chào giá"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white border rounded p-4 max-w-lg mb-6" style={{ borderColor: LINE }}>
            <div className="text-sm font-semibold mb-3" style={{ color: NAVY }}>Thêm nhà thầu / NCC mới</div>
            <div className="flex flex-col gap-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Tên nhà thầu (vd: Đại Dũng Corp)" className="border rounded px-3 py-2 text-sm" style={{ borderColor: LINE }} />
              <input value={newContact} onChange={(e) => setNewContact(e.target.value)} placeholder="Liên hệ (SĐT / email — tuỳ chọn)" className="border rounded px-3 py-2 text-sm" style={{ borderColor: LINE }} />
              <button onClick={submitAdd} disabled={!newName.trim()} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded text-white text-sm font-medium disabled:opacity-40" style={{ background: NAVY }}>
                <Plus size={14} /> Thêm nhà thầu
              </button>
            </div>
          </div>

          {editingVendorId && (
            <VendorPriceEditor
              vendor={vendors.find((v) => v.id === editingVendorId)}
              materials={materials} labor={labor}
              vendorPrices={vendorPrices[editingVendorId] || {}}
              updateVendorPrice={(itemId, value) => updateVendorPrice(editingVendorId, itemId, value)}
              gid={gid}
              onClose={() => setEditingVendorId(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function VendorPriceEditor({ vendor, materials, labor, vendorPrices, updateVendorPrice, gid, onClose }) {
  const groupName = PROJECT_GROUPS.find((g) => g.id === gid)?.name;
  return (
    <div className="bg-white border-2 rounded p-4" style={{ borderColor: AMBER }}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold" style={{ color: NAVY }}>Sửa giá tay — nhà thầu "{vendor?.name}"</div>
        <button onClick={onClose} className="text-xs px-2 py-1 rounded border" style={{ borderColor: LINE, color: SLATE }}>Đóng</button>
      </div>
      <p className="text-xs mb-3" style={{ color: SLATE }}>Bỏ trống = nhà thầu này chưa báo giá mục đó — BOQ sẽ tự dùng giá nội bộ (nhóm "{groupName}") thay thế.</p>
      <div className="text-xs font-semibold mb-2" style={{ color: NAVY }}>Vật tư</div>
      <div className="border rounded overflow-hidden mb-4 max-h-64 overflow-y-auto" style={{ borderColor: LINE }}>
        <table className="w-full text-sm">
          <tbody>
            {materials.map((m) => (
              <tr key={m.id} className="border-t" style={{ borderColor: LINE }}>
                <td className="px-3 py-1.5">{m.name}</td>
                <td className="px-3 py-1.5 w-32">
                  <input type="number" value={vendorPrices[m.id] ?? ""} onChange={(e) => updateVendorPrice(m.id, e.target.value === "" ? null : parseFloat(e.target.value))} placeholder="chưa báo giá" className="num-input w-full text-right outline-none bg-transparent font-mono" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-xs font-semibold mb-2" style={{ color: NAVY }}>Nhân công / Ca máy</div>
      <div className="border rounded overflow-hidden max-h-64 overflow-y-auto" style={{ borderColor: LINE }}>
        <table className="w-full text-sm">
          <tbody>
            {labor.map((l) => (
              <tr key={l.id} className="border-t" style={{ borderColor: LINE }}>
                <td className="px-3 py-1.5">{l.name}</td>
                <td className="px-3 py-1.5 w-32">
                  <input type="number" value={vendorPrices[l.id] ?? ""} onChange={(e) => updateVendorPrice(l.id, e.target.value === "" ? null : parseFloat(e.target.value))} placeholder="chưa báo giá" className="num-input w-full text-right outline-none bg-transparent font-mono" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VendorImportPanel({
  vendors, materials, labor,
  vendorImportKind, setVendorImportKind, handleVendorImportFile, vendorImportResults, vendorImportReport,
  applyVendorImportRow, applyAllVendorImport, cancelVendorImport, skipVendorImportRow, vendorImportBatch, undoVendorImportBatch,
}) {
  const [pickVendorId, setPickVendorId] = useState(vendors.find((v) => v.id !== "internal")?.id || "");
  const fileRef = useRef(null);
  const existingList = vendorImportKind === "material" ? materials : labor;
  const nonInternalVendors = vendors.filter((v) => v.id !== "internal");

  if (!nonInternalVendors.length) {
    return <EmptyState text='Chưa có nhà thầu nào ngoài "Giá nội bộ" — sang mục "Danh sách nhà thầu" để thêm nhà thầu trước.' />;
  }

  return (
    <div>
      <div className="bg-white border rounded p-4 mb-5" style={{ borderColor: LINE }}>
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div>
            <div className="text-xs mb-1" style={{ color: SLATE }}>Nạp báo giá cho nhà thầu</div>
            <select value={pickVendorId} onChange={(e) => setPickVendorId(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE }}>
              {nonInternalVendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs mb-1" style={{ color: SLATE }}>File này chứa báo giá</div>
            <div className="flex gap-3 pt-1.5">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="radio" checked={vendorImportKind === "material"} onChange={() => setVendorImportKind("material")} /> Vật tư
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="radio" checked={vendorImportKind === "labor"} onChange={() => setVendorImportKind("labor")} /> Nhân công / Ca máy
              </label>
            </div>
          </div>
        </div>
        <div
          className="border-2 border-dashed rounded-lg p-5 text-center"
          style={{ borderColor: LINE }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); pickVendorId && handleVendorImportFile(e.dataTransfer.files[0], vendorImportKind, pickVendorId); }}
        >
          <FileSpreadsheet size={22} color={SLATE} className="mx-auto mb-2" />
          <p className="text-sm mb-3" style={{ color: SLATE }}>Kéo-thả file báo giá NCC (.xlsx/.csv) vào đây, hoặc</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => pickVendorId && handleVendorImportFile(e.target.files[0], vendorImportKind, pickVendorId)} />
          <button onClick={() => pickVendorId && fileRef.current?.click()} disabled={!pickVendorId} className="inline-flex items-center gap-2 px-4 py-2 rounded text-white font-medium disabled:opacity-40" style={{ background: NAVY }}>
            <Plus size={14} /> Chọn file
          </button>
        </div>
      </div>

      {vendorImportReport && (
        <div className="mb-4 p-3 rounded border text-xs" style={{ borderColor: LINE, background: PAPER, color: SLATE }}>
          Đã quét {vendorImportReport.total} sheet trong "{vendorImportReport.fileName}".
          <button onClick={cancelVendorImport} className="ml-3 underline" style={{ color: RED }}>Huỷ, xoá kết quả này</button>
        </div>
      )}

      {vendorImportBatch.length > 0 && (
        <div className="mb-4">
          <button onClick={undoVendorImportBatch} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border" style={{ borderColor: LINE, color: SLATE }}>
            <RotateCcw size={13} /> Hoàn tác {vendorImportBatch.length} dòng vừa áp dụng
          </button>
        </div>
      )}

      {vendorImportResults.length > 0 && (
        <div className="bg-white border-2 rounded overflow-hidden" style={{ borderColor: AMBER }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: LINE, background: "#FFF8ED" }}>
            <div className="text-sm font-semibold" style={{ color: AMBER_DARK }}>{vendorImportResults.length} dòng báo giá đọc được</div>
            <button onClick={applyAllVendorImport} className="px-4 py-1.5 rounded text-white text-sm font-medium" style={{ background: GREEN }}>Áp dụng tất cả (dòng đã khớp)</button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: PAPER }}>
                <th className="text-left px-3 py-2" style={{ color: SLATE }}>Tên (trong file)</th>
                <th className="text-right px-3 py-2 w-28" style={{ color: SLATE }}>Đơn giá</th>
                <th className="text-left px-3 py-2 w-64" style={{ color: SLATE }}>Khớp với</th>
                <th className="w-32"></th>
              </tr>
            </thead>
            <tbody>
              {vendorImportResults.map((r) => (
                <VendorImportRow key={r.key} r={r} existingList={existingList} applyVendorImportRow={applyVendorImportRow} skipVendorImportRow={skipVendorImportRow} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function VendorImportRow({ r, existingList, applyVendorImportRow, skipVendorImportRow }) {
  const [targetId, setTargetId] = useState(r.matchedId || "");
  useEffect(() => { setTargetId(r.matchedId || ""); }, [r.matchedId]);
  return (
    <tr className="border-t" style={{ borderColor: LINE, background: targetId ? "transparent" : "#FFF4E5" }}>
      <td className="px-3 py-1.5">
        <div>{r.name}</div>
        <div className="text-xs" style={{ color: SLATE }}>sheet "{r.sheet}"</div>
      </td>
      <td className="px-3 py-1.5 text-right font-mono">{fmt(r.price)}</td>
      <td className="px-3 py-1.5">
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="border rounded px-2 py-1 text-xs w-full" style={{ borderColor: targetId ? LINE : AMBER }}>
          <option value="">— chưa khớp, chọn tay —</option>
          {existingList.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5 text-center">
        <div className="flex items-center gap-1 justify-center">
          <button onClick={() => targetId && applyVendorImportRow(r.key, targetId)} disabled={!targetId} className="text-xs px-2 py-1 rounded text-white font-medium disabled:opacity-40" style={{ background: NAVY }}>
            Áp dụng
          </button>
          <button onClick={() => skipVendorImportRow(r.key)} title="Bỏ qua dòng này">
            <X size={14} color={RED} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ============================================================================
// TAB 3: VẬT TƯ & NHÂN CÔNG (Unit Price Engine)
// ============================================================================
// ============================================================================
// TAB: NHẬP FILE ĐƠN GIÁ MẪU (đọc Excel/CSV dự toán mẫu, khớp vật tư/nhân công có sẵn)
// ============================================================================
function ImportPricesTab({
  materials, labor, priceImportKind, setPriceImportKind, priceImportGroupId, setPriceImportGroupId,
  handlePriceImportFile, priceImportResults, priceImportReport, applyPriceImportRow, applyAllPriceImport,
  cancelPriceImport, skipPriceImportRow, importBatch, undoImportBatch,
  updateMaterialPrice, updateMaterialField, updateLaborPrice, addMaterial, removeMaterial, removeLabor, activeProject,
  norms, materialsById, laborById, addNorm, changeLog,
  priceLog, applyPriceSlide, undoLastAdjustment, adjustHistory,
}) {
  const fileRef = useRef(null);
  const existingList = priceImportKind === "material" ? materials : labor;
  const gid = priceImportGroupId; // 1 group dùng chung cho cả sửa tay + nhập file — không cần đổi thẻ qua lại
  const groupName = PROJECT_GROUPS.find((g) => g.id === gid)?.name;
  const [showMatForm, setShowMatForm] = useState(false);
  const [matForm, setMatForm] = useState({ code: "", name: "", spec: "", unit: "m2", price: 0, wastagePct: 0, supplier: "", coCq: false, reason: "" });
  const [view, setView] = useState("gia"); // "gia" (đơn giá) | "dinhmuc" (định mức) | "truotgia" (trượt giá)
  const [slideMode, setSlideMode] = useState("pct"); // "pct" | "set"
  const [slidePct, setSlidePct] = useState("");
  const [slideFixed, setSlideFixed] = useState("");
  const [slideReason, setSlideReason] = useState("");
  const [slideTarget, setSlideTarget] = useState("both"); // "material" | "labor" | "both"

  const submitMat = () => {
    if (!matForm.code || !matForm.name) return;
    addMaterial({ code: matForm.code, name: matForm.name, spec: matForm.spec, unit: matForm.unit, prices: { [gid]: matForm.price }, wastagePct: matForm.wastagePct, supplier: matForm.supplier, coCq: matForm.coCq }, matForm.reason);
    setMatForm({ code: "", name: "", spec: "", unit: "m2", price: 0, supplier: "", coCq: false, reason: "" });
    setShowMatForm(false);
  };

  const missingCoCq = materials.filter((m) => !m.coCq);

  return (
    <div>
      <SectionHeader icon={DollarSign} title="Dự toán mẫu — Đơn giá & Định mức" desc="Toàn bộ cấu hình 'một lần' của dự án: đơn giá vật tư/nhân công theo từng nhóm công trình, và thư viện định mức áp dụng. Cấu hình xong ở đây thì các dự án sau chỉ cần tải bản vẽ lên là ra BOQ." />

      <div className="no-print flex gap-2 mb-5 border-b flex-wrap" style={{ borderColor: LINE }}>
        <button onClick={() => setView("gia")} className="px-4 py-2 text-sm font-medium" style={{ color: view === "gia" ? NAVY : SLATE, borderBottom: view === "gia" ? `2px solid ${AMBER}` : "2px solid transparent" }}>
          <DollarSign size={14} className="inline mr-1.5 -mt-0.5" /> Đơn giá Vật tư — Nhân công
        </button>
        <button onClick={() => setView("dinhmuc")} className="px-4 py-2 text-sm font-medium" style={{ color: view === "dinhmuc" ? NAVY : SLATE, borderBottom: view === "dinhmuc" ? `2px solid ${AMBER}` : "2px solid transparent" }}>
          <ClipboardList size={14} className="inline mr-1.5 -mt-0.5" /> Định mức
        </button>
        <button onClick={() => setView("truotgia")} className="px-4 py-2 text-sm font-medium" style={{ color: view === "truotgia" ? NAVY : SLATE, borderBottom: view === "truotgia" ? `2px solid ${AMBER}` : "2px solid transparent" }}>
          <TrendingUp size={14} className="inline mr-1.5 -mt-0.5" /> Trượt giá
        </button>
      </div>

      {view === "truotgia" ? (
        <div>
          <div className="mb-4 p-3 rounded border" style={{ borderColor: AMBER, background: "#FFF8ED" }}>
            <div className="text-xs font-semibold mb-1.5" style={{ color: AMBER_DARK }}>Áp dụng cho nhóm công trình:</div>
            <select value={gid} onChange={(e) => setPriceImportGroupId(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-full max-w-sm font-semibold" style={{ borderColor: LINE, color: NAVY }}>
              {PROJECT_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="bg-white border rounded p-4 mb-6 max-w-xl" style={{ borderColor: LINE }}>
            <div className="text-sm font-semibold mb-1" style={{ color: NAVY }}>Điều chỉnh giá hàng loạt — nhóm "{groupName}"</div>
            <p className="text-xs mb-3" style={{ color: SLATE }}>Vật tư/nhân công lên hoặc xuống giá theo thời điểm? Đổi hàng loạt giá đã có sẵn của nhóm này trong 1 lần — theo % hoặc đặt thẳng 1 mức giá cố định. Không đổi giá vật tư đang mượn từ nhóm khác.</p>

            <div className="flex gap-2 mb-3">
              <button onClick={() => setSlideMode("pct")} className="px-3 py-1.5 rounded text-xs font-medium" style={{ background: slideMode === "pct" ? NAVY : PAPER, color: slideMode === "pct" ? "white" : SLATE }}>Theo % trượt giá</button>
              <button onClick={() => setSlideMode("set")} className="px-3 py-1.5 rounded text-xs font-medium" style={{ background: slideMode === "set" ? NAVY : PAPER, color: slideMode === "set" ? "white" : SLATE }}>Đặt giá cố định</button>
            </div>

            {slideMode === "pct" ? (
              <>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[-15, -10, -5, -3, 3, 5, 10, 15].map((q) => (
                    <button key={q} onClick={() => setSlidePct(String(q))} className="px-2.5 py-1 rounded text-xs font-mono font-semibold" style={{ background: q < 0 ? "#FCEBEA" : "#F0FBF4", color: q < 0 ? RED : GREEN }}>
                      {q > 0 ? "+" : ""}{q}%
                    </button>
                  ))}
                </div>
                <div className="text-xs mb-1" style={{ color: SLATE }}>% thay đổi (âm = giảm giá, gõ tay cũng được)</div>
                <input type="number" step="0.5" value={slidePct} onChange={(e) => setSlidePct(e.target.value)} className="num-input border rounded px-2 py-1.5 text-sm w-28 font-mono mb-3" style={{ borderColor: LINE }} />
              </>
            ) : (
              <>
                <div className="text-xs mb-1" style={{ color: SLATE }}>Mức giá cố định áp cho tất cả (đ)</div>
                <input type="number" value={slideFixed} onChange={(e) => setSlideFixed(e.target.value)} className="num-input border rounded px-2 py-1.5 text-sm w-40 font-mono mb-3" style={{ borderColor: LINE }} />
              </>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1" style={{ minWidth: 160 }}>
                <div className="text-xs mb-1" style={{ color: SLATE }}>Áp dụng cho</div>
                <select value={slideTarget} onChange={(e) => setSlideTarget(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-full" style={{ borderColor: LINE }}>
                  <option value="material">Chỉ đơn giá Vật tư</option>
                  <option value="labor">Chỉ đơn giá Nhân công</option>
                  <option value="both">Cả Vật tư &amp; Nhân công</option>
                </select>
              </div>
              <div className="flex-1" style={{ minWidth: 160 }}>
                <div className="text-xs mb-1" style={{ color: SLATE }}>Lý do (tuỳ chọn)</div>
                <input value={slideReason} onChange={(e) => setSlideReason(e.target.value)} placeholder="VD: giá thép tăng theo NCC" className="border rounded px-2 py-1.5 text-sm w-full" style={{ borderColor: LINE }} />
              </div>
              <button
                onClick={() => {
                  applyPriceSlide(slideMode, slideMode === "pct" ? slidePct : slideFixed, slideTarget, gid, slideReason);
                  setSlidePct(""); setSlideFixed(""); setSlideReason("");
                }}
                disabled={slideMode === "pct" ? !slidePct : !slideFixed}
                className="px-4 py-2 rounded text-white text-sm font-medium disabled:opacity-40"
                style={{ background: AMBER_DARK }}
              >
                Áp dụng cho nhóm "{groupName}"
              </button>
            </div>

            {adjustHistory && adjustHistory.length > 0 && (
              <button onClick={undoLastAdjustment} className="mt-3 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border" style={{ borderColor: LINE, color: SLATE }}>
                <RotateCcw size={13} /> Hoàn tác lần điều chỉnh gần nhất
              </button>
            )}
          </div>

          <div className="text-sm font-semibold mb-2" style={{ color: NAVY }}>Nhật ký điều chỉnh giá</div>
          {(!priceLog || priceLog.length === 0) ? (
            <EmptyState text="Chưa có lần điều chỉnh nào." />
          ) : (
            <div className="bg-white border rounded overflow-hidden max-w-2xl" style={{ borderColor: LINE }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: PAPER }}>
                    <th className="text-left px-3 py-2" style={{ color: SLATE }}>Thời điểm</th>
                    <th className="text-right px-3 py-2 w-24" style={{ color: SLATE }}>Thay đổi</th>
                    <th className="text-left px-3 py-2" style={{ color: SLATE }}>Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {priceLog.map((l) => (
                    <tr key={l.id} className="border-t" style={{ borderColor: LINE }}>
                      <td className="px-3 py-1.5 text-xs" style={{ color: SLATE }}>{l.when}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold" style={{ color: l.pct == null ? NAVY : l.pct < 0 ? RED : GREEN }}>{l.pct == null ? "cố định" : `${l.pct > 0 ? "+" : ""}${l.pct}%`}</td>
                      <td className="px-3 py-1.5 text-xs">{l.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : view === "dinhmuc" ? (
        <NormsTab norms={norms} materials={materials} labor={labor} materialsById={materialsById} laborById={laborById} addNorm={addNorm} activeProject={activeProject} changeLog={changeLog} />
      ) : (
      <>
      <div className="mb-4 grid md:grid-cols-2 gap-4 items-start">
        <div className="p-3 rounded border" style={{ borderColor: AMBER, background: "#FFF8ED" }}>
          <div className="text-xs font-semibold mb-1.5" style={{ color: AMBER_DARK }}>Đang xem/sửa đơn giá cho nhóm công trình:</div>
          <select value={gid} onChange={(e) => setPriceImportGroupId(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-full font-semibold" style={{ borderColor: LINE, color: NAVY }}>
            {PROJECT_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <p className="text-xs mt-1.5" style={{ color: SLATE }}>
            Mặc định lấy theo nhóm của dự án đang mở ("{PROJECT_GROUPS.find((g) => g.id === activeProject?.groupId)?.name}") — đổi ở đây nếu đang muốn xem/nạp trước giá cho 1 nhóm khác. Nhóm nào chưa có giá riêng cho 1 vật tư sẽ tự mượn tạm giá từ nhóm gần nhất có sẵn (đánh dấu vàng bên dưới).
          </p>
        </div>

        <div className="p-3 rounded border bg-white" style={{ borderColor: LINE }}>
          <div className="text-xs font-semibold mb-1.5" style={{ color: NAVY }}>Hoặc nạp hàng loạt từ file dự toán mẫu:</div>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <label className="flex items-center gap-1.5 text-xs">
              <input type="radio" checked={priceImportKind === "material"} onChange={() => setPriceImportKind("material")} /> Vật tư
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input type="radio" checked={priceImportKind === "labor"} onChange={() => setPriceImportKind("labor")} /> Nhân công / Ca máy
            </label>
          </div>
          <div
            className="border-2 border-dashed rounded-lg py-3 px-2 text-center"
            style={{ borderColor: LINE }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handlePriceImportFile(e.dataTransfer.files[0], priceImportKind); }}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handlePriceImportFile(e.target.files[0], priceImportKind)} />
            <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-white text-xs font-medium" style={{ background: NAVY }}>
              <Plus size={13} /> Chọn file (hoặc kéo-thả vào đây)
            </button>
            <p className="text-xs mt-1.5" style={{ color: SLATE }}>
              Dùng đúng nhóm "{groupName}" đã chọn bên trái — .xlsx/.csv, đọc hết mọi sheet trong file.
            </p>
          </div>
        </div>
      </div>

      {priceImportReport && (
        <div className="bg-white border rounded p-3 mb-5 text-xs" style={{ borderColor: LINE }}>
          <div className="flex items-center justify-between mb-1">
            <div className="font-semibold" style={{ color: NAVY }}>Kết quả quét file "{priceImportReport.fileName}" ({priceImportReport.total} sheet):</div>
            {priceImportResults.length > 0 && (
              <button onClick={cancelPriceImport} className="text-xs px-2 py-1 rounded font-medium border shrink-0" style={{ borderColor: RED, color: RED }}>
                <X size={11} className="inline mr-1" /> Huỷ, xoá kết quả này (up nhầm file)
              </button>
            )}
          </div>
          {priceImportReport.sheetReport.map((s) => (
            <div key={s.name} style={{ color: s.count > 0 ? GREEN : SLATE }}>
              • {s.name}: {s.status}
            </div>
          ))}
        </div>
      )}

      {importBatch.length > 0 && (
        <div className="mb-5 p-3 rounded border flex items-center justify-between" style={{ borderColor: AMBER, background: "#FFF8ED" }}>
          <div className="text-xs" style={{ color: AMBER_DARK }}>
            Đã áp dụng {importBatch.length} thay đổi từ file vừa nhập. Nếu phát hiện nhầm file sau khi đã áp dụng, có thể hoàn tác toàn bộ.
          </div>
          <button onClick={undoImportBatch} className="text-xs px-3 py-1.5 rounded text-white font-medium shrink-0" style={{ background: RED }}>
            Hoàn tác {importBatch.length} thay đổi vừa áp dụng
          </button>
        </div>
      )}

      {priceImportResults.length > 0 && (
        <div className="bg-white border-2 rounded overflow-hidden mb-5" style={{ borderColor: AMBER }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: LINE, background: "#FFF8ED" }}>
            <div className="text-sm font-semibold" style={{ color: AMBER_DARK }}>{priceImportResults.length} dòng đơn giá đọc được — xác nhận rồi áp dụng</div>
            <button onClick={applyAllPriceImport} className="px-4 py-1.5 rounded text-white text-sm font-medium" style={{ background: GREEN }}>Áp dụng tất cả (theo gợi ý)</button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: PAPER }}>
                <th className="text-left px-3 py-2" style={{ color: SLATE }}>Tên (trong file)</th>
                <th className="text-left px-3 py-2 w-16" style={{ color: SLATE }}>ĐVT</th>
                <th className="text-right px-3 py-2 w-28" style={{ color: SLATE }}>Đơn giá</th>
                <th className="text-left px-3 py-2 w-64" style={{ color: SLATE }}>Khớp với</th>
                <th className="w-40"></th>
              </tr>
            </thead>
            <tbody>
              {priceImportResults.map((r) => (
                <ImportRow key={r.key} r={r} existingList={existingList} applyPriceImportRow={applyPriceImportRow} skipPriceImportRow={skipPriceImportRow} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {missingCoCq.length > 0 && (
        <div className="mb-5 p-3 rounded border flex items-start gap-2" style={{ borderColor: RED, background: "#FCEBEA" }}>
          <AlertTriangle size={15} color={RED} className="mt-0.5 shrink-0" />
          <div className="text-xs" style={{ color: RED }}>
            <strong>{missingCoCq.length} vật tư CHƯA có CO/CQ:</strong> {missingCoCq.map((m) => m.name).join(", ")}. Không nên xuất BOQ chính thức khi còn vật tư thiếu chứng chỉ nguồn gốc/chất lượng.
          </div>
        </div>
      )}

      <div className="text-sm font-semibold mb-3" style={{ color: NAVY }}>Vật tư — nhóm "{groupName}"</div>

      <div className="bg-white border rounded overflow-hidden mb-6" style={{ borderColor: LINE }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: PAPER }}>
              <th className="text-left px-3 py-2" style={{ color: SLATE }}>Mã hiệu</th>
              <th className="text-left px-3 py-2" style={{ color: SLATE }}>Tên vật tư</th>
              <th className="text-left px-3 py-2" style={{ color: SLATE }}>ĐVT</th>
              <th className="text-right px-3 py-2 w-40" style={{ color: SLATE }}>Đơn giá (nhóm này)</th>
              <th className="text-right px-3 py-2 w-24" style={{ color: SLATE }} title="Hao hụt vật tư khi thi công (vỡ, cắt dư...) — tự cộng thêm vào hao phí khi tính đơn giá phân tích">Hao hụt %</th>
              <th className="text-center px-3 py-2" style={{ color: SLATE }}>CO/CQ</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => {
              const rp = resolvePrice(m, gid);
              const thieuGia = !rp.price || rp.price <= 0;
              return (
                <tr key={m.id} className="border-t" style={{ borderColor: LINE, background: thieuGia ? "#FCEBEA" : rp.borrowed ? "#FFF8ED" : "transparent" }}>
                  <td className="px-3 py-1.5 font-mono text-xs">{m.code}</td>
                  <td className="px-3 py-1.5">{m.name} {thieuGia && <span className="text-xs font-semibold" style={{ color: RED }}>— CHƯA CÓ GIÁ, cần nhập giá thực tế tại địa phương</span>}</td>
                  <td className="px-3 py-1.5">{m.unit}</td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {rp.borrowed && <span className="text-xs" style={{ color: AMBER_DARK }} title={`Chưa có giá riêng cho nhóm "${groupName}" — đang mượn tạm từ nhóm "${PROJECT_GROUPS.find((g) => g.id === rp.source)?.name}"`}>⚠</span>}
                      <input type="number" value={rp.price} onChange={(e) => updateMaterialPrice(m.id, gid, parseFloat(e.target.value) || 0)} className="num-input w-24 text-right outline-none bg-transparent font-mono" style={{ color: thieuGia ? RED : rp.borrowed ? AMBER_DARK : INK }} />
                    </div>
                    {rp.borrowed && <div className="text-xs text-right" style={{ color: AMBER_DARK }}>mượn từ: {PROJECT_GROUPS.find((g) => g.id === rp.source)?.name}</div>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <input type="number" step="0.5" min="0" value={m.wastagePct || 0} onChange={(e) => updateMaterialField(m.id, "wastagePct", parseFloat(e.target.value) || 0)} className="num-input w-16 text-right outline-none bg-transparent font-mono" />
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {m.coCq ? <CheckCircle2 size={14} color={GREEN} className="inline" /> : <span className="text-xs font-semibold" style={{ color: RED }}>Chưa có</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center"><button onClick={() => removeMaterial(m.id)} title="Xoá vật tư"><Trash2 size={13} color={RED} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-sm font-semibold mb-3" style={{ color: NAVY }}>Nhân công / Ca máy — nhóm "{groupName}"</div>
      <div className="bg-white border rounded overflow-hidden mb-6" style={{ borderColor: LINE }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: PAPER }}>
              <th className="text-left px-3 py-2" style={{ color: SLATE }}>Loại thợ / máy</th>
              <th className="text-left px-3 py-2" style={{ color: SLATE }}>Vùng miền</th>
              <th className="text-left px-3 py-2" style={{ color: SLATE }}>ĐVT</th>
              <th className="text-right px-3 py-2 w-40" style={{ color: SLATE }}>Đơn giá (nhóm này)</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {labor.map((l) => {
              const rp = resolvePrice(l, gid);
              return (
                <tr key={l.id} className="border-t" style={{ borderColor: LINE, background: rp.borrowed ? "#FFF8ED" : "transparent" }}>
                  <td className="px-3 py-1.5">{l.name}</td>
                  <td className="px-3 py-1.5 text-xs" style={{ color: SLATE }}>{l.region}</td>
                  <td className="px-3 py-1.5">{l.unit}</td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {rp.borrowed && <span className="text-xs" style={{ color: AMBER_DARK }} title={`Chưa có giá riêng cho nhóm "${groupName}" — đang mượn tạm từ nhóm "${PROJECT_GROUPS.find((g) => g.id === rp.source)?.name}"`}>⚠</span>}
                      <input type="number" value={rp.price} onChange={(e) => updateLaborPrice(l.id, gid, parseFloat(e.target.value) || 0)} className="num-input w-24 text-right outline-none bg-transparent font-mono" style={{ color: rp.borrowed ? AMBER_DARK : INK }} />
                    </div>
                    {rp.borrowed && <div className="text-xs text-right" style={{ color: AMBER_DARK }}>mượn từ: {PROJECT_GROUPS.find((g) => g.id === rp.source)?.name}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-center"><button onClick={() => removeLabor(l.id)} title="Xoá nhân công/máy"><Trash2 size={13} color={RED} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="pt-4 mt-2 border-t" style={{ borderColor: LINE }}>
        <button onClick={() => setShowMatForm((s) => !s)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-white text-xs font-medium" style={{ background: NAVY }}>
          <Plus size={13} /> Khai báo vật tư mới (không có sẵn trong danh sách trên)
        </button>

        {showMatForm && (
          <div className="bg-white border-2 rounded p-4 mt-3" style={{ borderColor: AMBER }}>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <div>
                <div className="text-xs mb-1" style={{ color: SLATE }}>Mã hiệu NSX (bắt buộc)</div>
                <input value={matForm.code} onChange={(e) => setMatForm((f) => ({ ...f, code: e.target.value }))} className="border rounded px-2 py-1.5 text-sm w-full" style={{ borderColor: matForm.code ? LINE : RED }} />
              </div>
              <div className="md:col-span-2">
                <div className="text-xs mb-1" style={{ color: SLATE }}>Tên vật tư</div>
                <input value={matForm.name} onChange={(e) => setMatForm((f) => ({ ...f, name: e.target.value }))} className="border rounded px-2 py-1.5 text-sm w-full" style={{ borderColor: LINE }} />
              </div>
              <div className="md:col-span-2">
                <div className="text-xs mb-1" style={{ color: SLATE }}>Quy cách</div>
                <input value={matForm.spec} onChange={(e) => setMatForm((f) => ({ ...f, spec: e.target.value }))} className="border rounded px-2 py-1.5 text-sm w-full" style={{ borderColor: LINE }} />
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: SLATE }}>ĐVT</div>
                <input value={matForm.unit} onChange={(e) => setMatForm((f) => ({ ...f, unit: e.target.value }))} className="border rounded px-2 py-1.5 text-sm w-full" style={{ borderColor: LINE }} />
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: SLATE }}>Đơn giá</div>
                <input type="number" value={matForm.price} onChange={(e) => setMatForm((f) => ({ ...f, price: parseFloat(e.target.value) || 0 }))} className="num-input border rounded px-2 py-1.5 text-sm w-full font-mono" style={{ borderColor: LINE }} />
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: SLATE }}>Hao hụt thi công (%)</div>
                <input type="number" step="0.5" min="0" value={matForm.wastagePct} onChange={(e) => setMatForm((f) => ({ ...f, wastagePct: parseFloat(e.target.value) || 0 }))} className="num-input border rounded px-2 py-1.5 text-sm w-full font-mono" style={{ borderColor: LINE }} />
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: SLATE }}>NCC</div>
                <input value={matForm.supplier} onChange={(e) => setMatForm((f) => ({ ...f, supplier: e.target.value }))} className="border rounded px-2 py-1.5 text-sm w-full" style={{ borderColor: LINE }} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm mb-3">
              <input type="checkbox" checked={matForm.coCq} onChange={(e) => setMatForm((f) => ({ ...f, coCq: e.target.checked }))} /> Đã có CO/CQ (chứng chỉ xuất xứ/chất lượng)
            </label>
            <button onClick={submitMat} disabled={!matForm.code || !matForm.name} className="px-4 py-2 rounded text-white text-sm font-medium disabled:opacity-40" style={{ background: GREEN }}>Lưu vật tư</button>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

function ImportRow({ r, existingList, applyPriceImportRow, skipPriceImportRow }) {
  const [targetId, setTargetId] = useState(r.matchedId);
  useEffect(() => { setTargetId(r.matchedId); }, [r.matchedId]);
  return (
    <tr className="border-t" style={{ borderColor: LINE, background: targetId ? "transparent" : "#FFF4E5" }}>
      <td className="px-3 py-1.5">
        <div>{r.name}</div>
        <div className="text-xs" style={{ color: SLATE }}>{r.code} · sheet "{r.sheet}"</div>
      </td>
      <td className="px-3 py-1.5">{r.unit}</td>
      <td className="px-3 py-1.5 text-right font-mono">{fmt(r.price)}</td>
      <td className="px-3 py-1.5">
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="border rounded px-2 py-1 text-xs w-full" style={{ borderColor: targetId ? LINE : AMBER }}>
          <option value="">— Tạo mới —</option>
          {existingList.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5 text-center">
        <div className="flex items-center gap-1 justify-center">
          <button
            onClick={() => applyPriceImportRow(r.key, targetId ? "update" : "create", targetId)}
            className="text-xs px-2 py-1 rounded text-white font-medium"
            style={{ background: targetId ? NAVY : GREEN }}
          >
            {targetId ? "Cập nhật" : "Tạo mới"}
          </button>
          <button onClick={() => skipPriceImportRow(r.key)} title="Bỏ qua dòng này, không áp dụng">
            <X size={14} color={RED} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function TakeoffImportRow({ r, projectNorms, applyTakeoffImportRow, skipTakeoffImportRow }) {
  const [normId, setNormId] = useState(r.matchedId || "");
  useEffect(() => { setNormId(r.matchedId || ""); }, [r.matchedId]);
  return (
    <tr className="border-t" style={{ borderColor: LINE, background: normId ? "transparent" : "#FFF4E5" }}>
      <td className="px-3 py-1.5">
        <div>{r.name}</div>
        <div className="text-xs" style={{ color: SLATE }}>{r.unit} · sheet "{r.sheet}"</div>
      </td>
      <td className="px-3 py-1.5 text-right font-mono">{r.qty}</td>
      <td className="px-3 py-1.5">
        <select value={normId} onChange={(e) => setNormId(e.target.value)} className="border rounded px-2 py-1 text-xs w-full" style={{ borderColor: normId ? LINE : AMBER }}>
          <option value="">— chưa khớp, chọn tay —</option>
          {projectNorms.map((n) => <option key={n.id} value={n.id}>{n.code} — {n.name}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5 text-center">
        <div className="flex items-center gap-1 justify-center">
          <button onClick={() => normId && applyTakeoffImportRow(r.key, normId)} disabled={!normId} className="text-xs px-2 py-1 rounded text-white font-medium disabled:opacity-40" style={{ background: NAVY }}>
            Thêm vào BOQ
          </button>
          <button onClick={() => skipTakeoffImportRow(r.key)} title="Bỏ qua dòng này">
            <X size={14} color={RED} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ============================================================================
// TAB: ĐIỀU CHỈNH DỰ TOÁN / KHỐI LƯỢNG
// (gộp 2 chức năng cũ: thêm/sửa dòng BOQ theo tay + cảnh báo rủi ro giá khoán,
// để chỉnh khối lượng và đơn giá khoán ngay tại đây sau khi xem trước/xuất file
// mà phát hiện cần sửa, không cần lật qua lại nhiều thẻ)
// ============================================================================
function AdjustTab({
  boqLines, projectNorms, addBoqItem, updateBoqItem, removeBoqItem, toggleBoqItemIncluded, activeProject, xoaToanBoBoqDuAn,
  handleTakeoffImportFile, takeoffImportResults, takeoffImportReport, applyTakeoffImportRow, applyAllTakeoffImport, cancelTakeoffImport, skipTakeoffImportRow, takeoffImportBatch, undoTakeoffImportBatch,
  changeLog, revisionSnapshots, luuSnapshotBoq, soSanhSnapshot, normsById,
}) {
  const [tenSnapshotMoi, setTenSnapshotMoi] = useState("");
  const [xemSoSanhId, setXemSoSanhId] = useState("");
  const [pickNormId, setPickNormId] = useState(projectNorms[0]?.id || "");
  const [tinhTuongBoqId, setTinhTuongBoqId] = useState(null); // id dòng BOQ đang mở công cụ "Tính diện tích tường"
  const [pickCategory, setPickCategory] = useState(STANDARD_CATEGORIES[0].id);
  const threshold = activeProject?.khoanThreshold ?? -0.05;
  const includedCount = boqLines.filter((l) => l.boq.included !== false).length;
  const [hienCotNghiemThu, setHienCotNghiemThu] = useState(false);
  const takeoffFileRef = useRef(null);

  useEffect(() => {
    if (!pickNormId && projectNorms.length) setPickNormId(projectNorms[0].id);
  }, [projectNorms, pickNormId]);

  return (
    <div>
      <SectionHeader icon={Layers} title="Điều chỉnh Dự toán / Khối lượng" desc={`Thêm/sửa khối lượng và đơn giá khoán cho dự án "${activeProject?.name}" — dùng khi kiểm tra lại thấy AI đọc bản vẽ thiếu/sai, hoặc cần thêm hạng mục thủ công. Dòng nào lệch quá ngưỡng cảnh báo (${fmtPct(threshold)}, chỉnh ở thẻ "Dự án") sẽ tô đỏ — rủi ro lỗ khi ký khoán.`} />

      {boqLines.length > 0 && (
        <div className="mb-4 p-3 rounded border flex items-center justify-between gap-3" style={{ borderColor: RED, background: "#FCEBEA" }}>
          <div className="text-xs" style={{ color: INK }}>
            Muốn đọc bản vẽ khác cho dự án này (khối lượng cũ không còn đúng nữa)? Xoá hết để làm lại từ đầu, không cần thoát app.
          </div>
          <button onClick={xoaToanBoBoqDuAn} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-white text-xs font-semibold" style={{ background: RED }}>
            <Trash2 size={13} /> Xoá toàn bộ khối lượng dự án này
          </button>
        </div>
      )}

      <div className="mb-4 p-3 rounded border" style={{ borderColor: hienCotNghiemThu ? GREEN : LINE, background: hienCotNghiemThu ? "#F0FBF4" : "#F6F8FA" }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold" style={{ color: hienCotNghiemThu ? GREEN : NAVY }}>📊 Đối chiếu khối lượng nghiệm thu thực tế</div>
            <p className="text-xs" style={{ color: SLATE }}>
              Sau khi công trình xây xong, nhập khối lượng nghiệm thu thật vào đây để biết dự toán ban đầu chính xác tới đâu — tích luỹ dần qua nhiều dự án, KHÔNG cần chờ dữ liệu công trình mẫu bên ngoài.
            </p>
          </div>
          <button onClick={() => setHienCotNghiemThu((v) => !v)} className="text-xs px-3 py-1.5 rounded font-semibold shrink-0" style={{ background: hienCotNghiemThu ? GREEN : NAVY, color: "white" }}>
            {hienCotNghiemThu ? "Đang hiện — Ẩn đi" : "Hiện cột nhập"}
          </button>
        </div>
      </div>

      <div className="mb-4 p-3 rounded border bg-white" style={{ borderColor: LINE }}>
        <div className="text-sm font-semibold mb-1" style={{ color: NAVY }}>Nhập khối lượng từ file dự toán mẫu (không cần AI đọc bản vẽ)</div>
        <p className="text-xs mb-3" style={{ color: SLATE }}>
          Có sẵn 1 file Excel bảng khối lượng/dự toán mẫu (từ dự án cũ, đối tác gửi, hoặc tự bóc tách thủ công)? Tải lên đây — app tự khớp mờ với định mức có sẵn rồi thêm thẳng vào BOQ. Dùng được bất cứ lúc nào, kể cả khi đã có BOQ rồi (nạp thêm khối lượng thiếu). File cần có cột "Tên hạng mục" và "Khối lượng".
        </p>
        <div
          className="border-2 border-dashed rounded-lg py-4 px-3 text-center"
          style={{ borderColor: LINE }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleTakeoffImportFile(e.dataTransfer.files[0]); }}
        >
          <FileSpreadsheet size={20} color={SLATE} className="mx-auto mb-1.5" />
          <input ref={takeoffFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleTakeoffImportFile(e.target.files[0])} />
          <button onClick={() => takeoffFileRef.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-white text-xs font-medium" style={{ background: NAVY }}>
            <Plus size={13} /> Chọn file (hoặc kéo-thả vào đây)
          </button>
        </div>

        {takeoffImportReport && (
          <div className="mt-3 p-3 rounded border text-xs" style={{ borderColor: LINE, background: PAPER }}>
            <div className="flex items-center justify-between mb-1">
              <div className="font-semibold" style={{ color: NAVY }}>Kết quả quét file "{takeoffImportReport.fileName}" ({takeoffImportReport.total} sheet):</div>
              {takeoffImportResults.length > 0 && (
                <button onClick={cancelTakeoffImport} className="text-xs px-2 py-1 rounded font-medium border shrink-0" style={{ borderColor: RED, color: RED }}>
                  <X size={11} className="inline mr-1" /> Huỷ, xoá kết quả này
                </button>
              )}
            </div>
            {takeoffImportReport.sheetReport.map((s) => (
              <div key={s.name} style={{ color: s.count > 0 ? GREEN : SLATE }}>• {s.name}: {s.status}</div>
            ))}
          </div>
        )}

        {takeoffImportBatch.length > 0 && (
          <div className="mt-3 p-3 rounded border flex items-center justify-between" style={{ borderColor: AMBER, background: "#FFF8ED" }}>
            <div className="text-xs" style={{ color: AMBER_DARK }}>Đã thêm {takeoffImportBatch.length} dòng từ file vừa nhập.</div>
            <button onClick={undoTakeoffImportBatch} className="text-xs px-3 py-1.5 rounded text-white font-medium shrink-0" style={{ background: RED }}>Hoàn tác {takeoffImportBatch.length} dòng vừa thêm</button>
          </div>
        )}

        {takeoffImportResults.length > 0 && (
          <div className="bg-white border-2 rounded overflow-hidden mt-3" style={{ borderColor: AMBER }}>
            <div className="flex items-center justify-between px-3 py-2.5 border-b" style={{ borderColor: LINE, background: "#FFF8ED" }}>
              <div className="text-sm font-semibold" style={{ color: AMBER_DARK }}>{takeoffImportResults.length} dòng khối lượng đọc được</div>
              <button onClick={applyAllTakeoffImport} className="px-3 py-1.5 rounded text-white text-xs font-medium" style={{ background: GREEN }}>Thêm tất cả (dòng đã khớp)</button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: PAPER }}>
                  <th className="text-left px-3 py-2" style={{ color: SLATE }}>Tên (trong file)</th>
                  <th className="text-right px-3 py-2 w-20" style={{ color: SLATE }}>KL</th>
                  <th className="text-left px-3 py-2 w-56" style={{ color: SLATE }}>Khớp định mức</th>
                  <th className="w-32"></th>
                </tr>
              </thead>
              <tbody>
                {takeoffImportResults.map((r) => (
                  <TakeoffImportRow key={r.key} r={r} projectNorms={projectNorms} applyTakeoffImportRow={applyTakeoffImportRow} skipTakeoffImportRow={skipTakeoffImportRow} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4 p-3 rounded border bg-white" style={{ borderColor: LINE }}>
        <div className="flex-1" style={{ minWidth: 240 }}>
          <div className="text-xs mb-1" style={{ color: SLATE }}>Hoặc chọn định mức để thêm 1 dòng vào BOQ</div>
          <select value={pickNormId} onChange={(e) => setPickNormId(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-full" style={{ borderColor: LINE }}>
            {projectNorms.map((n) => <option key={n.id} value={n.id}>{n.code} — {n.name} ({n.unit})</option>)}
          </select>
        </div>
        <div style={{ minWidth: 200 }}>
          <div className="text-xs mb-1" style={{ color: SLATE }}>Thuộc hạng mục</div>
          <select value={pickCategory} onChange={(e) => setPickCategory(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-full" style={{ borderColor: LINE }}>
            {STANDARD_CATEGORIES.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
        </div>
        <button onClick={() => pickNormId && addBoqItem(pickNormId, pickCategory)} disabled={!pickNormId} className="px-4 py-2 rounded text-white text-sm font-medium disabled:opacity-40" style={{ background: GREEN }}>
          <Plus size={14} className="inline mr-1" /> Thêm vào BOQ
        </button>
      </div>

      {boqLines.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-xs" style={{ color: SLATE }}>
          <div>
            Đang tính <strong style={{ color: NAVY }}>{includedCount}/{boqLines.length}</strong> dòng vào tổng &amp; file xuất — bỏ tick dòng nào thì dòng đó vẫn giữ nguyên số liệu, chỉ tạm loại khỏi báo giá (VD: chỉ báo giá riêng gói Điện + Nước).
          </div>
          <div className="flex gap-2">
            <button onClick={() => boqLines.forEach(({ boq }) => boq.included === false && toggleBoqItemIncluded(boq.id))} className="px-2.5 py-1 rounded border text-xs" style={{ borderColor: LINE, color: NAVY }}>☑ Chọn tất cả</button>
            <button onClick={() => boqLines.forEach(({ boq }) => boq.included !== false && toggleBoqItemIncluded(boq.id))} className="px-2.5 py-1 rounded border text-xs" style={{ borderColor: LINE, color: SLATE }}>☐ Bỏ chọn tất cả</button>
          </div>
        </div>
      )}

      {boqLines.length === 0 ? (
        <EmptyState text="Chưa có dòng BOQ nào. Chọn định mức ở trên rồi bấm 'Thêm vào BOQ' — hoặc quay lại thẻ 'Đọc bản vẽ' để AI tự đọc khối lượng." />
      ) : (
        STANDARD_CATEGORIES.map((cat) => {
          const linesInCat = boqLines.filter((l) => (l.boq.category || STANDARD_CATEGORIES[0].id) === cat.id);
          if (linesInCat.length === 0) return null;
          const catTotal = linesInCat.reduce((s, l) => s + (l.boq.included !== false ? l.calc.thanhTienKhoan : 0), 0);
          return (
            <div key={cat.id} className="mb-6">
              <div className="px-3 py-2 flex items-center justify-between font-bold text-sm text-white rounded-t" style={{ background: NAVY }}>
                <span>{cat.name}</span>
                <span className="font-mono font-normal text-xs">{linesInCat.length} dòng · {fmt(catTotal)} đ</span>
              </div>
              <div className="bg-white border border-t-0 rounded-b overflow-x-auto" style={{ borderColor: LINE }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: PAPER }}>
                      <th className="w-8"></th>
                      <th className="text-left px-3 py-2" style={{ color: SLATE }}>Hạng mục</th>
                      <th className="text-left px-3 py-2 w-16" style={{ color: SLATE }}>ĐVT</th>
                      <th className="text-right px-3 py-2 w-28" style={{ color: SLATE }}>Khối lượng</th>
                      {hienCotNghiemThu && <th className="text-right px-3 py-2 w-32" style={{ color: GREEN }}>KL nghiệm thu thực tế</th>}
                      {hienCotNghiemThu && <th className="text-right px-3 py-2 w-20" style={{ color: GREEN }}>Sai số</th>}
                      <th className="text-right px-3 py-2 w-32" style={{ color: SLATE }}>ĐG phân tích</th>
                      <th className="text-right px-3 py-2 w-32" style={{ color: SLATE }}>ĐG khoán đề xuất</th>
                      <th className="text-right px-3 py-2 w-24" style={{ color: SLATE }}>Chênh lệch</th>
                      <th className="text-center px-3 py-2 w-28" style={{ color: SLATE }}>Đánh giá</th>
                      <th className="text-right px-3 py-2 w-36" style={{ color: SLATE }}>Thành tiền (khoán)</th>
                      <th className="text-left px-3 py-2 w-40" style={{ color: SLATE }}>Đổi hạng mục</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {linesInCat.map(({ boq, norm, calc }) => {
                      const risky = calc.chenhLechPct < threshold;
                      const included = boq.included !== false;
                      return (
                        <tr key={boq.id} className="border-t" style={{ borderColor: LINE, background: !included ? PAPER : risky ? "#FCEBEA" : "transparent", opacity: included ? 1 : 0.5 }}>
                          <td className="px-2 py-1.5 text-center">
                            <input type="checkbox" checked={included} onChange={() => toggleBoqItemIncluded(boq.id)} title="Tính vào tổng & file xuất" style={{ width: 15, height: 15 }} />
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-1.5">
                              {norm.name}
                              {boq.trangThai === "confirmed" && (
                                <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{ background: "#F0FBF4", color: GREEN }} title="AI đọc khớp đúng định mức có sẵn trong mẫu (đã có giá thật)">🟢 Confirmed</span>
                              )}
                              {boq.trangThai === "review" && (
                                <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{ background: "#FFF4E5", color: AMBER_DARK }} title="AI đọc nhưng không khớp mẫu sẵn có — định mức mới tự tạo, cần chú kiểm tra lại tên/khối lượng/giá">🟡 Review</span>
                              )}
                            </div>
                            <div className="text-xs" style={{ color: SLATE }}>{norm.code} · {norm.standard}</div>
                            {boq.sourcePhoto && (
                              <div className="text-xs mt-0.5" style={{ color: NAVY }} title="Nguồn AI đọc ra dòng này">📷 {boq.sourcePhoto}{boq.model && ` · ${boq.model}`}</div>
                            )}
                            {boq.ghiChu && norm.name.includes("CẢNH BÁO ĐỐI CHIẾU") ? (
                              <div className="text-xs mt-1 p-1.5 rounded font-semibold" style={{ background: "#FCEBEA", color: RED }}>⚠ AI TỰ PHÁT HIỆN LỆCH SỐ LIỆU: {boq.ghiChu}</div>
                            ) : boq.ghiChu ? (
                              <div className="text-xs mt-0.5 italic" style={{ color: SLATE }} title="Công thức/căn cứ khi AI đọc">💡 {boq.ghiChu}</div>
                            ) : null}
                          </td>
                          <td className="px-3 py-1.5">{norm.unit}</td>
                          <td className="px-3 py-1.5">
                            {/* THEO YÊU CẦU: bỏ dropdown "Cơ sở tính khối lượng" (m² GFA/Phòng/
                                WC/Tầng) — phụ thuộc "Thông số công trình" đã xoá, không còn ý
                                nghĩa khi khối lượng lấy trực tiếp từ AI đọc bản vẽ. Luôn hiện ô
                                nhập tay trực tiếp. */}
                            {(!boq.basis || boq.basis === "manual") ? (
                              <div className="flex items-center gap-1">
                                <input type="number" value={boq.qty} onChange={(e) => { const v = parseFloat(e.target.value); updateBoqItem(boq.id, "qty", (Number.isFinite(v) && v >= 0) ? v : 0); }} className="num-input w-full text-right outline-none bg-transparent font-mono" />
                                {norm.unit === "m2" && (
                                  <button onClick={() => setTinhTuongBoqId(boq.id)} title="Tính diện tích tường theo kích thước (dài × cao − cửa/cửa sổ)" className="shrink-0 px-1.5 py-0.5 rounded text-xs border" style={{ borderColor: NAVY, color: NAVY }}>
                                    📐
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <input type="number" step="0.01" value={boq.ratio ?? ""} placeholder="hệ số" onChange={(e) => updateBoqItem(boq.id, "ratio", e.target.value === "" ? 0 : parseFloat(e.target.value))} className="num-input w-14 text-right outline-none bg-transparent font-mono text-xs border rounded px-1" style={{ borderColor: LINE }} title="Hệ số nhân với cơ sở tính" />
                                <span className="text-xs" style={{ color: SLATE }}>=</span>
                                <span className="font-mono text-sm font-semibold" style={{ color: NAVY }} title="Khối lượng tự tính">{boq.qty}</span>
                              </div>
                            )}
                          </td>
                          {hienCotNghiemThu && (
                            <td className="px-3 py-1.5">
                              <input
                                type="number" value={boq.qtyNghiemThu ?? ""} placeholder="chưa nhập"
                                onChange={(e) => { const v = e.target.value === "" ? null : parseFloat(e.target.value); updateBoqItem(boq.id, "qtyNghiemThu", (v === null || (Number.isFinite(v) && v >= 0)) ? v : boq.qtyNghiemThu); }}
                                className="num-input w-full text-right outline-none bg-transparent font-mono border rounded px-1" style={{ borderColor: LINE }}
                              />
                            </td>
                          )}
                          {hienCotNghiemThu && (
                            <td className="px-3 py-1.5 text-right font-mono text-xs">
                              {boq.qtyNghiemThu != null && boq.qtyNghiemThu > 0 ? (() => {
                                const saiSo = Math.abs(boq.qty - boq.qtyNghiemThu) / boq.qtyNghiemThu * 100;
                                return <span style={{ color: saiSo > 10 ? RED : saiSo > 2 ? AMBER_DARK : GREEN }}>{saiSo.toFixed(1)}%</span>;
                              })() : <span style={{ color: SLATE }}>-</span>}
                            </td>
                          )}
                          <td className="px-3 py-1.5">
                            <input
                              type="number"
                              value={boq.khoanPrice != null ? boq.khoanPrice : ""}
                              placeholder={fmt(calc.analyzed.total)}
                              onChange={(e) => updateBoqItem(boq.id, "khoanPrice", e.target.value === "" ? null : parseFloat(e.target.value))}
                              className="num-input w-full text-right outline-none bg-transparent font-mono"
                              style={{ color: AMBER_DARK }}
                            />
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold" style={{ color: calc.chenhLechPct < 0 ? RED : GREEN }}>
                            {calc.chenhLechPct >= 0 ? "+" : ""}{fmtPct(calc.chenhLechPct)}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            {risky ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded" style={{ background: RED, color: "white" }}>
                                <TrendingDown size={12} /> Rủi ro lỗ
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded" style={{ background: GREEN, color: "white" }}>
                                <TrendingUp size={12} /> An toàn
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold">{fmt(calc.thanhTienKhoan)}</td>
                          <td className="px-2 py-1.5">
                            <select value={boq.category || STANDARD_CATEGORIES[0].id} onChange={(e) => updateBoqItem(boq.id, "category", e.target.value)} className="border rounded px-1.5 py-1 text-xs w-full" style={{ borderColor: LINE }}>
                              {STANDARD_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5 text-center"><button onClick={() => removeBoqItem(boq.id)}><Trash2 size={14} color={RED} /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}

      {changeLog && changeLog.some((l) => l.what.includes("khối lượng") || l.what.includes("giá khoán") || l.what.includes("XOÁ dòng BOQ")) && (
        <div className="mt-6">
          <div className="text-sm font-semibold mb-2" style={{ color: NAVY }}>Lịch sử sửa/xoá khối lượng &amp; giá (gần đây nhất)</div>
          <div className="bg-white border rounded overflow-hidden" style={{ borderColor: LINE }}>
            {changeLog.filter((l) => l.what.includes("khối lượng") || l.what.includes("giá khoán") || l.what.includes("XOÁ dòng BOQ")).slice(0, 15).map((l) => (
              <div key={l.id} className="px-3 py-2 text-xs border-b" style={{ borderColor: LINE }}>
                <span style={{ color: SLATE }}>{l.when}</span> — <strong>{l.who}</strong>: {l.what}
              </div>
            ))}
          </div>
        </div>
      )}

      {luuSnapshotBoq && (
        <div className="mt-6 p-3 rounded border" style={{ borderColor: LINE, background: "#F6F8FA" }}>
          <div className="text-sm font-semibold mb-1" style={{ color: NAVY }}>Chốt phiên bản (Revision) để so sánh sau này</div>
          <p className="text-xs mb-2" style={{ color: SLATE }}>Lưu 1 mốc BOQ hiện tại (VD "Trước khi gửi thầu lần 1") — sau này sửa tiếp, có thể xem lại đã đổi những gì so với mốc đó.</p>
          <div className="flex flex-wrap gap-2 mb-3">
            <input value={tenSnapshotMoi} onChange={(e) => setTenSnapshotMoi(e.target.value)} placeholder="Tên phiên bản (vd: Gửi thầu lần 1)" className="border rounded px-2 py-1.5 text-sm flex-1" style={{ borderColor: LINE, minWidth: 160 }} />
            <button onClick={() => { luuSnapshotBoq(tenSnapshotMoi); setTenSnapshotMoi(""); }} className="px-3 py-1.5 rounded text-white text-xs font-medium" style={{ background: NAVY }}>📌 Lưu phiên bản</button>
          </div>
          {revisionSnapshots && revisionSnapshots.filter((s) => s.projectId === activeProject?.id).length > 0 && (
            <>
              <div className="flex flex-wrap gap-2 mb-2">
                <select value={xemSoSanhId} onChange={(e) => setXemSoSanhId(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: LINE }}>
                  <option value="">— chọn phiên bản để so sánh với hiện tại —</option>
                  {revisionSnapshots.filter((s) => s.projectId === activeProject?.id).map((s) => <option key={s.id} value={s.id}>{s.ten} ({s.when})</option>)}
                </select>
              </div>
              {xemSoSanhId && (() => {
                const kq = soSanhSnapshot(xemSoSanhId);
                if (!kq) return null;
                return (
                  <div className="text-xs space-y-2">
                    {kq.them.length > 0 && <div className="p-2 rounded" style={{ background: "#F0FBF4", color: GREEN }}>+ Thêm mới ({kq.them.length}): {kq.them.map((x) => normsById?.[x.normId]?.name || x.normId).join(", ")}</div>}
                    {kq.bot.length > 0 && <div className="p-2 rounded" style={{ background: "#FCEBEA", color: RED }}>− Đã bỏ ({kq.bot.length}): {kq.bot.map((x) => normsById?.[x.normId]?.name || x.normId).join(", ")}</div>}
                    {kq.doi.length > 0 && (
                      <div className="p-2 rounded" style={{ background: "#FFF8ED", color: AMBER_DARK }}>
                        ~ Thay đổi ({kq.doi.length}):
                        {kq.doi.map((x, i) => <div key={i}>• {normsById?.[x.normId]?.name || x.normId}: KL {x.quaKhu.qty}→{x.hienTai.qty}{x.quaKhu.khoanPrice !== x.hienTai.khoanPrice ? `, giá ${x.quaKhu.khoanPrice ?? "-"}→${x.hienTai.khoanPrice ?? "-"}` : ""}</div>)}
                      </div>
                    )}
                    {!kq.them.length && !kq.bot.length && !kq.doi.length && <div style={{ color: SLATE }}>Không có thay đổi nào so với phiên bản "{kq.tenSnap}".</div>}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {tinhTuongBoqId && (
        <TinhTuongModal
          boq={boqLines.find((l) => l.boq.id === tinhTuongBoqId)?.boq}
          onDong={() => setTinhTuongBoqId(null)}
          onApDung={(qty) => { updateBoqItem(tinhTuongBoqId, "qty", qty); setTinhTuongBoqId(null); }}
        />
      )}
    </div>
  );
}

// Công cụ tính diện tích tường theo kích thước (dài × cao − cửa/cửa sổ), đối
// chiếu với khối lượng AI đã đọc trước đó (nếu có) — dùng đúng công thức đã kiểm
// chứng port từ thư viện AutoEngine (wallNetArea + doiChieuAiVaCongThuc).
// ============================================================================
// ĐO TRÊN ẢNH — giải pháp TẠM THỜI cho mục 3 (Scale Calibration) trong lúc hạ
// tầng AI chưa trả được toạ độ tự động. QS tự bấm 2 điểm ở 1 đoạn ĐÃ BIẾT chính
// xác khoảng cách thật (VD chiều rộng cửa 0.9m, hoặc theo kích thước ghi sẵn
// trên bản vẽ) để "hiệu chỉnh tỷ lệ", sau đó bấm 2 điểm bất kỳ khác để đo ra
// khoảng cách thật — không cần AI đọc toạ độ pixel, không cần dịch vụ OCR
// ngoài. Nâng cấp sau: khi có dịch vụ OCR/toạ độ thật, có thể tự động hoá bước
// hiệu chỉnh này.
// ============================================================================
// Hiển thị đúng vùng trên bản vẽ mà AI dùng làm bằng chứng — khung đỏ nổi bật,
// làm tối phần còn lại. evidenceRegion đã chuẩn hoá 0-1 (x,y = góc trên-trái,
// w,h = kích thước) từ backend (chuanHoaEvidenceRegion), an toàn để dùng trực
// tiếp % CSS mà không cần validate lại ở đây.
function EvidenceViewerModal({ anhGoc, evidenceRegion, tenHangMuc, onDong }) {
  if (!anhGoc || !evidenceRegion) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }} onClick={onDong}>
      <div className="bg-white rounded-lg p-3 max-w-2xl w-full max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold" style={{ color: NAVY }}>📍 Vị trí bằng chứng — {tenHangMuc}</div>
          <button onClick={onDong} className="text-xs px-2 py-1 rounded" style={{ background: LINE }}>✕ Đóng</button>
        </div>
        <p className="text-xs mb-2" style={{ color: SLATE }}>
          Khung đỏ là vùng AI ƯỚC LƯỢNG (không phải toạ độ đo chính xác) chứa số liệu dùng để tính dòng này — dùng để tìm nhanh vị trí trên bản vẽ, không dùng để đo đạc.
        </p>
        <div style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
          <img src={anhGoc.dataUrl} style={{ maxWidth: "100%", display: "block" }} alt={tenHangMuc} />
          <div
            style={{
              position: "absolute",
              left: `${evidenceRegion.x * 100}%`, top: `${evidenceRegion.y * 100}%`,
              width: `${evidenceRegion.w * 100}%`, height: `${evidenceRegion.h * 100}%`,
              border: `3px solid ${RED}`, boxSizing: "border-box",
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)", // làm tối toàn bộ phần NGOÀI khung đỏ để mắt tập trung đúng vùng
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function DoTrenAnhModal({ photo, onDong, onApDung }) {
  const [diem, setDiem] = useState([]); // tối đa 2 điểm cho bước hiện tại
  const [buoc, setBuoc] = useState("hieu_chinh"); // "hieu_chinh" | "do"
  const [khoangCachThat, setKhoangCachThat] = useState("");
  const [tySo, setTySo] = useState(null); // mét / pixel (trên ảnh đang hiển thị)
  const [ketQuaDo, setKetQuaDo] = useState(null);
  const imgRef = useRef(null);

  const khoangCachPixel = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  const xuLyClick = (e) => {
    const rect = imgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    setDiem((prev) => (prev.length >= 2 ? [{ x, y }] : [...prev, { x, y }]));
  };

  const xacNhanHieuChinh = () => {
    const kc = Number(khoangCachThat);
    if (diem.length !== 2 || !kc || kc <= 0) return;
    const px = khoangCachPixel(diem[0], diem[1]);
    if (px < 5) { return; } // 2 điểm quá gần nhau, không đáng tin
    setTySo(kc / px);
    setBuoc("do");
    setDiem([]);
  };

  const ketQuaMet = (buoc === "do" && diem.length === 2 && tySo) ? khoangCachPixel(diem[0], diem[1]) * tySo : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-lg p-4 max-w-2xl w-full max-h-[90vh] overflow-y-auto" style={{ border: `1px solid ${LINE}` }}>
        <div className="text-sm font-semibold mb-2" style={{ color: NAVY }}>📏 Đo trên ảnh (tạm thời — QS tự hiệu chỉnh tỷ lệ)</div>

        {buoc === "hieu_chinh" ? (
          <div className="text-xs mb-2 p-2 rounded" style={{ background: "#EEF3F8", color: NAVY }}>
            <strong>Bước 1/2 — Hiệu chỉnh tỷ lệ:</strong> bấm 2 điểm ở 2 đầu của 1 đoạn bạn ĐÃ BIẾT chính xác khoảng cách
            thật (VD: 2 mép cửa nếu biết cửa rộng 0.9m, hoặc theo kích thước ghi sẵn trên bản vẽ). Đã bấm: {diem.length}/2 điểm.
          </div>
        ) : (
          <div className="text-xs mb-2 p-2 rounded" style={{ background: "#F0FBF4", color: GREEN }}>
            <strong>Bước 2/2 — Đo:</strong> tỷ lệ đã hiệu chỉnh xong (1 pixel ≈ {(tySo * 100).toFixed(3)} cm). Giờ bấm 2 điểm bất kỳ cần đo. Đã bấm: {diem.length}/2 điểm.
            <button onClick={() => { setBuoc("hieu_chinh"); setDiem([]); setTySo(null); setKhoangCachThat(""); }} className="ml-2 underline">Hiệu chỉnh lại</button>
          </div>
        )}

        <div className="relative border rounded overflow-hidden mb-3" style={{ borderColor: LINE }}>
          <img ref={imgRef} src={photo.dataUrl} onClick={xuLyClick} alt={photo.name} className="w-full cursor-crosshair select-none" style={{ maxHeight: "55vh", objectFit: "contain" }} />
          {diem.map((d, i) => (
            <div key={i} className="absolute w-3 h-3 rounded-full border-2 border-white -translate-x-1/2 -translate-y-1/2" style={{ left: d.x, top: d.y, background: buoc === "hieu_chinh" ? NAVY : GREEN }} />
          ))}
          {diem.length === 2 && (
            <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
              <line x1={diem[0].x} y1={diem[0].y} x2={diem[1].x} y2={diem[1].y} stroke={buoc === "hieu_chinh" ? NAVY : GREEN} strokeWidth="2" strokeDasharray="4 3" />
            </svg>
          )}
        </div>

        {buoc === "hieu_chinh" && diem.length === 2 && (
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs" style={{ color: SLATE }}>Khoảng cách thật giữa 2 điểm vừa bấm (mét):</label>
            <input type="number" value={khoangCachThat} onChange={(e) => setKhoangCachThat(e.target.value)} placeholder="VD: 0.9" className="border rounded px-2 py-1 text-sm w-24" style={{ borderColor: LINE }} />
            <button onClick={xacNhanHieuChinh} className="px-3 py-1.5 rounded text-white text-xs font-medium" style={{ background: NAVY }}>Xác nhận hiệu chỉnh</button>
          </div>
        )}

        {ketQuaMet !== null && (
          <div className="p-2 rounded mb-3 text-sm" style={{ background: "#F0FBF4", color: GREEN }}>
            Khoảng cách đo được ≈ <strong>{ketQuaMet.toFixed(2)} m</strong>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onDong} className="flex-1 px-3 py-1.5 rounded text-sm border" style={{ borderColor: LINE }}>Đóng</button>
          <button onClick={() => ketQuaMet !== null && onApDung(+ketQuaMet.toFixed(2))} disabled={ketQuaMet === null} className="flex-1 px-3 py-1.5 rounded text-sm text-white disabled:opacity-40" style={{ background: GREEN }}>Dùng số này</button>
        </div>
        <p className="text-xs mt-2" style={{ color: SLATE }}>Độ chính xác phụ thuộc vào ảnh chụp thẳng góc, không méo/nghiêng. Chỉ dùng khi bản vẽ không ghi sẵn kích thước — ưu tiên đọc số ghi trên bản vẽ nếu có.</p>
      </div>
    </div>
  );
}

function TinhTuongModal({ boq, onDong, onApDung }) {
  const [dai, setDai] = useState("");
  const [cao, setCao] = useState("");
  const [cuaSo, setCuaSo] = useState([{ width: "", height: "", count: 1 }]);
  if (!boq) return null;
  const diToanSo = (v) => Number(v) || 0;
  const openings = cuaSo.map((c) => ({ width: diToanSo(c.width), height: diToanSo(c.height), count: diToanSo(c.count) || 1 }));
  const ketQua = (dai !== "" && cao !== "") ? wallNetArea(diToanSo(dai), diToanSo(cao), openings) : null;
  const doiChieu = ketQua !== null && boq.qty ? doiChieuAiVaCongThuc(boq.qty, ketQua) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="bg-white rounded-lg p-4 max-w-sm w-full" style={{ border: `1px solid ${LINE}` }}>
        <div className="text-sm font-semibold mb-3" style={{ color: NAVY }}>📐 Tính diện tích tường theo kích thước</div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label className="text-xs" style={{ color: SLATE }}>Chiều dài (m)</label>
            <input type="number" value={dai} onChange={(e) => setDai(e.target.value)} className="w-full border rounded px-2 py-1 text-sm" style={{ borderColor: LINE }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: SLATE }}>Chiều cao (m)</label>
            <input type="number" value={cao} onChange={(e) => setCao(e.target.value)} className="w-full border rounded px-2 py-1 text-sm" style={{ borderColor: LINE }} />
          </div>
        </div>
        <div className="text-xs mb-1" style={{ color: SLATE }}>Cửa/cửa sổ trừ ra (nếu có):</div>
        {cuaSo.map((c, i) => (
          <div key={i} className="grid grid-cols-4 gap-1 mb-1">
            <input type="number" placeholder="Rộng" value={c.width} onChange={(e) => setCuaSo((prev) => prev.map((x, j) => j === i ? { ...x, width: e.target.value } : x))} className="border rounded px-1 py-1 text-xs" style={{ borderColor: LINE }} />
            <input type="number" placeholder="Cao" value={c.height} onChange={(e) => setCuaSo((prev) => prev.map((x, j) => j === i ? { ...x, height: e.target.value } : x))} className="border rounded px-1 py-1 text-xs" style={{ borderColor: LINE }} />
            <input type="number" placeholder="SL" value={c.count} onChange={(e) => setCuaSo((prev) => prev.map((x, j) => j === i ? { ...x, count: e.target.value } : x))} className="border rounded px-1 py-1 text-xs" style={{ borderColor: LINE }} />
            <button onClick={() => setCuaSo((prev) => prev.filter((_, j) => j !== i))} className="text-xs" style={{ color: RED }}>Bỏ</button>
          </div>
        ))}
        <button onClick={() => setCuaSo((prev) => [...prev, { width: "", height: "", count: 1 }])} className="text-xs mb-3" style={{ color: NAVY }}>+ Thêm cửa/cửa sổ</button>

        {ketQua !== null && (
          <div className="p-2 rounded mb-3 text-sm" style={{ background: "#F0FBF4", color: GREEN }}>
            Diện tích thực (đã trừ cửa) = <strong>{ketQua.toFixed(2)} m²</strong>
          </div>
        )}
        {doiChieu && (
          <div className="p-2 rounded mb-3 text-xs" style={{ background: doiChieu.mucDo === "cao" ? "#FCEBEA" : "#FFF4E5", color: doiChieu.mucDo === "cao" ? RED : AMBER_DARK }}>
            ⚠ {doiChieu.thongBao}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onDong} className="flex-1 px-3 py-1.5 rounded text-sm border" style={{ borderColor: LINE }}>Huỷ</button>
          <button onClick={() => ketQua !== null && onApDung(+ketQua.toFixed(2))} disabled={ketQua === null} className="flex-1 px-3 py-1.5 rounded text-sm text-white disabled:opacity-40" style={{ background: NAVY }}>Dùng số này</button>
        </div>
      </div>
    </div>
  );
}


// ============================================================================
// TAB 6: DASHBOARD
// ============================================================================
function DashboardTab({ totals, hasData }) {
  const pieData = [
    { name: "Vật tư", value: totals.VL },
    { name: "Nhân công", value: totals.NC },
    { name: "Máy thi công", value: totals.May },
    { name: "Quản lý", value: totals.quanLy },
    { name: "Khác", value: totals.khac },
    { name: "Lợi nhuận", value: totals.loiNhuan },
  ].filter((d) => d.value > 0);

  return (
    <div>
      <SectionHeader icon={BarChart3} title="Phân tích Hiệu quả Giá vốn" desc="Cơ cấu chi phí và tỷ suất lợi nhuận của dự án đang chọn." />
      {!hasData ? (
        <EmptyState text="Chưa có dữ liệu BOQ để phân tích — thêm dòng BOQ với khối lượng > 0 trước." />
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-4 mb-6">
            <KpiCard label="Giá vốn trực tiếp (VL+NC+Máy)" value={fmt(totals.truc_tiep)} color={NAVY} />
            <KpiCard label="Giá thành" value={fmt(totals.giaThanh)} color={SLATE} />
            <KpiCard label="Giá bán dự thầu (trước VAT)" value={fmt(totals.giaBanTruocVAT)} color={AMBER_DARK} />
          </div>
          <div className="bg-white border rounded p-4" style={{ borderColor: LINE }}>
            <div className="text-sm font-semibold mb-3" style={{ color: NAVY }}>Cơ cấu chi phí</div>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={(d) => `${d.name} ${((d.value / totals.giaBanTruocVAT) * 100).toFixed(0)}%`}>
                  {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => fmt(v) + " đ"} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, color }) {
  return (
    <div className="bg-white border rounded p-4" style={{ borderColor: LINE, borderLeft: `4px solid ${color}` }}>
      <div className="text-xs" style={{ color: SLATE }}>{label}</div>
      <div className="font-mono text-lg font-bold mt-1">{value} đ</div>
    </div>
  );
}

// ============================================================================
// TAB 7: XUẤT EXCEL
// ============================================================================
// ============================================================================
// TAB: XEM TRƯỚC BOQ (màn hình tổng hợp trước khi xuất — BOQ tự tính ngay khi
// nhập khối lượng/đơn giá, không cần bấm nút "tính toán" riêng; thẻ này chỉ để
// xem gọn toàn bộ kết quả trước khi xuất file, giống luồng bản cũ)
// ============================================================================
function PreviewRow({ label, value, bold, accent, big }) {
  return (
    <div className="flex justify-between py-1" style={{ borderTop: bold ? `1px solid ${LINE}` : "none" }}>
      <span style={{ fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span className="font-mono" style={{ fontWeight: bold ? 700 : 400, fontSize: big ? 16 : 14, color: accent ? AMBER_DARK : INK }}>
        {fmt(value)} đ
      </span>
    </div>
  );
}

// Bảng BOQ dạng "chứng từ in được" — dùng chung cho mục Xem trước & mục Xuất PDF
function PrintableBoqDocument({ boqLines, totals, activeProject }) {
  return (
    <div className="print-area bg-white border rounded p-6" style={{ borderColor: LINE }}>
      <div className="text-center mb-5 pb-4 border-b-2" style={{ borderColor: NAVY }}>
        <div className="text-xs tracking-widest" style={{ color: SLATE }}>BẢNG KHỐI LƯỢNG DỰ TOÁN (BOQ)</div>
        <div className="text-xl font-bold mt-1" style={{ color: NAVY }}>{activeProject?.name}</div>
        <div className="text-sm" style={{ color: SLATE }}>Nhóm: {PROJECT_GROUPS.find((g) => g.id === activeProject?.groupId)?.name}</div>
      </div>

      <table className="w-full text-sm mb-6">
        <thead>
          <tr style={{ background: NAVY, color: "white" }}>
            <th className="text-left px-2 py-2 w-8">STT</th>
            <th className="text-left px-2 py-2">Hạng mục</th>
            <th className="text-left px-2 py-2">ĐVT</th>
            <th className="text-right px-2 py-2">KL</th>
            <th className="text-right px-2 py-2">ĐG phân tích</th>
            <th className="text-right px-2 py-2">ĐG khoán</th>
            <th className="text-right px-2 py-2">Thành tiền</th>
            <th className="text-left px-2 py-2">Tiêu chuẩn</th>
          </tr>
        </thead>
        <tbody>
          {STANDARD_CATEGORIES.map((cat) => {
            const linesInCat = boqLines.filter((l) => (l.boq.category || STANDARD_CATEGORIES[0].id) === cat.id);
            if (linesInCat.length === 0) return null;
            const catTotal = linesInCat.reduce((s, l) => s + l.calc.thanhTienKhoan, 0);
            return (
              <Fragment key={cat.id}>
                <tr style={{ background: PAPER }}>
                  <td colSpan={7} className="px-2 py-1.5 font-bold" style={{ color: NAVY }}>{cat.name}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold" style={{ color: NAVY }}>{fmt(catTotal)}</td>
                </tr>
                {linesInCat.map(({ boq, norm, calc }, i) => (
                  <tr key={boq.id} style={{ background: i % 2 ? PAPER : "white" }}>
                    <td className="px-2 py-1.5 text-xs" style={{ color: SLATE }}>{i + 1}</td>
                    <td className="px-2 py-1.5">{norm.name}</td>
                    <td className="px-2 py-1.5">{norm.unit}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{boq.qty.toLocaleString("vi-VN")}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmt(calc.analyzed.total)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmt(calc.donGiaKhoan)}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold">{fmt(calc.thanhTienKhoan)}</td>
                    <td className="px-2 py-1.5 text-xs" style={{ color: SLATE }}>{norm.standard}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <div className="max-w-sm ml-auto text-sm">
        <PreviewRow label="Giá vốn vật tư" value={totals.VL} />
        <PreviewRow label="Giá vốn nhân công" value={totals.NC} />
        <PreviewRow label="Giá vốn máy thi công" value={totals.May} />
        <PreviewRow label="Chi phí quản lý" value={totals.quanLy} />
        <PreviewRow label="Chi phí khác" value={totals.khac} />
        <PreviewRow label="Giá thành" value={totals.giaThanh} bold />
        <PreviewRow label="Lợi nhuận" value={totals.loiNhuan} />
        <PreviewRow label="Giá bán dự thầu (trước VAT)" value={totals.giaBanTruocVAT} bold accent />
        <PreviewRow label="VAT" value={totals.vat} />
        <PreviewRow label="GIÁ BÁN DỰ THẦU (sau VAT)" value={totals.giaBanSauVAT} bold accent big />
      </div>

      <div className="mt-6 text-xs" style={{ color: SLATE }}>
        Ngày xem: {new Date().toLocaleDateString("vi-VN")} — Đơn giá tham khảo, cần đối chiếu báo giá nhà cung cấp trước khi ký hợp đồng.
      </div>
    </div>
  );
}

// ============================================================================
// TAB: XUẤT FILE (gộp 3 chức năng cũ — Xem trước BOQ / Xuất PDF / Xuất Excel —
// vào 1 thẻ, chuyển qua lại bằng 3 nút gạt bên trong cho gọn giao diện)
// ============================================================================
function ExportHubTab({ boqLines, totals, hasData, activeProject, exportExcel, exportInternalExcel, exportPdfThat, lastExport, setActiveTab, projectBoqTho, normsById }) {
  const [view, setView] = useState("preview"); // "preview" | "pdf" | "excel"
  const printNow = () => window.print();

  // Chẩn đoán khi BOQ trống dù đã có dòng "duyệt" — so sánh số dòng THÔ (đã lưu
  // trong dự án) với số dòng THỰC SỰ hiển thị được (đã tính giá) để tìm chính xác
  // dòng nào bị rớt và vì sao, thay vì chỉ hiện màn hình trống không rõ lý do.
  const soThoTrongDuAn = (projectBoqTho || []).length;
  const soHienThi = boqLines.length;
  const bangChanDoan = (soThoTrongDuAn > 0 && soHienThi < soThoTrongDuAn) ? (projectBoqTho || [])
    .filter((b) => b.included !== false)
    .map((b) => ({ id: b.id, normId: b.normId, normTonTai: !!(normsById || {})[b.normId] }))
    .filter((x) => !x.normTonTai) : [];

  const SEGMENTS = [
    { id: "preview", label: "Xem trước BOQ", icon: Eye },
    { id: "pdf", label: "Xuất PDF", icon: FileText },
    { id: "excel", label: "Xuất Excel", icon: FileSpreadsheet },
  ];

  // Cổng "Xuất bản CHÍNH THỨC" — chặn CỨNG nếu còn: dòng Review (giá 0đ/định mức
  // tự tạo), dòng dùng giá MƯỢN từ nhóm khác (chưa duyệt giá thật cho đúng nhóm
  // công trình này), hoặc dự án trống. "Xuất bản NHÁP" vẫn luôn dùng được không
  // giới hạn — QS cần xem/kiểm tra nội bộ trước khi mọi thứ sẵn sàng.
  const soQcMissing = boqLines.filter((l) => l.calc?.trangThai === "QC_MISSING").length;
  const soPriceMissing = boqLines.filter((l) => l.calc?.trangThai === "PRICE_MISSING").length;
  const soReview = soQcMissing + soPriceMissing; // gộp lại để tương thích chỗ khác đang dùng "chưa sẵn sàng"
  const soGiaMuon = boqLines.filter((l) => l.calc?.coGiaMuon).length;
  const lyDoChuaSanSang = [];
  if (soQcMissing > 0) lyDoChuaSanSang.push(`${soQcMissing} dòng "QC MISSING" — định mức tự tạo khi duyệt hàng loạt, CHƯA qua kiểm tra kỹ thuật (tên lẫn giá đều chưa xác nhận)`);
  if (soPriceMissing > 0) lyDoChuaSanSang.push(`${soPriceMissing} dòng "PRICE MISSING" — định mức/tên đã đúng nhưng giá cuối = 0đ`);
  if (soGiaMuon > 0) lyDoChuaSanSang.push(`${soGiaMuon} dòng đang dùng giá MƯỢN từ nhóm công trình khác — chưa có giá duyệt riêng cho nhóm này`);
  const chuaSanSangXuatChinhThuc = lyDoChuaSanSang.length > 0 || soHienThi === 0;

  return (
    <div>
      <SectionHeader icon={FileSpreadsheet} title="Xuất file" desc="Xem lại BOQ, rồi xuất PDF hoặc Excel — cả 3 việc gộp chung 1 thẻ, chuyển bằng 3 nút bên dưới." />

      {chuaSanSangXuatChinhThuc && soHienThi > 0 && (
        <div className="mb-4 p-3 rounded border" style={{ borderColor: RED, background: "#FCEBEA" }}>
          <div className="text-sm font-semibold mb-1" style={{ color: RED }}>🔒 CHƯA xuất được bản CHÍNH THỨC — còn lỗi cần xử lý:</div>
          <ul className="text-xs list-disc pl-4" style={{ color: INK }}>
            {lyDoChuaSanSang.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
          <div className="text-xs mt-1" style={{ color: SLATE }}>Vẫn xuất được bản NHÁP để kiểm tra nội bộ (nút riêng bên dưới) — nhưng nút "Xuất bản CHÍNH THỨC" bị khoá tới khi xử lý hết các dòng trên.</div>
        </div>
      )}

      {soThoTrongDuAn > 0 && soHienThi === 0 && (
        <div className="mb-4 p-3 rounded border" style={{ borderColor: RED, background: "#FCEBEA" }}>
          <div className="text-sm font-semibold mb-1" style={{ color: RED }}>
            Chẩn đoán: dự án "{activeProject?.name}" có {soThoTrongDuAn} dòng đã lưu, nhưng KHÔNG dòng nào hiển thị được ở BOQ.
          </div>
          {bangChanDoan.length > 0 ? (
            <div className="text-xs" style={{ color: INK }}>
              Nguyên nhân: {bangChanDoan.length} dòng đang trỏ tới 1 định mức KHÔNG CÒN TỒN TẠI (có thể đã bị xoá, hoặc dữ liệu chưa đồng bộ đủ khi lưu). Mã định mức bị thiếu: {bangChanDoan.slice(0, 5).map((x) => x.normId).join(", ")}{bangChanDoan.length > 5 ? "..." : ""}.
              <br />Cách xử lý: sang thẻ "Điều chỉnh dự toán/khối lượng" — nếu thấy dòng trống/lỗi, xoá dòng đó và đọc lại bản vẽ (hoặc duyệt lại) để tạo định mức mới đúng cách.
            </div>
          ) : (
            <div className="text-xs" style={{ color: INK }}>
              Chưa xác định được nguyên nhân cụ thể — có thể dòng đã bị đánh dấu "không tính" (bỏ chọn) ở thẻ "Điều chỉnh dự toán/khối lượng". Kiểm tra lại ở đó.
            </div>
          )}
        </div>
      )}

      <div className="no-print flex gap-2 mb-5 border-b" style={{ borderColor: LINE }}>
        {SEGMENTS.map((s) => {
          const Icon = s.icon;
          return (
            <button key={s.id} onClick={() => setView(s.id)} className="px-4 py-2 text-sm font-medium" style={{ color: view === s.id ? NAVY : SLATE, borderBottom: view === s.id ? `2px solid ${AMBER}` : "2px solid transparent" }}>
              <Icon size={14} className="inline mr-1.5 -mt-0.5" /> {s.label}
            </button>
          );
        })}
      </div>

      {!hasData ? (
        <EmptyState text='Chưa có kết quả — quay lại thẻ "Đọc bản vẽ" hoặc "Điều chỉnh dự toán/khối lượng" để nhập khối lượng trước.' />
      ) : view === "preview" ? (
        <>
          <div className="no-print mb-5">
            <button onClick={() => setActiveTab("adjust")} className="inline-flex items-center gap-2 px-4 py-2.5 rounded text-sm font-medium border" style={{ borderColor: LINE, color: NAVY }}>
              <Layers size={16} /> Cần sửa? Sang thẻ Điều chỉnh dự toán/khối lượng
            </button>
          </div>
          <PrintableBoqDocument boqLines={boqLines} totals={totals} activeProject={activeProject} />
        </>
      ) : view === "pdf" ? (
        <>
          <div className="mb-5 p-4 rounded border" style={{ borderColor: GREEN, background: "#F0FBF4" }}>
            <div className="text-sm font-semibold mb-2" style={{ color: GREEN }}>✅ Xuất file PDF thật (khổ A4 ngang, có đánh số trang) — không phải bản in trình duyệt</div>
            <button onClick={exportPdfThat} className="inline-flex items-center gap-2 px-5 py-3 rounded text-white font-medium" style={{ background: GREEN }}>
              <FileText size={16} /> Tạo file PDF
            </button>
          </div>
          <p className="text-sm mb-4" style={{ color: SLATE }}>
            Cách cũ (dự phòng nếu mạng chặn tải font): Bấm "In / Lưu PDF" — ở hộp thoại in của trình duyệt, chọn máy in "Save as PDF" để tải file PDF thay vì in giấy.
          </p>
          <div className="no-print mb-5">
            <button onClick={printNow} className="inline-flex items-center gap-2 px-5 py-3 rounded text-white font-medium" style={{ background: AMBER }}>
              <Printer size={16} /> In / Lưu PDF (cách cũ)
            </button>
          </div>
          <PrintableBoqDocument boqLines={boqLines} totals={totals} activeProject={activeProject} />
        </>
      ) : (
        <>
          <p className="text-sm mb-4" style={{ color: SLATE }}>
            File .xlsx xuất ra có CÔNG THỨC LIÊN KẾT thật giữa các sheet (đơn giá → phân tích đơn giá → BOQ → dự toán tổng hợp) — sửa đơn giá vật tư trong Excel sẽ tự cập nhật toàn bộ, không phải giá trị cứng.
          </p>
          <div className="bg-white border rounded p-6 max-w-xl mb-4" style={{ borderColor: LINE }}>
            <div className="flex justify-between text-sm py-1"><span style={{ color: SLATE }}>Dự án</span><span>{activeProject?.name}</span></div>
            <div className="flex justify-between text-sm py-1"><span style={{ color: SLATE }}>Số dòng BOQ</span><span className="font-mono">{boqLines.length}</span></div>
            <div className="flex justify-between text-sm py-1 border-b pb-3 mb-3" style={{ borderColor: LINE }}><span style={{ color: SLATE }}>Giá bán dự thầu (trước VAT)</span><span className="font-mono font-semibold">{fmt(totals.giaBanTruocVAT)} đ</span></div>
            <button onClick={exportExcel} className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded text-white font-medium mb-2" style={{ background: NAVY }}>
              <FileSpreadsheet size={16} /> Xuất bản NHÁP (luôn dùng được, để kiểm tra nội bộ)
            </button>
            <button onClick={exportExcel} disabled={chuaSanSangXuatChinhThuc} title={chuaSanSangXuatChinhThuc ? "Còn dòng Review hoặc giá mượn chưa xử lý — xem chi tiết ở khung đỏ phía trên" : "Sẵn sàng — mọi dòng đã Confirmed, giá đã duyệt riêng cho nhóm công trình này"} className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: chuaSanSangXuatChinhThuc ? SLATE : GREEN }}>
              {chuaSanSangXuatChinhThuc ? <>🔒 Xuất bản CHÍNH THỨC (đang khoá)</> : <><FileSpreadsheet size={16} /> Xuất bản CHÍNH THỨC (13 sheet, có công thức)</>}
            </button>

            {lastExport && (
              <div className="mt-4 p-3 rounded border" style={{ borderColor: GREEN, background: "#F0FBF4" }}>
                <div className="text-xs mb-2" style={{ color: SLATE }}>Nếu không tự tải, bấm nút dưới đây:</div>
                <a href={lastExport.url} download={lastExport.filename} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded text-white text-sm font-medium" style={{ background: NAVY }}>
                  Tải xuống: {lastExport.filename}
                </a>
                <div className="text-xs mt-2" style={{ color: AMBER_DARK }}>
                  ⚠️ Trên iPhone/Safari, bấm nút trên chỉ MỞ XEM TRƯỚC file, chưa lưu vào máy. Để lưu thật: sau khi file mở ra, bấm biểu tượng <strong>Chia sẻ</strong> (hình vuông có mũi tên) ở góc trên → chọn <strong>"Lưu vào Tệp"</strong>.
                </div>
              </div>
            )}
          </div>

          <div className="max-w-xl p-3 rounded border" style={{ borderColor: LINE, background: "#F6F8FA" }}>
            <div className="text-xs font-semibold mb-1" style={{ color: NAVY }}>Cấu trúc file xuất ra (13 sheet):</div>
            <ul className="text-xs list-disc pl-4" style={{ color: SLATE }}>
              <li><strong>DonGia</strong> — bảng giá vật tư/nhân công gốc (giá trị nhập tay)</li>
              <li><strong>PhanTich</strong> — công thức tham chiếu sang DonGia, tự tính đơn giá phân tích từng định mức</li>
              <li><strong>BOQ</strong> — công thức tham chiếu sang PhanTich, nhân khối lượng ra thành tiền, so sánh với giá khoán (nguồn số liệu chính)</li>
              <li><strong>TongHop_DuToan</strong> — công thức cộng dồn ra giá thành, giá bán, VAT</li>
              <li><strong>BOQ_V1.1 → V4.1</strong> (9 sheet) — trình bày lại đúng theo form chuẩn công ty, tự phân loại từng dòng vào đúng giai đoạn (thô/hoàn thiện/điện/nước/HVAC/nội thất/vệ sinh/PCCC/thang máy), kèm mã chi phí chuẩn — dùng cùng số liệu với sheet BOQ, không tính lại</li>
            </ul>
          </div>

          <div className="max-w-xl mt-6 p-4 rounded border-2" style={{ borderColor: RED }}>
            <div className="text-sm font-semibold mb-1" style={{ color: RED }}>⚠ Báo cáo nội bộ — giá vốn &amp; lợi nhuận</div>
            <p className="text-xs mb-3" style={{ color: SLATE }}>
              File riêng có thêm giá vốn vật tư/nhân công/máy, chi phí trực tiếp, lợi nhuận (đ) và biên lợi nhuận % từng dòng —
              <strong> chỉ dùng nội bộ công ty, không gửi cho khách hàng</strong>. File "Tạo file Excel" ở trên vẫn chỉ có giá bán như bình thường, an toàn để gửi báo giá.
            </p>
            <button onClick={exportInternalExcel} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded text-white text-sm font-medium" style={{ background: RED }}>
              <FileSpreadsheet size={16} /> Xuất báo cáo nội bộ (giá vốn &amp; lợi nhuận)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
