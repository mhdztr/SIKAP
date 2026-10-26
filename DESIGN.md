# DESIGN.md — Panduan Desain & Antarmuka: SIKAP
**Sistem Informasi Keuangan, Anggaran, dan Kepegawaian (Subbag Tata Usaha - Dit. POA)**

## 1. Filosofi Inti: Apple HIG & Data-First Government System
SIKAP dibangun di atas perpaduan standar ketat **Apple Human Interface Guidelines (WWDC)** dan kebutuhan tata kelola operasional pemerintah:
- **Directness & Tactile Response:** Setiap kontrol interaktif memberikan umpan balik langsung pada saat ditekan (`pointer-down`), bukan menunggu `click`/lepas. Menggunakan kompresi elastis `:active { transform: scale(0.975); }`.
- **Kedalaman Optik & Vibrancy:** Permukaan kartu translusen (`backdrop-filter: blur(24px) saturate(190%)`), border netral halus ber-hairline ganda (`rgba(15, 23, 42, 0.08)` dan inner bevel `rgba(255, 255, 255, 0.85)`), serta bayangan lembut bertingkat (*layered ambient shadows*).
- **Tipografi Terpadu:** Plus Jakarta Sans dengan *optical tracking* berjenjang (heading besar `-0.025em`, sub-label `-0.005em`, uppercase micro-badge `+0.05em`). Wajib menerapkan `font-variant-numeric: tabular-nums` dan `font-feature-settings: "tnum" 1` pada seluruh angka finansial (Rp), persentase, kode NUP, dan tanggal.
- **Fluid Spring Physics:** Gerakan transisi antarmuka menggunakan kurva pegas *critically damped* (`cubic-bezier(0.16, 1, 0.3, 1)` response 0.35s) tanpa osilasi berlebih, menghasilkan rasa responsif, cepat, dan berbobot fisik nyata.

---

## 2. Skala Geometri Kontrol Tunggal (3-Tier Single Geometry Scale)
Seluruh komponen interaktif (tombol, input text, select dropdown, segmented switch, dan badge) terikat secara ketat pada 3 tier standar kontainer:

| Tier | Tinggi Kontainer | Padding Horizontal | Border Radius | Ukuran Font | Peruntukan Khusus |
|---|---|---|---|---|---|
| **LG** | `40px` | `16px` | `10px` | `14px` (0.875rem) | Toolbar filter utama, input form standar, tombol submit primer dialog |
| **MD** | `32px` | `12px` | `8px` | `13px` (0.8125rem) | Kontrol sekunder, baris tombol modal dialog, filter grid, segmented sub-nav |
| **SM** | `26px` | `10px` | `6px` | `12px` (0.75rem) | Khusus aksi baris tabel (*in-table actions*: tombol Detail, Revisi, Anulir mini) |

> [!IMPORTANT]
> **Larangan Mutlak Skala:** Dilarang keras menempatkan kontrol berbeda tinggi berdampingan dalam satu baris. Setiap baris kontrol wajib dibungkus kontainer kohesif `.ctl-row`, `.ctl-lg`, atau `.ctl-sm`. Dilarang menggunakan inline style `style="height: ..."`!

---

## 3. Prinsip Modular Anti-Gabruk (5 Sub-Modul Mandiri)
Sesuai PRD §2, antarmuka Subbag Tata Usaha dibagi ke dalam 5 sub-modul independen melalui *Apple-grade Segmented Pill Navigation*:
1. **[TU-A] Realisasi Anggaran (SP2D & Akrual):** Matriks input 2x2, KPI strip serapan, sisa pagu, carry-forward, dan tabel riwayat transaksi.
2. **[TU-B] Monitoring Paket Pengadaan:** Stepper 6 tahap (`PERSIAPAN` → `PEMILIHAN` → `KONTRAK` → `PELAKSANAAN` → `BAST` → `SELESAI`), pemantauan rekanan, progres fisik/keuangan, dan evidence kontrak.
3. **[TU-C] Manajemen Kepegawaian & Headcount:** Snapshot 5 kategori aparatur (`PNS`, `PPPK`, `PPPK_PARUH_WAKTU`, `PJLP`, `MAGANG`), komposisi distribusi personil, dan mutasi.
4. **[TU-D] Inventaris Aset Fisik BMN (Anti-Jebret):** Registrasi single-item (1 baris = 1 unit fisik), ekstraksi geotagging EXIF foto, Haversine UPT distance matcher, Smart Bulk Import SAKTI Excel (.xlsx) dengan validasi dry-run, dan Leaflet map.
5. **[TU-E] Siklus Usulan Penghapusan Legal BMN Kemenkeu:** State machine stepper 5 tahap (`DRAFT_USULAN` → `SURAT_USULAN` → `PERSETUJUAN_KEMENKEU` → `SK_PENGHAPUSAN` → `BAST_SELESAI`), karantina aset `DALAM_PENGHAPUSAN`, dan upload dokumen legalitas DJKN/KPKNL.

---

## 4. Palet Warna Harmonis & Semantik Status
- **Kanvas Dasar:** `#F8FAFC` (Slate Ultra-Light)
- **Struktur Kartu:** `rgba(255, 255, 255, 0.85)` dengan `backdrop-filter: blur(24px)`
- **Aksen Primer:** `#1E3A8A` (Deep Maritime Navy) & `#2563EB` (Electric Blue Highlight)
- **Teks Primer:** `#0F172A` (Slate Dark)
- **Teks Sekunder:** `#475569` (Slate Neutral)
- **Teks Muted:** `#94A3B8` (Muted Hint & Placeholder)
- **Status Sukses / Selesai:** `#059669` (Emerald Tint: `rgba(16, 185, 129, 0.10)`)
- **Status Peringatan / Berjalan:** `#D97706` (Amber Tint: `rgba(245, 158, 11, 0.10)`)
- **Status Kritis / Rusak Berat / Batal:** `#E11D48` (Rose Tint: `rgba(244, 63, 94, 0.10)`)
- **Status Karantina / Penghapusan:** `#7C3AED` (Purple Tint: `rgba(124, 58, 237, 0.10)`)

---

## 5. Negative Prompt (Daftar Larangan UI Mutlak)
1. **Dilarang menggunakan karakter unicode emoji** di teks label, tombol, tabel, dan header (**Zero-Emoji Policy**). Gunakan inline SVG icons presisi (Lucide/Feather stroke-width 2px).
2. **Dilarang menggunakan gauge melingkar / speedometer.** Gunakan linear progress bar dengan persentase numerik tabular.
3. **Dilarang menggunakan 3D chart, bevel retro tebal, atau drop shadow pekat hitam kotor.**
4. **Dilarang menggunakan palet warna pelangi acak.** Gunakan hanya palet Navy, Slate, dan warna semantik status resmi di atas.
5. **Dilarang animasi melayang tak berujung (infinite wobble/shake).** Seluruh animasi transisi wajib bertujuan fungsional (*purpose-driven motion*).
