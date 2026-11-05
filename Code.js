/**
 * Code.js — Entry point Google Apps Script (SIKAP)
 *
 * doGet()  : serve SPA frontend
 * doPost() : tidak dipakai — semua komunikasi client-server lewat google.script.run
 *
 * Struktur kode mengikuti ARCHITECTURE.md §2:
 *   /utils        — Constants.js, DateUtil.js, Lock.js
 *   /services     — AuthService.js, TataUsahaService.js, BMNService.js, AdminService.js, EvidenceService.js
 *   /data         — SheetAccess.js
 *   /html         — Index.html, Style.html, Script_Main.html, Script_Charts.html, /views
 */

/**
 * Serve SPA frontend.
 *
 * @param {GoogleAppsScript.Events.DoGet} e
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('html/Index')
    .evaluate()
    .setTitle('SIKAP — Subbag Tata Usaha, Dit. POA KKP RI')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Helper untuk include file HTML lain di dalam template GAS.
 * Dipakai di Fase 3+ saat SPA shell membutuhkan partial templates.
 * Contoh penggunaan di template: <?!= html_include('html/Style'); ?>
 *
 * @param {string} filename - nama file tanpa ekstensi
 * @returns {string} konten HTML
 */
function html_include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Setup & verifikasi akun Superadmin, Kadiv TU, dan Staf TU.
 * Dapat dipanggil langsung dari editor GAS atau via clasp run setup_seedSuperadmin.
 */
function setup_seedSuperadmin() {
  try {
    var usersSheet = openMasterSheet(SHEET_MASTER.USERS);
    _ensureSuperadminSeeded(usersSheet);
    var users = sheetToObjects(usersSheet);
    return {
      success: true,
      message: 'Akun Superadmin, Kadiv TU, dan Staf TU berhasil diverifikasi.',
      totalUsers: users.length,
      users: users.map(function (u) {
        return {
          userId: u['UserID'],
          nama: u['Nama'],
          email: u['Email'],
          nip: u['NIP'],
          role: u['Role'],
          status: u['Status']
        };
      })
    };
  } catch (err) {
    Logger.log('[setup_seedSuperadmin] Error: ' + err.message);
    return { success: false, error: err.message, stack: err.stack };
  }
}

/**
 * Runner Seeding Komprehensif Seluruh Sistem SIKAP.
 * Dapat dipanggil langsung dari editor GAS (pilih fungsi setup_seedAllSystem lalu klik Run)
 * atau via terminal clasp: clasp run setup_seedAllSystem
 *
 * @param {boolean} [force=true] Default true: membersihkan data transaksi lama dan men-seed ulang.
 */
function setup_seedAllSystem(force) {
  if (force === undefined || force === null) force = true;
  return seedAllSikapSystem(force);
}


