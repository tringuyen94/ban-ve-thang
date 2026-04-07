const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const os = require("os");
const fs = require("fs");
const Database = require("better-sqlite3");
const XLSX = require("xlsx");

const isProd = app.isPackaged;

if (!isProd) {
  try {
    require("electron-reload")(path.join(__dirname, "renderer"), {
      electron: path.join(__dirname, "node_modules", ".bin", "electron"),
    });
  } catch (_) {}
}

// ---- Database ----

let db = null;

function getDb() {
  if (db) return db;
  const dbPath = isProd
    ? path.join(app.getPath("userData"), "ban-ve-thang.db")
    : path.join(__dirname, "ban-ve-thang.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS LoaiXe (
      MaLoaiXe  TEXT PRIMARY KEY,
      TenLoaiXe TEXT NOT NULL,
      ThuTu     INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO LoaiXe (MaLoaiXe, TenLoaiXe, ThuTu) VALUES
      ('ba_gac',     'Ba gác',                1),
      ('xe_tai_nho', 'Xe tải ≤ 3.5t',        2),
      ('xe_tai_vua', 'Xe tải 3.5–9.5t',      3),
      ('xe_tai_lon', 'Xe tải > 9.5t',        4),
      ('xe_dl_vua',  'Xe du lịch 14–25 chỗ', 5),
      ('xe_dl_lon',  'Xe du lịch > 25 chỗ',  6);

    CREATE TABLE IF NOT EXISTS TrangThai (
      MaTrangThai  INTEGER PRIMARY KEY,
      TenTrangThai TEXT NOT NULL
    );

    INSERT OR IGNORE INTO TrangThai (MaTrangThai, TenTrangThai) VALUES
      (1, 'Miễn phí nhập chợ'),
      (2, 'Miễn phí lưu đậu'),
      (3, 'Miễn phí lưu đậu và nhập chợ');

    CREATE TABLE IF NOT EXISTS KhachHang (
      MaKH        INTEGER PRIMARY KEY AUTOINCREMENT,
      TenOVua     TEXT UNIQUE,
      TenKH       TEXT NOT NULL,
      GhiChu      TEXT,
      LaChanh     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS PhuongTien (
      BienSo    TEXT PRIMARY KEY,
      LoaiXe    TEXT NOT NULL REFERENCES LoaiXe(MaLoaiXe),
      MaKH      INTEGER REFERENCES KhachHang(MaKH),
      TrangThai INTEGER REFERENCES TrangThai(MaTrangThai)
    );

    CREATE TABLE IF NOT EXISTS VeThang (
      MaVe         INTEGER PRIMARY KEY AUTOINCREMENT,
      BienSo       TEXT    NOT NULL REFERENCES PhuongTien(BienSo),
      MaKH         INTEGER NOT NULL REFERENCES KhachHang(MaKH),
      LoaiVe       TEXT    NOT NULL,
      KhuVucLuuDau TEXT,
      SoThang      INTEGER NOT NULL DEFAULT 1,
      TuNgay       TEXT    NOT NULL,
      DenNgay      TEXT    NOT NULL,
      GiaTien      REAL    NOT NULL,
      TongTien     REAL    NOT NULL,
      SoPhieuThu     TEXT,
      NhanVienBan  TEXT,
      NgayBan      TEXT    NOT NULL DEFAULT (date('now'))
    );

    UPDATE PhuongTien SET LoaiXe = 'xe_tai_nho' WHERE LoaiXe = 'xe_mien_phi';
    DELETE FROM LoaiXe WHERE MaLoaiXe = 'xe_mien_phi';

    UPDATE PhuongTien SET LoaiXe = 'ba_gac'
    WHERE SUBSTR(BienSo,1,1) BETWEEN 'A' AND 'Z'
      AND LoaiXe != 'ba_gac';
  `);

  // Migration: đổi TenOVua → TenOVua
  const cols = db.pragma("table_info(KhachHang)").map(c => c.name);
  if (cols.includes("TenOVua")) {
    db.exec("ALTER TABLE KhachHang RENAME COLUMN TenOVua TO TenOVua");
  }

  // Migration: thêm cột LaChanh
  if (!cols.includes("LaChanh")) {
    db.exec("ALTER TABLE KhachHang ADD COLUMN LaChanh INTEGER NOT NULL DEFAULT 0");
  }

  // Migration: chuẩn hóa BienSo xe_tai (bỏ khoảng trống và dấu -)
  db.exec(`
    UPDATE PhuongTien
    SET BienSo = REPLACE(REPLACE(BienSo, ' ', ''), '-', '')
    WHERE LoaiXe LIKE 'xe_tai%'
  `);

  // Migration: thêm cột SoDienThoai, DiaChi
  if (!cols.includes("SoDienThoai")) {
    db.exec("ALTER TABLE KhachHang ADD COLUMN SoDienThoai TEXT");
  }
  // Migration: xóa cột DiaChi (không còn sử dụng)
  if (cols.includes("DiaChi")) {
    db.exec("ALTER TABLE KhachHang DROP COLUMN DiaChi");
  }

  // Migration: thêm cột NgayBatDau, NgayHetHan cho PhuongTien
  const ptCols = db.pragma("table_info(PhuongTien)").map(c => c.name);
  if (!ptCols.includes("NgayBatDau")) {
    db.exec("ALTER TABLE PhuongTien ADD COLUMN NgayBatDau TEXT");
  }
  if (!ptCols.includes("NgayHetHan")) {
    db.exec("ALTER TABLE PhuongTien ADD COLUMN NgayHetHan TEXT");
  }

  // Migration: đổi SoHoaDon -> SoPhieuThu
  const vtCols = db.pragma("table_info(VeThang)").map(c => c.name);
  if (vtCols.includes("SoHoaDon") && !vtCols.includes("SoPhieuThu")) {
    db.exec("ALTER TABLE VeThang RENAME COLUMN SoHoaDon TO SoPhieuThu");
  }

  // Migration: đồng bộ KhachHang + PhuongTien từ quan-ly-xe JSON
  syncFromQuanLyXe(db);
}

function syncFromQuanLyXe(db) {
  const fs = require("fs");
  const khFilePath = path.join(__dirname, "..", "quan-ly-xe", "khach-hang.json");
  const xeFilePath = path.join(__dirname, "..", "quan-ly-xe", "xe-mien-phi.json");

  if (!fs.existsSync(khFilePath) || !fs.existsSync(xeFilePath)) {
    return; // skip nếu file không tồn tại (máy khác)
  }

  const khachHangList = JSON.parse(fs.readFileSync(khFilePath, "utf-8"));
  const xeMienPhiList = JSON.parse(fs.readFileSync(xeFilePath, "utf-8"));

  // 1. Upsert KhachHang, build mapping mssqlMaKH → sqliteMaKH
  const insertKH = db.prepare(
    "INSERT OR IGNORE INTO KhachHang (TenKH, TenOVua, GhiChu) VALUES (?, ?, ?)"
  );
  const findKH = db.prepare("SELECT MaKH FROM KhachHang WHERE TenOVua = ?");

  const maKHMapping = {};

  db.transaction(() => {
    for (const kh of khachHangList) {
      const tenOVua = (kh.tenOVua || "").trim();
      if (!tenOVua) continue;
      const tenKH = (kh.tenKH || "").trim() || tenOVua;
      const ghiChu = (kh.ghiChu || "").trim() || null;
      insertKH.run(tenKH, tenOVua, ghiChu);
      const row = findKH.get(tenOVua);
      if (row) {
        maKHMapping[kh.maKhachHang] = row.MaKH;
      }
    }
  })();

  // 2. Upsert PhuongTien từ xe-mien-phi.json
  const findXe = db.prepare("SELECT BienSo, LoaiXe, MaKH, TrangThai FROM PhuongTien WHERE BienSo = ?");
  const insertXe = db.prepare(
    "INSERT INTO PhuongTien (BienSo, LoaiXe, MaKH, TrangThai, NgayBatDau, NgayHetHan) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const updateXeMaKH = db.prepare(
    "UPDATE PhuongTien SET MaKH = ? WHERE BienSo = ? AND MaKH IS NULL"
  );
  const updateXeTrangThai = db.prepare(
    "UPDATE PhuongTien SET TrangThai = ? WHERE BienSo = ? AND TrangThai IS NULL"
  );
  const updateXeNgay = db.prepare(
    "UPDATE PhuongTien SET NgayBatDau = ?, NgayHetHan = ? WHERE BienSo = ?"
  );

  db.transaction(() => {
    for (const xe of xeMienPhiList) {
      const bienSo = (xe.bienSo || "").replace(/[\s\-]/g, "").toUpperCase();
      if (!bienSo) continue;
      const maKH = maKHMapping[xe.maKhachHang] || null;
      const trangThai = xe.trangThai || 1;
      const ngayBatDau = xe.ngayBatDau || null;
      const ngayHetHan = xe.ngayHetHan || null;
      const existing = findXe.get(bienSo);
      if (existing) {
        // Xe đã có: cập nhật MaKH nếu chưa có, cập nhật TrangThai nếu NULL, luôn cập nhật ngày
        if (maKH) {
          updateXeMaKH.run(maKH, bienSo);
        }
        updateXeTrangThai.run(trangThai, bienSo);
        updateXeNgay.run(ngayBatDau, ngayHetHan, bienSo);
      } else {
        // Xe mới: INSERT với LoaiXe='xe_tai_nho', TrangThai + ngày từ JSON
        insertXe.run(bienSo, "xe_tai_nho", maKH, trangThai, ngayBatDau, ngayHetHan);
      }
    }
  })();
}

// ---- Pricing config ----

const BANG_GIA = {
  nhap_cho: {
    ba_gac:     589091,
    xe_tai_nho: 1060364,  // ≤ 3.5t
    xe_dl_vua:  1060364,  // 14–25 chỗ
    xe_dl_lon:  2061818,  // >25 chỗ
    xe_tai_vua: 2061818,  // 3.5–9.5t
    xe_tai_lon: 2709818,  // >9.5t
  },
  luu_dau: {
    tieu_chuan: {
      xe_tai_nho: 1890000,
      xe_tai_vua: 1890000,
      xe_tai_lon: 1890000,
    },
    dac_biet: {
      xe_tai_nho: 400000,  // ≤ 3.5t
      xe_tai_vua: 800000,  // > 3.5t
      xe_tai_lon: 800000,
    },
  },
};

// ---- Window ----

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Bán Vé Tháng - Chợ Thủ Đức",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  if (!isProd) {
    win.webContents.openDevTools({ mode: "detach" });
  }

  return win;
}

// ---- IPC: Config ----

ipcMain.handle("get-bang-gia", () => BANG_GIA);

ipcMain.handle("get-app-version", () => app.getVersion());

ipcMain.handle("test-connection", () => {
  try {
    getDb();
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ---- IPC: Loại xe ----

ipcMain.handle("get-loai-xe-list", () => {
  return getDb()
    .prepare("SELECT MaLoaiXe, TenLoaiXe, ThuTu FROM LoaiXe ORDER BY ThuTu")
    .all();
});

// ---- IPC: Khách hàng ----

ipcMain.handle("get-khach-hang-list", () => {
  return getDb()
    .prepare("SELECT MaKH, TenKH, TenOVua, GhiChu, LaChanh, SoDienThoai FROM KhachHang ORDER BY TenOVua")
    .all();
});

ipcMain.handle("search-khach-hang", (_event, query) => {
  return getDb()
    .prepare(
      "SELECT MaKH, TenOVua, TenKH, GhiChu, LaChanh, SoDienThoai FROM KhachHang WHERE TenOVua LIKE ? OR TenKH LIKE ? OR SoDienThoai LIKE ? ORDER BY TenOVua"
    )
    .all(`%${query}%`, `%${query}%`, `%${query}%`);
});

ipcMain.handle("add-khach-hang", (_event, data) => {
  const result = getDb()
    .prepare("INSERT INTO KhachHang (TenKH, TenOVua, GhiChu, LaChanh, SoDienThoai) VALUES (?, ?, ?, ?, ?)")
    .run(data.TenKH, data.TenOVua || null, data.GhiChu || null, data.LaChanh ? 1 : 0, data.SoDienThoai || null);
  return getDb()
    .prepare("SELECT MaKH, TenKH, TenOVua, GhiChu, LaChanh, SoDienThoai FROM KhachHang WHERE MaKH = ?")
    .get(result.lastInsertRowid);
});

ipcMain.handle("update-khach-hang", (_event, data) => {
  getDb()
    .prepare("UPDATE KhachHang SET TenKH=?, TenOVua=?, GhiChu=?, LaChanh=?, SoDienThoai=? WHERE MaKH=?")
    .run(data.TenKH, data.TenOVua || null, data.GhiChu || null, data.LaChanh ? 1 : 0, data.SoDienThoai || null, data.MaKH);
  return { success: true };
});

ipcMain.handle("delete-khach-hang", (_event, maKH) => {
  const db = getDb();
  const xeList = db.prepare("SELECT BienSo FROM PhuongTien WHERE MaKH = ?").all(maKH);
  db.transaction(() => {
    for (const xe of xeList) {
      db.prepare("DELETE FROM VeThang WHERE BienSo = ? AND MaKH = ?").run(xe.BienSo, maKH);
      db.prepare("DELETE FROM PhuongTien WHERE BienSo = ? AND MaKH = ?").run(xe.BienSo, maKH);
    }
    db.prepare("DELETE FROM KhachHang WHERE MaKH = ?").run(maKH);
  })();
  return { success: true, deletedXe: xeList.length };
});

// ---- IPC: Phương tiện ----

ipcMain.handle("get-phuong-tien", (_event, bienSo) => {
  return getDb()
    .prepare(
      `SELECT pt.BienSo, pt.LoaiXe, pt.MaKH, kh.TenKH, kh.TenOVua
       FROM PhuongTien pt
       LEFT JOIN KhachHang kh ON kh.MaKH = pt.MaKH
       WHERE pt.BienSo = ?`
    )
    .get(bienSo) || null;
});

ipcMain.handle("toggle-mien-phi-luu-dau", (_event, bienSo) => {
  const db = getDb();
  const row = db.prepare("SELECT TrangThai FROM PhuongTien WHERE BienSo = ?").get(bienSo);
  if (!row) return { success: false, error: "Không tìm thấy xe" };
  const cur = row.TrangThai;
  // Toggle free parking bit: null↔2, 1↔3
  let next;
  if (cur === 2) next = null;
  else if (cur === 3) next = 1;
  else if (cur === 1) next = 3;
  else next = 2;
  db.prepare("UPDATE PhuongTien SET TrangThai = ? WHERE BienSo = ?").run(next, bienSo);
  return { success: true, trangThai: next };
});

ipcMain.handle("upsert-phuong-tien", (_event, data) => {
  if (/^[A-Z]{4}/.test(data.BienSo)) data.LoaiXe = "ba_gac";
  const trangThai = data.LoaiXe === "ba_gac" ? 1 : null;
  getDb()
    .prepare(
      `INSERT INTO PhuongTien (BienSo, LoaiXe, MaKH, TrangThai) VALUES (?, ?, ?, ?)
       ON CONFLICT(BienSo) DO UPDATE SET LoaiXe=excluded.LoaiXe, MaKH=excluded.MaKH, TrangThai=CASE WHEN excluded.LoaiXe='ba_gac' THEN 1 ELSE TrangThai END`
    )
    .run(data.BienSo, data.LoaiXe, data.MaKH, trangThai);
  return { success: true };
});

ipcMain.handle("get-xe-cua-kh", (_event, maKH) => {
  return getDb()
    .prepare(`
      SELECT p.BienSo, p.LoaiXe, p.TrangThai, t.TenTrangThai,
             COALESCE(v.TuNgay, p.NgayBatDau) AS TuNgay,
             COALESCE(v.DenNgay, p.NgayHetHan) AS DenNgay
      FROM PhuongTien p
      LEFT JOIN TrangThai t ON t.MaTrangThai = p.TrangThai
      LEFT JOIN VeThang v ON v.BienSo = p.BienSo
        AND v.MaKH = p.MaKH
        AND v.NgayBan = (
          SELECT MAX(v2.NgayBan)
          FROM VeThang v2
          WHERE v2.BienSo = p.BienSo AND v2.MaKH = p.MaKH
        )
      WHERE p.MaKH = ?
      ORDER BY p.BienSo
    `)
    .all(maKH);
});

// ---- IPC: Vé ----

ipcMain.handle("ban-ve", (_event, v) => {
  const result = getDb()
    .prepare(
      `INSERT INTO VeThang (BienSo, MaKH, LoaiVe, KhuVucLuuDau, SoThang, TuNgay, DenNgay, GiaTien, TongTien, SoPhieuThu, NhanVienBan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      v.BienSo, v.MaKH, v.LoaiVe, v.KhuVucLuuDau || null,
      v.SoThang, v.TuNgay, v.DenNgay, v.GiaTien, v.TongTien,
      v.SoPhieuThu || null, v.NhanVienBan || null
    );
  return { MaVe: result.lastInsertRowid };
});

ipcMain.handle("ban-ve-hang-loat", (_event, items) => {
  const db = getDb();
  const upsert = db.prepare(`INSERT INTO PhuongTien (BienSo, LoaiXe, MaKH, TrangThai) VALUES (?, ?, ?, ?)
    ON CONFLICT(BienSo) DO UPDATE SET LoaiXe=excluded.LoaiXe, MaKH=excluded.MaKH, TrangThai=CASE WHEN excluded.LoaiXe='ba_gac' THEN 1 ELSE TrangThai END`);
  const insert = db.prepare(`INSERT INTO VeThang (BienSo, MaKH, LoaiVe, KhuVucLuuDau, SoThang, TuNgay, DenNgay, GiaTien, TongTien, SoPhieuThu, NhanVienBan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const results = [];
  db.transaction(() => {
    for (const v of items) {
      if (/^[A-Z]{4}/.test(v.BienSo)) v.LoaiXe = "ba_gac";
      upsert.run(v.BienSo, v.LoaiXe, v.MaKH, v.LoaiXe === "ba_gac" ? 1 : null);
      const r = insert.run(v.BienSo, v.MaKH, v.LoaiVe, v.KhuVucLuuDau || null,
        v.SoThang, v.TuNgay, v.DenNgay, v.GiaTien, v.TongTien, v.SoPhieuThu || null, v.NhanVienBan || null);
      results.push({ MaVe: r.lastInsertRowid, BienSo: v.BienSo });
    }
  })();
  return results;
});

ipcMain.handle("check-nhap-cho", (_event, { bienSo, thang, nam }) => {
  const checkDate = `${nam}-${String(thang).padStart(2, "0")}-01`;
  return getDb()
    .prepare(
      `SELECT MaVe, TuNgay, DenNgay FROM VeThang
       WHERE BienSo = ? AND LoaiVe = 'nhap_cho'
         AND TuNgay <= ? AND DenNgay >= ?
       LIMIT 1`
    )
    .get(bienSo, checkDate, checkDate) || null;
});

ipcMain.handle("get-ve-by-bien-so", (_event, bienSo) => {
  return getDb()
    .prepare(
      `SELECT v.MaVe, v.BienSo, v.MaKH, kh.TenKH, kh.TenOVua,
              v.LoaiVe, v.KhuVucLuuDau, v.SoThang, v.TuNgay, v.DenNgay,
              v.GiaTien, v.TongTien, v.SoPhieuThu, v.NhanVienBan, v.NgayBan
       FROM VeThang v
       LEFT JOIN KhachHang kh ON kh.MaKH = v.MaKH
       WHERE v.BienSo = ?
       ORDER BY v.TuNgay DESC`
    )
    .all(bienSo);
});

ipcMain.handle("search-ve", (_event, { query, thang, nam }) => {
  const q = `%${query || ""}%`;
  let sql = `
    SELECT v.MaVe, v.BienSo, v.MaKH, kh.TenKH, kh.TenOVua,
           v.LoaiVe, v.KhuVucLuuDau, v.SoThang, v.TuNgay, v.DenNgay,
           v.GiaTien, v.TongTien, v.SoPhieuThu, v.NhanVienBan, v.NgayBan,
           pt.LoaiXe
    FROM VeThang v
    LEFT JOIN KhachHang kh ON kh.MaKH = v.MaKH
    LEFT JOIN PhuongTien pt ON pt.BienSo = v.BienSo
    WHERE (v.BienSo LIKE ? OR kh.TenKH LIKE ? OR kh.TenOVua LIKE ?)
  `;
  const params = [q, q, q];

  if (thang && nam) {
    const firstDay = `${nam}-${String(thang).padStart(2, "0")}-01`;
    const lastDay = new Date(nam, thang, 0);
    const lastDayStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
    sql += " AND v.TuNgay <= ? AND v.DenNgay >= ?";
    params.push(lastDayStr, firstDay);
  }

  sql += " ORDER BY v.TuNgay DESC, v.MaVe DESC";
  return getDb().prepare(sql).all(...params);
});

ipcMain.handle("get-lich-su-kh", (_event, maKH) => {
  return getDb()
    .prepare(
      `SELECT v.MaVe, v.BienSo, v.LoaiVe, v.KhuVucLuuDau,
              v.SoThang, v.TuNgay, v.DenNgay, v.GiaTien, v.TongTien,
              v.SoPhieuThu, v.NhanVienBan, v.NgayBan
       FROM VeThang v
       WHERE v.MaKH = ?
       ORDER BY v.TuNgay DESC, v.MaVe DESC`
    )
    .all(maKH);
});

ipcMain.handle("get-reprint-data", (_event, maVe) => {
  const db = getDb();
  // First get the SoPhieuThu for this ticket
  const ticket = db.prepare(`SELECT SoPhieuThu FROM VeThang WHERE MaVe = ?`).get(maVe);
  if (!ticket) return [];
  // If SoPhieuThu exists, get all tickets with the same SoPhieuThu; otherwise just this one
  if (ticket.SoPhieuThu) {
    return db.prepare(
      `SELECT v.MaVe, v.BienSo, v.LoaiVe, v.KhuVucLuuDau,
              v.SoThang, v.TuNgay, v.DenNgay, v.GiaTien, v.TongTien,
              v.SoPhieuThu, v.NhanVienBan, v.NgayBan, v.MaKH,
              kh.TenKH, kh.TenOVua, pt.LoaiXe
       FROM VeThang v
       LEFT JOIN KhachHang kh ON kh.MaKH = v.MaKH
       LEFT JOIN PhuongTien pt ON pt.BienSo = v.BienSo
       WHERE v.SoPhieuThu = ?
       ORDER BY v.MaVe`
    ).all(ticket.SoPhieuThu);
  } else {
    return db.prepare(
      `SELECT v.MaVe, v.BienSo, v.LoaiVe, v.KhuVucLuuDau,
              v.SoThang, v.TuNgay, v.DenNgay, v.GiaTien, v.TongTien,
              v.SoPhieuThu, v.NhanVienBan, v.NgayBan, v.MaKH,
              kh.TenKH, kh.TenOVua, pt.LoaiXe
       FROM VeThang v
       LEFT JOIN KhachHang kh ON kh.MaKH = v.MaKH
       LEFT JOIN PhuongTien pt ON pt.BienSo = v.BienSo
       WHERE v.MaVe = ?`
    ).all(maVe);
  }
});

// ---- IPC: Tìm kiếm xe ----

ipcMain.handle("search-xe", (_event, query) => {
  const q = `%${(query || "").replace(/[\s-]+/g, "").toUpperCase()}%`;
  return getDb()
    .prepare(
      `SELECT pt.BienSo, pt.LoaiXe, pt.MaKH, kh.TenKH, kh.TenOVua,
              ts.TenTrangThai,
              (SELECT v.DenNgay FROM VeThang v WHERE v.BienSo = pt.BienSo ORDER BY v.DenNgay DESC LIMIT 1) AS DenNgay
       FROM PhuongTien pt
       LEFT JOIN KhachHang kh ON kh.MaKH = pt.MaKH
       LEFT JOIN TrangThai ts ON ts.MaTrangThai = pt.TrangThai
       WHERE REPLACE(REPLACE(pt.BienSo, ' ', ''), '-', '') LIKE ?
       ORDER BY pt.BienSo
       LIMIT 50`
    )
    .all(q);
});

// ---- IPC: Báo cáo ----

ipcMain.handle("bao-cao-theo-thang", (_event, { thang, nam }) => {
  const firstDay = `${nam}-${String(thang).padStart(2, "0")}-01`;
  const lastDay = new Date(nam, thang, 0);
  const lastDayStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;

  const tongHop = getDb()
    .prepare(
      `SELECT pt.LoaiXe, v.LoaiVe, v.KhuVucLuuDau,
              COUNT(*) AS SoVe, SUM(v.TongTien) AS DoanhThu
       FROM VeThang v
       LEFT JOIN PhuongTien pt ON pt.BienSo = v.BienSo
       WHERE v.TuNgay <= ? AND v.DenNgay >= ?
       GROUP BY pt.LoaiXe, v.LoaiVe, v.KhuVucLuuDau
       ORDER BY v.LoaiVe, pt.LoaiXe`
    )
    .all(lastDayStr, firstDay);

  const chiTiet = getDb()
    .prepare(
      `SELECT v.MaVe, v.BienSo, kh.TenKH, kh.TenOVua,
              v.LoaiVe, v.KhuVucLuuDau, pt.LoaiXe,
              v.SoThang, v.TuNgay, v.DenNgay, v.GiaTien, v.TongTien,
              v.SoPhieuThu, v.NgayBan, v.NhanVienBan
       FROM VeThang v
       LEFT JOIN KhachHang kh ON kh.MaKH = v.MaKH
       LEFT JOIN PhuongTien pt ON pt.BienSo = v.BienSo
       WHERE v.TuNgay <= ? AND v.DenNgay >= ?
       ORDER BY v.NgayBan DESC, v.MaVe DESC`
    )
    .all(lastDayStr, firstDay);

  return { tongHop, chiTiet };
});

ipcMain.handle("get-vua-chua-dong", (_event, { thang, nam }) => {
  const firstDay = `${nam}-${String(thang).padStart(2, "0")}-01`;
  const lastDay = new Date(nam, thang, 0);
  const lastDayStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;

  return getDb()
    .prepare(
      `SELECT kh.MaKH, kh.TenKH, kh.TenOVua, kh.SoDienThoai, kh.LaChanh,
              pt.BienSo, pt.LoaiXe
       FROM PhuongTien pt
       JOIN KhachHang kh ON kh.MaKH = pt.MaKH
       WHERE (pt.TrangThai IS NULL OR pt.TrangThai = 2)
         AND NOT EXISTS (
           SELECT 1 FROM VeThang v
           WHERE v.BienSo = pt.BienSo
             AND v.LoaiVe = 'nhap_cho'
             AND v.TuNgay <= ? AND v.DenNgay >= ?
         )
       ORDER BY kh.TenOVua, pt.BienSo`
    )
    .all(lastDayStr, firstDay);
});

// ---- IPC: Xuất Excel ----

const LOAI_XE_MAP = {
  ba_gac: "Ba gác", xe_tai_nho: "Xe tải nhỏ", xe_tai_vua: "Xe tải vừa",
  xe_tai_lon: "Xe tải lớn", xe_dl_vua: "Xe ĐL vừa", xe_dl_lon: "Xe ĐL lớn",
};

function loaiVeText(code) {
  return code === "nhap_cho" ? "Nhập chợ" : code === "luu_dau" ? "Lưu đậu" : code || "";
}

function khuVucText(code) {
  if (!code) return "";
  return code === "tieu_chuan" ? "Tiêu chuẩn" : "Đặc biệt";
}

ipcMain.handle("xuat-excel-bao-cao", async (_event, { thang, nam, tongHop, chiTiet }) => {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Tổng hợp
  const thData = [["Loại xe", "Loại vé", "Khu vực", "Số vé", "Doanh thu"]];
  for (const r of tongHop) {
    thData.push([
      LOAI_XE_MAP[r.LoaiXe] || r.LoaiXe || "",
      loaiVeText(r.LoaiVe),
      khuVucText(r.KhuVucLuuDau),
      r.SoVe,
      r.DoanhThu,
    ]);
  }
  const ws1 = XLSX.utils.aoa_to_sheet(thData);
  ws1["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Tổng hợp");

  // Sheet 2: Chi tiết
  const ctData = [["#", "Biển số", "Khách hàng", "Ô Vựa", "Loại xe", "Loại vé", "Khu vực", "Số tháng", "Từ ngày", "Đến ngày", "Tổng tiền", "Ngày bán", "Nhân viên"]];
  chiTiet.forEach((r, i) => {
    ctData.push([
      i + 1,
      r.BienSo,
      r.TenKH || "",
      r.TenOVua || "",
      LOAI_XE_MAP[r.LoaiXe] || r.LoaiXe || "",
      loaiVeText(r.LoaiVe),
      khuVucText(r.KhuVucLuuDau),
      r.SoThang,
      r.TuNgay,
      r.DenNgay,
      r.TongTien,
      r.NgayBan,
      r.NhanVienBan || "",
    ]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(ctData);
  ws2["!cols"] = [{ wch: 5 }, { wch: 14 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Chi tiết");

  const filePath = path.join(os.tmpdir(), `BaoCao_Thang${thang}_${nam}.xlsx`);
  XLSX.writeFile(wb, filePath);
  shell.openPath(filePath);
  return { success: true, filePath };
});

ipcMain.handle("xuat-excel-chua-dong", async (_event, { thang, nam, danhSach }) => {
  const wb = XLSX.utils.book_new();
  const data = [["#", "Ô Vựa", "Khách hàng", "Biển số"]];
  let idx = 1;
  for (const kh of danhSach) {
    kh.xe.forEach((xe, j) => {
      data.push([
        j === 0 ? idx : "",
        j === 0 ? (kh.TenOVua || "") : "",
        j === 0 ? kh.TenKH : "",
        xe.BienSo,
      ]);
    });
    idx++;
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 5 }, { wch: 20 }, { wch: 20 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, "Chưa đóng tiền");

  const filePath = path.join(os.tmpdir(), `VuaChuaDong_Thang${thang}_${nam}.xlsx`);
  XLSX.writeFile(wb, filePath);
  shell.openPath(filePath);
  return { success: true, filePath };
});

// ---- IPC: In vé ----

function soThanhChu(n) {
  if (n == null || isNaN(n) || n === 0) return "Không đồng";
  const donVi = ["", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
  function docBaChuSo(so) {
    const tram = Math.floor(so / 100);
    const chuc = Math.floor((so % 100) / 10);
    const dv = so % 10;
    let r = "";
    if (tram > 0) {
      r += donVi[tram] + " trăm";
      if (chuc === 0 && dv > 0) r += " lẻ";
    }
    if (chuc > 1) {
      r += " " + donVi[chuc] + " mươi";
      if (dv === 1) r += " mốt";
      else if (dv === 5) r += " lăm";
      else if (dv > 0) r += " " + donVi[dv];
    } else if (chuc === 1) {
      r += " mười";
      if (dv === 5) r += " lăm";
      else if (dv > 0) r += " " + donVi[dv];
    } else if (dv > 0) {
      r += " " + donVi[dv];
    }
    return r.trim();
  }
  let num = Math.round(n);
  let result = "";
  if (num >= 1000000000) {
    result += docBaChuSo(Math.floor(num / 1000000000)) + " tỷ, ";
    num %= 1000000000;
  }
  if (num >= 1000000) {
    result += docBaChuSo(Math.floor(num / 1000000)) + " triệu, ";
    num %= 1000000;
  }
  if (num >= 1000) {
    result += docBaChuSo(Math.floor(num / 1000)) + " ngàn, ";
    num %= 1000;
  }
  if (num > 0) {
    result += docBaChuSo(num);
  }
  result = result.replace(/,\s*$/, "").trim();
  return result.charAt(0).toUpperCase() + result.slice(1) + " đồng chẵn";
}

function buildTicketHtml(data) {
  const items = Array.isArray(data) ? data : [data];
  const first = items[0];
  const loaiXeRows = getDb().prepare("SELECT MaLoaiXe, TenLoaiXe FROM LoaiXe").all();
  const loaiXeMap = Object.fromEntries(loaiXeRows.map(r => [r.MaLoaiXe, r.TenLoaiXe]));
  const loaiXeLabel = (c) => loaiXeMap[c] || c || "—";
  const fmtDate = (s) => {
    if (!s) return "—";
    const d = new Date(s);
    if (isNaN(d)) return s;
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  };
  const fmtMoney = (v) => v != null ? Number(v).toLocaleString("vi-VN") : "—";
  const ngayGoc = first.NgayBan ? new Date(first.NgayBan) : new Date();
  const now = isNaN(ngayGoc) ? new Date() : ngayGoc;
  const ngayIn = `HCM, ngày ${String(now.getDate()).padStart(2,"0")} tháng ${String(now.getMonth()+1).padStart(2,"0")} năm ${now.getFullYear()}`;
  const soDangKy = first.SoPhieuThu || `HDB${String(now.getDate()).padStart(2,"0")}${String(now.getMonth()+1).padStart(2,"0")}${now.getFullYear()}-${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}${String(now.getSeconds()).padStart(2,"0")}`;

  const tongCong = items.reduce((sum, t) => sum + (t.TongTien || 0), 0);

  const rowsHtml = items.map((t, i) => `
      <tr>
        <td>${i + 1}</td>
        <td style="text-align:left">${loaiXeLabel(t.LoaiXe)}</td>
        <td style="text-align:left">${t.BienSo}</td>
        <td></td>
        <td>${t.SoThang}</td>
        <td style="text-align:right">${fmtMoney(t.DonGiaGoc || t.GiaTien)}</td>
        <td>${t.GiamGia ? t.GiamGia + '%' : ''}</td>
        <td style="text-align:right">${fmtMoney(t.TongTien)}</td>
        <td>${fmtDate(t.TuNgay)}</td>
        <td>${fmtDate(t.DenNgay)}</td>
      </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A5 landscape; margin: 6mm 8mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 14px;
    color: #000;
    width: 210mm;
    height: 148mm;
    padding: 4mm 6mm;
  }
  .header { display: flex; justify-content: space-between; margin-bottom: 3mm; }
  .header-left { font-size: 13px; font-weight: bold; text-align: center; line-height: 1.4; }
  .header-right { font-size: 13px; font-weight: bold; text-align: center; line-height: 1.4; }
  .header-right .sub { font-size: 12px; font-weight: normal; font-style: italic; }
  .main-title { text-align: center; font-size: 18px; font-weight: bold; margin: 3mm 0 3mm; letter-spacing: 1px; }
  .info-section { margin-bottom: 2mm; line-height: 1.6; font-size: 14px; }
  .info-row { display: flex; gap: 4mm; }
  .info-row .label { font-weight: normal; }
  .info-row .value { font-weight: normal; }
  table { width: 100%; border-collapse: collapse; margin-top: 1mm; font-size: 13px; }
  th, td { border: 1px solid #000; padding: 3px 5px; text-align: center; }
  th { font-weight: bold; background: #f5f5f5; font-size: 12px; }
  td { font-size: 13px; }
  .dvt { text-align: right; font-size: 11px; margin-bottom: 1px; }
  .total-row { text-align: right; font-weight: bold; padding-right: 4px; }
  .bangchu { margin-top: 2mm; font-size: 14px; }
  .bangchu .label { font-weight: bold; font-style: italic; }
  .signatures { display: flex; justify-content: space-between; margin-top: 5mm; text-align: center; font-size: 13px; }
  .sig-block { width: 30%; }
  .sig-title { font-weight: bold; margin-bottom: 2mm; }
  .sig-name { margin-top: 12mm; font-weight: bold; }
  .sig-date { font-style: italic; font-size: 12px; margin-bottom: 1mm; }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      CTY CP QL &amp; KD<br>
      CHỢ NÔNG SẢN THỦ ĐỨC<br>
      BP.IT - DỊCH VỤ
    </div>
    <div class="header-right">
      CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM<br>
      <span class="sub">Độc Lập - Tự Do - Hạnh Phúc</span>
    </div>
  </div>

  <div class="main-title">ĐĂNG KÝ DỊCH VỤ NHẬP CHỢ</div>

  <div class="info-section">
    <div>Số Đăng ký: <b>${soDangKy}</b></div>
    <div class="info-row">
      <span>Tên khách hàng: <b>${first.TenKH || "—"}</b></span>
      ${first.TenOVua ? `<span style="margin-left:10mm;">Vựa: <b>${first.TenOVua}</b></span>` : ""}
    </div>
  </div>

  <div class="dvt">ĐVT: VNĐ</div>
  <table>
    <thead>
      <tr>
        <th style="width:6%">STT</th>
        <th style="width:13%">Loại xe</th>
        <th style="width:14%">Số xe</th>
        <th style="width:10%">Tải trọng</th>
        <th style="width:8%">Số tháng</th>
        <th style="width:11%">Đơn giá</th>
        <th style="width:9%">Giảm giá(%)</th>
        <th style="width:12%">Thành tiền</th>
        <th style="width:9%">TG Bắt Đầu</th>
        <th style="width:9%">TG Kết Thúc</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr>
        <td colspan="7" class="total-row">Tổng tiền:</td>
        <td style="text-align:right; font-weight:bold">${fmtMoney(tongCong)}</td>
        <td colspan="2"></td>
      </tr>
    </tbody>
  </table>

  <div class="bangchu">
    <span class="label">Bằng chữ:</span> ${soThanhChu(tongCong)}
  </div>

  <div class="signatures">
    <div class="sig-block">
      <div class="sig-title">BP. ITDV</div>
      <div class="sig-name">&nbsp;</div>
    </div>
    <div class="sig-block">
      <div class="sig-title">Người nộp tiền</div>
      <div class="sig-name">&nbsp;</div>
    </div>
    <div class="sig-block">
      <div class="sig-date">${ngayIn}</div>
      <div class="sig-title">Nhân viên lập phiếu</div>
      <div class="sig-name">${first.NhanVienBan || "&nbsp;"}</div>
    </div>
  </div>
</body>
</html>`;
}

ipcMain.handle("print-ticket", async (_event, ticket) => {
  const html = buildTicketHtml(ticket);

  const previewHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<title>Xem trước vé</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #e0e0e0; display: flex; flex-direction: column; align-items: center; height: 100vh; font-family: Arial, sans-serif; }
  .toolbar { width: 100%; background: #333; color: #fff; padding: 8px 16px; display: flex; gap: 10px; align-items: center; flex-shrink: 0; }
  .toolbar button { padding: 6px 18px; font-size: 14px; border: none; border-radius: 4px; cursor: pointer; }
  .btn-print { background: #4CAF50; color: #fff; }
  .btn-print:hover { background: #45a049; }
  .btn-cancel { background: #f44336; color: #fff; }
  .btn-cancel:hover { background: #d32f2f; }
  .preview-container { flex: 1; overflow: auto; padding: 20px; display: flex; justify-content: center; }
  iframe { background: #fff; border: none; box-shadow: 0 2px 10px rgba(0,0,0,0.3); width: 210mm; height: 148mm; }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="btn-print" id="btnPrint">In vé</button>
    <button class="btn-cancel" id="btnCancel">Đóng</button>
  </div>
  <div class="preview-container">
    <iframe id="ticketFrame"></iframe>
  </div>
  <script>
    const iframe = document.getElementById('ticketFrame');
    const ticketHtml = decodeURIComponent("${encodeURIComponent(html)}");
    iframe.srcdoc = ticketHtml;

    document.getElementById('btnPrint').addEventListener('click', async () => {
      const btn = document.getElementById('btnPrint');
      btn.textContent = 'Đang in...';
      btn.disabled = true;
      try {
        await window.printApi.printSilent();
        window.close();
      } catch (e) {
        btn.textContent = 'In vé';
        btn.disabled = false;
        alert('In thất bại: ' + e.message);
      }
    });
    document.getElementById('btnCancel').addEventListener('click', () => {
      window.close();
    });
  </script>
</body>
</html>`;

  const printPreload = path.join(__dirname, "preload-print.js");
  const win = new BrowserWindow({
    width: 1000,
    height: 750,
    title: "Xem trước vé",
    webPreferences: { preload: printPreload, contextIsolation: true, nodeIntegration: false },
  });

  ipcMain.handleOnce("print-silent", async () => {
    // In nội dung iframe bằng cách load HTML vé vào cửa sổ ẩn
    const printWin = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
    await printWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    return new Promise((resolve) => {
      printWin.webContents.print({ silent: true, printBackground: true }, (success) => {
        printWin.close();
        resolve({ success });
      });
    });
  });

  win.on("closed", () => {
    ipcMain.removeHandler("print-silent");
  });

  win.setMenuBarVisibility(false);
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(previewHtml));

  return { success: true };
});

// ---- Backup & Restore ----

ipcMain.handle("backup-database", async () => {
  const dbPath = isProd
    ? path.join(app.getPath("userData"), "ban-ve-thang.db")
    : path.join(__dirname, "ban-ve-thang.db");

  const { filePath, canceled } = await dialog.showSaveDialog({
    title: "Sao lưu cơ sở dữ liệu",
    defaultPath: path.join(
      app.getPath("desktop"),
      `ban-ve-thang-backup-${new Date().toISOString().slice(0, 10)}.db`
    ),
    filters: [{ name: "SQLite Database", extensions: ["db"] }],
  });

  if (canceled || !filePath) return { success: false, canceled: true };

  try {
    // Use SQLite backup API for safe copy while DB is open
    const database = getDb();
    await database.backup(filePath);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle("restore-database", async () => {
  const dbPath = isProd
    ? path.join(app.getPath("userData"), "ban-ve-thang.db")
    : path.join(__dirname, "ban-ve-thang.db");

  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: "Khôi phục cơ sở dữ liệu",
    filters: [{ name: "SQLite Database", extensions: ["db"] }],
    properties: ["openFile"],
  });

  if (canceled || !filePaths.length) return { success: false, canceled: true };

  const srcPath = filePaths[0];

  try {
    // Validate the selected file is a valid SQLite database
    const testDb = new Database(srcPath, { readonly: true });
    const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    testDb.close();

    const required = ["KhachHang", "PhuongTien", "VeThang"];
    const missing = required.filter(t => !tables.includes(t));
    if (missing.length) {
      return { success: false, message: `File không hợp lệ. Thiếu bảng: ${missing.join(", ")}` };
    }

    // Checkpoint WAL của file nguồn để đảm bảo mọi dữ liệu đã được flush
    // vào file .db chính trước khi copy. Tránh mất dữ liệu nếu user chọn
    // file backup được copy thủ công kèm WAL chưa checkpoint.
    try {
      const srcDb = new Database(srcPath);
      srcDb.pragma("wal_checkpoint(TRUNCATE)");
      srcDb.close();
    } catch (e) {
      return { success: false, message: `Không thể checkpoint WAL của file nguồn: ${e.message}` };
    }

    // Close current database
    if (db) { db.close(); db = null; }

    // Create backup of current DB before restoring
    const backupPath = dbPath + ".before-restore";
    fs.copyFileSync(dbPath, backupPath);

    // Copy the selected file over current DB
    fs.copyFileSync(srcPath, dbPath);

    // Remove WAL/SHM files to avoid conflicts
    try { fs.unlinkSync(dbPath + "-wal"); } catch (_) {}
    try { fs.unlinkSync(dbPath + "-shm"); } catch (_) {}

    // Reopen database (will run migrations)
    getDb();

    // Cleanup pre-restore safety copy on success
    try { fs.unlinkSync(backupPath); } catch (_) {}

    return { success: true, filePath: srcPath };
  } catch (err) {
    // Try to recover from backup
    try {
      const backupPath = dbPath + ".before-restore";
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, dbPath);
      }
    } catch (_) {}
    // Always try to reopen DB so app remains usable
    try { if (!db) getDb(); } catch (_) {}
    return { success: false, message: err.message };
  }
});

// ---- Auto Updater ----

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function setupAutoUpdater(win) {
  autoUpdater.on("update-available", (info) => {
    win.webContents.send("update-available", info.version);
  });
  autoUpdater.on("update-not-available", () => {
    win.webContents.send("update-not-available");
  });
  autoUpdater.on("download-progress", (progress) => {
    win.webContents.send("update-download-progress", Math.round(progress.percent));
  });
  autoUpdater.on("update-downloaded", () => {
    win.webContents.send("update-downloaded");
  });
  autoUpdater.on("error", (err) => {
    win.webContents.send("update-error", err.message);
  });
  if (isProd) {
    // Chờ renderer load xong + 1s buffer để setupAutoUpdate() kịp attach
    // các IPC listener trước khi autoUpdater bắn event update-available.
    win.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => {
          console.error("Auto-update check failed:", err);
        });
      }, 1000);
    });
  }
}

ipcMain.handle("update-download", () => autoUpdater.downloadUpdate());

ipcMain.handle("update-install", () => {
  if (db) { db.close(); db = null; }
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle("update-check", () => {
  autoUpdater.checkForUpdates().catch(() => {});
});

// ---- App lifecycle (Single Instance) ----

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (process.platform === "darwin") {
      app.dock.setIcon(path.join(__dirname, "assets", "icon.png"));
    }
    getDb(); // init schema ngay khi khởi động
    mainWindow = createWindow();
    setupAutoUpdater(mainWindow);
  });

  app.on("window-all-closed", () => {
    if (db) { db.close(); db = null; }
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
}
