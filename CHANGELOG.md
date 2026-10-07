# QS Estimate App — Tổng hợp toàn bộ sửa lỗi & tính năng bổ sung

> Nguồn: `QsEstimateApp.txt` (source) + `app.bundle.js` (bundle production)  
> Ngày rà soát: 2026-10-02  
> Backend: `https://qsestimate-backend-1.onrender.com`

---

## Mục lục

1. [Sửa lỗi CRITICAL](#1-sửa-lỗi-critical)
2. [Sửa lỗi tính toán BOQ & định mức](#2-sửa-lỗi-tính-toán-boq--định-mức)
3. [Sửa lỗi đọc bản vẽ / AI](#3-sửa-lỗi-đọc-bản-vẽ--ai)
4. [Sửa lỗi xuất Excel / PDF](#4-sửa-lỗi-xuất-excel--pdf)
5. [Sửa lỗi giao diện & UX](#5-sửa-lỗi-giao-diện--ux)
6. [Tính năng mới (THÊM MỚI)](#6-tính-năng-mới-thêm-mới)
7. [Sửa trong dữ liệu tham chiếu (Assumptions)](#7-sửa-trong-dữ-liệu-tham-chiếu-assumptions)
8. [Checklist kiểm thử](#8-checklist-kiểm-thử)

---

## 1. Sửa lỗi CRITICAL

### 1.1. Lỗi lưu 100% — `authHeaders` ngoài phạm vi

| | |
|---|---|
| **Triệu chứng** | Nút Lưu luôn báo đỏ “Lỗi lưu”; console: `Can't find variable: authHeaders` |
| **Nguyên nhân** | `appStorage.set()` chạy ở **module scope** (khi file vừa tải), nhưng gọi `authHeaders()` — hàm chỉ tồn tại **bên trong** component chính (qua `useCallback`) → không thể truy cập |
| **Sửa** | Thêm `layAuthHeaderModule()` đọc thẳng `qs_access_code` từ `localStorage`; dùng trong `appStorage.get/set` |
| **Vị trí** | ~dòng 56–100 |

### 1.2. Lỗi lưu — không hiện lý do thật từ server

| | |
|---|---|
| **Triệu chứng** | “Lỗi lưu” đỏ nhưng không biết vì sao |
| **Nguyên nhân** | Chỉ đọc `r.ok`, vứt bỏ body JSON chứa `error.message` |
| **Sửa** | Khi `!r.ok`, parse JSON, ghi `window.__qsLastSaveError = lyDo` để UI hiển thị |
| **Vị trí** | ~dòng 91–105 |

### 1.3. Crash tab “Đọc bản vẽ” — biến `BG` chưa khai báo

| | |
|---|---|
| **Mức** | **CRITICAL** |
| **Triệu chứng** | Có ≥1 lượt trong lịch sử đọc bản vẽ → `ReferenceError`, crash cả tab |
| **Nguyên nhân** | Biến `BG` dùng ở khung “Lịch sử đọc bản vẽ” nhưng **chưa từng được khai báo** |
| **Sửa** | `const BG = "#F6F3EC"` (cùng màu `PAPER`) |
| **Vị trí** | ~dòng 134–138 |

### 1.4. Treo 90% trên mạng di động — `fetch` không timeout

| | |
|---|---|
| **Triệu chứng** | Tiến độ kẹt ~90%, bấm lại vẫn treo vô hạn |
| **Nguyên nhân** | `fetch()` không có timeout mặc định; kết nối rớt âm thầm → promise chờ mãi |
| **Sửa** | `fetchCoTimeout(url, options, timeoutMs)` bọc `AbortController`; dùng cho mọi gọi backend (analyze, poll job, result) |
| **Timeout** | Mặc định 20s; poll status 15s; result 20s |
| **Vị trí** | ~dòng 150–165 |

### 1.5. ErrorBoundary bao root

| | |
|---|---|
| **Triệu chứng** | Lỗi JS bất ngờ → màn hình trắng, mất context |
| **Sửa** | Class `ErrorBoundary` bắt lỗi, hiện message + nút “Tải lại trang”; dữ liệu server vẫn an toàn |
| **Vị trí** | Cuối file (bundle: class `cw`) |

---

## 2. Sửa lỗi tính toán BOQ & định mức

### 2.1. Dòng BOQ “biến mất” khi thiếu định mức

| | |
|---|---|
| **Triệu chứng** | User tưởng “mất hết” BOQ |
| **Nguyên nhân** | `computeBoqLine` trả `null` khi thiếu `norm` → `boqLines` lọc bỏ dòng |
| **Sửa** | Trả object `trangThai: "QC_MISSING"`, giá 0; dòng vẫn hiện, có cờ cảnh báo, vẫn đếm ở khối QC |
| **Vị trí** | ~dòng 477–495 |

### 2.2. Định mức trọn gói nhầm thành PRICE_MISSING

| | |
|---|---|
| **Triệu chứng** | Định mức PTC (vt/nc/may rỗng) luôn báo thiếu giá dù đã có ĐG khoán |
| **Nguyên nhân** | `analyzed.total` luôn = 0 với trọn gói → rơi vào `PRICE_MISSING` như định mức thường |
| **Sửa** | Tách trạng thái `LUMP_SUM_MISSING` khi `laTronGoi && donGiaKhoan <= 0` |
| **Vị trí** | ~dòng 500–530 |

### 2.3. So khớp tên công tác đối nghịch

| | |
|---|---|
| **Triệu chứng** | “Lắp cửa đi” tự khớp “Tháo cửa đi” (similarity 0.75 > ngưỡng 0.3) |
| **Sửa** | Danh sách cặp từ đối nghịch (`xây`/`đục`, `lắp`/`tháo`…); `coTuDoiNghich()` → `similarity = 0` trước khi tính điểm |
| **Vị trí** | ~dòng 540–580 |

### 2.4. Dự toán mẫu vs Định mức gốc lệch tên

| | |
|---|---|
| **Triệu chứng** | QS lập mẫu kỹ nhưng mất đơn giá / lệch tên |
| **Nguyên nhân** | `estimate_templates` và `projectNorms` duy trì độc lập; textarea gõ tự do không đảm bảo trùng database |
| **Sửa** | Ràng buộc chọn tên từ database định mức; AI dùng tên nguyên văn đã khớp |
| **Vị trí** | ~dòng 566, 5438 |

### 2.5. Hệ số mẫu — nhân thay vì cộng/trừ sai

| | |
|---|---|
| **Triệu chứng** | Khối lượng từ mẫu sai khi scale theo GFA |
| **Sửa** | Dùng **nhân** hệ số (ratio) thay vì cộng/trừ số cứng |
| **Vị trí** | ~dòng 603 |

### 2.6. Hao hụt vật tư dính sang dòng sau

| | |
|---|---|
| **Triệu chứng** | Vật tư mới kế tiếp bị dính `wastagePct` của vật tư trước |
| **Sửa** | Reset `wastagePct: 0` khi tạo/reset form vật tư |
| **Vị trí** | ~dòng 5952 |

### 2.7. Nguồn sự thật trạng thái dòng BOQ

| | |
|---|---|
| **Sửa** | UI dùng `calc.trangThai` (từ engine) thay vì `boq.trangThai` rời rạc → thống nhất QC / PRICE / LUMP / CONFIRMED |
| **Vị trí** | ~dòng 6565 |

---

## 3. Sửa lỗi đọc bản vẽ / AI

### 3.1. Poll job PDF — thoát sớm khi status lạ

| | |
|---|---|
| **Triệu chứng** | PDF lớn tốn tiền nhưng mất kết quả |
| **Nguyên nhân** | Chỉ kiểm tra `dataStatus` tồn tại; `trangThaiTong === undefined` → tưởng job xong → gọi `/result` sớm |
| **Sửa** | Chỉ xử lý khi `typeof dataStatus.trangThaiTong === "string"`; ngược lại `continue` |
| **Vị trí** | ~dòng 1975–1985 |

### 3.2. Trần file PDF quá thấp (22MB)

| | |
|---|---|
| **Sửa** | `HARD_MAX = 40MB` (đã có Files API + express.json 60mb; base64 ~54.8MB vẫn dưới trần) |
| **Vị trí** | ~dòng 1996 |

### 3.3. Progress PDF vs ảnh không đồng bộ

| | |
|---|---|
| **Sửa** | `setPdfAiProgress(0)` và `setAiProgress(0)` — cả hai khởi đầu từ 0 |
| **Vị trí** | ~dòng 2011, 2556 |

### 3.4. Nhánh “chế độ tạm” gọi Anthropic trực tiếp (Bug 1+8)

| | |
|---|---|
| **Triệu chứng** | Crash `ReferenceError` (biến `base64`/`mediaType` chưa khai báo) + thiếu header + CORS |
| **Sửa** | Xóa nhánh; ném lỗi rõ: “Chưa cấu hình BACKEND_URL…” |
| **Vị trí** | ~dòng 2118–2133 |

### 3.5. Một hạng mục lỗi làm mất cả batch BOQ

| | |
|---|---|
| **Triệu chứng** | AI đọc được N hạng mục nhưng BOQ = 0 dòng, Bước 2 rỗng |
| **Nguyên nhân** | Xử lý cả loạt trong 1 `.map()`; 1 phần tử ném lỗi → cả batch mất |
| **Sửa** | Xử lý từng hạng mục riêng; lỗi 1 dòng không nuốt các dòng khác |
| **Vị trí** | ~dòng 2133+ |

### 3.6. Cảnh báo đối chiếu chỉ đếm rồi bỏ

| | |
|---|---|
| **Sửa** | Lưu `canhBaoDoiChieu` vào state (kèm `sourcePhoto`, `projectId`) và hiển thị UI |
| **Vị trí** | ~dòng 2110 |

### 3.7. Ảnh đơn lẻ vượt giới hạn nhóm

| | |
|---|---|
| **Sửa** | Cảnh báo ngay khi 1 ảnh vượt `GIOI_HAN_NHOM`; vẫn gửi thử nhưng user biết rủi ro HTTP 413 |
| **Vị trí** | ~dòng 4333 |

### 3.8. Fetch analyze ảnh không timeout

| | |
|---|---|
| **Sửa** | Đổi từ `fetch()` thường sang `fetchCoTimeout()` (đồng bộ với PDF) |
| **Vị trí** | ~dòng 2573–2581 |

### 3.9. Job map — ghi đè 1 key duy nhất

| | |
|---|---|
| **Sửa** | Ghi vào map nhiều job (không chỉ 1 key) để không mất job đang chạy khi đọc file khác |
| **Vị trí** | ~dòng 2076 |

### 3.10. Nhầm `setAiProgress` / `setPdfAiProgress`

| | |
|---|---|
| **Sửa** | Dùng đúng setter theo luồng PDF vs ảnh |
| **Vị trí** | ~dòng 2087 |

### 3.11. Chi phí AI không hiển thị / mất tiền không rõ

| | |
|---|---|
| **Sửa** | `ghiNhanChiPhi(data.cost)`; UI hiện chi phí USD; log pipelineTrace |
| **Vị trí** | Nhiều điểm ~973, 2098, 4492 |

### 3.12. Ảnh/PDF mất khi rời tab (Bug 3)

| | |
|---|---|
| **Sửa** | Giữ state ảnh/PDF; thẻ khôi phục dữ liệu đã đọc |
| **Vị trí** | ~dòng 4362, 4374, 2920 |

### 3.13. Thiếu `projectId` khi lưu kết quả đọc

| | |
|---|---|
| **Sửa** | Gắn `projectId` vào bản ghi lịch sử / cảnh báo để lọc đúng dự án |
| **Vị trí** | ~dòng 2955 |

---

## 4. Sửa lỗi xuất Excel / PDF

### 4.1. Cột tổng nhóm BOQ in lệch (colSpan)

| | |
|---|---|
| **Triệu chứng** | Tổng tiền rơi vào cột “Tiêu chuẩn” thay vì “Thành tiền” |
| **Nguyên nhân** | `colSpan={7}` chiếm cột 1–7; ô tiền thành cột 8 |
| **Sửa** | `colSpan={6}` + ô tiền + ô trống → đúng 8 cột |
| **Vị trí** | ~dòng 7023–7032 |

### 4.2. Panel chẩn đoán chỉ hiện khi mất hết dòng

| | |
|---|---|
| **Triệu chứng** | Mất 8/10 dòng nhưng panel không hiện (vì `soHienThi === 0` cũ) |
| **Sửa** | Điều kiện `soHienThi < soThoTrongDuAn`; liệt kê `normId` thiếu |
| **Vị trí** | ~dòng 7139 |

### 4.3. Excel — `norm.group` (số ít) không tồn tại

| | |
|---|---|
| **Sửa** | Dùng `norm.groups` (mảng) đúng schema seed |
| **Vị trí** | ~dòng 3186 |

### 4.4. Excel — vật tư/nhân công đã xoá vẫn ghi công thức

| | |
|---|---|
| **Sửa** | Kiểm tra tồn tại trước khi ghi tham chiếu sheet DonGia / PhanTich |
| **Vị trí** | ~dòng 3261, 3305 |

### 4.5. Excel — STT sai (`stt++` trả giá trị cũ)

| | |
|---|---|
| **Sửa** | Tăng STT đúng thứ tự trước khi ghi ô |
| **Vị trí** | ~dòng 3357 |

### 4.6. Excel — index sheet âm nếu thứ tự append đổi

| | |
|---|---|
| **Sửa** | Phòng thủ khi `indexOf("BOQ") === -1` |
| **Vị trí** | ~dòng 3660 |

### 4.7. Revoke ObjectURL có thể ném lỗi

| | |
|---|---|
| **Sửa** | `try/catch` quanh `URL.revokeObjectURL` |
| **Vị trí** | ~dòng ~2890 |

### 4.8. Báo “đã thêm” dù không thêm được

| | |
|---|---|
| **Sửa** | Chỉ toast thành công khi thao tác thực sự thành công |
| **Vị trí** | ~dòng 2896 |

### 4.9. Shadow tên hàm khi xuất

| | |
|---|---|
| **Sửa** | Đổi tên biến cục bộ không che hàm module cùng tên |
| **Vị trí** | ~dòng 3022 |

---

## 5. Sửa lỗi giao diện & UX

### 5.1. Nút “Duyệt tất cả” gây hiểu nhầm

| | |
|---|---|
| **Sửa** | Đổi tên / wording rõ hơn (duyệt hàng loạt ≠ đã kiểm tra kỹ thuật) |
| **Vị trí** | ~dòng 4919 |

### 5.2. Khung “xem chi tiết” bằng chứng

| | |
|---|---|
| **Sửa** | EvidenceViewerModal + region chuẩn hoá 0–1; không dùng để đo đạc |
| **Vị trí** | ~dòng 4511 |

### 5.3. Bỏ mẫu dựng sẵn gây nhầm

| | |
|---|---|
| **Sửa** | `SEED_TEMPLATES = {}` — không còn “Nhà phố mặc định” / “Shophouse mặc định” hiện sẵn |
| **Ghi chú** | User tự tạo mẫu hoặc nhập Excel |

---

## 6. Tính năng mới (THÊM MỚI)

| # | Tính năng | Mô tả ngắn |
|---|-----------|------------|
| 1 | **LUMP_SUM_MISSING** | Trạng thái riêng cho định mức khoán trọn gói chưa nhập ĐG |
| 2 | **Chặn xuất CHÍNH THỨC** | Khoá khi còn QC / PRICE / LUMP / giá mượn; bản NHÁP luôn được |
| 3 | **Cảnh báo tổng = 0đ** | Có dòng BOQ nhưng `truc_tiep === 0` → cảnh báo xuất nhầm |
| 4 | **Đếm LUMP khi xuất** | `soLumpMissing` trong ExportHub |
| 5 | **Thẻ lưu / khôi phục dữ liệu đã đọc** | Không mất kết quả AI khi rời tab |
| 6 | **Chuyển dự án ngay tại tab Đọc bản vẽ** | Không cần rời tab |
| 7 | **Hiển thị chi phí USD** | Chi phí gọi AI hiện trên màn hình |
| 8 | **Xuất 9 sheet BOQ_V1.1 → V4.1** | Đúng form chuẩn công ty (R1-25) |
| 9 | **Tách bản NHÁP / CHÍNH THỨC** | Ở tầng hàm `exportExcel("draft" \| "official")` |
| 10 | **Báo cáo nội bộ giá vốn & LN** | File Excel riêng, không gửi khách |
| 11 | **Đo trên ảnh (scale calibration)** | QS tự hiệu chỉnh tỷ lệ pixel → mét |
| 12 | **Tính diện tích tường** | `wallNetArea` + đối chiếu AI vs công thức |
| 13 | **Revision snapshot BOQ** | Chốt phiên bản, so sánh thêm/bớt/đổi |
| 14 | **Lớp bảo vệ client độc lập server** | Validate thêm phía trình duyệt |

---

## 7. Sửa trong dữ liệu tham chiếu (Assumptions)

Các mục trong `SEED_DU_TOAN_MAU_MAC_DINH` (không phải code runtime, nhưng ảnh hưởng AI/prompt):

| Mã | Nội dung sửa |
|----|----------------|
| **A29** | Diện tích phòng T2–T5 = 23,90 m² theo nhãn bản vẽ (không suy luận tỷ lệ hành lang → lệch ~57 m²) |
| **A54** | Số phòng = **10** (không phải 5); chi tiết WC theo tầng |
| **A58** | Shophouse: CĐT đã hoàn thiện mặt **ngoài** tường bao — nhà thầu chỉ tô mặt trong + xây/tô tường ngăn nội bộ |

---

## 8. Checklist kiểm thử

### CRITICAL

- [ ] Lưu dự án với access code → thành công; nếu lỗi → thấy message server cụ thể
- [ ] Tab Đọc bản vẽ có ≥1 lịch sử → **không crash**
- [ ] Cắt mạng giữa chừng khi đọc PDF/ảnh → hết treo vô hạn, có message timeout
- [ ] Lỗi JS giả lập → ErrorBoundary hiện, nút tải lại hoạt động

### BOQ / định mức

- [ ] Dòng trỏ định mức đã xoá → vẫn hiện, `QC_MISSING`, xuất official bị khoá
- [ ] Định mức PTC trọn gói không nhập ĐG → `LUMP_SUM_MISSING` (không nhầm PRICE)
- [ ] “Xây tường” không tự khớp “Đục tường”
- [ ] Vật tư mới không dính `wastagePct` của dòng trước

### Đọc bản vẽ

- [ ] PDF > 22MB và < 40MB → vẫn gửi được (Files API)
- [ ] 1 hạng mục lỗi trong batch → các hạng mục khác vẫn vào BOQ
- [ ] Cảnh báo đối chiếu hiện trên UI
- [ ] Chi phí USD hiện sau mỗi lần đọc
- [ ] Rời tab rồi quay lại → dữ liệu đã đọc còn / có thể khôi phục

### Xuất file

- [ ] In / PDF preview → tổng nhóm đúng cột “Thành tiền”
- [ ] Mất một phần dòng (norm thiếu) → panel chẩn đoán hiện + liệt kê mã
- [ ] Có dòng nhưng tổng 0đ → cảnh báo vàng
- [ ] Xuất NHÁP luôn được; CHÍNH THỨC khoá khi còn lỗi QC
- [ ] Excel có công thức liên kết DonGia → PhanTich → BOQ → TongHop
- [ ] 9 sheet BOQ_V1.1…V4.1 có trong file official

---

## Ghi chú triển khai

1. Source: `QsEstimateApp.txt` — các fix trên đã có trong file này.  
2. Bundle: `app.bundle.js` — đã chứa logic tương ứng (QC_MISSING, ErrorBoundary, colSpan=6, v.v.).  
3. Backend URL hard-code: `BACKEND_URL = "https://qsestimate-backend-1.onrender.com"`.  
4. Không bundle XLSX / pdf-lib / fontkit vào app (CDN) để tránh phình ~1.5MB mỗi lần mở.

---

*Tài liệu này gom từ comment `SỬA LỖI` / `SỬA LỖI THẬT` / `THÊM MỚI` trong source — khoảng 80+ điểm sửa lỗi thật và 17+ điểm tính năng mới.*
