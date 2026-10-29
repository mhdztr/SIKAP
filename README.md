# SIKAP — Sistem Informasi Keuangan, Anggaran, dan Kepegawaian
> **Aplikasi Satelit Mandiri Subbag Tata Usaha**  
> *Direktorat Pemantauan dan Operasi Armada (Dit. POA)*  
> *Direktorat Jenderal Pengawasan Sumber Daya Kelautan dan Perikanan (Ditjen PSDKP)*  
> *Kementerian Kelautan dan Perikanan Republik Indonesia (KKP RI)*

---

## 1. Ikhtisar Sistem

**SIKAP** adalah sistem informasi manajemen terintegrasi yang berfungsi sebagai tulang punggung tata kelola administratif, finansial, dan logistik di lingkungan Direktorat Pemantauan dan Operasi Armada. SIKAP dibangun dengan arsitektur satelit mandiri berkinerja tinggi (*distributed satellite system*) di atas runtime Google Apps Script (GAS) dan Google Spreadsheet untuk menjamin stabilitas data operasional volume tinggi tanpa menimbulkan persaingan kunci (*lock contention*) pada basis data pusat operasional armada.

### Parameter Identitas Teknis:
- **Script ID (Google Apps Script):** `1Cpuia8-M-g0b3S_IOKKrwn-T4XSIjQbHiYJm85Mhr7XhVFfe3QugZmJv`
- **Repositori GitHub:** `https://github.com/mhdztr/SIKAP.git`
- **Spreadsheet Basis Data Satelit:** `RadarPOA_SIKAP_DB`
- **Spreadsheet Master Data (Read-Only):** `RadarPOA_Master_DB`
- **Penyimpanan Berkas Digital:** Google Drive Folder `POA_Evidence_SIKAP`

---

## 2. 5 Sub-Modul Mandiri (Prinsip Anti-Gabruk)

Sesuai mandat bisnis, form input dan alur transaksi SIKAP dipisahkan secara modular ke dalam 5 sub-modul independen:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       SIKAP PORTAL TATA USAHA                                   │
├─────────────────────┬─────────────────────┬─────────────────────┬───────────────────────────────┤
│ [TU-A] ANGGARAN     │ [TU-B] PENGADAAN    │ [TU-C] KEPEGAWAIAN  │ [TU-D] INVENTARIS BMN         │
│ • Pagu Reguler/ABT  │ • Siklus 6 Tahap    │ • 5 Kategori SDM    │ • Granular 1 Unit = 1 Baris   │
│ • SP2D vs Akrual    │ • Rekanan & SPK     │ • Snapshot Weekly   │ • Geotagging EXIF & Haversine │
│ • Sisa Pagu Kas YTD │ • Realisasi Fisik/% │ • Carry-Forward SDM │ • Smart Bulk Import SAKTI     │
├─────────────────────┴─────────────────────┴─────────────────────┴───────────────────────────────┤
│ [TU-E] SIKLUS USULAN PENGHAPUSAN LEGAL BMN KEMENKEU (DJKN / KPKNL)                              │
│ • State Machine 5-Tahap: DRAFT → SURAT USULAN → PERSETUJUAN KEMENKEU → SK KKP → BAST SELESAI   │
│ • Karantina Status Aset: AKTIF ──► DALAM_PENGHAPUSAN ──► DIHAPUS (atau rollback otomatis ke AKTIF)│
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **[TU-A] Realisasi Anggaran (SP2D & Akrual):**
   Pelaporan mingguan serapan APBN berbasis matriks 2x2 (Pagu Reguler vs ABT, Realisasi SP2D kas cair vs Realisasi Akrual komitmen fisik). Dilengkapi logika *carry-forward* nilai pagu, kewajiban catatan revisi pagu, perhitungan sisa pagu, serta versioning non-destruktif (`SUPERSEDED` dan `VOID`).
2. **[TU-B] Monitoring Paket Pengadaan:**
   Pemantauan siklus 6 tahap pekerjaan pengadaan (`PERSIAPAN` → `PEMILIHAN` → `KONTRAK` → `PELAKSANAAN` → `BAST` → `SELESAI`), kepatuhan rekanan penyedia, nomor kontrak SPK, persentase progres fisik (0-100%), dan realisasi keuangan.
3. **[TU-C] Manajemen Kepegawaian & Headcount:**
   Pemantauan komposisi aparatur dalam 5 kategori resmi pemerintah (`PNS`, `P3K`, `P3K_PARUH_WAKTU`, `PJLP`, `MAGANG`) menggunakan model snapshot carry-forward otomatis tanpa duplikasi berlebih.
4. **[TU-D] Inventaris Granular BMN (Anti-Jebret):**
   Pendaftaran fisik aset per-unit individual (1 unit riil = 1 baris transaksi; tanpa input curah). Dilengkapi dual engine geotagging (ekstraksi EXIF GPS foto asli + fallback GPS browser), resolver jarak Haversine ke 15 pangkalan UPT PSDKP, Smart Bulk Import SAKTI Excel (.xlsx) dengan validasi dry-run, dan peta Leaflet.
5. **[TU-E] Siklus Usulan Penghapusan Legal BMN Kemenkeu:**
   State machine 5 tahap tata kelola hukum pemusnahan aset Rusak Berat menuju Kementerian Keuangan RI (DJKN/KPKNL) dengan mekanisme karantina aset otomatis (`DALAM_PENGHAPUSAN`) hingga status akhir `DIHAPUS`.

---

## 3. Desain Antarmuka & Skala Geometri 3-Tier

Antarmuka SIKAP dibangun mengikuti standar **Apple Human Interface Guidelines (WWDC)**:
- **Respon Taktikal:** Kompresi elastis seketika pada saat tombol ditekan (`:active { transform: scale(0.975); }`).
- **Kedalaman Optik:** Permukaan kartu translusen dengan `backdrop-filter: blur(24px) saturate(190%)` dipadu border hairline ganda.
- **Tipografi Tabular:** Plus Jakarta Sans dengan kewajiban `font-variant-numeric: tabular-nums` pada seluruh angka finansial (Rp), persentase, kode NUP, dan tanggal.

### Skala Geometri Kontrol Tunggal (3-Tier Scale):
| Tier | Tinggi Kontainer | Padding Horizontal | Radius Sudut | Ukuran Font | Peruntukan Khusus |
|---|:---:|:---:|:---:|:---:|---|
| **LG** | `40px` | `16px` | `10px` | `14px` (0.875rem) | Toolbar filter utama, input form modal, tombol submit primer dialog |
| **MD** | `32px` | `12px` | `8px` | `13px` (0.8125rem) | Kontrol sekunder, baris tombol modal dialog, filter grid tabel |
| **SM** | `26px` | `10px` | `6px` | `12px` (0.75rem) | Khusus aksi baris tabel (*in-table action*: Detail, Revisi, Anulir mini) |

### Negative Prompts (Larangan UI Mutlak):
1. **Zero-Emoji Policy:** Bersih 100% dari karakter unicode emoji; seluruh ikon wajib menggunakan inline SVG presisi (stroke-width 2px).
2. **Bebas Speedometer / Gauge Melingkar:** Menggunakan linear progress bar horizontal dengan angka persentase numerik tabular.
3. **Bebas 3D Chart & Bevel Retro:** Visualisasi grafik konteks bulanan disajikan dalam bentuk 2D bersih.
4. **Bebas Warna Pelangi Acak:** Konsisten pada palet Maritime Navy, Slate, dan warna semantik status resmi.
5. **Bebas Animasi Infinite Wobble/Shake:** Seluruh animasi transisi wajib bertujuan fungsional (*purpose-driven motion*).

---

## 4. Struktur Direktori Repositori

```
SIKAP/
├── Code.js                     # Handler doGet() & diagnostik sistem
├── appsscript.json             # Manifest Apps Script (V8 runtime, scopes)
├── .clasp.json                 # Konfigurasi deploy Google Clasp
├── .claspignore                # Filter berkas agar dokumentasi/test tidak masuk GAS
├── lint_ui.js                  # Engine linter audit kepatuhan desain & arsitektur
├── services/                   # Service Layer (Business Logic Backend)
│   ├── AuthService.js          # Autentikasi sesi, hashing SHA-256, verifikasi RBAC
│   ├── TataUsahaService.js     # Realisasi Anggaran, Paket Pengadaan, Kepegawaian
│   ├── BMNService.js           # Pendaftaran BMN, Haversine UPT, Import SAKTI, Penghapusan
│   ├── EvidenceService.js      # Pengelolaan berkas bukti fisik di Google Drive
│   └── AdminService.js         # Manajemen akun pengguna dan pencatatan audit log
├── data/                       # Data Access Layer
│   └── SheetAccess.js          # Abstraksi spreadsheet, self-healing sheets, locking
├── utils/                      # Helper & Utilities
│   ├── Constants.js            # ID Master, Enum peran, Sheet mapping, batas file
│   ├── DateUtil.js             # Generator rentang ISO dan parsing periode minggu
│   └── Lock.js                 # Wrapper eksekusi aman LockService
├── html/                       # Presentation Layer (SPA Frontend)
│   ├── Index.html              # Shell HTML utama, layout sidebar, modal global
│   ├── Style.html              # CSS Design System (Apple HIG & 3-Tier Scale)
│   ├── Script_Main.html        # SPA Controller & event handling antarmuka
│   ├── Script_Charts.html      # Rendering grafik konteks bulanan Chart.js
│   └── views/                  # Partial Templates (di-include server-side)
│       ├── TataUsaha.html      # Template 5 sub-modul mandiri TU & modal dialog
│       └── Admin.html          # Panel antrean persetujuan & pengguna
└── docs/
    ├── PRD.md                  # Product Requirements Document (Sumber kebenaran tertinggi)
    ├── ARCHITECTURE.md         # Arsitektur teknis, LockService, Haversine, state machine
    ├── DATA_SCHEMA.md          # Skema basis data relasional & kamus kolom lengkap
    ├── DESIGN.md               # Standar desain antarmuka, token visual, 3-tier scale
    ├── PHASES.md               # Roadmap pengembangan & matriks verifikasi QA
    ├── AGENTS.md               # Panduan kerja & batasan keras AI coding agent
    └── CHANGELOG.md            # Catatan riwayat pembaruan sistem per versi
```

---

## 5. Panduan Instalasi & Deployment

### 5.1 Prasyarat
- Node.js versi 18 atau lebih baru.
- Google Clasp (`npm install -g @google/clasp`).
- Akun Google dengan akses izin edit ke Google Spreadsheet basis data dan Google Drive.

### 5.2 Konfigurasi Script Properties (Google Apps Script)
Sebelum menjalankan aplikasi, pastikan Script Properties berikut telah dikonfigurasi melalui Project Settings editor GAS:

| Kunci Properti | Deskripsi Nilai |
|---|---|
| `MASTER_SS_ID` | Spreadsheet ID basis data pusat `RadarPOA_Master_DB`. |
| `TU_SS_ID` / `SIKAP_SS_ID` | Spreadsheet ID basis data satelit `RadarPOA_SIKAP_DB`. |
| `LOG_SS_ID` | Spreadsheet ID logging audit transaksi (opsional; fallback ke Master). |

*(Catatan: Jika `TU_SS_ID` belum diisi saat pertama kali dijalankan, sistem secara mandiri akan membuat spreadsheet `RadarPOA_SIKAP_DB` baru via self-healing engine).*

### 5.3 Menjalankan Audit Linter Desain Mandiri
Sebelum melakukan deploy, jalankan linter antarmuka untuk memastikan kode mematuhi seluruh aturan [AGENTS.md](file:///home/pinefeast/Projects/SIKAP/AGENTS.md) dan [DESIGN.md](file:///home/pinefeast/Projects/SIKAP/DESIGN.md):
```bash
node lint_ui.js
```
Output sukses:
```text
LINT UI AUDIT FINISHED: 10 checks passed, 0 error(s), 0 warning(s).
CONGRATULATIONS: Seluruh audit konsistensi UI, 3-tier kontrol, dan arsitektur SIKAP lolos 100% tanpa pelanggaran!
```

### 5.4 Push Kode ke Google Apps Script via Clasp
```bash
# Login ke akun Google Anda
clasp login

# Push seluruh kode proyek ke GAS container
clasp push
```

---

## 6. Referensi Dokumen Wajib Proyek

1. [PRD.md](file:///home/pinefeast/Projects/SIKAP/PRD.md) — Kebutuhan fungsional dan aturan bisnis (Sumber kebenaran tertinggi).
2. [ARCHITECTURE.md](file:///home/pinefeast/Projects/SIKAP/ARCHITECTURE.md) — Arsitektur teknis, LockService, state machine, dan algoritma geotagging.
3. [DATA_SCHEMA.md](file:///home/pinefeast/Projects/SIKAP/DATA_SCHEMA.md) — Skema kolom tabel transaksi dan master.
4. [DESIGN.md](file:///home/pinefeast/Projects/SIKAP/DESIGN.md) — Standar antarmuka 3-tier controls scale dan Apple HIG.
5. [PHASES.md](file:///home/pinefeast/Projects/SIKAP/PHASES.md) — Roadmap dan rencana pengembangan bertahap.
6. [AGENTS.md](file:///home/pinefeast/Projects/SIKAP/AGENTS.md) — Instruksi dan batasan kerja bagi coding agent.
7. [CHANGELOG.md](file:///home/pinefeast/Projects/SIKAP/CHANGELOG.md) — Riwayat pembaruan berkala sistem.
