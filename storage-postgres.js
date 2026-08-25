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
  });
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
  console.log("[Postgres] Đã kiểm tra/tạo xong bảng user_storage + usage_log.");
  return true;
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

module.exports = { ketNoiDb, khoiTaoBang, docStorage, ghiStorage, ghiNhatKyDb, docNhatKyDb };
