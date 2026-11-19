/**
 * services/BMNService.js
 * Modul Tata Usaha: Manajemen Inventaris Barang Milik Negara (BMN) & Siklus Penghapusan Kemenkeu.
 *
 * Mengelola data di spreadsheet dedicated SIKAP_TU:
 * - TX_BMN_Aset: Register fisik inventaris BMN per-item (Anti-Jebret: 1 baris = 1 unit fisik).
 * - TX_BMN_Penghapusan: Berkas usulan penghapusan bertingkat (Kemenkeu / DJKN / KPKNL).
 * - TX_BMN_Penghapusan_Detail: Item aset dalam berkas usulan.
 * - Master_Lokasi_UPT: 15 Pangkalan / Stasiun / Satwas / Kantor Pusat KKP.
 * - Master_BMN_Kategori: Klasifikasi SIMAK/SAKTI & masa manfaat aset.
 */

var _BMN_DIVISI_ID = 'DIV-TU';

// ── RBAC HELPERS ──────────────────────────────────────────

function _bmnRequireSession(token) {
  var session = _getSession(token);
  if (!session || session.status !== USER_STATUS.APPROVED) {
    throw new Error('UNAUTHORIZED: Sesi tidak valid atau belum disetujui.');
  }
  return session;
}

function _bmnAssertRead(session) {
  if (!session || session.status !== USER_STATUS.APPROVED) {
    throw new Error('UNAUTHORIZED: Akun belum aktif.');
  }
  // Semua akun approved diizinkan membaca inventaris BMN untuk visibilitas aset nasional
}

function _bmnAssertWrite(session) {
  assertScope(session, [ROLE.SUPERADMIN, ROLE.KADIV, ROLE.STAF], _BMN_DIVISI_ID);
}

function _bmnAssertVoid(session) {
  if (!session || session.status !== USER_STATUS.APPROVED) {
    throw new Error('UNAUTHORIZED: Akun belum aktif.');
  }
  if (session.role === ROLE.SUPERADMIN || session.role === ROLE.DIREKTUR) return;
  if (session.role === ROLE.KADIV && session.divisiId === _BMN_DIVISI_ID) return;
  throw new Error('UNAUTHORIZED: Anda tidak memiliki wewenang untuk menganulir aset BMN.');
}

// ── HAVERSINE & GEOLOCATION HELPERS ───────────────────────

/**
 * Menghitung jarak lingkaran besar (great-circle distance) dua koordinat GPS dalam kilometer.
 */
function _bmnHaversineKm(lat1, lon1, lat2, lon2) {
  var R = 6371; // Radius bumi dalam km
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/**
 * Mencari UPT terdekat berdasarkan koordinat latitude & longitude.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {Array<Object>} masterUpts
 * @returns {{ lokasiId: string, namaLokasi: string, distanceKm: number }}
 */
function _bmnMatchNearestUpt(lat, lon, masterUpts) {
  if (!lat || !lon || isNaN(lat) || isNaN(lon) || !masterUpts || masterUpts.length === 0) {
    return { lokasiId: 'UPT-PUSAT-POA', namaLokasi: 'Pusat (POA)', distanceKm: null };
  }

  var nearest = null;
  var minDistance = Infinity;

  for (var i = 0; i < masterUpts.length; i++) {
    var u = masterUpts[i];
    var uLat = parseFloat(u['Latitude']);
    var uLon = parseFloat(u['Longitude']);
    if (isNaN(uLat) || isNaN(uLon)) continue;

    var dist = _bmnHaversineKm(lat, lon, uLat, uLon);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = {
        lokasiId: String(u['LokasiID']),
        namaLokasi: String(u['NamaLokasi']),
        distanceKm: dist
      };
    }
  }

  return nearest || { lokasiId: 'UPT-PUSAT-POA', namaLokasi: 'Pusat (POA)', distanceKm: null };
}

// ── AGE & USEFUL LIFE HELPER ──────────────────────────────

/**
 * Menghitung umur aset dan sisa masa manfaat berdasarkan TanggalPerolehan & MasaManfaatTahun.
 */
function _bmnComputeAge(tglPerolehanStr, masaManfaatTahun) {
  if (!tglPerolehanStr) {
    return { umurTahun: 0, umurBulan: 0, sisaManfaatTahun: 0, isExpired: false };
  }

  var tgl = new Date(tglPerolehanStr);
  if (isNaN(tgl.getTime())) {
    return { umurTahun: 0, umurBulan: 0, sisaManfaatTahun: 0, isExpired: false };
  }

  var now = new Date();
  var diffMonths = (now.getFullYear() - tgl.getFullYear()) * 12 + (now.getMonth() - tgl.getMonth());
  if (diffMonths < 0) diffMonths = 0;

  var umurTahun = Math.floor(diffMonths / 12);
  var umurBulan = diffMonths % 12;

  var masaTahun = parseFloat(masaManfaatTahun) || 0;
  var sisaManfaatTahun = 0;
  var isExpired = false;

  if (masaTahun > 0) {
    var totalMasaBulan = masaTahun * 12;
    var sisaBulan = totalMasaBulan - diffMonths;
    if (sisaBulan <= 0) {
      sisaManfaatTahun = 0;
      isExpired = true;
    } else {
      sisaManfaatTahun = Math.round((sisaBulan / 12) * 10) / 10;
      isExpired = false;
    }
  }

  return {
    umurTahun: umurTahun,
    umurBulan: umurBulan,
    sisaManfaatTahun: sisaManfaatTahun,
    isExpired: isExpired
  };
}

// ── PUBLIC API: MASTER DATA BMN ───────────────────────────

var _BMN_DEFAULT_UPTS_BACKEND = [
  { lokasiId: 'UPT-PUSAT-POA', namaLokasi: 'Dit. POA (Pusat KKP Jakarta)', jenis: 'PUSAT', wilayah: 'PUSAT', latitude: -6.175392, longitude: 106.827153, alamat: 'Gedung Mina Bahari IV Lt. 9, Jakarta Pusat' },
  { lokasiId: 'UPT-JKT', namaLokasi: 'Pangkalan PSDKP Jakarta', jenis: 'PANGKALAN', wilayah: 'WPPNRI 711', latitude: -6.110214, longitude: 106.804322, alamat: 'Jl. Muara Baru No. 1, Jakarta Utara' },
  { lokasiId: 'UPT-BTM', namaLokasi: 'Pangkalan PSDKP Batam', jenis: 'PANGKALAN', wilayah: 'WPPNRI 711', latitude: 1.082828, longitude: 103.955618, alamat: 'Jl. Trans Barelang Jembatan II, Batam' },
  { lokasiId: 'UPT-BNO', namaLokasi: 'Pangkalan PSDKP Benoa', jenis: 'PANGKALAN', wilayah: 'WPPNRI 573', latitude: -8.751612, longitude: 115.215541, alamat: 'Pelabuhan Benoa, Denpasar, Bali' },
  { lokasiId: 'UPT-BTG', namaLokasi: 'Pangkalan PSDKP Bitung', jenis: 'PANGKALAN', wilayah: 'WPPNRI 716', latitude: 1.440231, longitude: 125.191244, alamat: 'Jl. Tandurusa, Bitung, Sulawesi Utara' },
  { lokasiId: 'UPT-LMP', namaLokasi: 'Pangkalan PSDKP Lampulo', jenis: 'PANGKALAN', wilayah: 'WPPNRI 572', latitude: 5.586912, longitude: 95.328312, alamat: 'Pelabuhan Perikanan Lampulo, Banda Aceh' },
  { lokasiId: 'UPT-TUL', namaLokasi: 'Pangkalan PSDKP Tual', jenis: 'PANGKALAN', wilayah: 'WPPNRI 718', latitude: -5.628912, longitude: 132.748312, alamat: 'Dumar, Tual, Maluku Tenggara' },
  { lokasiId: 'UPT-BLW', namaLokasi: 'Stasiun PSDKP Belawan', jenis: 'STASIUN', wilayah: 'WPPNRI 571', latitude: 3.784212, longitude: 98.692812, alamat: 'Jl. Pelabuhan Raya, Belawan, Medan' },
  { lokasiId: 'UPT-PTK', namaLokasi: 'Stasiun PSDKP Pontianak', jenis: 'STASIUN', wilayah: 'WPPNRI 711', latitude: -0.026312, longitude: 109.342512, alamat: 'Jl. Raya Sungai Kakap, Pontianak' },
  { lokasiId: 'UPT-CLP', namaLokasi: 'Stasiun PSDKP Cilacap', jenis: 'STASIUN', wilayah: 'WPPNRI 573', latitude: -7.738112, longitude: 109.015212, alamat: 'Jl. Lingkar Penyu, Cilacap, Jawa Tengah' },
  { lokasiId: 'UPT-TRK', namaLokasi: 'Stasiun PSDKP Tarakan', jenis: 'STASIUN', wilayah: 'WPPNRI 716', latitude: 3.303912, longitude: 117.591212, alamat: 'Jl. Yos Sudarso, Juwata, Tarakan' },
  { lokasiId: 'UPT-KPG', namaLokasi: 'Stasiun PSDKP Kupang', jenis: 'STASIUN', wilayah: 'WPPNRI 573', latitude: -10.177212, longitude: 123.607012, alamat: 'Jl. Tenau, Alak, Kupang, NTT' },
  { lokasiId: 'UPT-AMB', namaLokasi: 'Stasiun PSDKP Ambon', jenis: 'STASIUN', wilayah: 'WPPNRI 715', latitude: -3.695412, longitude: 128.181412, alamat: 'Hative Kecil, Sirimau, Ambon' },
  { lokasiId: 'UPT-BIK', namaLokasi: 'Stasiun PSDKP Biak', jenis: 'STASIUN', wilayah: 'WPPNRI 717', latitude: -1.178912, longitude: 136.082512, alamat: 'Jl. Sorido Raya, Biak Kota, Papua' },
  { lokasiId: 'UPT-THN', namaLokasi: 'Stasiun PSDKP Tahuna', jenis: 'STASIUN', wilayah: 'WPPNRI 716', latitude: 3.611112, longitude: 125.492512, alamat: 'Kolongan Beha Baru, Tahuna Barat' },
  { lokasiId: 'UPT-PDG', namaLokasi: 'Stasiun PSDKP Padang', jenis: 'STASIUN', wilayah: 'WPPNRI 572', latitude: -0.957512, longitude: 100.368312, alamat: 'Bungus Teluk Kabung, Padang, Sumbar' }
];

var _BMN_DEFAULT_KAT_BACKEND = [
  { kodeKategori: 'KAT-TIK', namaKategori: 'Peralatan Komputer & TIK', masaManfaatTahun: 4, akunModal: '532111', akunBarang: '521811' },
  { kodeKategori: 'KAT-KAPAL', namaKategori: 'Kapal Pengawas & Motor Tempel', masaManfaatTahun: 10, akunModal: '532115', akunBarang: '521811' },
  { kodeKategori: 'KAT-RADAR', namaKategori: 'Radar, Navigasi & Komunikasi Maritim', masaManfaatTahun: 5, akunModal: '532111', akunBarang: '521811' },
  { kodeKategori: 'KAT-SENJATA', namaKategori: 'Senjata Api Khusus & Perlengkapan Pengawasan', masaManfaatTahun: 10, akunModal: '532119', akunBarang: '521811' },
  { kodeKategori: 'KAT-KANTOR', namaKategori: 'Peralatan & Perlengkapan Kantor', masaManfaatTahun: 5, akunModal: '532111', akunBarang: '521811' },
  { kodeKategori: 'KAT-MEUBEL', namaKategori: 'Mebel & Perabot Kantor', masaManfaatTahun: 5, akunModal: '532111', akunBarang: '521811' },
  { kodeKategori: 'KAT-KENDARAAN', namaKategori: 'Kendaraan Dinas Operasional', masaManfaatTahun: 7, akunModal: '532112', akunBarang: '521811' },
  { kodeKategori: 'KAT-GEDUNG', namaKategori: 'Gedung, Bangunan & Dermaga', masaManfaatTahun: 20, akunModal: '533111', akunBarang: '521811' }
];

/**
 * Mengambil master UPT dan Kategori BMN dari SIKAP_TU.
 */
function bmn_getMasters(token) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertRead(session);

    var uptSheet = openTuSheet(SHEET_TU.MASTER_LOKASI_UPT);
    var katSheet = openTuSheet(SHEET_TU.MASTER_BMN_KATEGORI);

    var uptRows = sheetToObjects(uptSheet).filter(function (r) {
      return String(r['Status'] || 'AKTIF').toUpperCase() === 'AKTIF';
    });

    var katRows = sheetToObjects(katSheet).filter(function (r) {
      return String(r['Status'] || 'AKTIF').toUpperCase() === 'AKTIF';
    });

    // Self-healing: jika sheet master kosong, lakukan auto-seeding
    if (uptRows.length === 0 && typeof _seedLokasiUpt === 'function') {
      try {
        _seedLokasiUpt(uptSheet.getParent());
        uptRows = sheetToObjects(uptSheet).filter(function (r) {
          return String(r['Status'] || 'AKTIF').toUpperCase() === 'AKTIF';
        });
      } catch (eSeedUpt) {
        Logger.log('[bmn_getMasters] Gagal seed UPT: ' + eSeedUpt.message);
      }
    }

    if (katRows.length === 0 && typeof _seedBmnKategori === 'function') {
      try {
        _seedBmnKategori(katSheet.getParent());
        katRows = sheetToObjects(katSheet).filter(function (r) {
          return String(r['Status'] || 'AKTIF').toUpperCase() === 'AKTIF';
        });
      } catch (eSeedKat) {
        Logger.log('[bmn_getMasters] Gagal seed Kategori: ' + eSeedKat.message);
      }
    }

    var uptList = (uptRows.length > 0) ? uptRows.map(function (u) {
      return {
        lokasiId:   String(u['LokasiID']),
        namaLokasi: String(u['NamaLokasi']),
        jenis:      String(u['Jenis']),
        wilayah:    String(u['Wilayah']),
        latitude:   parseFloat(u['Latitude']) || null,
        longitude:  parseFloat(u['Longitude']) || null,
        alamat:     String(u['Alamat'] || '')
      };
    }) : _BMN_DEFAULT_UPTS_BACKEND;

    var kategoriList = (katRows.length > 0) ? katRows.map(function (k) {
      return {
        kodeKategori:     String(k['KodeKategori']),
        namaKategori:     String(k['NamaKategori']),
        masaManfaatTahun: parseFloat(k['MasaManfaatTahun']) || 0,
        akunModal:        String(k['AkunBelanjaModal'] || ''),
        akunBarang:       String(k['AkunBelanjaBarang'] || '')
      };
    }) : _BMN_DEFAULT_KAT_BACKEND;

    return {
      success: true,
      data: {
        uptList: uptList,
        kategoriList: kategoriList
      }
    };
  } catch (e) {
    Logger.log('[bmn_getMasters] ' + e.message);
    return {
      success: true,
      data: {
        uptList: _BMN_DEFAULT_UPTS_BACKEND,
        kategoriList: _BMN_DEFAULT_KAT_BACKEND
      }
    };
  }
}

// ── PUBLIC API: REGISTER INVENTARIS ASET BMN ──────────────

/**
 * Mengambil daftar aset BMN dengan paginasi, pencarian, filter, dan perhitungan umur di server.
 *
 * @param {string} token
 * @param {{
 *   page?: number,
 *   pageSize?: number,
 *   pencatatan?: string,  // 'ALL' | 'BUKU' | 'REGULER'
 *   kondisi?: string,     // 'ALL' | 'BAIK' | 'RUSAK_RINGAN' | 'RUSAK_BERAT'
 *   statusAset?: string,  // 'ALL' | 'AKTIF' | 'DALAM_PENGHAPUSAN' | 'DIHAPUS'
 *   lokasiId?: string,
 *   kategori?: string,
 *   q?: string,
 *   sortBy?: string,
 *   sortDir?: string
 * }} params
 */
function bmn_getAsetList(token, params) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertRead(session);

    params = params || {};
    var page = parseInt(params.page, 10) || 1;
    var pageSize = parseInt(params.pageSize, 10) || 25;
    if (page < 1) page = 1;
    if (pageSize < 5) pageSize = 5;
    if (pageSize > 200) pageSize = 200;

    var filterPencatatan = (params.pencatatan || 'ALL').toUpperCase();
    var filterKondisi    = (params.kondisi || 'ALL').toUpperCase();
    var filterStatusAset = (params.statusAset || 'ALL').toUpperCase();
    var filterLokasiId   = (params.lokasiId || 'ALL').toUpperCase();
    var filterKategori   = (params.kategori || 'ALL').toUpperCase();
    var query            = (params.q || '').trim().toLowerCase();

    var sheet = openTuSheet(SHEET_TU.BMN_ASET);
    if (typeof _ensureBmnAsetColumns === 'function') _ensureBmnAsetColumns(sheet);
    var rows  = sheetToObjects(sheet);

    // Filter baris ACTIVE (bukan SUPERSEDED atau VOID)
    var activeRows = rows.filter(function (r) {
      return String(r['Status']) === ROW_STATUS.ACTIVE;
    });

    // Ambil master kategori untuk masa manfaat
    var katSheet = openTuSheet(SHEET_TU.MASTER_BMN_KATEGORI);
    var katRows = sheetToObjects(katSheet);
    var masaManfaatMap = {};
    katRows.forEach(function (k) {
      masaManfaatMap[String(k['KodeKategori'])] = parseFloat(k['MasaManfaatTahun']) || 0;
    });

    // Filter berdasarkan kriteria
    var filtered = activeRows.filter(function (r) {
      // Filter status aset internal BMN (AKTIF / DALAM_PENGHAPUSAN / DIHAPUS)
      var stAset = String(r['StatusAset'] || 'AKTIF').toUpperCase();
      if (filterStatusAset !== 'ALL' && stAset !== filterStatusAset) return false;

      // Filter Pencatatan (BUKU vs REGULER)
      var penc = String(r['KategoriPencatatan'] || '').toUpperCase();
      if (filterPencatatan !== 'ALL' && penc !== filterPencatatan) return false;

      // Filter Kondisi
      var kond = String(r['Kondisi'] || '').toUpperCase();
      if (filterKondisi !== 'ALL' && kond !== filterKondisi) return false;

      // Filter Lokasi UPT
      var lok = String(r['LokasiID'] || '').toUpperCase();
      if (filterLokasiId !== 'ALL' && lok !== filterLokasiId) return false;

      // Filter Kategori
      var kat = String(r['KodeKategori'] || '').toUpperCase();
      if (filterKategori !== 'ALL' && kat !== filterKategori) return false;

      // Pencarian kata kunci (KodeBarang, NUP, NamaBarang, MerekTipe, Ruangan)
      if (query) {
        var strSearch = (
          String(r['KodeBarang'] || '') + ' ' +
          String(r['NUP'] || '') + ' ' +
          String(r['NamaBarang'] || '') + ' ' +
          String(r['MerekTipe'] || '') + ' ' +
          String(r['LokasiDetailRuangan'] || '')
        ).toLowerCase();
        if (strSearch.indexOf(query) === -1) return false;
      }

      return true;
    });

    // Sorting
    var sortBy = params.sortBy || 'TanggalPerolehan';
    var sortDir = (params.sortDir || 'desc').toLowerCase();
    filtered.sort(function (a, b) {
      var valA = a[sortBy];
      var valB = b[sortBy];
      if (sortBy === 'NilaiPerolehan' || sortBy === 'NilaiBuku') {
        valA = parseFloat(valA) || 0;
        valB = parseFloat(valB) || 0;
      } else if (sortBy === 'TanggalPerolehan' || sortBy === 'Timestamp') {
        valA = new Date(valA || 0).getTime();
        valB = new Date(valB || 0).getTime();
      } else {
        valA = String(valA || '').toLowerCase();
        valB = String(valB || '').toLowerCase();
      }

      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    var totalCount = filtered.length;
    var totalPages = Math.ceil(totalCount / pageSize) || 1;
    var startIndex = (page - 1) * pageSize;
    var pagedRows = filtered.slice(startIndex, startIndex + pageSize);

    var items = pagedRows.map(function (r) {
      var katCode = String(r['KodeKategori'] || '');
      var masaManfaat = masaManfaatMap[katCode] || 0;
      var ageInfo = _bmnComputeAge(r['TanggalPerolehan'], masaManfaat);
      var kBrg = String(r['KodeBarang'] || '');
      var nmBrg = String(r['NamaBarang'] || '');
      var npVal = parseFloat(r['NilaiPerolehan']) || 0;
      var nbVal = parseFloat(r['NilaiBuku']) || 0;
      var rawPenc = String(r['KategoriPencatatan'] || '');
      var capClass = (typeof _bmnClassifyCapitalization === 'function')
        ? _bmnClassifyCapitalization(npVal, r['KodeAkunNeraca'], rawPenc)
        : (rawPenc || 'BUKU');
      var isVeh = (typeof _bmnIsVehicleAsset === 'function')
        ? _bmnIsVehicleAsset(kBrg, katCode, nmBrg)
        : (katCode === 'KAT-KENDARAAN');
      var noPol = String(r['NoPolisi'] || '');
      var tglPjk = r['TglPajakTahunan'] ? new Date(r['TglPajakTahunan']).toISOString().substring(0, 10) : '';
      var tglStnk = r['TglStnkLimaTahunan'] ? new Date(r['TglStnkLimaTahunan']).toISOString().substring(0, 10) : '';
      var stnkInfo = (isVeh && typeof _bmnComputeStnkStatus === 'function')
        ? _bmnComputeStnkStatus(tglPjk, tglStnk, noPol, nmBrg)
        : null;

      return {
        rowId:               String(r['RowID']),
        asetId:              String(r['AsetID']),
        kodeBarang:          kBrg,
        nup:                 String(r['NUP'] || ''),
        namaBarang:          nmBrg,
        merekTipe:           String(r['MerekTipe'] || ''),
        kategoriPencatatan:  capClass,
        labelKapitalisasi:   capClass === 'REGULER' ? 'EKSTRAKOMPTABEL' : (capClass === 'PERSEDIAAN' ? 'PERSEDIAAN' : 'INTRAKOMPTABEL'),
        kodeKategori:        katCode,
        tanggalPerolehan:    r['TanggalPerolehan'] ? new Date(r['TanggalPerolehan']).toISOString().substring(0, 10) : null,
        nilaiPerolehan:      npVal,
        nilaiBuku:           nbVal,
        kondisi:             String(r['Kondisi'] || 'BAIK'),
        lokasiId:            String(r['LokasiID'] || ''),
        lokasiDetailRuangan: String(r['LokasiDetailRuangan'] || ''),
        latitude:            parseFloat(r['Latitude']) || null,
        longitude:           parseFloat(r['Longitude']) || null,
        sumberLokasi:        String(r['SumberLokasi'] || 'MANUAL'),
        jarakKeUptKm:        parseFloat(r['JarakKeUPT_Km']) || null,
        tanggalVerifikasi:   r['TanggalVerifikasi'] ? new Date(r['TanggalVerifikasi']).toISOString().substring(0, 10) : null,
        fotoEvidenceId:      String(r['FotoEvidenceID'] || ''),
        statusAset:          String(r['StatusAset'] || 'AKTIF'),
        penghapusanId:       String(r['PenghapusanID'] || ''),
        kapalId:             String(r['KapalID'] || ''),
        umurTahun:           ageInfo.umurTahun,
        umurBulan:           ageInfo.umurBulan,
        sisaManfaatTahun:    ageInfo.sisaManfaatTahun,
        isExpired:           ageInfo.isExpired,
        keterangan:          String(r['Keterangan'] || ''),
        kodeAkunNeraca:      String(r['KodeAkunNeraca'] || (capClass === 'REGULER' ? '132111' : '132111')),
        noPolisi:            noPol,
        tglPajakTahunan:     tglPjk,
        tglStnkLimaTahunan:  tglStnk,
        fotoStnkEvidenceId:  String(r['FotoStnkEvidenceID'] || ''),
        noDokumenSumber:     String(r['NoDokumenSumber'] || ''),
        stnkVerified:        String(r['StnkVerified'] || 'YA'),
        isKendaraan:         isVeh,
        stnkStatus:          stnkInfo
      };
    });

    return {
      success: true,
      data: {
        items: items,
        totalCount: totalCount,
        page: page,
        pageSize: pageSize,
        totalPages: totalPages
      }
    };
  } catch (e) {
    Logger.log('[bmn_getAsetList] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ── PUBLIC API: SUMMARY & ACTIONABLE ALERTS ───────────────

/**
 * Ringkasan metrik BMN (Gross, Net, Kondisi, Pencatatan, Antrean Hapus, dan Alert Banner).
 */
function bmn_getSummary(token, filter) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertRead(session);

    var sheet = openTuSheet(SHEET_TU.BMN_ASET);
    if (typeof _ensureBmnAsetColumns === 'function') _ensureBmnAsetColumns(sheet);
    var rows  = sheetToObjects(sheet);

    var activeRows = rows.filter(function (r) {
      return String(r['Status']) === ROW_STATUS.ACTIVE;
    });

    var uptSheet = openTuSheet(SHEET_TU.MASTER_LOKASI_UPT);
    var masterUpts = sheetToObjects(uptSheet).filter(function (u) {
      return String(u['Status'] || 'AKTIF').toUpperCase() === 'AKTIF';
    });

    var uptMap = {};
    for (var m = 0; m < masterUpts.length; m++) {
      var mu = masterUpts[m];
      var muId = String(mu['LokasiID']);
      uptMap[muId] = {
        lokasiId:   muId,
        namaLokasi: String(mu['NamaLokasi']),
        jenis:      String(mu['Jenis'] || 'UPT'),
        wilayah:    String(mu['Wilayah'] || ''),
        latitude:   parseFloat(mu['Latitude']) || null,
        longitude:  parseFloat(mu['Longitude']) || null,
        total:      0,
        baik:       0,
        rusakRingan:0,
        rusakBerat: 0,
        nilaiGross: 0,
        nilaiBuku:  0,
        antreanHapus: 0
      };
    }

    var totalAsetGross = 0;
    var totalNilaiBuku  = 0;
    var totalUnit       = activeRows.length;

    var countBuku     = 0;
    var nilaiBukuSum  = 0;
    var countReguler  = 0;
    var nilaiRegSum   = 0;

    var kondisiCounts = {
      BAIK: 0,
      RUSAK_RINGAN: 0,
      RUSAK_BERAT: 0
    };

    var antreanHapusCount = 0;
    var rusakBeratKandidatHapus = 0;
    var uptCounts = {};
    var kendaraanDueList = [];
    var totalKendaraanCount = 0;

    for (var i = 0; i < activeRows.length; i++) {
      var r = activeRows[i];
      var np = parseFloat(r['NilaiPerolehan']) || 0;
      var nb = parseFloat(r['NilaiBuku']) || 0;
      var kond = String(r['Kondisi'] || 'BAIK').toUpperCase();
      var rawPenc = String(r['KategoriPencatatan'] || 'BUKU').toUpperCase();
      var penc = (typeof _bmnClassifyCapitalization === 'function')
        ? _bmnClassifyCapitalization(np, r['KodeAkunNeraca'], rawPenc)
        : rawPenc;
      var stAset = String(r['StatusAset'] || 'AKTIF').toUpperCase();
      var lokId = String(r['LokasiID'] || 'UPT-PUSAT-POA');

      totalAsetGross += np;
      totalNilaiBuku += nb;

      if (penc === 'REGULER') {
        countReguler++;
        nilaiRegSum += np;
      } else {
        countBuku++;
        nilaiBukuSum += nb;
      }

      if (stAset === 'AKTIF' && typeof _bmnIsVehicleAsset === 'function') {
        var kBrgSum = String(r['KodeBarang'] || '');
        var katSum  = String(r['KodeKategori'] || '');
        var nmSum   = String(r['NamaBarang'] || '');
        if (_bmnIsVehicleAsset(kBrgSum, katSum, nmSum)) {
          totalKendaraanCount++;
          var noPolSum  = String(r['NoPolisi'] || '');
          var _safeD = function (v) {
            if (!v) return '';
            if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
              return Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM-dd');
            }
            var s = String(v).trim();
            if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
            var d = new Date(s);
            return !isNaN(d.getTime()) ? Utilities.formatDate(d, 'Asia/Jakarta', 'yyyy-MM-dd') : '';
          };
          var tPjkSum   = _safeD(r['TglPajakTahunan']);
          var tStnkSum  = _safeD(r['TglStnkLimaTahunan']);
          var stnkCheck = _bmnComputeStnkStatus(tPjkSum, tStnkSum, noPolSum, nmSum);
          if (stnkCheck && (stnkCheck.statusReminder === 'LEWAT_JATUH_TEMPO' || stnkCheck.statusReminder === 'SEGERA_JATUH_TEMPO')) {
            kendaraanDueList.push({
              asetId: String(r['AsetID']),
              kodeBarang: kBrgSum,
              nup: String(r['NUP'] || ''),
              namaBarang: nmSum,
              merekTipe: String(r['MerekTipe'] || ''),
              noPolisi: noPolSum || ('NUP-' + r['NUP']),
              lokasiId: lokId,
              tglPajakTahunan: tPjkSum,
              tglStnkLimaTahunan: tStnkSum,
              daysToPajak: stnkCheck.daysToPajak,
              daysToStnk: stnkCheck.daysToStnk,
              minDays: stnkCheck.minDays,
              statusReminder: stnkCheck.statusReminder,
              milestoneStage: stnkCheck.milestoneStage,
              milestoneLabel: stnkCheck.milestoneLabel,
              shouldTriggerPopup: stnkCheck.shouldTriggerPopup,
              isOverdueDaily: stnkCheck.isOverdueDaily,
              checkpointKey: stnkCheck.checkpointKey,
              jenisTindakan: stnkCheck.jenisTindakan,
              alertMessage: stnkCheck.alertMessage,
              stnkStatus: stnkCheck
            });
          }
        }
      }

      if (kondisiCounts.hasOwnProperty(kond)) {
        kondisiCounts[kond]++;
      } else {
        kondisiCounts.BAIK++;
      }

      if (stAset === 'DALAM_PENGHAPUSAN') {
        antreanHapusCount++;
      }

      if (kond === 'RUSAK_BERAT' && stAset === 'AKTIF') {
        rusakBeratKandidatHapus++;
      }

      uptCounts[lokId] = (uptCounts[lokId] || 0) + 1;

      if (!uptMap[lokId]) {
        uptMap[lokId] = {
          lokasiId:   lokId,
          namaLokasi: lokId,
          jenis:      'UPT',
          wilayah:    '',
          latitude:   null,
          longitude:  null,
          total:      0,
          baik:       0,
          rusakRingan:0,
          rusakBerat: 0,
          nilaiGross: 0,
          nilaiBuku:  0,
          antreanHapus: 0
        };
      }
      var targetUpt = uptMap[lokId];
      targetUpt.total++;
      targetUpt.nilaiGross += np;
      targetUpt.nilaiBuku += nb;
      if (kond === 'RUSAK_BERAT') targetUpt.rusakBerat++;
      else if (kond === 'RUSAK_RINGAN') targetUpt.rusakRingan++;
      else targetUpt.baik++;
      if (stAset === 'DALAM_PENGHAPUSAN') targetUpt.antreanHapus++;
    }

    var pctKelaikanFisik = totalUnit > 0
      ? Math.round(((kondisiCounts.BAIK + (kondisiCounts.RUSAK_RINGAN * 0.5)) / totalUnit) * 1000) / 10
      : 100;

    var pctBaik = totalUnit > 0 ? Math.round((kondisiCounts.BAIK / totalUnit) * 1000) / 10 : 0;
    var pctRusakRingan = totalUnit > 0 ? Math.round((kondisiCounts.RUSAK_RINGAN / totalUnit) * 1000) / 10 : 0;
    var pctRusakBerat = totalUnit > 0 ? Math.round((kondisiCounts.RUSAK_BERAT / totalUnit) * 1000) / 10 : 0;

    var uptArray = [];
    for (var kId in uptMap) {
      if (uptMap.hasOwnProperty(kId)) {
        uptArray.push(uptMap[kId]);
      }
    }

    return {
      success: true,
      data: {
        totalUnit: totalUnit,
        totalAsetGross: totalAsetGross,
        totalNilaiBuku: totalNilaiBuku,
        pctKelaikanFisik: pctKelaikanFisik,
        antreanHapusCount: antreanHapusCount,
        rusakBeratKandidatHapus: rusakBeratKandidatHapus,
        pencatatan: {
          buku: { count: countBuku, nilaiBuku: nilaiBukuSum },
          reguler: { count: countReguler, nilaiPerolehan: nilaiRegSum }
        },
        kondisi: {
          baik: { count: kondisiCounts.BAIK, pct: pctBaik },
          rusakRingan: { count: kondisiCounts.RUSAK_RINGAN, pct: pctRusakRingan },
          rusakBerat: { count: kondisiCounts.RUSAK_BERAT, pct: pctRusakBerat }
        },
        uptCounts: uptCounts,
        uptList: uptArray,
        kendaraanSummary: {
          totalKendaraan: totalKendaraanCount,
          jatuhTempoCount: kendaraanDueList.length,
          dueAlerts: kendaraanDueList
        },
        notificationAlert: {
          hasRusakBeratAlert: rusakBeratKandidatHapus > 0,
          kandidatCount: rusakBeratKandidatHapus,
          text: 'Terdapat ' + kondisiCounts.BAIK + ' unit (' + pctBaik + '%) aset Baik, ' +
                kondisiCounts.RUSAK_RINGAN + ' unit (' + pctRusakRingan + '%) Rusak Ringan, dan ' +
                kondisiCounts.RUSAK_BERAT + ' unit (' + pctRusakBerat + '%) Rusak Berat.' +
                (rusakBeratKandidatHapus > 0
                  ? ' \u2014 ' + rusakBeratKandidatHapus + ' unit Rusak Berat aktif direkomendasikan segera diusulkan Penghapusan BMN Kemenkeu.'
                  : '')
        }
      }
    };
  } catch (e) {
    Logger.log('[bmn_getSummary] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ── PUBLIC API: SUBMIT & UPDATE SINGLE ASET (ANTI-JEBRET) ─

/**
 * Menyimpan entri baru atau revisi aset individual BMN.
 *
 * @param {string} token
 * @param {{
 *   asetId?: string,
 *   kodeBarang: string,
 *   nup: string,
 *   namaBarang: string,
 *   merekTipe?: string,
 *   kategoriPencatatan: string, // 'BUKU' | 'REGULER'
 *   kodeKategori: string,
 *   tanggalPerolehan: string,
 *   nilaiPerolehan: number,
 *   nilaiBuku: number,
 *   kondisi: string,            // 'BAIK' | 'RUSAK_RINGAN' | 'RUSAK_BERAT'
 *   lokasiId?: string,
 *   lokasiDetailRuangan?: string,
 *   latitude?: number,
 *   longitude?: number,
 *   sumberLokasi?: string,
 *   fotoEvidenceId?: string,
 *   kapalId?: string,
 *   keterangan?: string
 * }} params
 */
function bmn_submitAset(token, params) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertWrite(session);

    if (!params) throw new Error('Data aset tidak boleh kosong.');
    if (!params.kodeBarang || !params.nup || !params.namaBarang) {
      throw new Error('Kode Barang, NUP, dan Nama Barang wajib diisi.');
    }
    var kodeClean = String(params.kodeBarang).replace(/\./g, '').trim();
    if (!/^\d{10}$/.test(kodeClean)) {
      throw new Error('Kode Barang BMN wajib terdiri dari 10 digit angka (mis. 3050104001).');
    }
    var nupInt = parseInt(String(params.nup).trim(), 10);
    if (!/^\d+$/.test(String(params.nup).trim()) || isNaN(nupInt) || nupInt < 1) {
      throw new Error('NUP wajib berupa bilangan bulat positif (minimal 1).');
    }
    var npVal = parseFloat(params.nilaiPerolehan);
    var nbVal = parseFloat(params.nilaiBuku);
    if (isNaN(npVal) || npVal <= 0) {
      throw new Error('Nilai Perolehan wajib lebih besar dari Rp 0.');
    }
    if (isNaN(nbVal) || nbVal < 0) {
      throw new Error('Nilai Buku tidak boleh bernilai negatif.');
    }
    if (nbVal > npVal) {
      throw new Error('Nilai Buku tidak masuk akal karena melebihi Nilai Perolehan aset.');
    }
    var todayStr = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
    var tglAcq = String(params.tanggalPerolehan || '').trim();
    if (!tglAcq || !/^\d{4}-\d{2}-\d{2}$/.test(tglAcq) || tglAcq < '1945-01-01' || tglAcq > todayStr) {
      throw new Error('Tanggal Perolehan tidak valid atau berada di masa depan.');
    }
    if (!params.kondisi) {
      throw new Error('Kondisi aset (Baik / Rusak Ringan / Rusak Berat) wajib ditentukan.');
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      var sheet = openTuSheet(SHEET_TU.BMN_ASET);
      var rows  = sheetToObjects(sheet);

      // Hitung koordinat dan matching UPT terdekat jika ada koordinat GPS
      var lat = (params.latitude !== '' && params.latitude !== null && params.latitude !== undefined) ? parseFloat(params.latitude) : null;
      var lon = (params.longitude !== '' && params.longitude !== null && params.longitude !== undefined) ? parseFloat(params.longitude) : null;
      if (lat !== null && (isNaN(lat) || lat < -90 || lat > 90)) {
        throw new Error('Koordinat Latitude GPS harus di antara -90 s/d 90.');
      }
      if (lon !== null && (isNaN(lon) || lon < -180 || lon > 180)) {
        throw new Error('Koordinat Longitude GPS harus di antara -180 s/d 180.');
      }
      var lokasiId = params.lokasiId || 'UPT-PUSAT-POA';
      var jarakKm = null;
      var sumberLokasi = params.sumberLokasi || 'MANUAL';

      if (lat !== null && lon !== null) {
        var uptSheet = openTuSheet(SHEET_TU.MASTER_LOKASI_UPT);
        var uptRows = sheetToObjects(uptSheet);
        var match = _bmnMatchNearestUpt(lat, lon, uptRows);
        if (!params.lokasiId) {
          lokasiId = match.lokasiId;
        }
        jarakKm = match.distanceKm;
      }

      var now = new Date();
      var asetId = params.asetId || ('BMN-' + Utilities.getUuid().substring(0, 12).toUpperCase());
      var supersedesRowId = '';

      // Cek apakah revisi baris eksisting
      if (params.asetId) {
        for (var i = 0; i < rows.length; i++) {
          if (rows[i]['AsetID'] === params.asetId && String(rows[i]['Status']) === ROW_STATUS.ACTIVE) {
            var targetIdx = i + 2;
            var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
            var colStatus = headers.indexOf('Status') + 1;
            sheet.getRange(targetIdx, colStatus).setValue(ROW_STATUS.SUPERSEDED);
            supersedesRowId = rows[i]['RowID'];
            break;
          }
        }
      }

      var newRowId = Utilities.getUuid();
      var periode = getCurrentPeriode();

      // Penanganan foto bukti fisik (base64) jika dikirimkan
      var fotoEvidenceId = params.fotoEvidenceId || '';
      if (params.photoPayload && params.photoPayload.dataBase64) {
        try {
          var pB64 = String(params.photoPayload.dataBase64).replace(/^data:[^;]+;base64,/, '').trim();
          var pMime = params.photoPayload.mimeType || 'image/jpeg';
          var pName = params.photoPayload.fileName || ('BMN_' + asetId + '.jpg');
          var pBlob = Utilities.newBlob(Utilities.base64Decode(pB64), pMime, pName);

          var rootFolder = _evGetOrCreateRoot();
          var fTu = _evGetOrCreateSub(rootFolder, 'Tata Usaha');
          var fYm = _evGetOrCreateSub(fTu, (periode && periode.length >= 7) ? periode.substring(0, 7) : 'Umum');
          var fAset = _evGetOrCreateSub(fYm, 'BMN-' + asetId);
          var driveFile = fAset.createFile(pBlob);
          fotoEvidenceId = _evAppendEvidence(SHEET_TU.BMN_ASET, newRowId, driveFile.getId(), pName, pMime, 'UPLOAD', session.userId);
        } catch (evErr) {
          Logger.log('[bmn_submitAset photo error] ' + evErr.message);
        }
      }

      // Penanganan foto/scan STNK kendaraan dinas (base64) jika dikirimkan
      var fotoStnkEvidenceId = params.fotoStnkEvidenceId || '';
      if (params.stnkPayload && params.stnkPayload.dataBase64) {
        try {
          var sB64 = String(params.stnkPayload.dataBase64).replace(/^data:[^;]+;base64,/, '').trim();
          var sMime = params.stnkPayload.mimeType || 'image/jpeg';
          var sName = params.stnkPayload.fileName || ('STNK_' + asetId + '.jpg');
          var sBlob = Utilities.newBlob(Utilities.base64Decode(sB64), sMime, sName);

          var rootFolderStnk = _evGetOrCreateRoot();
          var fTuStnk = _evGetOrCreateSub(rootFolderStnk, 'Tata Usaha');
          var fYmStnk = _evGetOrCreateSub(fTuStnk, (periode && periode.length >= 7) ? periode.substring(0, 7) : 'Umum');
          var fAsetStnk = _evGetOrCreateSub(fYmStnk, 'BMN-' + asetId);
          var driveFileStnk = fAsetStnk.createFile(sBlob);
          fotoStnkEvidenceId = _evAppendEvidence(SHEET_TU.BMN_ASET, newRowId, driveFileStnk.getId(), sName, sMime, 'UPLOAD_STNK', session.userId);
        } catch (stnkErr) {
          Logger.log('[bmn_submitAset stnk photo error] ' + stnkErr.message);
        }
      }

      var npInput = parseFloat(params.nilaiPerolehan) || 0;
      var nbInput = parseFloat(params.nilaiBuku) || 0;
      var autoCap = (typeof _bmnClassifyCapitalization === 'function')
        ? _bmnClassifyCapitalization(npInput, params.kodeAkunNeraca, params.kategoriPencatatan)
        : (params.kategoriPencatatan || 'BUKU');

      var newRow = [
        newRowId,
        _BMN_DIVISI_ID,
        periode,
        session.userId,
        now,
        ROW_STATUS.ACTIVE,
        supersedesRowId,
        '', // VoidReason
        '', // VoidedBy
        '', // VoidedAt
        asetId,
        String(params.kodeBarang).trim(),
        String(params.nup).trim(),
        String(params.namaBarang).trim(),
        params.merekTipe ? String(params.merekTipe).trim() : '',
        autoCap,
        params.kodeKategori || 'KAT-KANTOR',
        params.tanggalPerolehan ? new Date(params.tanggalPerolehan) : now,
        npInput,
        nbInput,
        params.kondisi || 'BAIK',
        lokasiId,
        params.lokasiDetailRuangan ? String(params.lokasiDetailRuangan).trim() : '',
        lat,
        lon,
        sumberLokasi,
        jarakKm,
        now, // TanggalVerifikasi
        fotoEvidenceId,
        'AKTIF', // StatusAset
        '',      // PenghapusanID
        params.kapalId || '',
        '',      // ImportBatchID
        params.keterangan ? String(params.keterangan).trim() : '',
        params.kodeAkunNeraca ? String(params.kodeAkunNeraca).trim() : '132111',
        params.noPolisi ? String(params.noPolisi).trim().toUpperCase() : '',
        params.tglPajakTahunan ? String(params.tglPajakTahunan).trim() : '',
        params.tglStnkLimaTahunan ? String(params.tglStnkLimaTahunan).trim() : '',
        fotoStnkEvidenceId,
        params.noDokumenSumber ? String(params.noDokumenSumber).trim() : '',
        params.stnkVerified ? String(params.stnkVerified).trim() : 'YA'
      ];

      var lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, 1, newRow.length).setValues([newRow]);

      logAudit(session.userId, params.asetId ? 'REVISI_BMN' : 'CREATE_BMN', 'TX_BMN_Aset', newRowId, {
        asetId: asetId,
        kodeBarang: params.kodeBarang,
        nup: params.nup,
        kondisi: params.kondisi
      });

      return {
        success: true,
        data: {
          asetId: asetId,
          rowId: newRowId,
          lokasiId: lokasiId,
          jarakKeUptKm: jarakKm
        },
        message: 'Aset BMN berhasil disimpan ke register inventaris.'
      };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[bmn_submitAset] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ── PUBLIC API: SMART BULK IMPORT BMN (SAKTI / SIMAK) ─────

/**
 * Menyimpan data impor massal BMN dari hasil parsing SAKTI/SIMAK.
 * 1 baris = 1 unit fisik tunggal (Anti-Jebret).
 *
 * @param {string} token
 * @param {{
 *   items: Array<Object>,
 *   batchId?: string
 * }} payload
 */
function bmn_importBatchAset(token, payload) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertWrite(session);

    if (!payload || !payload.items || !payload.items.length) {
      throw new Error('Tidak ada data aset yang dikirim untuk diimpor.');
    }

    var items = payload.items;
    var batchId = payload.batchId || ('BATCH-BMN-' + Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().substring(0, 6).toUpperCase());
    var now = new Date();
    var periode = getCurrentPeriode();

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);

    try {
      var sheet = openTuSheet(SHEET_TU.BMN_ASET);
      var lastRow = sheet.getLastRow();

      var uptSheet = openTuSheet(SHEET_TU.MASTER_LOKASI_UPT);
      var uptRows = sheetToObjects(uptSheet);

      var rowsToAdd = [];
      var totalNilaiPerolehan = 0;
      var totalNilaiBuku = 0;

      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it.kodeBarang || !it.nup || !it.namaBarang) {
          continue; // Lewati baris yang tidak memenuhi field kunci
        }

        var newRowId = Utilities.getUuid();
        var asetId = 'BMN-' + Utilities.getUuid().substring(0, 12).toUpperCase();

        var lat = parseFloat(it.latitude) || null;
        var lon = parseFloat(it.longitude) || null;
        var lokasiId = it.lokasiId || 'UPT-PUSAT';
        var jarakKm = null;

        if (lat !== null && lon !== null) {
          var match = _bmnMatchNearestUpt(lat, lon, uptRows);
          if (!it.lokasiId) lokasiId = match.lokasiId;
          jarakKm = match.distanceKm;
        }

        var np = parseFloat(it.nilaiPerolehan) || 0;
        var nb = parseFloat(it.nilaiBuku) || 0;
        totalNilaiPerolehan += np;
        totalNilaiBuku += nb;

        var tglPerolehan = it.tanggalPerolehan ? new Date(it.tanggalPerolehan) : now;
        if (isNaN(tglPerolehan.getTime())) tglPerolehan = now;

        var row = [
          newRowId,
          _BMN_DIVISI_ID,
          periode,
          session.userId,
          now,
          ROW_STATUS.ACTIVE,
          '', // SupersedesRowID
          '', // VoidReason
          '', // VoidedBy
          '', // VoidedAt
          asetId,
          String(it.kodeBarang).trim(),
          String(it.nup).trim(),
          String(it.namaBarang).trim(),
          it.merekTipe ? String(it.merekTipe).trim() : '',
          it.kategoriPencatatan === 'REGULER' ? 'REGULER' : 'BUKU',
          it.kodeKategori || 'KAT-ALAT_KANTOR',
          tglPerolehan,
          np,
          nb,
          it.kondisi || 'BAIK',
          lokasiId,
          it.lokasiDetailRuangan ? String(it.lokasiDetailRuangan).trim() : '',
          lat,
          lon,
          'IMPOR_SAKTI',
          jarakKm,
          now, // TanggalVerifikasi
          it.fotoEvidenceId || '',
          'AKTIF',
          '', // PenghapusanID
          it.kapalId || '',
          batchId,
          it.keterangan ? String(it.keterangan).trim() : ''
        ];

        rowsToAdd.push(row);
      }

      if (rowsToAdd.length > 0) {
        sheet.getRange(lastRow + 1, 1, rowsToAdd.length, rowsToAdd[0].length).setValues(rowsToAdd);
      }

      logAudit(session.userId, 'IMPORT_BMN_BATCH', 'TX_BMN_Aset', batchId, {
        totalUnit: rowsToAdd.length,
        totalNilaiPerolehan: totalNilaiPerolehan,
        totalNilaiBuku: totalNilaiBuku
      });

      return {
        success: true,
        data: {
          batchId: batchId,
          insertedCount: rowsToAdd.length,
          totalNilaiPerolehan: totalNilaiPerolehan,
          totalNilaiBuku: totalNilaiBuku
        },
        message: 'Berhasil mengimpor ' + rowsToAdd.length + ' unit aset BMN ke register inventaris.'
      };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[bmn_importBatchAset] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ── PUBLIC API: ANULIR ASET BMN ───────────────────────────

/**
 * Menganulir baris inventaris BMN.
 */
function bmn_anulirAset(token, params) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertVoid(session);

    if (!params || !params.rowId || !params.alasan) {
      throw new Error('RowID dan Alasan Anulir wajib diisi.');
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      var sheet = openTuSheet(SHEET_TU.BMN_ASET);
      var rows  = sheetToObjects(sheet);
      var targetIdx = -1;
      var targetAsetId = '';

      for (var i = 0; i < rows.length; i++) {
        if (rows[i]['RowID'] === params.rowId && String(rows[i]['Status']) === ROW_STATUS.ACTIVE) {
          targetIdx = i + 2;
          targetAsetId = rows[i]['AsetID'];
          break;
        }
      }

      if (targetIdx === -1) {
        throw new Error('Data aset tidak ditemukan atau sudah tidak aktif.');
      }

      var headers   = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var colStatus = headers.indexOf('Status') + 1;
      var colReason = headers.indexOf('VoidReason') + 1;
      var colBy     = headers.indexOf('VoidedBy') + 1;
      var colAt     = headers.indexOf('VoidedAt') + 1;

      sheet.getRange(targetIdx, colStatus).setValue(ROW_STATUS.VOID);
      sheet.getRange(targetIdx, colReason).setValue(params.alasan);
      sheet.getRange(targetIdx, colBy).setValue(session.userId);
      sheet.getRange(targetIdx, colAt).setValue(new Date());

      logAudit(session.userId, 'ANULIR_BMN', 'TX_BMN_Aset', params.rowId, {
        asetId: targetAsetId,
        alasan: params.alasan
      });

      return { success: true, message: 'Entri aset BMN berhasil dianulir.' };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[bmn_anulirAset] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
// SIKLUS PENGHAPUSAN LEGAL BMN KEMENKEU (SUB-FASE 18B.6)
// State Machine: DRAFT_USULAN -> SURAT_USULAN -> PERSETUJUAN_KEMENKEU -> SK_PENGHAPUSAN -> BAST_SELESAI (atau DITOLAK)
// ============================================================

/**
 * Mengambil daftar aset yang berstatus AKTIF dan siap diusulkan untuk penghapusan.
 */
function bmn_getAsetEligibleHapus(token) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertRead(session);

    var sheet = openTuSheet(SHEET_TU.BMN_ASET);
    if (typeof _ensureBmnAsetColumns === 'function') _ensureBmnAsetColumns(sheet);
    var rows  = sheetToObjects(sheet);

    var eligible = rows.filter(function (r) {
      return String(r['Status']) === ROW_STATUS.ACTIVE &&
             String(r['StatusAset'] || 'AKTIF').toUpperCase() === 'AKTIF';
    }).map(function (r) {
      var tglPeroleh = r['TanggalPerolehan'] ? String(r['TanggalPerolehan']).split('T')[0] : '';
      var masaManfaat = parseFloat(r['MasaManfaatTahun']) || 5;
      var age = _bmnComputeAge(tglPeroleh, masaManfaat);

      return {
        asetId:              String(r['AsetID']),
        kodeBarang:          String(r['KodeBarang']),
        nup:                 String(r['NUP']),
        namaBarang:          String(r['NamaBarang']),
        merekTipe:           String(r['MerekTipe'] || ''),
        kondisi:             String(r['Kondisi'] || 'BAIK').toUpperCase(),
        kategoriPencatatan:  String(r['KategoriPencatatan'] || 'BUKU').toUpperCase(),
        lokasiId:            String(r['LokasiID'] || ''),
        namaLokasi:          String(r['NamaLokasi'] || ''),
        nilaiPerolehan:      parseFloat(r['NilaiPerolehan']) || 0,
        nilaiBuku:           parseFloat(r['NilaiBuku']) || 0,
        umurAsetTahun:       age.umurTahun,
        sisaManfaatTahun:    age.sisaTahun,
        isKadaluwarsa:       age.isKadaluwarsa
      };
    });

    // Urutkan: Rusak Berat dan Kadaluwarsa di atas
    eligible.sort(function (a, b) {
      if (a.kondisi === 'RUSAK_BERAT' && b.kondisi !== 'RUSAK_BERAT') return -1;
      if (b.kondisi === 'RUSAK_BERAT' && a.kondisi !== 'RUSAK_BERAT') return 1;
      if (a.isKadaluwarsa && !b.isKadaluwarsa) return -1;
      if (!a.isKadaluwarsa && b.isKadaluwarsa) return 1;
      return a.namaBarang.localeCompare(b.namaBarang);
    });

    return { success: true, data: eligible };
  } catch (e) {
    Logger.log('[bmn_getAsetEligibleHapus] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Membuat berkas usulan penghapusan BMN baru (Tahap: DRAFT_USULAN).
 * Mengkarantina aset terpilih menjadi StatusAset = 'DALAM_PENGHAPUSAN'.
 */
function bmn_createPenghapusan(token, payload) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertWrite(session);

    if (!payload || !payload.alasan) {
      throw new Error('Alasan Penghapusan wajib dipilih.');
    }
    if (!payload.asetIds || !Array.isArray(payload.asetIds) || payload.asetIds.length === 0) {
      throw new Error('Pilih minimal 1 unit aset untuk diusulkan penghapusan.');
    }
    var todayHps = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
    if (payload.tanggalSuratUsulan && (String(payload.tanggalSuratUsulan) > todayHps || String(payload.tanggalSuratUsulan) < '1990-01-01')) {
      throw new Error('Tanggal surat usulan penghapusan tidak valid atau melebihi tanggal hari ini.');
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);

    try {
      var asetSheet = openTuSheet(SHEET_TU.BMN_ASET);
      var asetRows  = sheetToObjects(asetSheet);
      var asetHeaders = asetSheet.getRange(1, 1, 1, asetSheet.getLastColumn()).getValues()[0];

      var colAsetRowId       = asetHeaders.indexOf('RowID') + 1;
      var colAsetStatusAset  = asetHeaders.indexOf('StatusAset') + 1;
      var colAsetPenghapusan = asetHeaders.indexOf('PenghapusanID') + 1;

      // Cari dan validasi aset
      var targetAssets = [];
      var targetRowIndices = [];

      for (var i = 0; i < asetRows.length; i++) {
        var ar = asetRows[i];
        if (payload.asetIds.indexOf(ar['AsetID']) !== -1 && String(ar['Status']) === ROW_STATUS.ACTIVE) {
          if (String(ar['StatusAset'] || 'AKTIF').toUpperCase() !== 'AKTIF') {
            throw new Error('Aset ' + ar['NamaBarang'] + ' (NUP ' + ar['NUP'] + ') sedang dalam status ' + ar['StatusAset'] + ' dan tidak dapat diajukan kembali.');
          }
          targetAssets.push(ar);
          targetRowIndices.push(i + 2);
        }
      }

      if (targetAssets.length !== payload.asetIds.length) {
        throw new Error('Sebagian aset yang dipilih tidak ditemukan atau sudah tidak aktif.');
      }

      var hpsSheet = openTuSheet(SHEET_TU.BMN_PENGHAPUSAN);
      var hpsRows  = sheetToObjects(hpsSheet);

      var tahun = new Date().getFullYear();
      var counter = 1;
      for (var h = 0; h < hpsRows.length; h++) {
        var existId = String(hpsRows[h]['PenghapusanID'] || '');
        if (existId.indexOf('HPS-' + tahun) === 0) {
          var num = parseInt(existId.split('-')[2], 10);
          if (!isNaN(num) && num >= counter) counter = num + 1;
        }
      }
      var penghapusanId = 'HPS-' + tahun + '-' + ('0000' + counter).slice(-4);
      var parentRowId   = generateRowId('TX_BMN_Penghapusan');
      var now = new Date();
      var periode = now.getFullYear() + '-W' + ('0' + Math.ceil(now.getDate() / 7)).slice(-2);

      var totalNilaiPerolehan = 0;
      var totalNilaiBuku = 0;

      targetAssets.forEach(function (ta) {
        totalNilaiPerolehan += parseFloat(ta['NilaiPerolehan']) || 0;
        totalNilaiBuku += parseFloat(ta['NilaiBuku']) || 0;
      });

      // 1. Tulis Berkas Induk TX_BMN_Penghapusan
      var hpsRowData = [
        parentRowId, _BMN_DIVISI_ID, periode, session.userId, now, ROW_STATUS.ACTIVE, '', '', '', '',
        penghapusanId,
        'DRAFT_USULAN',
        payload.alasan,
        payload.keterangan || '',
        payload.nomorSuratUsulan || '',
        payload.tanggalSuratUsulan || '',
        payload.evidenceSuratUsulan || '',
        '', '', '', '', // Surat Persetujuan Kemenkeu
        '', '', '',    // SK Penghapusan
        '',            // Evidence BAST
        targetAssets.length,
        totalNilaiPerolehan,
        totalNilaiBuku
      ];
      hpsSheet.appendRow(hpsRowData);

      // 2. Tulis Item Detail TX_BMN_Penghapusan_Detail
      var detailSheet = openTuSheet(SHEET_TU.BMN_PENGHAPUSAN_DETAIL);
      var detailRowsToAdd = [];

      for (var d = 0; d < targetAssets.length; d++) {
        var da = targetAssets[d];
        var dRowId = generateRowId('TX_BMN_Penghapusan_Detail');
        detailRowsToAdd.push([
          dRowId, _BMN_DIVISI_ID, periode, session.userId, now, ROW_STATUS.ACTIVE, '', '', '', '',
          parentRowId,
          penghapusanId,
          da['AsetID'],
          da['Kondisi'] || 'RUSAK_BERAT',
          parseFloat(da['NilaiBuku']) || 0
        ]);
      }

      if (detailRowsToAdd.length > 0) {
        detailSheet.getRange(
          detailSheet.getLastRow() + 1,
          1,
          detailRowsToAdd.length,
          detailRowsToAdd[0].length
        ).setValues(detailRowsToAdd);
      }

      // 3. Karantina Aset di TX_BMN_Aset
      for (var k = 0; k < targetRowIndices.length; k++) {
        var rIdx = targetRowIndices[k];
        asetSheet.getRange(rIdx, colAsetStatusAset).setValue('DALAM_PENGHAPUSAN');
        asetSheet.getRange(rIdx, colAsetPenghapusan).setValue(penghapusanId);
      }

      logAudit(session.userId, 'CREATE_BMN_PENGHAPUSAN', 'TX_BMN_Penghapusan', parentRowId, {
        penghapusanId: penghapusanId,
        totalUnit: targetAssets.length,
        totalNilaiBuku: totalNilaiBuku,
        alasan: payload.alasan
      });

      return {
        success: true,
        data: {
          penghapusanId: penghapusanId,
          totalUnit: targetAssets.length,
          totalNilaiBuku: totalNilaiBuku
        },
        message: 'Berkas usulan penghapusan ' + penghapusanId + ' berhasil dibuat dengan ' + targetAssets.length + ' unit aset dikarantina.'
      };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[bmn_createPenghapusan] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Mengambil daftar berkas usulan penghapusan BMN.
 */
function bmn_getPenghapusanList(token, params) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertRead(session);

    params = params || {};
    var sheet = openTuSheet(SHEET_TU.BMN_PENGHAPUSAN);
    var rows  = sheetToObjects(sheet);

    var activeRows = rows.filter(function (r) {
      return String(r['Status']) === ROW_STATUS.ACTIVE;
    });

    var tahapFilter = String(params.tahap || 'ALL').toUpperCase();
    if (tahapFilter !== 'ALL') {
      activeRows = activeRows.filter(function (r) {
        return String(r['Tahap'] || '').toUpperCase() === tahapFilter;
      });
    }

    var q = String(params.q || '').trim().toLowerCase();
    if (q) {
      activeRows = activeRows.filter(function (r) {
        return String(r['PenghapusanID'] || '').toLowerCase().indexOf(q) !== -1 ||
               String(r['NomorSuratUsulan'] || '').toLowerCase().indexOf(q) !== -1 ||
               String(r['NomorSuratPersetujuan'] || '').toLowerCase().indexOf(q) !== -1 ||
               String(r['NomorSK'] || '').toLowerCase().indexOf(q) !== -1 ||
               String(r['KeteranganAlasan'] || '').toLowerCase().indexOf(q) !== -1;
      });
    }

    // Urutkan terbaru di atas
    activeRows.sort(function (a, b) {
      return new Date(b['Timestamp']).getTime() - new Date(a['Timestamp']).getTime();
    });

    var result = activeRows.map(function (r) {
      return {
        rowId:                   String(r['RowID']),
        penghapusanId:           String(r['PenghapusanID']),
        tahap:                   String(r['Tahap'] || 'DRAFT_USULAN'),
        alasanPenghapusan:       String(r['AlasanPenghapusan'] || ''),
        keteranganAlasan:         String(r['KeteranganAlasan'] || ''),
        nomorSuratUsulan:        String(r['NomorSuratUsulan'] || ''),
        tanggalSuratUsulan:      r['TanggalSuratUsulan'] ? String(r['TanggalSuratUsulan']).split('T')[0] : '',
        evidenceSuratUsulan:     String(r['EvidenceSuratUsulan'] || ''),
        nomorSuratPersetujuan:   String(r['NomorSuratPersetujuan'] || ''),
        tanggalSuratPersetujuan: r['TanggalSuratPersetujuan'] ? String(r['TanggalSuratPersetujuan']).split('T')[0] : '',
        instansiKemenkeu:        String(r['InstansiKemenkeu'] || ''),
        evidenceSuratPersetujuan:String(r['EvidenceSuratPersetujuan'] || ''),
        nomorSK:                 String(r['NomorSK'] || ''),
        tanggalSK:               r['TanggalSK'] ? String(r['TanggalSK']).split('T')[0] : '',
        evidenceSK:              String(r['EvidenceSK'] || ''),
        evidenceBAST:            String(r['EvidenceBAST'] || ''),
        totalUnit:               parseInt(r['TotalUnit'], 10) || 0,
        totalNilaiPerolehan:     parseFloat(r['TotalNilaiPerolehan']) || 0,
        totalNilaiBuku:          parseFloat(r['TotalNilaiBuku']) || 0,
        submittedBy:             String(r['SubmittedBy'] || ''),
        timestamp:               r['Timestamp']
      };
    });

    return { success: true, data: result };
  } catch (e) {
    Logger.log('[bmn_getPenghapusanList] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Mengambil detail berkas usulan penghapusan beserta rincian item aset di dalamnya.
 */
function bmn_getPenghapusanDetail(token, penghapusanId) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertRead(session);

    if (!penghapusanId) throw new Error('PenghapusanID wajib diberikan.');

    var hpsSheet = openTuSheet(SHEET_TU.BMN_PENGHAPUSAN);
    var hpsRows  = sheetToObjects(hpsSheet);

    var usulanRow = null;
    for (var i = 0; i < hpsRows.length; i++) {
      if (hpsRows[i]['PenghapusanID'] === penghapusanId && String(hpsRows[i]['Status']) === ROW_STATUS.ACTIVE) {
        usulanRow = hpsRows[i];
        break;
      }
    }

    if (!usulanRow) throw new Error('Berkas usulan penghapusan tidak ditemukan atau sudah tidak aktif.');

    // Ambil detail items
    var detailSheet = openTuSheet(SHEET_TU.BMN_PENGHAPUSAN_DETAIL);
    var detailRows  = sheetToObjects(detailSheet);

    var itemRefs = detailRows.filter(function (d) {
      return d['PenghapusanID'] === penghapusanId && String(d['Status']) === ROW_STATUS.ACTIVE;
    });

    // Ambil informasi master aset
    var asetSheet = openTuSheet(SHEET_TU.BMN_ASET);
    var asetRows  = sheetToObjects(asetSheet);
    var asetMap = {};
    asetRows.forEach(function (ar) {
      asetMap[ar['AsetID']] = ar;
    });

    var items = itemRefs.map(function (ir) {
      var a = asetMap[ir['AsetID']] || {};
      return {
        detailRowId:        String(ir['RowID']),
        asetId:             String(ir['AsetID']),
        kondisiSaatUsul:    String(ir['KondisiSaatUsul'] || 'RUSAK_BERAT'),
        nilaiBukuSaatUsul:  parseFloat(ir['NilaiBukuSaatUsul']) || 0,
        kodeBarang:         String(a['KodeBarang'] || ''),
        nup:                String(a['NUP'] || ''),
        namaBarang:         String(a['NamaBarang'] || ''),
        merekTipe:          String(a['MerekTipe'] || ''),
        lokasiId:           String(a['LokasiID'] || ''),
        namaLokasi:         String(a['NamaLokasi'] || ''),
        statusAset:         String(a['StatusAset'] || 'DALAM_PENGHAPUSAN')
      };
    });

    return {
      success: true,
      data: {
        usulan: {
          rowId:                   String(usulanRow['RowID']),
          penghapusanId:           String(usulanRow['PenghapusanID']),
          tahap:                   String(usulanRow['Tahap'] || 'DRAFT_USULAN'),
          alasanPenghapusan:       String(usulanRow['AlasanPenghapusan'] || ''),
          keteranganAlasan:         String(usulanRow['KeteranganAlasan'] || ''),
          nomorSuratUsulan:        String(usulanRow['NomorSuratUsulan'] || ''),
          tanggalSuratUsulan:      usulanRow['TanggalSuratUsulan'] ? String(usulanRow['TanggalSuratUsulan']).split('T')[0] : '',
          evidenceSuratUsulan:     String(usulanRow['EvidenceSuratUsulan'] || ''),
          nomorSuratPersetujuan:   String(usulanRow['NomorSuratPersetujuan'] || ''),
          tanggalSuratPersetujuan: usulanRow['TanggalSuratPersetujuan'] ? String(usulanRow['TanggalSuratPersetujuan']).split('T')[0] : '',
          instansiKemenkeu:        String(usulanRow['InstansiKemenkeu'] || ''),
          evidenceSuratPersetujuan:String(usulanRow['EvidenceSuratPersetujuan'] || ''),
          nomorSK:                 String(usulanRow['NomorSK'] || ''),
          tanggalSK:               usulanRow['TanggalSK'] ? String(usulanRow['TanggalSK']).split('T')[0] : '',
          evidenceSK:              String(usulanRow['EvidenceSK'] || ''),
          evidenceBAST:            String(usulanRow['EvidenceBAST'] || ''),
          totalUnit:               parseInt(usulanRow['TotalUnit'], 10) || 0,
          totalNilaiPerolehan:     parseFloat(usulanRow['TotalNilaiPerolehan']) || 0,
          totalNilaiBuku:          parseFloat(usulanRow['TotalNilaiBuku']) || 0,
          submittedBy:             String(usulanRow['SubmittedBy'] || ''),
          timestamp:               usulanRow['Timestamp']
        },
        items: items
      }
    };
  } catch (e) {
    Logger.log('[bmn_getPenghapusanDetail] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Memajukan tahapan berkas usulan penghapusan BMN sesuai State Machine legal Kemenkeu.
 *
 * Transisi:
 * - DRAFT_USULAN -> SURAT_USULAN (wajib NomorSuratUsulan, TanggalSuratUsulan, EvidenceSuratUsulan)
 * - SURAT_USULAN -> PERSETUJUAN_KEMENKEU (wajib NomorSuratPersetujuan, TanggalSuratPersetujuan, InstansiKemenkeu, EvidenceSuratPersetujuan)
 * - PERSETUJUAN_KEMENKEU -> SK_PENGHAPUSAN (wajib NomorSK, TanggalSK, EvidenceSK)
 * - SK_PENGHAPUSAN -> BAST_SELESAI (wajib EvidenceBAST) -> Eksekusi StatusAset = 'DIHAPUS'
 * - Any -> DITOLAK -> Lepaskan aset kembali ke StatusAset = 'AKTIF'
 */
function bmn_advancePenghapusan(token, payload) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertWrite(session);

    if (!payload || !payload.penghapusanId || !payload.tahapTarget) {
      throw new Error('PenghapusanID dan Tahap Target wajib diisi.');
    }

    var validTahap = ['SURAT_USULAN', 'PERSETUJUAN_KEMENKEU', 'SK_PENGHAPUSAN', 'BAST_SELESAI', 'DITOLAK'];
    if (validTahap.indexOf(payload.tahapTarget) === -1) {
      throw new Error('Tahap target tidak valid: ' + payload.tahapTarget);
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);

    try {
      var hpsSheet = openTuSheet(SHEET_TU.BMN_PENGHAPUSAN);
      var hpsRows  = sheetToObjects(hpsSheet);
      var hpsHeaders = hpsSheet.getRange(1, 1, 1, hpsSheet.getLastColumn()).getValues()[0];

      var targetRowIdx = -1;
      var currentHps = null;

      for (var i = 0; i < hpsRows.length; i++) {
        if (hpsRows[i]['PenghapusanID'] === payload.penghapusanId && String(hpsRows[i]['Status']) === ROW_STATUS.ACTIVE) {
          targetRowIdx = i + 2;
          currentHps = hpsRows[i];
          break;
        }
      }

      if (targetRowIdx === -1 || !currentHps) {
        throw new Error('Berkas usulan penghapusan tidak ditemukan atau sudah tidak aktif.');
      }

      var currentTahap = String(currentHps['Tahap'] || 'DRAFT_USULAN');
      if (currentTahap === 'BAST_SELESAI' || currentTahap === 'DITOLAK') {
        throw new Error('Berkas usulan ini sudah berada pada status final (' + currentTahap + ') dan tidak dapat diubah lagi.');
      }

      var colMap = {};
      hpsHeaders.forEach(function (h, idx) { colMap[h] = idx + 1; });

      // Validasi per tahap
      if (payload.tahapTarget === 'SURAT_USULAN') {
        if (!payload.nomorSuratUsulan) throw new Error('Nomor Surat Usulan Satker wajib diisi.');
        if (!payload.tanggalSuratUsulan) throw new Error('Tanggal Surat Usulan wajib diisi.');
        if (!payload.evidenceSuratUsulan) throw new Error('Bukti dukung berkas Surat Usulan (PDF / Drive) wajib dilampirkan.');

        hpsSheet.getRange(targetRowIdx, colMap['Tahap']).setValue('SURAT_USULAN');
        hpsSheet.getRange(targetRowIdx, colMap['NomorSuratUsulan']).setValue(payload.nomorSuratUsulan);
        hpsSheet.getRange(targetRowIdx, colMap['TanggalSuratUsulan']).setValue(payload.tanggalSuratUsulan);
        hpsSheet.getRange(targetRowIdx, colMap['EvidenceSuratUsulan']).setValue(payload.evidenceSuratUsulan);

      } else if (payload.tahapTarget === 'PERSETUJUAN_KEMENKEU') {
        if (!payload.nomorSuratPersetujuan) throw new Error('Nomor Surat Persetujuan Kemenkeu wajib diisi.');
        if (!payload.tanggalSuratPersetujuan) throw new Error('Tanggal Surat Persetujuan Kemenkeu wajib diisi.');
        if (!payload.instansiKemenkeu) throw new Error('Instansi Kemenkeu penerbit izin (DJKN/KPKNL) wajib diisi.');
        if (!payload.evidenceSuratPersetujuan) throw new Error('Bukti dukung izin persetujuan Kemenkeu (PDF / Drive) wajib dilampirkan.');

        hpsSheet.getRange(targetRowIdx, colMap['Tahap']).setValue('PERSETUJUAN_KEMENKEU');
        hpsSheet.getRange(targetRowIdx, colMap['NomorSuratPersetujuan']).setValue(payload.nomorSuratPersetujuan);
        hpsSheet.getRange(targetRowIdx, colMap['TanggalSuratPersetujuan']).setValue(payload.tanggalSuratPersetujuan);
        hpsSheet.getRange(targetRowIdx, colMap['InstansiKemenkeu']).setValue(payload.instansiKemenkeu);
        hpsSheet.getRange(targetRowIdx, colMap['EvidenceSuratPersetujuan']).setValue(payload.evidenceSuratPersetujuan);

      } else if (payload.tahapTarget === 'SK_PENGHAPUSAN') {
        if (!payload.nomorSK) throw new Error('Nomor SK Penghapusan KKP wajib diisi.');
        if (!payload.tanggalSK) throw new Error('Tanggal SK Penghapusan wajib diisi.');
        if (!payload.evidenceSK) throw new Error('Salinan berkas SK Penghapusan (PDF / Drive) wajib dilampirkan.');

        hpsSheet.getRange(targetRowIdx, colMap['Tahap']).setValue('SK_PENGHAPUSAN');
        hpsSheet.getRange(targetRowIdx, colMap['NomorSK']).setValue(payload.nomorSK);
        hpsSheet.getRange(targetRowIdx, colMap['TanggalSK']).setValue(payload.tanggalSK);
        hpsSheet.getRange(targetRowIdx, colMap['EvidenceSK']).setValue(payload.evidenceSK);

      } else if (payload.tahapTarget === 'BAST_SELESAI') {
        if (!payload.evidenceBAST) throw new Error('Bukti BAST Pemusnahan / Risalah Lelang wajib dilampirkan.');

        hpsSheet.getRange(targetRowIdx, colMap['Tahap']).setValue('BAST_SELESAI');
        hpsSheet.getRange(targetRowIdx, colMap['EvidenceBAST']).setValue(payload.evidenceBAST);

        // Eksekusi pemutakhiran status aset menjadi DIHAPUS
        var asetSheet = openTuSheet(SHEET_TU.BMN_ASET);
        var asetRows  = sheetToObjects(asetSheet);
        var asetHeaders = asetSheet.getRange(1, 1, 1, asetSheet.getLastColumn()).getValues()[0];
        var colStatusAset = asetHeaders.indexOf('StatusAset') + 1;

        for (var a = 0; a < asetRows.length; a++) {
          if (asetRows[a]['PenghapusanID'] === payload.penghapusanId && String(asetRows[a]['Status']) === ROW_STATUS.ACTIVE) {
            asetSheet.getRange(a + 2, colStatusAset).setValue('DIHAPUS');
          }
        }

      } else if (payload.tahapTarget === 'DITOLAK') {
        hpsSheet.getRange(targetRowIdx, colMap['Tahap']).setValue('DITOLAK');
        if (payload.alasanTolak) {
          var currKet = String(currentHps['KeteranganAlasan'] || '');
          hpsSheet.getRange(targetRowIdx, colMap['KeteranganAlasan']).setValue(currKet + ' [Ditolak: ' + payload.alasanTolak + ']');
        }

        // Kembalikan aset ke status AKTIF dan kosongkan PenghapusanID
        var asetSheetTolak = openTuSheet(SHEET_TU.BMN_ASET);
        var asetRowsTolak  = sheetToObjects(asetSheetTolak);
        var asetHeadersTolak = asetSheetTolak.getRange(1, 1, 1, asetSheetTolak.getLastColumn()).getValues()[0];
        var colStAset = asetHeadersTolak.indexOf('StatusAset') + 1;
        var colHpsId  = asetHeadersTolak.indexOf('PenghapusanID') + 1;

        for (var at = 0; at < asetRowsTolak.length; at++) {
          if (asetRowsTolak[at]['PenghapusanID'] === payload.penghapusanId && String(asetRowsTolak[at]['Status']) === ROW_STATUS.ACTIVE) {
            asetSheetTolak.getRange(at + 2, colStAset).setValue('AKTIF');
            asetSheetTolak.getRange(at + 2, colHpsId).setValue('');
          }
        }
      }

      logAudit(session.userId, 'ADVANCE_BMN_PENGHAPUSAN', 'TX_BMN_Penghapusan', currentHps['RowID'], {
        penghapusanId: payload.penghapusanId,
        tahapLama: currentTahap,
        tahapBaru: payload.tahapTarget
      });

      return {
        success: true,
        data: { penghapusanId: payload.penghapusanId, tahap: payload.tahapTarget },
        message: 'Tahapan berkas usulan ' + payload.penghapusanId + ' berhasil diperbarui ke ' + payload.tahapTarget + '.'
      };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[bmn_advancePenghapusan] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Menganulir berkas usulan penghapusan BMN.
 * Seluruh aset yang dikarantina otomatis dibebaskan kembali ke StatusAset = 'AKTIF'.
 */
function bmn_voidPenghapusan(token, params) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertVoid(session);

    if (!params || !params.penghapusanId || !params.alasan) {
      throw new Error('PenghapusanID dan Alasan Anulir wajib diisi.');
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);

    try {
      var hpsSheet = openTuSheet(SHEET_TU.BMN_PENGHAPUSAN);
      var hpsRows  = sheetToObjects(hpsSheet);
      var targetIdx = -1;
      var targetRowId = '';

      for (var i = 0; i < hpsRows.length; i++) {
        if (hpsRows[i]['PenghapusanID'] === params.penghapusanId && String(hpsRows[i]['Status']) === ROW_STATUS.ACTIVE) {
          targetIdx = i + 2;
          targetRowId = hpsRows[i]['RowID'];
          break;
        }
      }

      if (targetIdx === -1) {
        throw new Error('Berkas usulan penghapusan tidak ditemukan atau sudah tidak aktif.');
      }

      var hpsHeaders = hpsSheet.getRange(1, 1, 1, hpsSheet.getLastColumn()).getValues()[0];
      hpsSheet.getRange(targetIdx, hpsHeaders.indexOf('Status') + 1).setValue(ROW_STATUS.VOID);
      hpsSheet.getRange(targetIdx, hpsHeaders.indexOf('VoidReason') + 1).setValue(params.alasan);
      hpsSheet.getRange(targetIdx, hpsHeaders.indexOf('VoidedBy') + 1).setValue(session.userId);
      hpsSheet.getRange(targetIdx, hpsHeaders.indexOf('VoidedAt') + 1).setValue(new Date());

      // Anulir juga di detail
      var detailSheet = openTuSheet(SHEET_TU.BMN_PENGHAPUSAN_DETAIL);
      var detailRows  = sheetToObjects(detailSheet);
      var detailHeaders = detailSheet.getRange(1, 1, 1, detailSheet.getLastColumn()).getValues()[0];
      var colDStatus = detailHeaders.indexOf('Status') + 1;
      var colDReason = detailHeaders.indexOf('VoidReason') + 1;
      var colDBy     = detailHeaders.indexOf('VoidedBy') + 1;
      var colDAt     = detailHeaders.indexOf('VoidedAt') + 1;

      for (var d = 0; d < detailRows.length; d++) {
        if (detailRows[d]['PenghapusanID'] === params.penghapusanId && String(detailRows[d]['Status']) === ROW_STATUS.ACTIVE) {
          detailSheet.getRange(d + 2, colDStatus).setValue(ROW_STATUS.VOID);
          detailSheet.getRange(d + 2, colDReason).setValue(params.alasan);
          detailSheet.getRange(d + 2, colDBy).setValue(session.userId);
          detailSheet.getRange(d + 2, colDAt).setValue(new Date());
        }
      }

      // Bebaskan aset yang dikarantina kembali ke StatusAset = 'AKTIF'
      var asetSheet = openTuSheet(SHEET_TU.BMN_ASET);
      var asetRows  = sheetToObjects(asetSheet);
      var asetHeaders = asetSheet.getRange(1, 1, 1, asetSheet.getLastColumn()).getValues()[0];
      var colAsetSt = asetHeaders.indexOf('StatusAset') + 1;
      var colAsetHp = asetHeaders.indexOf('PenghapusanID') + 1;

      for (var a = 0; a < asetRows.length; a++) {
        if (asetRows[a]['PenghapusanID'] === params.penghapusanId && String(asetRows[a]['Status']) === ROW_STATUS.ACTIVE) {
          asetSheet.getRange(a + 2, colAsetSt).setValue('AKTIF');
          asetSheet.getRange(a + 2, colAsetHp).setValue('');
        }
      }

      logAudit(session.userId, 'VOID_BMN_PENGHAPUSAN', 'TX_BMN_Penghapusan', targetRowId, {
        penghapusanId: params.penghapusanId,
        alasan: params.alasan
      });

      return { success: true, message: 'Berkas usulan penghapusan berhasil dianulir dan aset dibebaskan kembali ke status aktif.' };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[bmn_voidPenghapusan] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ===========================================================================
// SIMANPOA ENGINE: PENATAUSAHAAN & PENGELOLAAN BMN (SAKTI PDF, NERACA, STNK)
// ===========================================================================

var _BMN_CAPITALIZATION_THRESHOLD = 2000000; // Rp 2.000.000 sesuai aturan kapitalisasi BMN Kemenkeu

/**
 * Klasifikasi otomatis kapitalisasi BMN di sisi server:
 * - Akun 117xxx -> PERSEDIAAN
 * - Nilai per unit >= Rp 2.000.000 -> BUKU (Intrakomptabel)
 * - Nilai per unit < Rp 2.000.000 -> REGULER (Ekstrakomptabel)
 */
function _bmnClassifyCapitalization(nilaiPerolehan, kodeAkun, fallback) {
  var akunStr = String(kodeAkun || '').trim();
  if (akunStr.indexOf('117') === 0) return 'PERSEDIAAN';
  var np = parseFloat(nilaiPerolehan) || 0;
  if (np >= _BMN_CAPITALIZATION_THRESHOLD) return 'BUKU';
  if (np > 0 && np < _BMN_CAPITALIZATION_THRESHOLD) return 'REGULER';
  var fb = String(fallback || 'BUKU').toUpperCase();
  if (fb === 'EKSTRA' || fb === 'EKSTRAKOMPTABEL' || fb === 'REGULER') return 'REGULER';
  if (fb === 'PERSEDIAAN') return 'PERSEDIAAN';
  return 'BUKU';
}

/**
 * Deteksi apakah suatu aset merupakan Kendaraan Bermotor Dinas (Mobil / Motor).
 */
function _bmnIsVehicleAsset(kodeBarang, kodeKategori, namaBarang) {
  var kb = String(kodeBarang || '').replace(/\./g, '').trim();
  var kat = String(kodeKategori || '').toUpperCase().trim();
  var nm = String(namaBarang || '').toLowerCase();
  if (kat === 'KAT-KENDARAAN') return true;
  if (kb.indexOf('30201') === 0 || kb.indexOf('30101') === 0) return true;
  if (/mini\s*bus|minibus|sepeda\s*motor|motor\s*dinas|mobil\s*patroli|mobil\s*dinas|pick\s*up|hilux|innova|pajero|hiace|avanza|vario|nmax/.test(nm)) {
    return true;
  }
  return false;
}

/**
 * Kalkulasi server-side sisa hari jatuh tempo Pajak Tahunan & STNK 5 Tahunan kendaraan dinas.
 * Aturan Peringatan (apabila tanggal jatuh tempo belum diperbarui):
 * - Pra-Tenggat & Hari H: Peringatan muncul pada tahapan H-30, H-7, H-1, dan Hari H (H-0).
 * - Lewat Tenggat (< 0 hari): Peringatan aktif muncul SETIAP HARI hingga diperbarui.
 */
function _bmnComputeStnkStatus(tglPajakStr, tglStnkStr, noPolisi, namaBarang) {
  var now = new Date();
  var todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  var todayIso = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
  var msPerDay = 24 * 60 * 60 * 1000;

  var daysPajak = null;
  var daysStnk  = null;

  if (tglPajakStr) {
    var dP = new Date(tglPajakStr);
    if (!isNaN(dP.getTime())) {
      var pMidnight = new Date(dP.getFullYear(), dP.getMonth(), dP.getDate()).getTime();
      daysPajak = Math.round((pMidnight - todayMidnight) / msPerDay);
    }
  }

  if (tglStnkStr) {
    var dS = new Date(tglStnkStr);
    if (!isNaN(dS.getTime())) {
      var sMidnight = new Date(dS.getFullYear(), dS.getMonth(), dS.getDate()).getTime();
      daysStnk = Math.round((sMidnight - todayMidnight) / msPerDay);
    }
  }

  if (daysPajak === null && daysStnk === null) {
    return {
      hasStnkData: false,
      tglPajak: '',
      tglStnk: '',
      daysToPajak: null,
      daysToStnk: null,
      minDays: null,
      statusReminder: 'BELUM_DIISI',
      milestoneStage: 'NONE',
      milestoneLabel: 'Belum Diisi',
      shouldTriggerPopup: false,
      isOverdueDaily: false,
      checkpointKey: '',
      jenisTindakan: 'Lengkapi Dokumen & Masa Berlaku STNK',
      alertMessage: 'Kendaraan dinas ' + (noPolisi || namaBarang || '') + ' belum dilengkapi data jatuh tempo pajak/STNK.'
    };
  }

  var minDays = null;
  if (daysPajak !== null && daysStnk !== null) {
    minDays = Math.min(daysPajak, daysStnk);
  } else if (daysPajak !== null) {
    minDays = daysPajak;
  } else {
    minDays = daysStnk;
  }

  var isStnkRenewal = (daysStnk !== null && daysStnk <= 45 && (daysPajak === null || daysStnk <= daysPajak + 7));
  var jenisTindakan = isStnkRenewal
    ? 'Pembayaran Pajak & Penggantian STNK 5 Tahunan Baru'
    : 'Pembayaran Pajak STNK Tahunan';
  var targetTgl = isStnkRenewal ? (tglStnkStr || tglPajakStr) : (tglPajakStr || tglStnkStr);

  var statusReminder = 'AMAN';
  var milestoneStage = 'AMAN';
  var milestoneLabel = 'Aman (H-' + minDays + ')';
  var shouldTriggerPopup = false;
  var isOverdueDaily = false;
  var checkpointKey = '';

  if (minDays < 0) {
    // Lewat Tenggat: Warning wajib muncul SETIAP HARI selama belum diperbarui
    statusReminder = 'LEWAT_JATUH_TEMPO';
    milestoneStage = 'LEWAT_TENGGAT_HARIAN';
    milestoneLabel = 'Lewat Tenggat H+' + Math.abs(minDays) + ' (Warning Harian)';
    shouldTriggerPopup = true;
    isOverdueDaily = true;
    checkpointKey = 'OVERDUE_DAILY_' + targetTgl + '_' + todayIso;
  } else if (minDays === 0) {
    // Hari H
    statusReminder = 'SEGERA_JATUH_TEMPO';
    milestoneStage = 'HARI_H';
    milestoneLabel = 'Hari H — Jatuh Tempo Hari Ini';
    shouldTriggerPopup = true;
    checkpointKey = 'MILESTONE_H0_' + targetTgl;
  } else if (minDays === 1) {
    // H-1
    statusReminder = 'SEGERA_JATUH_TEMPO';
    milestoneStage = 'H_1';
    milestoneLabel = 'Peringatan H-1 Jatuh Tempo';
    shouldTriggerPopup = true;
    checkpointKey = 'MILESTONE_H1_' + targetTgl;
  } else if (minDays <= 7) {
    // Fase H-7 (termasuk tepat H-7 atau jika belum diperbarui di rentang H-7..H-2)
    statusReminder = 'SEGERA_JATUH_TEMPO';
    milestoneStage = 'H_7';
    milestoneLabel = (minDays === 7) ? 'Peringatan H-7 Jatuh Tempo' : ('Fase H-7 (Sisa H-' + minDays + ')');
    shouldTriggerPopup = true;
    checkpointKey = 'MILESTONE_H7_' + targetTgl;
  } else if (minDays <= 30) {
    // Fase H-30 (termasuk tepat H-30 atau jika belum diperbarui di rentang H-30..H-8)
    statusReminder = 'SEGERA_JATUH_TEMPO';
    milestoneStage = 'H_30';
    milestoneLabel = (minDays === 30) ? 'Peringatan H-30 Jatuh Tempo' : ('Fase H-30 (Sisa H-' + minDays + ')');
    shouldTriggerPopup = true;
    checkpointKey = 'MILESTONE_H30_' + targetTgl;
  } else if (minDays <= 60) {
    statusReminder = 'PERHATIAN';
    milestoneStage = 'PERHATIAN';
    milestoneLabel = 'H-' + minDays;
  }

  var platLabel = noPolisi ? ('plat nomor ' + noPolisi) : (namaBarang || 'Kendaraan Dinas');
  var prefixUrgency = isOverdueDaily
    ? '[PERINGATAN HARIAN — LEWAT TENGGAT H+' + Math.abs(minDays) + '] '
    : (minDays === 0 ? '[JATUH TEMPO HARI INI (HARI H)] ' : (minDays === 1 ? '[PERINGATAN H-1] ' : (minDays <= 7 ? '[PERINGATAN H-7] ' : '[PERINGATAN H-30] ')));

  var alertMessage = prefixUrgency + 'Kendaraan dinas ' + platLabel +
    (namaBarang ? ' (' + namaBarang + ')' : '') +
    ', jatuh tempo tanggal ' + targetTgl +
    ', harus segera dilakukan ' + jenisTindakan.toLowerCase() + '.';

  return {
    hasStnkData: true,
    tglPajak: tglPajakStr || '',
    tglStnk: tglStnkStr || '',
    daysToPajak: daysPajak,
    daysToStnk: daysStnk,
    minDays: minDays,
    statusReminder: statusReminder,
    milestoneStage: milestoneStage,
    milestoneLabel: milestoneLabel,
    shouldTriggerPopup: shouldTriggerPopup,
    isOverdueDaily: isOverdueDaily,
    checkpointKey: checkpointKey,
    jenisTindakan: jenisTindakan,
    alertMessage: alertMessage
  };
}

/**
 * Self-healing kolom tambahan pada TX_BMN_Aset agar kompatibel dengan spreadsheet lama.
 */
var _EXEC_BMN_COLS_CHECKED = false;
function _ensureBmnAsetColumns(sheet) {
  if (!sheet || _EXEC_BMN_COLS_CHECKED) return;
  _EXEC_BMN_COLS_CHECKED = true;
  try {
    var cache = (typeof CacheService !== 'undefined') ? CacheService.getScriptCache() : null;
    if (cache && cache.get('sikap_bmn_cols_ok_v1') === '1') return;

    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) return;
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var extraCols = [
      'KodeAkunNeraca', 'NoPolisi', 'TglPajakTahunan', 'TglStnkLimaTahunan',
      'FotoStnkEvidenceID', 'NoDokumenSumber', 'StnkVerified'
    ];
    var missing = [];
    for (var i = 0; i < extraCols.length; i++) {
      if (headers.indexOf(extraCols[i]) === -1) {
        missing.push(extraCols[i]);
      }
    }
    if (missing.length > 0) {
      sheet.getRange(1, lastCol + 1, 1, missing.length)
        .setValues([missing])
        .setFontWeight('bold')
        .setBackground('#E8EAF6');
    }
    if (cache) { try { cache.put('sikap_bmn_cols_ok_v1', '1', 21600); } catch (eC) {} }
  } catch (e) {
    Logger.log('[_ensureBmnAsetColumns] ' + e.message);
  }
}

/**
 * Mengambil seluruh data workspace SIMANPOA:
 * - Posisi BMN di Neraca (dari TX_BMN_Neraca hasil sinkronisasi PDF SAKTI)
 * - Tabel 11 Kolom SAKTI (Intrakomptabel, Ekstrakomptabel, dan Gabungan dari TX_BMN_Rekap_Sakti)
 * - Daftar Kendaraan Dinas + Peringatan Jatuh Tempo Pajak / STNK (H-30, H-7, H-1, Hari H, dan Harian saat Lewat Tenggat)
 * Catatan: Tidak melakukan preload data statis; membaca murni dari database aktual.
 */
function bmn_getSaktiWorkspace(token, params) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertRead(session);

    var neracaSheet = openTuSheet(SHEET_TU.BMN_NERACA);
    var rekapSheet  = openTuSheet(SHEET_TU.BMN_REKAP_SAKTI);
    var asetSheet   = openTuSheet(SHEET_TU.BMN_ASET);
    _ensureBmnAsetColumns(asetSheet);

    var neracaRows = sheetToObjects(neracaSheet);
    var rekapRows  = sheetToObjects(rekapSheet);
    var asetRows   = sheetToObjects(asetSheet).filter(function (r) {
      return String(r['Status']) === ROW_STATUS.ACTIVE;
    });

    // 1. Olah Neraca
    var totalPersediaan = 0;
    var totalAsetTetapBruto = 0;
    var totalAkumulasiPenyusutan = 0;
    var totalAsetTakBerwujudBruto = 0;
    var totalNonOperasionalBruto = 0;
    var totalNeracaBersih = 0;

    var fmtPeriodeVal = function (raw) {
      if (!raw) return '';
      if (Object.prototype.toString.call(raw) === '[object Date]' && !isNaN(raw.getTime())) {
        return Utilities.formatDate(raw, 'Asia/Jakarta', 'yyyy-MM-dd');
      }
      var s = String(raw).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
      var parsed = new Date(s);
      if (!isNaN(parsed.getTime())) {
        return Utilities.formatDate(parsed, 'Asia/Jakarta', 'yyyy-MM-dd');
      }
      return s;
    };

    var neracaItems = neracaRows.map(function (n) {
      var val = parseFloat(n['JumlahNilai']) || 0;
      var kat = String(n['KategoriNeraca'] || 'ASET_TETAP');
      totalNeracaBersih += val;
      if (kat === 'PERSEDIAAN') totalPersediaan += val;
      else if (kat === 'ASET_TETAP') totalAsetTetapBruto += val;
      else if (kat === 'AKUMULASI_PENYUSUTAN') totalAkumulasiPenyusutan += val;
      else if (kat === 'ASET_TAK_BERWUJUD') totalAsetTakBerwujudBruto += val;
      else if (kat === 'ASET_NON_OPERASIONAL') totalNonOperasionalBruto += val;

      return {
        neracaId: String(n['NeracaID'] || ''),
        periodeLaporan: fmtPeriodeVal(n['PeriodeLaporan']) || '2026-09-30',
        kodeAkun: String(n['KodeAkun'] || ''),
        uraianAkun: String(n['UraianAkun'] || ''),
        jumlahNilai: val,
        kategoriNeraca: kat,
        sumberDokumen: String(n['SumberDokumen'] || '')
      };
    });

    // 2. Olah Rincian 11 Kolom SAKTI (INTRA, EKSTRA, dan komputasi GABUNGAN otomatis)
    var intraItems = [];
    var ekstraItems = [];
    var gabunganMap = {};

    var sumIntra = { qAwal: 0, nAwal: 0, qTambah: 0, nTambah: 0, qKurang: 0, nKurang: 0, qAkhir: 0, nAkhir: 0 };
    var sumEkstra = { qAwal: 0, nAwal: 0, qTambah: 0, nTambah: 0, qKurang: 0, nKurang: 0, qAkhir: 0, nAkhir: 0 };

    for (var i = 0; i < rekapRows.length; i++) {
      var r = rekapRows[i];
      var jenis = String(r['JenisLaporan'] || 'INTRA').toUpperCase();
      var itemObj = {
        rekapId: String(r['RekapID'] || ''),
        periodeLaporan: fmtPeriodeVal(r['PeriodeLaporan']) || '2026-09-30',
        jenisLaporan: jenis,
        kodeAkun: String(r['KodeAkun'] || '132111'),
        uraianAkun: String(r['UraianAkun'] || 'Peralatan dan Mesin'),
        kodeBarang: String(r['KodeBarang'] || ''),
        uraianBarang: String(r['UraianBarang'] || ''),
        satuan: String(r['Satuan'] || 'Unit'),
        kuantitasAwal: parseFloat(r['KuantitasAwal']) || 0,
        nilaiAwal: parseFloat(r['NilaiAwal']) || 0,
        kuantitasTambah: parseFloat(r['KuantitasTambah']) || 0,
        nilaiTambah: parseFloat(r['NilaiTambah']) || 0,
        kuantitasKurang: parseFloat(r['KuantitasKurang']) || 0,
        nilaiKurang: parseFloat(r['NilaiKurang']) || 0,
        kuantitasAkhir: parseFloat(r['KuantitasAkhir']) || 0,
        nilaiAkhir: parseFloat(r['NilaiAkhir']) || 0,
        sumberDokumen: String(r['SumberDokumen'] || '')
      };

      if (jenis === 'EKSTRA') {
        ekstraItems.push(itemObj);
        sumEkstra.qAwal += itemObj.kuantitasAwal;
        sumEkstra.nAwal += itemObj.nilaiAwal;
        sumEkstra.qTambah += itemObj.kuantitasTambah;
        sumEkstra.nTambah += itemObj.nilaiTambah;
        sumEkstra.qKurang += itemObj.kuantitasKurang;
        sumEkstra.nKurang += itemObj.nilaiKurang;
        sumEkstra.qAkhir += itemObj.kuantitasAkhir;
        sumEkstra.nAkhir += itemObj.nilaiAkhir;
      } else {
        intraItems.push(itemObj);
        sumIntra.qAwal += itemObj.kuantitasAwal;
        sumIntra.nAwal += itemObj.nilaiAwal;
        sumIntra.qTambah += itemObj.kuantitasTambah;
        sumIntra.nTambah += itemObj.nilaiTambah;
        sumIntra.qKurang += itemObj.kuantitasKurang;
        sumIntra.nKurang += itemObj.nilaiKurang;
        sumIntra.qAkhir += itemObj.kuantitasAkhir;
        sumIntra.nAkhir += itemObj.nilaiAkhir;
      }

      var gKey = itemObj.kodeAkun + '__' + itemObj.kodeBarang;
      if (!gabunganMap[gKey]) {
        gabunganMap[gKey] = {
          rekapId: 'GAB-' + itemObj.kodeBarang,
          periodeLaporan: itemObj.periodeLaporan,
          jenisLaporan: 'GABUNGAN',
          kodeAkun: itemObj.kodeAkun,
          uraianAkun: itemObj.uraianAkun,
          kodeBarang: itemObj.kodeBarang,
          uraianBarang: itemObj.uraianBarang.replace(/\s*\(Di Bawah Kapitalisasi\)|\s*\(Ekstrakomptabel\)/gi, ''),
          satuan: itemObj.satuan,
          kuantitasAwal: 0,
          nilaiAwal: 0,
          kuantitasTambah: 0,
          nilaiTambah: 0,
          kuantitasKurang: 0,
          nilaiKurang: 0,
          kuantitasAkhir: 0,
          nilaiAkhir: 0,
          intraCount: 0,
          ekstraCount: 0
        };
      }
      var gTarget = gabunganMap[gKey];
      gTarget.kuantitasAwal += itemObj.kuantitasAwal;
      gTarget.nilaiAwal += itemObj.nilaiAwal;
      gTarget.kuantitasTambah += itemObj.kuantitasTambah;
      gTarget.nilaiTambah += itemObj.nilaiTambah;
      gTarget.kuantitasKurang += itemObj.kuantitasKurang;
      gTarget.nilaiKurang += itemObj.nilaiKurang;
      gTarget.kuantitasAkhir += itemObj.kuantitasAkhir;
      gTarget.nilaiAkhir += itemObj.nilaiAkhir;
      if (jenis === 'EKSTRA') gTarget.ekstraCount += itemObj.kuantitasAkhir;
      else gTarget.intraCount += itemObj.kuantitasAkhir;
    }

    var gabunganItems = [];
    for (var gk in gabunganMap) {
      if (gabunganMap.hasOwnProperty(gk)) {
        gabunganItems.push(gabunganMap[gk]);
      }
    }

    // Fallback: Jika TX_BMN_Neraca belum diunggah tetapi TX_BMN_Rekap_Sakti sudah ada data,
    // agregasikan saldo akhir per KodeAkun dari Rincian Barang agar tab Neraca tidak kosong.
    var isDerivedFromRekap = false;
    if (neracaItems.length === 0 && gabunganItems.length > 0) {
      isDerivedFromRekap = true;
      var derivedMap = {};
      for (var dIdx = 0; dIdx < gabunganItems.length; dIdx++) {
        var gIt = gabunganItems[dIdx];
        var dAkun = String(gIt.kodeAkun || '132111').trim();
        if (!derivedMap[dAkun]) {
          var dKat = 'ASET_TETAP';
          if (dAkun.indexOf('117') === 0) dKat = 'PERSEDIAAN';
          else if (dAkun.indexOf('137') === 0 || dAkun.indexOf('169') === 0) dKat = 'AKUMULASI_PENYUSUTAN';
          else if (dAkun.indexOf('162') === 0) dKat = 'ASET_TAK_BERWUJUD';
          else if (dAkun.indexOf('166') === 0) dKat = 'ASET_NON_OPERASIONAL';

          derivedMap[dAkun] = {
            neracaId: 'DRV-' + dAkun,
            periodeLaporan: gIt.periodeLaporan || '',
            kodeAkun: dAkun,
            uraianAkun: gIt.uraianAkun || ('Akun ' + dAkun),
            jumlahNilai: 0,
            kategoriNeraca: dKat,
            sumberDokumen: 'Ringkasan Rincian Barang SAKTI'
          };
        }
        derivedMap[dAkun].jumlahNilai += (parseFloat(gIt.nilaiAkhir) || 0);
      }
      var derivedKeys = Object.keys(derivedMap).sort();
      for (var dk = 0; dk < derivedKeys.length; dk++) {
        var dObj = derivedMap[derivedKeys[dk]];
        neracaItems.push(dObj);
        totalNeracaBersih += dObj.jumlahNilai;
        if (dObj.kategoriNeraca === 'PERSEDIAAN') totalPersediaan += dObj.jumlahNilai;
        else if (dObj.kategoriNeraca === 'ASET_TETAP') totalAsetTetapBruto += dObj.jumlahNilai;
        else if (dObj.kategoriNeraca === 'AKUMULASI_PENYUSUTAN') totalAkumulasiPenyusutan += dObj.jumlahNilai;
        else if (dObj.kategoriNeraca === 'ASET_TAK_BERWUJUD') totalAsetTakBerwujudBruto += dObj.jumlahNilai;
        else if (dObj.kategoriNeraca === 'ASET_NON_OPERASIONAL') totalNonOperasionalBruto += dObj.jumlahNilai;
      }
    }

    // 3. Olah Daftar Kendaraan Dinas (Mobil & Motor) & Peringatan Pajak/STNK
    var kendaraanList = [];
    var dueAlerts = [];

    for (var a = 0; a < asetRows.length; a++) {
      var ar = asetRows[a];
      var kBrg = String(ar['KodeBarang'] || '');
      var kat  = String(ar['KodeKategori'] || '');
      var nm   = String(ar['NamaBarang'] || '');
      if (_bmnIsVehicleAsset(kBrg, kat, nm)) {
        var noPol = String(ar['NoPolisi'] || '');
        var tPjk  = fmtPeriodeVal(ar['TglPajakTahunan']);
        var tStnk = fmtPeriodeVal(ar['TglStnkLimaTahunan']);
        var stnkInfo = _bmnComputeStnkStatus(tPjk, tStnk, noPol, nm);

        var vObj = {
          rowId: String(ar['RowID'] || ''),
          asetId: String(ar['AsetID'] || ''),
          kodeBarang: kBrg,
          nup: String(ar['NUP'] || ''),
          namaBarang: nm,
          merekTipe: String(ar['MerekTipe'] || ''),
          noPolisi: noPol,
          lokasiId: String(ar['LokasiID'] || 'UPT-PUSAT-POA'),
          lokasiDetailRuangan: String(ar['LokasiDetailRuangan'] || ''),
          nilaiPerolehan: parseFloat(ar['NilaiPerolehan']) || 0,
          nilaiBuku: parseFloat(ar['NilaiBuku']) || 0,
          kondisi: String(ar['Kondisi'] || 'BAIK'),
          statusAset: String(ar['StatusAset'] || 'AKTIF'),
          tglPajakTahunan: tPjk,
          tglStnkLimaTahunan: tStnk,
          fotoEvidenceId: String(ar['FotoEvidenceID'] || ''),
          fotoStnkEvidenceId: String(ar['FotoStnkEvidenceID'] || ''),
          stnkVerified: String(ar['StnkVerified'] || 'YA'),
          stnkStatus: stnkInfo
        };
        kendaraanList.push(vObj);

        if (vObj.statusAset === 'AKTIF' && stnkInfo && (stnkInfo.statusReminder === 'LEWAT_JATUH_TEMPO' || stnkInfo.statusReminder === 'SEGERA_JATUH_TEMPO')) {
          dueAlerts.push(vObj);
        }
      }
    }

    // Urutkan kendaraan berdasarkan sisa hari pajak terdekat di atas
    kendaraanList.sort(function (x, y) {
      var dx = (x.stnkStatus && x.stnkStatus.minDays !== null) ? x.stnkStatus.minDays : 9999;
      var dy = (y.stnkStatus && y.stnkStatus.minDays !== null) ? y.stnkStatus.minDays : 9999;
      return dx - dy;
    });

    dueAlerts.sort(function (x, y) {
      var dx = (x.stnkStatus && x.stnkStatus.minDays !== null) ? x.stnkStatus.minDays : 9999;
      var dy = (y.stnkStatus && y.stnkStatus.minDays !== null) ? y.stnkStatus.minDays : 9999;
      return dx - dy;
    });

    var neracaPeriodeLabel = (neracaItems.length > 0 && neracaItems[0].periodeLaporan) ? neracaItems[0].periodeLaporan : '';
    var rincianPeriodeLabel = (rekapRows.length > 0 && rekapRows[0]['PeriodeLaporan']) ? fmtPeriodeVal(rekapRows[0]['PeriodeLaporan']) : '';
    var activePeriodeLabel = neracaPeriodeLabel || rincianPeriodeLabel || '';

    return {
      success: true,
      data: {
        periodeLaporan: neracaPeriodeLabel || activePeriodeLabel,
        periodeRincian: rincianPeriodeLabel,
        neraca: {
          items: neracaItems,
          isDerivedFromRekap: isDerivedFromRekap,
          totals: {
            persediaan: totalPersediaan,
            asetTetapBruto: totalAsetTetapBruto,
            akumulasiPenyusutan: totalAkumulasiPenyusutan,
            asetTakBerwujudBruto: totalAsetTakBerwujudBruto,
            nonOperasionalBruto: totalNonOperasionalBruto,
            neracaBersih: totalNeracaBersih
          }
        },
        rekapSakti: {
          intra: intraItems,
          ekstra: ekstraItems,
          gabungan: gabunganItems,
          summaryIntra: sumIntra,
          summaryEkstra: sumEkstra,
          summaryGabungan: {
            qAwal: sumIntra.qAwal + sumEkstra.qAwal,
            nAwal: sumIntra.nAwal + sumEkstra.nAwal,
            qTambah: sumIntra.qTambah + sumEkstra.qTambah,
            nTambah: sumIntra.nTambah + sumEkstra.nTambah,
            qKurang: sumIntra.qKurang + sumEkstra.qKurang,
            nKurang: sumIntra.nKurang + sumEkstra.nKurang,
            qAkhir: sumIntra.qAkhir + sumEkstra.qAkhir,
            nAkhir: sumIntra.nAkhir + sumEkstra.nAkhir
          }
        },
        kendaraan: {
          items: kendaraanList,
          dueAlerts: dueAlerts,
          totalCount: kendaraanList.length,
          dueCount: dueAlerts.length
        }
      }
    };
  } catch (e) {
    Logger.log('[bmn_getSaktiWorkspace] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Preview / Dry-Run Sinkronisasi Dokumen Laporan PDF SAKTI Kemenkeu.
 * Menerima hasil ekstraksi baris dari PDF SAKTI (Neraca / Intra / Ekstra / Gabungan / Pembelian Semester)
 * dan menghitung delta perubahan terhadap database SIMANPOA di server.
 */
function bmn_previewSaktiSync(token, payload) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertWrite(session);

    if (!payload || !payload.rows || !Array.isArray(payload.rows)) {
      throw new Error('Data hasil pembacaan dokumen PDF kosong atau tidak valid.');
    }

    var docType = String(payload.docType || 'RINCIAN_BARANG').toUpperCase();
    var jenisLap = String(payload.jenisLaporan || 'AUTO').toUpperCase();
    var periodeLap = String(payload.periodeLaporan || '2026-09-30');
    var fileName = String(payload.fileName || 'Dokumen_SAKTI.pdf');

    if (docType === 'NERACA') {
      var neracaSheet = openTuSheet(SHEET_TU.BMN_NERACA);
      var existNrc = sheetToObjects(neracaSheet);
      var nrcMap = {};
      existNrc.forEach(function (n) {
        nrcMap[String(n['KodeAkun'])] = parseFloat(n['JumlahNilai']) || 0;
      });

      var previewNeraca = payload.rows.map(function (r) {
        var kode = String(r.kodeAkun || r.kode || '').trim();
        var uraian = String(r.uraianAkun || r.uraian || '').trim();
        var nilaiBaru = parseFloat(r.jumlahNilai !== undefined ? r.jumlahNilai : r.nilaiAkhir) || 0;
        var nilaiLama = nrcMap.hasOwnProperty(kode) ? nrcMap[kode] : null;
        var selisih = nilaiLama !== null ? (nilaiBaru - nilaiLama) : nilaiBaru;
        var statusDelta = nilaiLama === null ? 'AKUN_BARU' : (Math.abs(selisih) > 0 ? 'BERUBAH' : 'TETAP');

        return {
          kodeAkun: kode,
          uraianAkun: uraian,
          nilaiLama: nilaiLama || 0,
          nilaiBaru: nilaiBaru,
          selisih: selisih,
          statusDelta: statusDelta
        };
      });

      return {
        success: true,
        data: {
          docType: 'NERACA',
          jenisLaporan: 'NERACA',
          periodeLaporan: periodeLap,
          fileName: fileName,
          totalRows: previewNeraca.length,
          previewRows: previewNeraca
        }
      };
    }

    // Untuk Rincian Barang (Intra / Ekstra / Gabungan / Pembelian)
    var rekapSheet = openTuSheet(SHEET_TU.BMN_REKAP_SAKTI);
    var existRekap = sheetToObjects(rekapSheet);
    var rekapMap = {};
    existRekap.forEach(function (rk) {
      var jenisRk = String(rk['JenisLaporan'] || '').toUpperCase().trim();
      var akunRk = String(rk['KodeAkun'] || '').trim();
      var brgRk = String(rk['KodeBarang'] || '').replace(/\./g, '').trim();
      rekapMap[jenisRk + '__' + akunRk + '__' + brgRk] = rk;
      if (!rekapMap[jenisRk + '__' + brgRk]) {
        rekapMap[jenisRk + '__' + brgRk] = rk;
      }
    });

    var totalMutasiTambahQty = 0;
    var totalMutasiTambahNilai = 0;
    var totalMutasiKurangQty = 0;
    var totalMutasiKurangNilai = 0;
    var changedCount = 0;

    var previewItems = payload.rows.map(function (r) {
      var kodeBrg = String(r.kodeBarang || r.kode || '').replace(/\./g, '').trim();
      var uraianBrg = String(r.uraianBarang || r.uraian || '').trim();
      var sat = String(r.satuan || r.sat || 'Unit').trim();
      var kodeAkun = String(r.kodeAkun || '132111').trim();
      var uraianAkun = String(r.uraianAkun || 'Peralatan dan Mesin').trim();

      var qAwal = parseFloat(r.kuantitasAwal) || 0;
      var nAwal = parseFloat(r.nilaiAwal) || 0;
      var qTambah = parseFloat(r.kuantitasTambah) || 0;
      var nTambah = parseFloat(r.nilaiTambah) || 0;
      var qKurang = parseFloat(r.kuantitasKurang) || 0;
      var nKurang = parseFloat(r.nilaiKurang) || 0;
      var qAkhir = parseFloat(r.kuantitasAkhir !== undefined ? r.kuantitasAkhir : (qAwal + qTambah - qKurang)) || 0;
      var nAkhir = parseFloat(r.nilaiAkhir !== undefined ? r.nilaiAkhir : (nAwal + nTambah - nKurang)) || 0;

      if (qAwal < 0 || qTambah < 0 || qKurang < 0 || qAkhir < 0) {
        throw new Error('Kuantitas barang pada dokumen SAKTI tidak boleh bernilai negatif (' + kodeBrg + ').');
      }
      if (nAwal < 0 || nAkhir < 0) {
        throw new Error('Saldo nilai rupiah barang tidak boleh bernilai negatif (' + kodeBrg + ').');
      }

      // Hitung nilai per unit untuk klasifikasi kapitalisasi otomatis (Intra >= 2 Jt vs Ekstra < 2 Jt)
      var unitVal = qAkhir > 0 ? (nAkhir / qAkhir) : (qTambah > 0 ? (nTambah / qTambah) : nAwal);
      var resolvedJenis = jenisLap;
      if (resolvedJenis === 'AUTO' || resolvedJenis === 'GABUNGAN' || resolvedJenis === 'TRANSAKSI') {
        resolvedJenis = (unitVal > 0 && unitVal < _BMN_CAPITALIZATION_THRESHOLD) ? 'EKSTRA' : 'INTRA';
      }

      var lookupKey = resolvedJenis + '__' + kodeAkun + '__' + kodeBrg;
      var existing = rekapMap[lookupKey] || rekapMap[resolvedJenis + '__' + kodeBrg] || null;
      var oldQ = existing ? (parseFloat(existing['KuantitasAkhir']) || 0) : null;
      var oldN = existing ? (parseFloat(existing['NilaiAkhir']) || 0) : null;

      var statusBaris = 'TETAP';
      if (!existing) {
        statusBaris = 'BARANG_BARU';
        changedCount++;
      } else if (qTambah > 0 && qKurang > 0) {
        statusBaris = 'MUTASI_TAMBAH_KURANG';
        changedCount++;
      } else if (qTambah > 0) {
        statusBaris = 'MUTASI_BERTAMBAH';
        changedCount++;
      } else if (qKurang > 0) {
        statusBaris = 'MUTASI_BERKURANG';
        changedCount++;
      } else if (oldQ !== qAkhir || Math.abs((oldN || 0) - nAkhir) > 1) {
        statusBaris = 'SALDO_BERUBAH';
        changedCount++;
      }

      totalMutasiTambahQty += qTambah;
      totalMutasiTambahNilai += nTambah;
      totalMutasiKurangQty += qKurang;
      totalMutasiKurangNilai += nKurang;

      return {
        jenisLaporan: resolvedJenis,
        labelKapitalisasi: resolvedJenis === 'EKSTRA' ? 'EKSTRAKOMPTABEL (< Rp 2 Jt)' : 'INTRAKOMPTABEL (>= Rp 2 Jt)',
        kodeAkun: kodeAkun,
        uraianAkun: uraianAkun,
        kodeBarang: kodeBrg,
        uraianBarang: uraianBrg,
        satuan: sat,
        kuantitasAwal: qAwal,
        nilaiAwal: nAwal,
        kuantitasTambah: qTambah,
        nilaiTambah: nTambah,
        kuantitasKurang: qKurang,
        nilaiKurang: nKurang,
        kuantitasAkhir: qAkhir,
        nilaiAkhir: nAkhir,
        nilaiPerUnitEstimasi: Math.round(unitVal),
        oldKuantitasAkhir: oldQ,
        oldNilaiAkhir: oldN,
        statusDelta: statusBaris
      };
    });

    return {
      success: true,
      data: {
        docType: 'RINCIAN_BARANG',
        jenisLaporan: jenisLap,
        periodeLaporan: periodeLap,
        fileName: fileName,
        totalRows: previewItems.length,
        changedCount: changedCount,
        totalMutasiTambahQty: totalMutasiTambahQty,
        totalMutasiTambahNilai: totalMutasiTambahNilai,
        totalMutasiKurangQty: totalMutasiKurangQty,
        totalMutasiKurangNilai: totalMutasiKurangNilai,
        previewRows: previewItems
      }
    };
  } catch (e) {
    Logger.log('[bmn_previewSaktiSync] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Commit / Terapkan Sinkronisasi Dokumen PDF SAKTI ke basis data SIMANPOA setelah diverifikasi operator.
 */
function bmn_commitSaktiSync(token, payload) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertWrite(session);

    if (!payload || !payload.rows || !Array.isArray(payload.rows) || payload.rows.length === 0) {
      throw new Error('Tidak ada baris data yang dipilih untuk disinkronkan.');
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);

    try {
      var now = new Date();
      var docType = String(payload.docType || 'RINCIAN_BARANG').toUpperCase();
      var periodeLap = String(payload.periodeLaporan || '2026-09-30');
      var fileName = String(payload.fileName || 'Sinkronisasi_PDF_SAKTI.pdf');

      if (docType === 'NERACA') {
        var neracaSheet = openTuSheet(SHEET_TU.BMN_NERACA);
        var existNrc = sheetToObjects(neracaSheet);
        var nrcIdxMap = {};
        for (var n = 0; n < existNrc.length; n++) {
          nrcIdxMap[String(existNrc[n]['KodeAkun']).trim()] = n + 2;
        }

        var updatedNrc = 0;
        var insertedNrc = 0;
        var newNeracaRows = [];

        for (var i = 0; i < payload.rows.length; i++) {
          var r = payload.rows[i];
          var kode = String(r.kodeAkun || '').trim();
          if (!kode) continue;
          var uraian = String(r.uraianAkun || '').trim();
          var nilai = parseFloat(r.nilaiBaru !== undefined ? r.nilaiBaru : r.jumlahNilai) || 0;
          var kat = 'ASET_TETAP';
          if (kode.indexOf('117') === 0) kat = 'PERSEDIAAN';
          else if (kode.indexOf('137') === 0 || kode.indexOf('169') === 0) kat = 'AKUMULASI_PENYUSUTAN';
          else if (kode.indexOf('162') === 0) kat = 'ASET_TAK_BERWUJUD';
          else if (kode.indexOf('166') === 0) kat = 'ASET_NON_OPERASIONAL';

          if (nrcIdxMap[kode]) {
            var rowNum = nrcIdxMap[kode];
            neracaSheet.getRange(rowNum, 2, 1, 8).setValues([[
              periodeLap, kode, uraian, nilai, kat, now, session.userId, fileName
            ]]);
            updatedNrc++;
          } else {
            var nId = 'NRC-' + Utilities.getUuid().substring(0, 8).toUpperCase();
            newNeracaRows.push([
              nId, periodeLap, kode, uraian, nilai, kat, now, session.userId, fileName
            ]);
            insertedNrc++;
          }
        }

        if (newNeracaRows.length > 0) {
          neracaSheet.getRange(neracaSheet.getLastRow() + 1, 1, newNeracaRows.length, newNeracaRows[0].length).setValues(newNeracaRows);
        }
        SpreadsheetApp.flush();

        logAudit(session.userId, 'SYNC_SAKTI_NERACA', 'TX_BMN_Neraca', periodeLap, {
          fileName: fileName,
          updated: updatedNrc,
          inserted: insertedNrc
        });

        return {
          success: true,
          message: 'Laporan Posisi BMN di Neraca berhasil disinkronkan (' + updatedNrc + ' akun diperbarui, ' + insertedNrc + ' akun baru).'
        };
      }

      // Sinkronisasi Rincian Barang (Intra / Ekstra) + Auto-Generate Unit di TX_BMN_Aset bila diminta
      var rekapSheet = openTuSheet(SHEET_TU.BMN_REKAP_SAKTI);
      var existRekap = sheetToObjects(rekapSheet);
      var rekapIdxMap = {};
      for (var k = 0; k < existRekap.length; k++) {
        var rJenis = String(existRekap[k]['JenisLaporan'] || '').toUpperCase().trim();
        var rAkun = String(existRekap[k]['KodeAkun'] || '').trim();
        var rBrg = String(existRekap[k]['KodeBarang'] || '').replace(/\./g, '').trim();
        rekapIdxMap[rJenis + '__' + rAkun + '__' + rBrg] = k + 2;
      }

      var updatedRekap = 0;
      var insertedRekap = 0;
      var autoUnitAdded = 0;

      var asetSheet = openTuSheet(SHEET_TU.BMN_ASET);
      _ensureBmnAsetColumns(asetSheet);
      var asetRows = sheetToObjects(asetSheet);
      var maxNupByKode = {};
      for (var a = 0; a < asetRows.length; a++) {
        var kb = String(asetRows[a]['KodeBarang'] || '').replace(/\./g, '');
        var nupNum = parseInt(asetRows[a]['NUP'], 10) || 0;
        if (!maxNupByKode[kb] || nupNum > maxNupByKode[kb]) {
          maxNupByKode[kb] = nupNum;
        }
      }

      var newRekapRows = [];
      var newRekapBatchIdx = {};
      var newUnitRows = [];
      var periode = getCurrentPeriode();

      for (var j = 0; j < payload.rows.length; j++) {
        var item = payload.rows[j];
        var kodeBrg = String(item.kodeBarang || '').replace(/\./g, '').trim();
        if (!kodeBrg) continue;

        var qAwal = parseFloat(item.kuantitasAwal) || 0;
        var nAwal = parseFloat(item.nilaiAwal) || 0;
        var qTambah = parseFloat(item.kuantitasTambah) || 0;
        var nTambah = parseFloat(item.nilaiTambah) || 0;
        var qKurang = parseFloat(item.kuantitasKurang) || 0;
        var nKurang = parseFloat(item.nilaiKurang) || 0;
        var qAkhir = parseFloat(item.kuantitasAkhir !== undefined ? item.kuantitasAkhir : (qAwal + qTambah - qKurang)) || 0;
        var nAkhir = parseFloat(item.nilaiAkhir !== undefined ? item.nilaiAkhir : (nAwal + nTambah - nKurang)) || 0;

        if (qAwal < 0 || qTambah < 0 || qKurang < 0 || qAkhir < 0 || nAwal < 0 || nAkhir < 0) {
          throw new Error('Data kuantitas maupun saldo nilai rincian SAKTI tidak boleh bernilai negatif (' + kodeBrg + ').');
        }

        var unitVal = qAkhir > 0 ? (nAkhir / qAkhir) : (qTambah > 0 ? (nTambah / qTambah) : nAwal);
        var jenis = String(item.jenisLaporan || '').toUpperCase().trim();
        if (jenis !== 'INTRA' && jenis !== 'EKSTRA') {
          jenis = (unitVal > 0 && unitVal < _BMN_CAPITALIZATION_THRESHOLD) ? 'EKSTRA' : 'INTRA';
        }

        var kodeAkun = String(item.kodeAkun || '132111').trim();
        var mapKey = jenis + '__' + kodeAkun + '__' + kodeBrg;
        var uraianAkun = String(item.uraianAkun || 'Peralatan dan Mesin').trim();
        var uraianBrg = String(item.uraianBarang || 'Barang BMN').trim();
        var satuan = String(item.satuan || 'Unit').trim();

        if (rekapIdxMap[mapKey]) {
          var rIdx = rekapIdxMap[mapKey];
          rekapSheet.getRange(rIdx, 2, 1, 18).setValues([[
            periodeLap, jenis, kodeAkun, uraianAkun, kodeBrg, uraianBrg, satuan,
            qAwal, nAwal, qTambah, nTambah, qKurang, nKurang, qAkhir, nAkhir,
            now, session.userId, fileName
          ]]);
          updatedRekap++;
        } else if (newRekapBatchIdx[mapKey] !== undefined) {
          newRekapRows[newRekapBatchIdx[mapKey]] = [
            newRekapRows[newRekapBatchIdx[mapKey]][0], periodeLap, jenis, kodeAkun, uraianAkun, kodeBrg, uraianBrg, satuan,
            qAwal, nAwal, qTambah, nTambah, qKurang, nKurang, qAkhir, nAkhir,
            now, session.userId, fileName
          ];
        } else {
          var newRekapId = 'RKP-' + Utilities.getUuid().substring(0, 8).toUpperCase();
          newRekapBatchIdx[mapKey] = newRekapRows.length;
          newRekapRows.push([
            newRekapId, periodeLap, jenis, kodeAkun, uraianAkun, kodeBrg, uraianBrg, satuan,
            qAwal, nAwal, qTambah, nTambah, qKurang, nKurang, qAkhir, nAkhir,
            now, session.userId, fileName
          ]);
          insertedRekap++;
        }

        // Jika terdapat Mutasi Bertambah (> 0) dan opsi autoGenerateUnits aktif, tambahkan ke TX_BMN_Aset (maks 25 unit per item agar aman)
        if (payload.autoGenerateUnits !== false && qTambah > 0 && qTambah <= 25) {
          var perUnitTambah = Math.round(nTambah / qTambah);
          var pencatatanUnit = (jenis === 'EKSTRA' || perUnitTambah < _BMN_CAPITALIZATION_THRESHOLD) ? 'REGULER' : 'BUKU';
          var katUnit = _bmnIsVehicleAsset(kodeBrg, '', uraianBrg) ? 'KAT-KENDARAAN' : (kodeBrg.indexOf('310') === 0 ? 'KAT-TIK' : 'KAT-KANTOR');
          var baseNup = maxNupByKode[kodeBrg] || Math.max(0, Math.round(qAwal));

          for (var u = 1; u <= qTambah; u++) {
            var nextNup = baseNup + u;
            maxNupByKode[kodeBrg] = nextNup;
            var nupPad = nextNup >= 1000 ? String(nextNup) : ('000' + nextNup).slice(-3);
            var uAsetId = 'BMN-' + kodeBrg + '-' + nupPad;
            var uRowId = 'ROW-' + Utilities.getUuid().substring(0, 12).toUpperCase();
            newUnitRows.push([
              uRowId, _BMN_DIVISI_ID, periode, session.userId, now,
              ROW_STATUS.ACTIVE, '', '', '', '',
              uAsetId, kodeBrg, String(nextNup), uraianBrg, 'Hasil Sinkronisasi PDF SAKTI (' + periodeLap + ')',
              pencatatanUnit, katUnit, periodeLap, perUnitTambah, perUnitTambah,
              'BAIK', 'UPT-PUSAT-POA', 'Dit. POA (Pusat KKP Jakarta)', -6.175392, 106.827153,
              'IMPOR_SAKTI_PDF', 0.05, periodeLap, '', 'AKTIF', '', '', 'SYNC-SAKTI-' + periodeLap,
              'Mutasi bertambah otomatis dari dokumen ' + fileName,
              kodeAkun, '', '', '', '', fileName, 'YA'
            ]);
            autoUnitAdded++;
          }
        }
      }

      if (newRekapRows.length > 0) {
        rekapSheet.getRange(rekapSheet.getLastRow() + 1, 1, newRekapRows.length, newRekapRows[0].length).setValues(newRekapRows);
      }

      if (newUnitRows.length > 0) {
        asetSheet.getRange(asetSheet.getLastRow() + 1, 1, newUnitRows.length, newUnitRows[0].length).setValues(newUnitRows);
      }
      SpreadsheetApp.flush();

      logAudit(session.userId, 'SYNC_SAKTI_RINCIAN', 'TX_BMN_Rekap_Sakti', periodeLap, {
        fileName: fileName,
        updatedRekap: updatedRekap,
        insertedRekap: insertedRekap,
        autoUnitAdded: autoUnitAdded
      });

      return {
        success: true,
        data: {
          updatedRekap: updatedRekap,
          insertedRekap: insertedRekap,
          autoUnitAdded: autoUnitAdded
        },
        message: 'Sinkronisasi PDF SAKTI berhasil diterapkan (' + updatedRekap + ' kelompok diperbarui, ' + insertedRekap + ' kelompok baru' + (autoUnitAdded > 0 ? ', serta ' + autoUnitAdded + ' unit mutasi bertambah dicatat ke Register Aset' : '') + ').'
      };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[bmn_commitSaktiSync] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Mencocokkan hasil pembacaan dokumen PDF SK Penghapusan / BAST Transfer Keluar
 * dengan aset aktif yang ada di database SIMANPOA untuk diverifikasi pengguna.
 */
function bmn_previewDisposalDoc(token, payload) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertWrite(session);

    payload = payload || {};
    var extractedCodes = payload.extractedCodes || [];
    var extractedKeywords = payload.extractedKeywords || [];
    var rawText = String(payload.rawText || '').toLowerCase();

    var asetSheet = openTuSheet(SHEET_TU.BMN_ASET);
    _ensureBmnAsetColumns(asetSheet);
    var asetRows = sheetToObjects(asetSheet).filter(function (r) {
      return String(r['Status']) === ROW_STATUS.ACTIVE &&
             String(r['StatusAset'] || 'AKTIF').toUpperCase() !== 'DIHAPUS';
    });

    var matchedAssets = [];
    var otherEligibleAssets = [];

    for (var i = 0; i < asetRows.length; i++) {
      var r = asetRows[i];
      var aId = String(r['AsetID'] || '');
      var kBrg = String(r['KodeBarang'] || '').replace(/\./g, '').trim();
      var kBrgRaw = String(r['KodeBarang'] || '').trim();
      var nup = String(r['NUP'] || '').trim();
      var nm = String(r['NamaBarang'] || '').trim();
      var merk = String(r['MerekTipe'] || '').trim();
      var noPol = String(r['NoPolisi'] || '').trim();
      var kond = String(r['Kondisi'] || 'BAIK').toUpperCase();

      var matchReason = '';
      var matchConfidence = 0;

      // 1. Cek kecocokan Kode Barang 10 digit
      if (kBrg && (extractedCodes.indexOf(kBrg) !== -1 || (rawText && rawText.indexOf(kBrg.toLowerCase()) !== -1) || (kBrgRaw && rawText.indexOf(kBrgRaw.toLowerCase()) !== -1))) {
        matchReason = 'Kode Barang (' + kBrg + ') terdeteksi di dalam dokumen';
        matchConfidence = 92;
      }
      // 2. Cek kecocokan Plat Nomor Kendaraan
      if (!matchReason && noPol && rawText && rawText.indexOf(noPol.toLowerCase()) !== -1) {
        matchReason = 'Nomor Polisi (' + noPol + ') terdeteksi di dalam dokumen';
        matchConfidence = 96;
      }
      // 3. Cek kecocokan Nama Barang / Merek
      if (!matchReason && rawText) {
        var nmWords = nm.toLowerCase().split(/\s+/).filter(function (w) { return w.length >= 4; });
        for (var w = 0; w < nmWords.length; w++) {
          if (rawText.indexOf(nmWords[w]) !== -1) {
            matchReason = 'Kata kunci "' + nmWords[w] + '" cocok dengan dokumen';
            matchConfidence = kond === 'RUSAK_BERAT' ? 88 : 75;
            break;
          }
        }
      }
      // 4. Cek keyword eksplisit dari parser
      if (!matchReason && extractedKeywords.length > 0) {
        var combined = (nm + ' ' + merk + ' ' + kBrg).toLowerCase();
        for (var kw = 0; kw < extractedKeywords.length; kw++) {
          var kWord = String(extractedKeywords[kw] || '').toLowerCase().trim();
          if (kWord.length >= 3 && combined.indexOf(kWord) !== -1) {
            matchReason = 'Cocok dengan item surat: "' + extractedKeywords[kw] + '"';
            matchConfidence = 85;
            break;
          }
        }
      }

      var itemDto = {
        asetId: aId,
        kodeBarang: String(r['KodeBarang'] || ''),
        nup: nup,
        namaBarang: nm,
        merekTipe: merk,
        noPolisi: noPol,
        kondisi: kond,
        lokasiId: String(r['LokasiID'] || ''),
        nilaiPerolehan: parseFloat(r['NilaiPerolehan']) || 0,
        nilaiBuku: parseFloat(r['NilaiBuku']) || 0,
        statusAset: String(r['StatusAset'] || 'AKTIF'),
        matchReason: matchReason,
        matchConfidence: matchConfidence,
        isRecommended: matchConfidence >= 75 || kond === 'RUSAK_BERAT'
      };

      if (matchConfidence > 0) {
        matchedAssets.push(itemDto);
      } else {
        otherEligibleAssets.push(itemDto);
      }
    }

    // Jika dokumen tidak menyebut kode spesifik (mis. scan buram), prioritaskan aset RUSAK_BERAT sebagai rekomendasi verifikasi
    if (matchedAssets.length === 0) {
      for (var j = 0; j < otherEligibleAssets.length; j++) {
        if (otherEligibleAssets[j].kondisi === 'RUSAK_BERAT') {
          otherEligibleAssets[j].matchReason = 'Rekomendasi otomatis (Aset Kondisi Rusak Berat — Verifikasi Manual)';
          otherEligibleAssets[j].matchConfidence = 70;
          matchedAssets.push(otherEligibleAssets[j]);
        }
      }
    }

    return {
      success: true,
      data: {
        matchedCount: matchedAssets.length,
        matchedAssets: matchedAssets,
        otherEligibleAssets: otherEligibleAssets.slice(0, 40)
      }
    };
  } catch (e) {
    Logger.log('[bmn_previewDisposalDoc] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Mengeksekusi pengurangan / penghapusan / transfer keluar aset secara otomatis
 * berdasarkan dokumen SK Penghapusan / BAST yang telah diverifikasi pengguna,
 * sekaligus menyimpan dokumen bukti ke Google Drive.
 */
function bmn_executeDocumentDisposal(token, payload) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertWrite(session);

    if (!payload || !payload.asetIds || !Array.isArray(payload.asetIds) || payload.asetIds.length === 0) {
      throw new Error('Pilih minimal 1 unit aset yang telah diverifikasi untuk dikurangi/dihapus.');
    }
    if (!payload.nomorDokumen || String(payload.nomorDokumen).trim().length < 3) {
      throw new Error('Nomor Dokumen Surat / SK / BAST wajib diisi dengan format yang valid (minimal 3 karakter).');
    }
    var todayDisp = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
    if (payload.tanggalDokumen && (String(payload.tanggalDokumen) > todayDisp || String(payload.tanggalDokumen) < '1990-01-01')) {
      throw new Error('Tanggal Dokumen SK / BAST tidak valid atau berada di masa depan.');
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);

    try {
      var now = new Date();
      var periode = getCurrentPeriode();
      var jenisPengelolaan = String(payload.jenisPengelolaan || 'SK_PENGHAPUSAN').toUpperCase();
      // jenisPengelolaan: 'SK_PENGHAPUSAN' | 'TRANSFER_KELUAR' | 'NON_OPERASIONAL' | 'USULAN_BARU'
      var alasan = String(payload.alasan || 'RUSAK_BERAT');
      var nomorDok = String(payload.nomorDokumen || '').trim();
      var tanggalDok = String(payload.tanggalDokumen || Utilities.formatDate(now, 'GMT+7', 'yyyy-MM-dd'));
      var instansiTujuan = String(payload.instansiTujuan || 'KPKNL Jakarta I / Sesditjen PSDKP');
      var keterangan = String(payload.keterangan || ('Eksekusi otomatis berbasis dokumen ' + nomorDok));

      // 1. Simpan file PDF/Gambar dokumen ke Google Drive bila disertakan
      var docEvidenceUrl = String(payload.evidenceUrl || '');
      var parentRowId = generateRowId('TX_BMN_Penghapusan');

      if (payload.filePayload && payload.filePayload.dataBase64) {
        try {
          var fB64 = String(payload.filePayload.dataBase64).replace(/^data:[^;]+;base64,/, '').trim();
          var fMime = payload.filePayload.mimeType || 'application/pdf';
          var fName = payload.filePayload.fileName || ('DOK_PENGELOLAAN_' + Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd') + '.pdf');
          var fBlob = Utilities.newBlob(Utilities.base64Decode(fB64), fMime, fName);

          var rootFolder = _evGetOrCreateRoot();
          var fTu = _evGetOrCreateSub(rootFolder, 'Tata Usaha');
          var fBmn = _evGetOrCreateSub(fTu, 'Pengelolaan_BMN');
          var driveFile = fBmn.createFile(fBlob);
          var evId = _evAppendEvidence(SHEET_TU.BMN_PENGHAPUSAN, parentRowId, driveFile.getId(), fName, fMime, 'UPLOAD_SK_BAST', session.userId);
          docEvidenceUrl = driveFile.getUrl() || evId;
        } catch (evErr) {
          Logger.log('[bmn_executeDocumentDisposal drive upload] ' + evErr.message);
          if (!docEvidenceUrl) docEvidenceUrl = 'DRV-LOCAL-' + parentRowId;
        }
      }
      if (!docEvidenceUrl) {
        docEvidenceUrl = 'DOK-VERIFIED-' + nomorDok;
      }

      // 2. Temukan aset di TX_BMN_Aset & perbarui statusnya
      var asetSheet = openTuSheet(SHEET_TU.BMN_ASET);
      _ensureBmnAsetColumns(asetSheet);
      var asetRows = sheetToObjects(asetSheet);
      var asetHeaders = asetSheet.getRange(1, 1, 1, asetSheet.getLastColumn()).getValues()[0];

      var colStatusAset  = asetHeaders.indexOf('StatusAset') + 1;
      var colPenghapusan = asetHeaders.indexOf('PenghapusanID') + 1;
      var colKondisi     = asetHeaders.indexOf('Kondisi') + 1;
      var colAkunNeraca  = asetHeaders.indexOf('KodeAkunNeraca') + 1;
      var colDokSumber   = asetHeaders.indexOf('NoDokumenSumber') + 1;

      var hpsSheet = openTuSheet(SHEET_TU.BMN_PENGHAPUSAN);
      var hpsRows  = sheetToObjects(hpsSheet);
      var tahun = now.getFullYear();
      var counter = hpsRows.length + 1;
      var penghapusanId = 'HPS-' + tahun + '-' + ('0000' + counter).slice(-4);

      var targetAssets = [];
      var totalPerolehan = 0;
      var totalBuku = 0;
      var kodeKurangMap = {};

      var newStatusAset = 'DIHAPUS';
      var tahapRecord = 'BAST_SELESAI';
      if (jenisPengelolaan === 'USULAN_BARU') {
        newStatusAset = 'DALAM_PENGHAPUSAN';
        tahapRecord = 'SURAT_USULAN';
      } else if (jenisPengelolaan === 'TRANSFER_KELUAR') {
        newStatusAset = 'DIHAPUS';
        tahapRecord = 'BAST_SELESAI';
      } else if (jenisPengelolaan === 'NON_OPERASIONAL') {
        newStatusAset = 'DALAM_PENGHAPUSAN';
        tahapRecord = 'SK_PENGHAPUSAN';
      }

      for (var i = 0; i < asetRows.length; i++) {
        var ar = asetRows[i];
        if (payload.asetIds.indexOf(ar['AsetID']) !== -1 && String(ar['Status']) === ROW_STATUS.ACTIVE) {
          var rowIdx = i + 2;
          targetAssets.push(ar);
          var np = parseFloat(ar['NilaiPerolehan']) || 0;
          var nb = parseFloat(ar['NilaiBuku']) || 0;
          totalPerolehan += np;
          totalBuku += nb;

          if (colStatusAset > 0) asetSheet.getRange(rowIdx, colStatusAset).setValue(newStatusAset);
          if (colPenghapusan > 0) asetSheet.getRange(rowIdx, colPenghapusan).setValue(penghapusanId);
          if (colDokSumber > 0) asetSheet.getRange(rowIdx, colDokSumber).setValue(nomorDok);
          if (jenisPengelolaan === 'NON_OPERASIONAL' && colAkunNeraca > 0) {
            asetSheet.getRange(rowIdx, colAkunNeraca).setValue('166112');
          }
          if (alasan === 'RUSAK_BERAT' && colKondisi > 0) {
            asetSheet.getRange(rowIdx, colKondisi).setValue('RUSAK_BERAT');
          }

          var kClean = String(ar['KodeBarang'] || '').replace(/\./g, '').trim();
          if (kClean) {
            if (!kodeKurangMap[kClean]) kodeKurangMap[kClean] = { qty: 0, nilai: 0 };
            kodeKurangMap[kClean].qty += 1;
            kodeKurangMap[kClean].nilai += np;
          }
        }
      }

      if (targetAssets.length === 0) {
        throw new Error('Aset yang dipilih tidak ditemukan atau sudah tidak aktif.');
      }

      // 3. Catat ke TX_BMN_Penghapusan & TX_BMN_Penghapusan_Detail
      var hpsRowData = [
        parentRowId, _BMN_DIVISI_ID, periode, session.userId, now, ROW_STATUS.ACTIVE, '', '', '', '',
        penghapusanId,
        tahapRecord,
        alasan,
        '[' + jenisPengelolaan + '] ' + keterangan,
        nomorDok,
        tanggalDok,
        docEvidenceUrl,
        nomorDok,
        tanggalDok,
        instansiTujuan,
        docEvidenceUrl,
        nomorDok,
        tanggalDok,
        docEvidenceUrl,
        docEvidenceUrl,
        targetAssets.length,
        totalPerolehan,
        totalBuku
      ];
      hpsSheet.appendRow(hpsRowData);

      var detailSheet = openTuSheet(SHEET_TU.BMN_PENGHAPUSAN_DETAIL);
      var detailRows = targetAssets.map(function (ta) {
        return [
          generateRowId('TX_BMN_Penghapusan_Detail'),
          _BMN_DIVISI_ID, periode, session.userId, now, ROW_STATUS.ACTIVE, '', '', '', '',
          parentRowId, penghapusanId, ta['AsetID'], ta['Kondisi'] || 'RUSAK_BERAT', parseFloat(ta['NilaiBuku']) || 0
        ];
      });
      detailSheet.getRange(detailSheet.getLastRow() + 1, 1, detailRows.length, detailRows[0].length).setValues(detailRows);

      // 4. Jika penghapusan selesai / transfer keluar, kurangi otomatis saldo di TX_BMN_Rekap_Sakti (Mutasi Berkurang)
      if (newStatusAset === 'DIHAPUS') {
        var rekapSheet = openTuSheet(SHEET_TU.BMN_REKAP_SAKTI);
        var rekapRows  = sheetToObjects(rekapSheet);
        for (var r = 0; r < rekapRows.length; r++) {
          var rk = rekapRows[r];
          var rkKode = String(rk['KodeBarang'] || '').replace(/\./g, '').trim();
          if (kodeKurangMap[rkKode]) {
            var delta = kodeKurangMap[rkKode];
            var curKurangQ = (parseFloat(rk['KuantitasKurang']) || 0) + delta.qty;
            var curKurangN = (parseFloat(rk['NilaiKurang']) || 0) + delta.nilai;
            var curAkhirQ  = Math.max(0, (parseFloat(rk['KuantitasAkhir']) || 0) - delta.qty);
            var curAkhirN  = Math.max(0, (parseFloat(rk['NilaiAkhir']) || 0) - delta.nilai);

            var rRowIdx = r + 2;
            rekapSheet.getRange(rRowIdx, 13, 1, 6).setValues([[
              curKurangQ, curKurangN, curAkhirQ, curAkhirN, now, session.userId
            ]]);
            delete kodeKurangMap[rkKode];
          }
        }
      }

      logAudit(session.userId, 'EXECUTE_DOCUMENT_DISPOSAL', 'TX_BMN_Penghapusan', parentRowId, {
        penghapusanId: penghapusanId,
        jenisPengelolaan: jenisPengelolaan,
        nomorDokumen: nomorDok,
        totalUnit: targetAssets.length,
        totalNilaiPerolehan: totalPerolehan
      });

      return {
        success: true,
        data: {
          penghapusanId: penghapusanId,
          tahap: tahapRecord,
          statusAsetBaru: newStatusAset,
          totalUnit: targetAssets.length,
          totalNilaiPerolehan: totalPerolehan,
          totalNilaiBuku: totalBuku
        },
        message: 'Dokumen ' + nomorDok + ' berhasil diverifikasi & dieksekusi: ' + targetAssets.length + ' unit aset otomatis diperbarui ke status ' + newStatusAset + '.'
      };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[bmn_executeDocumentDisposal] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Memperbarui data STNK & tanggal jatuh tempo pajak kendaraan dinas secara cepat
 * (termasuk unggah berkas STNK baru setelah perpanjangan pajak tahunan atau lima tahunan).
 */
function bmn_updateStnkKendaraan(token, payload) {
  try {
    var session = _bmnRequireSession(token);
    _bmnAssertWrite(session);

    if (!payload || !payload.asetId) {
      throw new Error('AsetID kendaraan wajib diisi.');
    }
    if (!payload.noPolisi || !payload.tglPajakTahunan) {
      throw new Error('Nomor Polisi dan Tanggal Jatuh Tempo Pajak Tahunan wajib diisi.');
    }
    var nopolClean = String(payload.noPolisi).trim().toUpperCase().replace(/\s+/g, ' ');
    if (!/^[A-Z]{1,2}\s?\d{1,4}\s?[A-Z]{0,3}$/.test(nopolClean) || !/\d/.test(nopolClean)) {
      throw new Error('Format Nomor Polisi tidak valid (contoh yang benar: B 1042 PQA).');
    }
    var pYr = parseInt(String(payload.tglPajakTahunan).substring(0, 4), 10);
    var curYrStnk = new Date().getFullYear();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.tglPajakTahunan)) || pYr < 2000 || pYr > curYrStnk + 6) {
      throw new Error('Tanggal jatuh tempo pajak tahunan tidak berada pada tahun yang wajar.');
    }
    if (payload.tglStnkLimaTahunan) {
      var sYr = parseInt(String(payload.tglStnkLimaTahunan).substring(0, 4), 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.tglStnkLimaTahunan)) || sYr < 2000 || sYr > curYrStnk + 10) {
        throw new Error('Tanggal jatuh tempo STNK 5 tahunan tidak berada pada tahun yang wajar.');
      }
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      var sheet = openTuSheet(SHEET_TU.BMN_ASET);
      _ensureBmnAsetColumns(sheet);
      var rows = sheetToObjects(sheet);
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

      var targetRowIdx = -1;
      var targetRowObj = null;
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i]['AsetID']) === String(payload.asetId) && String(rows[i]['Status']) === ROW_STATUS.ACTIVE) {
          targetRowIdx = i + 2;
          targetRowObj = rows[i];
          break;
        }
      }

      if (targetRowIdx === -1 || !targetRowObj) {
        throw new Error('Data kendaraan dinas tidak ditemukan.');
      }

      var fotoStnkId = String(payload.fotoStnkEvidenceId || targetRowObj['FotoStnkEvidenceID'] || '');
      if (payload.stnkPayload && payload.stnkPayload.dataBase64) {
        try {
          var sB64 = String(payload.stnkPayload.dataBase64).replace(/^data:[^;]+;base64,/, '').trim();
          var sMime = payload.stnkPayload.mimeType || 'image/jpeg';
          var sName = payload.stnkPayload.fileName || ('STNK_' + payload.asetId + '.jpg');
          var sBlob = Utilities.newBlob(Utilities.base64Decode(sB64), sMime, sName);

          var rootFolder = _evGetOrCreateRoot();
          var fTu = _evGetOrCreateSub(rootFolder, 'Tata Usaha');
          var fStnk = _evGetOrCreateSub(fTu, 'STNK_Kendaraan_Dinas');
          var driveFile = fStnk.createFile(sBlob);
          fotoStnkId = _evAppendEvidence(SHEET_TU.BMN_ASET, String(targetRowObj['RowID']), driveFile.getId(), sName, sMime, 'UPLOAD_STNK', session.userId);
        } catch (upErr) {
          Logger.log('[bmn_updateStnkKendaraan upload] ' + upErr.message);
        }
      }

      var colNoPol  = headers.indexOf('NoPolisi') + 1;
      var colPajak  = headers.indexOf('TglPajakTahunan') + 1;
      var colStnk   = headers.indexOf('TglStnkLimaTahunan') + 1;
      var colFotoS  = headers.indexOf('FotoStnkEvidenceID') + 1;
      var colVerif  = headers.indexOf('StnkVerified') + 1;

      if (colNoPol > 0) sheet.getRange(targetRowIdx, colNoPol).setValue(String(payload.noPolisi).trim().toUpperCase());
      if (colPajak > 0) sheet.getRange(targetRowIdx, colPajak).setValue(String(payload.tglPajakTahunan).trim());
      if (colStnk > 0 && payload.tglStnkLimaTahunan) {
        sheet.getRange(targetRowIdx, colStnk).setValue(String(payload.tglStnkLimaTahunan).trim());
      }
      if (colFotoS > 0 && fotoStnkId) sheet.getRange(targetRowIdx, colFotoS).setValue(fotoStnkId);
      if (colVerif > 0) sheet.getRange(targetRowIdx, colVerif).setValue('YA');

      logAudit(session.userId, 'UPDATE_STNK_KENDARAAN', 'TX_BMN_Aset', String(targetRowObj['RowID']), {
        asetId: payload.asetId,
        noPolisi: payload.noPolisi,
        tglPajakTahunan: payload.tglPajakTahunan,
        tglStnkLimaTahunan: payload.tglStnkLimaTahunan || ''
      });

      return {
        success: true,
        message: 'Data pajak & STNK kendaraan ' + payload.noPolisi + ' berhasil diperbarui.'
      };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('[bmn_updateStnkKendaraan] ' + e.message);
    return { success: false, error: e.message };
  }
}

