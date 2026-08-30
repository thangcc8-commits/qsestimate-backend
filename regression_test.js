// ============================================================================
// BỘ KIỂM TRA HỒI QUY ĐẦY ĐỦ — QsEstimateApp
// ----------------------------------------------------------------------------
// Gộp 2 nguồn: (A) test logic tính toán cốt lõi (đã có từ trước) + (B) test cấu
// trúc triển khai/bảo mật (từ gói qs-production.zip, đã VÁ 1 lỗi thật: regex
// kiểm tra lộ khoá API không nhận diện được định dạng khoá Anthropic thật có
// dấu gạch ngang "sk-ant-api03-..." — nếu không vá, hardcode khoá thật vẫn báo
// "an toàn" nhầm).
//
// Cách dùng: node regression_test.js
// Thoát mã 0 nếu mọi test PASS, thoát mã 1 nếu có FAIL.
// ============================================================================
const fs = require("fs");
const path = require("path");

let soPass = 0, soFail = 0;
function test(ten, thucTe, kyVong) {
  const ok = JSON.stringify(thucTe) === JSON.stringify(kyVong);
  console.log((ok ? "✅ PASS" : "❌ FAIL") + " — " + ten);
  if (!ok) { console.log("   Kỳ vọng:", JSON.stringify(kyVong)); console.log("   Thực tế:", JSON.stringify(thucTe)); soFail++; }
  else soPass++;
}
function testDk(ten, dieuKien, chiTiet) {
  console.log((dieuKien ? "✅ PASS" : "❌ FAIL") + " — " + ten + (!dieuKien && chiTiet ? " — " + chiTiet : ""));
  dieuKien ? soPass++ : soFail++;
}

// ============================================================================
// PHẦN A — LOGIC TÍNH TOÁN CỐT LÕI (không cần file server/network)
// ============================================================================
function wallGrossArea(length, height) { return Math.max(0, length) * Math.max(0, height); }
function subtractAreas(gross, openings) { return Math.max(0, gross - openings.reduce((s, v) => s + Math.max(0, v), 0)); }
function wallNetArea(length, height, openings) {
  const gross = wallGrossArea(length, height);
  const openingAreas = (openings || []).map((o) => (Number(o.width) || 0) * (Number(o.height) || 0) * (Number(o.count) || 1));
  return subtractAreas(gross, openingAreas);
}
test("wallNetArea: tường 5x3, 1 cửa 1x2", wallNetArea(5, 3, [{ width: 1, height: 2, count: 1 }]), 13);
test("wallNetArea: tường 15x3.3, 5 lỗ mở", +wallNetArea(15, 3.3, [{ width: 1, height: 2.1, count: 2 }, { width: 1.2, height: 1.5, count: 3 }]).toFixed(2), 39.9);

const SAI_SO_CHO_PHEP = 0.02;
function doiChieuAiVaCongThuc(soLuongAI, soLuongCongThuc) {
  if (soLuongCongThuc === 0 && soLuongAI === 0) return null;
  const saiSoTuyetDoi = Math.abs(soLuongAI - soLuongCongThuc);
  const saiSoTuongDoi = soLuongCongThuc !== 0 ? saiSoTuyetDoi / Math.abs(soLuongCongThuc) : (saiSoTuyetDoi > 0 ? 1 : 0);
  if (saiSoTuongDoi <= SAI_SO_CHO_PHEP) return null;
  return { mucDo: saiSoTuongDoi > 0.1 ? "cao" : "vua" };
}
test("Đối chiếu: khớp hoàn toàn -> không cảnh báo", doiChieuAiVaCongThuc(13, 13), null);
test("Đối chiếu: lệch 53.8% -> cảnh báo CAO", doiChieuAiVaCongThuc(20, 13), { mucDo: "cao" });

function resolvePrice(item, groupId) {
  if (!item.prices) return { price: 0, source: null, borrowed: false };
  if (item.prices[groupId] > 0) return { price: item.prices[groupId], source: groupId, borrowed: false };
  const cacNhomCoGia = Object.keys(item.prices).filter((g) => item.prices[g] > 0);
  if (cacNhomCoGia.length) {
    const otherGid = cacNhomCoGia.reduce((max, g) => (item.prices[g] > item.prices[max] ? g : max), cacNhomCoGia[0]);
    return { price: item.prices[otherGid], source: otherGid, borrowed: true };
  }
  return { price: 0, source: null, borrowed: false };
}
test("resolvePrice: mượn giá CAO NHẤT", resolvePrice({ prices: { "nha-pho": 100000, shophouse: 150000 } }, "khac"), { price: 150000, source: "shophouse", borrowed: true });

const NHOM_HOP_LE = new Set(["mong", "khung", "hoanthien", "mep"]);
function locHangMucHopLeSmoke(danhSach) {
  return danhSach.filter((item) => {
    if (!item || typeof item !== "object") return false;
    if (typeof item.name !== "string" || !item.name.trim()) return false;
    const qty = Number(item.qty);
    if (!Number.isFinite(qty) || qty < 0) return false;
    return true;
  });
}
test("locHangMucHopLe: lọc đúng 2/5 dòng hợp lệ", locHangMucHopLeSmoke([
  { name: "A", qty: 20 }, { name: "", qty: 10 }, { name: "B", qty: -5 }, { name: "C", qty: "abc" }, { name: "D", qty: 15 },
]).length, 2);

function tinhTang(direct, quanLy, khac, duPhongKL, duPhongTruotGia, loiNhuan, vat) {
  const v7 = direct + direct * quanLy + direct * khac;
  const v11 = v7 + v7 * duPhongKL + v7 * duPhongTruotGia;
  const v13 = v11 + v11 * loiNhuan;
  return v13 + v13 * vat;
}
test("Cost cascade 8/1/12/8%: 5 tỷ -> tổng đúng", +tinhTang(5e9, 0.08, 0.01, 0.05, 0.03, 0.12, 0.08).toFixed(0), 7119705600);

// --- Công thức tường (đồng bộ server.js tinhQtyTuongTuFormulaInputs, bao gồm
// validate chặn số đo vô lý mới thêm) ---
function tinhQtyTuongTuFormulaInputs(fi) {
  if (!fi || typeof fi !== "object") return null;
  const dai = Number(fi.length_m), cao = Number(fi.height_m);
  if (!Number.isFinite(dai) || dai <= 0 || !Number.isFinite(cao) || cao <= 0) return null;
  if (dai > 500 || cao > 50) return null;
  const dienTichGop = dai * cao;
  const tongTru = Array.isArray(fi.deductions)
    ? fi.deductions.reduce((s, d) => {
        const w = Number(d?.width_m) || 0, h = Number(d?.height_m) || 0, c = Number(d?.count) || 1;
        if (w > 50 || h > 50 || c > 100) return s;
        return s + Math.max(0, w) * Math.max(0, h) * Math.max(0, c);
      }, 0)
    : 0;
  return +Math.max(0, dienTichGop - tongTru).toFixed(4);
}
test("tinhQty tường 5x3 − 1 cửa 1x2", tinhQtyTuongTuFormulaInputs({ length_m: 5, height_m: 3, deductions: [{ width_m: 1, height_m: 2, count: 1 }] }), 13);
test("tinhQty trừ quá nhiều -> 0 (không âm)", tinhQtyTuongTuFormulaInputs({ length_m: 2, height_m: 2, deductions: [{ width_m: 3, height_m: 3, count: 1 }] }), 0);
test("tinhQty từ chối kích thước ảo (dài 600m)", tinhQtyTuongTuFormulaInputs({ length_m: 600, height_m: 3 }), null);
test("tinhQty từ chối kích thước ảo (cao 60m)", tinhQtyTuongTuFormulaInputs({ length_m: 5, height_m: 60 }), null);

// --- evidence_region (đồng bộ server.js chuanHoaEvidenceRegion) ---
function chuanHoaEvidenceRegion(r) {
  if (!r || typeof r !== "object") return null;
  const x = Number(r.x), y = Number(r.y), w = Number(r.w), h = Number(r.h);
  if (![x, y, w, h].every((v) => Number.isFinite(v))) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1 || w <= 0 || w > 1 || h <= 0 || h > 1) return null;
  if (x + w > 1.05 || y + h > 1.05) return null;
  return { x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4) };
}
test("evidence_region hợp lệ được giữ nguyên", chuanHoaEvidenceRegion({ x: 0.21, y: 0.32, w: 0.31, h: 0.04 }), { x: 0.21, y: 0.32, w: 0.31, h: 0.04 });
test("evidence_region toạ độ pixel thật (không phải %) -> null", chuanHoaEvidenceRegion({ x: 450, y: 220, w: 180, h: 30 }), null);
test("evidence_region thiếu trường -> null", chuanHoaEvidenceRegion({ x: 0.1, y: 0.1, h: 0.05 }), null);
test("evidence_region null từ đầu -> vẫn null (không lỗi)", chuanHoaEvidenceRegion(null), null);

// --- declared_scale (đồng bộ server.js tinhScaleLyThuyet) ---
const KHO_GIAY_MM = { A4: 210, A3: 297, A2: 420, A1: 594, A0: 841 };
function tinhScaleLyThuyet(declaredScale, khoGiayGioiThieu = "A4") {
  if (!declaredScale || typeof declaredScale !== "string") return null;
  const match = declaredScale.trim().match(/^(\d+)\s*:\s*(\d+)$/);
  if (!match) return null;
  const tuSo = Number(match[1]), mauSo = Number(match[2]);
  if (!tuSo || !mauSo) return null;
  return { tyLe: mauSo / tuSo, khoGiayGioiThieu, chieuRongGiayMm: KHO_GIAY_MM[khoGiayGioiThieu] || KHO_GIAY_MM.A4 };
}
test("declared_scale \"1:100\" tính đúng tỷ lệ 100x, khổ A4", tinhScaleLyThuyet("1:100"), { tyLe: 100, khoGiayGioiThieu: "A4", chieuRongGiayMm: 210 });
test("declared_scale sai định dạng -> null", tinhScaleLyThuyet("khong ro"), null);
test("declared_scale rỗng/null -> null", tinhScaleLyThuyet(null), null);

// --- locHangMucHopLe không mutate input + tính tường (đồng bộ server.js) ---
function locHangMucHopLeFull(danhSach) {
  const NHOM = new Set(["mong", "khung", "hoanthien", "mep"]);
  return (danhSach || [])
    .map((raw) => {
      if (!raw || typeof raw !== "object") return raw;
      const item = { ...raw };
      if (item.calc_type === "tinh_tu_kich_thuoc_tuong") {
        const qtyThat = tinhQtyTuongTuFormulaInputs(item.formula_inputs);
        item.qty = qtyThat;
        item.note = (item.note || "") + ` [App tự tính]`;
        item.qty_source = "app_formula";
      }
      if (item.evidence_region !== undefined) {
        item.evidence_region = chuanHoaEvidenceRegion(item.evidence_region);
      }
      return item;
    })
    .filter((item) => {
      if (!item || typeof item !== "object") return false;
      if (typeof item.name !== "string" || !item.name.trim()) return false;
      if (item.qty === null) return false;
      const qty = Number(item.qty);
      if (!Number.isFinite(qty) || qty < 0) return false;
      if (item.group != null && !NHOM.has(item.group)) item.group = undefined;
      return true;
    });
}

const rawTuong = {
  name: "Xây tường",
  qty: 99, // số AI bịa — phải bị ghi đè
  calc_type: "tinh_tu_kich_thuoc_tuong",
  formula_inputs: { length_m: 5, height_m: 3, deductions: [{ width_m: 1, height_m: 2, count: 1 }] },
  evidence_region: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
  group: "hoanthien",
};
const gocCopy = JSON.parse(JSON.stringify(rawTuong));
const kqLoc = locHangMucHopLeFull([rawTuong]);
test("locHangMucHopLe: không mutate input gốc", rawTuong.qty, 99);
test("locHangMucHopLe: qty tường = app tự tính 13", kqLoc[0]?.qty, 13);
test("locHangMucHopLe: qty_source = app_formula", kqLoc[0]?.qty_source, "app_formula");
test("locHangMucHopLe: evidence_region còn hợp lệ", !!kqLoc[0]?.evidence_region, true);
test("locHangMucHopLe: input gốc evidence không đổi", rawTuong.evidence_region.x, gocCopy.evidence_region.x);

test(
  "locHangMucHopLe: formula hỏng (dài 600m) → loại dòng",
  locHangMucHopLeFull([
    { name: "Tường ảo", qty: null, calc_type: "tinh_tu_kich_thuoc_tuong", formula_inputs: { length_m: 600, height_m: 3, deductions: [] } },
  ]).length,
  0
);

// --- b01_ingest: PDF không base64 vẫn có checksum khác rỗng (đồng bộ server.js) ---
function b01_ingestSmoke(images) {
  const crypto = require("crypto");
  const checksums = (images || []).map((img) => {
    const payload =
      img.base64 && String(img.base64).length > 0
        ? img.base64
        : `name:${img.name || "unknown"}|type:${img.mediaType || img.media_type || ""}`;
    return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 12);
  });
  return checksums;
}
const csPdf = b01_ingestSmoke([{ base64: "", name: "document.pdf" }]);
test("b01_ingest PDF: checksum không phải hash chuỗi rỗng thuần", csPdf[0] !== require("crypto").createHash("sha256").update("").digest("hex").slice(0, 12), true);
test("b01_ingest PDF: cùng tên → cùng checksum", b01_ingestSmoke([{ base64: "", name: "document.pdf" }])[0], csPdf[0]);
test("b01_ingest: khác tên → khác checksum", b01_ingestSmoke([{ base64: "", name: "khac.pdf" }])[0] !== csPdf[0], true);

// --- 4 hàm mới: cột/dầm/móng/sàn (đồng bộ server.js) ---
function tinhQtyCotTuFormulaInputs(fi) {
  if (!fi || typeof fi !== "object") return null;
  const rong = Number(fi.rong_m), day = Number(fi.day_m), cao = Number(fi.cao_m);
  if (!Number.isFinite(rong) || rong <= 0 || !Number.isFinite(day) || day <= 0 || !Number.isFinite(cao) || cao <= 0) return null;
  if (rong > 2 || day > 2 || cao > 50) return null;
  return +(rong * day * cao).toFixed(4);
}
function tinhQtyDamTuFormulaInputs(fi) {
  if (!fi || typeof fi !== "object") return null;
  const rong = Number(fi.rong_m), cao = Number(fi.cao_m), dai = Number(fi.dai_m);
  if (!Number.isFinite(rong) || rong <= 0 || !Number.isFinite(cao) || cao <= 0 || !Number.isFinite(dai) || dai <= 0) return null;
  if (rong > 2 || cao > 2 || dai > 500) return null;
  return +(rong * cao * dai).toFixed(4);
}
function tinhQtyMongTuFormulaInputs(fi) {
  if (!fi || typeof fi !== "object") return null;
  const dai = Number(fi.dai_m), rong = Number(fi.rong_m), cao = Number(fi.cao_m);
  if (!Number.isFinite(dai) || dai <= 0 || !Number.isFinite(rong) || rong <= 0 || !Number.isFinite(cao) || cao <= 0) return null;
  if (dai > 500 || rong > 500 || cao > 10) return null;
  return +(dai * rong * cao).toFixed(4);
}
function tinhQtySanTuFormulaInputs(fi) {
  if (!fi || typeof fi !== "object") return null;
  const dai = Number(fi.dai_m), rong = Number(fi.rong_m), day = Number(fi.day_m);
  if (!Number.isFinite(dai) || dai <= 0 || !Number.isFinite(rong) || rong <= 0 || !Number.isFinite(day) || day <= 0) return null;
  if (dai > 500 || rong > 500 || day > 1) return null;
  return +(dai * rong * day).toFixed(4);
}
test("tinhQty cột 0.2x0.3x3.3m = 0.198m³", tinhQtyCotTuFormulaInputs({ rong_m: 0.2, day_m: 0.3, cao_m: 3.3 }), 0.198);
test("tinhQty cột tiết diện ảo (3m) -> null", tinhQtyCotTuFormulaInputs({ rong_m: 3, day_m: 0.3, cao_m: 3.3 }), null);
test("tinhQty dầm 0.2x0.4x5m = 0.4m³", tinhQtyDamTuFormulaInputs({ rong_m: 0.2, cao_m: 0.4, dai_m: 5 }), 0.4);
test("tinhQty dầm dài ảo (600m) -> null", tinhQtyDamTuFormulaInputs({ rong_m: 0.2, cao_m: 0.4, dai_m: 600 }), null);
test("tinhQty móng 2x2x0.5m = 2m³", tinhQtyMongTuFormulaInputs({ dai_m: 2, rong_m: 2, cao_m: 0.5 }), 2);
test("tinhQty móng cao ảo (15m) -> null", tinhQtyMongTuFormulaInputs({ dai_m: 2, rong_m: 2, cao_m: 15 }), null);
test("tinhQty sàn 10x8x0.12m = 9.6m³", tinhQtySanTuFormulaInputs({ dai_m: 10, rong_m: 8, day_m: 0.12 }), 9.6);
test("tinhQty sàn dày ảo (2m) -> null", tinhQtySanTuFormulaInputs({ dai_m: 10, rong_m: 8, day_m: 2 }), null);

// --- Hệ thống 3 tầng xác định tỷ lệ/kích thước (đồng bộ server.js b05_scale) ---
function b05_scaleTest(normalizedItems) {
  const soDongTangMot = normalizedItems.filter((i) =>
    ["tinh_tu_kich_thuoc_tuong", "tinh_tu_kich_thuoc_cot", "tinh_tu_kich_thuoc_dam", "tinh_tu_kich_thuoc_mong", "tinh_tu_kich_thuoc_san"].includes(i.calc_type)
  ).length;
  if (soDongTangMot > 0) return { status: "done", tang: 1 };
  const coThamChieu = normalizedItems.find((i) => i.known_geometry_ref && Number.isFinite(Number(i.known_geometry_ref.gia_tri_m)));
  if (coThamChieu) return { status: "partial", tang: 2 };
  const coKhaiBao = normalizedItems.find((i) => i.declared_scale);
  if (coKhaiBao && tinhScaleLyThuyet(coKhaiBao.declared_scale)) return { status: "partial", tang: 2 };
  return { status: "review", tang: 3 };
}
test("3 tầng: có calc_type tính khối lượng -> Tầng 1 done", b05_scaleTest([{ calc_type: "tinh_tu_kich_thuoc_tuong" }]), { status: "done", tang: 1 });
test("3 tầng: có known_geometry_ref -> Tầng 2 partial", b05_scaleTest([{ calc_type: "doc_truc_tiep", known_geometry_ref: { gia_tri_m: 4 } }]), { status: "partial", tang: 2 });
test("3 tầng: có declared_scale -> Tầng 2 partial", b05_scaleTest([{ calc_type: "doc_truc_tiep", declared_scale: "1:100" }]), { status: "partial", tang: 2 });
test("3 tầng: không có gì -> Tầng 3 review (gợi ý đo tay)", b05_scaleTest([{ calc_type: "doc_truc_tiep" }]), { status: "review", tang: 3 });

// --- Đóng khe hở cuối: AI KHÔNG BAO GIỜ có qty được tin — kể cả doc_truc_tiep/dem_so_luong (đồng bộ server.js) ---
function tinhQtyDocTrucTiepTuFormulaInputs(fi) {
  if (!fi || typeof fi !== "object") return null;
  const v = Number(fi.value_do_duoc);
  if (!Number.isFinite(v) || v < 0) return null;
  if (v > 1e9) return null;
  return +v.toFixed(4);
}
function tinhQtyDemSoLuongTuFormulaInputs(fi) {
  if (!fi || typeof fi !== "object") return null;
  const v = Number(fi.so_luong);
  if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) return null;
  if (v > 100000) return null;
  return v;
}
test("doc_truc_tiep: tính đúng từ value_do_duoc", tinhQtyDocTrucTiepTuFormulaInputs({ value_do_duoc: 23.9 }), 23.9);
test("doc_truc_tiep: âm -> null", tinhQtyDocTrucTiepTuFormulaInputs({ value_do_duoc: -5 }), null);
test("dem_so_luong: tính đúng từ so_luong", tinhQtyDemSoLuongTuFormulaInputs({ so_luong: 5 }), 5);
test("dem_so_luong: không phải số nguyên -> null", tinhQtyDemSoLuongTuFormulaInputs({ so_luong: 5.5 }), null);

// Kịch bản đối kháng: AI cố tình vẫn đưa field "qty" dù được dạy không có trường này
function locHangMucHopLeAdversarial(danhSach) {
  const BANG = {
    doc_truc_tiep: tinhQtyDocTrucTiepTuFormulaInputs,
    dem_so_luong: tinhQtyDemSoLuongTuFormulaInputs,
  };
  return danhSach.map((raw) => {
    const item = { ...raw };
    const fn = BANG[item.calc_type];
    item.qty = fn ? fn(item.formula_inputs) : null; // KHÔNG BAO GIỜ đọc raw.qty
    return item;
  });
}
const ketQuaDoiKhang = locHangMucHopLeAdversarial([
  { name: "San", calc_type: "doc_truc_tiep", formula_inputs: { value_do_duoc: 23.9 }, qty: 99999 },
  { name: "Cua", calc_type: "dem_so_luong", formula_inputs: { so_luong: 5 }, qty: 88888 },
]);
test("Đối kháng: AI đưa qty=99999 vẫn bị bỏ qua, tính đúng 23.9", ketQuaDoiKhang[0].qty, 23.9);
test("Đối kháng: AI đưa qty=88888 vẫn bị bỏ qua, tính đúng 5", ketQuaDoiKhang[1].qty, 5);

// --- b02_classify: phân loại bản vẽ SAU KHI ĐỌC, dựa vào phân bố nhóm (đồng bộ server.js) ---
function b02_classifyTest(rawItems) {
  if (!rawItems || !rawItems.length) return { status: "blocked" };
  const demTheoNhom = {};
  rawItems.forEach((it) => { const nhom = it?.group || "khac"; demTheoNhom[nhom] = (demTheoNhom[nhom] || 0) + 1; });
  const tongSo = rawItems.length;
  const [tenNhomChinh, soLuongNhomChinh] = Object.entries(demTheoNhom).sort((a, b) => b[1] - a[1])[0];
  const tyLeNhomChinh = soLuongNhomChinh / tongSo;
  let loaiBanVe = "không rõ";
  if (tyLeNhomChinh >= 0.4) {
    if (tenNhomChinh === "mep") loaiBanVe = "MEP (điện/nước/PCCC)";
    else if (tenNhomChinh === "khung" || tenNhomChinh === "mong") loaiBanVe = "kết cấu (khung/móng)";
    else if (tenNhomChinh === "hoanthien") loaiBanVe = "kiến trúc/hoàn thiện";
  }
  return { status: loaiBanVe === "không rõ" ? "partial" : "done", loaiBanVe };
}
test("b02_classify: đa số kết cấu -> nhận diện đúng", b02_classifyTest([{ group: "khung" }, { group: "khung" }, { group: "khung" }, { group: "mong" }, { group: "hoanthien" }]).loaiBanVe, "kết cấu (khung/móng)");
test("b02_classify: đa số MEP -> nhận diện đúng", b02_classifyTest([{ group: "mep" }, { group: "mep" }, { group: "mep" }, { group: "hoanthien" }]).loaiBanVe, "MEP (điện/nước/PCCC)");
test("b02_classify: phân bố đều 4 nhóm -> không rõ, KHÔNG gộp nhầm khung+mong", b02_classifyTest([{ group: "khung" }, { group: "mong" }, { group: "hoanthien" }, { group: "mep" }]).status, "partial");
test("b02_classify: mảng rỗng -> blocked", b02_classifyTest([]).status, "blocked");

// --- Đối chiếu chéo theo mã hiệu — Engine tự phát hiện, KHÔNG phụ thuộc AI tự viết cảnh báo (đồng bộ server.js) ---
function doiChieuTheoMaHieuTest(items) {
  const theoMaHieu = {};
  items.forEach((it) => {
    const dc = it.doi_chieu;
    if (!dc || !dc.ma_hieu || !dc.loaiNguon || !Number.isFinite(Number(dc.soLuong))) return;
    const key = String(dc.ma_hieu).trim().toUpperCase();
    if (!theoMaHieu[key]) theoMaHieu[key] = [];
    theoMaHieu[key].push({ loaiNguon: dc.loaiNguon, soLuong: Number(dc.soLuong) });
  });
  const canhBao = [];
  Object.entries(theoMaHieu).forEach(([maHieu, danhSach]) => {
    const theoNguon = {};
    danhSach.forEach((d) => { if (!theoNguon[d.loaiNguon]) theoNguon[d.loaiNguon] = d.soLuong; });
    const cacNguon = Object.keys(theoNguon);
    if (cacNguon.length < 2) return;
    const cacGiaTri = cacNguon.map((n) => theoNguon[n]);
    const min = Math.min(...cacGiaTri), max = Math.max(...cacGiaTri);
    if (min !== max) canhBao.push({ maHieu, chenhLech: max - min });
  });
  return canhBao;
}
test("Đối chiếu D01: PLAN=12, SCHEDULE=13 -> Engine tự phát hiện chênh lệch 1", doiChieuTheoMaHieuTest([
  { doi_chieu: { ma_hieu: "D01", loaiNguon: "PLAN", soLuong: 12 } },
  { doi_chieu: { ma_hieu: "D01", loaiNguon: "SCHEDULE", soLuong: 13 } },
]), [{ maHieu: "D01", chenhLech: 1 }]);
test("Đối chiếu: cùng số liệu 2 nguồn -> không báo lệch giả", doiChieuTheoMaHieuTest([
  { doi_chieu: { ma_hieu: "D02", loaiNguon: "PLAN", soLuong: 5 } },
  { doi_chieu: { ma_hieu: "D02", loaiNguon: "SCHEDULE", soLuong: 5 } },
]).length, 0);
test("Đối chiếu: chỉ 1 nguồn -> không có gì để so sánh chéo", doiChieuTheoMaHieuTest([
  { doi_chieu: { ma_hieu: "D03", loaiNguon: "PLAN", soLuong: 7 } },
]).length, 0);

// --- Fuzzy match: chặn khớp nhầm công tác ĐỐI NGHỊCH (đồng bộ QsEstimateApp.jsx) ---
const CAC_CAP_TU_DOI_NGHICH_TEST = [
  ["xây", "đục"], ["xây", "phá"], ["xây", "tháo"], ["xây", "dỡ"], ["xây", "tô"],
  ["lắp", "tháo"], ["lắp", "dỡ"], ["lắp đặt", "tháo dỡ"],
  ["trong", "ngoài"], ["trên", "dưới"], ["trước", "sau"],
  ["tô", "đục"], ["sơn", "tẩy"], ["đổ", "phá"], ["xây dựng", "phá dỡ"],
];
function coTuDoiNghichTest(a, b) {
  const la = String(a).toLowerCase(), lb = String(b).toLowerCase();
  return CAC_CAP_TU_DOI_NGHICH_TEST.some(([x, y]) => (la.includes(x) && lb.includes(y)) || (la.includes(y) && lb.includes(x)));
}
function similarityTest(a, b) {
  if (coTuDoiNghichTest(a, b)) return 0;
  const cleanWords = (s) => String(s).toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1);
  const wa = new Set(cleanWords(a)), wb = new Set(cleanWords(b));
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  wa.forEach((w) => { if (wb.has(w)) common++; });
  return common / Math.max(wa.size, wb.size);
}
test("Fuzzy match: Xây vs Đục tường -> chặn (không tự động khớp)", similarityTest("Xây tường 200", "Đục tường 200") < 0.3, true);
test("Fuzzy match: Lắp vs Tháo cửa -> chặn", similarityTest("Lắp cửa đi P1", "Tháo cửa đi P1") < 0.3, true);
test("Fuzzy match: Xây vs Tô tường -> chặn", similarityTest("Xây tường gạch ống", "Tô tường gạch ống") < 0.3, true);
test("Fuzzy match: cùng công tác vẫn khớp đúng (không bị chặn oan)", similarityTest("Xây tường 200", "Xây tường 200 gạch ống") >= 0.3, true);

// --- Giới hạn số job chạy nền đồng thời (đồng bộ server.js) ---
function taoJobTest(soJobHienTai, gioiHan) { return soJobHienTai >= gioiHan ? { loi: true } : { loi: false }; }
test("Job: dưới giới hạn -> cho phép tạo", taoJobTest(1, 2).loi, false);
test("Job: đạt giới hạn -> từ chối", taoJobTest(2, 2).loi, true);

// --- Confidence Matrix: 4/5 chỉ số tính xác định, chỉ dimension là AI tự báo (đồng bộ server.js) ---
function tinhConfidenceMatrixTest(item, b05Status, canhBaoTheoMaHieu) {
  const evidenceConfidence = item.evidence_region ? 1.0 : 0;
  const geometryConfidence = b05Status === "done" ? 1.0 : b05Status === "partial" ? 0.5 : 0.2;
  const dimensionConfidence = Number.isFinite(item.confidence) ? item.confidence : null;
  const formulaConfidence = item.qty_source === "app_formula" ? 1.0 : (item.qty_source === "engine_reconciliation" ? null : 0.3);
  let reconciliationConfidence = 0.7;
  if (item.doi_chieu?.ma_hieu) {
    const maHieu = String(item.doi_chieu.ma_hieu).trim().toUpperCase();
    reconciliationConfidence = canhBaoTheoMaHieu.has(maHieu) ? 0.3 : 1.0;
  }
  return { evidenceConfidence, geometryConfidence, dimensionConfidence, formulaConfidence, reconciliationConfidence };
}
test("Confidence: có evidence_region -> evidenceConfidence=1.0",
  tinhConfidenceMatrixTest({ evidence_region: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }, "done", new Set()).evidenceConfidence, 1.0);
test("Confidence: không có evidence_region -> evidenceConfidence=0",
  tinhConfidenceMatrixTest({}, "done", new Set()).evidenceConfidence, 0);
test("Confidence: AI không tự báo confidence -> dimensionConfidence=null (không bịa)",
  tinhConfidenceMatrixTest({}, "done", new Set()).dimensionConfidence, null);
test("Confidence: mã hiệu bị đối chiếu lệch -> reconciliationConfidence=0.3",
  tinhConfidenceMatrixTest({ doi_chieu: { ma_hieu: "D01" } }, "done", new Set(["D01"])).reconciliationConfidence, 0.3);
test("Confidence: mã hiệu đối chiếu khớp -> reconciliationConfidence=1.0",
  tinhConfidenceMatrixTest({ doi_chieu: { ma_hieu: "D02" } }, "done", new Set(["D01"])).reconciliationConfidence, 1.0);

// --- b07_relationship: gợi ý liên kết tầng qua OCR — LUÔN "partial", KHÔNG BAO GIỜ "done" (đồng bộ server.js) ---
function b07_relationshipTest(normalizedItems, ocrData) {
  if (!ocrData || !Array.isArray(ocrData.items)) return { status: "blocked", relationships: [] };
  const relationships = [];
  const nhanTang = ocrData.items.filter((t) => /T[ẦA]NG\s*\d+|TRỆT|MÁI/i.test(t.text || ""));
  normalizedItems.forEach((it, idx) => {
    if (it.evidence_region && nhanTang.length) {
      const tr = it.evidence_region;
      const tangKhop = nhanTang.find((n) => n.evidence_region && Math.abs(n.evidence_region.y - tr.y) < 0.2);
      if (tangKhop) relationships.push({ objectId: `OBJ-${idx + 1}`, target: tangKhop.text });
    }
  });
  return { status: "partial", relationships };
}
test("b07: không có OCR -> vẫn blocked (không đổi hành vi cũ)", b07_relationshipTest([{}], null).status, "blocked");
test("b07: có OCR, khớp đúng -> status partial (không phải done)", b07_relationshipTest(
  [{ evidence_region: { x: 0.3, y: 0.12, w: 0.2, h: 0.1 } }],
  { items: [{ text: "TẦNG 2", evidence_region: { x: 0.05, y: 0.1, w: 0.1, h: 0.02 } }] }
).status, "partial");
test("b07: kịch bản gán nhầm tầng (đã kiểm chứng) -> VẪN partial, không giả vờ done", b07_relationshipTest(
  [{ evidence_region: { x: 0.3, y: 0.15, w: 0.2, h: 0.1 } }], // AI đoán sai, thực ra ở Tầng 3 (y=0.6) nhưng gần Tầng 2 (y=0.1) hơn
  { items: [{ text: "TẦNG 2", evidence_region: { x: 0.05, y: 0.1, w: 0.1, h: 0.02 } }, { text: "TẦNG 3", evidence_region: { x: 0.05, y: 0.6, w: 0.1, h: 0.02 } }] }
).status, "partial");

// --- Polygon boolean thật cho tường (đồng bộ server.js) — CHỈ dùng khi có toạ
// độ polygon thật (KHÔNG dạy AI Vision dùng vì AI không cho toạ độ pixel đáng
// tin — đường này chờ nguồn dữ liệu chính xác như DXF trong tương lai) ---
const polygonClipping = require("polygon-clipping");
function tinhDienTichTuongBangPolygonTest(polygonNgoai, cacLoMoPolygon) {
  function dienTichShoelace(vertices) {
    let s = 0;
    for (let i = 0; i < vertices.length - 1; i++) s += vertices[i][0] * vertices[i + 1][1] - vertices[i + 1][0] * vertices[i][1];
    return Math.abs(s) / 2;
  }
  const dongKin = (poly) => { const p = poly.map((pt) => [Number(pt[0]), Number(pt[1])]); if (p[0][0] !== p[p.length - 1][0] || p[0][1] !== p[p.length - 1][1]) p.push(p[0]); return p; };
  const ngoai = [dongKin(polygonNgoai)];
  const loMo = (cacLoMoPolygon || []).map((lo) => [dongKin(lo)]);
  const ketQua = loMo.length ? polygonClipping.difference(ngoai, ...loMo) : ngoai;
  let dienTich = 0;
  ketQua.forEach((poly) => poly.forEach((ring) => { dienTich += dienTichShoelace(ring); }));
  return +dienTich.toFixed(4);
}
test("Polygon boolean: tường đơn giản trừ 1 cửa (khớp ví dụ tài liệu 28.71)",
  tinhDienTichTuongBangPolygonTest([[0, 0], [8.5, 0], [8.5, 3.6], [0, 3.6]], [[[2, 0], [2.9, 0], [2.9, 2.1], [2, 2.1]]]), 28.71);
test("Polygon boolean: 2 lỗ mở CHỒNG LẤN -> tính ĐÚNG 10 (cách trừ đơn giản sẽ sai ra 9)",
  tinhDienTichTuongBangPolygonTest([[0, 0], [5, 0], [5, 3], [0, 3]], [[[1, 0], [2.5, 0], [2.5, 2], [1, 2]], [[2, 0], [3.5, 0], [3.5, 2], [2, 2]]]), 10);

function extractJsonArraySmoke(text) {
  let clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { const p = JSON.parse(clean); if (Array.isArray(p)) return p; } catch {}
  const a = clean.indexOf("["), b = clean.lastIndexOf("]");
  if (a !== -1 && b > a) { try { return JSON.parse(clean.slice(a, b + 1)); } catch {} }
  return [];
}
test("extractJsonArray: JSON thuần", extractJsonArraySmoke('[{"name":"A","qty":1}]').length, 1);
test("extractJsonArray: trong markdown", extractJsonArraySmoke('```json\n[{"name":"A"}]\n```').length, 1);
test("extractJsonArray: AI thêm chữ quanh", extractJsonArraySmoke('Kết quả:\n[{"name":"B"}]\nHết.').length, 1);

// ============================================================================
// PHẦN B — CẤU TRÚC TRIỂN KHAI + BẢO MẬT (cần chạy TRONG thư mục có đủ file
// server.js/index.html/app.bundle.js/package.json — bỏ qua nếu thiếu, không
// coi là FAIL, vì phần A vẫn có giá trị chạy độc lập ở bất kỳ đâu)
// ============================================================================
const root = __dirname;
const coDuFile = fs.existsSync(path.join(root, "server.js")) && fs.existsSync(path.join(root, "index.html")) && fs.existsSync(path.join(root, "app.bundle.js"));

if (coDuFile) {
  testDk("Có server.js", fs.existsSync(path.join(root, "server.js")));
  testDk("Có index.html", fs.existsSync(path.join(root, "index.html")));
  testDk("Có app.bundle.js (đúng tên, không phải app_bundle.js)", fs.existsSync(path.join(root, "app.bundle.js")));

  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  testDk("index.html load đúng /app.bundle.js", html.includes('src="/app.bundle.js"') || html.includes("src='/app.bundle.js'"));
  testDk("index.html có thẻ #root", html.includes('id="root"'));

  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  ["/health", "/api/analyze-image", "/api/analyze-images-batch", "/api/analyze-pdf", "/api/backup", "callClaude", "callUnifiedAI", "extractJsonArray", "locHangMucHopLe"].forEach((s) =>
    testDk("server.js có " + s, server.includes(s))
  );
  testDk("Có storage-postgres.js (dự phòng Postgres)", fs.existsSync(path.join(root, "storage-postgres.js")));
  if (fs.existsSync(path.join(root, "storage-postgres.js"))) {
    const spg = fs.readFileSync(path.join(root, "storage-postgres.js"), "utf8");
    testDk(
      "storage-postgres.js có pool.on('error') — chống crash cả server khi Postgres ngắt kết nối lúc rảnh",
      /pool\.on\(\s*["']error["']/.test(spg)
    );
  }
  testDk("Có .env.example", fs.existsSync(path.join(root, ".env.example")));

  // Pipeline 9 bước — kiểm tra ĐỦ 9 hàm b01-b09 đều tồn tại (không bị xoá/gộp
  // nhầm qua các lần sửa) VÀ cả 3 endpoint đọc AI đều gọi chayPipeline9Buoc —
  // tránh lặp lại lỗi cũ: PDF từng bị bỏ sót, không đi qua pipeline như 2
  // endpoint ảnh.
  ["b01_ingest", "b02_classify", "b03_extract", "b04_normalize", "b05_scale", "b06_geometry", "b07_relationship", "b08_takeoff", "b09_reconciliation"].forEach((b) =>
    testDk("server.js có hàm " + b, server.includes("function " + b))
  );
  const soLanGoiPipeline = (server.match(/chayPipeline9Buoc\(/g) || []).length;
  testDk("Cả 3 endpoint đọc AI (ảnh đơn/gộp/PDF) đều gọi pipeline", soLanGoiPipeline >= 4, `chỉ thấy ${soLanGoiPipeline} lần gọi (kỳ vọng ≥4: 1 định nghĩa + 3 endpoint)`);
  testDk("server.js có declared_scale (đọc tỷ lệ bản vẽ)", server.includes("declared_scale"));
  testDk("server.js có evidence_region (vị trí bằng chứng)", server.includes("evidence_region"));
  testDk("server.js có timeout cho fetch AI (chống treo vô thời hạn)", server.includes("AI_TIMEOUT_MS") || server.includes("AbortController"));

  // ĐÃ VÁ: cho phép dấu gạch ngang/gạch dưới trong phần khoá — khoá Anthropic
  // thật có dạng "sk-ant-api03-XXXX-XXXX-..." (có gạch ngang), regex gốc dùng
  // [a-zA-Z0-9]{10,} sẽ KHÔNG bắt được khoá thật bị lộ vì thiếu gạch ngang.
  testDk(
    "API key chỉ từ env (không hardcode)",
    server.includes("process.env.ANTHROPIC_API_KEY") && !/ANTHROPIC_API_KEY\s*=\s*["']sk-ant-[a-zA-Z0-9\-_]{10,}/.test(server)
  );
  testDk("Có giới hạn tốc độ gọi AI (rate limit)", server.includes("rateLimit") || server.includes("aiLimiter"));
  testDk("Không lưu ảnh base64 ra đĩa", !/writeFileSync\([^)]*base64/.test(server));

  const bundleSize = fs.statSync(path.join(root, "app.bundle.js")).size;
  testDk("Bundle > 100KB (app đầy đủ, không rỗng)", bundleSize > 100000, String(bundleSize));
  testDk("Bundle < 5MB (không bị lỗi phình to bất thường)", bundleSize < 5_000_000, String(bundleSize));

  if (fs.existsSync(path.join(root, "package.json"))) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    testDk("package.json có express", !!(pkg.dependencies && pkg.dependencies.express));
    testDk("package.json script start đúng", pkg.scripts && pkg.scripts.start === "node server.js");
  }
} else {
  console.log("ℹ Bỏ qua Phần B (test cấu trúc triển khai) — không chạy trong thư mục có đủ server.js/index.html/app.bundle.js. Phần A (logic) vẫn chạy đầy đủ ở trên.");
}

// ============================================================================
(async () => {
  // Chia PDF lớn (đồng bộ server.js) — Claude API giới hạn cứng 100 trang/request,
  // vượt quá THẤT BẠI HOÀN TOÀN — dùng pdf-lib (thuần JS, không cần Poppler/Docker).
  try {
    const { PDFDocument } = require("pdf-lib");
    const NGUONG_TRANG_AN_TOAN_TEST = 90;
    async function chiaPdfTest(base64) {
      const bytes = Buffer.from(base64, "base64");
      const src = await PDFDocument.load(bytes);
      const tongSoTrang = src.getPageCount();
      if (tongSoTrang <= NGUONG_TRANG_AN_TOAN_TEST) return { tongSoTrang, cacPhan: [{ base64, tuTrang: 1, denTrang: tongSoTrang }] };
      const cacPhan = [];
      for (let start = 0; start < tongSoTrang; start += NGUONG_TRANG_AN_TOAN_TEST) {
        const end = Math.min(start + NGUONG_TRANG_AN_TOAN_TEST, tongSoTrang);
        const newDoc = await PDFDocument.create();
        const indices = Array.from({ length: end - start }, (_, k) => start + k);
        const copied = await newDoc.copyPages(src, indices);
        copied.forEach((p) => newDoc.addPage(p));
        cacPhan.push({ base64: Buffer.from(await newDoc.save()).toString("base64"), tuTrang: start + 1, denTrang: end });
      }
      return { tongSoTrang, cacPhan };
    }
    async function taoPdfNTrang(n) {
      const doc = await PDFDocument.create();
      for (let i = 0; i < n; i++) doc.addPage([200, 200]);
      return Buffer.from(await doc.save()).toString("base64");
    }

    const pdf50 = await taoPdfNTrang(50);
    const kq50 = await chiaPdfTest(pdf50);
    test("Chia PDF: 50 trang (dưới ngưỡng) -> không chia, giữ nguyên", kq50.cacPhan.length, 1);
    test("Chia PDF: 50 trang -> base64 giữ nguyên gốc", kq50.cacPhan[0].base64 === pdf50, true);

    const pdf200 = await taoPdfNTrang(200);
    const kq200 = await chiaPdfTest(pdf200);
    test("Chia PDF: 200 trang (vượt ngưỡng) -> tự động chia", kq200.cacPhan.length > 1, true);
    test("Chia PDF: 200 trang -> mỗi phần đều ≤100 trang (đúng giới hạn Claude)", kq200.cacPhan.every((p) => p.denTrang - p.tuTrang + 1 <= 100), true);
    const tongTrangSauKhiChia = kq200.cacPhan.reduce((s, p) => s + (p.denTrang - p.tuTrang + 1), 0);
    test("Chia PDF: 200 trang -> tổng số trang các phần cộng lại = 200 (không mất/thừa trang)", tongTrangSauKhiChia, 200);
  } catch (e) {
    testDk("Chia PDF lớn (pdf-lib) — module tải và chạy được", false, e.message);
  }

  // Kiểm tra ảnh hợp lệ trước khi gọi AI (đồng bộ server.js) — phát hiện sớm
  // ảnh rỗng/hỏng/HEIC, tránh tốn tiền gọi Claude vô ích.
  function kiemTraAnhBase64Test(base64, mediaType) {
    if (!base64 || typeof base64 !== "string") return { ok: false, code: "missing" };
    let b64 = base64;
    const dataUrl = /^data:([^;]+);base64,(.*)$/i.exec(base64);
    if (dataUrl) { b64 = dataUrl[2]; if (!mediaType && dataUrl[1]) mediaType = dataUrl[1]; }
    b64 = b64.replace(/\s/g, "");
    if (b64.length < 64) return { ok: false, code: "too_short" };
    let buf;
    try { buf = Buffer.from(b64, "base64"); } catch { return { ok: false, code: "bad_base64" }; }
    if (buf.length < 100) return { ok: false, code: "too_small" };
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (!isPng && !isJpg) return { ok: false, code: "bad_magic" };
    return { ok: true, mediaType: mediaType || (isPng ? "image/png" : "image/jpeg"), bytes: buf.length, base64: b64 };
  }
  const pngThatTest = "iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAIAAACRXR/mAAAAS0lEQVR4nO3OsQEAEADAMPz/Mw9YMjE0F2Tu8aP1OnBXS9QStUQtUUvUErVELVFL1BK1RC1RS9QStUQtUUvUErVELVFL1BK1RC1xAEGqAWOFuDKrAAAAAElFTkSuQmCC"; // ảnh PNG thật 50x50, 132 byte
  testDk("Kiểm tra ảnh: PNG hợp lệ đủ lớn -> ok:true", kiemTraAnhBase64Test(pngThatTest, "image/png").ok === true);
  testDk("Kiểm tra ảnh: file giả (không phải ảnh) -> bad_magic", kiemTraAnhBase64Test(Buffer.from("day khong phai la anh, chi la mot chuoi van ban binh thuong duoc viet du dai de vuot qua nguong 100 byte kiem tra magic bytes trong ham").toString("base64")).code === "bad_magic");
  testDk("Kiểm tra ảnh: tự bóc tách data-URL prefix", kiemTraAnhBase64Test("data:image/png;base64," + pngThatTest).mediaType === "image/png");
  testDk("Kiểm tra ảnh: base64 quá ngắn -> too_short", kiemTraAnhBase64Test("abc").code === "too_short");
  testDk("Kiểm tra ảnh: thiếu hoàn toàn -> missing", kiemTraAnhBase64Test("").code === "missing");

  // So sánh mã truy cập constant-time (đồng bộ server.js) — chống timing attack
  function soSanhMaAnToanTest(a, b) {
    const crypto = require("crypto");
    const ba = Buffer.from(String(a || ""), "utf8");
    const bb = Buffer.from(String(b || ""), "utf8");
    if (ba.length !== bb.length) {
      crypto.timingSafeEqual(ba.length ? ba : Buffer.from("0"), ba.length ? ba : Buffer.from("0"));
      return false;
    }
    try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
  }
  testDk("So sánh mã: đúng -> true", soSanhMaAnToanTest("PTC001", "PTC001") === true);
  testDk("So sánh mã: sai cùng độ dài -> false", soSanhMaAnToanTest("PTC001", "PTC002") === false);
  testDk("So sánh mã: khác độ dài -> false, không throw", soSanhMaAnToanTest("PTC001", "A") === false);

  // Object-first Drawing Model (đồng bộ server.js) — object_ref TUỲ CHỌN cho
  // phép nhiều khối lượng khác loại công tác cùng tham chiếu 1 vật thể vật lý
  function xayDungDrawingModelTest(items) {
    const objectIdCuaItem = [];
    const nhomTheoRef = new Map();
    let demTuSinh = 0;
    items.forEach((it, i) => {
      const ref = it.object_ref && typeof it.object_ref === "string" ? it.object_ref.trim() : "";
      if (ref) { if (!nhomTheoRef.has(ref)) nhomTheoRef.set(ref, []); nhomTheoRef.get(ref).push(i); }
      else { demTuSinh++; objectIdCuaItem[i] = `OBJ-${String(demTuSinh).padStart(4, "0")}`; }
    });
    let demNhom = 0;
    nhomTheoRef.forEach((indices) => { demNhom++; const id = `OBJ-REF-${String(demNhom).padStart(4, "0")}`; indices.forEach((i) => { objectIdCuaItem[i] = id; }); });
    const objectMap = new Map();
    items.forEach((it, i) => {
      const id = objectIdCuaItem[i];
      if (!objectMap.has(id)) objectMap.set(id, { id, soLuongKhoiLuong: 0 });
      objectMap.get(id).soLuongKhoiLuong++;
    });
    const quantities = items.map((it, i) => ({ objectId: objectIdCuaItem[i] }));
    return { objects: Array.from(objectMap.values()), quantities };
  }
  const kqObj1 = xayDungDrawingModelTest([{ name: "A" }, { name: "B" }]);
  testDk("Object-first: không dùng object_ref -> mỗi item 1 object riêng (tương thích ngược)", kqObj1.objects.length === 2);
  const kqObj2 = xayDungDrawingModelTest([
    { name: "Xây tường", object_ref: "tuong_1" },
    { name: "Sơn tường", object_ref: "tuong_1" },
  ]);
  testDk("Object-first: 2 item CÙNG object_ref -> gom 1 object", kqObj2.objects.length === 1);
  testDk("Object-first: object gộp có soLuongKhoiLuong=2", kqObj2.objects[0].soLuongKhoiLuong === 2);
  testDk("Object-first: 2 quantities CÙNG objectId", kqObj2.quantities[0].objectId === kqObj2.quantities[1].objectId);

  // --- Bug thật tìm qua audit (đồng bộ server.js/vision-google.js) ---
  // 1. Polygon: lỗ mở HOÀN TOÀN bên trong tường -> phải TRỪ, không được CỘNG
  const polygonClipping2 = require("polygon-clipping");
  function dienTichShoelaceTest(vertices) {
    let s = 0;
    for (let i = 0; i < vertices.length - 1; i++) s += vertices[i][0] * vertices[i + 1][1] - vertices[i + 1][0] * vertices[i][1];
    return Math.abs(s) / 2;
  }
  function tinhDienTichPolygonTest(ngoai, loMo) {
    const ketQua = polygonClipping2.difference([ngoai], [loMo]);
    let dt = 0;
    ketQua.forEach((poly) => poly.forEach((ring, idx) => { const d = dienTichShoelaceTest(ring); dt += idx === 0 ? d : -d; }));
    return +dt.toFixed(4);
  }
  testDk("Polygon: lỗ mở hoàn toàn bên trong -> trừ đúng (94, không phải 106)",
    tinhDienTichPolygonTest([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 3], [6, 3], [6, 6], [4, 6], [4, 3]]) === 94);

  // 2. b07_relationship trả itemIndex (số thô), không phải objectId cố định
  function b07RelationshipTest2(items, ocrData) {
    if (!ocrData) return { relationships: [] };
    const relationships = [];
    const nhanTang = ocrData.items.filter((t) => /T[ẦA]NG\s*\d+/i.test(t.text || ""));
    items.forEach((it, idx) => {
      if (it.evidence_region && nhanTang.length) {
        const tangKhop = nhanTang.find((n) => Math.abs(n.evidence_region.y - it.evidence_region.y) < 0.2);
        if (tangKhop) relationships.push({ itemIndex: idx, target: tangKhop.text });
      }
    });
    return { relationships };
  }
  const rel2 = b07RelationshipTest2(
    [{ evidence_region: { x: 0.3, y: 0.12 } }],
    { items: [{ text: "TẦNG 2", evidence_region: { x: 0.05, y: 0.1 } }] }
  );
  testDk("Relationship: trả itemIndex số nguyên (map được sang object ID thật)", Number.isInteger(rel2.relationships[0]?.itemIndex));

  // 3. Khối lượng thiếu unit phải bị loại
  function locHopLeTest(danhSach) {
    return danhSach.filter((item) => {
      if (typeof item.name !== "string" || !item.name.trim()) return false;
      if (typeof item.unit !== "string" || !item.unit.trim()) return false;
      if (item.qty == null || !Number.isFinite(Number(item.qty)) || item.qty < 0) return false;
      return true;
    });
  }
  testDk("Filter: dòng thiếu unit bị loại", locHopLeTest([{ name: "Tường", qty: 50 }]).length === 0);
  testDk("Filter: dòng đủ unit vẫn qua", locHopLeTest([{ name: "Tường", unit: "m2", qty: 50 }]).length === 1);

  console.log("");
  console.log(`Tổng kết: ${soPass} PASS, ${soFail} FAIL`);
  if (soFail > 0) { console.log("❌ CÓ TEST THẤT BẠI — kiểm tra lại trước khi deploy!"); process.exit(1); }
  console.log("✅ TẤT CẢ TEST ĐỀU ĐẠT — an toàn để deploy.");
  process.exit(0);
})();
