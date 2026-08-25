// zip-build.js
const fs = require("fs");
const path = require("path");

console.log("Đang kiểm tra các file dự án trước khi tạo Zip...");

// SỬA: thêm ".env.example" vào danh sách kiểm tra — trước đây chỉ kiểm tra 4
// file nhưng lệnh zip in ra lại có 5 file (kèm .env.example). Nếu thiếu đúng
// .env.example, script CŨ vẫn báo "sẵn sàng" (exit code 0), người dùng chạy
// lệnh zip theo hướng dẫn thì zip vẫn tạo ra nhưng ÂM THẦM THIẾU file đó (chỉ
// có 1 dòng "zip warning: name not matched" dễ bị bỏ sót) — đã kiểm chứng lỗi
// này bằng cách tự tạo tình huống thiếu file rồi chạy thử.
const requiredFiles = ["package.json", "server.js", "index.html", "app.bundle.js", ".env.example"];
let missing = requiredFiles.filter((f) => !fs.existsSync(path.join(__dirname, f)));

if (missing.length > 0) {
  console.error("Thiếu các file sau để đóng gói:", missing.join(", "));
  process.exit(1);
}

console.log("Tất cả file cốt lõi đã sẵn sàng.");
console.log("Vui lòng thực thi lệnh nén hệ điều hành tương ứng:");
console.log("Windows (PowerShell): Compress-Archive -Path package.json, server.js, index.html, app.bundle.js, .env.example -DestinationPath QsEstimateApp.zip");
console.log("Linux/macOS: zip -r QsEstimateApp.zip package.json server.js index.html app.bundle.js .env.example");
