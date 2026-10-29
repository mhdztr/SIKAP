# DESIGN.md — Panduan Desain & Antarmuka: SIKAP
**Sistem Informasi Keuangan, Anggaran, dan Kepegawaian**  
*Subbag Tata Usaha — Direktorat Pemantauan dan Operasi Armada (Dit. POA)*  
*Direktorat Jenderal Pengawasan Sumber Daya Kelautan dan Perikanan (Ditjen PSDKP)*  
*Kementerian Kelautan dan Perikanan Republik Indonesia (KKP RI)*

---

## 1. Filosofi Inti: Apple HIG & Data-First Government System

Antarmuka SIKAP dirancang di atas perpaduan standar ketat **Apple Human Interface Guidelines (WWDC)** dan kebutuhan operasional tata kelola pemerintahan yang mengutamakan kecepatan baca data numerik (*scannability*):

1. **Directness & Tactile Response:**  
   Setiap elemen kontrol interaktif memberikan respons seketika saat menerima interaksi sentuh/tekan (`pointer-down`), bukan menunggu `click`/lepas. Menggunakan kompresi elastis halus:
   ```css
   button:active, .btn-primary:active, .tu-subnav-btn:active {
     transform: scale(0.975);
     transition: transform var(--dur-press) ease-out !important;
   }
   ```
2. **Kedalaman Optik & Vibrancy Material:**  
   Permukaan kartu menggunakan kaca translusen (*frosted glass*) dengan `backdrop-filter: blur(24px) saturate(190%)`, border netral ber-hairline ganda (`rgba(15, 23, 42, 0.08)` dipadu inner light bevel `rgba(255, 255, 255, 0.85)`), dan bayangan ambient bertingkat (*layered ambient shadows*).
3. **Tipografi Optik Terpadu:**  
   Menggunakan jenis huruf **Plus Jakarta Sans** dengan *optical tracking* berjenjang (heading besar `-0.025em`, sub-label `-0.005em`, uppercase micro-badge `+0.05em`). Wajib menerapkan `font-variant-numeric: tabular-nums` dan `font-feature-settings: "tnum" 1` pada seluruh angka finansial (Rp), persentase, kode NUP, dan tanggal.
4. **Fluid Spring Physics (Pegas Alami):**  
   Seluruh transisi dialog modal, pergantian tab, dan dropdown menggunakan kurva pegas *critically damped* (`cubic-bezier(0.16, 1, 0.3, 1)` respon 0.35s) tanpa osilasi berlebih, menghasilkan rasa responsif, cepat, dan berbobot fisik nyata.

---

## 2. Skala Geometri Kontrol Tunggal (3-Tier Single Geometry Scale)

Untuk menjaga keselarasan proporsi visual antarmuka dan menghilangkan ketidakteraturan ukuran elemen, seluruh komponen interaktif (tombol, input text, select dropdown, segmented switch, dan badge) terikat secara ketat pada **3 Tier Standar Geometri**:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ TIER LG (40px) : Toolbar Filter Utama · Form Inputs · Tombol Dialog Primer     │
├────────────────────────────────────────────────────────────────────────────────┤
│ TIER MD (32px) : Kontrol Sekunder · Filter Grid · Segmented Sub-Nav Switches   │
├────────────────────────────────────────────────────────────────────────────────┤
│ TIER SM (26px) : Khusus Aksi Baris Tabel (In-Table Action: Detail, Revisi, Void)│
└────────────────────────────────────────────────────────────────────────────────┘
```

### Tabel Spesifikasi Parameter Tier:

| Tier | Tinggi Kontainer (`height`) | Padding Horizontal | Radius Sudut (`border-radius`) | Ukuran Font | Peruntukan Khusus |
|---|:---:|:---:|:---:|:---:|---|
| **LG** | `40px` | `16px` | `10px` | `14px` (0.875rem) | Toolbar filter utama, input form modal, tombol submit primer dialog, datepicker utama |
| **MD** | `32px` | `12px` | `8px` | `13px` (0.8125rem) | Kontrol sekunder, baris tombol modal dialog, filter grid tabel, segmented sub-nav |
| **SM** | `26px` | `10px` | `6px` | `12px` (0.75rem) | Khusus aksi baris tabel (*in-table actions*: tombol Detail, Revisi mini, Anulir mini) |

### Variabel Token CSS Standar:
```css
/* Tier LG */
--ctl-h-lg:   40px;
--ctl-px-lg:  16px;
--ctl-r-lg:   10px;
--ctl-fs-lg:  14px;

/* Tier MD */
--ctl-h-md:   32px;
--ctl-px-md:  12px;
--ctl-r-md:   8px;
--ctl-fs-md:  13px;

/* Tier SM */
--ctl-h-sm:   26px;
--ctl-px-sm:  10px;
--ctl-r-sm:   6px;
--ctl-fs-sm:  12px;
```

> [!IMPORTANT]
> **Larangan Mutlak Skala:**
> 1. Dilarang keras menempatkan kontrol berbeda tinggi berdampingan dalam satu baris tanpa container kohesif.
> 2. Setiap baris kontrol wajib dibungkus dalam kontainer `.ctl-row`, `.ctl-lg`, `.ctl-md`, `.ctl-sm`, `.ctl-stack`, atau `.ctl-fill`.
> 3. **Dilarang keras menggunakan inline style `style="height: ..."` pada tag button, input, dan select!** Pelanggaran akan langsung digagalkan oleh script `node lint_ui.js`.

---

## 3. Prinsip Modular Anti-Gabruk (5 Sub-Modul Mandiri)

Sesuai PRD §2, antarmuka Subbag Tata Usaha dibagi ke dalam 5 sub-modul independen melalui *Apple-grade Segmented Pill Navigation* yang berada di puncak modul:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [ Realisasi Anggaran ]  [ Paket Pengadaan ]  [ Kepegawaian ]  [ Inventaris BMN ]  [ Usulan Hapus ]│
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **[TU-A] Realisasi Anggaran (SP2D & Akrual):**
   - Matriks input 2x2 APBN (Pagu Reguler vs ABT, Realisasi SP2D vs Akrual).
   - KPI strip serapan nasional linear progress bar, sisa pagu kas, akumulasi fisik akrual.
   - Tabel riwayat transaksi dengan in-table action tier SM (Revisi dan Anulir).
2. **[TU-B] Monitoring Paket Pengadaan:**
   - Visualisasi siklus 6 tahap pekerjaan (`PERSIAPAN` → `PEMILIHAN` → `KONTRAK` → `PELAKSANAAN` → `BAST` → `SELESAI`).
   - Pemantauan realisasi fisik vs keuangan terhadap nilai kontrak rekanan.
   - Akses bukti fisik dan dokumen kontrak PDF.
3. **[TU-C] Manajemen Kepegawaian & Headcount:**
   - Snapshot komposisi 5 kategori aparatur (`PNS`, `P3K`, `P3K_PARUH_WAKTU`, `PJLP`, `MAGANG`).
   - Kartu ringkasan distribusi SDM aparatur TU.
   - Form pembaruan snapshot mingguan berbasis carry-forward.
4. **[TU-D] Inventaris Aset Fisik BMN Granular (Anti-Jebret):**
   - Registrasi aset individual per-unit fisik (1 baris = 1 fisik unit riil).
   - Komponen ekstraksi geotagging EXIF foto mentah dan tombol fallback GPS browser.
   - Modal Smart Bulk Import SAKTI Excel (.xlsx) dengan 4 kartu ringkasan dry-run dan pratinjau tabel validasi.
   - Peta spasial sebaran aset pangkalan UPT berbasis Leaflet.
5. **[TU-E] Siklus Usulan Penghapusan Legal BMN Kemenkeu:**
   - 5-Stage Visual Stepper pelacakan surat usulan resmi Kemenkeu (DJKN/KPKNL).
   - Form usulan dengan multi-seleksi aset kondisi Rusak Berat yang berstatus `AKTIF`.
   - Banner status karantina aset (`DALAM_PENGHAPUSAN`) dan bukti BAST akhir (`DIHAPUS`).

---

## 4. Palet Warna Harmonis & Semantik Status

Seluruh palet warna mematuhi standar kontras tinggi WCAG AAA untuk keterbacaan data instansi pemerintah:

| Token Semantik | Kode Warna (Hex) | Background Tint (RGBA) | Border Aksesibilitas | Makna Operasional |
|---|:---:|---|---|---|
| **Kanvas Dasar** | `#F8FAFC` | — | `rgba(15, 23, 42, 0.08)` | Latar belakang ultra-light slate. |
| **Kartu Translusen**| `#FFFFFF` | `rgba(255, 255, 255, 0.85)`| `rgba(15, 23, 42, 0.10)` | Permukaan kartu kaca translusen. |
| **Aksen Primer** | `#1E3A8A` | `rgba(30, 58, 138, 0.08)` | `rgba(30, 58, 138, 0.25)` | Deep Maritime Navy (Warna resmi PSDKP). |
| **Sorotan Elektrik**| `#2563EB` | `rgba(37, 99, 235, 0.10)` | `rgba(37, 99, 235, 0.30)` | Electric Blue (Fokus input & tombol aktif). |
| **Teks Primer** | `#0F172A` | — | — | Slate Dark (Kontras tertinggi untuk angka). |
| **Teks Sekunder** | `#475569` | — | — | Slate Neutral (Label informatif). |
| **Teks Muted** | `#94A3B8` | — | — | Slate 400 (Placeholder & petunjuk halus). |
| **Status Sukses** | `#059669` | `rgba(16, 185, 129, 0.10)`| `rgba(16, 185, 129, 0.22)` | Kondisi Baik, Selesai, BAST Sah. |
| **Status Peringatan**| `#D97706` | `rgba(245, 158, 11, 0.10)`| `rgba(245, 158, 11, 0.22)` | Rusak Ringan, Proses Berjalan, Menunggu Izin. |
| **Status Kritis** | `#E11D48` | `rgba(225, 29, 72, 0.10)` | `rgba(225, 29, 72, 0.22)` | Rusak Berat, Ditolak, Dibatalkan/VOID. |
| **Status Karantina**| `#7C3AED` | `rgba(124, 58, 237, 0.10)`| `rgba(124, 58, 237, 0.22)` | Dalam Proses Usulan Penghapusan Legal. |

---

## 5. Negative Prompt (Daftar Larangan UI Mutlak)

Sesuai aturan ketat proyek, sistem memiliki 5 batasan negatif yang diaudit secara otomatis:

1. **Zero-Emoji Policy (Larangan Unicode Emoji):**  
   Dilarang keras menggunakan karakter emoji grafis/unicode pada teks label, tombol, tabel, dan header dialog. Seluruh kebutuhan visual wajib menggunakan inline SVG presisi (Feather / Lucide icons dengan `stroke-width="2"`).
2. **Dilarang Menggunakan Gauge Melingkar / Speedometer:**  
   Metrik serapan anggaran, kelaikan BMN, dan progres paket wajib menggunakan **Linear Progress Bar** horizontal dengan persentase numerik tabular (`.tnum`).
3. **Dilarang Menggunakan 3D Chart, Bevel Retro Tebal, dan Drop Shadow Pekat:**  
   Grafik konteks bulanan disajikan dalam bentuk 2D area / bar chart bersih tanpa efek miring/3D. Bayangan kartu menggunakan ambient multi-layer halus.
4. **Dilarang Menggunakan Palet Warna Pelangi Acak:**  
   Seluruh antarmuka hanya menggunakan turunan Maritime Navy, Slate, dan warna semantik status resmi di atas.
5. **Dilarang Animasi Melayang Tak Berujung (Infinite Wobble/Shake):**  
   Seluruh animasi transisi wajib bertujuan fungsional (*purpose-driven motion*), seperti pembukaan modal pegas atau pemudaran baris tabel saat revisi.

---

## 6. Standar Komponen Antarmuka Khusus

### 6.1 Stepper 5-Tahap Usulan Penghapusan (`.n-stepper`)
Komponen visual pelacak tahapan surat Kemenkeu:
- Lingkaran nomor tahapan (`.n-step-circle` diameter 32px) dengan transisi pegas.
- Tahap yang sudah selesai diberi warna hijau (`.is-done` dengan ikon centang SVG).
- Tahap yang sedang aktif diberi aksen Maritime Navy (`.is-active`).
- Tahap yang belum dilewati bernuansa netral translusen (`.is-pending`).

### 6.2 Sistem Notifikasi Toast (Sonner-Grade)
Menggunakan container toast terpusat di kanan bawah `#n-toaster`:
- Pesan sukses, peringatan, dan error muncul dengan animasi slide-in pegas dari bawah.
- Auto-dismiss dalam waktu 4.0 detik dengan progress bar durasi.
- Tidak menghalangi interaksi pengguna pada konten di baliknya (*non-blocking overlay*).

### 6.3 Peta Interaktif Spasial UPT (Leaflet 1.9.4)
- Container `#bmn-upt-map` berbingkai sudut konsentris `var(--n-radius-md)`.
- Menggunakan layer basemap Positron/Carto Voyager yang bersih dan minimalis.
- Marker koordinat aset dan stasiun UPT menampilkan popup informatif berisi nama barang, kode NUP, nilai buku, dan jarak Haversine presisi.

---

## 7. Engine Audit Mutu Desain (`node lint_ui.js`)

Untuk memastikan kepatuhan mutlak terhadap aturan [AGENTS.md](file:///home/pinefeast/Projects/SIKAP/AGENTS.md) dan [DESIGN.md](file:///home/pinefeast/Projects/SIKAP/DESIGN.md), setiap perubahan kode antarmuka wajib lolos pengujian engine linter mandiri:
```bash
node lint_ui.js
```
Linter memvalidasi 7 domain penjaminan mutu:
1. Pemindaian regex unicode emoji pada seluruh file kode.
2. Pemeriksaan larangan inline style height override.
3. Kepatuhan token CSS 3-tier geometry (`40px`, `32px`, `26px`).
4. Ketiadaan circular gauge/speedometer dan animasi terlarang.
5. Kelengkapan 5 sub-navigasi dan pane modul *Anti-Gabruk*.
6. Validasi form pendaftaran single-item BMN *Anti-Jebret*.
7. Keberadaan fungsi kalkulasi finansial dan Haversine di sisi server.
