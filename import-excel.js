const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const XLSX = require('xlsx');

const dbPath = path.join(__dirname, 'ban-ve-thang.db');
const dryRun = process.argv.includes('--dry-run');

if (dryRun) console.log('=== DRY RUN — không ghi DB ===\n');

// --- Helpers ---

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  return "'" + String(val).replace(/'/g, "''") + "'";
}

function querySqlite(sql) {
  return execFileSync('sqlite3', [dbPath], { input: sql }).toString().trim();
}

function runSql(sql) {
  if (dryRun) return;
  querySqlite(sql);
}

// --- Đọc Excel ---

const xeTaiFile = '/Users/tringuyen/Downloads/LUU BÁN VÉ THÁNG XE TẢI (1).xlsx';
const baGacFile = '/Users/tringuyen/Downloads/LUU BAN VE THANG-XE BA GAC (1).xlsx';

if (!fs.existsSync(xeTaiFile)) { console.error('Không tìm thấy file Xe Tải:', xeTaiFile); process.exit(1); }
if (!fs.existsSync(baGacFile)) { console.error('Không tìm thấy file Ba Gác:', baGacFile); process.exit(1); }

// --- Parse helpers ---

function extractPhones(text, phones) {
  const matches = String(text).match(/0\d{8,9}/g);
  if (matches) {
    for (const m of matches) {
      if (!phones.includes(m)) phones.push(m);
    }
  }
}

function cleanTenOVua(raw) {
  if (!raw) return '';
  let line = raw.split(/\r?\n/)[0].trim();
  line = line.replace(/\s*Mi[ễê]n ph[ií].*$/i, '').trim();
  line = line.replace(/\s*MPLĐ.*$/i, '').trim();
  return line.toUpperCase();
}

function mapTaiTrong(val) {
  const t = parseFloat(val);
  if (isNaN(t)) return 'xe_tai_nho';
  if (t <= 3.5) return 'xe_tai_nho';
  if (t <= 9.5) return 'xe_tai_vua';
  return 'xe_tai_lon';
}

function normalizeBienSo(bs) {
  return String(bs).trim().replace(/[\s-]+/g, '').toUpperCase();
}

// --- Parse Xe Tải ---

function parseXeTai() {
  const wb = XLSX.readFile(xeTaiFile);
  const ws = wb.Sheets['TH2024'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const customers = [];
  let current = null;

  for (let i = 7; i < rows.length; i++) {
    const r = rows[i];
    const stt = r[0];
    const hoTen = String(r[1] || '').trim();
    const tenOVua = String(r[2] || '').trim();
    const soDT = String(r[3] || '').trim();
    const soXe = String(r[5] || '').trim();
    const taiTrong = r[6];

    if (typeof stt === 'number' && stt > 0 && hoTen) {
      current = {
        TenKH: hoTen,
        TenOVuaRaw: tenOVua,
        phones: [],
        vehicles: [],
        LaChanh: /^Chành\b/i.test(cleanTenOVua(tenOVua)) ? 1 : 0,
      };
      customers.push(current);
      if (soDT) extractPhones(soDT, current.phones);
      current.TenOVua = cleanTenOVua(tenOVua);
    } else if (current && soDT) {
      extractPhones(soDT, current.phones);
    }

    if (current && soXe) {
      const loaiXe = mapTaiTrong(taiTrong);
      current.vehicles.push({ BienSo: normalizeBienSo(soXe), LoaiXe: loaiXe });
    }
  }

  return customers;
}

// --- Parse Ba Gác ---

function parseBaGac() {
  const wb = XLSX.readFile(baGacFile);
  const ws = wb.Sheets['XE BA GAC 2023'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const customers = [];
  let current = null;

  for (let i = 7; i < rows.length; i++) {
    const r = rows[i];
    const stt = r[0];
    const hoTen = String(r[1] || '').trim();
    const chanhOVua = String(r[2] || '').trim();
    const maSoXe = String(r[3] || '').trim();

    if (typeof stt === 'number' && stt > 0 && hoTen) {
      current = {
        TenKH: hoTen.replace(/\r?\n/g, ' ').trim(),
        TenOVuaRaw: chanhOVua,
        phones: [],
        vehicles: [],
        LaChanh: 0,
      };
      customers.push(current);

      const lines = chanhOVua.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        current.TenOVua = lines[0].replace(/^['']/, '').toUpperCase();
        if (/^CHÀNH\b/i.test(current.TenOVua)) current.LaChanh = 1;
        if (/^['']?0\d{8,9}/.test(lines[0])) {
          current.TenOVua = '';
        }
      } else {
        current.TenOVua = '';
      }
      for (const line of lines) {
        extractPhones(line.replace(/^['']/, ''), current.phones);
      }
    }

    if (current && maSoXe) {
      let maXe = maSoXe.split(/\s+thay\s+/i)[0].trim();
      maXe = maXe.replace(/-/g, '');
      if (maXe && /^[A-Z0-9]{4,}$/i.test(maXe)) {
        current.vehicles.push({ BienSo: maXe.toUpperCase(), LoaiXe: 'ba_gac' });
      }
    }
  }

  return customers;
}

// --- Main ---

console.log('Đọc file Xe Tải...');
const xeTaiCustomers = parseXeTai();
console.log(`  → ${xeTaiCustomers.length} khách hàng, ${xeTaiCustomers.reduce((s, c) => s + c.vehicles.length, 0)} xe\n`);

console.log('Đọc file Ba Gác...');
const baGacCustomers = parseBaGac();
console.log(`  → ${baGacCustomers.length} khách hàng, ${baGacCustomers.reduce((s, c) => s + c.vehicles.length, 0)} xe\n`);

// --- Dedup theo TenOVua ---

const allCustomers = [...xeTaiCustomers, ...baGacCustomers];
const byTenOVua = new Map();

for (const c of allCustomers) {
  const key = (c.TenOVua || '').toUpperCase().trim();
  if (!key) {
    byTenOVua.set(`__no_ovua_${Math.random()}`, c);
    continue;
  }
  if (byTenOVua.has(key)) {
    const existing = byTenOVua.get(key);
    for (const p of c.phones) {
      if (!existing.phones.includes(p)) existing.phones.push(p);
    }
    if (c.LaChanh) existing.LaChanh = 1;
    const existingBS = new Set(existing.vehicles.map(v => v.BienSo));
    for (const v of c.vehicles) {
      if (!existingBS.has(v.BienSo)) existing.vehicles.push(v);
    }
  } else {
    byTenOVua.set(key, { ...c });
  }
}

const dedupedCustomers = [...byTenOVua.values()];
console.log(`Sau dedup: ${dedupedCustomers.length} khách hàng\n`);

// --- Xóa sạch dữ liệu cũ ---

console.log('Xóa toàn bộ dữ liệu cũ (VeThang, PhuongTien, KhachHang)...');
if (!dryRun) {
  runSql(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    DELETE FROM VeThang;
    DELETE FROM PhuongTien;
    DELETE FROM KhachHang;
    DELETE FROM sqlite_sequence WHERE name = 'KhachHang';
    DELETE FROM sqlite_sequence WHERE name = 'VeThang';
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
  console.log('  → Đã xóa sạch.\n');
} else {
  console.log('  → (dry-run) Sẽ xóa VeThang, PhuongTien, KhachHang\n');
}

// --- Ensure SoDienThoai, DiaChi columns exist ---
if (!dryRun) {
  try { querySqlite("ALTER TABLE KhachHang ADD COLUMN SoDienThoai TEXT;"); } catch (_) {}
}

// --- Insert KhachHang ---

const khStatements = [];
let khCount = 0;

for (const c of dedupedCustomers) {
  const key = (c.TenOVua || '').toUpperCase().trim();
  const soDienThoai = c.phones.length > 0 ? c.phones.join(', ') : null;

  if (key) {
    khStatements.push(
      `INSERT OR IGNORE INTO KhachHang (TenKH, TenOVua, SoDienThoai, LaChanh) VALUES (${esc(c.TenKH)}, ${esc(key)}, ${esc(soDienThoai)}, ${c.LaChanh || 0});`
    );
    khCount++;
  }
}

console.log(`KhachHang: ${khCount} sẽ được insert`);

if (khStatements.length > 0) {
  if (dryRun) {
    console.log('\n--- SQL KhachHang (preview) ---');
    khStatements.slice(0, 10).forEach(s => console.log(s));
    if (khStatements.length > 10) console.log(`... và ${khStatements.length - 10} câu nữa`);
    console.log('');
  } else {
    runSql(`BEGIN;\n${khStatements.join('\n')}\nCOMMIT;`);
  }
}

// --- Build KH map (TenOVua → MaKH) ---

const khMap = new Map();
if (!dryRun) {
  const khRows = querySqlite("SELECT MaKH, UPPER(TenOVua) FROM KhachHang WHERE TenOVua IS NOT NULL;");
  if (khRows) {
    for (const line of khRows.split('\n')) {
      const [maKH, ...rest] = line.split('|');
      const tenOVua = rest.join('|');
      if (maKH && tenOVua) khMap.set(tenOVua.trim(), maKH.trim());
    }
  }
}

// --- Insert PhuongTien ---

const ptStatements = [];
let ptCount = 0;
const seenBienSo = new Set();

for (const c of dedupedCustomers) {
  const key = (c.TenOVua || '').toUpperCase().trim();
  const maKH = khMap.get(key) || null;

  for (const v of c.vehicles) {
    if (seenBienSo.has(v.BienSo)) continue;
    seenBienSo.add(v.BienSo);

    const trangThai = v.LoaiXe === 'ba_gac' ? 1 : 'NULL';
    ptStatements.push(
      `INSERT OR IGNORE INTO PhuongTien (BienSo, LoaiXe, MaKH, TrangThai) VALUES (${esc(v.BienSo)}, ${esc(v.LoaiXe)}, ${maKH ? esc(maKH) : 'NULL'}, ${trangThai});`
    );
    ptCount++;
  }
}

console.log(`PhuongTien: ${ptCount} sẽ được insert`);

if (ptStatements.length > 0) {
  if (dryRun) {
    console.log('\n--- SQL PhuongTien (preview) ---');
    ptStatements.slice(0, 10).forEach(s => console.log(s));
    if (ptStatements.length > 10) console.log(`... và ${ptStatements.length - 10} câu nữa`);
    console.log('');
  } else {
    runSql(`BEGIN;\n${ptStatements.join('\n')}\nCOMMIT;`);
  }
}

// --- Summary ---
if (!dryRun) {
  const totalKH = querySqlite("SELECT COUNT(*) FROM KhachHang;");
  const totalPT = querySqlite("SELECT COUNT(*) FROM PhuongTien;");
  const totalVe = querySqlite("SELECT COUNT(*) FROM VeThang;");
  console.log(`\n=== Kết quả ===`);
  console.log(`Tổng KhachHang: ${totalKH}`);
  console.log(`Tổng PhuongTien: ${totalPT}`);
  console.log(`Tổng VeThang: ${totalVe}`);
} else {
  console.log('\n=== DRY RUN hoàn tất — không có thay đổi nào được ghi vào DB ===');
}
