# PRD.md — Product Requirements Document: SIKAP
**Sistem Informasi Keuangan, Anggaran, dan Kepegawaian (Subbag Tata Usaha - Dit. POA)**

## 1. Pendahuluan & Latar Belakang
Subbag Tata Usaha bertindak sebagai tulang punggung tata kelola administrasi dan manajerial Direktorat Pemantauan dan Operasi Armada (Dit. POA). Dalam arsitektur terdistribusi, **SIKAP** hadir sebagai aplikasi satelit mandiri dengan basis data Google Sheets (`RadarPOA_SIKAP_DB`) dan penyimpanan Google Drive (`POA_Evidence_SIKAP`) terisolasi guna menghindari *lock contention* dan batas kuota sel saat penginputan volume tinggi dan impor data SAKTI.

## 2. Prinsip "Anti-Gabruk" (Modular Input Separation)
Form input di SIKAP dibagi ke dalam 5 sub-modul independen. Setiap sub-modul memiliki payload, tombol submit, validasi server-side, dan tabel riwayat tersendiri:
- **[TU-A] Realisasi Anggaran (SP2D & Akrual)**
- **[TU-B] Monitoring Paket Pekerjaan & Pengadaan**
- **[TU-C] Manajemen Kepegawaian & Headcount**
- **[TU-D] Inventaris Aset Fisik BMN Per-Item (Anti-Jebret)**
- **[TU-E] Siklus Usulan Penghapusan Legal BMN Kemenkeu**

---

## 3. Spesifikasi Fungsional Sub-Modul

### 3.1 [TU-A] Realisasi Anggaran (SP2D & Akrual)
- **Tujuan:** Pelaporan mingguan serapan anggaran negara dengan pemisahan tegas Pagu Reguler vs ABT.
- **Matriks 2x2:**
  - `PaguReguler` & `PaguABT`: Nilai pagu tahunan. Nilai diwariskan dari minggu sebelumnya (carry-forward). Jika terjadi perubahan nilai pagu (revisi DIPA/ABT), pengguna wajib mengisi `CatatanRevisiPagu`.
  - `RealisasiSP2D_Reguler_Minggu` & `RealisasiSP2D_ABT_Minggu`: Nilai kas cair mingguan resmi SP2D.
  - `RealisasiAkrual_Reguler_Minggu` & `RealisasiAkrual_ABT_Minggu`: Nilai komitmen fisik pekerjaan selesai minggu ini.
- **Kalkulasi Server-Side:**
  - `PaguTotal = PaguReguler + PaguABT`
  - `AkumulasiSP2D = Σ RealisasiSP2D_Reguler + Σ RealisasiSP2D_ABT`
  - `SisaPagu = PaguTotal - AkumulasiSP2D`
  - `%Serapan = (AkumulasiSP2D / PaguTotal) * 100`
- **Validasi:** Seluruh angka $\ge 0$. Akumulasi SP2D tidak boleh melebihi Pagu Total (warning/blocking sesuai aturan).

### 3.2 [TU-B] Monitoring Paket Pekerjaan & Pengadaan
- **Tujuan:** Pemantauan berkala siklus hidup paket pekerjaan per divisi (barang, jasa konsultansi, konstruksi, pemeliharaan).
- **Siklus 6 Tahap:** `PERSIAPAN` $ightarrow$ `PEMILIHAN` $ightarrow$ `KONTRAK` $ightarrow$ `PELAKSANAAN` $ightarrow$ `BAST` $ightarrow$ `SELESAI`.
- **Field Data:** `PaketID` (relasi ke `Master_Paket`), `TahapPekerjaan`, `NomorKontrak`, `NilaiKontrak`, `RekananPenyedia`, `ProgresFisikPct` (0-100%), `RealisasiKeuangan`, `KendalaKeterangan`, `EvidenceUrl`.
- **Validasi:** Tahap $\ge$ KONTRAK mewajibkan nomor kontrak, rekanan penyedia, dan nilai kontrak.

### 3.3 [TU-C] Manajemen Kepegawaian & Headcount
- **Tujuan:** Pemantauan komposisi aparatur di lingkungan Subbag TU.
- **Kategori Headcount (5 Kategori):**
  1. `PNS` (Pegawai Negeri Sipil)
  2. `P3K` (Pegawai Pemerintah dengan Perjanjian Kerja - Penuh Waktu)
  3. `P3K_PARUH_WAKTU` (PPPK Paruh Waktu sesuai regulasi KemenPAN-RB)
  4. `PJLP` (Penyedia Jasa Lainnya Perorangan / Honorer)
  5. `MAGANG` (Peserta Magang Resmi / PKL)
- **Mekanisme Data:** Snapshot carry-forward. Nilai periode terakhir otomatis dipertahankan jika tidak ada mutasi baru pada minggu berjalan.

### 3.4 [TU-D] Inventaris Aset Fisik BMN Per-Item (Anti-Jebret)
- **Tujuan:** Pendaftaran inventaris fisik individual (1 baris transaksi = 1 unit fisik tunggal). Dilarang keras input curah/agregat!
- **Kategori Pencatatan:**
  - `BUKU` (Intrakomptabel / Aset Tetap Neraca): $\ge$ batas kapitalisasi (Akun 53), memiliki nilai buku dan disusutkan.
  - `REGULER` (Ekstrakomptabel / Aset Operasional): Di bawah batas kapitalisasi (Akun 52), wajib NUP dan monitoring fisik.
- **Kondisi Fisik:** `BAIK`, `RUSAK_RINGAN`, `RUSAK_BERAT` + wajib foto bukti fisik.
- **Pipeline Geotagging 2-Opsi:**
  - *Opsi 1 (Utama):* Ekstraksi GPS dari metadata EXIF file foto mentah sebelum kompresi kanvas.
  - *Opsi 2 (Fallback):* Koordinat GPS browser pengunggah (`navigator.geolocation`) atau koordinat Homebase profil staf.
  - *Haversine Resolver:* Server otomatis menghitung jarak ke daftar `Master_Lokasi_UPT` dan menentukan UPT terdekat.
- **Smart Bulk Import SAKTI:** Mendukung unggah Excel (.xlsx) data SAKTI dengan validasi dry-run sebelum commit batch.

### 3.5 [TU-E] Siklus Usulan Penghapusan Legal BMN Kemenkeu
- **Tujuan:** Mengelola tata kelola pemusnahan/penghapusan aset Rusak Berat menuju Kemenkeu RI (DJKN/KPKNL).
- **State Machine 5-Tahap:**
  1. `DRAFT_USULAN`: Pengumpulan daftar aset `RUSAK_BERAT` yang eligible.
  2. `SURAT_USULAN`: Penerbitan surat usulan Satker + upload scan surat resmi.
  3. `PERSETUJUAN_KEMENKEU`: Penerbitan izin persetujuan DJKN/KPKNL + upload bukti izin.
  4. `SK_PENGHAPUSAN`: Penerbitan Keputusan Penghapusan KKP + upload SK.
  5. `BAST_SELESAI`: Pelaksanaan pemusnahan / lelang resmi. Status aset di `TX_BMN_Aset` otomatis berubah menjadi `DIHAPUS`.
- **Karantina Aset:** Saat masuk berkas usulan, status aset berubah menjadi `DALAM_PENGHAPUSAN` (tidak bisa didaftarkan ke berkas lain). Jika ditolak atau dibatalkan, status otomatis dipulihkan ke `AKTIF`.

---

## 4. RBAC (Role-Based Access Control)
- **Staf Keuangan:** Akses input & revisi Sub-Modul A (Realisasi Anggaran).
- **Staf Pengadaan:** Akses input & revisi Sub-Modul B (Paket Pengadaan).
- **Staf Kepegawaian:** Akses input & revisi Sub-Modul C (Kepegawaian).
- **Staf BMN:** Akses input, verifikasi, dan usulan Sub-Modul D & E (Inventaris & Penghapusan BMN).
- **Kadiv TU:** Hak penuh CRUD, persetujuan usulan penghapusan, dan anulir (dengan alasan wajib).
- **Direktur / Superadmin:** Akses monitoring menyeluruh dan kontrol audit.
