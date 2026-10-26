# DESIGN.md — Desain UI/UX

## Prinsip
Mengikuti Apple Human Interface Guidelines dengan sentuhan data-first ala SiMata.

## Negative Prompt (Wajib Dicek)
Dilarang:
- Gauge speedometer
- Chart 3D murahan
- Efek bevel tebal 4px
- Gradien pelangi (rainbow palette)
- Tombol/kontrol dengan tinggi berbeda berdampingan tanpa container
- Inline style override untuk ukuran kontrol

## Tipografi
- Font: **Plus Jakarta Sans**
- Angka: `font-variant-numeric: tabular-nums`

## Skala Kontrol 3-Tier
- **LG: 40px** - primer, toolbar, submit utama
- **MD: 32px** - sekunder, modal baris tombol, filter
- **SM: 26px** - in-table action
Wajib dibungkus `.ctl-row`, `.ctl-lg`, `.ctl-sm`, `.ctl-stack`. Tanpa benturan tinggi sebaris.

## Kedalaman & Feedback
- `backdrop-filter: blur(20px)`, border tipis, bayangan lembut
- Tactile: `:active { transform: scale(0.97); }`
