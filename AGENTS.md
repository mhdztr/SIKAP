# AGENTS.md — Panduan Kerja Agent: SIKAP

## 1. Urutan Baca Wajib
1. `PRD.md` — Sumber kebenaran tertinggi mengenai kebutuhan dan aturan bisnis.
2. `ARCHITECTURE.md` — Arsitektur teknis, LockService, state machine BMN, dan geotagging.
3. `DATA_SCHEMA.md` — Skema persis seluruh tabel, jangan mengarang nama kolom.
4. `DESIGN.md` — Aturan visual, skala 3-tier kontrol, dan negative prompt.
5. `PHASES.md` — Roadmap dan rencana tahapan kerja aktif.

## 2. Aturan Keras & Non-Negotiable
- **Git & GitHub Hanya Milik User:** Agent dilarang menjalankan perintah `git add`, `git commit`, `git push`, dsb. Agent hanya bertugas menyiapkan kode dan mengingatkan user.
- **Prinsip Anti-Gabruk:** 5 sub-modul input (Anggaran, Paket, Kepegawaian, BMN, Penghapusan) wajib memiliki form, validasi, dan alur terpisah.
- **BMN Anti-Jebret:** Pendaftaran aset BMN wajib per-item fisik (1 unit = 1 baris). Dilarang membuat form input curah/agregat.
- **Kalkulasi Selalu Server-Side:** Seluruh hitungan persentase serapan, sisa pagu, jarak Haversine, dan status umur aset dihitung di backend GAS.
- **Kohesi Kontrol UI 3-Tier:** Semua tombol dan input terikat pada tier `LG: 40px`, `MD: 32px`, `SM: 26px`. Wajib lolos linter UI tanpa pelanggaran.
