# DATA_SCHEMA.md — Skema Data

## Prinsip
- Skema persis, jangan mengarang nama kolom
- Setiap sheet transaksi wajib memiliki kolom standar:
  - `RowID` (unik)
  - `DivisiID`
  - `Periode`
  - `SubmittedBy`
  - `Timestamp`
  - `Status` (ACTIVE/SUPERSEDED/VOID)
  - `SupersedesRowID`
  - `VoidReason`
  - `VoidedBy`
  - `VoidedAt`

## Spreadsheet
- Aplikasi satelit: spreadsheet terisolasi per divisi sesuai blueprint
- Radar POA: `RadarPOA_Pusat_DB` untuk `TX_KegiatanDirektorat` dan log terkait
- Master Data: `RadarPOA_Master_DB` (dibaca bersama)

Rincian sheet per modul akan dikembangkan sesuai scope proyek masing-masing mengikuti blueprint v2.1.0.
