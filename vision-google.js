// ============================================================================
// vision-google.js — Gọi Google Cloud Vision API (TEXT_DETECTION) để lấy chữ +
// TOẠ ĐỘ PIXEL THẬT trên bản vẽ — bổ sung cho pipeline Claude, KHÔNG THAY THẾ.
//
// GIÁ TRỊ THẬT: Claude Vision không thể cho toạ độ pixel chính xác (đã kiểm
// chứng nhiều lần) — Google Vision OCR THÌ CÓ, vì đây là OCR chuyên dụng (tìm
// vị trí CHỮ/SỐ trong ảnh), không phải mô hình ngôn ngữ đa năng "đoán" vị trí.
//
// GIỚI HẠN THẬT (không phóng đại): Vision OCR chỉ tìm được VỊ TRÍ CỦA CHỮ/SỐ,
// KHÔNG tìm được polygon tường/phòng (không phải computer vision cho bản vẽ
// kỹ thuật, chỉ là OCR văn bản thông thường). Không tự động = 100%, không có
// polygon tường-phòng như phần mềm CAD chuyên dụng.
//
// KHÔNG cần npm install thêm — dùng fetch() có sẵn trong Node 18+.
// ============================================================================

const GOOGLE_VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

// Đọc kích thước ảnh THẬT từ base64 (PNG/JPEG) — cần để quy đổi toạ độ pixel
// Google trả về sang toạ độ NORMALIZED (0-1) khớp với evidence_region đã dùng
// xuyên suốt hệ thống. KHÔNG cần thêm thư viện — tự đọc header ảnh thủ công.
function layKichThuocAnh(base64, mediaType) {
  const buf = Buffer.from(base64, "base64");
  if (mediaType === "image/png" || (buf[0] === 0x89 && buf[1] === 0x50)) {
    // PNG: signature 8 byte, rồi IHDR chunk có width(4B)+height(4B) ở offset 16-24
    if (buf.length < 24) return null;
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  }
  if (mediaType === "image/jpeg" || (buf[0] === 0xff && buf[1] === 0xd8)) {
    // JPEG: duyệt qua các segment marker, tìm SOF0 (0xC0) hoặc SOF2 (0xC2)
    let offset = 2;
    while (offset < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        return { width, height };
      }
      const segLen = buf.readUInt16BE(offset + 2);
      offset += 2 + segLen;
    }
    return null;
  }
  return null; // định dạng khác (webp...) — chưa hỗ trợ đọc kích thước, evidence sẽ chỉ có pixel thô
}

// Nhận diện text CÓ DẠNG SỐ ĐO xây dựng (VD "8420", "23.9", "8,420", "1:100"
// cho tỷ lệ) — dùng để LỌC BỚT nhiễu (chữ ký hiệu, tên phòng...) khi gợi ý.
const REGEX_SO_DO = /^\d{1,6}([.,]\d{1,3})?$|^\d+[:xX]\d+$|^1[:]\d{2,4}$/;

async function ocrGoogleVision(base64, mediaType, apiKey) {
  if (!apiKey) throw new Error("Thiếu GOOGLE_VISION_API_KEY — đặt biến môi trường trước khi gọi OCR.");
  const body = {
    requests: [{ image: { content: base64 }, features: [{ type: "TEXT_DETECTION" }] }],
  };
  const res = await fetch(`${GOOGLE_VISION_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Google Vision API lỗi ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.responses?.[0]?.error) throw new Error(`Google Vision: ${data.responses[0].error.message}`);

  const textAnnotations = data.responses?.[0]?.textAnnotations || [];
  // Phần tử [0] là TOÀN BỘ text gộp (bounding box cả trang) — bỏ qua, chỉ lấy
  // các phần tử SAU (mỗi cái là 1 từ/cụm riêng biệt với toạ độ pixel THẬT).
  const kichThuocAnh = layKichThuocAnh(base64, mediaType);

  const ketQua = textAnnotations.slice(1).map((t) => {
    const verts = t.boundingPoly?.vertices || [];
    const xs = verts.map((v) => v.x || 0), ys = verts.map((v) => v.y || 0);
    const pixel = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    const normalized = kichThuocAnh
      ? { x: +(pixel.x / kichThuocAnh.width).toFixed(4), y: +(pixel.y / kichThuocAnh.height).toFixed(4), w: +(pixel.w / kichThuocAnh.width).toFixed(4), h: +(pixel.h / kichThuocAnh.height).toFixed(4) }
      : null; // không đọc được kích thước ảnh (định dạng lạ) -> chỉ có pixel thô, không có normalized
    return {
      text: t.description || "",
      pixel,
      evidence_region: normalized, // ĐÚNG format evidence_region đã dùng xuyên suốt hệ thống (0-1)
      laSoDoNghiNgo: REGEX_SO_DO.test((t.description || "").trim()),
    };
  });

  return {
    tongSoText: ketQua.length,
    kichThuocAnh,
    items: ketQua,
    goiYSoDo: ketQua.filter((t) => t.laSoDoNghiNgo), // lọc riêng các text NGHI NGỜ là số đo, tiện cho QS xem nhanh
  };
}

module.exports = { ocrGoogleVision, layKichThuocAnh };
