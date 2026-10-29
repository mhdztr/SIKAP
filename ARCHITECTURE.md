# ARCHITECTURE.md — Arsitektur Teknis Sistem: SIKAP
**Sistem Informasi Keuangan, Anggaran, dan Kepegawaian**  
*Subbag Tata Usaha — Direktorat Pemantauan dan Operasi Armada (Dit. POA)*  
*Direktorat Jenderal Pengawasan Sumber Daya Kelautan dan Perikanan (Ditjen PSDKP)*  
*Kementerian Kelautan dan Perikanan Republik Indonesia (KKP RI)*

---

## 1. Topologi Sistem & Ekosistem Terdistribusi

SIKAP dirancang sebagai sistem satelit mandiri dalam ekosistem intelijen pemantauan armada Dit. POA. Dengan model arsitektur terdistribusi (*decoupled satellite architecture*), SIKAP mengisolasi beban transaksi penulisan volume tinggi (seperti impor massal BMN dan pembaruan mingguan pagu APBN) dari database operasional kapal pengawas.

```
┌────────────────────────────────────────────────────────────────────────┐
│                       CLIENT TIER (BROWSER SPA)                        │
│  HTML5 + Vanilla CSS (Apple HIG 3-Tier) + Vanilla JS (ES6/V8)         │
│  Chart.js 4.4.1 (Linear Context) · Leaflet 1.9.4 (Spatial UPT Map)     │
│  SheetJS (XLSX) · Canvas Compression Engine · EXIF-GPS Parser          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ google.script.run (RPC JSON)
┌───────────────────────────────────▼────────────────────────────────────┐
│                  SERVERLESS GATEWAY TIER (GAS RUNTIME)                 │
│  V8 JavaScript Engine · Google Apps Script Serverless Container        │
│  doGet() HTML Service (ALLOWALL Iframe Embedding)                      │
│  Concurrency Lock: LockService.getScriptLock() (15s - 30s Wait)        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
       ┌────────────────────────────┼────────────────────────────┐
       │                            │                            │
┌──────▼─────────────┐    ┌─────────▼──────────┐    ┌────────────▼─────────┐
│   SERVICES TIER    │    │   DATA ACCESS TIER │    │  UTILITIES & HELPERS │
│ • TataUsahaService │    │ • SheetAccess.js   │    │ • Constants.js       │
│ • BMNService       │    │ • Self-Healing DB  │    │ • DateUtil.js        │
│ • EvidenceService  │    │ • Range.setValues()│    │ • Lock.js            │
│ • AuthService      │    │ • Row Versioning   │    │ • lint_ui.js (CLI)   │
│ • AdminService     │    │ • Memory Object Map│    │                      │
└──────┬─────────────┘    └─────────┬──────────┘    └──────────────────────┘
       │                            │
       └────────────────────────────┼────────────────────────────┐
                                    │                            │
┌───────────────────────────────────▼───────────┐   ┌────────────▼─────────┐
│         DATABASE TIER (GOOGLE SHEETS)         │   │  STORAGE TIER (DRIVE)│
│  1. RadarPOA_SIKAP_DB (Dedicated Satelit)     │   │  POA_Evidence_SIKAP  │
│     • TX_TataUsaha       • TX_BMN_Aset        │   │  ├── Aset_BMN/       │
│     • TX_Paket_Progres   • TX_BMN_Penghapusan │   │  ├── Surat_Hps/      │
│     • TX_TU_Pegawai      • TX_BMN_Hps_Detail  │   │  └── Kontrak_Paket/  │
│     • TX_Evidence                             │   └──────────────────────┘
│  2. RadarPOA_Master_DB (Shared Read-Only)     │
│     • Users · Divisi · Opsi · Master_UPT      │
└───────────────────────────────────────────────┘
```

---

## 2. Struktur Modul & Layering Backend

Arsitektur kode SIKAP menerapkan prinsip pemisahan tanggung jawab (*Separation of Concerns*) yang ketat:

```
SIKAP/
├── Code.js                     # Entry point doGet() & debug tools
├── utils/
│   ├── Constants.js            # ID Master, Enum peran, Sheet mapping, batas file
│   ├── DateUtil.js             # Generator rentang tanggal ISO, parsing periode mingguan
│   └── Lock.js                 # Wrapper eksekusi aman LockService
├── data/
│   └── SheetAccess.js          # Layer abstraksi spreadsheet, self-heal, appendRowData
├── services/
│   ├── AuthService.js          # Autentikasi sesi, hashing SHA-256, RBAC verification
│   ├── TataUsahaService.js     # Logika sub-modul A (Anggaran), B (Paket), C (Pegawai)
│   ├── BMNService.js           # Sub-modul D (BMN, Geotagging, Impor) & E (Penghapusan)
│   ├── EvidenceService.js      # Pengelolaan lampiran dokumen/foto ke Google Drive
│   └── AdminService.js         # Panel Superadmin (manajemen akun, audit trail)
├── html/
│   ├── Index.html              # Shell HTML utama, layout sidebar, modal konteks global
│   ├── Style.html              # Design system CSS Apple HIG & Skala Kontrol 3-Tier
│   ├── Script_Main.html        # SPA Controller, routing tab anti-gabruk, event handlers
│   ├── Script_Charts.html      # Rendering Chart.js context linear tanpa 3D/gauge
│   └── views/
│       ├── TataUsaha.html      # Template 5 sub-modul mandiri TU & modal dialog
│       └── Admin.html          # Panel administrasi registrasi & audit log
└── lint_ui.js                  # Engine linter otomatis penjamin mutu desain & arsitektur
```

---

## 3. Konvensi Fungsi Layanan Publik (API Interface)

Seluruh komunikasi antara antarmuka web dan server Google Apps Script menggunakan protokol Remote Procedure Call (RPC) via `google.script.run`.

### 3.1 Sub-Modul A (Realisasi Anggaran)
- `tataUsaha_getKPI(token, filter)`: Mengambil agregasi finansial YTD, sisa pagu kas SP2D, realisasi akrual fisik, persentase serapan nasional, dan frekuensi revisi pagu.
- `tataUsaha_getHistory(token, filter)`: Mengambil daftar kronologis laporan mingguan berstatus `ACTIVE` maupun `SUPERSEDED` untuk audit.
- `tataUsaha_submitMingguan(token, params)`: Menginput pelaporan serapan minggu berjalan dengan validasi duplikasi periode.
- `tataUsaha_revisi(token, params)`: Menandai entri lama sebagai `SUPERSEDED` dan meng-append baris revisi baru dengan relasi `SupersedesRowID`.
- `tataUsaha_anulir(token, params)`: Membatalkan laporan aktif menjadi `VOID` dengan pencatatan `VoidReason` wajib.

### 3.2 Sub-Modul B (Monitoring Paket Pengadaan)
- `tataUsaha_getPaket(token, filter)`: Mengambil daftar progres paket pengadaan lintas divisi.
- `tataUsaha_submitPaket(token, payload)`: Menyimpan atau memperbarui progres siklus 6 tahap pekerjaan pengadaan.
- `tataUsaha_anulirPaket(token, params)`: Membatalkan rekaman progres paket dengan alasan wajib.

### 3.3 Sub-Modul C (Manajemen Kepegawaian)
- `tataUsaha_getPegawai(token, filter)`: Mengambil komposisi snapshot terkini dari 5 kategori aparatur beserta riwayat mutasi.
- `tataUsaha_submitPegawai(token, params)`: Mengirimkan pembaruan snapshot mingguan personil aparatur.
- `tataUsaha_anulirPegawai(token, params)`: Membatalkan snapshot kepegawaian periode tertentu.

### 3.4 Sub-Modul D (Inventaris Fisik BMN Granular)
- `bmn_getMasters(token)`: Memuat daftar katalog kategori BMN dan master lokasi UPT PSDKP.
- `bmn_getAsetList(token, params)`: Mengambil daftar filterable aset BMN dengan paginasi virtual.
- `bmn_getSummary(token, filter)`: Mengambil KPI nilai perolehan kotor, nilai buku terkini, rasio kelaikan fisik, dan rekapitulasi kondisi.
- `bmn_submitAset(token, params)`: Mendaftarkan unit aset fisik tunggal dengan resolusi koordinat EXIF dan Haversine.
- `bmn_importBatchAset(token, payload)`: Melakukan penulisan batch (*chunked array write*) data impor SAKTI dengan `Range.setValues()`.
- `bmn_anulirAset(token, params)`: Membatalkan entri aset BMN tunggal.

### 3.5 Sub-Modul E (Siklus Usulan Penghapusan BMN)
- `bmn_getAsetEligibleHapus(token)`: Mengambil daftar aset berstatus `AKTIF` dengan prioritas kondisi `RUSAK_BERAT`.
- `bmn_createPenghapusan(token, payload)`: Membuat berkas usulan baru, mencatat detail item, dan mengunci status aset menjadi `DALAM_PENGHAPUSAN`.
- `bmn_getPenghapusanList(token, params)`: Mengambil daftar berkas usulan penghapusan.
- `bmn_getPenghapusanDetail(token, penghapusanId)`: Mengambil metadata berkas, riwayat lampiran surat, dan daftar item aset di dalamnya.
- `bmn_advancePenghapusan(token, payload)`: Memajukan tahapan berkas penghapusan (mengunggah nomor dan link surat/SK/BAST). Saat tahap `BAST_SELESAI`, aset otomatis berubah menjadi `DIHAPUS`.
- `bmn_voidPenghapusan(token, params)`: Membatalkan berkas usulan penghapusan dan otomatis memulihkan seluruh aset terkait kembali ke status `AKTIF`.

---

## 4. Pola Transaksi Non-Destruktif & Concurrency Control

### 4.1 Locking Script (LockService)
Seluruh operasi manipulasi data (*create*, *update*, *revisi*, *anulir*, *bulk-import*) diwajibkan melewati proteksi konkurensi:

```javascript
var lock = LockService.getScriptLock();
try {
  // Tunggu hingga 20 detik jika ada operasi tulis lain yang sedang berlangsung
  var success = lock.waitLock(20000);
  if (!success) {
    return { success: false, error: 'Sistem sedang sibuk melayani transaksi lain. Silakan coba beberapa detik lagi.' };
  }
  
  // Eksekusi penulisan spreadsheet...
  
} finally {
  lock.releaseLock();
}
```

### 4.2 Append-Only Versioning & Auditability
Tidak ada baris data historis yang dihapus secara fisik (`DELETE` row di spreadsheet). Seluruh riwayat transaksi dilacak melalui state diagram:

```
[ Baru Dibuat ] ───────────► Status = 'ACTIVE'
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
      [ Diperbarui / Revisi ]                   [ Dibatalkan / Anulir ]
    Status = 'SUPERSEDED'                           Status = 'VOID'
   Baris baru di-append dengan                     Wajib mencatat:
   SupersedesRowID = RowID_Lama                   VoidReason, VoidedBy, VoidedAt
```

---

## 5. Algoritma Geotagging & Haversine Resolver

Untuk memastikan setiap aset BMN terikat secara fisik ke pangkalan UPT terdekat, SIKAP mengimplementasikan pipeline resolusi koordinat berjenjang:

```
1. Client-Side: Baca EXIF GPS asli dari file gambar mentah
         │
         ├──► Ada koordinat? ──► Gunakan (SumberLokasi = 'EXIF_GPS')
         │
         └──► Kosong / Dihapus?
                   │
                   ├──► Cek GPS Browser (navigator.geolocation) ──► Ada? (SumberLokasi = 'GPS_PENGUNGGAH')
                   │
                   └──► Ditolak / Desktop? ──► Gunakan Homebase Profil (SumberLokasi = 'PROFIL_PENGUNGGAH')
```

### Formula Matematika Haversine (Server-Side)
Jarak busur lingkaran besar antara koordinat aset $(\phi_1, \lambda_1)$ dan koordinat stasiun UPT $(\phi_2, \lambda_2)$ dihitung dengan jari-jari rata-rata bumi $R = 6.371\text{ km}$:

$$\Delta \phi = \frac{(\phi_2 - \phi_1) \cdot \pi}{180}, \quad \Delta \lambda = \frac{(\lambda_2 - \lambda_1) \cdot \pi}{180}$$

$$a = \sin^2\left(\frac{\Delta \phi}{2}\right) + \cos\left(\frac{\phi_1 \cdot \pi}{180}\right) \cdot \cos\left(\frac{\phi_2 \cdot \pi}{180}\right) \cdot \sin^2\left(\frac{\Delta \lambda}{2}\right)$$

$$c = 2 \cdot \text{atan2}\left(\sqrt{a}, \sqrt{1 - a}\right)$$

$$d = R \cdot c \quad (\text{dalam kilometer})$$

Server mengiterasi seluruh 15 pangkalan UPT di `Master_Lokasi_UPT`, menentukan UPT dengan nilai $d$ terkecil, dan menyimpannya secara otomatis ke kolom `LokasiID` dan `JarakKeUPT_Km`.

---

## 6. Arsitektur State Machine Siklus Penghapusan BMN

Berkas penghapusan aset diatur melalui state machine deterministik:

| Status Saat Ini (`Tahap`) | Aksi Transisi (`advance`) | Syarat Dokumen & Input | Status Aset Terkait | Tahap Berikutnya |
|---|---|---|:---:|---|
| **DRAFT_USULAN** | Ajukan Berkas Resmi | `NomorSuratUsulan`, `TanggalSuratUsulan`, `EvidenceSuratUsulan` | `DALAM_PENGHAPUSAN` | **SURAT_USULAN** |
| **SURAT_USULAN** | Terbitkan Izin Kemenkeu | `NomorSuratPersetujuan`, `TanggalSuratPersetujuan`, `InstansiKemenkeu`, `EvidenceSuratPersetujuan` | `DALAM_PENGHAPUSAN` | **PERSETUJUAN_KEMENKEU** |
| **PERSETUJUAN_KEMENKEU** | Terbitkan SK KKP | `NomorSK`, `TanggalSK`, `EvidenceSK` | `DALAM_PENGHAPUSAN` | **SK_PENGHAPUSAN** |
| **SK_PENGHAPUSAN** | Selesaikan BAST Fisik | `EvidenceBAST` (Dokumen BAST Pemusnahan / Risalah Lelang) | `DIHAPUS` | **BAST_SELESAI** |
| *Tahap Apa Saja* | Tolak Berkas | Surat Penolakan / Catatan DJKN | `AKTIF` (Pulih) | **DITOLAK** |
| *Tahap Apa Saja* | Anulir Berkas | `VoidReason` wajib oleh Kadiv/Direktur | `AKTIF` (Pulih) | **VOID** |

---

## 7. Struktur Folder & Pengelolaan File Google Drive

Seluruh berkas bukti fisik, pindaian surat dinas, dan dokumentasi foto disimpan dalam Google Drive `POA_Evidence_SIKAP` dengan partisi hierarkis:

```
POA_Evidence_SIKAP/
├── Aset_BMN/
│   └── YYYY-MM/
│       └── BMN-[KodeBarang]-[NUP]-[UUID].jpg
├── Surat_Penghapusan/
│   └── [PenghapusanID]/
│       ├── Surat_Usulan_[PenghapusanID].pdf
│       ├── Persetujuan_Kemenkeu_[PenghapusanID].pdf
│       ├── SK_Penghapusan_[PenghapusanID].pdf
│       └── BAST_Pemusnahan_[PenghapusanID].pdf
└── Kontrak_Paket/
    └── [PaketID]/
        └── Kontrak_[NomorKontrak].pdf
```

Setiap file yang berhasil disimpan ke Drive otomatis diindeks pada tabel `TX_Evidence` dengan mencatat `DriveFileID`, `RefSheet`, `RefRowID`, `FileName`, `FileType`, `SourceMode`, `UploadedBy`, dan `UploadedAt`.

---

## 8. Mekanisme Self-Healing Database
Untuk mencegah error saat instalasi baru atau perpindahan environment Spreadsheet, modul [data/SheetAccess.js](file:///home/pinefeast/Projects/SIKAP/data/SheetAccess.js) mengimplementasikan fungsi [openTuSheet(sheetName)](file:///home/pinefeast/Projects/SIKAP/data/SheetAccess.js#L102):
1. Membaca Script Property `TU_SS_ID` atau `SIKAP_SS_ID`.
2. Jika belum ada atau spreadsheet terhapus, fungsi [ensureTuSpreadsheet()](file:///home/pinefeast/Projects/SIKAP/data/SheetAccess.js#L117) otomatis membuat spreadsheet baru dengan nama `RadarPOA_SIKAP_DB` dan menyimpan ID-nya ke Script Properties.
3. Saat sebuah sheet dibuka, jika sheet tersebut belum ada, [_autoCreateTuSheet()](file:///home/pinefeast/Projects/SIKAP/data/SheetAccess.js#L165) langsung menginisialisasi sheet tersebut dengan baris header standar relasional lengkap dengan formatting tebal dan baris beku (*frozen header row*).
