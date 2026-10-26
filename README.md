# SIKAP - Portal Timja Logistik

Aplikasi satelit Timja Logistik (Amunisi, BBM, Logistik Personil)

## Arsitektur
Bagian dari ekosistem terdistribusi **Radar POA** (desentralisasi input, agregasi terpusat). Setiap aplikasi satelit memiliki Google Apps Script terpisah, Google Sheet terisolasi, dan Google Drive folder terpisah.

## Dokumen Wajib
- [PRD.md](PRD.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DATA_SCHEMA.md](DATA_SCHEMA.md)
- [DESIGN.md](DESIGN.md)
- [AGENTS.md](AGENTS.md)
- [CHANGELOG.md](CHANGELOG.md)
- [PHASES.md](PHASES.md)

## Deployment
Menggunakan [clasp](https://github.com/google/clasp). Push dilakukan oleh user sesuai aturan AGENTS.md §5b.


