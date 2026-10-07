// ============================================================================
// golden_dataset_test.js — Kiểm tra ĐỘ CHÍNH XÁC THẬT (không phải logic công
// thức) — so sánh khối lượng app tự tính (AUTO) với khối lượng QS đã kiểm
// tra/nghiệm thu THẬT ngoài công trường (QS, xem golden-dataset.json).
//
// KHÁC VỚI regression_test.js: bộ đó chứng minh "công thức tính ĐÚNG với số
// đầu vào cho trước" (VD 5m×3m luôn ra 15m²) — bộ NÀY chứng minh "số đầu vào
// app ĐỌC RA TỪ BẢN VẼ THẬT có khớp với thực tế xây dựng hay không" — đây mới
// là bằng chứng thật cho bất kỳ tuyên bố "độ chính xác X%" nào.
//
// CI GATE: script này EXIT CODE khác 0 nếu có bất kỳ entry nào vượt ngưỡng
// dung sai — .github/workflows/regression.yml sẽ tự chặn build/deploy.
// ============================================================================
const fs = require("fs");
const path = require("path");

const duongDanDataset = path.join(__dirname, "golden-dataset.json");

function chay() {
  if (!fs.existsSync(duongDanDataset)) {
    console.error("❌ Không tìm thấy golden-dataset.json — không thể kiểm tra độ chính xác thật.");
    process.exit(1);
  }
  const dataset = JSON.parse(fs.readFileSync(duongDanDataset, "utf8"));
  const nguong = Number(dataset.toleranceMacDinh) || 0.05;
  const entries = Array.isArray(dataset.entries) ? dataset.entries : [];

  console.log("============================================================");
  console.log("GOLDEN DATASET — Đối chiếu khối lượng AUTO vs QS thật");
  console.log(`Ngưỡng dung sai: ${(nguong * 100).toFixed(1)}%`);
  console.log("============================================================\n");

  if (entries.length === 0) {
    console.log("⚠️  RỖNG — CHƯA CÓ DỮ LIỆU CÔNG TRÌNH THẬT NÀO trong golden-dataset.json.");
    console.log("    KHÔNG THỂ tuyên bố bất kỳ con số \"độ chính xác X%\" nào cho tới khi có");
    console.log("    dữ liệu thật. Thêm entry theo hướng dẫn trong file _README của dataset.");
    console.log("");
    console.log("Kết quả: BỎ QUA (không PASS, không FAIL — vì chưa có gì để kiểm tra).");
    process.exit(0); // Không chặn build vì rỗng — nhưng KHÔNG in "PASS" giả để tránh hiểu nhầm đã kiểm chứng
  }

  let soPass = 0, soFail = 0, tongSaiSo = 0;
  const ketQuaFail = [];

  entries.forEach((e) => {
    const auto = Number(e.auto), qs = Number(e.qs);
    if (!Number.isFinite(auto) || !Number.isFinite(qs) || qs === 0) {
      console.log(`${e.projectId || "?"} — ❌ DỮ LIỆU HỎNG (auto/qs không hợp lệ), coi như FAIL`);
      soFail++;
      ketQuaFail.push(e.projectId || "?");
      return;
    }
    const saiSo = Math.abs(auto - qs) / qs;
    const dat = saiSo <= nguong;
    tongSaiSo += saiSo;
    if (dat) soPass++; else { soFail++; ketQuaFail.push(e.projectId || "?"); }

    console.log(e.projectId || "(chưa đặt tên)");
    if (e.hangMuc) console.log(`  Hạng mục: ${e.hangMuc}`);
    console.log(`  AUTO = ${auto.toLocaleString("vi-VN")} ${e.unit || ""}`);
    console.log(`  QS   = ${qs.toLocaleString("vi-VN")} ${e.unit || ""}`);
    console.log(`  ERROR = ${(saiSo * 100).toFixed(2)}%`);
    console.log(`  ${dat ? "✅ PASS" : "❌ FAIL"}${e.nguon ? " | Nguồn: " + e.nguon : ""}`);
    console.log("");
  });

  const saiSoTrungBinh = tongSaiSo / entries.length;
  console.log("============================================================");
  console.log(`Tổng: ${entries.length} entry | ${soPass} PASS | ${soFail} FAIL`);
  console.log(`Sai số trung bình: ${(saiSoTrungBinh * 100).toFixed(2)}%`);
  console.log(`Độ chính xác trung bình đo được: ${((1 - saiSoTrungBinh) * 100).toFixed(2)}% (CHỈ tính trên ${entries.length} entry hiện có — KHÔNG suy rộng ra toàn bộ hệ thống nếu mẫu còn nhỏ)`);
  console.log("============================================================");

  if (soFail > 0) {
    console.error(`\n❌ CÓ ${soFail} PROJECT VƯỢT NGƯỠNG DUNG SAI (${ketQuaFail.join(", ")}) — CHẶN BUILD.`);
    process.exit(1);
  }
  console.log("\n✅ Tất cả entry trong ngưỡng dung sai.");
  process.exit(0);
}

chay();
