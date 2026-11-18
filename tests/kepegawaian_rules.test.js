const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeNamaPersonel, applyFormalSheetFormatting } = require('../data/SheetAccess.js');
const { resolvePeriodeWindow } = require('../utils/DateUtil.js');
const {
  validatePegawaiMasterPayload,
  _inferStatusPenempatanSikap,
  _resolveKategoriRumpunSikap,
  _normalizeStandarGroupSikap
} = require('../services/TataUsahaService.js');

global.sanitizeNamaPersonel = sanitizeNamaPersonel;

function createMockSheet(name, headers, dataRows) {
  const rows = [headers.slice()].concat((dataRows || []).map((r) => r.slice()));
  const calls = {
    headerBg: null,
    headerFontColor: null,
    frozenRows: null,
    rowHeights: {},
    colWidths: {},
    zebraBgs: null,
    numberFormats: {}
  };

  function makeRange(row, col, numRows, numCols) {
    return {
      getValues() {
        const out = [];
        for (let r = row - 1; r < row - 1 + numRows; r++) {
          const src = rows[r] || [];
          const line = [];
          for (let c = col - 1; c < col - 1 + numCols; c++) {
            line.push(src[c] !== undefined ? src[c] : '');
          }
          out.push(line);
        }
        return out;
      },
      setBackground(c) { if (row === 1) calls.headerBg = c; },
      setBackgrounds(grid) { calls.zebraBgs = grid; },
      setFontColor(c) { if (row === 1) calls.headerFontColor = c; },
      setFontFamily() {},
      setFontSize() {},
      setFontWeight() {},
      setVerticalAlignment() {},
      setHorizontalAlignment() {},
      setWrap() {},
      setBorder() {},
      setNumberFormat(fmt) {
        for (let c = col; c < col + numCols; c++) {
          calls.numberFormats[headers[c - 1]] = fmt;
        }
      }
    };
  }

  return {
    rows,
    calls,
    getName: () => name,
    getLastColumn: () => headers.length,
    getLastRow: () => rows.length,
    getRange: makeRange,
    setFrozenRows(n) { calls.frozenRows = n; },
    setRowHeight(r, h) { calls.rowHeights[r] = h; },
    setRowHeights(r, count, h) { calls.rowHeights[`${r}..${r + count - 1}`] = h; },
    setColumnWidth(c, w) { calls.colWidths[headers[c - 1]] = w; }
  };
}

test('SIKAP Nama — sanitizeNamaPersonel huruf besar A-Z tanpa gelar, tanda petik, tanda baca, & angka', () => {
  assert.equal(sanitizeNamaPersonel("Ma'ruf, S.Pi."), 'MARUF');
  assert.equal(sanitizeNamaPersonel("Capt. H. Dedi Kurniawan, M.Mar"), 'DEDI KURNIAWAN');
  assert.equal(sanitizeNamaPersonel("Siti-Rahmawati 2026, A.Md"), 'SITI RAHMAWATI');
  assert.equal(sanitizeNamaPersonel("Abdul Mu`In"), 'ABDUL MUIN');
});

test('SIKAP Validasi — NIP wajib 18 digit bagi PNS/P3K/P3K_PARUH_WAKTU dan dikosongkan bagi PJLP/MAGANG', () => {
  assert.throws(() => validatePegawaiMasterPayload({
    nama: 'BUDI SANTOSO',
    unitKerja: 'Dit. POA',
    statusKepegawaian: 'PNS',
    nip: '1234',
    kelompokJabatan: 'Arsiparis'
  }), /18 digit/);

  assert.throws(() => validatePegawaiMasterPayload({
    nama: 'SLAMET RIYADI',
    unitKerja: 'Dit. POA',
    statusKepegawaian: 'P3K',
    nip: '',
    kelompokJabatan: 'Pranata Komputer'
  }), /18 digit/);

  assert.throws(() => validatePegawaiMasterPayload({
    nama: 'SITI RAHMAWATI',
    unitKerja: 'Pangkalan PSDKP Jakarta',
    statusKepegawaian: 'P3K_PARUH_WAKTU',
    nip: '987654321',
    kelompokJabatan: 'Juru Mudi'
  }), /18 digit/);

  const validPns = validatePegawaiMasterPayload({
    nama: "Dr. Andi Wijaya, S.St.Pi",
    unitKerja: 'Dit. POA',
    statusKepegawaian: 'PNS',
    nip: '198501012010011001',
    kelompokJabatan: 'Pengawas Perikanan'
  });
  assert.equal(validPns.nama, 'ANDI WIJAYA');
  assert.equal(validPns.nip, '198501012010011001');
  assert.equal(validPns.statusPenempatan, 'PUSAT_POA');

  // PJLP tanpa NIP dan tanpa NIK maupun SK (opsional) tetap valid
  const pjlpAwak = validatePegawaiMasterPayload({
    nama: "Ma'ruf, S.Pi.",
    unitKerja: 'Pangkalan PSDKP Batam',
    statusKepegawaian: 'PJLP',
    nip: '19999',
    lingkupData: 'AWAK_KAPAL_ARMADA',
    kelompokJabatan: 'Juru Masak',
    ukuranBaju: 'l',
    ukuranSepatu: '42'
  });
  assert.equal(pjlpAwak.nama, 'MARUF');
  assert.equal(pjlpAwak.nip, '');
  assert.equal(pjlpAwak.nomorIdentitas, '');
  assert.equal(pjlpAwak.rumpun, 'PENUNJANG');
  assert.equal(pjlpAwak.statusPenempatan, 'DIPERBANTUKAN_UPT');
  assert.equal(pjlpAwak.ukuranBaju, 'L');
});

test('SIKAP Rumpun & Standar — Awak Kapal PJLP (Juru Masak / Oiler) & Date Order', () => {
  assert.equal(_resolveKategoriRumpunSikap('PJLP', 'Juru Minyak (Oiler)', 'AWAK_KAPAL_ARMADA', ''), 'AWAK_MESIN');
  assert.equal(_resolveKategoriRumpunSikap('PJLP', 'Kelasi', 'AWAK_KAPAL_ARMADA', ''), 'AWAK_DEK');
  assert.equal(_normalizeStandarGroupSikap('Juru Minyak (Oiler)'), 'Juru Minyak');
  assert.equal(_normalizeStandarGroupSikap('Juru Masak (Koki)'), 'Juru Masak');
  assert.equal(_normalizeStandarGroupSikap('Nakhoda'), 'Nahkoda');
  assert.equal(_inferStatusPenempatanSikap('AKP Pusat Diperbantukan di KP. Hiu 01 — Pangkalan Jakarta', ''), 'DIPERBANTUKAN_UPT');

  assert.throws(() => validatePegawaiMasterPayload({
    nama: 'AGUS SETIAWAN',
    unitKerja: 'Dit. POA',
    statusKepegawaian: 'PJLP',
    tanggalMulai: '2026-06-10',
    tanggalSelesai: '2026-06-01'
  }), /tidak boleh lebih awal/);
});

test('SIKAP DateUtil — resolvePeriodeWindow TW1-TW4, SEM1-SEM2, dan CUSTOM', () => {
  assert.equal(resolvePeriodeWindow({ periodeMode: 'TW1', tahun: 2026 }).endDateStr, '2026-03-31');
  assert.equal(resolvePeriodeWindow({ periodeMode: 'TW3', tahun: 2026 }).startDateStr, '2026-07-01');
  assert.equal(resolvePeriodeWindow({ periodeMode: 'SEM2', tahun: 2026 }).endDateStr, '2026-12-31');
  const custom = resolvePeriodeWindow({ periodeMode: 'CUSTOM', startDate: '2026-03-01', endDate: '2026-08-31' });
  assert.equal(custom.startDateStr, '2026-03-01');
  assert.equal(custom.endDateStr, '2026-08-31');
});

test('SIKAP SheetFormatter — applyFormalSheetFormatting Master_Pegawai_POA header #0F172A, @ NIP/NIK/Sepatu, & ISO Date', () => {
  const headers = ['PegawaiID', 'NIP', 'Nama', 'NomorIdentitas', 'TanggalMulai', 'TanggalSelesai', 'UkuranSepatu', 'StatusKelengkapanTU'];
  const mockSheet = createMockSheet('Master_Pegawai_POA', headers, [
    ['PEG-0001', '198501012010011001', 'BUDI SANTOSO', '3171010101850001', '2024-01-01', '', '42', 'DISPARITAS_NAKHODA'],
    ['PEG-0002', '', 'MARUF', '', '2025-05-01', '2026-12-31', '41', 'LENGKAP']
  ]);

  applyFormalSheetFormatting(mockSheet, 'Master_Pegawai_POA');
  assert.equal(mockSheet.calls.headerBg, '#0F172A');
  assert.equal(mockSheet.calls.headerFontColor, '#FFFFFF');
  assert.equal(mockSheet.calls.frozenRows, 1);
  assert.equal(mockSheet.calls.rowHeights[1], 34);
  assert.equal(mockSheet.calls.rowHeights['2..3'], 26);
  assert.equal(mockSheet.calls.zebraBgs[0][0], '#FFFFFF');
  assert.equal(mockSheet.calls.zebraBgs[1][0], '#F8FAFC');
  assert.equal(mockSheet.calls.numberFormats['NIP'], '@');
  assert.equal(mockSheet.calls.numberFormats['NomorIdentitas'], '@');
  assert.equal(mockSheet.calls.numberFormats['UkuranSepatu'], '@');
  assert.equal(mockSheet.calls.numberFormats['TanggalMulai'], 'yyyy-mm-dd');
  assert.equal(mockSheet.calls.numberFormats['TanggalSelesai'], 'yyyy-mm-dd');
});

