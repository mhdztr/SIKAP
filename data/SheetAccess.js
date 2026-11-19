/**
 * data/SheetAccess.js
 * Layer akses data generik + assertScope RBAC + hashPassword.
 *
 * ATURAN:
 * - Service layer TIDAK memanggil SpreadsheetApp secara langsung — semua melalui fungsi di sini.
 * - assertScope() WAJIB dipanggil di awal setiap service function yang baca/tulis data sensitif.
 * - hashPassword() adalah satu-satunya implementasi hashing di seluruh proyek — jangan duplikasi.
 */

// ===========================================================================
// RBAC
// ===========================================================================

/**
 * Validasi bahwa session memiliki scope yang dibutuhkan.
 * Melempar Error jika tidak memenuhi syarat — error akan ditangkap di caller
 * dan dikembalikan ke client sebagai {success: false, error: "..."}.
 *
 * @param {Object} session       - {userId, role, divisiId, status, nama}
 * @param {string[]|null} allowedRoles    - null = semua role APPROVED boleh; array = hanya role tsb
 * @param {string|null} requiredDivisiId  - null = lintas-divisi OK; string = harus match divisi ini
 *                                          (dikecualikan untuk SUPERADMIN dan DIREKTUR)
 */
function assertScope(session, allowedRoles, requiredDivisiId) {
  if (!session || !session.userId) {
    throw new Error('UNAUTHORIZED: Sesi tidak valid atau sudah berakhir. Silakan login ulang.');
  }
  if (session.status !== USER_STATUS.APPROVED) {
    throw new Error('FORBIDDEN: Akun belum disetujui atau sudah tidak aktif.');
  }
  if (allowedRoles && allowedRoles.length > 0) {
    if (allowedRoles.indexOf(session.role) === -1) {
      throw new Error('FORBIDDEN: Role ' + session.role + ' tidak memiliki akses ke operasi ini.');
    }
  }
  if (requiredDivisiId) {
    // SUPERADMIN dan DIREKTUR bypass pembatasan divisi
    if (session.role !== ROLE.SUPERADMIN && session.role !== ROLE.DIREKTUR) {
      if (session.divisiId !== requiredDivisiId) {
        throw new Error(
          'FORBIDDEN: Akses terbatas ke divisi ' + requiredDivisiId +
          '. Akun Anda terdaftar di divisi ' + session.divisiId + '.'
        );
      }
    }
  }
}

// ===========================================================================
// HASHING — satu implementasi kanonik untuk seluruh proyek
// ===========================================================================

/**
 * Hash password menggunakan SHA-256 (built-in GAS, tanpa library eksternal).
 * Output: hex string 64 karakter.
 *
 * CATATAN: SHA-256 tanpa salt — dipertahankan untuk simplisitas internal GAS.
 * Ditinjau ulang di Fase 12 (QA & Polish) sebelum go-live.
 *
 * @param {string} plaintext
 * @returns {string} hex SHA-256 hash
 */
function hashPassword(plaintext) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    plaintext,
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    var hex = (b < 0 ? b + 256 : b).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

// ===========================================================================
// SHEET OPENERS
// ===========================================================================

var _EXEC_SS_CACHE = {};
var _EXEC_TU_ID = null;

function _openSsCached(ssId) {
  if (!ssId) return null;
  if (_EXEC_SS_CACHE[ssId]) return _EXEC_SS_CACHE[ssId];
  var ss = SpreadsheetApp.openById(ssId);
  if (ss) _EXEC_SS_CACHE[ssId] = ss;
  return ss;
}

function openMasterSheet(sheetName) {
  var ids = getSpreadsheetIds();
  var ss = null;
  if (ids.masterId) {
    try {
      ss = _openSsCached(ids.masterId);
    } catch (e) {
      Logger.log('[openMasterSheet] masterId ' + ids.masterId + ' tidak dapat dibuka: ' + e.message);
    }
  }
  if (!ss) {
    var tuId = ensureTuSpreadsheet();
    ss = _openSsCached(tuId);
  }
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = _autoCreateMasterSheet(ss, sheetName);
  }
  if (sheetName === SHEET_MASTER.USERS) {
    _ensureSuperadminSeeded(sheet);
  }
  return sheet;
}

function openTransaksiSheet(sheetName) {
  var ids = getSpreadsheetIds();
  var ss = null;
  if (ids.transaksiId) {
    try {
      ss = _openSsCached(ids.transaksiId);
    } catch (e) {
      Logger.log('[openTransaksiSheet] transaksiId ' + ids.transaksiId + ' err: ' + e.message);
    }
  }
  if (!ss) {
    var tuId = ensureTuSpreadsheet();
    ss = _openSsCached(tuId);
  }
  return ss.getSheetByName(sheetName) || _autoCreateTuSheet(ss, sheetName);
}

function openLogSheet(sheetName) {
  var ids = getSpreadsheetIds();
  var ss = null;
  if (ids.logId) {
    try {
      ss = _openSsCached(ids.logId);
    } catch (e) {
      Logger.log('[openLogSheet] logId ' + ids.logId + ' err: ' + e.message);
    }
  }
  if (!ss) {
    var tuId = ensureTuSpreadsheet();
    ss = _openSsCached(tuId);
  }
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = _autoCreateLogSheet(ss, sheetName);
  }
  return sheet;
}

/**
 * Membuka sheet pada spreadsheet dedicated SIKAP_TU.
 * Otomatis melakukan self-heal membuat spreadsheet dan sheet jika belum ada.
 *
 * @param {string} sheetName - nama sheet di SIKAP_TU (SHEET_TU.*)
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function openTuSheet(sheetName) {
  var tuId = ensureTuSpreadsheet();
  var ss = _openSsCached(tuId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = _autoCreateTuSheet(ss, sheetName);
  }
  return sheet;
}

/**
 * Memastikan spreadsheet SIKAP_TU sudah ada dan ID tersimpan di Script Properties.
 * Idempoten: jika ID sudah ada & valid, langsung mengembalikannya.
 * @returns {string} ID spreadsheet SIKAP_TU
 */
function ensureTuSpreadsheet() {
  if (_EXEC_TU_ID && _EXEC_SS_CACHE[_EXEC_TU_ID]) return _EXEC_TU_ID;
  var props = PropertiesService.getScriptProperties();
  var tuId  = props.getProperty(PROP_KEY.TU_SS_ID);
  if (tuId) {
    try {
      _openSsCached(tuId);
      _EXEC_TU_ID = tuId;
      return tuId;
    } catch (e) {
      Logger.log('[ensureTuSpreadsheet] ID lama tidak valid/tidak ditemukan, membuat baru...');
    }
  }

  // Buat spreadsheet SIKAP_TU baru
  var ss = SpreadsheetApp.create(SS_NAME.TU);
  tuId = ss.getId();
  _EXEC_SS_CACHE[tuId] = ss;
  _EXEC_TU_ID = tuId;
  props.setProperty(PROP_KEY.TU_SS_ID, tuId);
  Logger.log('[ensureTuSpreadsheet] SIKAP_TU berhasil dibuat dengan ID: ' + tuId);

  // Inisialisasi sheet standar TU
  _autoCreateTuSheet(ss, SHEET_TU.PEGAWAI);
  _autoCreateTuSheet(ss, SHEET_TU.PEGAWAI_MASTER);
  _autoCreateTuSheet(ss, SHEET_TU.STANDAR_PELATIHAN);
  _autoCreateTuSheet(ss, SHEET_TU.PELATIHAN_PEGAWAI);
  _autoCreateTuSheet(ss, SHEET_TU.BMN_ASET);
  _autoCreateTuSheet(ss, SHEET_TU.BMN_PENGHAPUSAN);
  _autoCreateTuSheet(ss, SHEET_TU.BMN_PENGHAPUSAN_DETAIL);
  _autoCreateTuSheet(ss, SHEET_TU.BMN_REKAP_SAKTI);
  _autoCreateTuSheet(ss, SHEET_TU.BMN_NERACA);
  _autoCreateTuSheet(ss, SHEET_TU.MASTER_LOKASI_UPT);
  _autoCreateTuSheet(ss, SHEET_TU.MASTER_BMN_KATEGORI);
  _autoCreateTuSheet(ss, SHEET_TU.MASTER_PAKET);
  _autoCreateTuSheet(ss, SHEET_TU.TATA_USAHA);
  _autoCreateTuSheet(ss, SHEET_TU.PAKET_PROGRES);
  _autoCreateTuSheet(ss, SHEET_TU.EVIDENCE);

  // Hapus Sheet1 default
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() === 'Sheet1' && sheets.length > 1) {
      try { ss.deleteSheet(sheets[i]); } catch (err) {}
      break;
    }
  }

  // Seed data awal jika modul Setup.js tersedia
  try {
    if (typeof _seedLokasiUpt === 'function') _seedLokasiUpt(ss);
    if (typeof _seedBmnKategori === 'function') _seedBmnKategori(ss);
  } catch (errSeed) {
    Logger.log('[ensureTuSpreadsheet] Seed UPT/Kategori info: ' + errSeed.message);
  }

  return tuId;
}

function _autoCreateTuSheet(ss, sheetName) {
  var existing = ss.getSheetByName(sheetName);
  if (existing) return existing;

  var headers = [];
  if (sheetName === SHEET_TU.PEGAWAI) {
    headers = STD_COLS.concat(['Kategori', 'Jumlah', 'Keterangan']);
  } else if (sheetName === SHEET_TU.PEGAWAI_MASTER) {
    headers = [
      'PegawaiID', 'NIP', 'Nama', 'UnitKerja', 'LingkupData', 'KelompokJabatan',
      'JabatanLengkap', 'TingkatKelas', 'KategoriRumpun', 'StatusKepegawaian', 'StatusAktif',
      'SubJenisSDM', 'NomorIdentitas', 'InstitusiAsal', 'TanggalMulai', 'TanggalSelesai',
      'MentorPembimbing', 'CatatanTambahan', 'DokumenSK_URL', 'DokumenSK_EvidenceID',
      'StatusPenempatan', 'KapalPenempatan', 'UkuranBaju', 'UkuranSepatu',
      'SumberSinkronisasi', 'StatusKelengkapanTU', 'CatatanDisparitas',
      'UpdatedAt', 'UpdatedBy'
    ];
  } else if (sheetName === SHEET_TU.STANDAR_PELATIHAN) {
    headers = [
      'KodePelatihan', 'KelompokJabatan', 'TingkatKelas', 'Kategori', 'NamaPelatihan', 'Wajib', 'Urutan'
    ];
  } else if (sheetName === SHEET_TU.PELATIHAN_PEGAWAI) {
    headers = [
      'RecordID', 'PegawaiID', 'NIP', 'KodePelatihan', 'NamaPelatihan', 'StatusKelulusan',
      'NomorSertifikat', 'TahunPelatihan', 'BerlakuSampai', 'FileEvidenceID', 'FileEvidenceURL',
      'UpdatedAt', 'UpdatedBy'
    ];
  } else if (sheetName === SHEET_TU.BMN_ASET) {
    headers = STD_COLS.concat([
      'AsetID', 'KodeBarang', 'NUP', 'NamaBarang', 'MerekTipe', 'KategoriPencatatan',
      'KodeKategori', 'TanggalPerolehan', 'NilaiPerolehan', 'NilaiBuku', 'Kondisi',
      'LokasiID', 'LokasiDetailRuangan', 'Latitude', 'Longitude', 'SumberLokasi',
      'JarakKeUPT_Km', 'TanggalVerifikasi', 'FotoEvidenceID', 'StatusAset',
      'PenghapusanID', 'KapalID', 'ImportBatchID', 'Keterangan',
      'KodeAkunNeraca', 'NoPolisi', 'TglPajakTahunan', 'TglStnkLimaTahunan',
      'FotoStnkEvidenceID', 'NoDokumenSumber', 'StnkVerified'
    ]);
  } else if (sheetName === SHEET_TU.BMN_PENGHAPUSAN) {
    headers = STD_COLS.concat([
      'PenghapusanID', 'Tahap', 'AlasanPenghapusan', 'KeteranganAlasan',
      'NomorSuratUsulan', 'TanggalSuratUsulan', 'EvidenceSuratUsulan',
      'NomorSuratPersetujuan', 'TanggalSuratPersetujuan', 'InstansiKemenkeu', 'EvidenceSuratPersetujuan',
      'NomorSK', 'TanggalSK', 'EvidenceSK', 'EvidenceBAST',
      'TotalUnit', 'TotalNilaiPerolehan', 'TotalNilaiBuku'
    ]);
  } else if (sheetName === SHEET_TU.BMN_PENGHAPUSAN_DETAIL) {
    headers = STD_COLS.concat(['ParentRowID', 'PenghapusanID', 'AsetID', 'KondisiSaatUsul', 'NilaiBukuSaatUsul']);
  } else if (sheetName === SHEET_TU.BMN_REKAP_SAKTI) {
    headers = [
      'RekapID', 'PeriodeLaporan', 'JenisLaporan', 'KodeAkun', 'UraianAkun',
      'KodeBarang', 'UraianBarang', 'Satuan', 'KuantitasAwal', 'NilaiAwal',
      'KuantitasTambah', 'NilaiTambah', 'KuantitasKurang', 'NilaiKurang',
      'KuantitasAkhir', 'NilaiAkhir', 'UpdatedAt', 'UpdatedBy', 'SumberDokumen'
    ];
  } else if (sheetName === SHEET_TU.BMN_NERACA) {
    headers = [
      'NeracaID', 'PeriodeLaporan', 'KodeAkun', 'UraianAkun',
      'JumlahNilai', 'KategoriNeraca', 'UpdatedAt', 'UpdatedBy', 'SumberDokumen'
    ];
  } else if (sheetName === SHEET_TU.MASTER_LOKASI_UPT) {
    headers = ['LokasiID', 'NamaLokasi', 'JenisLokasi', 'Latitude', 'Longitude', 'RadiusVerifikasiKm', 'StatusAktif'];
  } else if (sheetName === SHEET_TU.MASTER_BMN_KATEGORI) {
    headers = ['KodeKategori', 'NamaKategori', 'Golongan', 'MasaManfaatTahun'];
  } else if (sheetName === SHEET_TU.TATA_USAHA) {
    headers = STD_COLS.concat([
      'PaguReguler', 'PaguABT', 'RealisasiSP2D_Minggu', 'RealisasiAkrual_Minggu',
      'RealisasiSP2D_Reguler_Minggu', 'RealisasiSP2D_ABT_Minggu',
      'RealisasiAkrual_Reguler_Minggu', 'RealisasiAkrual_ABT_Minggu', 'CatatanRevisiPagu'
    ]);
  } else if (sheetName === SHEET_TU.PAKET_PROGRES) {
    headers = STD_COLS.concat([
      'PaketID', 'TahapPekerjaan', 'NilaiKontrak', 'RekananPenyedia', 'NomorKontrak',
      'ProgresFisikPct', 'RealisasiKeuangan', 'KendalaKeterangan', 'EvidenceUrl'
    ]);
  } else if (sheetName === SHEET_TU.MASTER_PAKET) {
    headers = ['PaketID', 'NamaPaket', 'DivisiID', 'TahunAnggaran', 'PaguAnggaran', 'JenisPengadaan'];
  } else if (sheetName === SHEET_TU.EVIDENCE) {
    headers = [
      'EvidenceID', 'RefSheet', 'RefRowID', 'DriveFileID', 'FileName',
      'FileType', 'SourceMode', 'UploadedBy', 'UploadedAt', 'Status', 'Catatan'
    ];
  } else {
    headers = STD_COLS;
  }

  var created = ss.insertSheet(sheetName);
  created.getRange(1, 1, 1, headers.length).setValues([headers]);
  applyFormalSheetFormatting(created, sheetName);
  Logger.log('[_autoCreateTuSheet] Sheet ' + sheetName + ' dibuat otomatis di database TU.');
  return created;
}

function _autoCreateMasterSheet(ss, sheetName) {
  var existing = ss.getSheetByName(sheetName);
  if (existing) return existing;

  var headers = [];
  var seedRows = [];

  if (sheetName === SHEET_MASTER.USERS) {
    headers = [
      'UserID', 'Nama', 'Email', 'NIP', 'PasswordHash',
      'DivisiID', 'Role', 'Status', 'ApprovedBy', 'RegisteredAt', 'ApprovedAt'
    ];
  } else if (sheetName === SHEET_MASTER.DIVISI) {
    headers = ['DivisiID', 'NamaResmi', 'NamaDashboard', 'Kode'];
    seedRows = [
      ['DIV-TU', 'Subbagian Tata Usaha', 'Tata Usaha', 'TU'],
      ['DIV-OPS', 'Subdirektorat Pemantauan dan Operasi Armada', 'Operasi Armada', 'OPS'],
      ['DIV-SARPRAS', 'Subdirektorat Sarana dan Prasarana Pengawasan', 'Sarana Prasarana', 'SARPRAS'],
      ['DIV-ALAT', 'Subdirektorat Alutsista dan Teknologi', 'Alutsista', 'ALAT']
    ];
  } else if (sheetName === SHEET_MASTER.OPSI) {
    headers = ['Kode', 'Urutan', 'Label', 'LabelTampil', 'Aktif', 'DibuatOleh', 'DibuatAt'];
  } else {
    headers = ['ID', 'Nama', 'Keterangan'];
  }

  var created = ss.insertSheet(sheetName);
  created.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#E8EAF6');
  created.setFrozenRows(1);

  if (seedRows.length > 0) {
    created.getRange(2, 1, seedRows.length, seedRows[0].length).setValues(seedRows);
  }

  Logger.log('[_autoCreateMasterSheet] Sheet ' + sheetName + ' dibuat otomatis.');
  return created;
}

function _autoCreateLogSheet(ss, sheetName) {
  var existing = ss.getSheetByName(sheetName);
  if (existing) return existing;

  var headers = [];
  if (sheetName === SHEET_LOG.APPROVAL_QUEUE) {
    headers = [
      'QueueID', 'UserID', 'RoleDilamar', 'DivisiID', 'Status',
      'KeputusanOleh', 'KeputusanAt', 'AlasanReject', 'CreatedAt'
    ];
  } else if (sheetName === SHEET_LOG.AUDIT_LOG) {
    headers = ['LogID', 'UserID', 'Aksi', 'SheetTarget', 'RowIDTarget', 'Alasan', 'Timestamp'];
  } else if (sheetName === SHEET_LOG.NOTIFICATIONS) {
    headers = ['NotifID', 'UserID', 'Jenis', 'Pesan', 'IsRead', 'CreatedAt'];
  } else {
    headers = ['LogID', 'UserID', 'Aksi', 'Timestamp'];
  }

  var created = ss.insertSheet(sheetName);
  created.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#F1F5F9');
  created.setFrozenRows(1);
  return created;
}

function _seedLokasiUpt(ss) {
  var sheet = ss.getSheetByName(SHEET_TU.MASTER_LOKASI_UPT);
  if (!sheet) sheet = _autoCreateTuSheet(ss, SHEET_TU.MASTER_LOKASI_UPT);
  if (sheet.getLastRow() > 1) return;

  var uptData = [
    ['UPT-PUSAT-POA', 'Dit. POA (Pusat KKP Jakarta)', 'PUSAT', -6.175392, 106.827153, 25, 'AKTIF'],
    ['UPT-JKT', 'Pangkalan PSDKP Jakarta', 'PANGKALAN', -6.110214, 106.804322, 25, 'AKTIF'],
    ['UPT-BTM', 'Pangkalan PSDKP Batam', 'PANGKALAN', 1.082828, 103.955618, 25, 'AKTIF'],
    ['UPT-BNO', 'Pangkalan PSDKP Benoa', 'PANGKALAN', -8.751612, 115.215541, 25, 'AKTIF'],
    ['UPT-BTG', 'Pangkalan PSDKP Bitung', 'PANGKALAN', 1.440231, 125.191244, 25, 'AKTIF'],
    ['UPT-LMP', 'Pangkalan PSDKP Lampulo', 'PANGKALAN', 5.586912, 95.328312, 25, 'AKTIF'],
    ['UPT-TUL', 'Pangkalan PSDKP Tual', 'PANGKALAN', -5.628912, 132.748312, 25, 'AKTIF'],
    ['UPT-BLW', 'Stasiun PSDKP Belawan', 'STASIUN', 3.784212, 98.692812, 25, 'AKTIF'],
    ['UPT-PTK', 'Stasiun PSDKP Pontianak', 'STASIUN', -0.026312, 109.342512, 25, 'AKTIF'],
    ['UPT-CLP', 'Stasiun PSDKP Cilacap', 'STASIUN', -7.738112, 109.015212, 25, 'AKTIF'],
    ['UPT-TRK', 'Stasiun PSDKP Tarakan', 'STASIUN', 3.303912, 117.591212, 25, 'AKTIF'],
    ['UPT-KPG', 'Stasiun PSDKP Kupang', 'STASIUN', -10.177212, 123.607012, 25, 'AKTIF'],
    ['UPT-AMB', 'Stasiun PSDKP Ambon', 'STASIUN', -3.695412, 128.181412, 25, 'AKTIF'],
    ['UPT-BIK', 'Stasiun PSDKP Biak', 'STASIUN', -1.178912, 136.082512, 25, 'AKTIF'],
    ['UPT-THN', 'Stasiun PSDKP Tahuna', 'STASIUN', 3.611112, 125.492512, 25, 'AKTIF'],
    ['UPT-PDG', 'Stasiun PSDKP Padang', 'STASIUN', -0.957512, 100.368312, 25, 'AKTIF']
  ];

  sheet.getRange(2, 1, uptData.length, uptData[0].length).setValues(uptData);
  Logger.log('[_seedLokasiUpt] Master_Lokasi_UPT (16 UPT PSDKP) berhasil di-seed.');
}

function _seedBmnKategori(ss) {
  var sheet = ss.getSheetByName(SHEET_TU.MASTER_BMN_KATEGORI);
  if (!sheet) sheet = _autoCreateTuSheet(ss, SHEET_TU.MASTER_BMN_KATEGORI);
  if (sheet.getLastRow() > 1) return;

  var katData = [
    ['KAT-TIK', 'Peralatan Komputer & TIK', 'Peralatan dan Mesin', 4],
    ['KAT-KAPAL', 'Kapal Pengawas & Motor Tempel', 'Alat Angkutan Apung Bermotor', 10],
    ['KAT-RADAR', 'Radar, Navigasi & Komunikasi Maritim', 'Peralatan dan Mesin', 5],
    ['KAT-SENJATA', 'Senjata Api Khusus & Perlengkapan Pengawasan', 'Senjata', 10],
    ['KAT-KANTOR', 'Peralatan & Perlengkapan Kantor', 'Peralatan dan Mesin', 5],
    ['KAT-MEUBEL', 'Mebel & Perabot Kantor', 'Peralatan dan Mesin', 5],
    ['KAT-KENDARAAN', 'Kendaraan Dinas Operasional', 'Alat Angkutan Darat Bermotor', 7],
    ['KAT-GEDUNG', 'Gedung, Bangunan & Dermaga', 'Gedung dan Bangunan', 20]
  ];

  sheet.getRange(2, 1, katData.length, katData[0].length).setValues(katData);
  Logger.log('[_seedBmnKategori] Master_BMN_Kategori (8 Kategori) berhasil di-seed.');
}

/**
 * Memastikan akun Superadmin, Kadiv TU, dan Staf TU selalu tersedia.
 * Idempoten: jika belum ada akun berstatus APPROVED, akun default akan dibuat.
 */
var _SA_CHECKED_EXEC = false;
function _ensureSuperadminSeeded(usersSheet) {
  try {
    if (!usersSheet || _SA_CHECKED_EXEC) return;
    _SA_CHECKED_EXEC = true;
    var cache = (typeof CacheService !== 'undefined') ? CacheService.getScriptCache() : null;
    if (cache && cache.get('sikap_sa_ok_v1') === '1') return;

    var lastRow = usersSheet.getLastRow();
    var expectedHeaders = [
      'UserID', 'Nama', 'Email', 'NIP', 'PasswordHash',
      'DivisiID', 'Role', 'Status', 'ApprovedBy', 'RegisteredAt', 'ApprovedAt'
    ];
    if (lastRow === 0) {
      usersSheet.getRange(1, 1, 1, expectedHeaders.length)
        .setValues([expectedHeaders])
        .setFontWeight('bold')
        .setBackground('#E8EAF6');
      usersSheet.setFrozenRows(1);
      lastRow = 1;
    }

    var data = usersSheet.getDataRange().getValues();
    var headers = data[0] || expectedHeaders;
    var emailIdx = headers.indexOf('Email');
    var roleIdx = headers.indexOf('Role');
    var statusIdx = headers.indexOf('Status');
    var pwdIdx = headers.indexOf('PasswordHash');

    var superadminRowIdx = -1;
    for (var r = 1; r < data.length; r++) {
      var rowRole = String(data[r][roleIdx] || '').toUpperCase();
      var rowEmail = String(data[r][emailIdx] || '').toLowerCase();
      if (rowRole === ROLE.SUPERADMIN || rowEmail === 'superadmin@sikap.go.id') {
        superadminRowIdx = r + 1; // 1-based row index
        break;
      }
    }

    var now = new Date();
    if (superadminRowIdx > 0) {
      // Pastikan status APPROVED dan password hash valid jika belum
      var currStatus = String(data[superadminRowIdx - 1][statusIdx] || '').toUpperCase();
      var currPwd = String(data[superadminRowIdx - 1][pwdIdx] || '');
      if (currStatus !== USER_STATUS.APPROVED && statusIdx !== -1) {
        usersSheet.getRange(superadminRowIdx, statusIdx + 1).setValue(USER_STATUS.APPROVED);
      }
      if (!currPwd && pwdIdx !== -1) {
        usersSheet.getRange(superadminRowIdx, pwdIdx + 1).setValue(hashPassword('SuperAdmin2026!'));
      }
    } else {
      // Append default users
      var defaultUsers = [
        [
          'USR-SUPERADMIN-001',
          'Super Administrator SIKAP',
          'superadmin@sikap.go.id',
          '198501012010011001',
          hashPassword('SuperAdmin2026!'),
          '',
          ROLE.SUPERADMIN,
          USER_STATUS.APPROVED,
          'SYSTEM',
          now,
          now
        ],
        [
          'USR-KADIV-TU-001',
          'Kepala Subbag Tata Usaha',
          'kadiv.tu@sikap.go.id',
          '198005122005011002',
          hashPassword('KadivTU2026!'),
          'DIV-TU',
          ROLE.KADIV,
          USER_STATUS.APPROVED,
          'USR-SUPERADMIN-001',
          now,
          now
        ],
        [
          'USR-STAF-TU-001',
          'Staf Pelaksana TU',
          'staf.tu@sikap.go.id',
          '199203152018021003',
          hashPassword('StafTU2026!'),
          'DIV-TU',
          ROLE.STAF,
          USER_STATUS.APPROVED,
          'USR-KADIV-TU-001',
          now,
          now
        ]
      ];
      defaultUsers.forEach(function (uRow) {
        usersSheet.appendRow(uRow);
      });
      Logger.log('[_ensureSuperadminSeeded] Akun-akun default berhasil di-seed.');
    }
    if (cache) { try { cache.put('sikap_sa_ok_v1', '1', 3600); } catch (eC) {} }
  } catch (err) {
    Logger.log('[_ensureSuperadminSeeded] Error: ' + err.message);
  }
}

/**
 * Pastikan kolom ada pada sheet di SIKAP_TU (self-heal).
 *
 * @param {string} sheetName - nama sheet TU
 * @param {string} colName - nama kolom
 */
function ensureTuColumn(sheetName, colName) {
  var sheet = openTuSheet(sheetName);
  if (!sheet) return;
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf(colName) !== -1) return;
  var newCol = lastCol + 1;
  var cell = sheet.getRange(1, newCol);
  cell.setValue(colName);
  applyFormalSheetFormatting(sheet, sheetName);
  Logger.log('[ensureTuColumn] Kolom ' + colName + ' ditambahkan ke ' + sheetName + ' (kolom ' + newCol + ').');
}

/**
 * Pastikan seluruh kolom master pegawai ada di Master_Pegawai_POA (Self-Healing).
 */
var _PEG_COLS_CHECKED_EXEC = false;
function ensurePegawaiMasterColumns(force) {
  if (!force && _PEG_COLS_CHECKED_EXEC) return;
  _PEG_COLS_CHECKED_EXEC = true;

  var cache = (typeof CacheService !== 'undefined') ? CacheService.getScriptCache() : null;
  if (!force && cache && cache.get('sikap_peg_cols_v2') === '1') return;

  var requiredCols = [
    'PegawaiID', 'NIP', 'Nama', 'UnitKerja', 'LingkupData', 'KelompokJabatan',
    'JabatanLengkap', 'TingkatKelas', 'KategoriRumpun', 'StatusKepegawaian', 'StatusAktif',
    'SubJenisSDM', 'NomorIdentitas', 'InstitusiAsal', 'TanggalMulai', 'TanggalSelesai',
    'MentorPembimbing', 'CatatanTambahan', 'DokumenSK_URL', 'DokumenSK_EvidenceID',
    'StatusPenempatan', 'KapalPenempatan', 'UkuranBaju', 'UkuranSepatu',
    'SumberSinkronisasi', 'StatusKelengkapanTU', 'CatatanDisparitas',
    'UpdatedAt', 'UpdatedBy'
  ];

  // Self-healing skema dalam satu pembacaan header & batch write
  try {
    var sheet = openTuSheet(SHEET_TU.PEGAWAI_MASTER);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) return;

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];
    var missing = [];
    for (var i = 0; i < requiredCols.length; i++) {
      if (headers.indexOf(requiredCols[i]) === -1) missing.push(requiredCols[i]);
    }
    var schemaMutated = false;
    if (missing.length > 0) {
      sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
      headers = headers.concat(missing);
      lastCol = headers.length;
      schemaMutated = true;
    }

    if (lastRow >= 2) {
      var colStatusAktif = headers.indexOf('StatusAktif') + 1;
      var colStatusPeg   = headers.indexOf('StatusKepegawaian') + 1;
      if (colStatusAktif > 0 && colStatusPeg > 0) {
        var range = sheet.getRange(2, 1, lastRow - 1, lastCol);
        var values = range.getValues();
        var changed = false;

        for (var r = 0; r < values.length; r++) {
          var row = values[r];
          var saVal = String(row[colStatusAktif - 1] || '').trim().toUpperCase();
          if (saVal === 'MAGANG' || saVal === 'PJLP' || saVal === 'P3K' || saVal === 'P3K_PARUH_WAKTU') {
            row[colStatusPeg - 1] = saVal;
            row[colStatusAktif - 1] = 'AKTIF';
            changed = true;
          }
        }

        if (changed) {
          range.setValues(values);
          schemaMutated = true;
          Logger.log('[ensurePegawaiMasterColumns] Berhasil memperbaiki pergeseran kolom status pada Master_Pegawai_POA.');
        }
      }
    }

    if (schemaMutated) {
      applyFormalSheetFormatting(sheet, SHEET_TU.PEGAWAI_MASTER);
    }
    if (cache) { try { cache.put('sikap_peg_cols_v2', '1', 21600); } catch (eC2) {} }
  } catch (errRepair) {
    Logger.log('[ensurePegawaiMasterColumns] Notice repair: ' + errRepair.message);
  }
}

/**
 * Pastikan sebuah kolom ada pada sheet transaksi (self-heal). Berguna saat
 * skema bertambah setelah sheet dibuat (mis. kolom KapalID — Fase 12):
 * `_createSheetWithHeaders` di Setup.js meng-skip sheet yang sudah ada, jadi
 * kolom baru tidak otomatis muncul di DB terlanjur dibuat. Fungsi ini men-
 * append header jika belum ada. Idempoten & aman dipanggil berulang.
 *
 * @param {string} sheetName  - nama sheet transaksi
 * @param {string} colName    - nama kolom yang dipastikan ada
 */
function ensureTxColumn(sheetName, colName) {
  var sheet = openTransaksiSheet(sheetName);
  if (!sheet) return;
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf(colName) !== -1) return;
  var newCol = lastCol + 1;
  var cell = sheet.getRange(1, newCol);
  cell.setValue(colName);
  cell.setFontWeight('bold');
  cell.setBackground('#E8EAF6');
  Logger.log('[ensureTxColumn] Kolom ' + colName + ' ditambahkan ke ' + sheetName + ' (kolom ' + newCol + ').');
}

/**
 * Pastikan kolom ada pada sheet master (self-heal), setara ensureTxColumn
 * tapi untuk sheet di SIKAP_Master. Dipakai untuk kolom `Users.NIP` yang
 * ditambahkan setelah DB terlanjur dibuat.
 *
 * @param {string} sheetName  - nama sheet master
 * @param {string} colName    - nama kolom yang dipastikan ada
 */
function ensureMasterColumn(sheetName, colName) {
  var sheet = openMasterSheet(sheetName);
  if (!sheet) return;
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf(colName) !== -1) return;
  var newCol = lastCol + 1;
  var cell = sheet.getRange(1, newCol);
  cell.setValue(colName);
  cell.setFontWeight('bold');
  cell.setBackground('#E8EAF6');
  Logger.log('[ensureMasterColumn] Kolom ' + colName + ' ditambahkan ke ' +
    sheetName + ' (kolom ' + newCol + ').');
}

/**
 * Pastikan kolom NIP ada di sheet Users. Self-heal supaya akun yang dibuat
 * sebelum kolom ini ada tetap terbaca (NIP kosong, bukan error).
 */
function ensureUsersNipColumn() {
  ensureMasterColumn(SHEET_MASTER.USERS, 'NIP');
}

/**
 * Pastikan sheet master `Opsi` ada (self-heal). Jika belum ada (mis. Master
 * dibuat sebelum revisi Opsi Fase 9/10), buat dengan header sesuai
 * DATA_SCHEMA.md `Opsi`. Aman dipanggil berulang (idempoten).
 * @returns {Sheet}
 */
function ensureOpsiSheet() {
  var existing = openMasterSheet(SHEET_MASTER.OPSI);
  if (existing) { ensureOpsiColumns(existing); return existing; }
  var ss = SpreadsheetApp.openById(getSpreadsheetIds().masterId);
  var sheet = ss.insertSheet(SHEET_MASTER.OPSI);
  sheet.getRange(1, 1, 1, 7)
    .setValues([['Kode', 'Urutan', 'Label', 'LabelTampil', 'Aktif', 'DibuatOleh', 'DibuatAt']])
    .setFontWeight('bold')
    .setBackground('#E8EAF6');
  sheet.setFrozenRows(1);
  Logger.log('[ensureOpsiSheet] Sheet ' + SHEET_MASTER.OPSI + ' dibuat otomatis.');
  return sheet;
}

/**
 * Self-heal kolom `LabelTampil` pada sheet `Opsi` yang dibuat sebelum kolom ini
 * ada (versi lama 6 kolom). Kolom baru disisipkan tepat setelah `Label` supaya
 * urutan kolom tetap sama dengan header kanonik di `DATA_SCHEMA.md` — seluruh
 * penulisan baris Opsi memakai urutan header tersebut, sehingga bila kolom baru
 * hanya ditambahkan di posisi terakhir, baris baru akan masuk ke kolom keliru.
 * Aman dipanggil berulang (idempoten).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function ensureOpsiColumns(sheet) {
  if (!sheet) return;
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf('LabelTampil') !== -1) return;

  // Sisipkan sesudah kolom `Label`; bila header tidak wajar, sisipkan di akhir.
  var labelCol = headers.indexOf('Label') + 1; // 1-based
  if (labelCol < 1) labelCol = lastCol;
  sheet.insertColumnAfter(labelCol);
  var newCol = labelCol + 1;

  var cell = sheet.getRange(1, newCol);
  cell.setValue('LabelTampil');
  cell.setFontWeight('bold');
  cell.setBackground('#E8EAF6');

  // Baris lama yang LabelTampil-nya kosong diisi dengan nilai Label agar UI
  // tidak menampilkan token mentah untuk data yang sudah ada.
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, newCol, lastRow - 1, 1)
      .setValues(sheet.getRange(2, labelCol, lastRow - 1, 1).getValues());
  }
  Logger.log('[ensureOpsiColumns] Kolom LabelTampil disisipkan di ' + SHEET_MASTER.OPSI +
    ' (kolom ' + newCol + '), diisi dari kolom Label.');
}

/**
 * Baca isi sheet, aman terhadap sheet null (mis. belum dibuat) → [].
 */
function readOpsiRows() {
  var sheet = ensureOpsiSheet();
  return sheetToObjects(sheet);
}

// ===========================================================================
// ROW READING
// ===========================================================================

/**
 * Konversi seluruh data sheet ke array of plain objects, header row sebagai key.
 * Row 1 = header, row 2+ = data.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {Object[]}
 */
function sheetToObjects(sheet) {
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  return data.slice(1).map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

/**
 * Cari satu baris berdasarkan nilai di kolom tertentu (string match, case-insensitive tidak dipakai).
 *
 * @param {Sheet} sheet
 * @param {string} colName   - nama kolom header
 * @param {*}     value      - nilai yang dicari
 * @returns {{obj: Object, rowIndex: number}|null} rowIndex = 1-based (termasuk baris header)
 */
function findRowByField(sheet, colName, value) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  var headers = data[0];
  var colIdx = headers.indexOf(colName);
  if (colIdx === -1) return null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colIdx]) === String(value)) {
      var obj = {};
      headers.forEach(function (h, j) { obj[h] = data[i][j]; });
      return { obj: obj, rowIndex: i + 1 };
    }
  }
  return null;
}

/**
 * Cari baris berdasarkan RowID (shorthand untuk findRowByField(..., 'RowID', ...)).
 */
function findRowById(sheet, rowId) {
  return findRowByField(sheet, 'RowID', rowId);
}

/**
 * Baca seluruh baris detail (sheet rincian, mis. TX_OperasiLaut_Detail) dan
 * kelompokkan berdasarkan ParentRowID. Baris dengan ParentRowID kosong/tidak
 * diinput diabaikan.
 *
 * @param {string} sheetName - nama sheet detail
 * @returns {Object} peta { ParentRowID_String: [rowObj, ...] } tanpa kolom
 *                   dinamis pandas; nilai string dikembalikan apa adanya.
 */
function readDetailByParent(sheetName) {
  var map = {};
  var rows = sheetToObjects(openTransaksiSheet(sheetName));
  rows.forEach(function (r) {
    var parent = (r.ParentRowID === undefined || r.ParentRowID === null) ? '' : String(r.ParentRowID);
    if (!parent) return;
    if (!map[parent]) map[parent] = [];
    map[parent].push(r);
  });
  return map;
}

// ===========================================================================
// ROW WRITING
// ===========================================================================

/**
 * Naikkan penanda versi data transaksi — kunci invalidasi cache agregat
 * DashboardService. `appendRowData()` dan `updateRowCells()` di bawah
 * memanggilnya otomatis setiap ada tulis baris transaksi.
 *
 * Latar belakang: `dashboard_getOverview` & `dashboard_profilKapal` memakai
 * CacheService (TTL 300 detik) per user. Tanpa penanda ini, agregat Ikhtisar
 * kedaluwarsa hingga 5 menit setelah submit/revisi/anulir — contoh kasus:
 * anulir laporan mingguan Tata Usaha tidak mengubah kartu "Realisasi
 * SP2D/Akrual (YTD)". Penanda ikut masuk ke cache key, sehingga setelah ada
 * tulis, cache lama tidak terpakai lagi dan agregat dihitung ulang.
 */
function bumpTxVersion(sheetName) {
  try {
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get('DASH_TX_VERSION')) || 0;
    // TTL 6 jam — jauh melebihi TTL cache agregat (300s) agar penanda tidak
    // lebih dulu kedaluwarsa daripada entri yang dijaganya.
    cache.put('DASH_TX_VERSION', String(n + 1), 21600);
    try {
      PropertiesService.getScriptProperties().setProperty('DASH_TX_VERSION', String(n + 1));
    } catch (eP) {}

    // Metadata transaksi terakhir (Fase 17 — Live Telemetry)
    var meta = {
      timestamp: new Date().toISOString(),
      sheet: sheetName || 'Transaksi'
    };
    cache.put('METADATA_LAST_TX', JSON.stringify(meta), 21600);
    try {
      PropertiesService.getScriptProperties().setProperty('METADATA_LAST_TX', JSON.stringify(meta));
    } catch (eProp) {}
  } catch (ignore) { /* tidak pernah mengganggu alur tulis */ }
}

/**
 * Append satu baris baru ke sheet, mengikuti urutan kolom di header row.
 * Kolom yang tidak ada di dataObj diisi string kosong.
 *
 * @param {Sheet}  sheet
 * @param {Object} dataObj - {namaKolom: nilai}
 */
function appendRowData(sheet, dataObj) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) {
    var colName = String(h || '').trim();
    var val = dataObj[colName];
    return _normalizeSikapWriteValue(colName, val);
  });
  sheet.appendRow(row);
  bumpTxVersion(sheet.getName ? sheet.getName() : 'Transaksi');
  SpreadsheetApp.flush();
}

/**
 * Update satu atau lebih sel di baris tertentu (1-based rowIndex).
 *
 * @param {Sheet}  sheet
 * @param {number} rowIndex  - baris yang diupdate (1-based; baris header = 1, data mulai dari 2)
 * @param {Object} updates   - {namaKolom: nilaiBaru}
 */
function updateRowCells(sheet, rowIndex, updates) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Object.keys(updates).forEach(function (colName) {
    var colIndex = headers.indexOf(colName) + 1; // 1-based
    if (colIndex > 0) {
      sheet.getRange(rowIndex, colIndex).setValue(_normalizeSikapWriteValue(colName, updates[colName]));
    }
  });
  bumpTxVersion(sheet.getName ? sheet.getName() : 'Transaksi');
  SpreadsheetApp.flush();
}

// ===========================================================================
// SANITIZER NAMA KANONIK & FORMATTER GOOGLE SHEET FORMAL
// ===========================================================================

/**
 * Membersihkan & menormalisasi nama personel menjadi HURUF BESAR (A-Z dan spasi tunggal saja):
 * menghapus gelar depan/belakang, tanda petik/apostrof ("Ma'ruf" -> "MARUF"), titik, koma, tanda hubung, dan angka.
 * Identik dengan aturan kanonik NAKHODA.
 *
 * @param {string} rawNama
 * @returns {string}
 */
function sanitizeNamaPersonel(rawNama) {
  if (!rawNama || typeof rawNama !== 'string') return '';
  var s = String(rawNama).toUpperCase().trim();

  for (var i = 0; i < 5; i++) {
    s = s.replace(/^(?:CAPT|PROF|DR|DRS|DRA|IR|HJ|H)(?:\.|\s+)+(?=[A-Z])/i, '');
  }

  s = s.replace(/,\s*(?:S\.?|M\.?|A\.?|D\.?|P\.?|B\.?|L\.?|DR|IR|SE|SH|ST|MM|MH|MSI|MT|SP|ANT|ATT).*$/i, '');
  s = s.replace(/,\s*[A-Z.\s]{2,15}$/, function (m) {
    return /\b(?:AMD|SST|STR|SPI|SIK|SKEL|SPD|SKOM|SSOS|SPKP|MMAR|MSI|SE|SH|ST|SP|MM|MH)\b/.test(m.replace(/\./g, '')) ? '' : m;
  });

  for (var j = 0; j < 2; j++) {
    s = s.replace(/\s+(?:A\.?\s*MD(?:\.?\s*PI)?|S\.?\s*ST(?:\.?\s*PI)?|S\.?\s*TR(?:\.?\s*PI)?|S\.?\s*PI|S\.?\s*IK|S\.?\s*KEL|S\.?\s*PKP|S\.?\s*KOM|S\.?\s*SOS|S\.?\s*PD|S\.?\s*H|S\.?\s*E|S\.?\s*T|S\.?\s*P|M\.?\s*MAR|M\.?\s*SI|M\.?\s*M|M\.?\s*H|ANT[\s-]*[IV1-4]+|ATT[\s-]*[IV1-4]+)\.?$/i, '');
  }

  s = s.replace(/['’`´]/g, '');
  s = s.replace(/[^A-Z\s]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

var _SIKAP_FMT_WIDTHS = {
  PegawaiID: 115, NIP: 165, NomorIdentitas: 165, NomorSertifikat: 165,
  Nama: 240, UnitKerja: 230, LingkupData: 155, KelompokJabatan: 165,
  JabatanLengkap: 260, TingkatKelas: 120, KategoriRumpun: 135, StatusKepegawaian: 155,
  StatusAktif: 120, SubJenisSDM: 165, InstitusiAsal: 200,
  TanggalMulai: 120, TanggalSelesai: 120, BerlakuSampai: 120,
  MentorPembimbing: 200, CatatanTambahan: 280, DokumenSK_URL: 220, DokumenSK_EvidenceID: 155,
  StatusPenempatan: 165, KapalPenempatan: 175, UkuranBaju: 105, UkuranSepatu: 110,
  SumberSinkronisasi: 155, StatusKelengkapanTU: 170, CatatanDisparitas: 320,
  KodeBarang: 130, NUP: 90, RowID: 145, Periode: 115, Status: 115,
  UpdatedAt: 155, UpdatedBy: 145, Timestamp: 155
};

var _SIKAP_FMT_PLAIN_TEXT = {
  PegawaiID: true, NIP: true, NomorIdentitas: true, NomorSertifikat: true,
  UkuranSepatu: true, KodeBarang: true, NUP: true, RowID: true, RecordID: true,
  KodePelatihan: true, AsetID: true, PenghapusanID: true, EvidenceID: true
};

var _SIKAP_FMT_ISO_DATES = {
  TanggalMulai: true, TanggalSelesai: true, BerlakuSampai: true,
  TanggalPerolehan: true, TanggalVerifikasi: true, TglPajakTahunan: true,
  TglStnkLimaTahunan: true, TanggalSuratUsulan: true, TanggalSuratPersetujuan: true, TanggalSK: true
};

var _SIKAP_FMT_TIMESTAMPS = {
  UpdatedAt: true, Timestamp: true, UploadedAt: true, VoidedAt: true
};

var _SIKAP_FMT_CENTER = {
  PegawaiID: true, NIP: true, NomorIdentitas: true, TingkatKelas: true,
  KategoriRumpun: true, StatusKepegawaian: true, StatusAktif: true, Status: true,
  TanggalMulai: true, TanggalSelesai: true, BerlakuSampai: true,
  StatusPenempatan: true, UkuranBaju: true, UkuranSepatu: true,
  SumberSinkronisasi: true, StatusKelengkapanTU: true, UpdatedAt: true
};

var _SIKAP_FMT_WRAP = {
  CatatanTambahan: true, CatatanDisparitas: true, JabatanLengkap: true,
  Keterangan: true, VoidReason: true, Catatan: true
};

function _formatSikapIsoDate(val) {
  if (!val && val !== 0) return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
      return Utilities.formatDate(val, 'GMT+7', 'yyyy-MM-dd');
    }
    var y = val.getFullYear();
    var m = val.getMonth() + 1;
    var d = val.getDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
  }
  var s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return s;
}

function _normalizeSikapWriteValue(colName, val) {
  if (val === undefined || val === null) return '';
  if (_SIKAP_FMT_ISO_DATES[colName] && val !== '') return _formatSikapIsoDate(val);
  if (_SIKAP_FMT_PLAIN_TEXT[colName] && val !== '') return String(val);
  return val;
}

/**
 * Menerapkan standar Google Sheet formal & human-readable pada SIKAP:
 * - Header Navy/Slate (#0F172A untuk Master, #1E293B untuk Transaksi), teks putih tebal, 34px, baris beku
 * - Baris data 26px, zebra banding (#FFFFFF / #F8FAFC), border #E2E8F0, vertikal middle
 * - Format Plain Text '@' pada NIP/NIK/NomorSertifikat/UkuranSepatu agar bebas notasi ilmiah
 * - Tanggal ISO yyyy-mm-dd & lebar kolom proporsional
 */
function applyFormalSheetFormatting(sheet, sheetName) {
  try {
    if (!sheet || typeof sheet.getLastColumn !== 'function') return;
    var lastCol = sheet.getLastColumn();
    var lastRow = typeof sheet.getLastRow === 'function' ? sheet.getLastRow() : 1;
    if (lastCol < 1 || lastRow < 1) return;

    var name = String(sheetName || (typeof sheet.getName === 'function' ? sheet.getName() : '')).trim();
    var isMaster = name.indexOf('Master') === 0 || name === 'Users' || name === 'Divisi' || name === 'Opsi';
    var headerBg = isMaster ? '#0F172A' : '#1E293B';

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];
    var headerRange = sheet.getRange(1, 1, 1, lastCol);

    if (typeof headerRange.setBackground === 'function') headerRange.setBackground(headerBg);
    if (typeof headerRange.setFontColor === 'function') headerRange.setFontColor('#FFFFFF');
    if (typeof headerRange.setFontFamily === 'function') headerRange.setFontFamily('Arial');
    if (typeof headerRange.setFontSize === 'function') headerRange.setFontSize(10);
    if (typeof headerRange.setFontWeight === 'function') headerRange.setFontWeight('bold');
    if (typeof headerRange.setVerticalAlignment === 'function') headerRange.setVerticalAlignment('middle');
    if (typeof headerRange.setWrap === 'function') headerRange.setWrap(true);
    if (typeof sheet.setFrozenRows === 'function') sheet.setFrozenRows(1);
    if (typeof sheet.setRowHeight === 'function') sheet.setRowHeight(1, 34);

    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c] || '').trim();
      var colIdx = c + 1;
      if (typeof sheet.setColumnWidth === 'function') {
        sheet.setColumnWidth(colIdx, _SIKAP_FMT_WIDTHS[h] || 145);
      }
      var hCell = sheet.getRange(1, colIdx);
      if (typeof hCell.setHorizontalAlignment === 'function') {
        hCell.setHorizontalAlignment(_SIKAP_FMT_CENTER[h] ? 'center' : 'left');
      }
    }

    if (lastRow < 2) return;
    var numRows = lastRow - 1;
    var dataRange = sheet.getRange(2, 1, numRows, lastCol);

    if (typeof dataRange.setFontFamily === 'function') dataRange.setFontFamily('Arial');
    if (typeof dataRange.setFontSize === 'function') dataRange.setFontSize(10);
    if (typeof dataRange.setFontColor === 'function') dataRange.setFontColor('#0F172A');
    if (typeof dataRange.setVerticalAlignment === 'function') dataRange.setVerticalAlignment('middle');
    if (typeof dataRange.setBorder === 'function') {
      dataRange.setBorder(true, true, true, true, true, true, '#E2E8F0', null);
    }

    if (typeof dataRange.setBackgrounds === 'function') {
      var bgs = [];
      for (var r = 0; r < numRows; r++) {
        var rowBg = (r % 2 === 1) ? '#F8FAFC' : '#FFFFFF';
        var rowColors = [];
        for (var k = 0; k < lastCol; k++) rowColors.push(rowBg);
        bgs.push(rowColors);
      }
      dataRange.setBackgrounds(bgs);
    }

    if (typeof sheet.setRowHeights === 'function') {
      sheet.setRowHeights(2, numRows, 26);
    }

    for (var ci = 0; ci < headers.length; ci++) {
      var colName = String(headers[ci] || '').trim();
      var colRange = sheet.getRange(2, ci + 1, numRows, 1);

      if (_SIKAP_FMT_PLAIN_TEXT[colName] && typeof colRange.setNumberFormat === 'function') {
        colRange.setNumberFormat('@');
      } else if (_SIKAP_FMT_ISO_DATES[colName] && typeof colRange.setNumberFormat === 'function') {
        colRange.setNumberFormat('yyyy-mm-dd');
      } else if (_SIKAP_FMT_TIMESTAMPS[colName] && typeof colRange.setNumberFormat === 'function') {
        colRange.setNumberFormat('yyyy-mm-dd hh:mm:ss');
      }

      if (typeof colRange.setHorizontalAlignment === 'function') {
        colRange.setHorizontalAlignment(_SIKAP_FMT_CENTER[colName] ? 'center' : 'left');
      }
      if (typeof colRange.setWrap === 'function') {
        colRange.setWrap(!!_SIKAP_FMT_WRAP[colName]);
      }
    }
  } catch (eFmt) {
    Logger.log('[applyFormalSheetFormatting] Notice: ' + eFmt.message);
  }
}

// ===========================================================================
// OPSI (daftar pilihan dinamis)
// ===========================================================================

/**
 * Ambil daftar label aktif untuk sebuah grup Opsi (DATA_SCHEMA.md `Opsi`).
 * Sumber TUNGGAL = sheet master `Opsi` (tidak ada daftar hardcoded lagi; isi
 * awal di-seed oleh `Setup.js`). Baris NON-aktif hanya berguna untuk riwayat —
 * tidak dimasukkan. Hasil di-cache ke CacheService (TTL 10 menit) supaya
 * getOptions/KPI/tren tidak scan ulang tiap kali.
 *
 * @param {string} kode - kunci dari OPSI_KODE
 * @returns {string[]} token label terurut (Urutan)
 */
function getOpsiList(kode) {
  var key = 'OPSI_LIST_' + String(kode || '');
  var cache = CacheService.getScriptCache();
  var cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through */ }
  }

  var orderMap = {};

  try {
    readOpsiRows().forEach(function (r) {
      if (String(r['Kode']) !== String(kode)) return;
      var label = String(r['Label'] || '').trim();
      if (!label) return;
      var aktif = String(r['Aktif']).toLowerCase() !== 'false';
      if (!aktif) return;
      var urutan = Number(r['Urutan']) || 0;
      orderMap[label] = urutan;
    });
  } catch (e) {
    Logger.log('[getOpsiList] ' + e.message);
  }

  var labels = Object.keys(orderMap).sort(function (a, b) {
    return (orderMap[a] || 0) - (orderMap[b] || 0) || a.localeCompare(b);
  });
  try { cache.put(key, JSON.stringify(labels), 600); } catch (e) { /* ignore */ }
  return labels;
}

/**
 * Peta `token -> teks tampilan` untuk satu grup Opsi, untuk seluruh baris di
 * sheet — termasuk token yang sudah dinonaktifkan dan token yang tidak lagi
 * ada di `getOpsiList` — agar baris riwayat lama tetap tampil memakai nama
 * yang benar, bukan token mentah.
 *
 * @param {string} kode
 * @returns {Object.<string,string>}
 */
function getOpsiLabelMap(kode) {
  var key = 'OPSI_MAP_' + String(kode || '');
  var cache = CacheService.getScriptCache();
  var cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through */ }
  }

  var map = {};
  try {
    readOpsiRows().forEach(function (r) {
      if (String(r['Kode']) !== String(kode)) return;
      var label = String(r['Label'] || '').trim();
      if (!label) return;
      // `LabelTampil` tetap dipakai walau token sudah dinonaktifkan — status
      // `Aktif` hanya mengatur boleh/tidaknya token muncul di dropdown
      // (lihat getOpsiList), bukan menghapus nama yang tampil di riwayat.
      // Token tanpa `LabelTampil` (baris lama) memakai `Label` sebagai gantinya.
      var tampil = String(r['LabelTampil'] || '').trim() || label;
      map[label] = tampil;
    });
  } catch (e) {
    Logger.log('[getOpsiLabelMap] ' + e.message);
  }
  try { cache.put(key, JSON.stringify(map), 600); } catch (e) { /* ignore */ }
  return map;
}

/**
 * Label tampilan satu token enum; jatuh ke token itu sendiri bila tidak ada
 * di peta (atau token kosong → string kosong). Dipakai untuk pesan error yang
 * perlu menyebut nama ramah, bukan token mentah.
 * @param {string} kode grup enum (OPSI_KODE)
 * @param {string} token
 * @returns {string}
 */
function getOpsiLabel(kode, token) {
  var t = String(token || '').trim().toUpperCase();
  if (!t) return '';
  var map = getOpsiLabelMap(kode);
  return map[t] || t;
}

/**
 * Item siap pakai untuk combobox typeahead: `value` = token yang disimpan ke
 * sheet transaksi, `label` = teks yang dilihat user.
 *
 * @param {string} kode
 * @returns {Array<{value:string,label:string}>}
 */
function getOpsiItems(kode) {
  var map = getOpsiLabelMap(kode);
  return getOpsiList(kode).map(function (token) {
    return { value: token, label: map[token] || token };
  });
}

/**
 * Detail baris opsi satu grup (untuk halaman Master Data): semua baris
 * termasuk non-aktif, berikut urutan & teks tampilan.
 * @param {string} kode
 * @returns {Array<{label:string, labelTampil:string, aktif:boolean, urutan:number}>}
 */
function getOpsiDetail(kode) {
  var out = [];
  var seen = {};
  try {
    readOpsiRows().forEach(function (r) {
        if (String(r['Kode']) !== String(kode)) return;
        var label = String(r['Label'] || '').trim();
        if (!label || seen[label]) return;
        seen[label] = true;
        var tampil = String(r['LabelTampil'] || '').trim();
        out.push({
          label: label,
          labelTampil: tampil || label,
          aktif: String(r['Aktif']).toLowerCase() !== 'false',
          urutan: Number(r['Urutan']) || 0
        });
      });
  } catch (e) {
    Logger.log('[getOpsiDetail] ' + e.message);
  }
  out.sort(function (a, b) { return a.urutan - b.urutan || a.label.localeCompare(b.label); });
  return out;
}

/** Buang cache daftar & peta label Opsi (dipanggil setelah Superadmin mengubah sheet). */
function clearOpsiCache() {
  var cache = CacheService.getScriptCache();
  Object.keys(OPSI_KODE).forEach(function (k) {
    var kode = OPSI_KODE[k];
    cache.remove('OPSI_LIST_' + kode);
    cache.remove('OPSI_MAP_' + kode);
  });
}

/**
 * Global audit logging helper — mencatat transaksi ke SHEET_LOG.AUDIT_LOG di SIKAP_Log.
 *
 * @param {string} userId - ID pengguna yang melakukan aksi
 * @param {string} aksi - Jenis aksi (e.g. 'SUBMIT_PEGAWAI', 'ANULIR_PEGAWAI', 'CREATE_BMN', etc.)
 * @param {string} sheetTarget - Nama sheet target
 * @param {string} rowIdTarget - ID baris target
 * @param {string|Object} alasanOrDetail - Alasan atau objek detail aksi
 */
function logAudit(userId, aksi, sheetTarget, rowIdTarget, alasanOrDetail) {
  try {
    var sheet = openLogSheet(SHEET_LOG.AUDIT_LOG);
    if (!sheet) return;
    var alasanStr = '';
    if (typeof alasanOrDetail === 'object' && alasanOrDetail !== null) {
      try {
        alasanStr = JSON.stringify(alasanOrDetail);
      } catch (errJson) {
        alasanStr = String(alasanOrDetail);
      }
    } else {
      alasanStr = String(alasanOrDetail || '');
    }

    appendRowData(sheet, {
      'LogID':       'LOG-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(),
      'UserID':      userId,
      'Aksi':        aksi,
      'SheetTarget': sheetTarget,
      'RowIDTarget': rowIdTarget,
      'Alasan':      alasanStr,
      'Timestamp':   new Date()
    });
  } catch (e) {
    Logger.log('[logAudit] ' + e.message);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sanitizeNamaPersonel: sanitizeNamaPersonel,
    applyFormalSheetFormatting: applyFormalSheetFormatting
  };
}

