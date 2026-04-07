// ===== Global state =====

let bangGia = {};
let allKhachHang = [];
let currentKH = null;        // { MaKH, TenKH, TenOVua, GhiChu }
let editingKH = null;        // KH đang sửa trong modal

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function populateNamSelect(id) {
  const sel = $(`#${id}`);
  const curYear = new Date().getFullYear();
  sel.innerHTML = "";
  for (let y = curYear - 1; y <= curYear + 1; y++) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  }
  sel.value = curYear;
}

// ===== Theme =====

(function initTheme() {
  const saved = localStorage.getItem("theme");
  if (saved === "dark") document.documentElement.setAttribute("data-theme", "dark");
})();

function setupThemeToggle() {
  $("#themeToggle").addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    }
  });
}

// ===== Helpers =====

function isBaGacPlate(bienSo) {
  return /^[A-Z]{4}/.test(bienSo);
}

function removeTones(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function formatDate(val) {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatMoney(val) {
  if (val === null || val === undefined || val === "") return "—";
  return Number(val).toLocaleString("vi-VN") + " đ";
}

function endOfMonth(year, month) {
  return new Date(year, month, 0); // month là 1-based, new Date(y, m, 0) = last day
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function showToast(msg, type = "success") {
  const toast = $("#toast");
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove("show"), 3500);
}

let loaiXeMap = {};  // { MaLoaiXe: TenLoaiXe } – loaded from DB
let allLoaiXe = []; // [{ MaLoaiXe, TenLoaiXe, ThuTu }]

function loaiXeLabel(code) {
  return loaiXeMap[code] || code || "—";
}

function populateLoaiXeSelects() {
  const selects = document.querySelectorAll("#bl-newLoaiXe");
  selects.forEach(sel => {
    const current = sel.value;
    // Keep the first "-- Chọn --" option, remove the rest
    while (sel.options.length > 1) sel.remove(1);
    allLoaiXe.forEach(lx => {
      const opt = document.createElement("option");
      opt.value = lx.MaLoaiXe;
      opt.textContent = lx.TenLoaiXe;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  });
}

function loaiVeLabel(code) {
  return code === "nhap_cho" ? "Nhập chợ" : code === "luu_dau" ? "Lưu đậu" : code || "—";
}

function khuVucLabel(code) {
  if (!code) return "—";
  return code === "tieu_chuan" ? "Tiêu chuẩn" : "Đặc biệt";
}

// ===== Tabs =====

function setupTabs() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((t) => t.classList.remove("active"));
      $$(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const panelId = "panel-" + tab.dataset.tab;
      const panel = document.getElementById(panelId);
      if (panel) panel.classList.add("active");
    });
  });
}

// ===== Init =====

async function init() {
  setupThemeToggle();
  setupTabs();

  const conn = await window.api.testConnection();
  const statusEl = $("#connStatus");
  if (conn.success) {
    statusEl.textContent = "Đã kết nối";
    statusEl.className = "connection-status connected";
  } else {
    statusEl.textContent = "Lỗi kết nối";
    statusEl.className = "connection-status error";
    showToast("Không thể kết nối SQL Server: " + conn.message, "error");
  }

  const version = await window.api.getAppVersion();
  $("#appVersion").textContent = `v${version}`;

  bangGia = await window.api.getBangGia();

  // Load danh sách loại xe từ DB
  allLoaiXe = await window.api.getLoaiXeList();
  loaiXeMap = Object.fromEntries(allLoaiXe.map(r => [r.MaLoaiXe, r.TenLoaiXe]));
  populateLoaiXeSelects();

  setupBanVeHangLoat();
  setupTimXeTab();
  setupKhachHangTab();
  setupBaoCaoTab();
  setupModalKH();
  setupAutoUpdate();
  setupBackup();

  // Load KH list ngay từ đầu (cần cho autocomplete bán vé + tab KH)
  await loadKhachHangList();
}

// ===========================
// ===== TAB 1: BÁN VÉ ======
// ===========================

function renderKHDropdown(dropdown, items, onSelect) {
  dropdown.innerHTML = "";
  if (items.length === 0) {
    dropdown.innerHTML = '<div class="autocomplete-item" style="color:var(--text-tertiary)">Không tìm thấy</div>';
    dropdown.classList.add("open");
    return;
  }
  items.forEach((kh) => {
    const div = document.createElement("div");
    div.className = "autocomplete-item" + (kh.LaChanh ? " is-chanh" : "");
    div.innerHTML = `<div class="ac-name">${kh.TenOVua || kh.TenKH}</div>${kh.TenOVua ? `<div class="ac-sub">${kh.TenKH}</div>` : ""}`;
    div.addEventListener("click", () => onSelect(kh));
    dropdown.appendChild(div);
  });
  dropdown.classList.add("open");
}

function closeDropdown(dropdown) {
  dropdown.classList.remove("open");
}

// ===================================
// ===== BÁN VÉ (unified) ============
// ===================================

let blSelectedKH = null;
let blXeRows = [];   // [{ id, bienSo, loaiXe, checked, isNew }]
let blNextId = 0;
let blSearchDebounce = null;

function setupBanVeHangLoat() {
  const khSearch = $("#bl-khSearch");
  const khDropdown = $("#bl-khDropdown");

  khSearch.addEventListener("input", () => {
    clearTimeout(blSearchDebounce);
    blSearchDebounce = setTimeout(() => {
      const q = khSearch.value.trim();
      if (!q) {
        closeDropdown(khDropdown);
        blSelectedKH = null;
        $("#bl-khHint").textContent = "";
        return;
      }
      const qNorm = removeTones(q.toLowerCase());
      const filtered = allKhachHang
        .filter((kh) => {
          const name = removeTones((kh.TenKH || "").toLowerCase());
          const shop = removeTones((kh.TenOVua || "").toLowerCase());
          return shop.includes(qNorm) || name.includes(qNorm);
        })
        .sort((a, b) => {
          const aShop = removeTones((a.TenOVua || "").toLowerCase()).includes(qNorm) ? 0 : 1;
          const bShop = removeTones((b.TenOVua || "").toLowerCase()).includes(qNorm) ? 0 : 1;
          return aShop - bShop;
        });
      renderKHDropdown(khDropdown, filtered, (kh) => {
        blSelectedKH = kh;
        khSearch.value = (kh.TenOVua || kh.TenKH) + (kh.TenOVua ? ` (${kh.TenKH})` : "");
        $("#bl-khHint").textContent = `MaKH: ${kh.MaKH}` + (kh.LaChanh ? " (Chành −50%)" : "");
        closeDropdown(khDropdown);
        blLoadXe(kh.MaKH);
        blUpdateSummary();
      });
    }, 200);
  });

  khSearch.addEventListener("focus", () => {
    if (!blSelectedKH && allKhachHang.length > 0) {
      renderKHDropdown(khDropdown, allKhachHang.slice(0, 10), (kh) => {
        blSelectedKH = kh;
        khSearch.value = (kh.TenOVua || kh.TenKH) + (kh.TenOVua ? ` (${kh.TenKH})` : "");
        $("#bl-khHint").textContent = `MaKH: ${kh.MaKH}` + (kh.LaChanh ? " (Chành −50%)" : "");
        closeDropdown(khDropdown);
        blLoadXe(kh.MaKH);
        blUpdateSummary();
      });
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocomplete-wrapper")) closeDropdown(khDropdown);
  });

  // Check all
  $("#bl-checkAll").addEventListener("change", (e) => {
    blXeRows.forEach((r) => { r.checked = e.target.checked; });
    blRenderXeTable();
    blUpdateSummary();
  });

  // Loại vé → show/hide khu vực
  $("#bl-loaiVe").addEventListener("change", () => {
    const loaiVe = $("#bl-loaiVe").value;
    $("#bl-khuVucGroup").style.display = loaiVe === "luu_dau" ? "" : "none";
    blUpdateSummary();
  });
  $("#bl-khuVuc").addEventListener("change", blUpdateSummary);

  // Tháng/Năm & số tháng
  populateNamSelect("bl-nam");
  $("#bl-thang").addEventListener("change", () => { blCalcDenNgay(); blUpdateSummary(); });
  $("#bl-nam").addEventListener("change", () => { blCalcDenNgay(); blUpdateSummary(); });
  $("#bl-soThang").addEventListener("input", () => {
    blCalcDenNgay();
    blUpdateSummary();
  });

  // Set default tháng/năm
  const blNow = new Date();
  $("#bl-thang").value = blNow.getMonth() + 1;
  $("#bl-nam").value = blNow.getFullYear();
  blCalcDenNgay();

  // Set default tháng/năm cho báo cáo
  $("#bc-thang").value = blNow.getMonth() + 1;
  $("#bc-nam").value = blNow.getFullYear();

  // Auto-fill loại xe khi nhập biển số mới (lookup DB)
  let blBienSoDebounce = null;
  $("#bl-newBienSo").addEventListener("input", () => {
    clearTimeout(blBienSoDebounce);
    blBienSoDebounce = setTimeout(async () => {
      const bs = $("#bl-newBienSo").value.trim().replace(/[\s-]+/g, '').toUpperCase();
      const loaiXeSelect = $("#bl-newLoaiXe");
      if (!bs) {
        $("#bl-newBienSoHint").textContent = "";
        loaiXeSelect.disabled = false;
        return;
      }
      if (isBaGacPlate(bs)) {
        loaiXeSelect.value = "ba_gac";
        loaiXeSelect.disabled = true;
        $("#bl-newBienSoHint").textContent = "Biển số chữ → Ba gác";
      } else {
        loaiXeSelect.disabled = false;
      }
      try {
        const pt = await window.api.getPhuongTien(bs);
        if (pt) {
          if (!isBaGacPlate(bs) && pt.LoaiXe) loaiXeSelect.value = pt.LoaiXe;
          $("#bl-newBienSoHint").textContent = isBaGacPlate(bs)
            ? "Biển số chữ → Ba gác"
            : `Xe đã có trong hệ thống (${loaiXeLabel(pt.LoaiXe)})`;
        } else if (!isBaGacPlate(bs)) {
          $("#bl-newBienSoHint").textContent = "";
          loaiXeSelect.value = "";
        }
      } catch (_) {}
    }, 400);
  });

  // Add xe
  $("#bl-btnAddXe").addEventListener("click", blAddNewRow);
  $("#bl-newBienSo").addEventListener("keydown", (e) => {
    if (e.key === "Enter") blAddNewRow();
  });

  // Buttons
  $("#bl-btnBan").addEventListener("click", doBanVeHangLoat);
  $("#bl-btnReset").addEventListener("click", blReset);
}

async function blLoadXe(maKH) {
  try {
    const xeList = await window.api.getXeCuaKH(maKH);
    blNextId = 0;
    blXeRows = xeList.map((xe) => ({
      id: blNextId++,
      bienSo: xe.BienSo,
      loaiXe: xe.LoaiXe,
      trangThai: xe.TrangThai || null,
      checked: true,
      isNew: false,
    }));
    blRenderXeTable();
    blUpdateCheckAll();
    $("#bl-xeCard").style.display = "";
    $("#bl-paramCard").style.display = "";
    $("#bl-confirmCard").style.display = "";
    blUpdateSummary();
  } catch (err) {
    showToast("Lỗi tải xe: " + err.message, "error");
  }
}

function blRenderXeTable() {
  const tbody = $("#bl-xeTbody");
  tbody.innerHTML = "";

  if (blXeRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-tertiary);padding:20px">Chưa có xe. Thêm xe bên dưới.</td></tr>';
    return;
  }

  blXeRows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;

    const optionsHtml = allLoaiXe.map(
      (o) => `<option value="${o.MaLoaiXe}"${row.loaiXe === o.MaLoaiXe ? " selected" : ""}>${o.TenLoaiXe}</option>`
    ).join("");

    const discount = blGetChanhDiscount();
    const giaNhapCho = blGetGia(row.loaiXe, 'nhap_cho', null);
    const giaLuuDau = blGetGia(row.loaiXe, 'luu_dau', 'tieu_chuan');
    const nhapChoText = giaNhapCho !== null ? formatMoney(Math.round(giaNhapCho * discount)) : '—';
    const isXeTai = row.loaiXe && row.loaiXe.startsWith("xe_tai");
    const mienPhiLD = blMienPhiLuuDau(row.trangThai);
    const luuDauText = mienPhiLD ? 'Miễn phí' : (giaLuuDau !== null ? formatMoney(Math.round(giaLuuDau * discount)) : '—');
    const toggleHtml = (isXeTai && !row.isNew) ? `<label class="bl-mp-toggle" style="margin-left:8px;cursor:pointer;display:inline-flex;align-items:center;vertical-align:middle"><input type="checkbox" class="bl-toggle-mp" ${mienPhiLD ? 'checked' : ''} style="display:none"><span class="bl-mp-slider"></span></label>` : '';

    tr.innerHTML = `
      <td><input type="checkbox" ${row.checked ? "checked" : ""} /></td>
      <td><strong>${row.bienSo}</strong>${row.isNew ? ' <span class="badge badge-warning" style="font-size:10px">Mới</span>' : ""}</td>
      <td>
        <select style="padding:4px 8px;font-size:12px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)">
          <option value="">-- Chọn --</option>
          ${optionsHtml}
        </select>
      </td>
      <td style="text-align:right;white-space:nowrap">${nhapChoText}</td>
      <td style="text-align:right;white-space:nowrap"><span style="display:inline-flex;align-items:center;gap:4px">${luuDauText}${toggleHtml}</span></td>
      <td style="text-align:center">
        <button class="btn btn-danger btn-sm" style="padding:3px 8px">✕</button>
      </td>
    `;

    tr.querySelector('input[type="checkbox"]').addEventListener("change", (e) => {
      row.checked = e.target.checked;
      blUpdateCheckAll();
      blUpdateXeSummary();
      blUpdateSummary();
    });

    const tdNhapCho = tr.querySelectorAll("td")[3];
    const tdLuuDau = tr.querySelectorAll("td")[4];
    tr.querySelector("select").addEventListener("change", (e) => {
      row.loaiXe = e.target.value;
      blRenderXeTable();
      blUpdateCheckAll();
      blUpdateSummary();
    });

    const toggleMpCb = tr.querySelector(".bl-toggle-mp");
    if (toggleMpCb) {
      toggleMpCb.addEventListener("change", async () => {
        try {
          const res = await window.api.toggleMienPhiLuuDau(row.bienSo);
          if (res.success) {
            row.trangThai = res.trangThai;
            blRenderXeTable();
            blUpdateCheckAll();
            blUpdateSummary();
            showToast(`${row.bienSo}: ${blMienPhiLuuDau(res.trangThai) ? 'Bật' : 'Tắt'} miễn phí lưu đậu`, "success");
          }
        } catch (err) {
          showToast("Lỗi: " + err.message, "error");
        }
      });
    }

    tr.querySelector(".btn-danger").addEventListener("click", () => {
      blXeRows = blXeRows.filter((r) => r.id !== row.id);
      blRenderXeTable();
      blUpdateCheckAll();
      blUpdateSummary();
    });

    tbody.appendChild(tr);
  });

  blUpdateXeSummary();
}

function blUpdateXeSummary() {
  const el = $("#bl-xeSummary");
  if (blXeRows.length === 0) { el.style.display = "none"; return; }
  const checked = blXeRows.filter(r => r.checked);
  const baGac = checked.filter(r => r.loaiXe === "ba_gac").length;
  const xeTai = checked.filter(r => r.loaiXe && r.loaiXe.startsWith("xe_tai")).length;
  el.textContent = `Đã chọn: ${checked.length}/${blXeRows.length} xe (${xeTai} xe tải, ${baGac} ba gác)`;
  el.style.display = "";
}

function blUpdateCheckAll() {
  const checkAll = $("#bl-checkAll");
  if (!checkAll) return;
  const allChecked = blXeRows.length > 0 && blXeRows.every((r) => r.checked);
  const anyChecked = blXeRows.some((r) => r.checked);
  checkAll.checked = allChecked;
  checkAll.indeterminate = !allChecked && anyChecked;
}

function blAddNewRow() {
  const bienSoInput = $("#bl-newBienSo");
  const loaiXeSelect = $("#bl-newLoaiXe");
  const bienSo = bienSoInput.value.trim().replace(/[\s-]+/g, '').toUpperCase();
  const loaiXe = isBaGacPlate(bienSo) ? "ba_gac" : loaiXeSelect.value;

  if (!bienSo) { showToast("Nhập biển số xe mới", "error"); return; }
  if (!loaiXe) { showToast("Chọn loại xe", "error"); return; }
  if (blXeRows.some((r) => r.bienSo === bienSo)) {
    showToast("Biển số này đã có trong danh sách", "error"); return;
  }

  blXeRows.push({ id: blNextId++, bienSo, loaiXe, checked: true, isNew: true });
  bienSoInput.value = "";
  loaiXeSelect.value = "";
  loaiXeSelect.disabled = false;
  $("#bl-newBienSoHint").textContent = "";
  blRenderXeTable();
  blUpdateCheckAll();
  blUpdateSummary();
}

function blCalcDenNgay() {
  const thang = parseInt($("#bl-thang").value, 10);
  const nam = parseInt($("#bl-nam").value, 10);
  const soThang = parseInt($("#bl-soThang").value, 10) || 1;
  if (!thang || !nam) { $("#bl-denNgay").value = ""; return null; }
  const endMonth = (thang - 1) + soThang - 1;
  const endYear = nam + Math.floor(endMonth / 12);
  const lastMonth = endMonth % 12;
  const den = endOfMonth(endYear, lastMonth + 1);
  $("#bl-denNgay").value = formatDate(den);
  return den;
}

function blGetGia(loaiXe, loaiVe, khuVuc) {
  if (!loaiXe || !loaiVe) return null;
  if (loaiVe === "nhap_cho") return bangGia.nhap_cho?.[loaiXe] ?? null;
  if (loaiVe === "luu_dau") return bangGia.luu_dau?.[khuVuc]?.[loaiXe] ?? null;
  return null;
}

function blGetChanhDiscount() {
  return (blSelectedKH && blSelectedKH.LaChanh) ? 0.5 : 1;
}

function blMienPhiLuuDau(trangThai) {
  return trangThai === 2 || trangThai === 3;
}

function blUpdateSummary() {
  const loaiVe = $("#bl-loaiVe").value;
  const khuVuc = $("#bl-khuVuc").value;
  const soThang = parseInt($("#bl-soThang").value, 10) || 1;
  const checkedRows = blXeRows.filter((r) => r.checked && r.loaiXe);
  const discount = blGetChanhDiscount();

  let total = 0;
  let valid = true;
  for (const r of checkedRows) {
    if (loaiVe === "luu_dau" && blMienPhiLuuDau(r.trangThai)) continue;
    const giaGoc = blGetGia(r.loaiXe, loaiVe, khuVuc);
    if (giaGoc === null) { valid = false; break; }
    total += Math.round(giaGoc * discount) * soThang;
  }

  $("#bl-soXe").textContent = checkedRows.length;
  const moneyText = (valid && checkedRows.length > 0) ? formatMoney(total) : "—";
  $("#bl-tongTien").textContent = (discount < 1 && valid && checkedRows.length > 0)
    ? moneyText + " (−50% chành)"
    : moneyText;
}

async function doBanVeHangLoat() {
  if (!blSelectedKH) { showToast("Vui lòng chọn khách hàng", "error"); return; }

  const loaiVe = $("#bl-loaiVe").value;
  const khuVuc = loaiVe === "luu_dau" ? $("#bl-khuVuc").value : null;
  const blThang = parseInt($("#bl-thang").value, 10);
  const blNam = parseInt($("#bl-nam").value, 10);
  const tuNgayVal = (blThang && blNam) ? isoDate(new Date(blNam, blThang - 1, 1)) : "";
  const soThang = parseInt($("#bl-soThang").value, 10);
  const soPhieuThu = $("#bl-soPhieuThu").value.trim() || null;
  const nhanVien = $("#bl-nhanVien").value.trim() || null;

  const checkedRows = blXeRows.filter((r) => r.checked);
  if (checkedRows.length === 0) { showToast("Chưa chọn xe nào", "error"); return; }

  const noLoaiXe = checkedRows.filter((r) => !r.loaiXe);
  if (noLoaiXe.length > 0) {
    showToast(`Chưa chọn loại xe cho: ${noLoaiXe.map((r) => r.bienSo).join(", ")}`, "error"); return;
  }

  if (!tuNgayVal) { showToast("Vui lòng chọn tháng/năm bắt đầu", "error"); return; }
  if (!soThang || soThang < 1) { showToast("Số tháng không hợp lệ", "error"); return; }

  if (loaiVe === "luu_dau") {
    const xeTai = ["xe_tai_nho", "xe_tai_vua", "xe_tai_lon"];
    const notXeTai = checkedRows.filter((r) => !xeTai.includes(r.loaiXe));
    if (notXeTai.length > 0) {
      showToast(`Vé lưu đậu chỉ áp dụng cho xe tải: ${notXeTai.map((r) => r.bienSo).join(", ")}`, "error");
      return;
    }
    const tuNgay = new Date(tuNgayVal);
    for (const row of checkedRows) {
      const nhapCho = await window.api.checkNhapCho({
        bienSo: row.bienSo,
        thang: tuNgay.getMonth() + 1,
        nam: tuNgay.getFullYear(),
      });
      if (!nhapCho) {
        showToast(`Xe ${row.bienSo} chưa có vé nhập chợ còn hiệu lực`, "error");
        return;
      }
    }
  }

  const denNgay = blCalcDenNgay();
  if (!denNgay) { showToast("Không tính được ngày kết thúc", "error"); return; }

  const btn = $("#bl-btnBan");
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span>Đang xử lý...';

  try {
    const discount = blGetChanhDiscount();
    const items = checkedRows.map((row) => {
      const mienPhi = loaiVe === "luu_dau" && blMienPhiLuuDau(row.trangThai);
      const giaGoc = mienPhi ? 0 : blGetGia(row.loaiXe, loaiVe, khuVuc);
      const gia = Math.round(giaGoc * discount);
      return {
        BienSo: row.bienSo,
        LoaiXe: row.loaiXe,
        MaKH: blSelectedKH.MaKH,
        LoaiVe: loaiVe,
        KhuVucLuuDau: khuVuc,
        SoThang: soThang,
        TuNgay: tuNgayVal,
        DenNgay: isoDate(denNgay),
        GiaTien: gia,
        TongTien: gia * soThang,
        SoPhieuThu: soPhieuThu,
        NhanVienBan: nhanVien,
      };
    });

    // Kiểm tra trùng vé (cùng biển số + loại vé + khoảng thời gian giao nhau)
    const conflicts = await window.api.checkTrungVe(items);
    if (conflicts && conflicts.length > 0) {
      const ds = conflicts.map((c) => `${c.BienSo} (${c.TuNgay} → ${c.DenNgay})`).join(", ");
      showToast(`Đã có vé trùng tháng cho: ${ds}`, "error");
      return;
    }

    // In tất cả vé chung 1 phiếu — chỉ ghi DB khi user nhấn "In vé"
    const giamGia = discount < 1 ? Math.round((1 - discount) * 100) : 0;
    const printItems = items.map((it) => {
      const row = checkedRows.find((r) => r.bienSo === it.BienSo);
      const mienPhi = loaiVe === "luu_dau" && blMienPhiLuuDau(row.trangThai);
      const giaGoc = mienPhi ? 0 : blGetGia(row.loaiXe, loaiVe, khuVuc);
      return {
        BienSo: it.BienSo,
        TenKH: blSelectedKH.TenKH,
        TenOVua: blSelectedKH.TenOVua,
        LoaiXe: row.loaiXe,
        LoaiVe: loaiVe,
        KhuVucLuuDau: khuVuc,
        TuNgay: it.TuNgay,
        DenNgay: it.DenNgay,
        SoThang: soThang,
        DonGiaGoc: giaGoc,
        GiamGia: giamGia,
        GiaTien: it.GiaTien,
        TongTien: it.TongTien,
        SoPhieuThu: soPhieuThu,
        NhanVienBan: nhanVien,
      };
    });

    const printResult = await window.api.printTicket(printItems);
    if (!printResult || !printResult.printed) {
      const reason = printResult && printResult.failureReason;
      if (reason && reason !== "Print job canceled") {
        showToast(`In thất bại: ${reason} — chưa lưu vé`, "error");
      } else {
        showToast("Đã hủy in, chưa lưu vé");
      }
      return;
    }

    const results = await window.api.banVeHangLoat(items);
    showToast(`Đã bán ${results.length} vé thành công!`, "success");
    blReset();
  } catch (err) {
    showToast("Lỗi: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Bán vé";
  }
}

function blReset() {
  blSelectedKH = null;
  blXeRows = [];
  blNextId = 0;
  $("#bl-khSearch").value = "";
  $("#bl-khHint").textContent = "";
  $("#bl-newBienSo").value = "";
  $("#bl-newLoaiXe").value = "";
  $("#bl-newBienSoHint").textContent = "";
  $("#bl-xeCard").style.display = "none";
  $("#bl-paramCard").style.display = "none";
  $("#bl-confirmCard").style.display = "none";
  $("#bl-loaiVe").value = "nhap_cho";
  $("#bl-khuVucGroup").style.display = "none";
  const blResetNow = new Date();
  $("#bl-thang").value = blResetNow.getMonth() + 1;
  $("#bl-nam").value = blResetNow.getFullYear();
  $("#bl-soThang").value = "1";
  $("#bl-soPhieuThu").value = "";
  $("#bl-nhanVien").value = "";
  blCalcDenNgay();
  $("#bl-soXe").textContent = "0";
  $("#bl-tongTien").textContent = "—";
}

// ================================
// ===== TAB: TÌM KIẾM THEO XE ===
// ================================

let txSearchDebounce = null;

function setupTimXeTab() {
  $("#tx-search").addEventListener("input", () => {
    clearTimeout(txSearchDebounce);
    txSearchDebounce = setTimeout(() => doSearchXe(), 400);
  });
}

async function doSearchXe() {
  const query = $("#tx-search").value.trim();
  if (!query) {
    $("#tx-results").innerHTML = '<div class="empty-state"><p>Nhập biển số xe và nhấn Tìm kiếm</p></div>';
    $("#tx-detail").style.display = "none";
    return;
  }

  const resultsEl = $("#tx-results");
  const detailEl = $("#tx-detail");
  detailEl.style.display = "none";
  resultsEl.innerHTML = '<div class="empty-state"><p>Đang tìm kiếm...</p></div>';

  try {
    const xeList = await window.api.searchXe(query);

    if (xeList.length === 0) {
      resultsEl.innerHTML = '<div class="empty-state"><p>Không tìm thấy xe nào</p></div>';
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    resultsEl.innerHTML = xeList.map((xe) => {
      const isActive = xe.DenNgay && xe.DenNgay >= today;
      return `
        <div class="xe-card" data-bienso="${xe.BienSo}">
          <div class="xe-bienso">${xe.BienSo}</div>
          <div class="xe-info">
            <div>${loaiXeLabel(xe.LoaiXe)}</div>
            <div>${xe.TenOVua || xe.TenKH || "Không rõ chủ"}</div>
          </div>
          <span class="xe-status ${isActive ? "active" : "expired"}">${isActive ? "Còn hiệu lực" : (xe.DenNgay ? "Hết hạn" : "Chưa có vé")}</span>
        </div>`;
    }).join("");

    // Click to show ticket history
    resultsEl.querySelectorAll(".xe-card").forEach((card) => {
      card.addEventListener("click", () => {
        resultsEl.querySelectorAll(".xe-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        loadXeDetail(card.dataset.bienso);
      });
    });
  } catch (err) {
    resultsEl.innerHTML = `<div class="empty-state"><p style="color:var(--danger)">Lỗi: ${err.message}</p></div>`;
  }
}

async function loadXeDetail(bienSo) {
  const detailEl = $("#tx-detail");
  const titleEl = $("#tx-detailTitle");
  const tbody = $("#tx-veTbody");

  titleEl.textContent = `Lịch sử vé — ${bienSo}`;
  detailEl.style.display = "";

  try {
    const veList = await window.api.getVeByBienSo(bienSo);
    if (veList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-tertiary);padding:20px">Chưa có vé</td></tr>';
      return;
    }
    tbody.innerHTML = veList.map((v) => `
      <tr>
        <td><strong>${v.BienSo}</strong></td>
        <td><span class="badge ${v.LoaiVe === 'nhap_cho' ? 'badge-primary' : 'badge-success'}">${loaiVeLabel(v.LoaiVe)}</span></td>
        <td>${khuVucLabel(v.KhuVucLuuDau)}</td>
        <td>${formatDate(v.TuNgay)}</td>
        <td>${formatDate(v.DenNgay)}</td>
        <td style="font-weight:600;color:var(--success)">${formatMoney(v.TongTien)}</td>
        <td style="color:var(--text-tertiary)">${formatDate(v.NgayBan)}</td>
        <td style="color:var(--text-tertiary)">${v.NhanVienBan || "—"}</td>
      </tr>`).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" style="color:var(--danger);padding:16px">Lỗi: ${err.message}</td></tr>`;
  }
}

// ================================
// ===== TAB 3: KHÁCH HÀNG ========
// ================================

function setupKhachHangTab() {
  let khSearchDebounce = null;
  $("#kh-search").addEventListener("input", (e) => {
    clearTimeout(khSearchDebounce);
    khSearchDebounce = setTimeout(() => renderKHSidebar(e.target.value), 200);
  });

  $("#kh-btnAddNew").addEventListener("click", () => openModalKH(null));
  $("#kh-btnEdit").addEventListener("click", () => {
    if (currentKH) openModalKH(currentKH);
  });

  $("#kh-btnDelete").addEventListener("click", async () => {
    if (!currentKH) return;
    const xeList = await window.api.getXeCuaKH(currentKH.MaKH);
    const xeCount = xeList ? xeList.length : 0;
    const msg = xeCount > 0
      ? `Khách hàng "${currentKH.TenOVua || currentKH.TenKH}" có ${xeCount} xe và vé tháng liên quan.\nTất cả sẽ bị xóa. Bạn có chắc chắn?`
      : `Xóa khách hàng "${currentKH.TenOVua || currentKH.TenKH}"?`;
    if (!confirm(msg)) return;
    try {
      await window.api.deleteKhachHang(currentKH.MaKH);
      showToast(`Đã xóa khách hàng${xeCount > 0 ? ` và ${xeCount} xe` : ""}`, "success");
      currentKH = null;
      $("#kh-detail").style.display = "none";
      $("#kh-empty").style.display = "";
      await loadKhachHangList();
    } catch (err) {
      showToast("Lỗi: " + err.message, "error");
    }
  });
}

async function loadKhachHangList() {
  try {
    allKhachHang = await window.api.getKhachHangList();
    renderKHSidebar("");
  } catch (err) {
    const list = $("#kh-list");
    if (list) list.innerHTML = `<li style="color:var(--danger);padding:16px">Lỗi: ${err.message}</li>`;
  }
}

function renderKHSidebar(query) {
  const list = $("#kh-list");
  const qNorm = removeTones((query || "").toLowerCase());

  const filtered = query
    ? allKhachHang
        .filter((kh) => {
          const name = removeTones((kh.TenKH || "").toLowerCase());
          const shop = removeTones((kh.TenOVua || "").toLowerCase());
          return shop.includes(qNorm) || name.includes(qNorm);
        })
        .sort((a, b) => {
          const aShop = removeTones((a.TenOVua || "").toLowerCase()).includes(qNorm) ? 0 : 1;
          const bShop = removeTones((b.TenOVua || "").toLowerCase()).includes(qNorm) ? 0 : 1;
          return aShop - bShop;
        })
    : allKhachHang;

  list.innerHTML = "";

  if (filtered.length === 0) {
    list.innerHTML = '<li style="color:var(--text-tertiary);cursor:default;padding:20px;font-size:13px">Không tìm thấy</li>';
    return;
  }

  filtered.forEach((kh) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="item-name">${kh.TenOVua || kh.TenKH}</span>
      ${kh.TenOVua ? `<span class="item-sub">${kh.TenKH}</span>` : ""}
    `;
    li.dataset.maKH = kh.MaKH;
    if (kh.LaChanh) li.classList.add("is-chanh");
    if (currentKH && currentKH.MaKH === kh.MaKH) li.classList.add("active");
    li.addEventListener("click", () => selectKH(kh, li));
    list.appendChild(li);
  });
}

async function selectKH(kh, li) {
  currentKH = kh;
  $$("#kh-list li").forEach((l) => l.classList.remove("active"));
  li.classList.add("active");

  $("#kh-empty").style.display = "none";
  const detailEl = $("#kh-detail");
  detailEl.style.display = "flex";

  $("#kh-tenKH").textContent = kh.TenKH;
  $("#kh-tenOVua").textContent = (kh.TenOVua || "") + (kh.LaChanh ? " (Chành)" : "");

  // Info grid
  const infoGrid = $("#kh-infoGrid");
  infoGrid.innerHTML = `
    <span class="info-label">Mã KH</span><span class="info-value">${kh.MaKH}</span>
    <span class="info-label">Tên KH</span><span class="info-value">${kh.TenKH}</span>
    <span class="info-label">Tên Ô Vựa</span><span class="info-value">${kh.TenOVua || "—"}</span>
    <span class="info-label">Loại</span><span class="info-value">${kh.LaChanh ? '<span class="badge badge-warning">Chành (−50%)</span>' : "Thường"}</span>
    <span class="info-label">Điện thoại</span><span class="info-value">${kh.SoDienThoai || "—"}</span>
    <span class="info-label">Ghi chú</span><span class="info-value">${kh.GhiChu || "—"}</span>
  `;

  // Xe của KH
  try {
    const xeList = (await window.api.getXeCuaKH(kh.MaKH)).sort((a, b) => (b.DenNgay || "").localeCompare(a.DenNgay || ""));
    const xeTbody = $("#kh-xeTbody");
    const fmtDate = (d) => d ? d.slice(8,10)+"/"+d.slice(5,7)+"/"+d.slice(0,4) : "";
    xeTbody.innerHTML = xeList.length === 0
      ? '<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);padding:20px">Chưa có xe</td></tr>'
      : xeList.map((x) => `<tr><td>${x.BienSo}</td><td>${loaiXeLabel(x.LoaiXe)}</td><td>${x.TenTrangThai || "—"}</td><td>${fmtDate(x.TuNgay)}</td><td>${fmtDate(x.DenNgay)}</td></tr>`).join("");
  } catch (_) {}

  // Lịch sử vé
  try {
    const veList = await window.api.getLichSuKH(kh.MaKH);
    const veTbody = $("#kh-veTbody");
    veTbody.innerHTML = veList.length === 0
      ? '<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:20px">Chưa có vé</td></tr>'
      : veList.map((v) => `
          <tr>
            <td>${v.BienSo}</td>
            <td><span class="badge ${v.LoaiVe === 'nhap_cho' ? 'badge-primary' : 'badge-success'}">${loaiVeLabel(v.LoaiVe)}</span></td>
            <td>${khuVucLabel(v.KhuVucLuuDau)}</td>
            <td>${formatDate(v.TuNgay)}</td>
            <td>${formatDate(v.DenNgay)}</td>
            <td style="font-weight:600;color:var(--success)">${formatMoney(v.TongTien)}</td>
            <td style="color:var(--text-tertiary)">${formatDate(v.NgayBan)}</td>
          </tr>`).join("");
  } catch (_) {}
}

async function reprintVe(maVe) {
  try {
    const veList = await window.api.getReprintData(maVe);
    if (!veList || veList.length === 0) { showToast("Không tìm thấy vé", "error"); return; }
    const printItems = veList.map((v) => ({
      MaVe: v.MaVe,
      BienSo: v.BienSo,
      TenKH: v.TenKH,
      TenOVua: v.TenOVua,
      LoaiXe: v.LoaiXe,
      LoaiVe: v.LoaiVe,
      KhuVucLuuDau: v.KhuVucLuuDau,
      SoThang: v.SoThang,
      TuNgay: v.TuNgay,
      DenNgay: v.DenNgay,
      GiaTien: v.GiaTien,
      TongTien: v.TongTien,
      SoPhieuThu: v.SoPhieuThu,
      NhanVienBan: v.NhanVienBan,
      NgayBan: v.NgayBan,
    }));
    await window.api.printTicket(printItems);
  } catch (e) {
    showToast("In lại thất bại: " + e.message, "error");
  }
}
window.reprintVe = reprintVe;

// ================================
// ===== MODAL KHÁCH HÀNG =========
// ================================

function setupModalKH() {
  const overlay = $("#modal-kh");
  $("#modal-kh-close").addEventListener("click", closeModalKH);
  $("#modal-kh-cancel").addEventListener("click", closeModalKH);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModalKH();
  });
  $("#modal-kh-save").addEventListener("click", saveKH);
}

function openModalKH(kh) {
  editingKH = kh;
  const title = kh ? "Sửa thông tin khách hàng" : "Thêm khách hàng mới";
  $("#modal-kh-title").textContent = title;
  $("#modal-kh-tenKH").value = kh ? kh.TenKH : "";
  $("#modal-kh-tenOVua").value = kh ? (kh.TenOVua || "") : "";
  $("#modal-kh-soDienThoai").value = kh ? (kh.SoDienThoai || "") : "";
  $("#modal-kh-ghiChu").value = kh ? (kh.GhiChu || "") : "";
  $("#modal-kh-laChanh").checked = kh ? !!kh.LaChanh : false;
  $("#modal-kh").classList.add("open");
  setTimeout(() => $("#modal-kh-tenKH").focus(), 100);
}

function closeModalKH() {
  $("#modal-kh").classList.remove("open");
  editingKH = null;
}

async function saveKH() {
  const tenKH = $("#modal-kh-tenKH").value.trim();
  if (!tenKH) {
    showToast("Vui lòng nhập tên khách hàng", "error"); return;
  }

  const btn = $("#modal-kh-save");
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span>';

  try {
    if (editingKH) {
      await window.api.updateKhachHang({
        MaKH: editingKH.MaKH,
        TenKH: tenKH,
        TenOVua: $("#modal-kh-tenOVua").value.trim() || null,
        SoDienThoai: $("#modal-kh-soDienThoai").value.trim() || null,
        GhiChu: $("#modal-kh-ghiChu").value.trim() || null,
        LaChanh: $("#modal-kh-laChanh").checked ? 1 : 0,
      });
      showToast("Đã cập nhật thông tin khách hàng", "success");
    } else {
      await window.api.addKhachHang({
        TenKH: tenKH,
        TenOVua: $("#modal-kh-tenOVua").value.trim() || null,
        SoDienThoai: $("#modal-kh-soDienThoai").value.trim() || null,
        GhiChu: $("#modal-kh-ghiChu").value.trim() || null,
        LaChanh: $("#modal-kh-laChanh").checked ? 1 : 0,
      });
      showToast("Đã thêm khách hàng mới", "success");
    }
    closeModalKH();
    await loadKhachHangList();
    // Nếu đang sửa, refresh detail
    if (editingKH && currentKH && currentKH.MaKH === editingKH.MaKH) {
      const updated = allKhachHang.find((k) => k.MaKH === editingKH.MaKH);
      if (updated) {
        currentKH = updated;
        const li = $(`#kh-list li[data-ma-kh="${updated.MaKH}"]`);
        if (li) selectKH(updated, li);
      }
    }
  } catch (err) {
    showToast("Lỗi: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Lưu";
  }
}

// ================================
// ===== TAB 4: BÁO CÁO ===========
// ================================

let _lastBaoCao = null; // { type: "baocao"|"chuadong", thang, nam, data }

function setupBaoCaoTab() {
  $("#bc-btnLoad").addEventListener("click", loadBaoCao);
  $("#bc-btnChuaDong").addEventListener("click", loadVuaChuaDong);
  $("#bc-btnExcel").addEventListener("click", xuatExcel);

  let searchDebounce = null;
  $("#bc-searchPhieu").addEventListener("input", (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => filterPhieu(e.target.value.trim()), 200);
  });
}

function filterPhieu(query) {
  const cards = document.querySelectorAll("#bc-body .phieu-card");
  if (!cards.length) return;
  const q = query.toLowerCase();
  cards.forEach((card) => {
    if (!q) { card.style.display = ""; return; }
    const soPhieu = (card.dataset.soPhieu || "").toLowerCase();
    card.style.display = soPhieu.includes(q) ? "" : "none";
  });
}

async function loadBaoCao() {
  const thang = parseInt($("#bc-thang").value);
  const nam = parseInt($("#bc-nam").value);

  if (!thang || !nam) {
    showToast("Chọn tháng và năm", "error"); return;
  }

  const btn = $("#bc-btnLoad");
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span>';

  try {
    const data = await window.api.baoCaoTheoThang({ thang, nam });
    _lastBaoCao = { type: "baocao", thang, nam, tongHop: data.tongHop, chiTiet: data.chiTiet };
    $("#bc-btnExcel").style.display = "";
    const searchEl = $("#bc-searchPhieu");
    searchEl.value = "";
    searchEl.style.display = (data.chiTiet && data.chiTiet.length > 0) ? "" : "none";
    renderBaoCao(data, thang, nam);
  } catch (err) {
    showToast("Lỗi: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Xem báo cáo";
  }
}

function renderBaoCao(data, thang, nam) {
  const body = $("#bc-body");

  const tongHop = data.tongHop || [];
  const chiTiet = data.chiTiet || [];

  // Tính tổng
  const totalNhapCho = tongHop.filter((r) => r.LoaiVe === "nhap_cho").reduce((s, r) => s + Number(r.DoanhThu || 0), 0);
  const totalLuuDau = tongHop.filter((r) => r.LoaiVe === "luu_dau").reduce((s, r) => s + Number(r.DoanhThu || 0), 0);
  const totalVeNhapCho = tongHop.filter((r) => r.LoaiVe === "nhap_cho").reduce((s, r) => s + Number(r.SoVe || 0), 0);
  const totalVeLuuDau = tongHop.filter((r) => r.LoaiVe === "luu_dau").reduce((s, r) => s + Number(r.SoVe || 0), 0);
  const tongDoanhThu = totalNhapCho + totalLuuDau;

  body.innerHTML = `
    <div>
      <div class="section-title">Tổng quan — Tháng ${thang}/${nam}</div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Tổng doanh thu</div>
          <div class="stat-value" style="color:var(--success)">${formatMoney(tongDoanhThu)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Vé nhập chợ</div>
          <div class="stat-value">${totalVeNhapCho}</div>
          <div class="stat-sub">${formatMoney(totalNhapCho)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Vé lưu đậu</div>
          <div class="stat-value">${totalVeLuuDau}</div>
          <div class="stat-sub">${formatMoney(totalLuuDau)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Tổng số vé</div>
          <div class="stat-value">${totalVeNhapCho + totalVeLuuDau}</div>
        </div>
      </div>
    </div>

    <div>
      <div class="section-title">Doanh thu theo loại xe</div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Loại xe</th>
              <th>Loại vé</th>
              <th>Khu vực</th>
              <th>Số vé</th>
              <th>Doanh thu</th>
            </tr>
          </thead>
          <tbody>
            ${tongHop.length === 0
              ? '<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);padding:20px">Không có dữ liệu</td></tr>'
              : tongHop.map((r) => `
                <tr>
                  <td>${loaiXeLabel(r.LoaiXe)}</td>
                  <td><span class="badge ${r.LoaiVe === 'nhap_cho' ? 'badge-primary' : 'badge-success'}">${loaiVeLabel(r.LoaiVe)}</span></td>
                  <td>${khuVucLabel(r.KhuVucLuuDau)}</td>
                  <td>${r.SoVe}</td>
                  <td style="font-weight:600">${formatMoney(r.DoanhThu)}</td>
                </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <div class="section-title">Chi tiết theo phiếu (${chiTiet.length} vé)</div>
      ${(() => {
        // Group by SoPhieuThu, fallback to MaKH+NgayBan
        const groups = [];
        const groupMap = new Map();
        for (const r of chiTiet) {
          const key = r.SoPhieuThu || ((r.MaKH || "") + "_" + (r.NgayBan || ""));
          if (!groupMap.has(key)) {
            // Generate display number like print does
            let soPhieu = r.SoPhieuThu;
            if (!soPhieu && r.NgayBan) {
              const d = new Date(r.NgayBan);
              if (!isNaN(d)) soPhieu = "HDB" + String(d.getDate()).padStart(2,"0") + String(d.getMonth()+1).padStart(2,"0") + d.getFullYear() + "-" + String(d.getHours()).padStart(2,"0") + String(d.getMinutes()).padStart(2,"0") + String(d.getSeconds()).padStart(2,"0");
            }
            const g = { SoPhieuThu: soPhieu, TenKH: r.TenKH, TenOVua: r.TenOVua, NgayBan: r.NgayBan, NhanVienBan: r.NhanVienBan, items: [] };
            groupMap.set(key, g);
            groups.push(g);
          }
          groupMap.get(key).items.push(r);
        }
        if (groups.length === 0) return '<div style="text-align:center;color:var(--text-tertiary);padding:20px">Không có dữ liệu</div>';
        return groups.map((g, gi) => {
          const tongPhieu = g.items.reduce((s, r) => s + Number(r.TongTien || 0), 0);
          return `
          <div class="phieu-card" data-so-phieu="${(g.SoPhieuThu || '').replace(/"/g, '&quot;')}" style="border:1px solid var(--border);border-radius:8px;margin-bottom:12px;overflow:hidden">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-secondary);cursor:pointer" onclick="this.parentElement.querySelector('.phieu-detail').classList.toggle('collapsed')">
              <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                <span style="font-weight:700;color:var(--primary)">#${gi + 1}</span>
                <span style="font-weight:600">${g.SoPhieuThu || "Không có số phiếu"}</span>
                <span style="color:var(--text-tertiary)">—</span>
                <span style="font-weight:600">${g.TenKH || "—"}</span>
                ${g.TenOVua ? `<span style="font-size:12px;color:var(--text-tertiary)">(${g.TenOVua})</span>` : ""}
                <span class="badge badge-primary">${g.items.length} xe</span>
                <span style="font-weight:700;color:var(--success)">${formatMoney(tongPhieu)}</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="color:var(--text-tertiary);font-size:12px">${formatDate(g.NgayBan)} · ${g.NhanVienBan || "—"}</span>
                <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();reprintVe(${g.items[0].MaVe})" title="In lại phiếu">🖨</button>
              </div>
            </div>
            <div class="phieu-detail">
              <table style="margin:0">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Biển số</th>
                    <th>Loại xe</th>
                    <th>Loại vé</th>
                    <th>Khu vực</th>
                    <th>Từ ngày</th>
                    <th>Đến ngày</th>
                    <th>Đơn giá</th>
                    <th>Số tháng</th>
                    <th>Tổng tiền</th>
                  </tr>
                </thead>
                <tbody>
                  ${g.items.map((r, i) => `
                    <tr>
                      <td style="color:var(--text-tertiary)">${i + 1}</td>
                      <td><strong>${r.BienSo}</strong></td>
                      <td>${loaiXeLabel(r.LoaiXe)}</td>
                      <td><span class="badge ${r.LoaiVe === 'nhap_cho' ? 'badge-primary' : 'badge-success'}">${loaiVeLabel(r.LoaiVe)}</span></td>
                      <td>${khuVucLabel(r.KhuVucLuuDau)}</td>
                      <td>${formatDate(r.TuNgay)}</td>
                      <td>${formatDate(r.DenNgay)}</td>
                      <td style="text-align:right">${formatMoney(r.GiaTien)}</td>
                      <td>${r.SoThang}</td>
                      <td style="font-weight:600;color:var(--success)">${formatMoney(r.TongTien)}</td>
                    </tr>`).join("")}
                  <tr style="background:var(--bg-secondary);font-weight:700">
                    <td colspan="9" style="text-align:right">Tổng cộng:</td>
                    <td style="color:var(--success)">${formatMoney(tongPhieu)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>`;
        }).join("");
      })()}
    </div>
  `;
}

// ================================
// ===== VỰA CHƯA ĐÓNG TIỀN =====
// ================================

async function loadVuaChuaDong() {
  const thang = parseInt($("#bc-thang").value);
  const nam = parseInt($("#bc-nam").value);

  if (!thang || !nam) {
    showToast("Chọn tháng và năm", "error"); return;
  }

  const btn = $("#bc-btnChuaDong");
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span>';

  try {
    const rows = await window.api.getVuaChuaDong({ thang, nam });
    // Group by TenOVua
    const grouped = new Map();
    for (const r of rows) {
      const key = r.TenOVua || r.TenKH;
      if (!grouped.has(key)) {
        grouped.set(key, {
          TenOVua: r.TenOVua, TenKH: r.TenKH,
          LaChanh: r.LaChanh, xe: [], maKHs: [r.MaKH]
        });
      }
      const g = grouped.get(key);
      if (!g.maKHs.includes(r.MaKH)) g.maKHs.push(r.MaKH);
      g.xe.push({ BienSo: r.BienSo, LoaiXe: r.LoaiXe, MaKH: r.MaKH });
    }
    _lastBaoCao = { type: "chuadong", thang, nam, danhSach: Array.from(grouped.values()) };
    $("#bc-btnExcel").style.display = "";
    $("#bc-searchPhieu").style.display = "none";
    renderVuaChuaDong(grouped, thang, nam);
  } catch (err) {
    showToast("Lỗi: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Vựa chưa đóng tiền";
  }
}

function renderVuaChuaDong(grouped, thang, nam) {
  const body = $("#bc-body");
  const list = Array.from(grouped.values());
  const totalXe = list.reduce((s, kh) => s + kh.xe.length, 0);

  body.innerHTML = `
    <div>
      <div class="section-title">Vựa chưa đóng tiền nhập chợ — Tháng ${thang}/${nam}</div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Số vựa chưa đóng</div>
          <div class="stat-value" style="color:var(--danger,#e53e3e)">${list.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Tổng xe chưa đóng</div>
          <div class="stat-value" style="color:var(--danger,#e53e3e)">${totalXe}</div>
        </div>
      </div>
    </div>
    <div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th style="width:40px">#</th>
              <th>Ô Vựa</th>
              <th>Khách hàng</th>
              <th>Xe chưa đóng</th>
              <th style="width:90px"></th>
            </tr>
          </thead>
          <tbody>
            ${list.length === 0
              ? '<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);padding:20px">Tất cả vựa đã đóng tiền</td></tr>'
              : list.map((kh, i) => `
                <tr>
                  <td style="color:var(--text-tertiary)">${i + 1}</td>
                  <td><strong>${kh.TenOVua || "—"}</strong>${kh.LaChanh ? ' <span class="badge badge-warning">Chành</span>' : ""}</td>
                  <td>${kh.TenKH}</td>
                  <td>${kh.xe.map(x => `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 6px;background:var(--bg-tertiary,#f0f0f0);border-radius:4px;font-size:12px"><strong>${x.BienSo}</strong> <span style="color:var(--text-tertiary)">${loaiXeLabel(x.LoaiXe)}</span></span>`).join("")}</td>
                  <td><button class="btn btn-primary btn-sm" data-ban-ve-kh="${kh.maKHs[0]}">Bán vé</button></td>
                </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Wire "Bán vé" buttons
  body.querySelectorAll("[data-ban-ve-kh]").forEach(btn => {
    btn.addEventListener("click", () => {
      const maKH = parseInt(btn.dataset.banVeKh);
      const kh = allKhachHang.find(k => k.MaKH === maKH);
      if (!kh) { showToast("Không tìm thấy khách hàng", "error"); return; }

      // Switch to Bán Vé tab
      $$(".tab").forEach(t => t.classList.remove("active"));
      $$(".tab-panel").forEach(p => p.classList.remove("active"));
      document.querySelector('[data-tab="banve"]').classList.add("active");
      $("#panel-banve").classList.add("active");

      // Auto-select customer
      blSelectedKH = kh;
      $("#bl-khSearch").value = (kh.TenOVua || kh.TenKH) + (kh.TenOVua ? ` (${kh.TenKH})` : "");
      $("#bl-khHint").textContent = `MaKH: ${kh.MaKH}` + (kh.LaChanh ? " (Chành −50%)" : "");
      blLoadXe(kh.MaKH);
      blUpdateSummary();
    });
  });
}

// ================================
// ===== XUẤT EXCEL ===============
// ================================

async function xuatExcel() {
  if (!_lastBaoCao) {
    showToast("Chưa có dữ liệu để xuất", "error");
    return;
  }

  const btn = $("#bc-btnExcel");
  btn.disabled = true;
  btn.textContent = "Đang xuất...";

  try {
    let result;
    if (_lastBaoCao.type === "baocao") {
      result = await window.api.xuatExcelBaoCao({
        thang: _lastBaoCao.thang,
        nam: _lastBaoCao.nam,
        tongHop: _lastBaoCao.tongHop,
        chiTiet: _lastBaoCao.chiTiet,
      });
    } else {
      result = await window.api.xuatExcelChuaDong({
        thang: _lastBaoCao.thang,
        nam: _lastBaoCao.nam,
        danhSach: _lastBaoCao.danhSach,
      });
    }

    if (result.success) {
      showToast("Đã xuất file Excel thành công!");
    }
  } catch (err) {
    showToast("Lỗi xuất Excel: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "📥 Xuất Excel";
  }
}

// ================================
// ===== AUTO UPDATE ==============
// ================================

function setupAutoUpdate() {
  const banner = $("#updateBanner");
  const text = $("#updateText");
  const progressBar = $("#updateProgressBar");
  const progressFill = $("#updateProgressFill");
  const btnDownload = $("#btnDownloadUpdate");
  const btnInstall = $("#btnInstallUpdate");
  const btnClose = $("#btnCloseBanner");

  window.api.onUpdateAvailable((version) => {
    banner.style.display = "flex";
    text.textContent = `Phiên bản mới ${version} đã sẵn sàng!`;
    btnDownload.style.display = "";
    btnInstall.style.display = "none";
    progressBar.style.display = "none";
  });

  window.api.onUpdateNotAvailable(() => {});

  window.api.onUpdateDownloadProgress((percent) => {
    text.textContent = `Đang tải bản cập nhật... ${percent}%`;
    progressBar.style.display = "";
    progressFill.style.width = percent + "%";
    btnDownload.style.display = "none";
  });

  window.api.onUpdateDownloaded(() => {
    text.textContent = "Bản cập nhật đã tải xong!";
    progressBar.style.display = "none";
    btnDownload.style.display = "none";
    btnInstall.style.display = "";
  });

  window.api.onUpdateError((msg) => {
    console.error("Update error:", msg);
    banner.style.display = "none";
  });

  btnDownload.addEventListener("click", () => {
    window.api.downloadUpdate();
    btnDownload.style.display = "none";
    text.textContent = "Đang bắt đầu tải...";
    progressBar.style.display = "";
  });

  btnInstall.addEventListener("click", () => {
    text.textContent = "Đang đóng ứng dụng để cập nhật...";
    btnInstall.disabled = true;
    window.api.installUpdate();
  });

  btnClose.addEventListener("click", () => {
    banner.style.display = "none";
  });
}

// ===== Backup & Restore =====

function setupBackup() {
  const toggle = $("#backupToggle");
  const menu = $("#backupMenu");

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
  });

  document.addEventListener("click", () => menu.classList.remove("open"));

  $("#btnBackup").addEventListener("click", async () => {
    menu.classList.remove("open");
    const result = await window.api.backupDatabase();
    if (result.canceled) return;
    if (result.success) {
      showToast("Sao lưu thành công!");
    } else {
      showToast("Lỗi sao lưu: " + result.message, "error");
    }
  });

  $("#btnRestore").addEventListener("click", async () => {
    menu.classList.remove("open");
    if (!confirm("Khôi phục sẽ thay thế toàn bộ dữ liệu hiện tại.\nBạn có chắc chắn muốn tiếp tục?")) return;
    const result = await window.api.restoreDatabase();
    if (result.canceled) return;
    if (result.success) {
      showToast("Khôi phục thành công! Đang tải lại...");
      setTimeout(() => location.reload(), 1500);
    } else {
      showToast("Lỗi khôi phục: " + result.message, "error");
    }
  });
}

// ===== Start =====
init();
