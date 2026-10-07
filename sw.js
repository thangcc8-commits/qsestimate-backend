// Service worker TỐI GIẢN — chỉ đủ điều kiện để trình duyệt cho phép "Thêm
// vào Màn hình chính" hoạt động như app thật (PWA yêu cầu có service worker
// đăng ký thành công). CỐ Ý KHÔNG CACHE BẤT KỲ FILE NÀO (đặc biệt app.bundle.js)
// — đã từng gặp đúng lỗi "bản cũ vẫn dính, sửa gì cũng không thấy hiệu lực"
// do cache trình duyệt (xem server.js — Cache-Control: no-store). Nếu cache
// ở đây, sẽ tái diễn đúng lỗi đó nhưng khó phát hiện hơn nhiều. Mọi request
// đều đi thẳng ra mạng như bình thường, không qua cache.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Không can thiệp gì — để trình duyệt tự xử lý y như không có service worker.
  return;
});
