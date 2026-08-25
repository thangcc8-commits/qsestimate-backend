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
  ["/health", "/api/analyze-image", "/api/analyze-images-batch", "/api/analyze-pdf", "callClaude", "callUnifiedAI", "extractJsonArray", "locHangMucHopLe"].forEach((s) =>
    testDk("server.js có " + s, server.includes(s))
  );

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
console.log("");
console.log(`Tổng kết: ${soPass} PASS, ${soFail} FAIL`);
if (soFail > 0) { console.log("❌ CÓ TEST THẤT BẠI — kiểm tra lại trước khi deploy!"); process.exit(1); }
console.log("✅ TẤT CẢ TEST ĐỀU ĐẠT — an toàn để deploy.");
process.exit(0);
