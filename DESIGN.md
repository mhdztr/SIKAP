# DESIGN.md — Panduan Desain & Antarmuka: SIKAP
**Sistem Informasi Keuangan, Anggaran, dan Kepegawaian**

## 1. Prinsip Utama: Data-First SiMata & Apple HIG
- **Scannability Tinggi:** Prioritaskan data numerik, status transaksi, dan tabel operasional. Hindari dekorasi visual berlebih (*clutter*).
- **Tipografi Terpadu:** Plus Jakarta Sans dengan `font-variant-numeric: tabular-nums` pada seluruh angka finansial dan statistik.
- **Kedalaman Optik:** Permukaan kartu translusen (`backdrop-filter: blur(20px)`), border netral halus `rgba(0,0,0,0.08)`, dan bayangan lembut `--n-shadow-card`.
- **Tactile Feedback:** Efek kompresi sentuh `:active { transform: scale(0.97); }` pada semua tombol dan kartu interaktif.

## 2. Skala Geometri Kontrol Tunggal (3-Tier Scale)
Semua tombol, input text, select dropdown, dan segmented switch wajib mengacu pada 3 tier standar kontainer:
- **LG (`40px`):** Toolbar filter utama, input form standar, dan tombol submit primer.
- **MD (`32px`):** Kontrol sekunder, baris tombol modal dialog, dan filter data grid.
- **SM (`26px`):** Khusus aksi baris tabel (*in-table action* seperti tombol aksi detail/revisi/anulir mini).

> **Larangan Mutlak:** Dilarang mencampur kontrol beda tinggi berdampingan. Wajib dibungkus dalam `.ctl-row`, `.ctl-lg`, atau `.ctl-sm`. Dilarang menggunakan inline style height override!

## 3. Negative Prompt (Daftar Larangan UI)
1. Dilarang menggunakan gauge melingkar / speedometer.
2. Dilarang menggunakan 3D chart, bevel 4px tebal, atau drop shadow pekat bergaya retro.
3. Dilarang menggunakan palet warna pelangi acak. Gunakan palet Navy, Slate, dan warna semantik status resmi.
4. Dilarang menggunakan karakter unicode emoji di teks label, tombol, dan header (Zero-Emoji Policy).
