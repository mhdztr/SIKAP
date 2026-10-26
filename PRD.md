# PRD.md — Product Requirements Document

## Nama Proyek
**SIKAP** — Portal Timja Logistik (Nautika Logistik / Radar POA Logistik)

## Tujuan
Pengendalian operasional logistik persenjataan, BBM, dan hak logistik personil secara terpisah per konteks.

## Ruang Lingkup (3 Sub-Modul)
1. **[LOG-A] Amunisi & Senjata Api** — Baseline stok awal tahunan, penggunaan amunisi mingguan per jenis, stok akhir terhitung server-side, peringatan non-blocking jika melebihi stok
2. **[LOG-B] Bahan Bakar Minyak (BBM)** — Baseline pagu BBM Reguler/ABT, realisasi mingguan, harga acuan, sisa kuota & % realisasi
3. **[LOG-C] Logistik & Hak Operasional Personil** — Realisasi komponen (NATURA, BPDT, AIR_BERSIH, DELEGASI, JAGA_SANDAR)

## Prinsip
Anti-gabruk, kalkulasi server-side, warning non-blocking (bukan hard block), versioning/anulir

## RBAC
Kadiv Logistik, Staf Logistik. Penegakan server-side.
