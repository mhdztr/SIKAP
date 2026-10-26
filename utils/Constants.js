/**
 * utils/Constants.js
 * SIKAP (Sistem Informasi Keuangan, Anggaran, dan Kepegawaian) — Subbag Tata Usaha Dit. POA
 */
var SS_NAME = {
  MASTER: 'RadarPOA_Master_DB',
  TU: 'RadarPOA_SIKAP_DB',
  SIKAP: 'RadarPOA_SIKAP_DB'
};

var SHEET_TU = {
  TATA_USAHA: 'TX_TataUsaha',
  PAKET_PROGRES: 'TX_Paket_Progres',
  PEGAWAI: 'TX_TU_Pegawai',
  BMN_ASET: 'TX_BMN_Aset',
  BMN_PENGHAPUSAN: 'TX_BMN_Penghapusan',
  BMN_PENGHAPUSAN_DETAIL: 'TX_BMN_Penghapusan_Detail',
  MASTER_LOKASI_UPT: 'Master_Lokasi_UPT',
  MASTER_BMN_KATEGORI: 'Master_BMN_Kategori',
  MASTER_PAKET: 'Master_Paket'
};

var SHEET_MASTER = {
  USERS: 'Users',
  DIVISI: 'Divisi',
  OPSI: 'Opsi'
};

var SHEET_LOG = {
  APPROVAL_QUEUE: 'Approval_Queue',
  AUDIT_LOG: 'Audit_Log',
  NOTIFICATIONS: 'Notifications'
};

var STD_COLS = [
  'RowID', 'DivisiID', 'Periode', 'SubmittedBy', 'Timestamp',
  'Status', 'SupersedesRowID', 'VoidReason', 'VoidedBy', 'VoidedAt'
];

var ROLE = {
  SUPERADMIN: 'SUPERADMIN',
  DIREKTUR: 'DIREKTUR',
  KADIV: 'KADIV',
  STAF: 'STAF'
};

var USER_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  NONAKTIF: 'NONAKTIF'
};

var ROW_STATUS = {
  ACTIVE: 'ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
  VOID: 'VOID'
};

var DIVISI_ID = {
  TU: 'DIV-TU'
};

var PROP_KEY = {
  MASTER_SS_ID: 'MASTER_SS_ID',
  TU_SS_ID: 'TU_SS_ID',
  SIKAP_SS_ID: 'SIKAP_SS_ID',
  LOG_SS_ID: 'LOG_SS_ID',
  SETUP_COMPLETED: 'SETUP_COMPLETED'
};

var EVIDENCE_ROOT_FOLDER = 'POA_Evidence_SIKAP';
var EVIDENCE_LIMIT_BYTES = {
  FILE: 15 * 1024 * 1024,
  VIDEO: 50 * 1024 * 1024
};

function getSpreadsheetIds() {
  var props = PropertiesService.getScriptProperties();
  var masterId = props.getProperty(PROP_KEY.MASTER_SS_ID);
  var tuId = props.getProperty(PROP_KEY.TU_SS_ID) || props.getProperty(PROP_KEY.SIKAP_SS_ID);
  var logId = props.getProperty(PROP_KEY.LOG_SS_ID) || masterId;
  if (!masterId && !tuId) throw new Error('[SIKAP] Spreadsheet ID belum tersimpan.');
  return {
    masterId: masterId,
    transaksiId: tuId || null,
    logId: logId || null,
    tuId: tuId || null
  };
}
