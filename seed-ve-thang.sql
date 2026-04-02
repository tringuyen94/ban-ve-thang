-- Seed data cho VeThang để test Tra Cứu & Gia Hạn
-- Giá: nhap_cho xe_tai_nho=1060364, ba_gac=589091
--       luu_dau_tieu_chuan xe_tai_nho=1890000, luu_dau_dac_biet xe_tai_nho=400000

INSERT INTO VeThang (BienSo, MaKH, LoaiVe, KhuVucLuuDau, SoThang, TuNgay, DenNgay, GiaTien, TongTien, NgayBan) VALUES

-- === XE TẢI NHỎ ===

-- 47C04700 (MaKH=3, Chị Ba) — nhập chợ 3 tháng (01-03/2026)
('47C04700', 3, 'nhap_cho', NULL, 3, '2026-01-01', '2026-03-31', 1060364, 3181092, '2025-12-28'),

-- 47C04700 (MaKH=3, Chị Ba) — lưu đậu tiêu chuẩn 1 tháng (03/2026)
('47C04700', 3, 'luu_dau', 'tieu_chuan', 1, '2026-03-01', '2026-03-31', 1890000, 1890000, '2026-02-27'),

-- 29H27993 (MaKH=79, Đinh Hữu Thành) — nhập chợ 6 tháng (10/2025-03/2026)
('29H27993', 79, 'nhap_cho', NULL, 6, '2025-10-01', '2026-03-31', 1060364, 6362184, '2025-09-28'),

-- 50H02568 (MaKH=99, Vũ Văn Huy) — nhập chợ 1 tháng (03/2026)
('50H02568', 99, 'nhap_cho', NULL, 1, '2026-03-01', '2026-03-31', 1060364, 1060364, '2026-02-26'),

-- 50G00657 (MaKH=111, Nguyễn Thị Bích Giang) — nhập chợ 3 tháng (01-03/2026)
('50G00657', 111, 'nhap_cho', NULL, 3, '2026-01-01', '2026-03-31', 1060364, 3181092, '2025-12-29'),

-- 50G00657 (MaKH=111) — lưu đậu đặc biệt 1 tháng (02/2026)
('50G00657', 111, 'luu_dau', 'dac_biet', 1, '2026-02-01', '2026-02-28', 400000, 400000, '2026-01-29'),

-- 29K23654 (MaKH=67, Phạm Hoài Ninh) — nhập chợ 1 tháng (02/2026), ĐÃ HẾT HẠN → test gia hạn
('29K23654', 67, 'nhap_cho', NULL, 1, '2026-02-01', '2026-02-28', 1060364, 1060364, '2026-01-28'),

-- 50H03435 (MaKH=86, Thanh Lỳ) — nhập chợ 2 tháng (12/2025-01/2026), ĐÃ HẾT HẠN
('50H03435', 86, 'nhap_cho', NULL, 2, '2025-12-01', '2026-01-31', 1060364, 2120728, '2025-11-28'),

-- === BA GÁC (chỉ nhập chợ) ===

-- HOBO0080 (MaKH=8, Trần Thanh Bon) — nhập chợ 3 tháng (01-03/2026)
('HOBO0080', 8, 'nhap_cho', NULL, 3, '2026-01-01', '2026-03-31', 589091, 1767273, '2025-12-28'),

-- PHHU0009 (MaKH=10, Trương Thị Bích Phượng) — nhập chợ 1 tháng (03/2026)
('PHHU0009', 10, 'nhap_cho', NULL, 1, '2026-03-01', '2026-03-31', 589091, 589091, '2026-02-27'),

-- KLNN0546 (MaKH=20, Nguyễn Ngọc Tú) — nhập chợ 2 tháng (01-02/2026), ĐÃ HẾT HẠN
('KLNN0546', 20, 'nhap_cho', NULL, 2, '2026-01-01', '2026-02-28', 589091, 1178182, '2025-12-27'),

-- A4380564 (MaKH=3, Chị Ba) — nhập chợ 1 tháng (02/2026), ĐÃ HẾT HẠN
('A4380564', 3, 'nhap_cho', NULL, 1, '2026-02-01', '2026-02-28', 589091, 589091, '2026-01-29');
