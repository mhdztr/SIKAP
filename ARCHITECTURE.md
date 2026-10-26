# ARCHITECTURE.md — Arsitektur Teknis: SIKAP
**Sistem Informasi Keuangan, Anggaran, dan Kepegawaian (Subbag Tata Usaha)**

## 1. Topologi Sistem & Ekosistem
- **Runtime:** Google Apps Script (HTML Service + V8 JavaScript Engine)
- **Database:** Google Spreadsheet `RadarPOA_SIKAP_DB`
- **File Storage:** Google Drive Folder `POA_Evidence_SIKAP` (terbagi sub-folder: `Aset_BMN`, `Surat_Penghapusan`, `Kontrak_Paket`)
- **Master Data Sharing:** Membaca read-only dari `RadarPOA_Master_DB` (`Master_Lokasi_UPT`, `Master_BMN_Kategori`, `Master_Paket`, `Opsi`).

## 2. Struktur Modul & Layanan Backend
```
services/
├── TataUsahaService.js       # Realisasi anggaran, paket, dan kepegawaian
├── BMNService.js             # Register BMN, geotagging, dan import SAKTI
├── PenghapusanBMNService.js  # State machine siklus penghapusan legal Kemenkeu
├── MasterService.js          # Pembacaan master UPT, kategori, dan opsi
└── AuditService.js           # Pencatatan audit log transaksi & anulir
```

## 3. Konvensi Fungsi Layanan (Service Functions)
- `tu_getSummary(token, filter)`: Mengambil KPI keuangan, headcount, dan paket.
- `tu_submitRealisasi(token, payload)`: Submit transaksi mingguan anggaran.
- `tu_submitPaketProgres(token, payload)`: Update progres fisik dan keuangan paket.
- `tu_updatePegawai(token, payload)`: Update snapshot jumlah pegawai.
- `bmn_registerAset(token, payload)`: Pendaftaran single unit aset dengan EXIF & Haversine.
- `bmn_bulkImportSakti(token, rows)`: Batch write impor SAKTI dengan `Range.setValues()`.
- `bmn_createPenghapusan(token, payload)`: Buat berkas usulan penghapusan + karantina aset.
- `bmn_advancePenghapusan(token, payload)`: Transisi tahapan state machine penghapusan.

## 4. Pola Transaksi & Versioning (Non-Overwrite)
1. Setiap transaksi di sheet mingguan (`TX_TataUsaha`, `TX_Paket_Progres`, `TX_TU_Pegawai`) tidak pernah melakukan `UPDATE` fisik pada baris lama.
2. **Revisi:** Baris lama ditandai `Status = 'SUPERSEDED'`, dan baris baru di-append dengan kolom `SupersedesRowID` menunjuk ke RowID lama.
3. **Anulir:** Baris ditandai `Status = 'VOID'` dengan kewajiban mencatat `VoidReason`, `VoidedBy`, dan `VoidedAt`.
4. **Proteksi Concurrency:** Seluruh fungsi tulis dibungkus dengan `LockService.getScriptLock()` (maksimal tunggu 15-30 detik).

## 5. Algoritma Geotagging & Haversine Resolver
1. Ekstraksi EXIF GPS (`latitude`, `longitude`) dari file gambar asli di client.
2. Jika EXIF kosong $ightarrow$ Fallback ke koordinat GPS perangkat browser (`navigator.geolocation`).
3. Jika ditolak $ightarrow$ Fallback ke koordinat Homebase akun pengguna di profil `Users`.
4. Server menghitung jarak Haversine:
   $$d = 2r \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)}\right)$$
   terhadap seluruh koordinat di `Master_Lokasi_UPT`. Lokasi dengan jarak terkecil disimpan di kolom `LokasiID` dan `JarakKeUPT_Km`.
