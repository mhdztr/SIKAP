# PHASES.md — Roadmap Pengembangan: SIKAP
**Sistem Informasi Keuangan, Anggaran, dan Kepegawaian (Subbag Tata Usaha)**

## Ikhtisar Siklus Pengembangan
Pengembangan SIKAP dilaksanakan melalui 6 fase independen dengan standar verifikasi dan testing terukur:

```
FASE PENGEMBANGAN SIKAP
├── [Fase 1] Inisialisasi Database Spreadsheet & Framework GAS
├── [Fase 2] Sub-Modul A: Realisasi Anggaran (SP2D & Akrual)
├── [Fase 3] Sub-Modul B: Monitoring Paket Pengadaan
├── [Fase 4] Sub-Modul C: Manajemen Kepegawaian & Headcount
├── [Fase 5] Sub-Modul D: Inventaris BMN & Geotagging EXIF
└── [Fase 6] Sub-Modul E: Siklus Usulan Penghapusan Legal Kemenkeu & QA
```

---

### Fase 1: Inisialisasi Database Spreadsheet & Framework GAS
- [ ] Setup Spreadsheet `RadarPOA_SIKAP_DB` dengan seluruh header kolom standar.
- [ ] Setup script properties, ID master, dan Drive folder `POA_Evidence_SIKAP`.
- [ ] Verifikasi runtime koneksi Google Apps Script dan otentikasi login.

### Fase 2: Sub-Modul A: Realisasi Anggaran (SP2D & Akrual)
- [ ] Form input matriks 2x2: Pagu Reguler vs ABT, Realisasi SP2D vs Akrual.
- [ ] Logika carry-forward pagu dan kewajiban `CatatanRevisiPagu` saat revisi.
- [ ] Kalkulasi server-side serapan nasional, sisa pagu, dan strip KPI keuangan.
- [ ] Tabel riwayat, modal revisi (superseded), dan modal anulir (void).

### Fase 3: Sub-Modul B: Monitoring Paket Pengadaan
- [ ] Form pencatatan progres 6 tahap pengadaan paket per divisi.
- [ ] Field nomor kontrak, rekanan penyedia, progres fisik %, dan keuangan.
- [ ] Upload evidence dokumen kontrak / foto fisik ke Drive.
- [ ] Tabel riwayat pengadaan dan filter per divisi.

### Fase 4: Sub-Modul C: Manajemen Kepegawaian & Headcount
- [ ] Form snapshot headcount 5 kategori (PNS, PPPK, PPPK Paruh Waktu, PJLP, Magang).
- [ ] Logika snapshot carry-forward otomatis tanpa duplikasi berlebih.
- [ ] Strip ringkasan komposisi SDM aparatur TU.

### Fase 5: Sub-Modul D: Inventaris BMN & Geotagging EXIF (Anti-Jebret)
- [ ] Form pendaftaran aset fisik individual per-item (`KodeBarang` + `NUP`).
- [ ] Pipeline geotagging otomatis: Ekstraksi EXIF GPS $ightarrow$ Fallback GPS $ightarrow$ Kalkulasi Haversine ke UPT terdekat.
- [ ] Engine Smart Bulk Import SAKTI Excel (.xlsx) dengan validasi dry-run.
- [ ] Peta Leaflet sebaran aset UPT dan notification summary banner aset Rusak Berat.

### Fase 6: Sub-Modul E: Siklus Usulan Penghapusan Legal Kemenkeu & QA Final
- [ ] Stepper visual 5-tahap usulan penghapusan BMN.
- [ ] Form pembuatan usulan dengan seleksi multi-aset kondisi Rusak Berat.
- [ ] Karantina otomatis status aset (`DALAM_PENGHAPUSAN`) dan eksekusi status akhir `DIHAPUS` saat BAST selesai.
- [ ] Audit konsistensi kontrol UI 3-tier (`node lint_ui.js`), Zero-Emoji Policy, dan UAT end-to-end.
