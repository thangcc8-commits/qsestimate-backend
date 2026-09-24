# Chẩn đoán cấu trúc QsEstimateApp — KHÔNG cần build app mới

## Kết luận
**Không rebuild từ đầu.** Kiến trúc (pipeline 9 bước, job nền, DXF worker, BOQ engine) ổn.
Lỗi "không đọc được bản vẽ" là **vài điểm cụ thể**, không phải app hỏng toàn bộ.

## 3 lỗi thật khiến không đọc được bản vẽ

| # | Lỗi | Hệ quả | Đã sửa trong zip này? |
|---|-----|--------|------------------------|
| 1 | `storage-postgres.js` vẫn `JSON.stringify` vào cột JSONB | Job ghi chậm/lệch kiểu; Postgres phình; dễ treo khi PDF lớn | **CÓ** — bỏ stringify |
| 2 | `xuLyJobPdfLon` **mất Files API** (chỉ gửi base64) | PDF >~3MB dễ đụng trần 32MB Anthropic / chậm / lỗi | **CÓ** — khôi phục Files API |
| 3 | Race: trả `jobId` ngay nhưng status đọc DB trước khi ghi lần đầu | Poll sớm → 404 tạm (frontend thường retry) | **CÓ** — `jobMemCache` RAM |

## Việc KHÔNG phải lỗi code (đừng rebuild vì những cái này)

| Triệu chứng | Nguyên nhân thật |
|-------------|------------------|
| BOQ = **0 đồng** | `PRICE_MISSING` — chưa có đơn giá định mức cho nhóm dự án |
| Xuất ≠ mẫu Sun Grand 9 sheet | App xuất form 4 sheet + 9 sheet BOQ_V* theo engine, khác file mẫu tay |
| Tính tiền Anthropic khi "treo" | Request đã gửi API = đã tính; timeout phía app không hoàn tiền |
| Progress kẹt ~90–95% lâu | Frontend `Math.min(95, …)` + Claude 3–20 phút/lô là bình thường |
| DXF thiếu MEP/móng | Bản vẽ DXF không có dữ liệu đó — không phải bug parser |

## File CẦN giữ (deploy)

```
server.js              # backend — bản đã vá trong artifacts/
storage-postgres.js    # JSONB đúng — bản đã vá trong artifacts/
index.html
app.bundle.js          # frontend (minified)
package.json
dxf-worker.js
vision-google.js
pdf-ocr.js
sw.js / manifest.json / icon-*.png   # PWA (tuỳ chọn)
golden-dataset.json + *_test.js + regression.yml  # CI (tuỳ chọn)
GO_LIVE.md / README.md
```

## File / bản THỪA — bỏ khỏi repo deploy

| Tên | Lý do bỏ |
|-----|----------|
| `app_bundle.js` (underscore) | Trùng `app.bundle.js`, bản cũ hơn |
| `regression test.js` (có dấu cách) | Trùng `regression_test.js` |
| `regression.yaml` | Trùng `regression.yml` (dùng file trong `.github/workflows/`) |
| `GO LIVE.md` | Trùng `GO_LIVE.md` |
| Ảnh/screenshot UUID (`05CA983A-…`, `3F40A5E0-…`) | Tài liệu chat, không phải runtime |
| `Pasted Text.txt`, `BOQ AutoEngine SPEC.md` | Spec tham khảo — không cần trên Render |
| `Prompt_Chuan_…`, `DuToanMauThamChieu…` | Tài liệu QS, không phải code chạy |

## Cách deploy bản vá (Render)

1. Thay **2 file**: `server.js` + `storage-postgres.js` (trong zip artifacts).
2. Redeploy → hard refresh app (Ctrl+Shift+R / xoá cache Safari).
3. Thử **1** PDF, **đợi** job xong — không bấm đọc lại khi còn 90%.
4. Muốn có tiền BOQ: vào app nhập/import **đơn giá định mức** đúng nhóm.

## Không làm
- Không viết lại React/bundle từ đầu (mất thời gian, không giải quyết 3 lỗi trên).
- Không bỏ job queue / không quay lại gọi AI 1 kết nối HTTP dài (dễ treo mạng).
