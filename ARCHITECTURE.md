# ARCHITECTURE.md — Arsitektur Teknis

## Peran
Satelit mandiri Timja Logistik. Data ke `RadarPOA_Logistik_DB`.

## Layanan
`LogistikService.js` dengan fungsi `logistik_*` terpisah per sub-modul.

## Kalkulasi Server-Side
- Amunisi: `StokAkhir = StokAwal - Σ Penggunaan_Minggu (tahun berjalan)`
- BBM: `SisaKuotaBBM = PaguBBM - Σ Realisasi_Minggu`, `%RealisasiBBM = ...`

## Warning System
Peringatan stok amunisi negatif bersifat **non-blocking** (hanya warning, tetap bisa dicatat dengan justifikasi).

## Aturan
LockService, versioning/anulir, RBAC server-side, anti-gabruk
