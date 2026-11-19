/**
 * services/TataUsahaService.js
 * Modul Tata Usaha — anggaran SP2D dan Akrual.
 *
 * Fungsi publik (google.script.run):
 *   tataUsaha_getKPI(token, filter)
 *   tataUsaha_getHistory(token, filter)
 *   tataUsaha_submitMingguan(token, params)
 *   tataUsaha_revisi(token, params)
 *   tataUsaha_anulir(token, params)
 *
 * RBAC (sesuai PRD §7 + konfirmasi 15 Sep 2026):
 *   Baca    : semua APPROVED (SUPERADMIN/DIREKTUR cross-divisi; KADIV/STAF hanya DIV-TU)
 *   Submit  : SUPERADMIN + KADIV(DIV-TU) + STAF(DIV-TU)
 *   Revisi  : SUPERADMIN + KADIV(DIV-TU) + STAF(DIV-TU)
 *   Anulir  : SUPERADMIN + DIREKTUR + KADIV(DIV-TU)  [Staf tidak bisa anulir]
 *
 * Kalkulasi on-read (tidak disimpan ke sheet, sesuai DATA_SCHEMA.md):
 *   PaguTotal, RealisasiAkumulatif SP2D & Akrual, Sisa SP2D & Akrual, %SP2D, %Akrual.
 *
 * Void (anulir) — PRD §7 aturan:
 *   - VoidReason wajib, tidak bisa kosong.
 *   - Setelah void, periode tersebut terbuka kembali untuk submit baru.
 *   - Duplikat-cek hanya memblokir jika ada baris ACTIVE; baris VOID tidak menghalangi.
 */

var _TU_DIVISI_ID = 'DIV-TU';

/**
 * Berapa kali Pagu sudah direvisi.
 *
 * Definisi: jumlah TRANSISI nilai (PaguReguler, PaguABT) pada baris ACTIVE
 * yang berbeda dari baris ACTIVE sebelumnya, dibaca kronologis. Baris
 * pertama tidak dihitung — itu pagu awal, bukan revisi.
 *
 * Menghitung seluruh riwayat, bukan hanya rantai Supersedes satu periode,
 * karena Pagu bersifat kumulatif: nilainya diwarisi laporan minggu
 * sebelumnya, jadi revisi bisa terjadi di periode mana pun.
 *
 * Dihitung dari perubahan NILAI, bukan dari `CatatanRevisiPagu` yang terisi:
 * `tataUsaha_revisi` mewajibkan alasan revisi tapi tidak memaksa Catatan
 * Revisi Pagu walau Pagu berubah, jadi menghitung dari kolom catatan akan
 * understated.
 *
 * @param {Array<Object>} activeRows Baris TX_TataUsaha berstatus ACTIVE.
 * @returns {number} jumlah revisi pagu yang sudah terjadi.
 */
function _tuHitungRevisiPagu(activeRows) {
  var urut = activeRows.slice().sort(function (a, b) {
    return new Date(a['Timestamp']) - new Date(b['Timestamp']);
  });
  var jumlah = 0;
  var prev = null;
  for (var i = 0; i < urut.length; i++) {
    var cur = { r: _num(urut[i]['PaguReguler']), a: _num(urut[i]['PaguABT']) };
    if (prev && (cur.r !== prev.r || cur.a !== prev.a)) jumlah++;
    prev = cur;
  }
  return jumlah;
}

// ── BACA KPI ─────────────────────────────────────────────

/**
 * KPI aggregate Tata Usaha untuk periode yang dipilih.
 *
 * @param {string} token
 * @param {{mode:string, month:number, year:number, dateFrom:string, dateTo:string}} filter
 * @returns {{success:boolean, data:{
 *   paguReguler: number, paguABT: number, paguTotal: number,
 *   revisiPagu: number,   // berapa kali pagu sudah direvisi (seluruh riwayat)
 *   realisasiSP2D: number, realisasiAkrual: number,
 *   sisaSP2D: number, sisaAkrual: number,
 *   pctSP2D: number, pctAkrual: number,
 *   mingguTerakhirSubmit: string, periodeAktif: string
 * }}}
 */
function tataUsaha_getKPI(token, filter) {
  try {
    var session = _tuRequireSession(token);
    _tuAssertRead(session);

    var sheet  = openTuSheet(SHEET_TU.TATA_USAHA);
    var rows   = sheetToObjects(sheet);
    var range  = filterToDateRange(filter || { mode: 'monthly', month: new Date().getMonth()+1, year: new Date().getFullYear() });

    // Baris ACTIVE dalam range filter
    var activeInRange = rows.filter(function (r) {
      return String(r['Status']) === ROW_STATUS.ACTIVE &&
             isInRange(new Date(r['Timestamp']), range);
    });

    // Pagu: ambil dari baris ACTIVE terbaru (bisa di luar range — pagu bersifat kumulatif)
    var activeAll = rows.filter(function (r) { return String(r['Status']) === ROW_STATUS.ACTIVE; });
    activeAll.sort(function (a, b) { return new Date(b['Timestamp']) - new Date(a['Timestamp']); });
    var latestActive = activeAll[0] || null;

    var paguReguler = latestActive ? _num(latestActive['PaguReguler']) : 0;
    var paguABT     = latestActive ? _num(latestActive['PaguABT'])     : 0;
    var paguTotal   = paguReguler + paguABT;

    // Realisasi akumulatif = SUM dari baris ACTIVE secara YTD (1 Jan s.d. batas akhir filter)
    var tahunRef = range.startDate.getFullYear();
    var ytdStart = new Date(tahunRef, 0, 1);

    var realisasiSP2D_Reguler   = 0;
    var realisasiSP2D_ABT       = 0;
    var realisasiAkrual_Reguler = 0;
    var realisasiAkrual_ABT     = 0;

    rows.forEach(function (r) {
      if (String(r['Status']) !== ROW_STATUS.ACTIVE) return;
      var ts = new Date(r['Timestamp']);
      if (ts >= ytdStart && ts <= range.endDate) {
        var sp2dReg = _num(r['RealisasiSP2D_Reguler_Minggu']);
        var sp2dAbt = _num(r['RealisasiSP2D_ABT_Minggu']);
        var akruReg = _num(r['RealisasiAkrual_Reguler_Minggu']);
        var akruAbt = _num(r['RealisasiAkrual_ABT_Minggu']);
        var legSP2D = _num(r['RealisasiSP2D_Minggu']);
        var legAkru = _num(r['RealisasiAkrual_Minggu']);

        if (sp2dReg > 0 || sp2dAbt > 0) {
          realisasiSP2D_Reguler += sp2dReg;
          realisasiSP2D_ABT     += sp2dAbt;
        } else {
          // Fallback legacy row
          realisasiSP2D_Reguler += legSP2D;
        }

        if (akruReg > 0 || akruAbt > 0) {
          realisasiAkrual_Reguler += akruReg;
          realisasiAkrual_ABT     += akruAbt;
        } else {
          // Fallback legacy row
          realisasiAkrual_Reguler += legAkru;
        }
      }
    });

    var realisasiSP2D_Total   = realisasiSP2D_Reguler + realisasiSP2D_ABT;
    var realisasiAkrual_Total = realisasiAkrual_Reguler + realisasiAkrual_ABT;

    // Sisa Pagu (Pagu - Realisasi SP2D)
    var sisaSP2D_Reguler = paguReguler - realisasiSP2D_Reguler;
    var sisaSP2D_ABT     = paguABT     - realisasiSP2D_ABT;
    var sisaSP2D_Total   = paguTotal   - realisasiSP2D_Total;

    var sisaAkrual_Reguler = paguReguler - realisasiAkrual_Reguler;
    var sisaAkrual_ABT     = paguABT     - realisasiAkrual_ABT;
    var sisaAkrual_Total   = paguTotal   - realisasiAkrual_Total;

    // Persentase Serapan Konsolidasi Nasional yang sah: (Total SP2D Reguler + ABT) / (Total Pagu) * 100
    var pctSP2D_Reguler    = paguReguler > 0 ? _round((realisasiSP2D_Reguler / paguReguler) * 100, 2) : 0;
    var pctSP2D_ABT        = paguABT     > 0 ? _round((realisasiSP2D_ABT     / paguABT)     * 100, 2) : 0;
    var pctSerapanNasional = paguTotal   > 0 ? _round((realisasiSP2D_Total   / paguTotal)   * 100, 2) : 0;

    var pctAkrual_Reguler = paguReguler > 0 ? _round((realisasiAkrual_Reguler / paguReguler) * 100, 2) : 0;
    var pctAkrual_ABT     = paguABT     > 0 ? _round((realisasiAkrual_ABT     / paguABT)     * 100, 2) : 0;
    var pctAkrual_Total   = paguTotal   > 0 ? _round((realisasiAkrual_Total   / paguTotal)   * 100, 2) : 0;

    // Minggu terakhir submit (ACTIVE terbaru dalam range)
    var latest = activeInRange.slice().sort(function (a, b) {
      return new Date(b['Timestamp']) - new Date(a['Timestamp']);
    })[0];

    return {
      success: true,
      data: {
        paguReguler:             paguReguler,
        paguABT:                 paguABT,
        paguTotal:               paguTotal,
        revisiPagu:              _tuHitungRevisiPagu(activeAll),
        realisasiSP2D:           realisasiSP2D_Total,
        realisasiSP2D_Reguler:   realisasiSP2D_Reguler,
        realisasiSP2D_ABT:       realisasiSP2D_ABT,
        realisasiAkrual:         realisasiAkrual_Total,
        realisasiAkrual_Reguler: realisasiAkrual_Reguler,
        realisasiAkrual_ABT:     realisasiAkrual_ABT,
        sisaSP2D:                sisaSP2D_Total,
        sisaSP2D_Reguler:        sisaSP2D_Reguler,
        sisaSP2D_ABT:            sisaSP2D_ABT,
        sisaAkrual:              sisaAkrual_Total,
        sisaAkrual_Reguler:      sisaAkrual_Reguler,
        sisaAkrual_ABT:          sisaAkrual_ABT,
        pctSP2D:                 pctSerapanNasional,
        pctSP2D_Reguler:         pctSP2D_Reguler,
        pctSP2D_ABT:             pctSP2D_ABT,
        pctSerapanNasional:      pctSerapanNasional,
        pctAkrual:               pctAkrual_Total,
        pctAkrual_Reguler:       pctAkrual_Reguler,
        pctAkrual_ABT:           pctAkrual_ABT,
        mingguTerakhirSubmit:    latest ? String(latest['Periode']) : null,
        periodeAktif:            getCurrentPeriode()
      }
    };
  } catch (e) {
    Logger.log('[tataUsaha_getKPI] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ── RIWAYAT ───────────────────────────────────────────────

/**
 * Riwayat baris transaksi (semua status) dalam range filter.
 * Termasuk VoidReason — visible ke seluruh divisi (PRD §7).
 *
 * @param {string} token
 * @param {Object} filter
 */
function tataUsaha_getHistory(token, filter) {
  try {
    var session = _tuRequireSession(token);
    _tuAssertRead(session);

    var sheet = openTuSheet(SHEET_TU.TATA_USAHA);
    var rows  = sheetToObjects(sheet);
    var range = filterToDateRange(filter || { mode: 'monthly', month: new Date().getMonth()+1, year: new Date().getFullYear() });

    var filtered = rows.filter(function (r) {
      return isInRange(new Date(r['Timestamp']), range);
    });

    // Urutkan terbaru di atas
    filtered.sort(function (a, b) { return new Date(b['Timestamp']) - new Date(a['Timestamp']); });

    var data = filtered.map(function (r) {
      var paguReguler = _num(r['PaguReguler']);
      var paguABT     = _num(r['PaguABT']);
      var paguReguler = _num(r['PaguReguler']);
      var paguABT     = _num(r['PaguABT']);
      var sp2dReg     = _num(r['RealisasiSP2D_Reguler_Minggu']);
      var sp2dAbt     = _num(r['RealisasiSP2D_ABT_Minggu']);
      var akruReg     = _num(r['RealisasiAkrual_Reguler_Minggu']);
      var akruAbt     = _num(r['RealisasiAkrual_ABT_Minggu']);
      var sp2dTot     = (sp2dReg + sp2dAbt) || _num(r['RealisasiSP2D_Minggu']);
      var akruTot     = (akruReg + akruAbt) || _num(r['RealisasiAkrual_Minggu']);

      return {
        rowId:                   String(r['RowID']),
        periode:                 String(r['Periode']),
        submittedBy:             String(r['SubmittedBy']),
        timestamp:               r['Timestamp'] ? new Date(r['Timestamp']).toISOString() : null,
        status:                  String(r['Status']),
        paguReguler:             paguReguler,
        paguABT:                 paguABT,
        paguTotal:               paguReguler + paguABT,
        realisasiSP2D:           sp2dTot,
        realisasiSP2D_Reguler:   sp2dReg,
        realisasiSP2D_ABT:       sp2dAbt,
        realisasiAkrual:         akruTot,
        realisasiAkrual_Reguler: akruReg,
        realisasiAkrual_ABT:     akruAbt,
        catatanRevisiPagu:       String(r['CatatanRevisiPagu'] || ''),
        supersedesRowId:         String(r['SupersedesRowID'] || ''),
        // Komentar anulir — visible ke seluruh divisi (PRD §7)
        voidReason:              String(r['VoidReason']  || ''),
        voidedBy:                String(r['VoidedBy']    || ''),
        voidedAt:                r['VoidedAt'] ? new Date(r['VoidedAt']).toISOString() : null
      };
    });

    return { success: true, data: data };
  } catch (e) {
    Logger.log('[tataUsaha_getHistory] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ── SUBMIT MINGGUAN ───────────────────────────────────────

/**
 * Submit laporan mingguan baru.
 *
 * @param {string} token
 * @param {{
 *   periode: string,          // "YYYY-MM-WW"; opsional, default: getCurrentPeriode()
 *   paguReguler: number,
 *   paguABT: number,
 *   realisasiSP2D: number,
 *   realisasiAkrual: number,
 *   realisasiSP2D_Reguler?: number,
 *   realisasiSP2D_ABT?: number,
 *   realisasiAkrual_Reguler?: number,
 *   realisasiAkrual_ABT?: number,
 *   catatanRevisiPagu: string  // opsional; wajib jika Pagu berubah dari sebelumnya
 * }} params
 */
function tataUsaha_submitMingguan(token, params) {
  try {
    return withLock(function () {
      var session = _tuRequireSession(token);
      _tuAssertWrite(session);

      var periode         = (params.periode || getCurrentPeriode()).trim();
      var paguReguler     = _numParam(params.paguReguler,    'Pagu Reguler');
      var paguABT         = _numParam(params.paguABT,        'Pagu ABT');

      // Matriks 2x2 Realisasi: Reguler & ABT
      var sp2dReg = params.realisasiSP2D_Reguler !== undefined && params.realisasiSP2D_Reguler !== '' ? _numParam(params.realisasiSP2D_Reguler, 'Realisasi SP2D Reguler') : null;
      var sp2dAbt = params.realisasiSP2D_ABT !== undefined && params.realisasiSP2D_ABT !== '' ? _numParam(params.realisasiSP2D_ABT, 'Realisasi SP2D ABT') : null;
      var akruReg = params.realisasiAkrual_Reguler !== undefined && params.realisasiAkrual_Reguler !== '' ? _numParam(params.realisasiAkrual_Reguler, 'Realisasi Akrual Reguler') : null;
      var akruAbt = params.realisasiAkrual_ABT !== undefined && params.realisasiAkrual_ABT !== '' ? _numParam(params.realisasiAkrual_ABT, 'Realisasi Akrual ABT') : null;

      var realisasiSP2D, realisasiAkrual;
      if (sp2dReg !== null || sp2dAbt !== null) {
        sp2dReg = sp2dReg || 0;
        sp2dAbt = sp2dAbt || 0;
        realisasiSP2D = sp2dReg + sp2dAbt;
      } else {
        realisasiSP2D = _numParam(params.realisasiSP2D, 'Realisasi SP2D');
        sp2dReg = realisasiSP2D;
        sp2dAbt = 0;
      }

      if (akruReg !== null || akruAbt !== null) {
        akruReg = akruReg || 0;
        akruAbt = akruAbt || 0;
        realisasiAkrual = akruReg + akruAbt;
      } else {
        realisasiAkrual = _numParam(params.realisasiAkrual, 'Realisasi Akrual');
        akruReg = realisasiAkrual;
        akruAbt = 0;
      }

      var catatanRevisi   = (params.catatanRevisiPagu || '').trim();

      // Validasi format periode
      if (!parsePeriode(periode)) {
        return { success: false, error: 'Format Periode tidak valid. Gunakan YYYY-MM-WW.' };
      }

      var sheet = openTuSheet(SHEET_TU.TATA_USAHA);
      var rows  = sheetToObjects(sheet);

      // Cek duplikat: blokir hanya jika ada ACTIVE untuk periode yang sama
      var existingActive = rows.filter(function (r) {
        return String(r['Status'])  === ROW_STATUS.ACTIVE &&
               String(r['Periode']) === periode;
      });
      if (existingActive.length > 0) {
        return {
          success: false,
          error: 'Laporan untuk periode ' + periode + ' sudah ada. Gunakan fitur Revisi untuk memperbarui data.'
        };
      }

      // Ambil Pagu terbaru (untuk carry-forward atau cek perubahan)
      var activeAll = rows.filter(function (r) { return String(r['Status']) === ROW_STATUS.ACTIVE; });
      activeAll.sort(function (a, b) { return new Date(b['Timestamp']) - new Date(a['Timestamp']); });
      var prevActive = activeAll[0] || null;

      // Jika laporan realisasi mingguan menggunakan pagu berjalan secara otomatis
      if (prevActive && paguReguler === 0 && paguABT === 0 && !catatanRevisi) {
        paguReguler = _num(prevActive['PaguReguler']);
        paguABT     = _num(prevActive['PaguABT']);
      }

      // Validasi: jika Pagu berubah dari sebelumnya, wajib isi catatan
      if (prevActive) {
        var prevReguler = _num(prevActive['PaguReguler']);
        var prevABT     = _num(prevActive['PaguABT']);
        if ((paguReguler !== prevReguler || paguABT !== prevABT) && !catatanRevisi) {
          return {
            success: false,
            error: 'Pagu berbeda dari laporan sebelumnya. Wajib isi Catatan Revisi Pagu.'
          };
        }
      }

      var totalPaguMinggu = paguReguler + paguABT;
      if (totalPaguMinggu <= 0 && (realisasiSP2D > 0 || realisasiAkrual > 0)) {
        return {
          success: false,
          error: 'Pagu DIPA aktif belum ditetapkan (> Rp 0). Tetapkan Pagu DIPA terlebih dahulu sebelum mengisi realisasi.'
        };
      }
      if (totalPaguMinggu > 0 && (realisasiSP2D > totalPaguMinggu || realisasiAkrual > totalPaguMinggu)) {
        return {
          success: false,
          error: 'Realisasi SP2D maupun Akrual minggu ini tidak boleh melebihi total Pagu DIPA aktif.'
        };
      }

      var now   = new Date();
      var rowId = 'TU-' + Utilities.getUuid().replace(/-/g, '').substring(0, 14).toUpperCase();

      appendRowData(sheet, {
        'RowID':                          rowId,
        'DivisiID':                       _TU_DIVISI_ID,
        'Periode':                        periode,
        'SubmittedBy':                    session.userId,
        'Timestamp':                      now,
        'Status':                         ROW_STATUS.ACTIVE,
        'SupersedesRowID':                '',
        'VoidReason':                     '',
        'VoidedBy':                       '',
        'VoidedAt':                       '',
        'PaguReguler':                    paguReguler,
        'PaguABT':                        paguABT,
        'RealisasiSP2D_Minggu':           realisasiSP2D,
        'RealisasiAkrual_Minggu':         realisasiAkrual,
        'RealisasiSP2D_Reguler_Minggu':   sp2dReg,
        'RealisasiSP2D_ABT_Minggu':       sp2dAbt,
        'RealisasiAkrual_Reguler_Minggu': akruReg,
        'RealisasiAkrual_ABT_Minggu':     akruAbt,
        'CatatanRevisiPagu':              catatanRevisi
      });

      _tuAuditLog(session.userId, 'CREATE', rowId, '');

      return {
        success: true,
        data: { rowId: rowId, message: 'Laporan realisasi mingguan berhasil disimpan.' }
      };
    });
  } catch (e) {
    Logger.log('[tataUsaha_submitMingguan] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ── PENETAPAN & REVISI PAGU ANGGARAN (DEDICATED FORM) ─────

/**
 * Menetapkan Pagu Awal DIPA atau menyimpan Revisi Pagu DIPA secara terpisah dari input realisasi mingguan.
 *
 * @param {string} token
 * @param {{
 *   paguReguler: number,
 *   paguABT: number,
 *   catatanRevisiPagu: string,
 *   verified: boolean
 * }} params
 */
function tataUsaha_submitPagu(token, params) {
  try {
    return withLock(function () {
      var session = _tuRequireSession(token);
      _tuAssertWrite(session);

      var paguReguler   = _numParam(params.paguReguler, 'Pagu Reguler (DIPA Induk)');
      var paguABT       = _numParam(params.paguABT,     'Pagu Belanja Tambahan (ABT)');
      var catatanRevisi = String(params.catatanRevisiPagu || '').trim();
      var isVerified    = !!params.verified;

      if (paguReguler + paguABT <= 0) {
        return {
          success: false,
          error: 'Total alokasi Pagu DIPA (Reguler + ABT) harus lebih besar dari Rp 0.'
        };
      }

      if (!isVerified) {
        return {
          success: false,
          error: 'Konfirmasi verifikasi dokumen DIPA/POK wajib dicentang sebelum menyimpan Pagu.'
        };
      }

      var sheet = openTuSheet(SHEET_TU.TATA_USAHA);
      var rows  = sheetToObjects(sheet);

      var activeAll = rows.filter(function (r) { return String(r['Status']) === ROW_STATUS.ACTIVE; });
      activeAll.sort(function (a, b) { return new Date(b['Timestamp']) - new Date(a['Timestamp']); });
      var prevActive = activeAll[0] || null;

      var prevReg = prevActive ? _num(prevActive['PaguReguler']) : 0;
      var prevAbt = prevActive ? _num(prevActive['PaguABT'])     : 0;
      var hasExistingPagu = (prevReg + prevAbt) > 0;

      if (hasExistingPagu) {
        if (paguReguler === prevReg && paguABT === prevAbt) {
          return {
            success: false,
            error: 'Nominal Pagu Reguler dan Pagu ABT sama dengan Pagu aktif saat ini. Tidak ada perubahan untuk direvisi.'
          };
        }
        if (!catatanRevisi) {
          return {
            success: false,
            error: 'Dasar hukum / Catatan Revisi Pagu DIPA wajib diisi saat melakukan perubahan Pagu.'
          };
        }
      } else {
        if (!catatanRevisi) {
          catatanRevisi = 'Penetapan Pagu Awal DIPA';
        }
      }

      var revCount = _tuHitungRevisiPagu(activeAll);
      var basePeriode = getCurrentPeriode();
      var labelPeriode = hasExistingPagu
        ? (basePeriode + ' (Revisi Pagu #' + (revCount + 1) + ')')
        : (basePeriode + ' (Pagu Awal)');

      var now   = new Date();
      var rowId = 'TU-' + Utilities.getUuid().replace(/-/g, '').substring(0, 14).toUpperCase();

      appendRowData(sheet, {
        'RowID':                          rowId,
        'DivisiID':                       _TU_DIVISI_ID,
        'Periode':                        labelPeriode,
        'SubmittedBy':                    session.userId,
        'Timestamp':                      now,
        'Status':                         ROW_STATUS.ACTIVE,
        'SupersedesRowID':                '',
        'VoidReason':                     '',
        'VoidedBy':                       '',
        'VoidedAt':                       '',
        'PaguReguler':                    paguReguler,
        'PaguABT':                        paguABT,
        'RealisasiSP2D_Minggu':           0,
        'RealisasiAkrual_Minggu':         0,
        'RealisasiSP2D_Reguler_Minggu':   0,
        'RealisasiSP2D_ABT_Minggu':       0,
        'RealisasiAkrual_Reguler_Minggu': 0,
        'RealisasiAkrual_ABT_Minggu':     0,
        'CatatanRevisiPagu':              catatanRevisi
      });

      _tuAuditLog(
        session.userId,
        hasExistingPagu ? 'REVISI_PAGU' : 'SET_PAGU_AWAL',
        rowId,
        catatanRevisi
      );

      return {
        success: true,
        data: {
          rowId: rowId,
          message: hasExistingPagu
            ? 'Revisi Pagu DIPA berhasil disimpan (Revisi ke-' + (revCount + 1) + ').'
            : 'Penetapan Pagu Awal DIPA berhasil disimpan.'
        }
      };
    });
  } catch (e) {
    Logger.log('[tataUsaha_submitPagu] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ── REVISI ────────────────────────────────────────────────

/**
 * Revisi laporan: insert baris baru, mark baris lama SUPERSEDED.
 *
 * @param {string} token
 * @param {{
 *   targetRowId: string,       // RowID baris ACTIVE yang akan direvisi
 *   paguReguler: number,
 *   paguABT: number,
 *   realisasiSP2D: number,
 *   realisasiAkrual: number,
 *   realisasiSP2D_Reguler?: number,
 *   realisasiSP2D_ABT?: number,
 *   realisasiAkrual_Reguler?: number,
 *   realisasiAkrual_ABT?: number,
 *   alasanRevisi: string,       // wajib
 *   catatanRevisiPagu: string   // opsional
 * }} params
 */
function tataUsaha_revisi(token, params) {
  try {
    return withLock(function () {
      var session = _tuRequireSession(token);
      _tuAssertWrite(session);

      var targetRowId     = (params.targetRowId || '').trim();
      var alasanRevisi    = (params.alasanRevisi || '').trim();
      var paguReguler     = _numParam(params.paguReguler,    'Pagu Reguler');
      var paguABT         = _numParam(params.paguABT,        'Pagu ABT');

      // Matriks 2x2 Realisasi: Reguler & ABT
      var sp2dReg = params.realisasiSP2D_Reguler !== undefined && params.realisasiSP2D_Reguler !== '' ? _numParam(params.realisasiSP2D_Reguler, 'Realisasi SP2D Reguler') : null;
      var sp2dAbt = params.realisasiSP2D_ABT !== undefined && params.realisasiSP2D_ABT !== '' ? _numParam(params.realisasiSP2D_ABT, 'Realisasi SP2D ABT') : null;
      var akruReg = params.realisasiAkrual_Reguler !== undefined && params.realisasiAkrual_Reguler !== '' ? _numParam(params.realisasiAkrual_Reguler, 'Realisasi Akrual Reguler') : null;
      var akruAbt = params.realisasiAkrual_ABT !== undefined && params.realisasiAkrual_ABT !== '' ? _numParam(params.realisasiAkrual_ABT, 'Realisasi Akrual ABT') : null;

      var realisasiSP2D, realisasiAkrual;
      if (sp2dReg !== null || sp2dAbt !== null) {
        sp2dReg = sp2dReg || 0;
        sp2dAbt = sp2dAbt || 0;
        realisasiSP2D = sp2dReg + sp2dAbt;
      } else {
        realisasiSP2D = _numParam(params.realisasiSP2D, 'Realisasi SP2D');
        sp2dReg = realisasiSP2D;
        sp2dAbt = 0;
      }

      if (akruReg !== null || akruAbt !== null) {
        akruReg = akruReg || 0;
        akruAbt = akruAbt || 0;
        realisasiAkrual = akruReg + akruAbt;
      } else {
        realisasiAkrual = _numParam(params.realisasiAkrual, 'Realisasi Akrual');
        akruReg = realisasiAkrual;
        akruAbt = 0;
      }

      var catatanRevisi   = (params.catatanRevisiPagu || '').trim();

      if (!targetRowId) return { success: false, error: 'targetRowId wajib diisi.' };
      if (!alasanRevisi) return { success: false, error: 'Alasan revisi wajib diisi.' };
      var totalPaguRv = paguReguler + paguABT;
      if (totalPaguRv > 0 && (realisasiSP2D > totalPaguRv || realisasiAkrual > totalPaguRv)) {
        return { success: false, error: 'Realisasi SP2D maupun Akrual tidak boleh melebihi total Pagu DIPA.' };
      }

      var sheet   = openTuSheet(SHEET_TU.TATA_USAHA);
      var oldRow  = findRowByField(sheet, 'RowID', targetRowId);
      if (!oldRow || String(oldRow.obj['Status']) !== ROW_STATUS.ACTIVE) {
        return { success: false, error: 'Baris tidak ditemukan atau bukan status ACTIVE.' };
      }

      var now      = new Date();
      var newRowId = 'TU-' + Utilities.getUuid().replace(/-/g, '').substring(0, 14).toUpperCase();

      // Insert baris baru
      appendRowData(sheet, {
        'RowID':                          newRowId,
        'DivisiID':                       _TU_DIVISI_ID,
        'Periode':                        String(oldRow.obj['Periode']),
        'SubmittedBy':                    session.userId,
        'Timestamp':                      now,
        'Status':                         ROW_STATUS.ACTIVE,
        'SupersedesRowID':                targetRowId,
        'VoidReason':                     '',
        'VoidedBy':                       '',
        'VoidedAt':                       '',
        'PaguReguler':                    paguReguler,
        'PaguABT':                        paguABT,
        'RealisasiSP2D_Minggu':           realisasiSP2D,
        'RealisasiAkrual_Minggu':         realisasiAkrual,
        'RealisasiSP2D_Reguler_Minggu':   sp2dReg,
        'RealisasiSP2D_ABT_Minggu':       sp2dAbt,
        'RealisasiAkrual_Reguler_Minggu': akruReg,
        'RealisasiAkrual_ABT_Minggu':     akruAbt,
        'CatatanRevisiPagu':              catatanRevisi
      });

      // Tandai baris lama SUPERSEDED
      updateRowCells(sheet, oldRow.rowIndex, { 'Status': ROW_STATUS.SUPERSEDED });

      _tuAuditLog(session.userId, 'UPDATE', newRowId, 'Revisi dari ' + targetRowId + ': ' + alasanRevisi);

      return {
        success: true,
        data: { rowId: newRowId, message: 'Revisi berhasil disimpan.' }
      };
    });
  } catch (e) {
    Logger.log('[tataUsaha_revisi] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ── ANULIR ────────────────────────────────────────────────

/**
 * Anulir laporan: tandai baris VOID + simpan komentar.
 *
 * Aturan (PRD §7, dikonfirmasi 15 Sep 2026):
 * - VoidReason WAJIB — tidak ada pengecualian.
 * - VoidReason VISIBLE ke seluruh anggota divisi di tabel riwayat.
 * - Setelah void, periode terbuka kembali untuk submit baru.
 * - Kewenangan: SUPERADMIN + DIREKTUR (cross-divisi) + KADIV (divisinya).
 *
 * @param {string} token
 * @param {{
 *   targetRowId: string,
 *   voidReason: string    // komentar wajib, tampil ke semua anggota divisi
 * }} params
 */
function tataUsaha_anulir(token, params) {
  try {
    return withLock(function () {
      var session     = _tuRequireSession(token);
      _tuAssertAnulir(session);

      var targetRowId = (params.targetRowId || '').trim();
      var voidReason  = (params.voidReason  || '').trim();

      if (!targetRowId) return { success: false, error: 'targetRowId wajib diisi.' };
      if (!voidReason) {
        return {
          success: false,
          error: 'Komentar anulir wajib diisi. Staf perlu mengetahui apa yang perlu diperbaiki sebelum dapat mengunggah laporan baru.'
        };
      }

      var sheet  = openTuSheet(SHEET_TU.TATA_USAHA);
      var target = findRowByField(sheet, 'RowID', targetRowId);
      if (!target) {
        return { success: false, error: 'Baris tidak ditemukan.' };
      }
      if (String(target.obj['Status']) === ROW_STATUS.VOID) {
        return { success: false, error: 'Baris sudah dalam status VOID.' };
      }
      if (String(target.obj['Status']) === ROW_STATUS.SUPERSEDED) {
        return { success: false, error: 'Baris berstatus SUPERSEDED tidak dapat dianulir langsung — anulir baris ACTIVE-nya.' };
      }

      var now = new Date();
      updateRowCells(sheet, target.rowIndex, {
        'Status':    ROW_STATUS.VOID,
        'VoidReason': voidReason,
        'VoidedBy':   session.userId,
        'VoidedAt':   now
      });

      _tuAuditLog(session.userId, 'VOID', targetRowId, voidReason);

      // Notifikasi ke publisher (SubmittedBy) jika bukan self-void
      var publisherId = String(target.obj['SubmittedBy']);
      if (publisherId && publisherId !== session.userId) {
        _tuNotifyVoid(publisherId, targetRowId, String(target.obj['Periode']), voidReason, session.userId);
      }

      return {
        success: true,
        data: {
          message: 'Laporan berhasil dianulir. Komentar Anda akan terlihat oleh seluruh anggota divisi.',
          periode: String(target.obj['Periode'])
        }
      };
    });
  } catch (e) {
    Logger.log('[tataUsaha_anulir] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ── RBAC HELPER ───────────────────────────────────────────

function _tuRequireSession(token) {
  var raw = CacheService.getScriptCache().get('sess_' + token);
  if (!raw) throw new Error('UNAUTHORIZED: Sesi tidak valid atau sudah berakhir.');
  try { return JSON.parse(raw); } catch (e) { throw new Error('UNAUTHORIZED: Sesi tidak dapat dibaca.'); }
}

/** Baca: semua APPROVED. KADIV/STAF dibatasi hanya bisa lihat DIV-TU (server-side; cross-divisi untuk Superadmin/Direktur). */
function _tuAssertRead(session) {
  if (!session || session.status !== 'APPROVED') {
    throw new Error('UNAUTHORIZED: Akun belum aktif.');
  }
  // SUPERADMIN dan DIREKTUR boleh baca cross-divisi — tidak perlu pembatasan.
  // Untuk KADIV/STAF dari divisi lain: service sudah hanya query DivisiID=DIV-TU,
  // jadi data yang dikembalikan tetap aman meski mereka bisa memanggil fungsi ini.
  // assertScope akan memblokir aksi write.
}

/** Write (submit/revisi): SUPERADMIN + KADIV(DIV-TU) + STAF(DIV-TU). */
function _tuAssertWrite(session) {
  assertScope(session, [ROLE.SUPERADMIN, ROLE.KADIV, ROLE.STAF], _TU_DIVISI_ID);
}

/** Submit profil pegawai / sertifikat / data operasional TU (alias _tuAssertWrite). */
function _tuAssertSubmit(session) {
  _tuAssertWrite(session);
}

/**
 * Anulir: SUPERADMIN + DIREKTUR + KADIV(DIV-TU).
 * DIREKTUR diizinkan cross-divisi; Staf tidak bisa anulir.
 */
function _tuAssertAnulir(session) {
  if (!session || session.status !== 'APPROVED') {
    throw new Error('UNAUTHORIZED: Akun belum aktif.');
  }
  if (session.role === ROLE.SUPERADMIN || session.role === ROLE.DIREKTUR) return;
  if (session.role === ROLE.KADIV && session.divisiId === _TU_DIVISI_ID) return;
  throw new Error('UNAUTHORIZED: Anda tidak memiliki izin untuk menganulir laporan ini.');
}

/** Alias _tuAssertVoid untuk pembatalan/anulir paket & transaksi. */
function _tuAssertVoid(session) {
  _tuAssertAnulir(session);
}

// ── LOG & NOTIFIKASI ──────────────────────────────────────

function _tuAuditLog(userId, aksi, rowId, alasan) {
  try {
    appendRowData(openLogSheet(SHEET_LOG.AUDIT_LOG), {
      'LogID':       'LOG-' + Utilities.getUuid().replace(/-/g,'').substring(0,12).toUpperCase(),
      'UserID':      userId,
      'Aksi':        aksi,
      'SheetTarget': SHEET_TU.TATA_USAHA,
      'RowIDTarget': rowId,
      'Alasan':      alasan,
      'Timestamp':   new Date()
    });
  } catch (e) { Logger.log('[_tuAuditLog] ' + e.message); }
}

/** Notifikasi ke publisher bahwa laporannya dianulir + alasan. */
function _tuNotifyVoid(toUserId, rowId, periode, voidReason, voidedByUserId) {
  try {
    appendRowData(openLogSheet(SHEET_LOG.NOTIFICATIONS), {
      'NotifID':  'NTF-' + Utilities.getUuid().replace(/-/g,'').substring(0,12).toUpperCase(),
      'UserID':   toUserId,
      'Jenis':    'DATA_VOIDED',
      'Pesan':    'Laporan Tata Usaha periode ' + periode + ' (ID: ' + rowId + ') telah dianulir. ' +
                  'Alasan: ' + voidReason + ' — Segera buat laporan baru setelah perbaikan.',
      'IsRead':   false,
      'CreatedAt': new Date()
    });
  } catch (e) { Logger.log('[_tuNotifyVoid] ' + e.message); }
}

// ── NUMERIK HELPER ────────────────────────────────────────

function _num(v)  { return parseFloat(v) || 0; }
function _round(v, d) { var m = Math.pow(10, d); return Math.round(v * m) / m; }

function _numParam(val, label) {
  var n = parseFloat(val);
  if (isNaN(n) || n < 0) throw new Error(label + ' harus berupa angka non-negatif.');
  return n;
}

// ── TREN BULANAN (FASE 8 — chart konteks anggaran) ─────────
// Semua kalkulasi server-side (prinsip ARCHITECTURE.md). Baris dikelompokkan
// per bulan lewat prefix "YYYY-MM" dari kolom Periode. Siklus YTD mengikuti
// rentang filter (Jan s/d bulan/dateTo terpilih).

function tataUsaha_getTren(token, filter) {
  try {
    var session = _tuRequireSession(token);
    _tuAssertRead(session);

    var sheet = openTuSheet(SHEET_TU.TATA_USAHA);
    var rows  = sheetToObjects(sheet);
    var months = utils_getTrendMonths(filter);

    var sp2dBulanan = [], akrualBulanan = [];
    for (var i = 0; i < months.length; i++) { sp2dBulanan.push(0); akrualBulanan.push(0); }
    var idx = {};
    months.forEach(function (m, mi) { idx[m] = mi; });

    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      if (String(r['Status']) !== ROW_STATUS.ACTIVE) continue;
      var mm = String(r['Periode'] || '').substring(0, 7);
      if (idx[mm] === undefined) continue;
      var sp2dReg = _num(r['RealisasiSP2D_Reguler_Minggu']);
      var sp2dAbt = _num(r['RealisasiSP2D_ABT_Minggu']);
      var akruReg = _num(r['RealisasiAkrual_Reguler_Minggu']);
      var akruAbt = _num(r['RealisasiAkrual_ABT_Minggu']);
      var sp2dRow = (sp2dReg + sp2dAbt) || _num(r['RealisasiSP2D_Minggu']);
      var akruRow = (akruReg + akruAbt) || _num(r['RealisasiAkrual_Minggu']);

      sp2dBulanan[idx[mm]] += sp2dRow;
      akrualBulanan[idx[mm]] += akruRow;
    }

    var sp2dYtd = [], akrualYtd = [], cs = 0, ca = 0;
    for (var k = 0; k < months.length; k++) {
      cs += sp2dBulanan[k];
      ca += akrualBulanan[k];
      sp2dYtd.push(cs);
      akrualYtd.push(ca);
    }

    // Pagu terbaru dari laporan ACTIVE terakhir
    var lat = null;
    for (var l = 0; l < rows.length; l++) {
      if (String(rows[l]['Status']) !== ROW_STATUS.ACTIVE) continue;
      if (!lat || new Date(rows[l]['Timestamp']) > new Date(lat['Timestamp'])) lat = rows[l];
    }

    return { success: true, data: {
      months:        months,
      sp2dBulanan:   sp2dBulanan,
      akrualBulanan: akrualBulanan,
      sp2dYtd:       sp2dYtd,
      akrualYtd:     akrualYtd,
      paguReguler:   lat ? _num(lat['PaguReguler']) : 0,
      paguABT:       lat ? _num(lat['PaguABT']) : 0
    } };
  } catch (e) {
    Logger.log('[tataUsaha_getTren] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ===========================================================================
// SUB-MODUL KEPEGAWAIAN TATA USAHA (5 KATEGORI)
// ===========================================================================

var _TU_KATEGORI_PEGAWAI = ['PNS', 'P3K', 'P3K_PARUH_WAKTU', 'PJLP', 'MAGANG'];

/**
 * Mengambil data ringkasan kepegawaian (headcount 5 kategori, persentase, dan riwayat).
 *
 * @param {string} token - session token
 * @param {Object} filter - opsional
 * @returns {{success:boolean, data:{
 *   totalPegawai: number,
 *   breakdown: Object,
 *   counts: Object,
 *   lastUpdated: string,
 *   latestKeterangan: string,
 *   history: Array
 * }}}
 */
function tataUsaha_getPegawai(token, filter) {
  try {
    var session = _tuRequireSession(token);
    _tuAssertRead(session);

    var sheet = openTuSheet(SHEET_TU.PEGAWAI);
    var rows  = sheetToObjects(sheet);

    // Ambil baris ACTIVE
    var activeRows = rows.filter(function (r) {
      return String(r['Status']) === ROW_STATUS.ACTIVE;
    });

    // Urutkan kronologis ascending untuk proses snapshot carry-forward
    activeRows.sort(function (a, b) {
      return new Date(a['Timestamp']) - new Date(b['Timestamp']);
    });

    // Cari nilai headcount terkini per kategori
    var latestCounts = {
      PNS: 0,
      P3K: 0,
      P3K_PARUH_WAKTU: 0,
      PJLP: 0,
      MAGANG: 0
    };

    var latestTimestamp = null;
    var latestKeterangan = '';

    for (var i = 0; i < activeRows.length; i++) {
      var r = activeRows[i];
      var kat = String(r['Kategori'] || '').toUpperCase();
      if (latestCounts.hasOwnProperty(kat)) {
        latestCounts[kat] = _num(r['Jumlah']);
        latestTimestamp = r['Timestamp'];
        if (r['Keterangan']) latestKeterangan = String(r['Keterangan']);
      }
    }

    // Hitung jumlah pegawai per status kepegawaian otomatis dari Master Data Pegawai
    var masterCounts = {
      PNS: 0,
      P3K: 0,
      P3K_PARUH_WAKTU: 0,
      PJLP: 0,
      MAGANG: 0
    };
    var totalMasterAktif = 0;
    var totalDitPoaMaster = 0;
    var totalAwakArmadaMaster = 0;

    try {
      if (typeof ensurePegawaiPelatihanSeeded === 'function') {
        try { ensurePegawaiPelatihanSeeded(); } catch (eSeed) {}
      }
      var pSheet = openTuSheet(SHEET_TU.PEGAWAI_MASTER);
      _healMasterPegawaiNamaAndSchemaOnce(pSheet);
      var pRows = sheetToObjects(pSheet);
      var todayStr = new Date().toISOString().slice(0, 10);

      for (var p = 0; p < pRows.length; p++) {
        var rPeg = pRows[p];
        var sAktif = String(rPeg['StatusAktif'] || 'AKTIF').trim().toUpperCase();
        var sPeg = String(rPeg['StatusKepegawaian'] || '').trim().toUpperCase();

        if (sAktif === 'MAGANG' || sAktif === 'PJLP' || sAktif === 'P3K' || sAktif === 'P3K_PARUH_WAKTU') {
          if (!sPeg || sPeg === 'PNS' || sPeg === 'NON_ASN') {
            sPeg = sAktif;
          }
          sAktif = 'AKTIF';
        }
        if (sAktif === 'NON_AKTIF') continue;

        var u = String(rPeg['UnitKerja'] || '').trim().toLowerCase();
        var isPoa = (u === 'dit. poa' || u === 'dit poa' || u.indexOf('pengendalian operasi armada') !== -1 || (u.indexOf('poa') !== -1 && u.indexOf('armada') === -1));
        var cleanNipPeg = String(rPeg['NIP'] || '').replace(/[^0-9]/g, '');
        if (/^\d{12}21\d{4}$/.test(cleanNipPeg) && (!sPeg || sPeg === 'PNS' || sPeg === 'NON_ASN')) {
          sPeg = 'P3K';
        }
        if (!sPeg) {
          sPeg = isPoa ? 'PNS' : (cleanNipPeg ? 'PNS' : 'NON_ASN');
        }

        // Cek kedaluwarsa magang / kontrak
        var tglSelesai = String(rPeg['TanggalSelesai'] || '').trim();
        var isExpired = tglSelesai && tglSelesai < todayStr;

        var statusP = sPeg;
        if (statusP === 'PPPK_FUNGSIONAL' || statusP === 'PPPK_PELAKSANA') statusP = 'P3K';
        if (statusP === 'PPPK_PARUH_WAKTU') statusP = 'P3K_PARUH_WAKTU';
        sPeg = statusP;

        var rmp = String(rPeg['KategoriRumpun'] || '').toUpperCase();
        var lkp = String(rPeg['LingkupData'] || '').toUpperCase();
        var isAwak = (rmp === 'AWAK_DEK' || rmp === 'AWAK_MESIN' || rmp === 'PENUNJANG' || lkp === 'AWAK_KAPAL_ARMADA');
        if (isAwak) {
          totalAwakArmadaMaster++;
        } else if (isPoa) {
          totalDitPoaMaster++;
        }

        if (sPeg === 'PNS') {
          masterCounts.PNS++;
        } else if (sPeg === 'P3K') {
          masterCounts.P3K++;
        } else if (sPeg === 'P3K_PARUH_WAKTU') {
          masterCounts.P3K_PARUH_WAKTU++;
        } else if (sPeg === 'PJLP') {
          masterCounts.PJLP++;
        } else if (sPeg === 'MAGANG') {
          if (!isExpired) {
            masterCounts.MAGANG++;
          }
        }
        totalMasterAktif++;
      }
    } catch (eMaster) {
      Logger.log('[tataUsaha_getPegawai] Master count notice: ' + eMaster.message);
    }

    // Gunakan master data sebagai single source of truth
    if (masterCounts.PNS > 0 || masterCounts.P3K > 0 || masterCounts.P3K_PARUH_WAKTU > 0 || masterCounts.PJLP > 0 || masterCounts.MAGANG > 0) {
      latestCounts = masterCounts;
    }

    var totalPegawai = 0;
    _TU_KATEGORI_PEGAWAI.forEach(function (k) {
      totalPegawai += latestCounts[k];
    });

    var breakdown = {};
    _TU_KATEGORI_PEGAWAI.forEach(function (k) {
      var count = latestCounts[k];
      var pct   = totalPegawai > 0 ? Math.round((count / totalPegawai) * 1000) / 10 : 0;
      breakdown[k] = {
        count: count,
        percentage: pct
      };
    });

    // Riwayat log perubahan (diurutkan desc)
    var history = rows.slice().sort(function (a, b) {
      return new Date(b['Timestamp']) - new Date(a['Timestamp']);
    }).map(function (r) {
      return {
        rowId:       String(r['RowID'] || ''),
        periode:     String(r['Periode'] || ''),
        timestamp:   r['Timestamp'] ? new Date(r['Timestamp']).toISOString() : null,
        kategori:    String(r['Kategori'] || ''),
        jumlah:      _num(r['Jumlah']),
        keterangan:  String(r['Keterangan'] || ''),
        status:      String(r['Status'] || ''),
        submittedBy: String(r['SubmittedBy'] || ''),
        voidReason:  String(r['VoidReason'] || '')
      };
    });

    return {
      success: true,
      data: {
        totalPegawai: totalPegawai,
        breakdown: breakdown,
        counts: latestCounts,
        lastUpdated: latestTimestamp ? new Date(latestTimestamp).toISOString() : null,
        latestKeterangan: latestKeterangan,
        history: history
      }
    };
  } catch (e) {
    Logger.log('[tataUsaha_getPegawai] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Submit pembaruan headcount kepegawaian TU.
 *
 * @param {string} token
 * @param {{
 *   counts: { PNS: number, P3K: number, P3K_PARUH_WAKTU: number, PJLP: number, MAGANG: number },
 *   keterangan: string,
 *   periode: string
 * }} params
 */
function tataUsaha_submitPegawai(token, params) {
  try {
    var session = _tuRequireSession(token);
    _tuAssertWrite(session);

    if (!params || !params.counts) {
      throw new Error('Data jumlah pegawai tidak valid.');
    }

    var periode = params.periode || getCurrentPeriode();
    var keterangan = (params.keterangan || '').trim();
    var counts = params.counts;

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      var sheet = openTuSheet(SHEET_TU.PEGAWAI);
      var now = new Date();
      var newRows = [];

      _TU_KATEGORI_PEGAWAI.forEach(function (kat) {
        var val = counts[kat] !== undefined && counts[kat] !== '' ? _num(counts[kat]) : null;
        if (val !== null && val >= 0) {
          var rowId = Utilities.getUuid();
          newRows.push([
            rowId,
            _TU_DIVISI_ID,
            periode,
            session.userId,
            now,
            ROW_STATUS.ACTIVE,
            '', // SupersedesRowID
            '', // VoidReason
            '', // VoidedBy
            '', // VoidedAt
            kat,
            val,
            keterangan
          ]);
        }
      });

      if (newRows.length === 0) {
        throw new Error('Minimal satu kategori pegawai harus diisi dengan angka non-negatif.');
      }

      var lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);

      logAudit(session.userId, 'SUBMIT_PEGAWAI', 'TU_Pegawai', newRows[0][0], {
        kategoriUpdated: _TU_KATEGORI_PEGAWAI.filter(function(k){ return counts[k] !== undefined; }),
        periode: periode,
        keterangan: keterangan
      });

      return { success: true, message: 'Data kepegawaian berhasil diperbarui.' };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[tataUsaha_submitPegawai] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Anulir entri mutasi pegawai.
 */
function tataUsaha_anulirPegawai(token, params) {
  try {
    var session = _tuRequireSession(token);
    _tuAssertAnulir(session);

    if (!params || !params.rowId || !params.alasan) {
      throw new Error('RowID dan Alasan Anulir wajib diisi.');
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      var sheet = openTuSheet(SHEET_TU.PEGAWAI);
      var rows  = sheetToObjects(sheet);
      var targetIdx = -1;

      for (var i = 0; i < rows.length; i++) {
        if (rows[i]['RowID'] === params.rowId && String(rows[i]['Status']) === ROW_STATUS.ACTIVE) {
          targetIdx = i + 2; // +2 for header row & 1-based index
          break;
        }
      }

      if (targetIdx === -1) {
        throw new Error('Data tidak ditemukan atau sudah tidak aktif.');
      }

      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var colStatus = headers.indexOf('Status') + 1;
      var colReason = headers.indexOf('VoidReason') + 1;
      var colBy     = headers.indexOf('VoidedBy') + 1;
      var colAt     = headers.indexOf('VoidedAt') + 1;

      sheet.getRange(targetIdx, colStatus).setValue(ROW_STATUS.VOID);
      sheet.getRange(targetIdx, colReason).setValue(params.alasan);
      sheet.getRange(targetIdx, colBy).setValue(session.userId);
      sheet.getRange(targetIdx, colAt).setValue(new Date());

      logAudit(session.userId, 'ANULIR_PEGAWAI', 'TU_Pegawai', params.rowId, {
        alasan: params.alasan
      });

      return { success: true, message: 'Entri berhasil dianulir.' };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[tataUsaha_anulirPegawai] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ===========================================================================
// SUB-MODUL B: MONITORING PAKET PENGADAAN & PEKERJAAN (PRD §3.2)
// ===========================================================================

var _TU_TAHAP_PAKET = ['PERSIAPAN', 'PEMILIHAN', 'KONTRAK', 'PELAKSANAAN', 'BAST', 'SELESAI'];

/**
 * Mengambil ringkasan & riwayat progres paket pengadaan.
 * @param {string} token
 * @param {Object} filter
 */
function tataUsaha_getPaket(token, filter) {
  try {
    var session = _tuRequireSession(token);
    _tuAssertRead(session);

    var sheet = openTuSheet(SHEET_TU.PAKET_PROGRES);
    var rows = sheetToObjects(sheet);

    var activeRows = rows.filter(function (r) {
      return String(r['Status']) === ROW_STATUS.ACTIVE;
    });

    var totalNilaiKontrak = 0;
    var totalRealisasiKeu = 0;
    var totalProgresFisik = 0;

    activeRows.forEach(function (r) {
      totalNilaiKontrak += _num(r['NilaiKontrak']);
      totalRealisasiKeu += _num(r['RealisasiKeuangan']);
      totalProgresFisik += _num(r['ProgresFisikPct']);
    });

    var avgProgresFisik = activeRows.length > 0
      ? Math.round((totalProgresFisik / activeRows.length) * 10) / 10
      : 0;

    // Riwayat diurutkan descending
    var history = rows.slice().sort(function (a, b) {
      return new Date(b['Timestamp'] || 0) - new Date(a['Timestamp'] || 0);
    }).map(function (r) {
      return {
        rowId: String(r['RowID'] || ''),
        periode: String(r['Periode'] || ''),
        divisiId: String(r['DivisiID'] || ''),
        namaPaket: String(r['NamaPaket'] || r['PaketID'] || ''),
        paketId: String(r['PaketID'] || ''),
        tahap: String(r['TahapPekerjaan'] || ''),
        noKontrak: String(r['NomorKontrak'] || ''),
        rekanan: String(r['RekananPenyedia'] || ''),
        nilaiKontrak: _num(r['NilaiKontrak']),
        progresFisik: _num(r['ProgresFisikPct']),
        realisasiKeuangan: _num(r['RealisasiKeuangan']),
        kendala: String(r['KendalaKeterangan'] || ''),
        evidenceUrl: String(r['EvidenceUrl'] || ''),
        status: String(r['Status'] || ''),
        supersedesRowId: String(r['SupersedesRowID'] || ''),
        submittedBy: String(r['SubmittedBy'] || ''),
        timestamp: r['Timestamp'] instanceof Date ? r['Timestamp'].toISOString() : String(r['Timestamp'] || '')
      };
    });

    return {
      success: true,
      data: {
        totalPaket: activeRows.length,
        totalNilaiKontrak: totalNilaiKontrak,
        totalRealisasiKeu: totalRealisasiKeu,
        avgProgresFisik: avgProgresFisik,
        items: history
      }
    };
  } catch (e) {
    Logger.log('[tataUsaha_getPaket] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Mencatat / memperbarui progres paket pekerjaan pengadaan.
 * Mendukung siklus hidup pemutakhiran 6 tahap pekerjaan dengan mekanisme
 * row versioning (baris lama aktif di-SUPERSEDED, baris baru aktif di-append).
 * @param {string} token
 * @param {Object} payload
 */
function tataUsaha_submitPaket(token, payload) {
  try {
    var session = _tuRequireSession(token);
    _tuAssertWrite(session);

    if (!payload) throw new Error('Data payload tidak boleh kosong.');
    var namaPaket = String(payload.namaPaket || '').trim();
    var tahap = String(payload.tahap || '').toUpperCase();
    var divisiId = String(payload.divisiId || _TU_DIVISI_ID).trim();
    var progresFisik = parseFloat(payload.progresFisik);

    if (!namaPaket) throw new Error('Nama paket pekerjaan wajib diisi.');
    if (_TU_TAHAP_PAKET.indexOf(tahap) === -1) throw new Error('Tahap pekerjaan tidak valid.');
    if (isNaN(progresFisik) || progresFisik < 0 || progresFisik > 100) {
      throw new Error('Progres fisik harus berada di antara 0 dan 100%.');
    }

    var tahapIdx = _TU_TAHAP_PAKET.indexOf(tahap);
    var noKontrak = String(payload.noKontrak || '').trim();
    var rekanan = String(payload.rekanan || '').trim();
    var nilaiKontrak = Number(payload.nilaiKontrak) || 0;
    var realisasiKeuangan = Number(payload.realisasiKeuangan) || 0;

    if (nilaiKontrak < 0 || realisasiKeuangan < 0) {
      throw new Error('Nilai Kontrak dan Realisasi Keuangan tidak boleh bernilai negatif.');
    }
    if (tahapIdx < 2 && realisasiKeuangan > 0) {
      throw new Error('Realisasi Keuangan harus Rp 0 saat paket masih pada tahap ' + tahap + '.');
    }
    if (tahapIdx >= 2) {
      if (!noKontrak) throw new Error('Nomor Kontrak wajib diisi untuk tahap ' + tahap + '.');
      if (!rekanan) throw new Error('Rekanan Penyedia wajib diisi untuk tahap ' + tahap + '.');
      if (nilaiKontrak <= 0) throw new Error('Nilai Kontrak wajib lebih dari Rp 0 untuk tahap ' + tahap + '.');
    }
    if (nilaiKontrak > 0 && realisasiKeuangan > nilaiKontrak) {
      throw new Error('Realisasi Keuangan tidak boleh melebihi Nilai Kontrak.');
    }
    if (tahap === 'SELESAI' && progresFisik < 100) {
      throw new Error('Paket berstatus SELESAI wajib memiliki progres fisik 100%.');
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);

    try {
      var sheet = openTuSheet(SHEET_TU.PAKET_PROGRES);
      var rows = sheetToObjects(sheet);
      var periode = String(payload.periode || getCurrentPeriode()).trim();
      var ts = new Date();
      var rowId = 'PKT-' + ts.getFullYear() + '-' + Utilities.getUuid().substring(0, 8).toUpperCase();

      var oldRowId = '';
      var targetIdx = -1;
      var targetRowId = String(payload.targetRowId || payload.rowId || '').trim();
      var paketId = String(payload.paketId || '').trim();

      // 1. Cari baris yang akan di-supersede jika ada targetRowId spesifik
      if (targetRowId) {
        for (var i = 0; i < rows.length; i++) {
          if (rows[i]['RowID'] === targetRowId && String(rows[i]['Status']) === ROW_STATUS.ACTIVE) {
            targetIdx = i + 2;
            oldRowId = rows[i]['RowID'];
            if (!paketId && rows[i]['PaketID']) paketId = rows[i]['PaketID'];
            break;
          }
        }
      }

      // 2. Jika tidak ada targetRowId, cek apakah paket ini sudah pernah dicatat aktif
      if (targetIdx === -1) {
        for (var j = 0; j < rows.length; j++) {
          var r = rows[j];
          if (String(r['Status']) === ROW_STATUS.ACTIVE) {
            var matchPaketId = Boolean(paketId && String(r['PaketID']) === paketId);
            var matchNama = String(r['NamaPaket'] || '').toLowerCase() === namaPaket.toLowerCase() ||
                            String(r['PaketID'] || '').toLowerCase() === namaPaket.toLowerCase();
            if (matchPaketId || matchNama) {
              targetIdx = j + 2;
              oldRowId = r['RowID'];
              if (!paketId && r['PaketID']) paketId = r['PaketID'];
              break;
            }
          }
        }
      }

      // Jika belum memiliki PaketID, buat ID baru berurutan / terstandar
      if (!paketId) {
        paketId = 'PKT-' + ts.getFullYear() + '-' + Utilities.getUuid().substring(0, 5).toUpperCase();
      }

      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var colStatus = headers.indexOf('Status') + 1;

      // Jika baris sebelumnya ditemukan aktif, tandai sebagai SUPERSEDED
      if (targetIdx > 1 && colStatus > 0) {
        sheet.getRange(targetIdx, colStatus).setValue(ROW_STATUS.SUPERSEDED);
      }

      var newRow = {
        RowID: rowId,
        DivisiID: divisiId,
        Periode: periode,
        SubmittedBy: session.userId,
        Timestamp: ts,
        Status: ROW_STATUS.ACTIVE,
        SupersedesRowID: oldRowId,
        VoidReason: '',
        VoidedBy: '',
        VoidedAt: '',
        PaketID: paketId,
        NamaPaket: namaPaket,
        TahapPekerjaan: tahap,
        NomorKontrak: noKontrak,
        NilaiKontrak: _num(payload.nilaiKontrak),
        RekananPenyedia: rekanan,
        ProgresFisikPct: progresFisik,
        RealisasiKeuangan: _num(payload.realisasiKeuangan),
        KendalaKeterangan: String(payload.kendala || '').trim(),
        EvidenceUrl: String(payload.evidenceUrl || '').trim()
      };

      appendRowData(sheet, newRow);

      logAudit(session.userId, oldRowId ? 'UPDATE_PAKET_PROGRES' : 'SUBMIT_PAKET', 'TX_Paket_Progres', rowId, {
        oldRowId: oldRowId,
        paketId: paketId,
        tahap: tahap,
        namaPaket: namaPaket,
        progresFisik: progresFisik
      });

      return {
        success: true,
        message: oldRowId
          ? 'Status dan progres paket berhasil dimutakhirkan ke tahap ' + tahap + '.'
          : 'Progres paket baru berhasil disimpan.',
        rowId: rowId,
        isUpdate: Boolean(oldRowId)
      };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[tataUsaha_submitPaket] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Menganulir entri progres paket.
 * @param {string} token
 * @param {Object} params
 */
function tataUsaha_anulirPaket(token, params) {
  try {
    var session = _tuRequireSession(token);
    _tuAssertVoid(session);

    if (!params || (!params.rowId && !params.targetRowId)) throw new Error('RowID paket wajib diisi.');
    var rowIdTarget = String(params.rowId || params.targetRowId || '').trim();
    var alasan = String(params.alasan || params.voidReason || '').trim();
    if (!alasan) throw new Error('Alasan anulir wajib diisi.');

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);

    try {
      var sheet = openTuSheet(SHEET_TU.PAKET_PROGRES);
      var rows = sheetToObjects(sheet);
      var targetIdx = -1;

      for (var i = 0; i < rows.length; i++) {
        if (rows[i]['RowID'] === rowIdTarget && String(rows[i]['Status']) === ROW_STATUS.ACTIVE) {
          targetIdx = i + 2;
          break;
        }
      }

      if (targetIdx === -1) throw new Error('Data paket tidak ditemukan atau sudah tidak aktif.');

      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var colStatus = headers.indexOf('Status') + 1;
      var colReason = headers.indexOf('VoidReason') + 1;
      var colBy     = headers.indexOf('VoidedBy') + 1;
      var colAt     = headers.indexOf('VoidedAt') + 1;

      sheet.getRange(targetIdx, colStatus).setValue(ROW_STATUS.VOID);
      sheet.getRange(targetIdx, colReason).setValue(alasan);
      sheet.getRange(targetIdx, colBy).setValue(session.userId);
      sheet.getRange(targetIdx, colAt).setValue(new Date());

      logAudit(session.userId, 'ANULIR_PAKET', 'TX_Paket_Progres', rowIdTarget, {
        alasan: alasan
      });

      return { success: true, message: 'Progres paket berhasil dianulir.' };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[tataUsaha_anulirPaket] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ===========================================================================
// SUB-MODUL KEPEGAWAIAN, STANDAR KOMPETENSI (SKJ) & SERTIFIKASI AWAK KAPAL
// ===========================================================================

/**
 * Membaca data kepegawaian, kurikulum standar pelatihan, riwayat sertifikat,
 * dan kalkulasi analitik kesenjangan (HCDP / Training Gap) secara server-side.
 *
 * @param {string} token
 * @param {Object} [filter] - { search: string, rumpun: string, kelompokJabatan: string, unitKerja: string, lingkup: string }
 * @returns {{success:boolean, data:{
 *   pegawaiList: Array,
 *   standarByGroup: Object,
 *   kpi: Object,
 *   topTrainingGaps: Array,
 *   filters: { units: Array, kelompokJabatanList: Array, rumpunList: Array }
 * }}}
 */
/**
 * Helper internal: normalisasi nama kelompok jabatan agar cocok dengan katalog Master_Standar_Pelatihan.
 */
function _normalizeStandarGroupSikap(rawGroup) {
  var g = String(rawGroup || '').trim();
  if (!g) return '';
  var low = g.toLowerCase();
  if (low.indexOf('nakhoda') !== -1 || low.indexOf('nahkoda') !== -1) return 'Nahkoda';
  if (low.indexOf('mualim') !== -1) return 'Mualim';
  if (low.indexOf('kkm') !== -1 || low.indexOf('kepala kamar mesin') !== -1) return 'Kepala Kamar Mesin Kapal';
  if (low.indexOf('masinis') !== -1) return 'Masinis';
  if (low.indexOf('markonis') !== -1 || low.indexOf('operator radio') !== -1) return 'Markonis';
  if (low.indexOf('serang') !== -1) return 'Serang';
  if (low.indexOf('juru mudi') !== -1) return 'Juru Mudi';
  if (low.indexOf('kelasi') !== -1) return 'Kelasi Kapal';
  if (low.indexOf('juru minyak') !== -1 || low.indexOf('oiler') !== -1) return 'Juru Minyak';
  if (low.indexOf('juru masak') !== -1 || low.indexOf('koki') !== -1) return 'Juru Masak';
  return g;
}

/**
 * Helper internal: menyimpulkan StatusPenempatan (PUSAT_POA vs DIPERBANTUKAN_UPT).
 */
function _inferStatusPenempatanSikap(unitKerja, rawStatusPenempatan) {
  var st = String(rawStatusPenempatan || '').toUpperCase().trim();
  if (st === 'PUSAT_POA' || st === 'DIPERBANTUKAN_UPT') return st;
  var u = String(unitKerja || '').toLowerCase();
  if (u.indexOf('diperbantukan') !== -1 || u.indexOf('pangkalan') !== -1 ||
      u.indexOf('stasiun') !== -1 || u.indexOf('upt') !== -1) {
    return 'DIPERBANTUKAN_UPT';
  }
  return 'PUSAT_POA';
}

/**
 * Helper internal: menentukan rumpun SDM berdasarkan status kepegawaian, lingkup, & kelompok jabatan.
 */
function _resolveKategoriRumpunSikap(statusPeg, kelompokJabatan, lingkup, rawRumpun) {
  var r = String(rawRumpun || '').toUpperCase().trim();
  if (r === 'AWAK_DEK' || r === 'AWAK_MESIN' || r === 'PENUNJANG' || r === 'PENGAWAS' || r === 'MANAJEMEN') {
    return r;
  }
  if (statusPeg === 'MAGANG') return 'MAGANG';
  var kLower = String(kelompokJabatan || '').toLowerCase();
  if (kLower.indexOf('juru masak') !== -1 || kLower.indexOf('koki') !== -1) {
    return 'PENUNJANG';
  }
  if (kLower.indexOf('kamar mesin') !== -1 || kLower.indexOf('kkm') !== -1 ||
      kLower.indexOf('masinis') !== -1 || kLower.indexOf('minyak') !== -1 ||
      kLower.indexOf('oiler') !== -1 || kLower.indexOf('juru mesin') !== -1) {
    return 'AWAK_MESIN';
  }
  if (kLower.indexOf('nakhoda') !== -1 || kLower.indexOf('nahkoda') !== -1 ||
      kLower.indexOf('mualim') !== -1 || kLower.indexOf('markonis') !== -1 ||
      kLower.indexOf('radio') !== -1 || kLower.indexOf('serang') !== -1 ||
      kLower.indexOf('juru mudi') !== -1 || kLower.indexOf('kelasi') !== -1) {
    return 'AWAK_DEK';
  }
  if (kLower.indexOf('pengawas') !== -1) return 'PENGAWAS';
  if (statusPeg === 'PJLP' && String(lingkup || '').toUpperCase() !== 'AWAK_KAPAL_ARMADA') {
    return 'PJLP';
  }
  return 'MANAJEMEN';
}

var _SIKAP_DUPLICATE_SEED_IDS = {
  'PEG-0044': true,
  'PEG-0123': true,
  'PEG-0300': true,
  'PEG-0362': true
};

function _buildSikapSeedRowObj(peg, nowStr) {
  var rawNip = String(peg.nip || '').trim();
  var isP3k = /^\d{12}21\d{4}$/.test(rawNip);
  var sPeg = peg.statusKepegawaian || (isP3k ? 'P3K' : ((peg.unit === 'Dit. POA' || peg.lingkup === 'DIT_POA') ? 'PNS' : (rawNip && rawNip !== '-' ? 'PNS' : 'NON_ASN')));
  if (sPeg === 'PPPK_FUNGSIONAL' || sPeg === 'PPPK_PELAKSANA') sPeg = 'P3K';
  if (sPeg === 'PPPK_PARUH_WAKTU') sPeg = 'P3K_PARUH_WAKTU';
  var cleanNama = typeof sanitizeNamaPersonel === 'function' ? sanitizeNamaPersonel(peg.nama) : String(peg.nama || '').toUpperCase().trim();
  return {
    PegawaiID: String(peg.pegawaiId || ''),
    NIP: (sPeg === 'PJLP' || sPeg === 'MAGANG' || rawNip === '-') ? '' : rawNip,
    Nama: cleanNama,
    UnitKerja: String(peg.unit || ''),
    LingkupData: String(peg.lingkup || ''),
    KelompokJabatan: String(peg.kelompokJabatan || ''),
    JabatanLengkap: String(peg.jabatanLengkap || ''),
    TingkatKelas: String(peg.tingkatKelas || 'NON_JENJANG'),
    KategoriRumpun: String(peg.rumpun || 'MANAJEMEN'),
    StatusKepegawaian: sPeg,
    StatusAktif: String(peg.statusAktif || 'AKTIF'),
    SubJenisSDM: String(peg.subJenisSDM || ''),
    NomorIdentitas: String(peg.nomorIdentitas || ''),
    InstitusiAsal: String(peg.institusiAsal || ''),
    TanggalMulai: String(peg.tanggalMulai || ''),
    TanggalSelesai: String(peg.tanggalSelesai || ''),
    MentorPembimbing: String(peg.mentorPembimbing || ''),
    CatatanTambahan: String(peg.catatanTambahan || ''),
    DokumenSK_URL: String(peg.dokumenSkUrl || ''),
    DokumenSK_EvidenceID: String(peg.dokumenSkEvidenceId || ''),
    StatusPenempatan: peg.statusPenempatan || _inferStatusPenempatanSikap(peg.unit, ''),
    KapalPenempatan: String(peg.kapalPenempatan || ''),
    UkuranBaju: String(peg.ukuranBaju || ''),
    UkuranSepatu: String(peg.ukuranSepatu || ''),
    SumberSinkronisasi: 'MANUAL_TU',
    StatusKelengkapanTU: 'LENGKAP',
    CatatanDisparitas: '',
    UpdatedAt: nowStr,
    UpdatedBy: 'SYSTEM_SEED_SKP'
  };
}

/**
 * Helper internal (idempoten): self-healing kolom baru, perbaikan record korup,
 * rekonsiliasi seed SKP terbaru, nama kanonik HURUF BESAR, kategori P3K, dan append personel baru.
 */
function _healMasterPegawaiNamaAndSchemaOnce(pSheet) {
  try {
    if (!pSheet) return;
    if (typeof ensurePegawaiMasterColumns === 'function') {
      ensurePegawaiMasterColumns();
    }

    var props = PropertiesService.getScriptProperties();
    var healFlag = props ? props.getProperty('SIKAP_MASTER_PEGAWAI_CANON_V2_SKP') : '';
    if (healFlag === 'DONE') return;

    var seedList = (typeof SEED_PEGAWAI_POA_AWAK !== 'undefined' && Array.isArray(SEED_PEGAWAI_POA_AWAK))
      ? SEED_PEGAWAI_POA_AWAK : [];
    var seedById = {};
    for (var sIdx = 0; sIdx < seedList.length; sIdx++) {
      if (seedList[sIdx].pegawaiId) seedById[String(seedList[sIdx].pegawaiId)] = seedList[sIdx];
    }

    var existingIdSet = {};
    var existingNipSet = {};
    var lastRow = pSheet.getLastRow();
    var lastCol = pSheet.getLastColumn();
    var headers = lastCol >= 1 ? pSheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];

    if (lastRow >= 2 && lastCol >= 1) {
      var col = {};
      for (var h = 0; h < headers.length; h++) {
        col[String(headers[h])] = h;
      }

      var vals = pSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
      var dirty = false;

      for (var r = 0; r < vals.length; r++) {
        var row = vals[r];
        var pId = col.PegawaiID >= 0 ? String(row[col.PegawaiID] || '').trim() : '';

        // 1. Perbaiki Nama <-> NIP yang tertukar (mis. PEG-0163, PEG-0164)
        if (col.Nama >= 0 && col.NIP >= 0) {
          var rawNmPre = String(row[col.Nama] || '').trim();
          var rawNpPre = String(row[col.NIP] || '').trim();
          if (/^\d{10,}$/.test(rawNmPre) && rawNpPre && !/^\d+$/.test(rawNpPre)) {
            row[col.NIP] = rawNmPre;
            row[col.Nama] = rawNpPre;
            dirty = true;
          }
        }

        // 2. Perbaiki NIP 18 digit yang tergeser ke JabatanLengkap (mis. PEG-0460..0469)
        if (col.JabatanLengkap >= 0) {
          var rawJab = String(row[col.JabatanLengkap] || '').trim();
          if (/^\d{18}$/.test(rawJab)) {
            if (col.NIP >= 0 && (!String(row[col.NIP] || '').replace(/[^0-9]/g, '') || pId === 'PEG-0465')) {
              row[col.NIP] = rawJab;
            }
            row[col.JabatanLengkap] = 'Pengelola Layanan Operasional';
            dirty = true;
          }
        }

        if (col.Nama >= 0) {
          var rawNm = String(row[col.Nama] || '');
          var cleanNm = typeof sanitizeNamaPersonel === 'function' ? sanitizeNamaPersonel(rawNm) : rawNm.toUpperCase().trim();
          if (cleanNm && cleanNm !== rawNm) {
            row[col.Nama] = cleanNm;
            dirty = true;
          }
        }

        var curSt = col.StatusKepegawaian >= 0 ? String(row[col.StatusKepegawaian] || '').toUpperCase().trim() : '';
        if (col.StatusKepegawaian >= 0) {
          if (curSt === 'PPPK_FUNGSIONAL' || curSt === 'PPPK_PELAKSANA') {
            row[col.StatusKepegawaian] = 'P3K';
            curSt = 'P3K';
            dirty = true;
          } else if (curSt === 'PPPK_PARUH_WAKTU') {
            row[col.StatusKepegawaian] = 'P3K_PARUH_WAKTU';
            curSt = 'P3K_PARUH_WAKTU';
            dirty = true;
          }
        }

        if (col.NIP >= 0) {
          var nipRaw = String(row[col.NIP] || '').trim();
          if (nipRaw === '-' || ((curSt === 'PJLP' || curSt === 'MAGANG') && nipRaw !== '')) {
            row[col.NIP] = '';
            dirty = true;
          }
        }

        // 3. Rekonsiliasi terhadap seed SKP terbaru
        if (pId && _SIKAP_DUPLICATE_SEED_IDS[pId]) {
          if (col.StatusAktif >= 0 && String(row[col.StatusAktif] || '').toUpperCase().trim() !== 'NON_AKTIF') {
            row[col.StatusAktif] = 'NON_AKTIF';
            dirty = true;
          }
        } else if (pId && seedById[pId]) {
          var seed = seedById[pId];
          var seedNip = String(seed.nip || '').trim() === '-' ? '' : String(seed.nip || '').trim();
          var curNipClean = col.NIP >= 0 ? String(row[col.NIP] || '').replace(/[^0-9]/g, '') : '';
          if (col.NIP >= 0 && /^\d{18}$/.test(seedNip) && (!curNipClean || pId === 'PEG-0465')) {
            if (String(row[col.NIP] || '').trim() !== seedNip) {
              row[col.NIP] = seedNip;
              dirty = true;
            }
          }
          var cleanSeedNama = typeof sanitizeNamaPersonel === 'function' ? sanitizeNamaPersonel(seed.nama) : String(seed.nama || '').toUpperCase().trim();
          var seedStatus = seed.statusKepegawaian || (/^\d{12}21\d{4}$/.test(seedNip || curNipClean) ? 'P3K' : 'PNS');
          var syncFields = [
            ['Nama', cleanSeedNama],
            ['UnitKerja', seed.unit],
            ['LingkupData', seed.lingkup],
            ['KelompokJabatan', seed.kelompokJabatan],
            ['JabatanLengkap', seed.jabatanLengkap],
            ['TingkatKelas', seed.tingkatKelas],
            ['KategoriRumpun', seed.rumpun],
            ['StatusKepegawaian', seedStatus]
          ];
          var unitChanged = false;
          for (var sf = 0; sf < syncFields.length; sf++) {
            var fKey = syncFields[sf][0];
            var fVal = syncFields[sf][1];
            var fIdx = col[fKey];
            if (fIdx >= 0 && fVal !== undefined && fVal !== '' && String(row[fIdx] || '') !== String(fVal)) {
              row[fIdx] = fVal;
              if (fKey === 'UnitKerja') unitChanged = true;
              dirty = true;
            }
          }
          if (col.KapalPenempatan >= 0 && seed.kapalPenempatan && !String(row[col.KapalPenempatan] || '').trim()) {
            row[col.KapalPenempatan] = seed.kapalPenempatan;
            dirty = true;
          }
          if (col.StatusPenempatan >= 0 && (unitChanged || !String(row[col.StatusPenempatan] || '').trim())) {
            var newStPen = _inferStatusPenempatanSikap(col.UnitKerja >= 0 ? row[col.UnitKerja] : '', '');
            if (String(row[col.StatusPenempatan] || '').trim() !== newStPen) {
              row[col.StatusPenempatan] = newStPen;
              dirty = true;
            }
          }
        }

        if (col.StatusPenempatan >= 0 && !String(row[col.StatusPenempatan] || '').trim()) {
          row[col.StatusPenempatan] = _inferStatusPenempatanSikap(col.UnitKerja >= 0 ? row[col.UnitKerja] : '', '');
          dirty = true;
        }
        if (col.SumberSinkronisasi >= 0 && !String(row[col.SumberSinkronisasi] || '').trim()) {
          row[col.SumberSinkronisasi] = 'MANUAL_TU';
          dirty = true;
        }
        if (col.StatusKelengkapanTU >= 0 && !String(row[col.StatusKelengkapanTU] || '').trim()) {
          row[col.StatusKelengkapanTU] = 'LENGKAP';
          dirty = true;
        }
        if (col.KategoriRumpun >= 0 && col.KelompokJabatan >= 0 && String(row[col.KelompokJabatan] || '').toLowerCase().indexOf('juru masak') !== -1) {
          if (String(row[col.KategoriRumpun] || '').toUpperCase() !== 'PENUNJANG') {
            row[col.KategoriRumpun] = 'PENUNJANG';
            dirty = true;
          }
        }

        if (pId) existingIdSet[pId] = true;
        var finalNip = col.NIP >= 0 ? String(row[col.NIP] || '').replace(/[^0-9]/g, '') : '';
        if (/^\d{18}$/.test(finalNip)) existingNipSet[finalNip] = true;
      }

      if (dirty) {
        pSheet.getRange(2, 1, lastRow - 1, lastCol).setValues(vals);
      }

      // 4. Append personel baru dari SEED_PEGAWAI_POA_AWAK yang belum ada di sheet
      if (seedList.length > 0 && lastCol >= 1) {
        var nowAppendStr = new Date().toISOString();
        var toAppend = [];
        for (var a = 0; a < seedList.length; a++) {
          var peg = seedList[a];
          var sPid = String(peg.pegawaiId || '').trim();
          var sNipClean = String(peg.nip || '').replace(/[^0-9]/g, '');
          if ((sPid && existingIdSet[sPid]) || (/^\d{18}$/.test(sNipClean) && existingNipSet[sNipClean])) continue;
          var obj = _buildSikapSeedRowObj(peg, nowAppendStr);
          toAppend.push(headers.map(function (hdr) {
            return obj[hdr] !== undefined ? obj[hdr] : '';
          }));
        }
        if (toAppend.length > 0) {
          pSheet.getRange(lastRow + 1, 1, toAppend.length, lastCol).setValues(toAppend);
        }
      }
    }

    if (typeof applyFormalSheetFormatting === 'function') {
      applyFormalSheetFormatting(pSheet, SHEET_TU.PEGAWAI_MASTER);
    }
    if (props) props.setProperty('SIKAP_MASTER_PEGAWAI_CANON_V2_SKP', 'DONE');
  } catch (eHeal) {
    Logger.log('[_healMasterPegawaiNamaAndSchemaOnce] Notice: ' + eHeal.message);
  }
}

function tataUsaha_getKompetensi(token, filter) {
  try {
    var session = _tuRequireSession(token);
    _tuAssertRead(session);

    // Pastikan data awal ter-seed jika sheet masih kosong
    if (typeof ensurePegawaiPelatihanSeeded === 'function') {
      try { ensurePegawaiPelatihanSeeded(); } catch (eSeed) {
        Logger.log('[tataUsaha_getKompetensi] seed notice: ' + eSeed.message);
      }
    }

    var pSheet = openTuSheet(SHEET_TU.PEGAWAI_MASTER);
    _healMasterPegawaiNamaAndSchemaOnce(pSheet);

    var sSheet = openTuSheet(SHEET_TU.STANDAR_PELATIHAN);
    var tSheet = openTuSheet(SHEET_TU.PELATIHAN_PEGAWAI);

    var pRows = sheetToObjects(pSheet);
    var sRows = sheetToObjects(sSheet);
    var tRows = sheetToObjects(tSheet);

    // 1. Petakan standar pelatihan per KelompokJabatan
    var standarByGroup = {};
    for (var s = 0; s < sRows.length; s++) {
      var itm = sRows[s];
      var grp = String(itm['KelompokJabatan'] || '').trim();
      if (!grp) continue;
      if (!standarByGroup[grp]) standarByGroup[grp] = [];
      standarByGroup[grp].push({
        kode: String(itm['KodePelatihan'] || ''),
        kelompok: grp,
        tingkat: String(itm['TingkatKelas'] || 'ALL'),
        kategori: String(itm['Kategori'] || 'TEKNIS'),
        nama: String(itm['NamaPelatihan'] || ''),
        wajib: String(itm['Wajib']).toLowerCase() === 'true' || itm['Wajib'] === true,
        urutan: _num(itm['Urutan']) || (standarByGroup[grp].length + 1)
      });
    }

    for (var g in standarByGroup) {
      standarByGroup[g].sort(function (a, b) { return a.urutan - b.urutan; });
    }

    // 2. Petakan riwayat pelatihan per PegawaiID
    var certByPegawai = {};
    var totalEvidenceFiles = 0;
    for (var t = 0; t < tRows.length; t++) {
      var cert = tRows[t];
      var pid = String(cert['PegawaiID'] || '').trim();
      var kode = String(cert['KodePelatihan'] || '').trim();
      if (!pid || !kode) continue;
      if (!certByPegawai[pid]) certByPegawai[pid] = {};

      var hasFile = !!(cert['FileEvidenceURL'] || cert['FileEvidenceID']);
      if (hasFile) totalEvidenceFiles++;

      certByPegawai[pid][kode] = {
        recordId: String(cert['RecordID'] || ''),
        kode: kode,
        nama: String(cert['NamaPelatihan'] || ''),
        status: String(cert['StatusKelulusan'] || 'BELUM'),
        nomorSertifikat: String(cert['NomorSertifikat'] || ''),
        tahun: _num(cert['TahunPelatihan']) || null,
        berlakuSampai: cert['BerlakuSampai'] ? String(cert['BerlakuSampai']).substring(0, 10) : '',
        fileEvidenceId: String(cert['FileEvidenceID'] || ''),
        fileEvidenceUrl: String(cert['FileEvidenceURL'] || ''),
        updatedAt: cert['UpdatedAt'] ? new Date(cert['UpdatedAt']).toISOString() : null,
        updatedBy: String(cert['UpdatedBy'] || '')
      };
    }

    // 3. Bangun daftar pegawai, deteksi disparitas NAKHODA, dan hitung metrik server-side
    var fSearch = filter && filter.search ? String(filter.search).toLowerCase().trim() : '';
    var fRumpun = filter && filter.rumpun ? String(filter.rumpun).trim() : '';
    var fGroup = filter && filter.kelompokJabatan ? String(filter.kelompokJabatan).trim() : '';
    var fUnit = filter && filter.unitKerja ? String(filter.unitKerja).trim() : '';
    var fLingkup = filter && filter.lingkup ? String(filter.lingkup).trim() : '';
    var fPenempatan = filter && filter.statusPenempatan ? String(filter.statusPenempatan).toUpperCase().trim() : '';
    var fDisparitasOnly = !!(filter && filter.hanyaDisparitas);

    var pMode = filter && (filter.periodeMode || filter.mode) ? String(filter.periodeMode || filter.mode).toUpperCase().trim() : 'ALL';
    var hasPeriodeFilter = pMode !== '' && pMode !== 'ALL' && pMode !== 'MONTHLY' && (pMode === 'CUSTOM' || /^TW[1-4]$/.test(pMode) || /^SEM[12]$/.test(pMode));
    var periodeWin = (hasPeriodeFilter && typeof resolvePeriodeWindow === 'function')
      ? resolvePeriodeWindow({
          periodeMode: pMode,
          tahun: filter.tahun,
          startDate: filter.startDate,
          endDate: filter.endDate
        })
      : null;

    var pegawaiList = [];
    var disparitasList = [];
    var unitSet = {};
    var groupSet = {};
    var rumpunSet = {};

    var totalLulusGlobal = 0;
    var totalStandarGlobal = 0;
    var gapCounter = {};

    var countDitPoa = 0;
    var countAwakArmada = 0;
    var countAwakDek = 0;
    var countAwakMesin = 0;
    var countAwakPenunjang = 0;
    var todayStr = new Date().toISOString().slice(0, 10);

    for (var p = 0; p < pRows.length; p++) {
      var peg = pRows[p];
      var pid = String(peg['PegawaiID'] || '').trim();
      if (!pid) continue;

      var statusAktif = String(peg['StatusAktif'] || 'AKTIF').trim().toUpperCase();
      var statusPeg = String(peg['StatusKepegawaian'] || '').trim().toUpperCase();
      if (statusPeg === 'PPPK_FUNGSIONAL' || statusPeg === 'PPPK_PELAKSANA') statusPeg = 'P3K';
      if (statusPeg === 'PPPK_PARUH_WAKTU') statusPeg = 'P3K_PARUH_WAKTU';

      if (statusAktif === 'MAGANG' || statusAktif === 'PJLP' || statusAktif === 'P3K' || statusAktif === 'P3K_PARUH_WAKTU') {
        if (!statusPeg || statusPeg === 'PNS' || statusPeg === 'NON_ASN') {
          statusPeg = statusAktif;
        }
        statusAktif = 'AKTIF';
      }

      if (statusAktif === 'NON_AKTIF' && (!filter || !filter.includeNonAktif)) continue;

      var rawNama = String(peg['Nama'] || '').trim();
      var nama = typeof sanitizeNamaPersonel === 'function' ? sanitizeNamaPersonel(rawNama) : rawNama.toUpperCase();
      var rawNip = String(peg['NIP'] || '').trim();
      var nip = (statusPeg === 'PJLP' || statusPeg === 'MAGANG' || rawNip === '-') ? '' : rawNip;
      var unit = String(peg['UnitKerja'] || '').trim();
      var uLow = unit.toLowerCase();
      if (uLow === 'dit. poa' || uLow === 'dit poa' || uLow.indexOf('pengendalian operasi armada') !== -1 || (uLow.indexOf('poa') !== -1 && uLow.indexOf('armada') === -1 && uLow.indexOf('diperbantukan') === -1)) {
        unit = 'Dit. POA';
      }

      var grp = String(peg['KelompokJabatan'] || '').trim();
      var jabatan = String(peg['JabatanLengkap'] || '').trim();
      var tingkat = String(peg['TingkatKelas'] || 'NON_JENJANG').trim();
      var lingkup = String(peg['LingkupData'] || '').trim();
      if (!lingkup) {
        lingkup = (unit === 'Dit. POA') ? 'DIT_POA' : 'AWAK_KAPAL_ARMADA';
      }
      var cleanNipKomp = String(nip || '').replace(/[^0-9]/g, '');
      if (/^\d{12}21\d{4}$/.test(cleanNipKomp) && (!statusPeg || statusPeg === 'PNS' || statusPeg === 'NON_ASN')) {
        statusPeg = 'P3K';
      }
      if (!statusPeg) {
        statusPeg = (unit === 'Dit. POA') ? 'PNS' : (nip ? 'PNS' : 'PJLP');
      }
      var rumpun = _resolveKategoriRumpunSikap(statusPeg, grp || jabatan, lingkup, peg['KategoriRumpun']);

      var subJenis = String(peg['SubJenisSDM'] || '').trim();
      var noIdentitas = String(peg['NomorIdentitas'] || '').trim();
      var asalKampus = String(peg['InstitusiAsal'] || '').trim();
      var tglMulai = peg['TanggalMulai'] ? String(peg['TanggalMulai']).trim().substring(0, 10) : '';
      var tglSelesai = peg['TanggalSelesai'] ? String(peg['TanggalSelesai']).trim().substring(0, 10) : '';
      var mentor = String(peg['MentorPembimbing'] || '').trim();
      var catatan = String(peg['CatatanTambahan'] || '').trim();
      var docSkUrl = String(peg['DokumenSK_URL'] || '').trim();
      var docSkEvId = String(peg['DokumenSK_EvidenceID'] || '').trim();

      var statusPenempatan = _inferStatusPenempatanSikap(unit, peg['StatusPenempatan']);
      var kapalPenempatan = String(peg['KapalPenempatan'] || '').trim();
      var ukuranBaju = String(peg['UkuranBaju'] || '').trim().toUpperCase();
      var ukuranSepatu = String(peg['UkuranSepatu'] || '').trim();
      var sumberSinkronisasi = String(peg['SumberSinkronisasi'] || 'MANUAL_TU').trim().toUpperCase();
      var statusKelengkapanTU = String(peg['StatusKelengkapanTU'] || 'LENGKAP').trim().toUpperCase();
      var catatanDisparitas = String(peg['CatatanDisparitas'] || '').trim();

      var stdGroupKey = _normalizeStandarGroupSikap(grp);
      var isAwakPersonel = (rumpun === 'AWAK_DEK' || rumpun === 'AWAK_MESIN' || rumpun === 'PENUNJANG' || lingkup === 'AWAK_KAPAL_ARMADA');
      var isNonSkj = (statusPeg === 'MAGANG') || (statusPeg === 'PJLP' && !isAwakPersonel);

      var isExpired = tglSelesai && tglSelesai < todayStr;
      var statusDisplay = statusAktif;
      if (statusAktif === 'AKTIF' && statusPeg === 'MAGANG' && isExpired) {
        statusDisplay = 'SELESAI';
      }

      if (unit) unitSet[unit] = true;
      if (grp) groupSet[grp] = true;
      if (rumpun) rumpunSet[rumpun] = true;

      if (statusAktif === 'AKTIF') {
        if (isAwakPersonel) {
          countAwakArmada++;
          if (rumpun === 'AWAK_DEK') countAwakDek++;
          else if (rumpun === 'AWAK_MESIN') countAwakMesin++;
          else if (rumpun === 'PENUNJANG') countAwakPenunjang++;
        } else if (unit === 'Dit. POA') {
          countDitPoa++;
        }

        if (statusKelengkapanTU === 'DISPARITAS_NAKHODA') {
          disparitasList.push({
            pegawaiId: pid,
            nama: nama,
            kelompokJabatan: grp,
            tingkatKelas: tingkat,
            kapalPenempatan: kapalPenempatan,
            statusPenempatan: statusPenempatan,
            catatanDisparitas: catatanDisparitas || 'Data baru/diperbarui dari NAKHODA, perlu verifikasi Jabatan Lengkap TU.'
          });
        }
      }

      // Filter periode TW / Semester / Rentang Kalender
      if (periodeWin && (periodeWin.startDateStr || periodeWin.endDateStr)) {
        var winStart = periodeWin.startDateStr;
        var winEnd = periodeWin.endDateStr;
        if (tglMulai && winEnd && tglMulai > winEnd) continue;
        if (tglSelesai && winStart && tglSelesai < winStart) continue;
      }

      var standards = isNonSkj ? [] : (standarByGroup[stdGroupKey] || standarByGroup[grp] || []);
      var pCerts = certByPegawai[pid] || {};

      var totalStandar = standards.length;
      var totalLulus = 0;
      var totalEvidence = 0;

      if (!isNonSkj) {
        for (var sIdx = 0; sIdx < standards.length; sIdx++) {
          var st = standards[sIdx];
          var cData = pCerts[st.kode];
          var isLulus = cData && (cData.status === 'SUDAH_LULUS' || cData.status === 'LULUS');
          if (isLulus) {
            totalLulus++;
            if (cData.fileEvidenceUrl || cData.fileEvidenceId) totalEvidence++;
          }

          if (!gapCounter[st.kode]) {
            gapCounter[st.kode] = {
              kode: st.kode,
              nama: st.nama,
              kelompok: stdGroupKey || grp,
              kategori: st.kategori,
              wajib: st.wajib,
              gapCount: 0,
              lulusCount: 0,
              targetCount: 0
            };
          }
          gapCounter[st.kode].targetCount++;
          if (isLulus) gapCounter[st.kode].lulusCount++;
          else gapCounter[st.kode].gapCount++;
        }

        totalStandarGlobal += totalStandar;
        totalLulusGlobal += totalLulus;
      }

      var pctKompetensi = totalStandar > 0 ? Math.round((totalLulus / totalStandar) * 100) : (isNonSkj ? null : 0);
      var statusGap = isNonSkj ? 'NON_SKJ' : (pctKompetensi === 100 ? 'LENGKAP' : (pctKompetensi > 0 ? 'PARSIAL' : 'BELUM'));

      var pass = true;
      if (fSearch) {
        var haystack = (nama + ' ' + nip + ' ' + jabatan + ' ' + unit + ' ' + grp + ' ' + kapalPenempatan + ' ' + asalKampus + ' ' + subJenis).toLowerCase();
        if (haystack.indexOf(fSearch) === -1) pass = false;
      }
      if (pass && fRumpun && rumpun !== fRumpun) pass = false;
      if (pass && fGroup && grp !== fGroup) pass = false;
      if (pass && fUnit && unit !== fUnit) pass = false;
      if (pass && fLingkup && lingkup !== fLingkup) pass = false;
      if (pass && fPenempatan && statusPenempatan !== fPenempatan) pass = false;
      if (pass && fDisparitasOnly && statusKelengkapanTU !== 'DISPARITAS_NAKHODA') pass = false;

      if (pass) {
        pegawaiList.push({
          pegawaiId: pid,
          nip: nip,
          nama: nama,
          unitKerja: unit,
          lingkupData: lingkup,
          kelompokJabatan: grp,
          jabatanLengkap: jabatan || grp,
          tingkatKelas: tingkat,
          rumpun: rumpun,
          statusKepegawaian: statusPeg,
          statusAktif: statusAktif,
          statusDisplay: statusDisplay,
          subJenisSDM: subJenis,
          nomorIdentitas: noIdentitas,
          institusiAsal: asalKampus,
          tanggalMulai: tglMulai,
          tanggalSelesai: tglSelesai,
          mentorPembimbing: mentor,
          catatanTambahan: catatan,
          isExpired: isExpired,
          isNonSkj: isNonSkj,
          dokumenSkUrl: docSkUrl,
          dokumenSkEvidenceId: docSkEvId,
          statusPenempatan: statusPenempatan,
          kapalPenempatan: kapalPenempatan,
          ukuranBaju: ukuranBaju,
          ukuranSepatu: ukuranSepatu,
          sumberSinkronisasi: sumberSinkronisasi,
          statusKelengkapanTU: statusKelengkapanTU,
          catatanDisparitas: catatanDisparitas,
          totalStandar: totalStandar,
          totalLulus: totalLulus,
          totalEvidence: totalEvidence,
          pctKompetensi: pctKompetensi,
          statusGap: statusGap,
          certifications: pCerts
        });
      }
    }

    pegawaiList.sort(function (a, b) {
      if (a.statusKelengkapanTU !== b.statusKelengkapanTU) {
        return a.statusKelengkapanTU === 'DISPARITAS_NAKHODA' ? -1 : 1;
      }
      if (a.lingkupData !== b.lingkupData) {
        return a.lingkupData === 'DIT_POA' ? -1 : 1;
      }
      return a.nama.localeCompare(b.nama);
    });

    var topGaps = [];
    for (var k in gapCounter) {
      if (gapCounter.hasOwnProperty(k)) {
        var gItem = gapCounter[k];
        if (gItem.targetCount > 0) {
          gItem.pctGap = Math.round((gItem.gapCount / gItem.targetCount) * 100);
          topGaps.push(gItem);
        }
      }
    }
    topGaps.sort(function (a, b) {
      if (a.wajib !== b.wajib) return a.wajib ? -1 : 1;
      return b.gapCount - a.gapCount;
    });

    var avgPct = totalStandarGlobal > 0 ? Math.round((totalLulusGlobal / totalStandarGlobal) * 1000) / 10 : 0;

    return {
      success: true,
      data: {
        pegawaiList: pegawaiList,
        standarByGroup: standarByGroup,
        disparitasCount: disparitasList.length,
        disparitasList: disparitasList,
        periodeLabel: periodeWin ? periodeWin.label : 'Semua Periode',
        kpi: {
          totalPersonel: pRows.length,
          totalDitPoa: countDitPoa,
          totalAwakArmada: countAwakArmada,
          totalAwakDek: countAwakDek,
          totalAwakMesin: countAwakMesin,
          totalAwakPenunjang: countAwakPenunjang,
          avgKompetensiPct: avgPct,
          totalEvidenceFiles: totalEvidenceFiles,
          totalTrainingNeeds: topGaps.length,
          disparitasCount: disparitasList.length
        },
        topTrainingGaps: topGaps.slice(0, 10),
        filters: {
          units: Object.keys(unitSet).sort(),
          kelompokJabatanList: Object.keys(groupSet).sort(),
          rumpunList: Object.keys(rumpunSet).sort()
        }
      }
    };
  } catch (e) {
    Logger.log('[tataUsaha_getKompetensi] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Menyimpan atau memperbarui data sertifikat pelatihan pegawai beserta file bukti (Evidence).
 *
 * @param {string} token
 * @param {{
 *   pegawaiId: string,
 *   kodePelatihan: string,
 *   namaPelatihan?: string,
 *   statusKelulusan: string,
 *   nomorSertifikat?: string,
 *   tahunPelatihan?: number,
 *   berlakuSampai?: string,
 *   fileBase64?: string,
 *   fileName?: string,
 *   mimeType?: string
 * }} params
 */
function tataUsaha_saveSertifikat(token, params) {
  try {
    var session = _tuRequireSession(token);
    _tuAssertSubmit(session);

    if (!params || !params.pegawaiId) throw new Error('ID Pegawai wajib diisi.');
    if (!params.kodePelatihan) throw new Error('Kode Pelatihan wajib diisi.');

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);

    try {
      var pSheet = openTuSheet(SHEET_TU.PEGAWAI_MASTER);
      var pFound = findRowById(pSheet, params.pegawaiId);
      if (!pFound) throw new Error('Pegawai dengan ID ' + params.pegawaiId + ' tidak ditemukan.');
      var peg = pFound.obj;

      var tSheet = openTuSheet(SHEET_TU.PELATIHAN_PEGAWAI);
      var tRows = sheetToObjects(tSheet);

      var existingIdx = -1;
      var existingRow = null;
      for (var i = 0; i < tRows.length; i++) {
        if (String(tRows[i]['PegawaiID']) === String(params.pegawaiId) &&
            String(tRows[i]['KodePelatihan']) === String(params.kodePelatihan)) {
          existingIdx = i + 2; // header is row 1
          existingRow = tRows[i];
          break;
        }
      }

      var recordId = existingRow ? String(existingRow['RecordID']) : ('CERT-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd-HHmmss') + '-' + Math.floor(100 + Math.random() * 900));

      var evidenceId = existingRow ? String(existingRow['FileEvidenceID'] || '') : '';
      var evidenceUrl = existingRow ? String(existingRow['FileEvidenceURL'] || '') : '';

      // Upload file jika ada
      if (params.fileBase64 && params.fileName) {
        var uploadRes = evidence_upload(token, {
          refSheet: SHEET_TU.PELATIHAN_PEGAWAI,
          refRowId: recordId,
          fileName: params.fileName,
          mimeType: params.mimeType || 'application/pdf',
          dataBase64: params.fileBase64
        });
        if (!uploadRes.success) throw new Error('Gagal mengunggah sertifikat: ' + uploadRes.error);
        evidenceId = uploadRes.driveFileId;
        evidenceUrl = uploadRes.url || uploadRes.viewUrl;
      }

      var status = String(params.statusKelulusan || 'SUDAH_LULUS').toUpperCase();
      var noSert = String(params.nomorSertifikat || '').trim();
      var currentYr = new Date().getFullYear();
      var tahun = params.tahunPelatihan ? Math.round(_num(params.tahunPelatihan)) : currentYr;
      if (tahun < 1980 || tahun > currentYr + 1) {
        throw new Error('Tahun pelatihan harus berada pada rentang wajar (1980 s/d ' + (currentYr + 1) + ').');
      }
      var expDate = String(params.berlakuSampai || '').trim();
      if (expDate && parseInt(expDate.substring(0, 4), 10) < tahun) {
        throw new Error('Tanggal berlaku sertifikat tidak boleh lebih awal dari tahun pelatihan.');
      }
      var namaPel = String(params.namaPelatihan || '').trim();
      var nowStr = new Date().toISOString();

      if (existingIdx !== -1) {
        // Update existing row
        var headers = tSheet.getRange(1, 1, 1, tSheet.getLastColumn()).getValues()[0];
        var colStatus = headers.indexOf('StatusKelulusan') + 1;
        var colNo = headers.indexOf('NomorSertifikat') + 1;
        var colThn = headers.indexOf('TahunPelatihan') + 1;
        var colExp = headers.indexOf('BerlakuSampai') + 1;
        var colEvId = headers.indexOf('FileEvidenceID') + 1;
        var colEvUrl = headers.indexOf('FileEvidenceURL') + 1;
        var colUpAt = headers.indexOf('UpdatedAt') + 1;
        var colUpBy = headers.indexOf('UpdatedBy') + 1;

        if (colStatus > 0) tSheet.getRange(existingIdx, colStatus).setValue(status);
        if (colNo > 0 && noSert) tSheet.getRange(existingIdx, colNo).setValue(noSert);
        if (colThn > 0 && tahun) tSheet.getRange(existingIdx, colThn).setValue(tahun);
        if (colExp > 0) tSheet.getRange(existingIdx, colExp).setValue(expDate);
        if (colEvId > 0 && evidenceId) tSheet.getRange(existingIdx, colEvId).setValue(evidenceId);
        if (colEvUrl > 0 && evidenceUrl) tSheet.getRange(existingIdx, colEvUrl).setValue(evidenceUrl);
        if (colUpAt > 0) tSheet.getRange(existingIdx, colUpAt).setValue(nowStr);
        if (colUpBy > 0) tSheet.getRange(existingIdx, colUpBy).setValue(session.userId);
      } else {
        // Insert new row
        tSheet.appendRow([
          recordId,
          params.pegawaiId,
          peg['NIP'] || '-',
          params.kodePelatihan,
          namaPel,
          status,
          noSert,
          tahun,
          expDate,
          evidenceId,
          evidenceUrl,
          nowStr,
          session.userId
        ]);
      }

      if (typeof applyFormalSheetFormatting === 'function') {
        applyFormalSheetFormatting(tSheet, SHEET_TU.PELATIHAN_PEGAWAI);
      }

      logAudit(session.userId, 'SAVE_SERTIFIKAT', 'TX_TU_Pelatihan_Pegawai', recordId, {
        pegawaiId: params.pegawaiId,
        kodePelatihan: params.kodePelatihan,
        status: status,
        hasEvidence: !!evidenceUrl
      });

      return {
        success: true,
        message: 'Data sertifikat berhasil disimpan.',
        recordId: recordId,
        fileUrl: evidenceUrl
      };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[tataUsaha_saveSertifikat] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Validasi & normalisasi payload profil Master Pegawai POA (dapat diuji unit-test).
 * - Nama wajib & dinormalisasi menjadi HURUF BESAR (A-Z + spasi)
 * - NIP wajib 18 digit angka untuk PNS, P3K, dan P3K_PARUH_WAKTU; tidak wajib/dikosongkan untuk PJLP & MAGANG
 * - NIK (NomorIdentitas) dan SK Penempatan bersifat opsional (diisi bila ada)
 * - PJLP & P3K_PARUH_WAKTU awak kapal tetap dapat menyimpan KelompokJabatan kapal (Juru Masak, Juru Minyak, dll.)
 */
function validatePegawaiMasterPayload(params) {
  if (!params || !params.nama) throw new Error('Nama pegawai wajib diisi.');
  if (!params.unitKerja) throw new Error('Unit kerja wajib diisi.');

  var cleanNama = typeof sanitizeNamaPersonel === 'function'
    ? sanitizeNamaPersonel(String(params.nama))
    : String(params.nama).toUpperCase().replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleanNama) {
    throw new Error('Nama pegawai wajib menggunakan huruf A-Z tanpa simbol/angka saja.');
  }

  var stPeg = String(params.statusKepegawaian || 'PNS').toUpperCase().trim();
  if (stPeg === 'PPPK_FUNGSIONAL' || stPeg === 'PPPK_PELAKSANA') stPeg = 'P3K';
  if (stPeg === 'PPPK_PARUH_WAKTU') stPeg = 'P3K_PARUH_WAKTU';

  var rawNip = String(params.nip || '').replace(/[^0-9]/g, '');
  var requiresNip = (stPeg === 'PNS' || stPeg === 'P3K' || stPeg === 'P3K_PARUH_WAKTU');
  if (requiresNip) {
    if (!/^\d{18}$/.test(rawNip)) {
      throw new Error('NIP wajib terdiri dari tepat 18 digit angka untuk personel PNS, P3K, dan P3K Paruh Waktu.');
    }
  } else {
    rawNip = '';
  }

  var nikVal = String(params.nomorIdentitas || params.noIdentitas || '').trim();
  if (nikVal && !/^[A-Za-z0-9\-\s]{4,30}$/.test(nikVal)) {
    throw new Error('Format Nomor Identitas (NIK/NIM/NRP) tidak valid.');
  }

  var tglMulai = String(params.tanggalMulai || params.tglMulaiKontrak || '').trim().substring(0, 10);
  var tglSelesai = String(params.tanggalSelesai || params.tglSelesaiKontrak || '').trim().substring(0, 10);
  if (tglMulai && tglSelesai && tglSelesai < tglMulai) {
    throw new Error('Tanggal selesai masa kerja/magang tidak boleh lebih awal dari tanggal mulai.');
  }

  var cleanUnit = String(params.unitKerja || '').trim();
  var uLow = cleanUnit.toLowerCase();
  if (uLow === 'dit. poa' || uLow === 'dit poa' || uLow.indexOf('pengendalian operasi armada') !== -1 ||
      (uLow.indexOf('poa') !== -1 && uLow.indexOf('armada') === -1 && uLow.indexOf('diperbantukan') === -1)) {
    cleanUnit = 'Dit. POA';
  }

  var lingkup = String(params.lingkupData || '').toUpperCase().trim();
  if (!lingkup) {
    lingkup = cleanUnit === 'Dit. POA' ? 'DIT_POA' : 'AWAK_KAPAL_ARMADA';
  }

  var kelompok = String(params.kelompokJabatan || '').trim();
  if (stPeg === 'MAGANG') {
    kelompok = 'Non-Kompetensi';
  } else if (!kelompok) {
    if (stPeg === 'PJLP') {
      kelompok = (lingkup === 'AWAK_KAPAL_ARMADA') ? 'Juru Masak' : 'PJLP';
    } else {
      throw new Error('Kelompok jabatan wajib dipilih.');
    }
  }

  var statusPenempatan = _inferStatusPenempatanSikap(cleanUnit, params.statusPenempatan);
  var rumpun = _resolveKategoriRumpunSikap(stPeg, kelompok, lingkup, params.rumpun);
  if (rumpun === 'AWAK_DEK' || rumpun === 'AWAK_MESIN' || rumpun === 'PENUNJANG') {
    lingkup = 'AWAK_KAPAL_ARMADA';
  }

  var tingkatKelas = String(params.tingkatKelas || 'NON_KELAS').trim() || 'NON_KELAS';
  var jabatanLengkap = String(params.jabatanLengkap || '').trim();
  if (!jabatanLengkap) {
    if (stPeg === 'MAGANG') {
      jabatanLengkap = 'Peserta ' + (params.subJenisSDM || 'Magang');
    } else if (lingkup === 'AWAK_KAPAL_ARMADA' && tingkatKelas && tingkatKelas !== 'NON_KELAS' && tingkatKelas !== 'NON_JENJANG') {
      jabatanLengkap = kelompok + ' ' + tingkatKelas.replace(/_/g, ' ');
    } else {
      jabatanLengkap = kelompok;
    }
  }

  return {
    nama: cleanNama,
    nip: rawNip,
    statusKepegawaian: stPeg,
    unitKerja: cleanUnit,
    lingkupData: lingkup,
    kelompokJabatan: kelompok,
    jabatanLengkap: jabatanLengkap,
    tingkatKelas: tingkatKelas,
    rumpun: rumpun,
    statusPenempatan: statusPenempatan,
    kapalPenempatan: String(params.kapalPenempatan || '').trim(),
    ukuranBaju: String(params.ukuranBaju || '').trim().toUpperCase(),
    ukuranSepatu: String(params.ukuranSepatu || '').trim(),
    subJenisSDM: String(params.subJenisSDM || '').trim(),
    nomorIdentitas: nikVal,
    institusiAsal: String(params.institusiAsal || '').trim(),
    tanggalMulai: tglMulai,
    tanggalSelesai: tglSelesai,
    mentorPembimbing: String(params.mentorPembimbing || '').trim(),
    catatanTambahan: String(params.catatanTambahan || '').trim()
  };
}

/**
 * Menambah personel baru atau memperbarui profil pegawai yang sudah ada,
 * sekaligus menuntaskan status DISPARITAS_NAKHODA -> LENGKAP ketika dilengkapi oleh Subbag TU.
 */
function tataUsaha_savePegawaiMaster(token, params) {
  try {
    var session = _tuRequireSession(token);
    _tuAssertSubmit(session);

    var v = validatePegawaiMasterPayload(params);

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);

    try {
      ensurePegawaiMasterColumns();
      var sheet = openTuSheet(SHEET_TU.PEGAWAI_MASTER);
      var rows = sheetToObjects(sheet);
      var nowIso = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd HH:mm:ss');

      var isEdit = !!(params.pegawaiId && String(params.pegawaiId).trim());
      var targetIdx = -1;
      var existingRow = null;

      if (isEdit) {
        for (var i = 0; i < rows.length; i++) {
          if (String(rows[i]['PegawaiID']) === String(params.pegawaiId)) {
            targetIdx = i + 2;
            existingRow = rows[i];
            break;
          }
        }
        if (targetIdx === -1) throw new Error('Pegawai dengan ID ' + params.pegawaiId + ' tidak ditemukan.');
      }

      var pid = isEdit ? String(params.pegawaiId).trim() : ('PEG-' + ('0000' + (rows.length + 1)).slice(-4));

      // Proses upload berkas dokumen SK Penempatan / Surat Tugas (Opsional)
      var docUrl = String(params.dokumenSkUrl || (existingRow ? existingRow['DokumenSK_URL'] : '') || '');
      var docEvId = String(params.dokumenSkEvidenceId || (existingRow ? existingRow['DokumenSK_EvidenceID'] : '') || '');
      if (params.docFile && params.docFile.base64) {
        try {
          var evRes = evidence_upload(token, {
            refSheet: SHEET_TU.PEGAWAI_MASTER,
            refRowId: pid,
            fileName: params.docFile.fileName || ('Dokumen_' + pid + '.pdf'),
            mimeType: params.docFile.mimeType || 'application/pdf',
            dataBase64: params.docFile.base64
          });
          if (evRes && evRes.success && evRes.data) {
            docEvId = evRes.data.evidenceId;
            docUrl = 'https://drive.google.com/file/d/' + evRes.data.driveFileId + '/view';
          }
        } catch (eEv) {
          Logger.log('[tataUsaha_savePegawaiMaster] evidence err: ' + eEv.message);
        }
      }

      var dataPayload = {
        'PegawaiID': pid,
        'NIP': v.nip,
        'Nama': v.nama,
        'UnitKerja': v.unitKerja,
        'LingkupData': v.lingkupData,
        'KelompokJabatan': v.kelompokJabatan,
        'JabatanLengkap': v.jabatanLengkap,
        'TingkatKelas': v.tingkatKelas,
        'KategoriRumpun': v.rumpun,
        'StatusKepegawaian': v.statusKepegawaian,
        'StatusAktif': params.statusAktif || 'AKTIF',
        'SubJenisSDM': v.subJenisSDM,
        'NomorIdentitas': v.nomorIdentitas,
        'InstitusiAsal': v.institusiAsal,
        'TanggalMulai': v.tanggalMulai,
        'TanggalSelesai': v.tanggalSelesai,
        'MentorPembimbing': v.mentorPembimbing,
        'CatatanTambahan': v.catatanTambahan,
        'DokumenSK_URL': docUrl,
        'DokumenSK_EvidenceID': docEvId,
        'StatusPenempatan': v.statusPenempatan,
        'KapalPenempatan': v.kapalPenempatan,
        'UkuranBaju': v.ukuranBaju,
        'UkuranSepatu': v.ukuranSepatu,
        'SumberSinkronisasi': existingRow && existingRow['SumberSinkronisasi'] ? String(existingRow['SumberSinkronisasi']) : 'MANUAL_TU',
        'StatusKelengkapanTU': 'LENGKAP',
        'CatatanDisparitas': '',
        'UpdatedAt': nowIso,
        'UpdatedBy': session.userId
      };

      if (isEdit) {
        updateRowCells(sheet, targetIdx, dataPayload);
      } else {
        appendRowData(sheet, dataPayload);
      }

      if (typeof applyFormalSheetFormatting === 'function') {
        applyFormalSheetFormatting(sheet, SHEET_TU.PEGAWAI_MASTER);
      }

      logAudit(session.userId, isEdit ? 'UPDATE_PEGAWAI' : 'ADD_PEGAWAI', 'Master_Pegawai_POA', pid, {
        nama: v.nama,
        unit: v.unitKerja,
        status: v.statusKepegawaian,
        jabatan: v.kelompokJabatan,
        disparitasResolved: existingRow ? String(existingRow['StatusKelengkapanTU'] || '') === 'DISPARITAS_NAKHODA' : false
      });

      return {
        success: true,
        message: 'Profil personel ' + v.nama + ' berhasil ' + (isEdit ? 'diperbarui & status disparitas diselesaikan.' : 'didaftarkan.'),
        pegawaiId: pid
      };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[tataUsaha_savePegawaiMaster] Error: ' + e.message);
    return { success: false, error: 'Gagal menyimpan profil personel: ' + e.message };
  }
}

/**
 * tataUsaha_deletePegawaiMaster
 * Soft delete personel Master Pegawai POA (StatusAktif: NON_AKTIF).
 */
function tataUsaha_deletePegawaiMaster(token, pegawaiId) {
  try {
    var session = _tuRequireSession(token);
    _tuAssertWrite(session);

    if (!pegawaiId) {
      return { success: false, error: 'ID Personel tidak valid.' };
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      var sheet = openTuSheet(SHEET_TU.PEGAWAI_MASTER);
      var rows = sheetToObjects(sheet);
      var targetIdx = -1;
      var currentPeg = null;

      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i]['PegawaiID'] || '').trim() === String(pegawaiId).trim()) {
          targetIdx = i + 2;
          currentPeg = rows[i];
          break;
        }
      }

      if (targetIdx === -1) {
        return { success: false, error: 'Data personel tidak ditemukan.' };
      }

      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var nowStr = new Date().toISOString();

      if (headers.indexOf('StatusAktif') !== -1) {
        sheet.getRange(targetIdx, headers.indexOf('StatusAktif') + 1).setValue('NON_AKTIF');
      }
      if (headers.indexOf('UpdatedAt') !== -1) {
        sheet.getRange(targetIdx, headers.indexOf('UpdatedAt') + 1).setValue(nowStr);
      }
      if (headers.indexOf('UpdatedBy') !== -1) {
        sheet.getRange(targetIdx, headers.indexOf('UpdatedBy') + 1).setValue(session.userId);
      }

      logAudit(session.userId, 'SOFT_DELETE_PEGAWAI', 'Master_Pegawai_POA', pegawaiId, {
        nama: currentPeg ? currentPeg['Nama'] : '',
        statusSebelum: currentPeg ? currentPeg['StatusAktif'] : 'AKTIF',
        statusSesudah: 'NON_AKTIF'
      });

      return {
        success: true,
        message: 'Personel ' + (currentPeg ? currentPeg['Nama'] : pegawaiId) + ' berhasil dinonaktifkan (soft delete).'
      };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[tataUsaha_deletePegawaiMaster] Error: ' + e.message);
    return { success: false, error: 'Gagal menonaktifkan personel: ' + e.message };
  }
}

/**
 * Menyimpan batch checklist status pelatihan (misalnya tanda kelulusan cepat).
 *
 * @param {string} token
 * @param {{
 *   pegawaiId: string,
 *   items: Array<{ kodePelatihan: string, statusKelulusan: string, namaPelatihan?: string }>
 * }} params
 */
function tataUsaha_toggleChecklistPelatihanBatch(token, params) {
  try {
    var session = _tuRequireSession(token);
    _tuAssertSubmit(session);

    if (!params || !params.pegawaiId) throw new Error('PegawaiID wajib diisi.');
    if (!params.items || !params.items.length) throw new Error('Daftar item pelatihan kosong.');

    var lock = LockService.getScriptLock();
    lock.waitLock(25000);

    try {
      var pSheet = openTuSheet(SHEET_TU.PEGAWAI_MASTER);
      var pFound = findRowById(pSheet, params.pegawaiId);
      if (!pFound) throw new Error('Pegawai tidak ditemukan.');
      var peg = pFound.obj;

      var tSheet = openTuSheet(SHEET_TU.PELATIHAN_PEGAWAI);
      var tRows = sheetToObjects(tSheet);
      var headers = tSheet.getRange(1, 1, 1, tSheet.getLastColumn()).getValues()[0];
      var nowStr = new Date().toISOString();

      var mapExisting = {};
      for (var i = 0; i < tRows.length; i++) {
        if (String(tRows[i]['PegawaiID']) === String(params.pegawaiId)) {
          var kd = String(tRows[i]['KodePelatihan'] || '').trim();
          mapExisting[kd] = { rowIdx: i + 2, data: tRows[i] };
        }
      }

      var colStatus = headers.indexOf('StatusKelulusan') + 1;
      var colUpAt = headers.indexOf('UpdatedAt') + 1;
      var colUpBy = headers.indexOf('UpdatedBy') + 1;

      for (var it = 0; it < params.items.length; it++) {
        var item = params.items[it];
        var kode = String(item.kodePelatihan || '').trim();
        var status = String(item.statusKelulusan || 'SUDAH_LULUS').toUpperCase();
        var nama = String(item.namaPelatihan || '').trim();

        if (mapExisting[kode]) {
          var targetRow = mapExisting[kode].rowIdx;
          tSheet.getRange(targetRow, colStatus).setValue(status);
          tSheet.getRange(targetRow, colUpAt).setValue(nowStr);
          tSheet.getRange(targetRow, colUpBy).setValue(session.userId);
        } else {
          var recId = 'CERT-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd-HHmmss') + '-' + Math.floor(100 + Math.random() * 900);
          tSheet.appendRow([
            recId,
            params.pegawaiId,
            peg['NIP'] || '-',
            kode,
            nama,
            status,
            '',
            new Date().getFullYear(),
            '',
            '',
            '',
            nowStr,
            session.userId
          ]);
        }
      }

      logAudit(session.userId, 'BATCH_CHECKLIST_PELATIHAN', 'TX_TU_Pelatihan_Pegawai', params.pegawaiId, {
        itemCount: params.items.length
      });

      return { success: true, message: 'Checklist pelatihan berhasil diperbarui.' };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[tataUsaha_toggleChecklistPelatihanBatch] ' + e.message);
    return { success: false, error: e.message };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validatePegawaiMasterPayload: validatePegawaiMasterPayload,
    _inferStatusPenempatanSikap: _inferStatusPenempatanSikap,
    _resolveKategoriRumpunSikap: _resolveKategoriRumpunSikap,
    _normalizeStandarGroupSikap: _normalizeStandarGroupSikap
  };
}

