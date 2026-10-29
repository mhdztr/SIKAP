# AGENTS.md — Panduan Kerja Agent: SIKAP
**Sistem Informasi Keuangan, Anggaran, dan Kepegawaian (Subbag Tata Usaha - Dit. POA)**

---

## 1. Urutan Baca Wajib
Setiap agen yang memulai atau melanjutkan pekerjaan pada repositori ini wajib membaca dokumen sesuai urutan berikut:
1. `PRD.md` — Sumber kebenaran tertinggi mengenai kebutuhan, proses bisnis, dan aturan fungsional.
2. `ARCHITECTURE.md` — Arsitektur teknis, LockService, state machine BMN, dan geotagging Haversine.
3. `DATA_SCHEMA.md` — Skema persis seluruh tabel; dilarang mengarang nama kolom atau tipe data.
4. `DESIGN.md` — Aturan visual Apple HIG, skala geometri kontrol 3-tier, dan negative prompts.
5. `PHASES.md` — Roadmap dan rencana tahapan kerja aktif.
6. `README.md` — Panduan instalasi, deployment clasp, dan struktur repositori.

---

## 2. Aturan Keras & Non-Negotiable
- **Git & GitHub Hanya Milik User:** Agent dilarang keras menjalankan perintah `git add`, `git commit`, `git push`, dsb. Agent hanya bertugas menyiapkan kode, memverifikasi integritas, dan mengingatkan user.
- **Prinsip Anti-Gabruk:** 5 sub-modul input (Anggaran, Paket, Kepegawaian, BMN, Penghapusan) wajib memiliki form, validasi, tabel riwayat, dan payload terpisah. Dilarang menggabungkan alur form antar sub-modul.
- **BMN Anti-Jebret:** Pendaftaran aset BMN wajib per-item fisik (1 unit nyata = 1 baris transaksi). Dilarang membuat form input curah/agregat (mis. "20 unit Laptop Rp 200 jt").
- **Kalkulasi Selalu Server-Side:** Seluruh hitungan persentase serapan, sisa pagu kas, akumulasi akrual fisik, jarak Haversine ke UPT terdekat, dan perhitungan umur aset dihitung di backend Google Apps Script. Frontend tidak dipercaya untuk kalkulasi bisnis inti.
- **Kohesi Kontrol UI 3-Tier:** Semua tombol dan input terikat ketat pada 3 tier standar (`LG: 40px`, `MD: 32px`, `SM: 26px`). Dilarang keras menggunakan inline style `style="height: ..."` pada tag `button`, `input`, dan `select`.
- **Zero-Emoji Policy:** Dilarang menggunakan karakter unicode emoji di teks label, tombol, tabel, dan header antarmuka. Seluruh ikon wajib menggunakan inline SVG presisi (stroke-width 2px).
- **Akses Basis Data Dedicated:** Seluruh sheet transaksi satelit Subbag Tata Usaha wajib diakses melalui fungsi `openTuSheet(SHEET_TU.*)` yang memiliki mekanisme *self-healing*.

---

## 3. Protokol Verifikasi Kualitas (QA Protocol)
Sebelum melaporkan penyelesaian tugas kepada user, agent wajib:
1. Menjalankan audit linter UI mandiri:
   ```bash
   node lint_ui.js
   ```
   Seluruh 10 pemeriksaan wajib lolos 100% tanpa error (`0 error(s)`).
2. Memverifikasi sintaksis JavaScript seluruh file proyek:
   ```bash
   node -c Code.js services/*.js utils/*.js data/*.js lint_ui.js
   ```
3. Memastikan tidak ada sisa artefak/log debug sementara di lingkungan produksi.
