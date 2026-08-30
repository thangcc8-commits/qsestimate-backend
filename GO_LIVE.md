# QsEstimateApp v1.2.2 — Go-live

## Chạy (máy cá nhân/local)
```bash
cp .env.example .env   # điền ANTHROPIC_API_KEY thật vào file .env
npm install && npm test && npm run dev
```
**Lưu ý quan trọng:** dùng `npm run dev` (không phải `npm start`) khi chạy local — script `start`
(`node server.js`) **không tự đọc file `.env`**, chỉ `dev` (`node --env-file=.env server.js`) mới
đọc. Dùng nhầm `npm start` local sẽ thấy server chạy nhưng `/health` báo `hasApiKey: false` dù đã
điền key — đã kiểm chứng bằng test thật.

## Render
Build `npm install` · Start `npm start`
(Trên Render, biến môi trường đặt qua **Environment** trên dashboard — Render tự nạp vào
`process.env`, không đọc file `.env`, nên `npm start` hoạt động đúng trên Render dù không đúng khi
chạy local theo cách trên.)

**Bắt buộc:** `ANTHROPIC_API_KEY` — thiếu thì server vẫn khởi động nhưng mọi tính năng đọc bản vẽ sẽ lỗi.
**Khuyến nghị đặt:** `ALLOWED_ORIGIN` (mặc định `*` nếu không đặt — hoạt động được, nhưng khoá đúng
domain thật sẽ tự kích hoạt thêm lớp CSRF chặn request ghi từ Origin lạ).
**Tuỳ chọn:** `DATABASE_URL` (Postgres), `GOOGLE_VISION_API_KEY` + `VISION_WITH_ANALYZE=1` (OCR bổ
sung tự động, tính phí riêng Google), `ACCESS_CODES`, `ADMIN_CODE`, `RATE_LIMIT_GENERAL_MAX`
(mặc định 300 request/15 phút cho toàn bộ `/api/*`).

## Nguồn đọc bản vẽ
| Nguồn | Endpoint / worker | Độ tin KL |
|-------|-------------------|-----------|
| Claude Vision (ảnh/PDF) | `/api/analyze-*` | Công thức app tự tính từ `formula_inputs` — AI không quyết định qty |
| PDF >90 trang | `/api/analyze-pdf` (tự động) | Claude API giới hạn cứng 100 trang/request — app tự chia nhỏ thành job nền, gộp kết quả, không cần thao tác gì thêm |
| Google Vision OCR | `/api/ocr-vision` | Chỉ evidence + số đo gợi ý — không tính/ghi đè qty nào. Có cache RAM (2 giờ) — xem `/api/ocr-vision/cache-stats` |
| DXF | `/dxf-worker.js` (client) | Toạ độ CAD thật |

## An toàn trước khi gọi AI
- Ảnh được kiểm tra hợp lệ (định dạng thật, không rỗng/hỏng/HEIC) trước khi tốn phí gọi Claude
- Đăng nhập dùng so sánh constant-time (chống dò mã truy cập qua thời gian phản hồi)
- Rate limit riêng cho AI (60 lượt/15 phút) + rate limit chung toàn `/api/*` (300 lượt/15 phút)

## Golden Dataset — đo độ chính xác thật
Hiện có **3 entry thật** từ 2 công trình đã nghiệm thu (Nhà phố Gò Vấp, Shophouse Thủ Đức) —
sai số trung bình đo được **1.33%**. Đây chỉ là khởi đầu, chưa đủ để kết luận cho toàn hệ thống —
cần tiếp tục bổ sung công trình mới vào `golden-dataset.json` mỗi khi có dự án nghiệm thu xong.
CI (`.github/workflows/regression.yml`) tự chạy `golden_dataset_test.js` mỗi lần push — nếu 1
project lệch quá ngưỡng dung sai (mặc định 5%), build tự động bị chặn.

## Không phải auto 100%
QS Review vẫn bắt buộc trước khi xuất bản chính thức.
