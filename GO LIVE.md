# QsEstimateApp v1.2.1 — Go-live

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
**Khuyến nghị đặt:** `ALLOWED_ORIGIN` (mặc định `*` nếu không đặt — hoạt động được nhưng kém an toàn hơn, nên đổi thành đúng domain app khi deploy thật).
**Tuỳ chọn:** `DATABASE_URL`, `GOOGLE_VISION_API_KEY`, `ACCESS_CODES`, `ADMIN_CODE`.

## Nguồn đọc bản vẽ
| Nguồn | Endpoint / worker | Độ tin KL |
|-------|-------------------|-----------|
| Claude Vision | `/api/analyze-*` | Công thức app tự tính từ `formula_inputs` — AI không quyết định qty |
| Google Vision OCR | `/api/ocr-vision` | Chỉ evidence + số đo gợi ý — không tính/ghi đè qty nào |
| DXF | `/dxf-worker.js` (client) | Toạ độ CAD thật |

## Không phải auto 100%
QS Review vẫn bắt buộc trước khi xuất bản chính thức.
