// ============================================================================
// zip-build.js — Tự Động Đóng Gói QsEstimateApp.zip
// ----------------------------------------------------------------------------
// SỬA LỖI: trước đây chỉ đóng gói 5 file lõi (package.json, server.js,
// index.html, app.bundle.js, .env.example) — THIẾU storage-postgres.js
// (server.js require() file này khi có DATABASE_URL, thiếu sẽ crash khi
// deploy có Postgres) và regression_test.js (cần cho CI). Giờ đóng gói đủ.
// ============================================================================
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

console.log("Kiểm tra các file bắt buộc...");
const requiredFiles = ["package.json", "server.js", "index.html", "app.bundle.js", ".env.example", "storage-postgres.js", "regression_test.js", "golden_dataset_test.js", "golden-dataset.json", "dxf-worker.js", "vision-google.js"];
const missing = requiredFiles.filter((f) => !fs.existsSync(path.join(__dirname, f)));

if (missing.length > 0) {
  console.error("❌ Thiếu các file:", missing.join(", "));
  process.exit(1);
}

// .gitignore là tuỳ chọn — không có cũng không chặn đóng gói (không phải file
// bắt buộc để app CHẠY được, chỉ cần khi commit lên Git).
const filesToZip = requiredFiles.concat(fs.existsSync(path.join(__dirname, ".gitignore")) ? [".gitignore"] : []);

const zipName = "QsEstimateApp.zip";
console.log("Đang tiến hành đóng gói tự động...");

try {
  if (process.platform === "win32") {
    const cmd = `powershell -Command "Compress-Archive -Path ${filesToZip.join(", ")} -DestinationPath ${zipName} -Force"`;
    execSync(cmd);
  } else {
    const cmd = `zip -r ${zipName} ${filesToZip.join(" ")}`;
    execSync(cmd);
  }
  console.log(`✅ ĐÃ ĐÓNG GÓI THÀNH CÔNG: ${zipName} (${filesToZip.length} file)`);
} catch (error) {
  console.error("❌ Lỗi đóng gói ZIP:", error.message);
  process.exit(1);
}
