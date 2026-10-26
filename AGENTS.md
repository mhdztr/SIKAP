# AGENTS.md — Panduan Agent untuk Proyek Nautika

Dokumen ini adalah instruksi kerja untuk agent (Antigravity, Claude Code, atau agent lain) yang mengerjakan proyek ini. Baca dokumen ini **sebelum** menulis kode apa pun.

## 1. Urutan Baca Wajib
Sebelum mengerjakan task apa pun, agent harus sudah membaca urutan berikut:
1. `PRD.md` — apa yang dibangun dan kenapa. **Sumber kebenaran tertinggi.**
2. `ARCHITECTURE.md` — bagaimana strukturnya secara teknis.
3. `DATA_SCHEMA.md` — skema kolom persis, jangan mengarang nama kolom sendiri.
4. `DESIGN.md` — aturan visual, termasuk daftar larangan eksplisit (negative prompt).
5. `CHANGELOG.md` — riwayat apa yang sudah dikerjakan, supaya tidak mengulang atau menimpa pekerjaan fase sebelumnya secara tidak sengaja.

## 2. Prinsip Kerja
- **Jangan menyimpang dari scope PRD tanpa konfirmasi eksplisit.**
- **Modular per PRD/ARCHITECTURE, bukan modular versi sendiri.** Jika ada perubahan skema, wajib dicatat di `CHANGELOG.md` beserta alasannya dan dikonfirmasi ke user.
- **RBAC ditegakkan di server, bukan hanya UI.** Setiap service function wajib assert scope sebelum baca/tulis data.
- **Semua kalkulasi (persentase, sisa, akumulasi, stok akhir) dihitung server-side.**
- **Versioning, bukan overwrite.** Setiap edit data transaksi mengikuti mekanisme `RowID`, `SupersedesRowID`, `Status`, `VoidReason` — insert baris baru + tandai lama `SUPERSEDED`, jangan `UPDATE` langsung menimpa baris lama untuk data historis.
- **Desain: cek negative prompt di `DESIGN.md` §1 setiap kali membuat komponen baru.**
- **Kohesi Total Kontrol UI (Single Geometry Scale & Container-Driven):** Tombol/kontrol terikat 3 tier (`LG: 40px`, `MD: 32px`, `SM: 26px`), dibungkus `.ctl-row`, `.ctl-lg`, `.ctl-sm`, `.ctl-stack`. Dilarang inline style override ukuran kontrol.

## 3. Konvensi Kode
- Penamaan service function: `modul_aksi`
- Struktur folder GAS mengikuti `ARCHITECTURE.md` §7 persis
- Setiap sheet transaksi baru wajib punya kolom standar (`RowID`, `DivisiID`, `Periode`, `SubmittedBy`, `Timestamp`, `Status`, `SupersedesRowID`, `VoidReason`, `VoidedBy`, `VoidedAt`)
- Semua endpoint tulis wajib pakai `LockService`

## 4. Kapan Harus Bertanya, Bukan Berasumsi
Berhenti dan tanyakan ke user jika:
- Ada field ambigu/tidak lengkap
- Ada kebutuhan ubah struktur `DATA_SCHEMA.md` (tambah/hapus/ubah tipe kolom)
- Ada permintaan fitur diluar scope `PRD.md`
- Ragu melanggar `DESIGN.md` §1 (negative prompt)

## 5. Disiplin Update Dokumentasi
- **Setiap unit kerja berarti** wajib menambah entri baru di `CHANGELOG.md` mengikuti format yang ada. Jangan tumpuk jadi satu entri besar.
- Keputusan teknis di luar `ARCHITECTURE.md`/`DATA_SCHEMA.md` wajib dicatat di `CHANGELOG.md`, dan jika penting update dokumen terkait.
- Jangan biarkan dokumen tidak sinkron dengan kode.

## 5b. Git/GitHub
- **Agent BOLEH melakukan `git add` dan `git commit`.**
- **Agent DILARANG keras melakukan `git push`.** Hanya user yang melakukan push.
- **Commit message wajib mengikuti format:** `feat:`, `chore:`, `fix:`, `docs:` 
- Jangan auto-push. Setelah commit, ingatkan user untuk melakukan push sendiri.
- Pastikan tidak ada rahasia hardcoded.
- `.gitignore` disamakan dengan `.claspignore`.

## 6. Definition of Done (per modul divisi)
Audit DoD dipindahkan ke tahap akhir proyek (di luar penomoran fase). Agent tidak menjalankan/memaksakan audit di tengah fase.
