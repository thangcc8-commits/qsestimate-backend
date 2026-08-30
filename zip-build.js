// ============================================================================
// zip-build.js — Tự Động Đóng Gói QsEstimateApp.zip
// ----------------------------------------------------------------------------
// SỬA LỖI (phát hiện qua chạy thử thật): trước đây thiếu hẳn
// .github/workflows/regression.yml (CI sẽ KHÔNG BAO GIỜ tự chạy nếu deploy
// bằng zip từ script này) và data/.gitkeep. Giờ đóng gói đủ 14 file, tự tạo
// data/.gitkeep nếu thư mục data/ chưa tồn tại (server chưa từng chạy lần nào).
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

// CI workflow — BẮT BUỘC để GitHub Actions tự chạy test mỗi lần push. Thiếu
// file này ở đúng đường dẫn .github/workflows/ nghĩa là CI sẽ không bao giờ
// kích hoạt, dù nội dung code đúng 100%.
const workflowPath = path.join(".github", "workflows", "regression.yml");
if (!fs.existsSync(path.join(__dirname, workflowPath))) {
  console.error(`❌ Thiếu ${workflowPath} — CI sẽ không tự chạy nếu thiếu file này. Dừng đóng gói.`);
  process.exit(1);
}

// data/.gitkeep — giữ thư mục data/ rỗng ban đầu trong Git (Git không lưu thư
// mục rỗng nếu không có ít nhất 1 file bên trong). Tự tạo nếu chưa có (VD lần
// đầu chạy script này, server chưa từng khởi động để tự tạo thư mục data/).
const dataDir = path.join(__dirname, "data");
const gitkeepPath = path.join("data", ".gitkeep");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(path.join(__dirname, gitkeepPath))) fs.writeFileSync(path.join(__dirname, gitkeepPath), "");

// .gitignore là tuỳ chọn — không có cũng không chặn đóng gói (không phải file
// bắt buộc để app CHẠY được, chỉ cần khi commit lên Git).
const filesToZip = requiredFiles
  .concat(fs.existsSync(path.join(__dirname, ".gitignore")) ? [".gitignore"] : [])
  .concat([workflowPath, gitkeepPath]);

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
