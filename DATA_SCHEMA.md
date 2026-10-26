# DATA_SCHEMA.md — Skema Basis Data: SIKAP
**Spreadsheet Basis Data:** `RadarPOA_SIKAP_DB`

## Kolom Standar Relasional (Ada di Setiap Sheet `TX_*`)
| Kolom | Tipe | Keterangan |
|---|---|---|
| `RowID` | text (PK) | Format unik per modul, mis. `TU-2026-XXXX` |
| `DivisiID` | text | Selalu `DIV-TU` |
| `Periode` | text | Format `YYYY-MM-WW` atau `YYYY-MM` |
| `SubmittedBy` | ref(Users) | UserID pembuat data |
| `Timestamp` | datetime | Waktu pencatatan data |
| `Status` | enum | `ACTIVE`, `SUPERSEDED`, `VOID` |
| `SupersedesRowID`| ref(Self) | Diisi jika merupakan revisi |
| `VoidReason` | text | Catatan alasan pembatalan (wajib jika VOID) |
| `VoidedBy` | ref(Users) | UserID yang menganulir |
| `VoidedAt` | datetime | Waktu pembatalan |

---

## 1. `TX_TataUsaha` (Realisasi Anggaran SP2D & Akrual)
Kolom standar +
| Kolom | Tipe | Keterangan |
|---|---|---|
| `PaguReguler` | number | Pagu DIPA Reguler (Rp) |
| `PaguABT` | number | Pagu Anggaran Belanja Tambahan (Rp) |
| `RealisasiSP2D_Reguler_Minggu` | number | Realisasi kas cair SP2D Reguler minggu berjalan |
| `RealisasiSP2D_ABT_Minggu` | number | Realisasi kas cair SP2D ABT minggu berjalan |
| `RealisasiAkrual_Reguler_Minggu` | number | Komitmen pekerjaan fisik selesai Reguler minggu berjalan |
| `RealisasiAkrual_ABT_Minggu` | number | Komitmen pekerjaan fisik selesai ABT minggu berjalan |
| `CatatanRevisiPagu` | text, nullable | Wajib diisi jika Pagu berubah dari versi sebelumnya |

---

## 2. `TX_Paket_Progres` (Monitoring Siklus Pengadaan)
Kolom standar +
| Kolom | Tipe | Keterangan |
|---|---|---|
| `PaketID` | ref(Master_Paket) | ID paket pengadaan |
| `TahapPekerjaan` | enum | `PERSIAPAN`, `PEMILIHAN`, `KONTRAK`, `PELAKSANAAN`, `BAST`, `SELESAI` |
| `NomorKontrak` | text, nullable | Nomor SPK / Kontrak kerja |
| `NilaiKontrak` | number | Nilai nominal kontrak kerja (Rp) |
| `RekananPenyedia` | text | Nama perusahaan vendor penyedia |
| `ProgresFisikPct` | number | Capaian fisik lapangan (0 - 100) |
| `RealisasiKeuangan` | number | Nilai dana kas yang telah dibayarkan |
| `KendalaKeterangan` | text, nullable | Hambatan dan kendala pelaksanaan |
| `EvidenceUrl` | text, nullable | Tautan dokumen kontrak / foto fisik di Drive |

---

## 3. `TX_TU_Pegawai` (Snapshot Headcount Kepegawaian)
Kolom standar +
| Kolom | Tipe | Keterangan |
|---|---|---|
| `Kategori` | enum | `PNS`, `P3K`, `P3K_PARUH_WAKTU`, `PJLP`, `MAGANG` |
| `Jumlah` | number | Jumlah aparatur aktif ($\ge 0$) |
| `Keterangan` | text, nullable | Catatan mutasi (promosi, pensiun, rotasi) |

---

## 4. `TX_BMN_Aset` (Register Inventaris Fisik Per-Item)
Kolom standar +
| Kolom | Tipe | Keterangan |
|---|---|---|
| `AsetID` | text (UUID) | ID unik stabil fisik aset |
| `KodeBarang` | text | Kode 10 digit katalog BMN Kemenkeu |
| `NUP` | text | Nomor Urut Pendaftaran |
| `NamaBarang` | text | Deskripsi nama inventaris |
| `MerekTipe` | text, nullable | Merk dan tipe spesifikasi pabrikan |
| `KategoriPencatatan` | enum | `BUKU` (Intrakomptabel) vs `REGULER` (Ekstrakomptabel) |
| `KodeKategori` | ref(Master_BMN_Kategori)| Kategori kelompok aset |
| `TanggalPerolehan` | date | Tanggal perolehan / pembelian |
| `NilaiPerolehan` | number | Nilai beli kotor (Rp) |
| `NilaiBuku` | number | Nilai buku terkini dari SAKTI (Rp) |
| `Kondisi` | enum | `BAIK`, `RUSAK_RINGAN`, `RUSAK_BERAT` |
| `LokasiID` | ref(Master_Lokasi_UPT) | Pangkalan / UPT penempatan |
| `LokasiDetailRuangan`| text, nullable | Lokasi ruang / anjungan spesifik |
| `Latitude` | number, nullable | Koordinat lintang geotagging |
| `Longitude` | number, nullable | Koordinat bujur geotagging |
| `SumberLokasi` | enum | `EXIF_GPS`, `GPS_PENGUNGGAH`, `PROFIL_PENGUNGGAH`, `MANUAL`, `IMPOR_SAKTI` |
| `JarakKeUPT_Km` | number, nullable | Hasil kalkulasi Haversine ke UPT terdekat |
| `FotoEvidenceID` | text, nullable | File ID foto di Drive |
| `StatusAset` | enum | `AKTIF`, `DALAM_PENGHAPUSAN`, `DIHAPUS` |
| `PenghapusanID` | text, nullable | ID usulan penghapusan jika sedang diajukan |

---

## 5. `TX_BMN_Penghapusan` (Berkas Usulan Penghapusan Kemenkeu)
Kolom standar +
| Kolom | Tipe | Keterangan |
|---|---|---|
| `PenghapusanID` | text (PK) | Format `HPS-YYYY-XXXX` |
| `Tahap` | enum | `DRAFT_USULAN`, `SURAT_USULAN`, `PERSETUJUAN_KEMENKEU`, `SK_PENGHAPUSAN`, `BAST_SELESAI`, `DITOLAK` |
| `AlasanPenghapusan` | enum | `RUSAK_BERAT`, `KADALUWARSA`, `HILANG`, `HIBAH`, `PENJUALAN_LELANG` |
| `KeteranganAlasan` | text | Catatan pertimbangan teknis penghapusan |
| `NomorSuratUsulan` | text, nullable | Nomor surat Satker ke Kemenkeu |
| `TanggalSuratUsulan`| date, nullable | Tanggal surat usulan |
| `EvidenceSuratUsulan`| text, nullable | File ID scan surat usulan PDF |
| `NomorSuratPersetujuan`| text, nullable| Nomor persetujuan izin DJKN/KPKNL |
| `EvidenceSuratPersetujuan`| text, nullable| File ID izin persetujuan Kemenkeu PDF |
| `NomorSK` | text, nullable | Nomor SK Penghapusan KKP |
| `EvidenceSK` | text, nullable | File ID SK Penghapusan PDF |
| `EvidenceBAST` | text, nullable | File ID BAST Pemusnahan / Risalah Lelang PDF |
| `TotalUnit` | number | Jumlah unit aset dalam usulan |
| `TotalNilaiPerolehan`| number | Total nilai perolehan (Rp) |
| `TotalNilaiBuku` | number | Total nilai buku terkini (Rp) |

---

## 6. `TX_BMN_Penghapusan_Detail` (Rincian Item dalam Berkas)
Kolom standar +
| Kolom | Tipe | Keterangan |
|---|---|---|
| `PenghapusanID` | ref(TX_BMN_Penghapusan)| Nomor berkas usulan |
| `AsetID` | ref(TX_BMN_Aset) | Aset fisik yang diusulkan |
| `KondisiSaatUsul` | enum | `RUSAK_BERAT`, `RUSAK_RINGAN`, `BAIK` |
| `NilaiBukuSaatUsul`| number | Nilai buku pada saat usulan dibuat |
