/**
 * tests/verify_playwright.js
 * End-to-End Functional Verification Suite for SIKAP (Kepegawaian & Disparitas NAKHODA)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const pw = require('/home/pinefeast/node_modules/playwright');

const PORT = 4322;
const ROOT_DIR = path.resolve(__dirname, '..');

function buildHtml() {
  let indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'html/Index.html'), 'utf8');

  const mockHeadScript = `
  <script>
    (function() {
      const rpcHandlers = {
        auth_getDivisiList: function() {
          var self = this;
          setTimeout(function() {
            self._onSuccess({
              success: true,
              data: [
                { divisiId: 'DIV-TU', namaResmi: 'Subbagian Tata Usaha', namaDashboard: 'Tata Usaha', kode: 'TU' }
              ]
            });
          }, 5);
        },
        auth_getSessionInfo: function(token) {
          var self = this;
          setTimeout(function() {
            self._onSuccess({
              success: true,
              data: {
                userId: 'USR-STAF-TU-001',
                nama: 'ITA PUSPITA',
                nip: '198804122015032001',
                email: 'ita.tu@sikap.go.id',
                role: 'STAF',
                divisiId: 'DIV-TU',
                status: 'APPROVED'
              }
            });
          }, 5);
        },
        notifikasi_getRingkasan: function() {
          var self = this;
          setTimeout(function() { self._onSuccess({ success: true, data: { items: [], unreadCount: 0 } }); }, 5);
        },
        auth_getPendingApprovals: function() {
          var self = this;
          setTimeout(function() { self._onSuccess({ success: true, data: [] }); }, 5);
        },
        tataUsaha_getKPI: function() {
          var self = this;
          setTimeout(function() {
            self._onSuccess({
              success: true,
              data: {
                paguReguler: 1000000000, paguABT: 0, paguTotal: 1000000000, revisiPagu: 0,
                realisasiSP2D: 600000000, realisasiAkrual: 650000000,
                sisaSP2D: 400000000, sisaAkrual: 350000000,
                pctSP2D: 60, pctAkrual: 65
              }
            });
          }, 5);
        },
        tataUsaha_getTren: function() {
          var self = this;
          setTimeout(function() {
            self._onSuccess({
              success: true,
              data: { months: ['2026-01'], sp2dBulanan: [100], akrualBulanan: [110], sp2dYtd: [100], akrualYtd: [110], paguReguler: 1000, paguABT: 0 }
            });
          }, 5);
        },
        tataUsaha_getHistory: function() {
          var self = this;
          setTimeout(function() { self._onSuccess({ success: true, data: [] }); }, 5);
        },
        tataUsaha_getPegawai: function() {
          var self = this;
          setTimeout(function() {
            self._onSuccess({
              success: true,
              data: {
                totalPegawai: 504,
                totalDitPoa: 108,
                totalAwakArmada: 396,
                breakdown: {
                  PNS: { count: 310, percentage: 61.5 },
                  P3K: { count: 140, percentage: 27.8 },
                  P3K_PARUH_WAKTU: { count: 20, percentage: 4.0 },
                  PJLP: { count: 24, percentage: 4.8 },
                  MAGANG: { count: 10, percentage: 2.0 }
                },
                counts: { PNS: 310, P3K: 140, P3K_PARUH_WAKTU: 20, PJLP: 24, MAGANG: 10 },
                history: []
              }
            });
          }, 5);
        },
        tataUsaha_getKompetensi: function(token, filter) {
          var self = this;
          setTimeout(function() {
            self._onSuccess({
              success: true,
              data: {
                disparitasCount: 1,
                disparitasList: [
                  {
                    pegawaiId: 'PEG-9001',
                    nama: 'MARUF',
                    kelompokJabatan: 'Juru Masak',
                    tingkatKelas: 'KELAS_II',
                    kapalPenempatan: 'KP. Hiu 01',
                    statusPenempatan: 'DIPERBANTUKAN_UPT',
                    catatanDisparitas: 'Kiriman Nakhoda [2026-11-18]: Personil baru Juru Masak KELAS II — Perlu verifikasi / pelengkapan Jabatan Lengkap TU di SIKAP.'
                  }
                ],
                periodeLabel: 'Semua Periode',
                kpi: {
                  totalPersonel: 3,
                  totalDitPoa: 1,
                  totalAwakArmada: 2,
                  totalAwakDek: 1,
                  totalAwakMesin: 0,
                  totalAwakPenunjang: 1,
                  avgKompetensiPct: 66.7,
                  totalEvidenceFiles: 2,
                  totalTrainingNeeds: 1,
                  disparitasCount: 1
                },
                standarByGroup: {
                  'Juru Masak': [
                    { kode: 'TRN-JMK-01', nama: 'Basic Safety Training Fisheries (BST / BST-F)', kategori: 'SERTIFIKASI_LAUT', wajib: true }
                  ],
                  'Nahkoda': [
                    { kode: 'TRN-NKH-01', nama: 'ANKAPIN I / II', kategori: 'SERTIFIKASI_LAUT', wajib: true }
                  ]
                },
                filters: {
                  units: ['Dit. POA', 'Pangkalan PSDKP Jakarta'],
                  kelompokJabatanList: ['Juru Masak', 'Nahkoda', 'Arsiparis'],
                  rumpunList: ['MANAJEMEN', 'AWAK_DEK', 'PENUNJANG']
                },
                pegawaiList: [
                  {
                    pegawaiId: 'PEG-9001',
                    nip: '',
                    nama: 'MARUF',
                    unitKerja: 'AKP Pusat Diperbantukan di KP. Hiu 01 — Pangkalan PSDKP Jakarta',
                    lingkupData: 'AWAK_KAPAL_ARMADA',
                    kelompokJabatan: 'Juru Masak',
                    jabatanLengkap: 'Juru Masak',
                    tingkatKelas: 'KELAS_II',
                    rumpun: 'PENUNJANG',
                    statusKepegawaian: 'PJLP',
                    statusAktif: 'AKTIF',
                    statusPenempatan: 'DIPERBANTUKAN_UPT',
                    kapalPenempatan: 'KP. Hiu 01',
                    ukuranBaju: 'XL',
                    ukuranSepatu: '42',
                    sumberSinkronisasi: 'PUSH_NAKHODA',
                    statusKelengkapanTU: 'DISPARITAS_NAKHODA',
                    catatanDisparitas: 'Kiriman Nakhoda [2026-11-18]: Personil baru Juru Masak KELAS II — Perlu verifikasi TU.',
                    totalStandar: 1,
                    totalLulus: 0,
                    totalEvidence: 0,
                    pctKompetensi: 0,
                    statusGap: 'BELUM',
                    isNonSkj: false,
                    certifications: {}
                  },
                  {
                    pegawaiId: 'PEG-0001',
                    nip: '198501012010011001',
                    nama: 'SLAMET RIYADI',
                    unitKerja: 'Pangkalan PSDKP Jakarta',
                    lingkupData: 'AWAK_KAPAL_ARMADA',
                    kelompokJabatan: 'Nahkoda',
                    jabatanLengkap: 'Nakhoda Kapal Kelas I Kapal Pengawas Kelautan dan Perikanan',
                    tingkatKelas: 'KELAS_I',
                    rumpun: 'AWAK_DEK',
                    statusKepegawaian: 'PNS',
                    statusAktif: 'AKTIF',
                    statusPenempatan: 'DIPERBANTUKAN_UPT',
                    kapalPenempatan: 'KP. Orca 01',
                    sumberSinkronisasi: 'MANUAL_TU',
                    statusKelengkapanTU: 'LENGKAP',
                    catatanDisparitas: '',
                    totalStandar: 1,
                    totalLulus: 1,
                    totalEvidence: 1,
                    pctKompetensi: 100,
                    statusGap: 'LENGKAP',
                    isNonSkj: false,
                    certifications: { 'TRN-NKH-01': { status: 'SUDAH_LULUS', nomorSertifikat: 'ANK-01', tahun: 2023 } }
                  }
                ]
              }
            });
          }, 10);
        }
      };

      function createRunner(onSuccess, onFailure) {
        const runner = {
          _onSuccess: onSuccess || function() {},
          _onFailure: onFailure || function() {}
        };
        runner.withSuccessHandler = function(f) { return createRunner(f, this._onFailure); };
        runner.withFailureHandler = function(f) { return createRunner(this._onSuccess, f); };
        for (var k in rpcHandlers) {
          (function(fn) {
            runner[fn] = function() {
              rpcHandlers[fn].apply(runner, Array.prototype.slice.call(arguments));
            };
          })(k);
        }
        return runner;
      }

      window.google = { script: { run: createRunner() } };
    })();
  </script>
  `;

  indexHtml = indexHtml.replace('<head>', '<head>' + mockHeadScript);
  const includeRegex = /<\?!=\s*html_include\(['"]([^'"]+)['"]\);\s*\?>/g;
  indexHtml = indexHtml.replace(includeRegex, (match, relPath) => {
    const fullPath = path.join(ROOT_DIR, relPath.endsWith('.html') ? relPath : relPath + '.html');
    return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
  });
  return indexHtml;
}

function startServer() {
  const htmlContent = buildHtml();
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlContent);
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function runTests() {
  const server = await startServer();
  const browser = await pw.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message || String(err)));

    await page.goto(`http://localhost:${PORT}`);
    await page.evaluate(() => {
      sessionStorage.setItem('sikap_token', 'mock-sikap-token');
    });
    await page.goto(`http://localhost:${PORT}`);
    await page.waitForSelector('#mod-nav-pegawai', { timeout: 10000 });

    // 1. Masuk tab Kepegawaian via mod-nav-pegawai
    await page.click('#mod-nav-pegawai');
    await page.waitForTimeout(500);

    // 2. Cek Banner Notifikasi Disparitas Nakhoda
    const bannerInfo = await page.evaluate(() => {
      const root = document.getElementById('page-content');
      const b = root.querySelector('#tu-nakhoda-disparity-banner');
      return {
        visible: !!(b && !b.classList.contains('n-hidden')),
        title: root.querySelector('#tu-disparity-title')?.innerText || '',
        summary: root.querySelector('#tu-disparity-summary-list')?.innerText || ''
      };
    });
    if (!bannerInfo.visible || !bannerInfo.title.includes('1 Personel')) {
      throw new Error('Banner Disparitas Nakhoda tidak tampil atau teks salah: ' + JSON.stringify(bannerInfo));
    }

    // 3. Cek filter periode & kalender anti-ketik manual
    const filterChecks = await page.evaluate(() => {
      const root = document.getElementById('page-content');
      const pSel = root.querySelector('#tu-komp-filter-periode');
      const dStart = root.querySelector('#tu-komp-date-start');
      const dEnd = root.querySelector('#tu-komp-date-end');
      return {
        hasPeriode: !!pSel,
        startLocked: !!(dStart && String(dStart.getAttribute('onkeydown') || '').includes('return false')),
        endLocked: !!(dEnd && String(dEnd.getAttribute('onkeydown') || '').includes('return false'))
      };
    });
    if (!filterChecks.hasPeriode || !filterChecks.startLocked || !filterChecks.endLocked) {
      throw new Error('Kontrol filter periode/kalender SIKAP tidak lengkap: ' + JSON.stringify(filterChecks));
    }

    // 4. Klik "Tampilkan Perlu Dilengkapi" lalu buka modal Lengkapi dari baris MARUF
    await page.click('#page-content button:has-text("Tampilkan Perlu Dilengkapi")');
    await page.waitForTimeout(200);
    const filteredText = await page.innerText('#page-content #tu-peg-dir-tbody');
    if (!filteredText.includes('MARUF') || !filteredText.includes('Perlu Dilengkapi TU')) {
      throw new Error('Filter disparitas tidak menampilkan baris MARUF: ' + filteredText);
    }

    await page.click('#page-content #tu-peg-dir-tbody button:has-text("Lengkapi")');
    await page.waitForTimeout(300);

    // 5. Verifikasi Modal Tanpa Golongan, Sanitasi Nama Kanonik, Kondisi NIP, & Generate Jabatan
    const modalChecks = await page.evaluate(() => {
      const root = document.getElementById('page-content');
      return {
        hasGolPns: !!root.querySelector('#tu-m-golongan-pns'),
        hasGolP3k: !!root.querySelector('#tu-m-gol-p3k'),
        nipDisabledForPjlp: !!root.querySelector('#tu-m-nip')?.disabled,
        secJabatanVisibleForPjlp: root.querySelector('#tu-form-sec-jabatan-kompetensi')?.style.display !== 'none',
        hasJuruMasakOpt: Array.from(root.querySelector('#tu-m-kelompok')?.options || []).some((o) => o.value === 'Juru Masak')
      };
    });
    if (modalChecks.hasGolPns || modalChecks.hasGolP3k) {
      throw new Error('Dropdown Golongan PNS/P3K harus dihapus dari SIKAP');
    }
    if (!modalChecks.nipDisabledForPjlp || !modalChecks.secJabatanVisibleForPjlp || !modalChecks.hasJuruMasakOpt) {
      throw new Error('Aturan form PJLP awak kapal di SIKAP tidak sesuai: ' + JSON.stringify(modalChecks));
    }

    await page.click('#page-content button:has-text("Generate Otomatis")');
    const genJab = await page.inputValue('#page-content #tu-m-jabatan-lengkap');
    if (!genJab.includes('Juru Masak')) {
      throw new Error('Tombol Generate Otomatis gagal mengisi Jabatan Lengkap: ' + genJab);
    }

    // Ubah ke P3K_PARUH_WAKTU -> NIP harus aktif & wajib
    await page.selectOption('#page-content #tu-m-status-pegawai', 'P3K_PARUH_WAKTU');
    const p3kPwNipDisabled = await page.isDisabled('#page-content #tu-m-nip');
    if (p3kPwNipDisabled) {
      throw new Error('NIP harus aktif untuk P3K Paruh Waktu');
    }

    // Uji sanitasi nama kanonik di input
    await page.fill('#page-content #tu-m-nama', "Ma'ruf, S.Pi.");
    await page.dispatchEvent('#page-content #tu-m-nama', 'input');
    const cleanNamaUi = await page.inputValue('#page-content #tu-m-nama');
    if (cleanNamaUi !== 'MARUF SPI') {
      throw new Error('Sanitasi realtime nama di SIKAP gagal, hasil: ' + cleanNamaUi);
    }

    if (pageErrors.length > 0) {
      throw new Error('Uncaught browser page errors in SIKAP: ' + pageErrors.join(' | '));
    }

    console.log('SIKAP PLAYWRIGHT VERIFICATION PASSED (Disparity Banner, Conditional NIP, No Golongan, Calendar Locks, Juru Masak PJLP)!');
  } finally {
    await browser.close();
    server.close();
  }
}

runTests().catch((err) => {
  console.error('SIKAP Playwright Verification Error:', err);
  process.exit(1);
});

