// ============================================================================
// storage-postgres.js — LỚP LƯU TRỮ POSTGRES (dự phòng sẵn, CHƯA kích hoạt)
// ----------------------------------------------------------------------------
// File này KHÔNG tự động chạy — chỉ kích hoạt khi chú:
//   1. Tạo dịch vụ PostgreSQL trên Render (~$7-20/tháng tuỳ gói)
//   2. Copy "Internal Database URL" Render cung cấp
//   3. Thêm biến môi trường DATABASE_URL = <connection string đó>
//   4. Trong server.js, thay các hàm docNhatKy/ghiNhatKy/userFile bằng các hàm
//      tương ứng trong file này (đã viết đủ, chỉ cần đổi tên gọi)
//
// Khi CHƯA có DATABASE_URL: server.js vẫn dùng file JSON như hiện tại — file
// này nằm im, không ảnh hưởng gì tới hệ thống đang chạy.
//
// Cần cài thêm: npm install pg
// ============================================================================

let pool = null;
function ketNoiDb() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) return null;
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Render Postgres cần SSL, cấu hình sẵn cho đúng
    idleTimeoutMillis: 30000, // Chủ động đóng client rảnh sau 30s — SỚM HƠN Render tự ngắt, giảm khả năng gặp "kết nối đã chết nhưng client chưa biết"
  });
  // QUAN TRỌNG: pg Pool phát ra sự kiện "error" khi 1 client ĐANG RẢNH RỖI
  // (không phải lúc chạy query) gặp lỗi kết nối (Postgres tự ngắt, mạng chập
  // chờn...). Nếu KHÔNG lắng nghe sự kiện này, Node.js coi đó là lỗi chưa xử
  // lý và CRASH TOÀN BỘ TIẾN TRÌNH — sập cả server cho MỌI người dùng, không
  // chỉ 1 request. Chỉ log lại, KHÔNG throw tiếp — để server tiếp tục sống,
  // lần gọi Postgres kế tiếp sẽ tự thử kết nối lại.
  pool.on("error", (err) => console.error("[Postgres Pool Error]", err.message));
  return pool;
}

// Chạy 1 lần khi khởi động server (nếu có DATABASE_URL) để tạo bảng nếu chưa có
async function khoiTaoBang() {
  const db = ketNoiDb();
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_storage (
      user_key TEXT NOT NULL,
      data_key TEXT NOT NULL,
      value JSONB,
      updated_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (user_key, data_key)
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS usage_log (
      id SERIAL PRIMARY KEY,
      luc TIMESTAMPTZ DEFAULT now(),
      nguoi TEXT,
      loai TEXT,
      ten TEXT,
      input_tokens INT,
      output_tokens INT,
      usd NUMERIC(12, 5),
      vnd BIGINT
    );
  `);
  // Mã truy cập ĐỘNG — quản lý qua giao diện thay vì phải đổi biến môi trường
  // ACCESS_CODES + khởi động lại server mỗi khi thêm/bớt nhân viên. Có thêm
  // "het_han" tuỳ chọn (NULL = không hết hạn) để giới hạn thời gian dùng mã.
  // Mã truy cập ĐỘNG — quản lý qua giao diện thay vì phải đổi biến môi trường
  // ACCESS_CODES + khởi động lại server mỗi khi thêm/bớt nhân viên. Có thêm
  // "het_han" tuỳ chọn (NULL = không hết hạn) để giới hạn thời gian dùng mã.
  await db.query(`
    CREATE TABLE IF NOT EXISTS access_codes (
      ma TEXT PRIMARY KEY,
      ten TEXT NOT NULL,
      la_admin BOOLEAN DEFAULT false,
      het_han TIMESTAMPTZ,
      tao_luc TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Mẫu dự toán (danh sách tên chuẩn) theo TỪNG NHÓM công trình — quản lý
  // qua API riêng, KHÔNG lẫn trong khối JSON dự án (mục "Thay đổi dự toán
  // mẫu"). "items" là JSONB — mỗi phần tử có thể là chuỗi tên đơn giản HOẶC
  // object {ten, unit, group} nếu cần thêm chi tiết.
  await db.query(`
    CREATE TABLE IF NOT EXISTS estimate_templates (
      group_id TEXT PRIMARY KEY,
      items JSONB NOT NULL DEFAULT '[]',
      version INT NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT
    );
  `);
  console.log("[Postgres] Đã kiểm tra/tạo xong bảng user_storage + usage_log + access_codes + estimate_templates.");
  return true;
}

// ---- Mẫu dự toán (danh sách tên chuẩn) theo nhóm công trình ----
async function docTemplateMau(groupId) {
  const db = ketNoiDb();
  const res = await db.query("SELECT group_id, items, version, updated_at, updated_by FROM estimate_templates WHERE group_id=$1", [groupId]);
  return res.rows[0] || null;
}
// gopThem=false: GHI ĐÈ toàn bộ. gopThem=true: chỉ THÊM các tên CHƯA CÓ (so
// sánh theo "ten"/chuỗi, không phân biệt hoa-thường/khoảng trắng thừa).
async function ghiTemplateMau(groupId, items, gopThem, nguoiSua) {
  const db = ketNoiDb();
  const layTen = (it) => (typeof it === "string" ? it : it?.ten || "").trim().toLowerCase();
  let itemsCuoi = items;
  if (gopThem) {
    const cu = await docTemplateMau(groupId);
    const tenDaCo = new Set((cu?.items || []).map(layTen));
    const themMoi = (items || []).filter((it) => !tenDaCo.has(layTen(it)));
    itemsCuoi = [...(cu?.items || []), ...themMoi];
  }
  const res = await db.query(
    `INSERT INTO estimate_templates (group_id, items, version, updated_at, updated_by) VALUES ($1,$2,1,now(),$3)
     ON CONFLICT (group_id) DO UPDATE SET items=$2, version=estimate_templates.version+1, updated_at=now(), updated_by=$3
     RETURNING group_id, items, version, updated_at, updated_by`,
    [groupId, JSON.stringify(itemsCuoi), nguoiSua || null]
  );
  return res.rows[0];
}

// ---- Mã truy cập động (thay ACCESS_CODES cố định) ----
async function layDanhSachAccessCodes() {
  const db = ketNoiDb();
  const res = await db.query("SELECT ma, ten, la_admin, het_han, tao_luc FROM access_codes ORDER BY tao_luc DESC");
  return res.rows;
}
// Trả về { ten, quanTri } nếu mã hợp lệ VÀ chưa hết hạn — null nếu không tìm
// thấy hoặc đã hết hạn (coi như sai mã, không phân biệt lý do cụ thể ra ngoài
// để tránh lộ thông tin "mã từng tồn tại nhưng đã hết hạn" cho người dò mã).
async function kiemTraAccessCode(ma) {
  const db = ketNoiDb();
  const res = await db.query("SELECT ten, la_admin, het_han FROM access_codes WHERE ma=$1", [ma]);
  const row = res.rows[0];
  if (!row) return null;
  if (row.het_han && new Date(row.het_han).getTime() < Date.now()) return null; // đã hết hạn
  return { ten: row.ten, quanTri: !!row.la_admin };
}
async function themSuaAccessCode(ma, ten, laAdmin, hetHan) {
  const db = ketNoiDb();
  await db.query(
    `INSERT INTO access_codes (ma, ten, la_admin, het_han) VALUES ($1,$2,$3,$4)
     ON CONFLICT (ma) DO UPDATE SET ten=$2, la_admin=$3, het_han=$4`,
    [ma, ten, !!laAdmin, hetHan || null]
  );
}
async function xoaAccessCode(ma) {
  const db = ketNoiDb();
  await db.query("DELETE FROM access_codes WHERE ma=$1", [ma]);
}

// ---- Thay thế cho userFile()/GET/POST /api/storage/:key trong server.js ----
async function docStorage(userKey, dataKey) {
  const db = ketNoiDb();
  const res = await db.query("SELECT value FROM user_storage WHERE user_key=$1 AND data_key=$2", [userKey, dataKey]);
  return res.rows[0]?.value ?? null;
}
async function ghiStorage(userKey, dataKey, value) {
  const db = ketNoiDb();
  await db.query(
    `INSERT INTO user_storage (user_key, data_key, value, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (user_key, data_key) DO UPDATE SET value = $3, updated_at = now()`,
    [userKey, dataKey, JSON.stringify(value)]
  );
}

// ---- Thêm cho /api/backup, /api/backup/restore, /api/backup (DELETE) — lấy/ghi/
// xoá TOÀN BỘ dữ liệu 1 user (mọi data_key), không chỉ 1 key riêng lẻ như trên.
async function docToanBoStorage(userKey) {
  const db = ketNoiDb();
  const res = await db.query("SELECT data_key, value FROM user_storage WHERE user_key=$1", [userKey]);
  const store = {};
  res.rows.forEach((r) => { store[r.data_key] = r.value; });
  return store;
}
// TỐI ƯU: gộp toàn bộ lượt ghi vào 1 transaction (BEGIN...COMMIT) thay vì ghi
// tuần tự từng dòng — giảm số lần round-trip tới Postgres, đồng thời đảm bảo
// TÍNH TOÀN VẸN: nếu 1 dòng ghi lỗi giữa chừng, TOÀN BỘ được huỷ (ROLLBACK)
// thay vì để lại dữ liệu ghi dở dang (restore nửa vời còn nguy hiểm hơn không
// restore gì cả).
async function ghiToanBoStorage(userKey, storeObj) {
  const db = ketNoiDb();
  const keys = Object.keys(storeObj || {});
  if (!keys.length) return 0;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const k of keys) {
      await client.query(
        `INSERT INTO user_storage (user_key, data_key, value, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (user_key, data_key) DO UPDATE SET value = $3, updated_at = now()`,
        [userKey, k, JSON.stringify(storeObj[k])]
      );
    }
    await client.query("COMMIT");
    return keys.length;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
async function xoaToanBoStorage(userKey) {
  const db = ketNoiDb();
  await db.query("DELETE FROM user_storage WHERE user_key=$1", [userKey]);
}

// ---- Thay thế cho docNhatKy()/ghiNhatKy() trong server.js ----
async function ghiNhatKyDb(ban) {
  const db = ketNoiDb();
  await db.query(
    `INSERT INTO usage_log (nguoi, loai, ten, input_tokens, output_tokens, usd, vnd) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [ban.nguoi, ban.loai, ban.ten, ban.inputTokens || 0, ban.outputTokens || 0, ban.usd || 0, ban.vnd || 0]
  );
}
async function docNhatKyDb(gioiHan = 200) {
  const db = ketNoiDb();
  const res = await db.query("SELECT * FROM usage_log ORDER BY luc DESC LIMIT $1", [gioiHan]);
  return res.rows;
}

module.exports = {
  ketNoiDb, khoiTaoBang, docStorage, ghiStorage, docToanBoStorage, ghiToanBoStorage, xoaToanBoStorage,
  ghiNhatKyDb, docNhatKyDb, layDanhSachAccessCodes, kiemTraAccessCode, themSuaAccessCode, xoaAccessCode,
  docTemplateMau, ghiTemplateMau,
};
