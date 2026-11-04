/**
 * data/SeedAllSystem.js
 * Script Seeding Komprehensif SIKAP (Sistem Informasi Keuangan, Anggaran, dan Kepegawaian)
 * Subbag Tata Usaha — Direktorat Pemantauan dan Operasi Armada (Dit. POA) KKP RI.
 *
 * Mengisi seluruh modul dan sheet secara menyeluruh, kredibel, formal, dan berintegritas relasional:
 * 1. Users (Akun resmi Superadmin, Direktur, Kadiv TU, Staf Anggaran, Staf BMN, Staf SDM, Staf TU)
 * 2. Master Lokasi UPT (16 Pangkalan/Stasiun/Pusat KKP) & Master BMN Kategori (8 Kategori Kemenkeu)
 * 3. Master Standar Pelatihan (38 kelompok jabatan resmi STCW-F)
 * 4. Master Paket & TX_Paket_Progres (12 Paket Pengadaan TA 2026 lintas 6 tahap: PERSIAPAN s.d. SELESAI)
 * 5. TX_TataUsaha (44 minggu realisasi anggaran TA 2026 lengkap: Revisi DIPA ke-1 & ke-2, SP2D vs Akrual)
 * 6. TX_TU_Pegawai (Headcount bulanan 5 kategori aparatur Subbag TU: PNS, P3K, P3K Paruh Waktu, PJLP, Magang)
 * 7. TX_TU_Pelatihan_Pegawai (38 sertifikasi resmi kepelautan STCW-F: ANKAPIN, ATKAPIN, BST-F, AFF, dsb.)
 * 8. TX_BMN_Aset (44 unit inventaris fisik granular anti-jebret dengan geotagging presisi & Haversine distance)
 * 9. TX_BMN_Penghapusan & TX_BMN_Penghapusan_Detail (3 berkas usulan legal Kemenkeu: BAST, SK, Draft)
 * 10. TX_Evidence (Metadata berkas bukti digital: SK, Surat Usulan, Foto Fisik, Kontrak di Google Drive)
 *
 * CATATAN INTEGRITAS KEPEGAWAIAN:
 * Master_Pegawai_POA DILINDUNGI PENUH (READ-ONLY) dan TIDAK DIHAPUS / DI-OVERWRITE agar data autentik
 * aparatur KKP yang sudah ada tetap murni dan tidak tercemar.
 */

/**
 * Runner Utama: Menjalankan seluruh proses seeding sistem secara sekuensial.
 *
 * @param {boolean} [force=true] Default true: membersihkan data transaksi lama dan men-seed ulang.
 * @returns {Object} Ringkasan hasil seeding setiap modul.
 */
function seedAllSikapSystem(force) {
  if (force === undefined || force === null) force = true;

  var results = {
    startedAt: new Date().toISOString(),
    forceMode: force,
    steps: {},
    success: true
  };

  try {
    Logger.log('[seedAllSikapSystem] Memulai proses seeding komprehensif SIKAP (force=' + force + ')...');

    // 1. Seed Master Users
    results.steps.users = seedUsers(force);

    // 2. Seed Master UPT & BMN Kategori
    results.steps.masterUptKat = seedMasterUptDanKategori(force);

    // 3. Master Standar Pelatihan Kurikulum SKJ
    results.steps.standarPelatihan = seedStandarPelatihan(force);

    // 4. Master Pegawai POA (PROTEKSI PENUH: TIDAK DISENTUH SAMA SEKALI)
    results.steps.pegawaiMaster = {
      status: 'PROTECTED',
      action: 'NONE',
      message: 'Master_Pegawai_POA dilindungi penuh (read-only) untuk menjaga keaslian data personel yang sudah ada.'
    };

    // 5. Seed Realisasi Anggaran TX_TataUsaha (44 Minggu TA 2026)
    results.steps.anggaran = seedTataUsahaAnggaran(force);

    // 6. Seed Master Paket & TX_Paket_Progres (12 Paket 6 Tahap)
    results.steps.paketPengadaan = seedPaketPengadaan(force);

    // 7. Seed Headcount Kepegawaian TX_TU_Pegawai (5 Kategori)
    results.steps.kepegawaian = seedKepegawaianHeadcount(force);

    // 8. Seed Kelulusan Sertifikat Pelatihan TX_TU_Pelatihan_Pegawai
    results.steps.pelatihanPegawai = seedPelatihanPegawai(force);

    // 9. Seed Inventaris BMN Fisik Granular TX_BMN_Aset (Anti-Jebret: 44 unit)
    results.steps.bmnAset = seedBMNAset(force);

    // 10. Seed Berkas Usulan Penghapusan Kemenkeu TX_BMN_Penghapusan & Detail
    results.steps.bmnPenghapusan = seedBMNPenghapusan(force);

    // 11. Seed Metadata Lampiran TX_Evidence
    results.steps.evidence = seedEvidence(force);

    results.completedAt = new Date().toISOString();
    Logger.log('[seedAllSikapSystem] Seeding selesai dengan sukses: ' + JSON.stringify(results.steps));
    return results;
  } catch (err) {
    results.success = false;
    results.error = err.message;
    results.stack = err.stack || '';
    Logger.log('[seedAllSikapSystem] ERROR: ' + err.message);
    return results;
  }
}

/**
 * Helper membersihkan data transaksi (baris 2 ke bawah) tanpa menghapus baris header.
 */
function _clearSheetData(sheet) {
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow > 1 && lastCol > 0) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }
}

// ===========================================================================
// 1. SEED USERS & AKUN PEJABAT / STAF RESMI
// ===========================================================================
function seedUsers(force) {
  var sheet = openMasterSheet(SHEET_MASTER.USERS);
  var lastRow = sheet.getLastRow();

  if (!force && lastRow > 1) {
    return { status: 'SKIPPED', count: lastRow - 1, message: 'Sudah terdapat data user.' };
  }

  if (force && lastRow > 1) {
    _clearSheetData(sheet);
  }

  var now = new Date();
  var usersList = [
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
      'USR-DIREKTUR-001',
      'Dr. Ir. Pung Nugroho Saksono, M.St.',
      'direktur.poa@kkp.go.id',
      '196803241993031001',
      hashPassword('Direktur2026!'),
      '',
      ROLE.DIREKTUR,
      USER_STATUS.APPROVED,
      'USR-SUPERADMIN-001',
      now,
      now
    ],
    [
      'USR-KADIV-TU-001',
      'Hendra Setiawan, S.St.Pi., M.Si.',
      'kasubbag.tu@kkp.go.id',
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
      'USR-STAF-ANGG-001',
      'Rian Pratama, S.E.',
      'staf.anggaran@kkp.go.id',
      '199104182015031004',
      hashPassword('Anggaran2026!'),
      'DIV-TU',
      ROLE.STAF,
      USER_STATUS.APPROVED,
      'USR-KADIV-TU-001',
      now,
      now
    ],
    [
      'USR-STAF-BMN-001',
      'Dewi Anggraini, S.Kom.',
      'staf.bmn@kkp.go.id',
      '199308252018012003',
      hashPassword('Bmn2026!'),
      'DIV-TU',
      ROLE.STAF,
      USER_STATUS.APPROVED,
      'USR-KADIV-TU-001',
      now,
      now
    ],
    [
      'USR-STAF-SDM-001',
      'Fajar Wicaksono, S.A.P.',
      'staf.pegawai@kkp.go.id',
      '199011032014021001',
      hashPassword('Pegawai2026!'),
      'DIV-TU',
      ROLE.STAF,
      USER_STATUS.APPROVED,
      'USR-KADIV-TU-001',
      now,
      now
    ],
    [
      'USR-STAF-TU-001',
      'Siti Nurhaliza, A.Md.',
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

  sheet.getRange(2, 1, usersList.length, usersList[0].length).setValues(usersList);
  return { status: 'SEEDED', count: usersList.length };
}

// ===========================================================================
// 2. SEED MASTER LOKASI UPT & MASTER BMN KATEGORI
// ===========================================================================
function seedMasterUptDanKategori(force) {
  var tuId = ensureTuSpreadsheet();
  var ss = SpreadsheetApp.openById(tuId);

  var uSheet = ss.getSheetByName(SHEET_TU.MASTER_LOKASI_UPT);
  if (force && uSheet && uSheet.getLastRow() > 1) {
    _clearSheetData(uSheet);
  }
  if (typeof _seedLokasiUpt === 'function') {
    _seedLokasiUpt(ss);
  }

  var kSheet = ss.getSheetByName(SHEET_TU.MASTER_BMN_KATEGORI);
  if (force && kSheet && kSheet.getLastRow() > 1) {
    _clearSheetData(kSheet);
  }
  if (typeof _seedBmnKategori === 'function') {
    _seedBmnKategori(ss);
  }

  return { status: 'SEEDED', uptCount: 16, kategoriCount: 8 };
}

// ===========================================================================
// 3. SEED MASTER STANDAR PELATIHAN (KURIKULUM SKJ STCW-F)
// ===========================================================================
function seedStandarPelatihan(force) {
  var sSheet = openTuSheet(SHEET_TU.STANDAR_PELATIHAN);
  var sLast = sSheet.getLastRow();

  if (!force && sLast > 1) {
    return { status: 'SKIPPED', count: sLast - 1 };
  }

  if (typeof STANDAR_PELATIHAN_RESMI === 'object') {
    if (force && sLast > 1) {
      _clearSheetData(sSheet);
    }
    var sRows = [];
    for (var kj in STANDAR_PELATIHAN_RESMI) {
      var arr = STANDAR_PELATIHAN_RESMI[kj];
      if (Array.isArray(arr)) {
        for (var i = 0; i < arr.length; i++) {
          var itm = arr[i];
          sRows.push([
            itm.kode,
            kj,
            itm.tingkat || 'ALL',
            itm.kat || 'TEKNIS',
            itm.nama,
            itm.wajib ? true : false,
            i + 1
          ]);
        }
      }
    }
    if (sRows.length > 0) {
      sSheet.getRange(2, 1, sRows.length, sRows[0].length).setValues(sRows);
      return { status: 'SEEDED', count: sRows.length };
    }
  }
  return { status: 'UNCHANGED', count: sLast - 1 };
}

// ===========================================================================
// 4. SEED REALISASI ANGGARAN TX_TATAUSAHA (44 MINGGU TA 2026)
// ===========================================================================
function seedTataUsahaAnggaran(force) {
  var sheet = openTuSheet(SHEET_TU.TATA_USAHA);
  var lastRow = sheet.getLastRow();

  if (!force && lastRow > 1) {
    return { status: 'SKIPPED', count: lastRow - 1 };
  }

  if (force && lastRow > 1) {
    _clearSheetData(sheet);
  }

  var rows = [];
  var dStart = new Date(2026, 0, 5, 9, 30, 0); // Senin, 5 Januari 2026

  // Evolusi Pagu DIPA TA 2026:
  // - Awal: Reguler Rp 16,5 M | ABT Rp 0
  // - Revisi 1 (Minggu 19 / Mei 2026): ABT +Rp 1,5 M
  // - Revisi 2 (Minggu 36 / September 2026): Reguler Rp 18,5 M | ABT Rp 3,2 M (Total Rp 21,7 M)
  var paguReguler = 16500000000;
  var paguABT = 0;

  for (var w = 1; w <= 44; w++) {
    var curDate = new Date(dStart.getTime() + (w - 1) * 7 * 24 * 60 * 60 * 1000);
    var y = curDate.getFullYear();
    var m = curDate.getMonth() + 1;
    var mm = (m < 10 ? '0' : '') + m;
    var weekOfMonth = Math.ceil(curDate.getDate() / 7);
    var ww = (weekOfMonth < 10 ? '0' : '') + weekOfMonth;
    var periode = y + '-' + mm + '-W' + ww;

    var catatanRevisi = '';

    // Minggu ke-19 (Mei): Revisi DIPA Ke-1
    if (w === 19) {
      paguABT = 1500000000; // +1.5 M ABT
      catatanRevisi = 'Revisi DIPA Ke-1: Alokasi ABT Dukungan Logistik Operasi Armada Pengawasan Terpadu';
    }

    // Minggu ke-36 (September): Revisi DIPA Ke-2
    if (w === 36) {
      paguReguler = 18500000000; // +2 M Reguler
      paguABT = 3200000000;     // +1.7 M ABT
      catatanRevisi = 'Revisi DIPA Ke-2: Optimalisasi Belanja Barang Operasional & BBM Kapal Pengawas Semester II';
    }

    // Hitung realisasi mingguan yang dikalibrasi realistis:
    // Kumulatif akhir (Week 44 - Awal November):
    // - Total SP2D: ~Rp 16,58 M (76,4% dari Pagu Rp 21,7 M)
    // - Total Akrual: ~Rp 17,63 M (81,3% dari Pagu Rp 21,7 M)
    var sp2dReg = 0;
    var sp2dAbt = 0;
    var akruReg = 0;
    var akruAbt = 0;

    if (w <= 8) {
      // Q1 Awal: UP/TUP dan Gaji Pokok
      sp2dReg = Math.round((70000000 + (w * 10000000)) / 1000) * 1000;
      akruReg = Math.round(sp2dReg * 1.12 / 1000) * 1000;
    } else if (w <= 18) {
      // Q1 Akhir - Q2 Awal: Kontrak belanja barang & pemeliharaan termin 1
      sp2dReg = Math.round((180000000 + ((w - 8) * 15000000)) / 1000) * 1000;
      akruReg = Math.round(sp2dReg * 1.10 / 1000) * 1000;
    } else if (w <= 35) {
      // Q2 - Q3: Patroli laut puncak & pengadaan barang
      sp2dReg = Math.round((280000000 + ((w - 18) * 12000000)) / 1000) * 1000;
      sp2dAbt = Math.round((50000000 + ((w - 18) * 4500000)) / 1000) * 1000;
      akruReg = Math.round(sp2dReg * 1.06 / 1000) * 1000;
      akruAbt = Math.round(sp2dAbt * 1.08 / 1000) * 1000;
    } else {
      // Q4: Percepatan penyerapan akhir tahun
      sp2dReg = Math.round((360000000 + ((w - 35) * 14000000)) / 1000) * 1000;
      sp2dAbt = Math.round((85000000 + ((w - 35) * 6000000)) / 1000) * 1000;
      akruReg = Math.round(sp2dReg * 1.03 / 1000) * 1000;
      akruAbt = Math.round(sp2dAbt * 1.04 / 1000) * 1000;
    }

    var totalSP2D = sp2dReg + sp2dAbt;
    var totalAkrual = akruReg + akruAbt;
    var rowId = 'TU-2026-' + (w < 10 ? '000' : '00') + w;

    rows.push([
      rowId,
      'DIV-TU',
      periode,
      'USR-STAF-ANGG-001',
      curDate,
      ROW_STATUS.ACTIVE,
      '',
      '',
      '',
      '',
      paguReguler,
      paguABT,
      totalSP2D,
      totalAkrual,
      sp2dReg,
      sp2dAbt,
      akruReg,
      akruAbt,
      catatanRevisi
    ]);
  }

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  return { status: 'SEEDED', count: rows.length };
}

// ===========================================================================
// 5. SEED MASTER PAKET & TX_PAKET_PROGRES (12 PAKET LINTAS 6 TAHAP)
// ===========================================================================
function seedPaketPengadaan(force) {
  var masterSheet = openTuSheet(SHEET_TU.MASTER_PAKET);
  var progresSheet = openTuSheet(SHEET_TU.PAKET_PROGRES);

  var mLast = masterSheet.getLastRow();
  var pLast = progresSheet.getLastRow();

  if (!force && mLast > 1 && pLast > 1) {
    return { status: 'SKIPPED', count: mLast - 1 };
  }

  if (force && mLast > 1) {
    _clearSheetData(masterSheet);
  }
  if (force && pLast > 1) {
    _clearSheetData(progresSheet);
  }

  // 12 Master Paket Resmi TA 2026
  var masterData = [
    ['PKT-2026-001', 'Pengadaan Bahan Bakar Minyak (BBM) Solar Industri Kapal Pengawas Zona Barat', 'DIV-TU', 2026, 4250000000, 'BARANG'],
    ['PKT-2026-002', 'Pemeliharaan Rutin Mesin Induk & Aux Engine Kapal Pengawas KP Orca 01', 'DIV-TU', 2026, 1450000000, 'JASA_LAINNYA'],
    ['PKT-2026-003', 'Pengadaan Sistem Radar Maritim Terintegrasi ARPA Kapal Pengawas Kelas II', 'DIV-TU', 2026, 2800000000, 'BARANG'],
    ['PKT-2026-004', 'Pengadaan Drone Taktis Surveillance Pengawasan Kawasan Konservasi Perairan', 'DIV-TU', 2026, 950000000, 'BARANG'],
    ['PKT-2026-005', 'Jasa Asuransi Perlindungan Risiko Kerja Awak Kapal Pengawas Kelautan', 'DIV-TU', 2026, 680000000, 'JASA_LAINNYA'],
    ['PKT-2026-006', 'Pengadaan Pakaian Dinas Lapangan (PDL) & Kelengkapan Operasional Awak Kapal', 'DIV-TU', 2026, 540000000, 'BARANG'],
    ['PKT-2026-007', 'Pelatihan Sertifikasi Kepelautan STCW-F (BST-F, AFF, ANKAPIN) Awak Kapal', 'DIV-TU', 2026, 480000000, 'JASA_LAINNYA'],
    ['PKT-2026-008', 'Pemeliharaan Fasilitas Dermaga Tambat Kapal Pengawas Pangkalan Lampulo', 'DIV-TU', 2026, 1150000000, 'KONSTRUKSI'],
    ['PKT-2026-009', 'Pengadaan Perangkat Keras Komputer & Server Database Operasi Armada Dit. POA', 'DIV-TU', 2026, 750000000, 'BARANG'],
    ['PKT-2026-010', 'Pengadaan Teropong Malam (Night Vision Thermal Binocular) Operasi Armada', 'DIV-TU', 2026, 620000000, 'BARANG'],
    ['PKT-2026-011', 'Sewa Jaringan Komunikasi Data Transponder Satelit VMS Armada Pengawasan', 'DIV-TU', 2026, 1800000000, 'JASA_LAINNYA'],
    ['PKT-2026-012', 'Jasa Konsultansi Pengawasan Teknis Pemeliharaan Dok Kapal Pengawas Armada', 'DIV-TU', 2026, 280000000, 'KONSULTANSI']
  ];
  masterSheet.getRange(2, 1, masterData.length, masterData[0].length).setValues(masterData);

  // Progres Paket (Representasi 6 Tahap Pipeline: PERSIAPAN, PEMILIHAN, KONTRAK, PELAKSANAAN, BAST, SELESAI)
  var tsBase = new Date(2026, 9, 28, 10, 0, 0); // 28 Oktober 2026
  var progresRows = [
    // 1. SELESAI
    [
      'PKT-2026-0001-A1', 'DIV-TU', '2026-10-W04', 'USR-STAF-ANGG-001', tsBase,
      ROW_STATUS.ACTIVE, '', '', '', '',
      'PKT-2026-001', 'SELESAI', 4180000000, 'PT Pertamina Patra Niaga (Persero)', 'SPK.008/DIT.POA/TU/PL.110/I/2026',
      100.0, 4180000000,
      'Penyaluran BBM Solar Industri HSD untuk 12 armada kapal pengawas zona barat tuntas 100% dan telah disahkan PPK.',
      'https://drive.google.com/file/d/sample-pkt-bbm-001/view'
    ],
    // 2. SELESAI
    [
      'PKT-2026-0005-A1', 'DIV-TU', '2026-10-W04', 'USR-STAF-ANGG-001', tsBase,
      ROW_STATUS.ACTIVE, '', '', '', '',
      'PKT-2026-005', 'SELESAI', 672500000, 'PT Asuransi Jasa Indonesia (Jasindo)', 'SPK.012/DIT.POA/TU/PL.510/II/2026',
      100.0, 672500000,
      'Polis asuransi untuk 243 awak kapal pengawas telah aktif penuh untuk masa pertanggungan 12 bulan kalender TA 2026.',
      'https://drive.google.com/file/d/sample-pkt-asuransi-005/view'
    ],
    // 3. BAST
    [
      'PKT-2026-0004-A1', 'DIV-TU', '2026-10-W04', 'USR-STAF-ANGG-001', tsBase,
      ROW_STATUS.ACTIVE, '', '', '', '',
      'PKT-2026-004', 'BAST', 915000000, 'PT Dirgantara Aero Perkasa', 'SPK.038/DIT.POA/TU/PL.220/IV/2026',
      100.0, 915000000,
      'Uji terbang operasional (commissioning test) lolos 100%; BAST No. BA-042/TU/X/2026 telah ditandatangani PPK dan Penyedia.',
      'https://drive.google.com/file/d/sample-pkt-drone-004/view'
    ],
    // 4. BAST
    [
      'PKT-2026-0006-A1', 'DIV-TU', '2026-10-W04', 'USR-STAF-ANGG-001', tsBase,
      ROW_STATUS.ACTIVE, '', '', '', '',
      'PKT-2026-006', 'BAST', 525000000, 'CV Bahari Mulia Konveksi', 'SPK.051/DIT.POA/TU/PL.140/V/2026',
      100.0, 525000000,
      'Seluruh paket seragam PDL, sepatu lars, pelampung otomatis (life jacket) telah didistribusikan ke 14 pangkalan/stasiun UPT.',
      'https://drive.google.com/file/d/sample-pkt-seragam-006/view'
    ],
    // 5. PELAKSANAAN
    [
      'PKT-2026-0002-A1', 'DIV-TU', '2026-10-W04', 'USR-STAF-ANGG-001', tsBase,
      ROW_STATUS.ACTIVE, '', '', '', '',
      'PKT-2026-002', 'PELAKSANAAN', 1395000000, 'PT Samudera Perkasa Marine Batam', 'SPK.024/DIT.POA/TU/PL.420/III/2026',
      82.5, 976500000,
      'Penggantian turbocharger dan overhaul cylinder head mesin kanan telah selesai; saat ini sedang sea trial di perairan Selat Riau.',
      'https://drive.google.com/file/d/sample-pkt-orca-002/view'
    ],
    // 6. PELAKSANAAN
    [
      'PKT-2026-0003-A1', 'DIV-TU', '2026-10-W04', 'USR-STAF-ANGG-001', tsBase,
      ROW_STATUS.ACTIVE, '', '', '', '',
      'PKT-2026-003', 'PELAKSANAAN', 2720000000, 'PT Citra Radar Mandiri', 'SPK.045/DIT.POA/TU/PL.310/IV/2026',
      65.0, 1632000000,
      'Unit display processor dan transceiver telah tiba di Pangkalan Bitung; tim teknisi sedang melakukan instalasi scanner di mast anjungan.',
      'https://drive.google.com/file/d/sample-pkt-radar-003/view'
    ],
    // 7. PELAKSANAAN
    [
      'PKT-2026-0008-A1', 'DIV-TU', '2026-10-W04', 'USR-STAF-ANGG-001', tsBase,
      ROW_STATUS.ACTIVE, '', '', '', '',
      'PKT-2026-008', 'PELAKSANAAN', 1085000000, 'CV Aceh Bahari Konstruksi', 'SPK.063/DIT.POA/TU/PL.710/VI/2026',
      71.0, 542500000,
      'Pengecoran bollard dan fender dermaga sisi timur telah selesai; deviasi Kurva S +2.3% lebih cepat dari target.',
      'https://drive.google.com/file/d/sample-pkt-dermaga-008/view'
    ],
    // 8. PELAKSANAAN
    [
      'PKT-2026-0009-A1', 'DIV-TU', '2026-10-W04', 'USR-STAF-ANGG-001', tsBase,
      ROW_STATUS.ACTIVE, '', '', '', '',
      'PKT-2026-009', 'PELAKSANAAN', 728000000, 'PT Indo Cyber Solusindo', 'SPK.071/DIT.POA/TU/PL.320/VII/2026',
      50.0, 364000000,
      'Server rack Fujitsu dan 6 unit PC Workstation telah dikirim ke Gedung Mina Bahari IV Lt. 3; menunggu termin kedua.',
      'https://drive.google.com/file/d/sample-pkt-server-009/view'
    ],
    // 9. KONTRAK
    [
      'PKT-2026-0007-A1', 'DIV-TU', '2026-10-W04', 'USR-STAF-ANGG-001', tsBase,
      ROW_STATUS.ACTIVE, '', '', '', '',
      'PKT-2026-007', 'KONTRAK', 465000000, 'BPPTL Jakarta (Kemenhub)', 'SPK.078/DIT.POA/TU/PL.440/VIII/2026',
      35.0, 93000000,
      'Gelombang I (30 orang) telah menyelesaikan diklat di BPPTL; Gelombang II dijadwalkan mulai 17 November 2026.',
      'https://drive.google.com/file/d/sample-pkt-diklat-007/view'
    ],
    // 10. KONTRAK
    [
      'PKT-2026-0011-A1', 'DIV-TU', '2026-10-W04', 'USR-STAF-ANGG-001', tsBase,
      ROW_STATUS.ACTIVE, '', '', '', '',
      'PKT-2026-011', 'KONTRAK', 1745000000, 'PT Pasifik Satelit Nusantara (PSN)', 'SPK.089/DIT.POA/TU/PL.350/IX/2026',
      25.0, 349000000,
      'Aktivasi transponder satelit Inmarsat-C dan Iridium pada 42 armada kapal pengawas telah aktif berjalan sejak 1 Oktober 2026.',
      'https://drive.google.com/file/d/sample-pkt-vms-011/view'
    ],
    // 11. PEMILIHAN
    [
      'PKT-2026-0010-A1', 'DIV-TU', '2026-10-W04', 'USR-STAF-ANGG-001', tsBase,
      ROW_STATUS.ACTIVE, '', '', '', '',
      'PKT-2026-010', 'PEMILIHAN', 0, '— (Tahap Tender LPSE)', '—',
      15.0, 0,
      'Tahap pembuktian kualifikasi dan evaluasi teknis penawaran penyedia di portal LPSE Kementerian Kelautan dan Perikanan.',
      ''
    ],
    // 12. PERSIAPAN
    [
      'PKT-2026-0012-A1', 'DIV-TU', '2026-10-W04', 'USR-STAF-ANGG-001', tsBase,
      ROW_STATUS.ACTIVE, '', '', '', '',
      'PKT-2026-012', 'PERSIAPAN', 0, '— (Penyusunan HPS)', '—',
      5.0, 0,
      'Penyusunan Dokumen Kerangka Acuan Kerja (KAK) dan Penetapan HPS oleh Pejabat Pembuat Komitmen (PPK).',
      ''
    ]
  ];

  progresSheet.getRange(2, 1, progresRows.length, progresRows[0].length).setValues(progresRows);
  return { status: 'SEEDED', masterCount: masterData.length, progresCount: progresRows.length };
}

// ===========================================================================
// 6. SEED HEADCOUNT KEPEGAWAIAN TX_TU_PEGAWAI (5 KATEGORI)
// ===========================================================================
function seedKepegawaianHeadcount(force) {
  var sheet = openTuSheet(SHEET_TU.PEGAWAI);
  var lastRow = sheet.getLastRow();

  if (!force && lastRow > 1) {
    return { status: 'SKIPPED', count: lastRow - 1 };
  }

  if (force && lastRow > 1) {
    _clearSheetData(sheet);
  }

  var rows = [];
  var dStart = new Date(2026, 0, 15, 10, 0, 0); // 15 Januari 2026

  // Snapshot bulanan Januari s.d. Oktober 2026 (10 bulan)
  var monthlySnapshots = [
    { pns: 36, p3k: 14, p3kPw: 6, pjlp: 18, magang: 0, ket: 'Kondisi awal headcount Subbag TU TA 2026' },
    { pns: 36, p3k: 14, p3kPw: 6, pjlp: 18, magang: 0, ket: 'Penetapan formasi kerja semester I' },
    { pns: 37, p3k: 14, p3kPw: 6, pjlp: 18, magang: 0, ket: '1 PNS mutasi masuk dari Pangkalan PSDKP Batam' },
    { pns: 37, p3k: 14, p3kPw: 6, pjlp: 18, magang: 2, ket: 'Penerimaan 2 taruna magang riset Politeknik AUP Jakarta' },
    { pns: 37, p3k: 14, p3kPw: 6, pjlp: 18, magang: 2, ket: 'Rotasi internal tim verifikasi pertanggungjawaban LS' },
    { pns: 38, p3k: 14, p3kPw: 6, pjlp: 18, magang: 2, ket: '1 PNS promosi jabatan fungsional Pengelola Pengadaan' },
    { pns: 38, p3k: 14, p3kPw: 6, pjlp: 18, magang: 4, ket: 'Penambahan 2 mahasiswa magang MBKM Universitas Maritim' },
    { pns: 38, p3k: 14, p3kPw: 6, pjlp: 18, magang: 4, ket: 'Evaluasi kinerja triwulan II tenaga PJLP' },
    { pns: 38, p3k: 14, p3kPw: 6, pjlp: 18, magang: 4, ket: 'Pembaruan register kepegawaian semester II' },
    { pns: 38, p3k: 14, p3kPw: 6, pjlp: 18, magang: 4, ket: 'Data headcount aktif posisi 31 Oktober 2026' }
  ];

  for (var i = 0; i < monthlySnapshots.length; i++) {
    var snap = monthlySnapshots[i];
    var snapDate = new Date(dStart.getFullYear(), i, 15, 10, 0, 0);
    var m = i + 1;
    var periode = '2026-' + (m < 10 ? '0' : '') + m;

    var cats = [
      { kat: 'PNS', jml: snap.pns },
      { kat: 'P3K', jml: snap.p3k },
      { kat: 'P3K_PARUH_WAKTU', jml: snap.p3kPw },
      { kat: 'PJLP', jml: snap.pjlp },
      { kat: 'MAGANG', jml: snap.magang }
    ];

    for (var c = 0; c < cats.length; c++) {
      var rowId = 'PEG-2026-' + (m < 10 ? '0' : '') + m + '-' + (c + 1);
      rows.push([
        rowId,
        'DIV-TU',
        periode,
        'USR-STAF-SDM-001',
        snapDate,
        ROW_STATUS.ACTIVE,
        '',
        '',
        '',
        '',
        cats[c].kat,
        cats[c].jml,
        snap.ket
      ]);
    }
  }

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  return { status: 'SEEDED', count: rows.length };
}

// ===========================================================================
// 7. SEED SERTIFIKASI PELATIHAN PEGAWAI TX_TU_PELATIHAN_PEGAWAI
// ===========================================================================
function seedPelatihanPegawai(force) {
  var sheet = openTuSheet(SHEET_TU.PELATIHAN_PEGAWAI);
  var lastRow = sheet.getLastRow();

  if (!force && lastRow > 1) {
    return { status: 'SKIPPED', count: lastRow - 1 };
  }

  if (force && lastRow > 1) {
    _clearSheetData(sheet);
  }

  // Ambil referensi pegawai dari Master_Pegawai_POA (READ-ONLY, TIDAK DIUBAH)
  var pSheet = openTuSheet(SHEET_TU.PEGAWAI_MASTER);
  var pRows = sheetToObjects(pSheet);
  if (pRows.length === 0) {
    return { status: 'SKIPPED', reason: 'Master_Pegawai_POA belum terisi.' };
  }

  var rows = [];
  var nowStr = new Date().toISOString();

  // Pola sertifikasi STCW-F untuk personel kapal dan pengawas
  var certTemplates = [
    { kode: 'TRN-NKH-01', nama: 'Sertifikat Keahlian Pelaut Nautika (ANKAPIN Tingkat I / II / ANT)', masaTh: 5 },
    { kode: 'TRN-NKH-02', nama: 'Basic Safety Training Fisheries (BST / BST-F)', masaTh: 5 },
    { kode: 'TRN-NKH-03', nama: 'Advanced Fire Fighting (AFF)', masaTh: 5 },
    { kode: 'TRN-NKH-06', nama: 'Radar Simulator & Automatic Radar Plotting Aid (ARPA)', masaTh: 5 },
    { kode: 'TRN-NKH-07', nama: 'Electronic Chart Display and Information System (ECDIS)', masaTh: 5 },
    { kode: 'TRN-TKN-01', nama: 'Sertifikat Keahlian Pelaut Teknika (ATKAPIN Tingkat I / II / ATT)', masaTh: 5 },
    { kode: 'TRN-TKN-02', nama: 'Basic Safety Training Fisheries (BST / BST-F Teknika)', masaTh: 5 },
    { kode: 'TRN-PPNS-01', nama: 'Diklat Pejabat Penyidik Pegawai Negeri Sipil (PPNS) Perikanan', masaTh: 0 },
    { kode: 'TRN-PENG-01', nama: 'Diklat Dasar Jabatan Fungsional Pengawas Perikanan', masaTh: 0 }
  ];

  var samplePegawai = pRows.slice(0, 20); // Ambil 20 personel pertama dari master riil
  var certCounter = 1;

  for (var p = 0; p < samplePegawai.length; p++) {
    var peg = samplePegawai[p];
    var pegId = String(peg['PegawaiID'] || 'PEG-' + (p + 1));
    var nip = String(peg['NIP'] || '19850101201001100' + p);
    var kel = String(peg['KelompokJabatan'] || '');

    var assignedCerts = [];
    if (kel.indexOf('Nahkoda') !== -1 || kel.indexOf('Mualim') !== -1) {
      assignedCerts = [certTemplates[0], certTemplates[1], certTemplates[2], certTemplates[3]];
    } else if (kel.indexOf('Mesin') !== -1 || kel.indexOf('Masinis') !== -1 || kel.indexOf('KKM') !== -1) {
      assignedCerts = [certTemplates[5], certTemplates[6], certTemplates[2]];
    } else {
      assignedCerts = [certTemplates[1], certTemplates[7], certTemplates[8]];
    }

    for (var c = 0; c < assignedCerts.length; c++) {
      var cert = assignedCerts[c];
      var thLulus = 2021 + ((p + c) % 4);
      var expDate = '';
      var statusLulus = 'SUDAH_LULUS';

      if (cert.masaTh > 0) {
        var expYear = thLulus + cert.masaTh;
        expDate = expYear + '-06-30';
        if (expYear <= 2026) {
          statusLulus = (c === 0 && p % 3 === 0) ? 'PERLU_PEMBARUAN' : 'SUDAH_LULUS';
        }
      }

      var noCert = '62.' + (10 + (p % 20)) + '.' + thLulus + '.' + ('000000' + certCounter).slice(-6);
      var recordId = 'CERT-20261028-' + ('0000' + certCounter).slice(-4);

      rows.push([
        recordId,
        pegId,
        nip,
        cert.kode,
        cert.nama,
        statusLulus,
        noCert,
        thLulus,
        expDate,
        'EV-CERT-' + ('0000' + certCounter).slice(-4),
        'https://drive.google.com/file/d/sample-cert-' + certCounter + '/view',
        nowStr,
        'SYSTEM_SEED'
      ]);
      certCounter++;
    }
  }

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  return { status: 'SEEDED', count: rows.length };
}

// ===========================================================================
// 8. SEED INVENTARIS BMN FISIK GRANULAR TX_BMN_ASET (ANTI-JEBRET: 44 ITEM)
// ===========================================================================
function seedBMNAset(force) {
  var sheet = openTuSheet(SHEET_TU.BMN_ASET);
  var lastRow = sheet.getLastRow();

  if (!force && lastRow > 1) {
    return { status: 'SKIPPED', count: lastRow - 1 };
  }

  if (force && lastRow > 1) {
    _clearSheetData(sheet);
  }

  var tsBase = new Date(2026, 9, 25, 11, 0, 0);
  var rows = [];

  // Definisi Katalog Aset Fisik Granular KKP
  var itemTemplates = [
    // 1. Laptop HP EliteBook (6 Unit)
    {
      kode: '3.05.01.04.001', nama: 'Laptop HP EliteBook 840 G8', merk: 'Intel Core i7-1165G7 16GB SSD 512GB',
      kat: 'KAT-TIK', perolehan: '2023-04-12', nilaiBeli: 22500000, nilaiBuku: 11250000,
      kondisi: 'BAIK', lokasi: 'UPT-PUSAT-POA', ruang: 'Ruang Subbag Tata Usaha Lt. 15 Gedung Mina Bahari IV',
      lat: -6.175392, lon: 106.827153, jarak: 0.12, unitCount: 6, kapal: '', status: 'AKTIF', hpsId: ''
    },
    // 2. PC Workstation Dell OptiPlex (4 Unit)
    {
      kode: '3.05.01.04.002', nama: 'PC Workstation Dell OptiPlex 7090 MT', merk: 'Core i9-11900 32GB RTX 3070',
      kat: 'KAT-TIK', perolehan: '2023-06-20', nilaiBeli: 28000000, nilaiBuku: 15400000,
      kondisi: 'BAIK', lokasi: 'UPT-PUSAT-POA', ruang: 'Ruang Pusat Operasi Armada (Pusdalops) Lt. 3',
      lat: -6.175392, lon: 106.827153, jarak: 0.15, unitCount: 4, kapal: '', status: 'AKTIF', hpsId: ''
    },
    // 3. Server Rack Fujitsu Primergy (2 Unit)
    {
      kode: '3.05.01.04.005', nama: 'Server Rack Fujitsu Primergy RX2540 M5', merk: 'Dual Xeon Gold 64GB SAS 4TB Hot-plug',
      kat: 'KAT-TIK', perolehan: '2022-08-15', nilaiBeli: 185000000, nilaiBuku: 92500000,
      kondisi: 'BAIK', lokasi: 'UPT-PUSAT-POA', ruang: 'Ruang Server Data Center Lt. 3 GMB IV',
      lat: -6.175392, lon: 106.827153, jarak: 0.10, unitCount: 2, kapal: '', status: 'AKTIF', hpsId: ''
    },
    // 4. Marine Radar Furuno 1835 (4 Unit - terpasang di Kapal Pengawas)
    {
      kode: '3.05.02.01.002', nama: 'Marine Radar Furuno 1835 4kW 24nm', merk: 'Furuno 1835 Display 10.4 inch Color LCD',
      kat: 'KAT-RADAR', perolehan: '2022-11-10', nilaiBeli: 95000000, nilaiBuku: 57000000,
      kondisi: 'BAIK', lokasi: 'UPT-BTM', ruang: 'Mast / Anjungan Kapal Pengawas',
      lat: 1.082828, lon: 103.955618, jarak: 0.25, unitCount: 4, kapal: 'KP-ORCA-01', status: 'AKTIF', hpsId: ''
    },
    // 5. GPS Marine Navigator Furuno GP-39 (5 Unit)
    {
      kode: '3.05.02.01.003', nama: 'GPS Marine Navigator Furuno GP-39', merk: 'Furuno GP-39 4.2 inch Color LCD Antenna External',
      kat: 'KAT-RADAR', perolehan: '2023-02-18', nilaiBeli: 16500000, nilaiBuku: 11550000,
      kondisi: 'BAIK', lokasi: 'UPT-BTG', ruang: 'Konsol Navigasi KP Orca 02',
      lat: 1.440231, lon: 125.191244, jarak: 0.30, unitCount: 5, kapal: 'KP-ORCA-02', status: 'AKTIF', hpsId: ''
    },
    // 6. Marine VHF Radio ICOM IC-M330 (4 Unit)
    {
      kode: '3.05.02.04.001', nama: 'Marine VHF Transceiver ICOM IC-M330', merk: 'ICOM IC-M330 Class D DSC IPX7 Waterproof',
      kat: 'KAT-RADAR', perolehan: '2023-05-14', nilaiBeli: 8500000, nilaiBuku: 5950000,
      kondisi: 'BAIK', lokasi: 'UPT-LMP', ruang: 'Meja Radio KP Hiu 01',
      lat: 5.586912, lon: 95.328312, jarak: 0.20, unitCount: 4, kapal: 'KP-HIU-01', status: 'AKTIF', hpsId: ''
    },
    // 7. Drone Taktis DJI Matrice 300 RTK (3 Unit)
    {
      kode: '3.05.02.06.001', nama: 'Drone Taktis Surveillance DJI Matrice 300 RTK', merk: 'DJI M300 RTK + Zenmuse H20T Thermal Camera',
      kat: 'KAT-RADAR', perolehan: '2023-09-08', nilaiBeli: 145000000, nilaiBuku: 87000000,
      kondisi: 'BAIK', lokasi: 'UPT-BTM', ruang: 'Gudang Alat Khusus Pangkalan Batam',
      lat: 1.082828, lon: 103.955618, jarak: 0.40, unitCount: 3, kapal: '', status: 'AKTIF', hpsId: ''
    },
    // 8. Teropong Binokular Nikon OceanPro (6 Unit)
    {
      kode: '3.05.02.05.001', nama: 'Teropong Binokular Kapal Nikon OceanPro 7x50', merk: 'Nikon OceanPro 7x50 Compass Waterproof Floating',
      kat: 'KAT-KANTOR', perolehan: '2024-01-20', nilaiBeli: 6200000, nilaiBuku: 4960000,
      kondisi: 'BAIK', lokasi: 'UPT-TUL', ruang: 'Anjungan KP Macan 01',
      lat: -5.628912, lon: 132.748312, jarak: 0.15, unitCount: 6, kapal: 'KP-MACAN-01', status: 'AKTIF', hpsId: ''
    },
    // 9. Kendaraan Operasional Hilux Double Cabin 4x4 (2 Unit)
    {
      kode: '3.01.01.01.002', nama: 'Mobil Patroli Lapangan Toyota Hilux D-Cab 4x4', merk: 'Toyota Hilux 2.4 V 4x4 Diesel A/T Putih',
      kat: 'KAT-KENDARAAN', perolehan: '2022-03-10', nilaiBeli: 465000000, nilaiBuku: 265000000,
      kondisi: 'BAIK', lokasi: 'UPT-BTM', ruang: 'Garasi Kendaraan Dinas Operasional',
      lat: 1.082828, lon: 103.955618, jarak: 0.10, unitCount: 2, kapal: '', status: 'AKTIF', hpsId: ''
    },
    // 10. ASET USULAN PENGHAPUSAN: Laptop Lenovo ThinkPad Rusak Berat (4 Unit -> HPS-2026-0001 / BAST_SELESAI)
    {
      kode: '3.05.01.04.001', nama: 'Laptop Lenovo ThinkPad T440', merk: 'Core i5-4300U 4GB HDD 500GB',
      kat: 'KAT-TIK', perolehan: '2016-08-10', nilaiBeli: 14500000, nilaiBuku: 0,
      kondisi: 'RUSAK_BERAT', lokasi: 'UPT-PUSAT-POA', ruang: 'Gudang Penyimpanan BMN Rusak Lt. 1 GMB IV',
      lat: -6.175392, lon: 106.827153, jarak: 0.08, unitCount: 4, kapal: '', status: 'DIHAPUS', hpsId: 'HPS-2026-0001'
    },
    // 11. ASET USULAN PENGHAPUSAN: Mesin Tempel Yamaha 200 PK Rusak Berat (2 Unit -> HPS-2026-0002 / PERSETUJUAN_KEMENKEU)
    {
      kode: '3.05.02.02.001', nama: 'Mesin Tempel Kapal Yamaha 200 PK 2-Tak', merk: 'Yamaha Outboard Motor E200AETX V6 200HP',
      kat: 'KAT-KAPAL', perolehan: '2017-03-15', nilaiBeli: 120000000, nilaiBuku: 0,
      kondisi: 'RUSAK_BERAT', lokasi: 'UPT-BTM', ruang: 'Bengkel Pemeliharaan Pangkalan Batam',
      lat: 1.082828, lon: 103.955618, jarak: 0.35, unitCount: 2, kapal: 'KP-ORCA-01', status: 'DALAM_PENGHAPUSAN', hpsId: 'HPS-2026-0002'
    },
    // 12. ASET USULAN PENGHAPUSAN: Printer HP LaserJet Pro M428 Rusak Berat (2 Unit -> HPS-2026-0003 / DRAFT_USULAN)
    {
      kode: '3.05.01.05.001', nama: 'Printer Multifungsi HP LaserJet Pro MFP M428fdw', merk: 'HP LaserJet Pro M428 Duplex ADF Network Fax',
      kat: 'KAT-TIK', perolehan: '2018-05-20', nilaiBeli: 8200000, nilaiBuku: 0,
      kondisi: 'RUSAK_BERAT', lokasi: 'UPT-PUSAT-POA', ruang: 'Gudang BMN Lt. 1 GMB IV',
      lat: -6.175392, lon: 106.827153, jarak: 0.09, unitCount: 2, kapal: '', status: 'DALAM_PENGHAPUSAN', hpsId: 'HPS-2026-0003'
    }
  ];

  var nupTracker = {};

  for (var t = 0; t < itemTemplates.length; t++) {
    var tmpl = itemTemplates[t];
    var kBarang = tmpl.kode;
    if (!nupTracker[kBarang]) nupTracker[kBarang] = 1;

    for (var u = 0; u < tmpl.unitCount; u++) {
      var currentNup = nupTracker[kBarang]++;
      var asetId = 'BMN-' + kBarang.replace(/\./g, '') + '-' + ('000' + currentNup).slice(-3);
      var rowId = 'ROW-' + asetId;

      var ket = (tmpl.kondisi === 'RUSAK_BERAT')
        ? 'Aset rusak berat akumulasi pemakaian operasional dinas; suku cadang tidak tersedia.'
        : 'Unit inventaris fisik operasional dalam penguasaan resmi Subbag TU / Pangkalan.';

      rows.push([
        rowId,
        'DIV-TU',
        '2026-10-W04',
        'USR-STAF-BMN-001',
        tsBase,
        ROW_STATUS.ACTIVE,
        '',
        '',
        '',
        '',
        asetId,
        tmpl.kode,
        currentNup,
        tmpl.nama,
        tmpl.merk,
        'BUKU',
        tmpl.kat,
        tmpl.perolehan,
        tmpl.nilaiBeli,
        tmpl.nilaiBuku,
        tmpl.kondisi,
        tmpl.lokasi,
        tmpl.ruang,
        tmpl.lat,
        tmpl.lon,
        'EXIF_GPS',
        tmpl.jarak,
        '2026-10-20',
        'EV-FOTO-' + asetId,
        tmpl.status,
        tmpl.hpsId,
        tmpl.kapal,
        'BATCH-SEED-2026',
        ket
      ]);
    }
  }

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  return { status: 'SEEDED', count: rows.length };
}

// ===========================================================================
// 9. SEED BERKAS USULAN PENGHAPUSAN KEMENKEU & DETAIL
// ===========================================================================
function seedBMNPenghapusan(force) {
  var hpsSheet = openTuSheet(SHEET_TU.BMN_PENGHAPUSAN);
  var dtlSheet = openTuSheet(SHEET_TU.BMN_PENGHAPUSAN_DETAIL);

  var hLast = hpsSheet.getLastRow();
  var dLast = dtlSheet.getLastRow();

  if (!force && hLast > 1 && dLast > 1) {
    return { status: 'SKIPPED', count: hLast - 1 };
  }

  if (force && hLast > 1) {
    _clearSheetData(hpsSheet);
  }
  if (force && dLast > 1) {
    _clearSheetData(dtlSheet);
  }

  var ts1 = new Date(2026, 6, 20, 14, 0, 0); // 20 Juli 2026 (BAST_SELESAI)
  var ts2 = new Date(2026, 8, 25, 11, 30, 0); // 25 September 2026 (PERSETUJUAN_KEMENKEU)
  var ts3 = new Date(2026, 9, 26, 16, 0, 0);  // 26 Oktober 2026 (DRAFT_USULAN)

  var berkasRows = [
    // 1. HPS-2026-0001 (BAST_SELESAI: 4 Unit Lenovo ThinkPad T440)
    [
      'HPS-2026-0001', 'DIV-TU', '2026-07-W03', 'USR-STAF-BMN-001', ts1,
      ROW_STATUS.ACTIVE, '', '', '', '',
      'HPS-2026-0001', 'BAST_SELESAI', 'RUSAK_BERAT',
      'Perangkat komputer usang pengadaan TA 2016 rusak berat dan tidak ekonomis untuk diperbaiki (suku cadang discontinued).',
      'B.112/DJPSDKP.3/TU.210/IV/2026', '2026-04-18', 'https://drive.google.com/file/d/sample-usul-hps-001/view',
      'S-412/MK.6/WKN.07/KNL.01/2026', '2026-06-25', 'KPKNL Jakarta I', 'https://drive.google.com/file/d/sample-izin-hps-001/view',
      'KEP.28/PSDKP/2026', '2026-07-15', 'https://drive.google.com/file/d/sample-sk-hps-001/view',
      'https://drive.google.com/file/d/sample-bast-hps-001/view',
      4, 58000000, 0
    ],
    // 2. HPS-2026-0002 (PERSETUJUAN_KEMENKEU: 2 Unit Mesin Tempel Yamaha 200 PK)
    [
      'HPS-2026-0002', 'DIV-TU', '2026-09-W04', 'USR-STAF-BMN-001', ts2,
      ROW_STATUS.ACTIVE, '', '', '', '',
      'HPS-2026-0002', 'PERSETUJUAN_KEMENKEU', 'RUSAK_BERAT',
      'Mesin tempel 200 PK Pangkalan PSDKP Batam aus/korosi berat akibat pemakaian operasional patroli laut; perbaikan melebihi nilai aset.',
      'B.245/DJPSDKP.3/TU.210/VII/2026', '2026-07-22', 'https://drive.google.com/file/d/sample-usul-hps-002/view',
      'S-189/MK.6/WKN.03/KNL.02/2026', '2026-09-14', 'KPKNL Batam', 'https://drive.google.com/file/d/sample-izin-hps-002/view',
      '', '', '',
      '',
      2, 240000000, 0
    ],
    // 3. HPS-2026-0003 (DRAFT_USULAN: 2 Unit Printer HP LaserJet)
    [
      'HPS-2026-0003', 'DIV-TU', '2026-10-W04', 'USR-STAF-BMN-001', ts3,
      ROW_STATUS.ACTIVE, '', '', '', '',
      'HPS-2026-0003', 'DRAFT_USULAN', 'RUSAK_BERAT',
      'Hasil inventarisasi fisik semester II TA 2026 peralatan kantor printer scanner multifunction kondisi rusak optik dan power supply terbakar.',
      '', '', '',
      '', '', '', '',
      '', '', '',
      '',
      2, 16400000, 0
    ]
  ];
  hpsSheet.getRange(2, 1, berkasRows.length, berkasRows[0].length).setValues(berkasRows);

  // Detail Relasi Junction (TX_BMN_Penghapusan_Detail)
  var detailRows = [
    // Relasi HPS-2026-0001 (4 Laptop ThinkPad)
    ['HPD-2026-0001-1', 'DIV-TU', '2026-07-W03', 'USR-STAF-BMN-001', ts1, ROW_STATUS.ACTIVE, '', '', '', '', 'HPS-2026-0001', 'HPS-2026-0001', 'BMN-3050104001-007', 'RUSAK_BERAT', 0],
    ['HPD-2026-0001-2', 'DIV-TU', '2026-07-W03', 'USR-STAF-BMN-001', ts1, ROW_STATUS.ACTIVE, '', '', '', '', 'HPS-2026-0001', 'HPS-2026-0001', 'BMN-3050104001-008', 'RUSAK_BERAT', 0],
    ['HPD-2026-0001-3', 'DIV-TU', '2026-07-W03', 'USR-STAF-BMN-001', ts1, ROW_STATUS.ACTIVE, '', '', '', '', 'HPS-2026-0001', 'HPS-2026-0001', 'BMN-3050104001-009', 'RUSAK_BERAT', 0],
    ['HPD-2026-0001-4', 'DIV-TU', '2026-07-W03', 'USR-STAF-BMN-001', ts1, ROW_STATUS.ACTIVE, '', '', '', '', 'HPS-2026-0001', 'HPS-2026-0001', 'BMN-3050104001-010', 'RUSAK_BERAT', 0],

    // Relasi HPS-2026-0002 (2 Mesin Tempel Yamaha)
    ['HPD-2026-0002-1', 'DIV-TU', '2026-09-W04', 'USR-STAF-BMN-001', ts2, ROW_STATUS.ACTIVE, '', '', '', '', 'HPS-2026-0002', 'HPS-2026-0002', 'BMN-3050202001-001', 'RUSAK_BERAT', 0],
    ['HPD-2026-0002-2', 'DIV-TU', '2026-09-W04', 'USR-STAF-BMN-001', ts2, ROW_STATUS.ACTIVE, '', '', '', '', 'HPS-2026-0002', 'HPS-2026-0002', 'BMN-3050202001-002', 'RUSAK_BERAT', 0],

    // Relasi HPS-2026-0003 (2 Printer Scanner HP)
    ['HPD-2026-0003-1', 'DIV-TU', '2026-10-W04', 'USR-STAF-BMN-001', ts3, ROW_STATUS.ACTIVE, '', '', '', '', 'HPS-2026-0003', 'HPS-2026-0003', 'BMN-3050105001-005', 'RUSAK_BERAT', 0],
    ['HPD-2026-0003-2', 'DIV-TU', '2026-10-W04', 'USR-STAF-BMN-001', ts3, ROW_STATUS.ACTIVE, '', '', '', '', 'HPS-2026-0003', 'HPS-2026-0003', 'BMN-3050105001-006', 'RUSAK_BERAT', 0]
  ];
  dtlSheet.getRange(2, 1, detailRows.length, detailRows[0].length).setValues(detailRows);

  return { status: 'SEEDED', berkasCount: berkasRows.length, detailCount: detailRows.length };
}

// ===========================================================================
// 10. SEED EVIDENCE METADATA TX_EVIDENCE
// ===========================================================================
function seedEvidence(force) {
  var sheet = openTuSheet(SHEET_TU.EVIDENCE);
  var lastRow = sheet.getLastRow();

  if (!force && lastRow > 1) {
    return { status: 'SKIPPED', count: lastRow - 1 };
  }

  if (force && lastRow > 1) {
    _clearSheetData(sheet);
  }

  var now = new Date();
  var evRows = [
    ['EV-HPS-USUL-001', 'TX_BMN_Penghapusan', 'HPS-2026-0001', 'DRV-FILE-USUL-001', 'Surat_Usulan_Penghapusan_Komputer_2026.pdf', 'application/pdf', 'UPLOAD', 'USR-STAF-BMN-001', now, 'ACTIVE', 'Surat pengantar Direktur POA ke KPKNL'],
    ['EV-HPS-IZIN-001', 'TX_BMN_Penghapusan', 'HPS-2026-0001', 'DRV-FILE-IZIN-001', 'Surat_Persetujuan_KPKNL_Jakarta_I.pdf', 'application/pdf', 'UPLOAD', 'USR-STAF-BMN-001', now, 'ACTIVE', 'Persetujuan resmi DJKN Kemenkeu'],
    ['EV-HPS-SK-001', 'TX_BMN_Penghapusan', 'HPS-2026-0001', 'DRV-FILE-SK-001', 'Keputusan_Penghapusan_Sesditjen_PSDKP.pdf', 'application/pdf', 'UPLOAD', 'USR-STAF-BMN-001', now, 'ACTIVE', 'SK Penghapusan KKP'],
    ['EV-HPS-BAST-001', 'TX_BMN_Penghapusan', 'HPS-2026-0001', 'DRV-FILE-BAST-001', 'BAST_Pemusnahan_Risalah_Lelang_2026.pdf', 'application/pdf', 'UPLOAD', 'USR-STAF-BMN-001', now, 'ACTIVE', 'Berita Acara tuntas'],
    ['EV-PKT-BBM-001', 'TX_Paket_Progres', 'PKT-2026-0001-A1', 'DRV-FILE-PKT-001', 'Kontrak_BBM_Solar_Industri_Zona_Barat.pdf', 'application/pdf', 'DRIVE_LINK_COPY', 'USR-STAF-ANGG-001', now, 'ACTIVE', 'Salinan kontrak PPK'],
    ['EV-PKT-DRONE-004', 'TX_Paket_Progres', 'PKT-2026-0004-A1', 'DRV-FILE-PKT-004', 'Berita_Acara_Serah_Terima_Drone_M300.pdf', 'application/pdf', 'UPLOAD', 'USR-STAF-ANGG-001', now, 'ACTIVE', 'BAST Pengadaan Drone']
  ];

  sheet.getRange(2, 1, evRows.length, evRows[0].length).setValues(evRows);
  return { status: 'SEEDED', count: evRows.length };
}
