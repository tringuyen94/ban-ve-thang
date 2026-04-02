const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const dbPath = path.join(__dirname, 'ban-ve-thang.db');

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  return "'" + String(val).replace(/'/g, "''") + "'";
}

function querySqlite(sql) {
  return execFileSync('sqlite3', [dbPath], { input: sql }).toString().trim();
}

// --- Validate input files ---
const xeFile = path.join(__dirname, 'xe-mien-phi.json');
const khFile = path.join(__dirname, 'khach-hang.json');

if (!fs.existsSync(xeFile)) {
  console.error('Không tìm thấy xe-mien-phi.json. Hãy copy file từ quan-ly-xe/ sang.');
  process.exit(1);
}
if (!fs.existsSync(khFile)) {
  console.error('Không tìm thấy khach-hang.json. Hãy copy file từ quan-ly-xe/ sang.');
  process.exit(1);
}

const xeList = JSON.parse(fs.readFileSync(xeFile, 'utf8'));
const khList = JSON.parse(fs.readFileSync(khFile, 'utf8'));

// --- Pre-process: gộp KH theo TenOVua ---
const tenOVuaByKH = {};

// Ưu tiên 1: ghiChu từ tblXeMienPhi
for (const xe of xeList) {
  if (xe.maKhachHang && xe.ghiChu && !tenOVuaByKH[xe.maKhachHang]) {
    tenOVuaByKH[xe.maKhachHang] = xe.ghiChu.toUpperCase();
  }
}

// Ưu tiên 2 (fallback): tenOVua từ tblKhachHang.tenCuaHang
for (const kh of khList) {
  if (kh.maKhachHang && kh.tenOVua && !tenOVuaByKH[kh.maKhachHang]) {
    tenOVuaByKH[kh.maKhachHang] = kh.tenOVua.toUpperCase();
  }
}

// Group by TenOVua → chọn MaKH chính (nhỏ nhất)
const groupByTenOVua = {};
for (const [maKH, ten] of Object.entries(tenOVuaByKH)) {
  if (!groupByTenOVua[ten]) groupByTenOVua[ten] = [];
  groupByTenOVua[ten].push(maKH);
}

const maKHMapping = {}; // maKH cũ → maKH chính
const primaryKHs = new Set();
for (const [ten, maKHs] of Object.entries(groupByTenOVua)) {
  maKHs.sort((a, b) => Number(a) - Number(b));
  const primary = maKHs[0];
  primaryKHs.add(primary);
  for (const m of maKHs) {
    maKHMapping[m] = primary;
  }
}

// KH không có TenOVua → giữ nguyên
const khNoTenOVua = khList.filter(kh => !tenOVuaByKH[kh.maKhachHang]);
for (const kh of khNoTenOVua) {
  maKHMapping[kh.maKhachHang] = kh.maKhachHang;
}

const mergedGroups = Object.entries(groupByTenOVua).filter(([, maKHs]) => maKHs.length > 1);
console.log(`Gộp KH: ${mergedGroups.length} nhóm trùng TenOVua, ${mergedGroups.reduce((s, [, g]) => s + g.length, 0)} KH → ${mergedGroups.length} KH chính.`);

// --- Bước 1: Import KhachHang (đã gộp) ---
const khBefore = parseInt(querySqlite('SELECT COUNT(*) FROM KhachHang;'), 10);

// Chỉ insert KH chính (có TenOVua) + KH không có TenOVua
const khToInsert = khList.filter(kh => primaryKHs.has(kh.maKhachHang) || !tenOVuaByKH[kh.maKhachHang]);

const khInserts = khToInsert
  .map(kh =>
    `INSERT OR IGNORE INTO KhachHang (MaKH, TenOVua, TenKH, GhiChu) VALUES (${esc(kh.maKhachHang)}, ${esc(tenOVuaByKH[kh.maKhachHang] || kh.tenOVua)}, ${esc(kh.tenKH)}, ${esc(kh.ghiChu)});`
  )
  .join('\n');

querySqlite(`BEGIN;\n${khInserts}\nCOMMIT;`);

const khAfter = parseInt(querySqlite('SELECT COUNT(*) FROM KhachHang;'), 10);
const khImported = khAfter - khBefore;
const khSkipped = khToInsert.length - khImported;
console.log(`KhachHang: ${khImported} import mới, ${khSkipped} bỏ qua (đã có sẵn). Tổng insert: ${khToInsert.length}/${khList.length}.`);

// --- Bước 2: Import PhuongTien (xe mới nếu chưa có) ---
const xeBefore = parseInt(querySqlite('SELECT COUNT(*) FROM PhuongTien;'), 10);

const xeInserts = xeList
  .map(xe => `INSERT OR IGNORE INTO PhuongTien (BienSo, LoaiXe) VALUES (${esc(xe.bienSo)}, '');`)
  .join('\n');


querySqlite(`BEGIN;\n${xeInserts}\nCOMMIT;`);

const xeAfter = parseInt(querySqlite('SELECT COUNT(*) FROM PhuongTien;'), 10);
const xeImported = xeAfter - xeBefore;
const xeSkipped = xeList.length - xeImported;
console.log(`PhuongTien: ${xeImported} xe import mới, ${xeSkipped} xe bỏ qua (đã có sẵn).`);

// --- Bước 3: Update PhuongTien.MaKH (remap qua maKHMapping) + NgayBatDau + NgayHetHan ---
const updates3 = xeList
  .map(xe => {
    const mappedMaKH = xe.maKhachHang ? (maKHMapping[xe.maKhachHang] || xe.maKhachHang) : null;
    return `UPDATE PhuongTien SET MaKH = ${esc(mappedMaKH)}, NgayBatDau = ${esc(xe.ngayBatDau)}, NgayHetHan = ${esc(xe.ngayHetHan)} WHERE BienSo = ${esc(xe.bienSo)};`;
  })
  .join('\n');
querySqlite(`BEGIN;\n${updates3}\nCOMMIT;`);

const xeCoKH = xeList.filter(xe => xe.maKhachHang != null);
const xeCoNgay = xeList.filter(xe => xe.ngayHetHan != null);
console.log(`PhuongTien: ${xeCoKH.length} xe được link MaKH, ${xeCoNgay.length} xe có NgayHetHan.`);

// --- Bước 4: Log kết quả gộp (TenOVua đã set ở bước 1) ---
console.log(`KhachHang: ${Object.keys(tenOVuaByKH).length} khách hàng có TenOVua (đã set khi insert).`);
