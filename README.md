# QsEstimateApp

Ứng dụng bóc khối lượng xây dựng (QS/BOQ) có AI hỗ trợ đọc bản vẽ — phát triển cho **PT CONS**.

> **Không phải "AI tự động 100%"** — đây là công cụ hỗ trợ QS tính toán nhanh hơn, với Engine tính
> khối lượng bằng công thức xác định (không phải AI tự bịa số), luôn cần QS kiểm tra/duyệt trước
> khi xuất bản chính thức.

## Tài liệu liên quan
- [`GO_LIVE.md`](./GO_LIVE.md) — hướng dẫn cài đặt/deploy chi tiết, biến môi trường, endpoint

## Tính năng chính

- **Đọc bản vẽ bằng AI** (Claude Vision, tuỳ chọn thêm Gemini/OpenAI) — ảnh, PDF (tự động chia
  nhỏ nếu >90 trang, tránh giới hạn cứng 100 trang/request của Claude API), DXF (đọc trực tiếp
  toạ độ CAD thật ở trình duyệt, không qua AI)
- **Engine tính khối lượng độc lập với AI** — AI chỉ báo cáo số đo/kích thước đọc được, mọi phép
  tính (diện tích tường trừ cửa, thể tích cột/dầm/móng/sàn) đều do app tự tính bằng công thức xác
  định. Đã kiểm chứng bằng test đối kháng: AI cố tình đưa số khối lượng giả vẫn bị bỏ qua hoàn toàn.
- **Polygon Boolean thật** cho diện tích tường có nhiều lỗ mở chồng lấn nhau (dùng thư viện hình
  học chuẩn, không phải trừ số học đơn giản)
- **Job Queue nền** cho công trình lớn (80–400 ảnh/trang) — retry tự động, theo dõi tiến độ, không
  mất dữ liệu nếu gián đoạn giữa chừng
- **Đối chiếu chéo tự động** — phát hiện chênh lệch số liệu giữa các nguồn khác nhau (VD bản vẽ vs
  bảng thống kê) mà không cần AI tự viết cảnh báo
- **Golden Dataset** — so sánh khối lượng app tự tính với số liệu đã nghiệm thu thật ngoài công
  trường, chạy tự động trong CI, chặn build nếu có sai số vượt ngưỡng
- **Bảo mật**: xác thực constant-time (chống dò mã truy cập qua thời gian phản hồi), CSRF
  protection, rate limit, kiểm tra ảnh hợp lệ trước khi tốn phí gọi AI

## Giới hạn thật — không phóng đại

- **Quan hệ không gian giữa các cấu kiện (Cột↔Tầng...) cho ảnh/PDF chỉ là gợi ý tham khảo**, không
  phải kết luận chắc chắn — vì AI Vision không cho toạ độ pixel chính xác tuyệt đối. Luôn báo trạng
  thái `partial`, không bao giờ `done`.
- Golden Dataset hiện có **3 điểm dữ liệu thật** (2 công trình) — đủ để có tín hiệu ban đầu, **chưa
  đủ để tuyên bố % chính xác cho toàn hệ thống**. Cần tiếp tục bổ sung.
- Đọc bản vẽ kiến trúc không tự suy ra được dữ liệu kết cấu (dầm/sàn/móng) nếu bản vẽ đó không có —
  các hạng mục này thường nằm ở bộ bản vẽ kết cấu riêng.

## Kiến trúc — pipeline 9 bước

```
01 Ingest → 02 Classify → 03 Extract (AI) → 04 Normalize (Engine tính qty)
→ 05 Scale → 06 Geometry → 07 Relationship → 08 Takeoff → 09 Reconciliation
```

Mỗi bước tự báo cáo trạng thái thật (`done` / `partial` / `blocked` / `review`) — không có bước
nào báo "done" nếu chưa thực sự tính toán được điều đó.

## Cấu trúc thư mục

```
server.js               Backend chính — 27 endpoint, pipeline 9 bước, Engine tính khối lượng
storage-postgres.js      Lớp lưu trữ Postgres (tuỳ chọn — mặc định dùng file JSON)
vision-google.js         Google Vision OCR (bổ sung, không thay Claude) — cache, batch, timeout
dxf-worker.js            Web Worker đọc file DXF trực tiếp ở trình duyệt (toạ độ CAD thật)
app.bundle.js            Frontend đã build (React, qua esbuild)
index.html               Trang HTML gốc
regression_test.js       129 test logic — chạy `node regression_test.js`
golden_dataset_test.js   Đối chiếu độ chính xác thật — chạy `node golden_dataset_test.js`
golden-dataset.json      Dữ liệu công trình đã nghiệm thu thật, dùng cho test ở trên
zip-build.js             Đóng gói toàn bộ file cần thiết thành 1 file zip deploy
.github/workflows/       CI tự động chạy test mỗi lần push/PR vào main
```

## Cài đặt nhanh

```bash
cp .env.example .env   # điền ANTHROPIC_API_KEY thật
npm install
npm test                # 129 test logic + Golden Dataset
npm run dev             # chạy local (đọc .env)
```

Chi tiết đầy đủ (deploy Render, biến môi trường, bảng so sánh nguồn đọc bản vẽ) xem
[`GO_LIVE.md`](./GO_LIVE.md).

## Công ty
**PT CONS** — 37 Nguyễn Bỉnh Khiêm, P.Hạnh Thông, TP.HCM
