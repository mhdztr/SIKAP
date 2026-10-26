# ARCHITECTURE.md — Arsitektur Teknis

## Struktur Folder GAS
Mengikuti pola Nautika:
- `utils/` (Constants, DateUtil, Lock, helpers)
- `services/` (business logic per modul)
- `data/` (SheetAccess, ValidationRules)
- `html/` (Index, Style, Script_*, views)

## Entry Point
`Code.js` (doGet / routing). Struktur mengikuti arsitektur proyek.

## Service Functions
Penamaan: `modul_aksi` (contoh: `tataUsaha_submitMingguan`). Semua fungsi publik yang dipanggil via `google.script.run` wajib diurutkan/terdefinisi dengan jelas.

## LockService
Semua endpoint tulis wajib menggunakan `LockService.getScriptLock()` dengan timeout yang wajar.

## Versioning & Anulir
Transaksi menggunakan pola `RowID`, `SupersedesRowID`, `Status` (`ACTIVE/SUPERSEDED/VOID`), `VoidReason`, `VoidedBy`, `VoidedAt`. Jangan UPDATE baris historis.

## RBAC
Ditegakkan di server (service layer). UI hanya penyajian.

## Federasi (Radar POA)
Radar POA menggunakan `SpreadsheetApp.openById()` untuk menarik data satelit, `CacheService` untuk caching, dan tombol `Sync Now` untuk cache-bust.
