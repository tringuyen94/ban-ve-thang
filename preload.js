const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Config
  getBangGia: () => ipcRenderer.invoke("get-bang-gia"),
  testConnection: () => ipcRenderer.invoke("test-connection"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),

  // Loại xe
  getLoaiXeList: () => ipcRenderer.invoke("get-loai-xe-list"),

  // Khách hàng
  getKhachHangList: () => ipcRenderer.invoke("get-khach-hang-list"),
  searchKhachHang: (query) => ipcRenderer.invoke("search-khach-hang", query),
  addKhachHang: (data) => ipcRenderer.invoke("add-khach-hang", data),
  updateKhachHang: (data) => ipcRenderer.invoke("update-khach-hang", data),
  deleteKhachHang: (maKH) => ipcRenderer.invoke("delete-khach-hang", maKH),

  // Phương tiện
  getPhuongTien: (bienSo) => ipcRenderer.invoke("get-phuong-tien", bienSo),
  upsertPhuongTien: (data) => ipcRenderer.invoke("upsert-phuong-tien", data),
  getXeCuaKH: (maKH) => ipcRenderer.invoke("get-xe-cua-kh", maKH),
  toggleMienPhiLuuDau: (bienSo) => ipcRenderer.invoke("toggle-mien-phi-luu-dau", bienSo),

  // Vé
  banVe: (veData) => ipcRenderer.invoke("ban-ve", veData),
  banVeHangLoat: (items) => ipcRenderer.invoke("ban-ve-hang-loat", items),
  checkNhapCho: (params) => ipcRenderer.invoke("check-nhap-cho", params),
  checkTrungVe: (items) => ipcRenderer.invoke("check-trung-ve", items),
  getVeByBienSo: (bienSo) => ipcRenderer.invoke("get-ve-by-bien-so", bienSo),
  searchVe: (params) => ipcRenderer.invoke("search-ve", params),
  getLichSuKH: (maKH) => ipcRenderer.invoke("get-lich-su-kh", maKH),
  getReprintData: (maVe) => ipcRenderer.invoke("get-reprint-data", maVe),

  // Tìm kiếm xe
  searchXe: (query) => ipcRenderer.invoke("search-xe", query),

  // Báo cáo
  baoCaoTheoThang: (params) => ipcRenderer.invoke("bao-cao-theo-thang", params),
  getVuaChuaDong: (params) => ipcRenderer.invoke("get-vua-chua-dong", params),

  // Xuất Excel
  xuatExcelBaoCao: (data) => ipcRenderer.invoke("xuat-excel-bao-cao", data),
  xuatExcelChuaDong: (data) => ipcRenderer.invoke("xuat-excel-chua-dong", data),

  // In vé
  printTicket: (data) => ipcRenderer.invoke("print-ticket", data),

  // Backup & Restore
  backupDatabase: () => ipcRenderer.invoke("backup-database"),
  restoreDatabase: () => ipcRenderer.invoke("restore-database"),

  // Auto-updater
  onUpdateAvailable: (cb) => ipcRenderer.on("update-available", (_e, version) => cb(version)),
  onUpdateNotAvailable: (cb) => ipcRenderer.on("update-not-available", () => cb()),
  onUpdateDownloadProgress: (cb) => ipcRenderer.on("update-download-progress", (_e, percent) => cb(percent)),
  onUpdateDownloaded: (cb) => ipcRenderer.on("update-downloaded", () => cb()),
  onUpdateError: (cb) => ipcRenderer.on("update-error", (_e, msg) => cb(msg)),
  downloadUpdate: () => ipcRenderer.invoke("update-download"),
  installUpdate: () => ipcRenderer.invoke("update-install"),
  checkForUpdate: () => ipcRenderer.invoke("update-check"),
});
