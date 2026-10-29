# CHANGELOG.md — SIKAP
**Sistem Informasi Keuangan, Anggaran, dan Kepegawaian (Subbag Tata Usaha - Dit. POA)**

## [Fase 6 — Sub-Modul E: Siklus Usulan Penghapusan Legal Kemenkeu & QA Final] — 29 Okt 2026
**Status:** Selesai

**Pencapaian:**
- Stepper visual 5-tahap usulan penghapusan BMN (`DRAFT_USULAN` → `SURAT_USULAN` → `PERSETUJUAN_KEMENKEU` → `SK_PENGHAPUSAN` → `BAST_SELESAI`).
- Form pembuatan berkas usulan dengan seleksi multi-aset kondisi Rusak Berat dan karantina aset otomatis (`DALAM_PENGHAPUSAN`).
- Transisi status akhir aset menjadi `DIHAPUS` pada saat BAST selesai diunggah.
- Pemulihan status aset menjadi `AKTIF` jika berkas usulan ditolak atau dianulir.
- Pembuatan dan integrasi script audit konsistensi UI 3-tier (`node lint_ui.js`) yang memvalidasi Zero-Emoji Policy, 3-tier control scale (40px/32px/26px), bebas inline height override, bebas speedometer/gauge, prinsip anti-gabruk, BMN anti-jebret, dan kalkulasi server-side.
- Perbaikan akses sheet transaksi di `TataUsahaService.js`, `EvidenceService.js`, `SheetAccess.js`, dan `Constants.js` menggunakan dedicated opener `openTuSheet()` dengan self-heal.

---

## [Fase 5 — Sub-Modul D: Inventaris BMN & Geotagging EXIF (Anti-Jebret)] — 26 Okt 2026
**Status:** Selesai

**Pencapaian:**
- Form pendaftaran aset fisik individual per-item (`KodeBarang` + `NUP` + `NamaBarang`).
- Dual pipeline geotagging: ekstraksi GPS dari metadata EXIF file foto mentah sebelum kompresi kanvas, dengan fallback ke koordinat GPS browser (`navigator.geolocation`).
- Algoritma Haversine resolver server-side untuk mendeteksi UPT terdekat dari koordinat fisik aset.
- Engine Smart Bulk Import SAKTI Excel (.xlsx) dengan validasi dry-run sebelum commit batch.
- Peta interaktif Leaflet sebaran aset UPT dan banner ringkasan alert kondisi aset Rusak Berat.

---

## [Fase 4 — Sub-Modul C: Manajemen Kepegawaian & Headcount] — 26 Okt 2026
**Status:** Selesai

**Pencapaian:**
- Form snapshot headcount 5 kategori aparatur (`PNS`, `P3K`, `P3K_PARUH_WAKTU`, `PJLP`, `MAGANG`).
- Logika snapshot carry-forward otomatis tanpa duplikasi berlebih.
- Strip KPI ringkasan komposisi SDM aparatur Subbag TU.

---

## [Fase 3 — Sub-Modul B: Monitoring Paket Pengadaan] — 26 Okt 2026
**Status:** Selesai

**Pencapaian:**
- Form pencatatan progres siklus 6 tahap pengadaan paket per divisi (`PERSIAPAN` → `PEMILIHAN` → `KONTRAK` → `PELAKSANAAN` → `BAST` → `SELESAI`).
- Field nomor kontrak, rekanan penyedia, progres fisik %, nilai kontrak, dan realisasi keuangan.
- Integrasi bukti fisik dan tautan dokumen kontrak ke Drive.

---

## [Fase 2 — Sub-Modul A: Realisasi Anggaran (SP2D & Akrual)] — 26 Okt 2026
**Status:** Selesai

**Pencapaian:**
- Form input matriks 2x2: Pagu Reguler vs ABT, Realisasi SP2D vs Akrual.
- Logika carry-forward pagu dan kewajiban `CatatanRevisiPagu` saat revisi.
- Kalkulasi server-side serapan nasional, sisa pagu, dan strip KPI keuangan.
- Tabel riwayat transaksi dengan modal revisi (`SUPERSEDED`) dan modal anulir (`VOID`).

---

## [Fase 1 — Inisialisasi Database Spreadsheet & Framework GAS] — 26 Okt 2026
**Status:** Selesai

**Pencapaian:**
- Inisialisasi repo SIKAP dengan clasp (`1Cpuia8-M-g0b3S_IOKKrwn-T4XSIjQbHiYJm85Mhr7XhVFfe3QugZmJv`).
- Setup Spreadsheet `RadarPOA_SIKAP_DB` dengan seluruh header standar relasional.
- Setup Script Properties, ID master, dan Drive root `POA_Evidence_SIKAP`.
- Implementasi RBAC dan sesi login via Google Apps Script.
