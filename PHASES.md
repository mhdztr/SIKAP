# PHASES.md — Roadmap Pengembangan & Verifikasi QA: SIKAP
**Sistem Informasi Keuangan, Anggaran, dan Kepegawaian (Subbag Tata Usaha - Dit. POA)**  
*Direktorat Jenderal Pengawasan Sumber Daya Kelautan dan Perikanan (Ditjen PSDKP)*  
*Kementerian Kelautan dan Perikanan Republik Indonesia (KKP RI)*

---

## 1. Ikhtisar Siklus Pengembangan

Pengembangan sistem satelit SIKAP dilaksanakan melalui 6 fase independen dengan standar verifikasi, pengujian fungsional, dan audit mutu kode terukur:

```
FASE PENGEMBANGAN SIKAP
├── [Fase 1] Inisialisasi Database Spreadsheet Satelit & Framework GAS
├── [Fase 2] Sub-Modul A: Realisasi Anggaran (SP2D & Akrual Matriks 2x2)
├── [Fase 3] Sub-Modul B: Monitoring Siklus Paket Pengadaan Lintas Divisi
├── [Fase 4] Sub-Modul C: Manajemen Kepegawaian & Headcount Snapshot
├── [Fase 5] Sub-Modul D: Inventaris Granular BMN, Geotagging EXIF & Impor SAKTI
└── [Fase 6] Sub-Modul E: Siklus Usulan Penghapusan Legal Kemenkeu & Audit QA
```

---

## 2. Rincian Eksekusi & Kriteria Verifikasi per Fase

### Fase 1: Inisialisasi Database Spreadsheet Satelit & Framework GAS
- **Tujuan Utama:** Menyiapkan fondasi runtime Google Apps Script, konfigurasi clasp, koneksi ke Google Drive, dan penyediaan skema database mandiri `RadarPOA_SIKAP_DB`.
- **Komponen yang Dikerjakan:**
  - Setup konfigurasi `.clasp.json` terhubung ke Script ID `1Cpuia8-M-g0b3S_IOKKrwn-T4XSIjQbHiYJm85Mhr7XhVFfe3QugZmJv`.
  - Inisialisasi Script Properties: `MASTER_SS_ID`, `TU_SS_ID`, `SIKAP_SS_ID`, `LOG_SS_ID`.
  - Pembuatan mekanisme self-healing spreadsheet [openTuSheet()](file:///home/pinefeast/Projects/SIKAP/data/SheetAccess.js#L102) dan [ensureTuSpreadsheet()](file:///home/pinefeast/Projects/SIKAP/data/SheetAccess.js#L117) yang secara otomatis membuat sheet beserta header kolom tebal jika database belum ada.
  - Pembentukan root folder Google Drive `POA_Evidence_SIKAP` beserta sub-direktori `Aset_BMN`, `Surat_Penghapusan`, dan `Kontrak_Paket`.
  - Konfigurasi autentikasi sesi, token hashing SHA-256 [hashPassword()](file:///home/pinefeast/Projects/SIKAP/data/SheetAccess.js#L64), dan RBAC server-side di [services/AuthService.js](file:///home/pinefeast/Projects/SIKAP/services/AuthService.js).
- **Deliverables & Checklist:**
  - [x] Spreadsheet `RadarPOA_SIKAP_DB` aktif dan terhubung via Script Properties.
  - [x] Struktur folder Google Drive `POA_Evidence_SIKAP` terverifikasi.
  - [x] Runtime koneksi Google Apps Script berfungsi normal dengan handler `doGet()`.
  - [x] Alur login, verifikasi peran, dan pengamanan antarmuka berfungsi stabil.

---

### Fase 2: Sub-Modul A: Realisasi Anggaran (SP2D & Akrual Matriks 2x2)
- **Tujuan Utama:** Mengimplementasikan pencatatan dan monitoring mingguan realisasi anggaran negara Dit. POA berbasis matriks 2x2 APBN (Reguler vs ABT, SP2D vs Akrual).
- **Komponen yang Dikerjakan:**
  - Form input popup modal mingguan [modal-tu-form](file:///home/pinefeast/Projects/SIKAP/html/views/TataUsaha.html) dengan input matriks 2x2.
  - Logika *carry-forward* nilai pagu tahunan secara otomatis dari laporan minggu sebelumnya.
  - Kewajiban pengisian field `CatatanRevisiPagu` saat terjadi perubahan pagu DIPA.
  - Fungsi agregasi server-side [tataUsaha_getKPI()](file:///home/pinefeast/Projects/SIKAP/services/TataUsahaService.js#L78):
    - Akumulasi kas cair SP2D YTD, sisa pagu kas, akumulasi komitmen fisik akrual, persentase serapan nasional, dan frekuensi revisi pagu [_tuHitungRevisiPagu()](file:///home/pinefeast/Projects/SIKAP/services/TataUsahaService.js#L48).
  - Strip KPI antarmuka dengan linear progress bar dan tabular numbers (`.tnum`).
  - Grafik konteks bulanan YTD pada [html/Script_Charts.html](file:///home/pinefeast/Projects/SIKAP/html/Script_Charts.html).
  - Tabel riwayat transaksi dengan modal dialog **Revisi** (menghasilkan status `SUPERSEDED` dan append baris baru ber-link `SupersedesRowID`) dan modal dialog **Anulir** (status `VOID` dengan `VoidReason` wajib).
- **Deliverables & Checklist:**
  - [x] Form input matriks 2x2 (Pagu Reguler vs ABT, Realisasi SP2D vs Akrual) aktif.
  - [x] Logika carry-forward pagu dan kewajiban `CatatanRevisiPagu` tervalidasi.
  - [x] Kalkulasi serapan nasional, sisa pagu, dan strip KPI keuangan diproses server-side.
  - [x] Tabel riwayat, modal revisi (superseded), dan modal anulir (void) berfungsi tanpa celah.

---

### Fase 3: Sub-Modul B: Monitoring Siklus Paket Pengadaan Lintas Divisi
- **Tujuan Utama:** Mengelola siklus hidup pengadaan barang, jasa konsultansi, konstruksi, dan pemeliharaan teknis Dit. POA per divisi kerja.
- **Komponen yang Dikerjakan:**
  - Antarmuka monitoring progres paket [tu-pane-paket](file:///home/pinefeast/Projects/SIKAP/html/views/TataUsaha.html#L309).
  - Siklus 6-tahap pekerjaan: `PERSIAPAN` → `PEMILIHAN` → `KONTRAK` → `PELAKSANAAN` → `BAST` → `SELESAI`.
  - Form perekaman kemajuan pekerjaan dengan validasi: tahap $\ge$ `KONTRAK` mewajibkan `NomorKontrak`, `RekananPenyedia`, dan `NilaiKontrak`.
  - Integrasi berkas kontrak PDF / foto fisik lapangan via URL Google Drive.
  - Fungsi backend [tataUsaha_getPaket()](file:///home/pinefeast/Projects/SIKAP/services/TataUsahaService.js#L986), [tataUsaha_submitPaket()](file:///home/pinefeast/Projects/SIKAP/services/TataUsahaService.js#L1057), dan [tataUsaha_anulirPaket()](file:///home/pinefeast/Projects/SIKAP/services/TataUsahaService.js#L1139).
- **Deliverables & Checklist:**
  - [x] Form pencatatan progres 6 tahap pengadaan paket per divisi terpasang.
  - [x] Field nomor kontrak, rekanan penyedia, progres fisik %, dan keuangan tervalidasi.
  - [x] Upload evidence dokumen kontrak / foto fisik ke Drive terintegrasi.
  - [x] Tabel riwayat pengadaan, filter per divisi, dan modal anulir berfungsi.

---

### Fase 4: Sub-Modul C: Manajemen Kepegawaian & Headcount Snapshot
- **Tujuan Utama:** Memantau komposisi, distribusi, dan dinamika aparatur sipil negara dan personil pendukung di lingkungan Subbag Tata Usaha.
- **Komponen yang Dikerjakan:**
  - Antarmuka pemantauan headcount [tu-pane-pegawai](file:///home/pinefeast/Projects/SIKAP/html/views/TataUsaha.html#L513).
  - Snapshot mingguan untuk 5 kategori aparatur resmi: `PNS`, `P3K`, `P3K_PARUH_WAKTU`, `PJLP`, `MAGANG`.
  - Logika *carry-forward snapshot otomatis*: sistem mewarisi komposisi personil periode aktif terakhir jika tidak ada mutasi baru pada minggu berjalan.
  - Strip kartu ringkasan komposisi SDM aparatur TU.
  - Fungsi backend [tataUsaha_getPegawai()](file:///home/pinefeast/Projects/SIKAP/services/TataUsahaService.js#L754), [tataUsaha_submitPegawai()](file:///home/pinefeast/Projects/SIKAP/services/TataUsahaService.js#L853), dan [tataUsaha_anulirPegawai()](file:///home/pinefeast/Projects/SIKAP/services/TataUsahaService.js#L922).
- **Deliverables & Checklist:**
  - [x] Form snapshot headcount 5 kategori aparatur terpasang.
  - [x] Logika snapshot carry-forward otomatis tanpa duplikasi berlebih tervalidasi.
  - [x] Strip ringkasan komposisi SDM aparatur TU aktif.
  - [x] Pencatatan catatan mutasi personil pada kolom keterangan berfungsi.

---

### Fase 5: Sub-Modul D: Inventaris Granular BMN, Geotagging EXIF & Impor SAKTI
- **Tujuan Utama:** Menyelenggarakan registrasi inventaris fisik BMN granular (1 unit = 1 baris) dengan ekstraksi koordinat EXIF otomatis, resolver UPT Haversine, Smart Bulk Import Excel, dan peta Leaflet.
- **Komponen yang Dikerjakan:**
  - Form registrasi aset fisik individual [bmn-view-form](file:///home/pinefeast/Projects/SIKAP/html/views/TataUsaha.html#L823) dengan input wajib `KodeBarang` 10 digit, `NUP`, `NamaBarang`, `TanggalPerolehan`, `NilaiPerolehan`, `NilaiBuku`, dan `Kondisi` (*Prinsip BMN Anti-Jebret*).
  - Dual Geotagging Pipeline:
    - Opsi 1 (Utama): Ekstraksi GPS dari metadata EXIF file foto mentah sebelum kompresi kanvas (`SumberLokasi = 'EXIF_GPS'`).
    - Opsi 2 (Fallback): Koordinat GPS browser pengunggah (`navigator.geolocation`) atau koordinat Homebase profil staf.
  - Algoritma resolver server-side [_bmnHaversineKm()](file:///home/pinefeast/Projects/SIKAP/services/BMNService.js#L50) dan [_bmnMatchNearestUpt()](file:///home/pinefeast/Projects/SIKAP/services/BMNService.js#L70) yang secara otomatis mengaitkan aset ke pangkalan UPT terdekat.
  - Modal Smart Bulk Import SAKTI Excel (.xlsx / .csv / paste grid) dengan 4 kartu ringkasan uji validasi dry-run (Total Baris, Siap Impor, Baris Galat, Akumulasi Nilai Perolehan) dan commit batch bertahap via [bmn_importBatchAset()](file:///home/pinefeast/Projects/SIKAP/services/BMNService.js#L729).
  - Peta spasial sebaran aset pangkalan UPT berbasis Leaflet 1.9.4 dan banner notifikasi rekapitulasi kondisi fisik (peringatan aset Rusak Berat).
- **Deliverables & Checklist:**
  - [x] Form pendaftaran aset fisik individual per-item (`KodeBarang` + `NUP`) aktif.
  - [x] Pipeline geotagging otomatis (EXIF GPS → Fallback GPS → Haversine UPT terdekat) tervalidasi.
  - [x] Engine Smart Bulk Import SAKTI Excel (.xlsx) dengan validasi dry-run berfungsi.
  - [x] Peta Leaflet sebaran aset UPT dan notification banner aset Rusak Berat aktif.

---

### Fase 6: Sub-Modul E: Siklus Usulan Penghapusan Legal Kemenkeu & Audit QA
- **Tujuan Utama:** Mengelola alur administrasi hukum usulan pemusnahan/penghapusan aset Rusak Berat menuju Kementerian Keuangan RI (DJKN/KPKNL), mekanisme karantina status aset, dan audit kepatuhan desain menyeluruh.
- **Komponen yang Dikerjakan:**
  - Komponen visual 5-Stage Stepper [modal-bmn-detail-hapus](file:///home/pinefeast/Projects/SIKAP/html/views/TataUsaha.html#L1444): `DRAFT_USULAN` → `SURAT_USULAN` → `PERSETUJUAN_KEMENKEU` → `SK_PENGHAPUSAN` → `BAST_SELESAI`.
  - Form pembuatan berkas usulan baru [modal-bmn-create-hapus](file:///home/pinefeast/Projects/SIKAP/html/views/TataUsaha.html#L1336) dengan filter multi-seleksi aset kondisi `RUSAK_BERAT` yang berstatus `AKTIF`.
  - Mekanisme Karantina Status Aset:
    - Masuk berkas usulan $\rightarrow$ status aset berubah menjadi `DALAM_PENGHAPUSAN`.
    - Tahap akhir BAST selesai diunggah $\rightarrow$ status aset berubah permanen menjadi `DIHAPUS`.
    - Berkas ditolak atau dibatalkan/dianulir $\rightarrow$ status seluruh aset dipulihkan otomatis ke `AKTIF`.
  - Pembuatan engine audit linter otomatis [lint_ui.js](file:///home/pinefeast/Projects/SIKAP/lint_ui.js) yang memverifikasi Zero-Emoji Policy, kepatuhan 3-tier geometry scale (`40px`, `32px`, `26px`), larangan inline height override, negative prompts, prinsip Anti-Gabruk, BMN Anti-Jebret, dan kalkulasi server-side.
- **Deliverables & Checklist:**
  - [x] Stepper visual 5-tahap usulan penghapusan BMN terpasang rapi.
  - [x] Form pembuatan usulan dengan seleksi multi-aset kondisi Rusak Berat berfungsi.
  - [x] Karantina otomatis status aset (`DALAM_PENGHAPUSAN`) dan eksekusi status akhir `DIHAPUS` saat BAST selesai tervalidasi.
  - [x] Audit konsistensi kontrol UI 3-tier (`node lint_ui.js`), Zero-Emoji Policy, dan validasi arsitektur lolos 100% tanpa pelanggaran.

---

## 3. Matriks Pengujian & Verifikasi Kualitas (QA Test Suite)

| Kategori Pengujian | Parameter Verifikasi | Perintah / Prosedur Uji | Hasil Verifikasi |
|---|---|---|:---:|
| **Audit Linter UI & Arsitektur** | Zero-Emoji, 3-Tier Scale, Negative Prompts, Anti-Gabruk, BMN Anti-Jebret | `node lint_ui.js` | **10 / 10 PASS (100%)** |
| **Pemeriksaan Sintaksis JavaScript** | Validasi kompilasi sintaksis seluruh file `.js` proyek | `node -c Code.js services/*.js utils/*.js data/*.js lint_ui.js` | **0 Syntax Errors** |
| **Kalkulasi Finansial Server-Side** | Akumulasi serapan SP2D, akrual, sisa kas, revisi pagu | Unit test [TataUsahaService.js](file:///home/pinefeast/Projects/SIKAP/services/TataUsahaService.js) | **Lolos Validasi** |
| **Haversine Geotagging** | Jarak terpendek ke 15 koordinat UPT PSDKP | Unit test [_bmnHaversineKm()](file:///home/pinefeast/Projects/SIKAP/services/BMNService.js#L50) | **Lolos Validasi** |
| **State Machine Penghapusan** | Transisi tahap, karantina aset, eksekusi BAST, rollback VOID | Integrasi [BMNService.js](file:///home/pinefeast/Projects/SIKAP/services/BMNService.js) | **Lolos Validasi** |
