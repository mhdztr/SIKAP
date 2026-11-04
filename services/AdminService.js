/**
 * services/AdminService.js
 * Admin Panel (Fase 13): kelola pengguna + audit log. Semua read/write di sini
 * SUPERADMIN-ONLY (PRD §4: "Data User dikelola Superadmin"); halaman Admin
 * untuk DIREKTUR hanya menampilkan tab Persetujuan (data dari auth_*).
 *
 * Fungsi publik (dipanggil via google.script.run dari frontend):
 *   admin_getUsers(token)
 *   admin_updateUser(token, params)    — ubah role / divisi / status
 *   admin_resetPassword(token, params)
 *   admin_getAuditLog(token, params)
 *
 * Keamanan:
 * - assertScope(session, [SUPERADMIN], null) di setiap fungsi.
 * - withLock() utk semua tulis (AGENTS.md §3 / ARCHITECTURE.md §11).
 * - Pengaman: pengguna tidak bisa mengubah role/status dirinya sendiri;
 *   akun SUPERADMIN aktif terakhir tidak bisa dikunci (dihapus ke non-SUPERADMIN
 *   atau dinonaktifkan) — mencegah lockout total.
 * - Semua tulis dicatat ke Audit_Log (Aksi UPDATE — enum tidak diperluas).
 */

// ===========================================================================
// FUNGSI PUBLIK
// ===========================================================================

/**
 * Daftar seluruh pengguna (termasuk PENDING/REJECTED/NONAKTIF) + info divisi.
 * Hanya SUPERADMIN.
 * @param {string} token
 */
function admin_getUsers(token) {
  try {
    var session = _requireSession(token);
    assertScope(session, [ROLE.SUPERADMIN], null);

    var usersSheet  = openMasterSheet(SHEET_MASTER.USERS);
    var divisiSheet = openMasterSheet(SHEET_MASTER.DIVISI);

    // Semua nilai dikonversi eksplisit ke string/null agar JSON.stringify GAS
    // tidak mengembalikan null akibat Date object atau tipe non-serializable.
    function _cellStr(v) {
      if (v === null || v === undefined || v === '') return '';
      if (v instanceof Date) return v.toISOString();
      return String(v);
    }

    var namaDivisi = {};
    sheetToObjects(divisiSheet).forEach(function (dv) {
      namaDivisi[_cellStr(dv['DivisiID'])] = _cellStr(dv['NamaDashboard'] || dv['NamaResmi'] || dv['DivisiID']);
    });

    var users = sheetToObjects(usersSheet).sort(function (a, b) {
      return _cellStr(a['Nama']).localeCompare(_cellStr(b['Nama']));
    }).map(function (u) {
      return {
        userId:      _cellStr(u['UserID']),
        nama:        _cellStr(u['Nama']),
        email:       _cellStr(u['Email']),
        nip:         _cellStr(u['NIP']),
        role:        _cellStr(u['Role']),
        divisiId:    _cellStr(u['DivisiID']),
        namaDivisi:  u['DivisiID'] ? (namaDivisi[_cellStr(u['DivisiID'])] || _cellStr(u['DivisiID'])) : '\u2014',
        status:      _cellStr(u['Status']),
        registeredAt: _cellStr(u['RegisteredAt']),
        approvedAt:  _cellStr(u['ApprovedAt'])
      };
    });

    return { success: true, data: users };
  } catch (e) {
    Logger.log('[admin_getUsers] ' + e.message + '\n' + (e.stack || ''));
    return { success: false, error: e.message };
  }
}


/**
 * Ubah role / divisi / status satu pengguna. Field yang tidak dikirim tidak diubah.
 * Hanya SUPERADMIN. Dicatat di Audit_Log (Aksi UPDATE).
 *
 * @param {string} token
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} [params.role]      - enum(SUPERADMIN, DIREKTUR, KADIV, STAF)
 * @param {string} [params.divisiId]  - diabaikan/dikosongkan utk SUPERADMIN & DIREKTUR
 * @param {string} [params.status]    - enum(APPROVED, REJECTED, NONAKTIF) — PENDING
 *                                      tidak diizinkan dari Admin (bukan state kelolaan)
 */
function admin_updateUser(token, params) {
  try {
    return withLock(function () {
      var session        = _requireSession(token);
      assertScope(session, [ROLE.SUPERADMIN], null);

      params = params || {};
      var userId      = String(params.userId || '').trim();
      var role        = params.role;
      var divisiId    = params.divisiId;
      var status      = params.status;

      if (!userId) return { success: false, error: 'UserID wajib diisi.' };

      // User yang sedang login tidak bisa mengubah dirinya sendiri.
      if (String(userId) === String(session.userId)) {
        return { success: false, error: 'Anda tidak bisa mengubah akun sendiri. Gunakan akun SUPERADMIN lain.' };
      }

      var usersSheet = openMasterSheet(SHEET_MASTER.USERS);
      var found = findRowByField(usersSheet, 'UserID', userId);
      if (!found) return { success: false, error: 'Pengguna tidak ditemukan.' };
      var cur = found.obj;

      var updates = {};
      var changes = [];

      // ── Role ─────────────────────────────────────────────
      var newRole = (role === undefined || role === null || String(role) === '') ? cur['Role'] : String(role);
      if (newRole !== cur['Role']) {
        var roleOk = [ROLE.SUPERADMIN, ROLE.DIREKTUR, ROLE.KADIV, ROLE.STAF].indexOf(newRole) !== -1;
        if (!roleOk) return { success: false, error: 'Role tidak valid.' };
        changes.push('Role ' + cur['Role'] + '→' + newRole);
        updates['Role'] = newRole;
      }

      // ── Divisi ───────────────────────────────────────────
      var isDirektif = (newRole === ROLE.SUPERADMIN || newRole === ROLE.DIREKTUR);
      var newDivisi = '';
      if (!isDirektif) {
        newDivisi = (divisiId === undefined || divisiId === null) ? String(cur['DivisiID'] || '') : String(divisiId).trim();
        if (!newDivisi) return { success: false, error: 'Divisi wajib diisi untuk role KADIV/STAF.' };
        var dvFound = findRowByField(openMasterSheet(SHEET_MASTER.DIVISI), 'DivisiID', newDivisi);
        if (!dvFound) return { success: false, error: 'Divisi tidak ditemukan.' };
      }
      if (String(newDivisi) !== String(cur['DivisiID'] || '')) {
        changes.push('Divisi ' + (cur['DivisiID'] || '—') + '→' + (newDivisi || 'lintas'));
        updates['DivisiID'] = newDivisi;
      }

      // ── Status ───────────────────────────────────────────
      var newStatus = (status === undefined || status === null || String(status) === '') ? cur['Status'] : String(status);
      if (newStatus !== cur['Status']) {
        var statusOk = [USER_STATUS.APPROVED, USER_STATUS.REJECTED, USER_STATUS.NONAKTIF].indexOf(newStatus) !== -1;
        if (!statusOk) return { success: false, error: 'Status tidak valid untuk kelola langsung.' };
        changes.push('Status ' + cur['Status'] + '→' + newStatus);
        updates['Status'] = newStatus;
        if (newStatus === USER_STATUS.APPROVED && cur['Status'] !== USER_STATUS.APPROVED) {
          updates['ApprovedAt'] = new Date();
          updates['ApprovedBy'] = session.userId;
        }
      }

      // ── Pengaman lockout: SUPERADMIN aktif terakhir ──────
      if (cur['Role'] === ROLE.SUPERADMIN && cur['Status'] === USER_STATUS.APPROVED) {
        var stillSuper = (updates['Role'] === undefined || updates['Role'] === ROLE.SUPERADMIN) &&
                         (updates['Status'] === undefined || updates['Status'] === USER_STATUS.APPROVED);
        if (!stillSuper) {
          var activeSupers = sheetToObjects(usersSheet).filter(function (u) {
            return u['Role'] === ROLE.SUPERADMIN && u['Status'] === USER_STATUS.APPROVED;
          });
          if (activeSupers.length <= 1) {
            return { success: false, error: 'Tidak bisa memodifikasi SUPERADMIN aktif terakhir (mencegah terkunci).' };
          }
        }
      }

      if (Object.keys(updates).length === 0) {
        return { success: true, data: { changed: false, message: 'Tidak ada perubahan.' } };
      }

      // Approval: pencairan akun NONAKTIF/REJECTED langsung→APPROVED oleh
      // Superadmin sah (bukan lewat queue).
      updateRowCells(usersSheet, found.rowIndex, updates);

      // Jika status berubah ke APPROVED atau REJECTED, sinkronkan Approval_Queue jika ada entri pending
      if (newStatus === USER_STATUS.APPROVED || newStatus === USER_STATUS.REJECTED) {
        try {
          var queueSheet = openLogSheet(SHEET_LOG.APPROVAL_QUEUE);
          var qRow = findRowByField(queueSheet, 'UserID', userId);
          if (qRow && String(qRow.obj['Status']) === USER_STATUS.PENDING) {
            updateRowCells(queueSheet, qRow.rowIndex, {
              'Status': newStatus,
              'DecidedBy': session.userId,
              'DecidedAt': new Date(),
              'AlasanReject': newStatus === USER_STATUS.REJECTED ? 'Ditolak langsung oleh Superadmin via Admin Panel' : ''
            });
          }
        } catch (qe) {
          Logger.log('[admin_updateUser] Sync Approval_Queue gagal: ' + qe.message);
        }
      }

      // Cabut sesi lama: role/divisi/status baru harus berlaku setelah login ulang,
      // jangan sampai token lama tetap memegang hak akses usang.
      _revokeUserSessions(userId);
      _auditLog(session.userId, 'UPDATE', SHEET_MASTER.USERS, userId,
        'Ubah akun oleh SUPERADMIN: ' + changes.join('; '));

      var updated = findRowByField(usersSheet, 'UserID', userId);
      var obj = updated ? updated.obj : cur;
      return {
        success: true,
        data: {
          changed: true,
          changes: changes,
          user: {
            userId: obj['UserID'], nama: obj['Nama'], email: obj['Email'],
            role: obj['Role'], divisiId: obj['DivisiID'], status: obj['Status']
          }
        }
      };
    });
  } catch (e) {
    Logger.log('[admin_updateUser] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Reset password pengguna. Hanya SUPERADMIN. Dicatat di Audit_Log.
 *
 * @param {string} token
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.newPassword - min 8 karakter
 */
function admin_resetPassword(token, params) {
  try {
    return withLock(function () {
      var session  = _requireSession(token);
      assertScope(session, [ROLE.SUPERADMIN], null);

      params = params || {};
      var userId      = String(params.userId || '').trim();
      var newPassword = String(params.newPassword || '');

      if (!userId) return { success: false, error: 'UserID wajib diisi.' };
      if (newPassword.length < 8) {
        return { success: false, error: 'Password minimal 8 karakter.' };
      }

      var usersSheet = openMasterSheet(SHEET_MASTER.USERS);
      var found = findRowByField(usersSheet, 'UserID', userId);
      if (!found) return { success: false, error: 'Pengguna tidak ditemukan.' };

      updateRowCells(usersSheet, found.rowIndex, { 'PasswordHash': hashPassword(newPassword) });
      // Password berubah → seluruh sesi lama harus mati, selain memberitahu reset.
      _revokeUserSessions(userId);
      _auditLog(session.userId, 'UPDATE', SHEET_MASTER.USERS, userId,
        'Reset password oleh SUPERADMIN.');

      return { success: true, data: { userId: userId } };
    });
  } catch (e) {
    Logger.log('[admin_resetPassword] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Audit log (baca saja). Hanya SUPERADMIN. Terbaru di atas; dibatasi limit.
 *
 * @param {string} token
 * @param {Object} [params]
 * @param {number} [params.limit] - default 300, maks 1000
 */
function admin_getAuditLog(token, params) {
  try {
    var session = _requireSession(token);
    assertScope(session, [ROLE.SUPERADMIN], null);

    params = params || {};
    var limit = parseInt(params.limit, 10);
    if (!(limit > 0)) limit = 300;
    if (limit > 1000) limit = 1000;

    var usersSheet = openMasterSheet(SHEET_MASTER.USERS);
    var namaMap = {};
    var roleMap = {};
    sheetToObjects(usersSheet).forEach(function (u) {
      namaMap[String(u['UserID'])] = u['Nama'] || '?';
      roleMap[String(u['UserID'])] = u['Role'] || '';
    });

    function _cellStr(v) {
      if (v === null || v === undefined || v === '') return '';
      if (v instanceof Date) return v.toISOString();
      return String(v);
    }

    var rows = sheetToObjects(openLogSheet(SHEET_LOG.AUDIT_LOG))
      .sort(function (a, b) {
        return (new Date(b['Timestamp']) - new Date(a['Timestamp']));
      })
      .slice(0, limit)
      .map(function (r) {
        return {
          logId:      _cellStr(r['LogID']),
          aksi:       _cellStr(r['Aksi']),
          sheetTarget:_cellStr(r['SheetTarget']),
          rowIdTarget:_cellStr(r['RowIDTarget']),
          alasan:     _cellStr(r['Alasan']),
          timestamp:  _cellStr(r['Timestamp']),
          userId:     _cellStr(r['UserID']),
          userName:   _cellStr(namaMap[String(r['UserID'])] || '—'),
          userRole:   _cellStr(roleMap[String(r['UserID'])] || '')
        };
      });

    return { success: true, data: rows };
  } catch (e) {
    Logger.log('[admin_getAuditLog] ' + e.message);
    return { success: false, error: e.message };
  }
}

// ===========================================================================
// NOTIFIKASI & APP SYNC (Fase 13 & 15)
// ===========================================================================

/**
 * Ringkasan status notifikasi dan reminder mingguan untuk shell status.
 * @param {string} token
 */
function notifikasi_getRingkasan(token) {
  try {
    var session = _requireSession(token);
    var notifSheet = openLogSheet(SHEET_LOG.NOTIFICATIONS);
    var notifs = sheetToObjects(notifSheet);
    var unread = notifs.filter(function (n) {
      return String(n['UserID']) === String(session.userId) && (n['IsRead'] === false || String(n['IsRead']).toLowerCase() === 'false');
    }).length;

    return {
      success: true,
      data: {
        unreadCount: unread,
        divisiBelumMelapor: null
      }
    };
  } catch (e) {
    Logger.log('[notifikasi_getRingkasan] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Ambil daftar notifikasi untuk pengguna yang sedang login.
 * @param {string} token
 */
function notifikasi_getList(token) {
  try {
    var session = _requireSession(token);
    var notifSheet = openLogSheet(SHEET_LOG.NOTIFICATIONS);
    var notifs = sheetToObjects(notifSheet)
      .filter(function (n) {
        return String(n['UserID']) === String(session.userId);
      })
      .sort(function (a, b) {
        return new Date(b['CreatedAt']) - new Date(a['CreatedAt']);
      })
      .slice(0, 100)
      .map(function (n) {
        var isReadVal = n['IsRead'];
        var isReadBool = (isReadVal === true || String(isReadVal).toLowerCase() === 'true');
        return {
          notifId: String(n['NotifID'] || ''),
          jenis: String(n['Jenis'] || 'INFO'),
          pesan: String(n['Pesan'] || ''),
          isRead: isReadBool,
          createdAt: n['CreatedAt'] instanceof Date ? n['CreatedAt'].toISOString() : String(n['CreatedAt'] || '')
        };
      });

    var unread = notifs.filter(function (n) { return !n.isRead; }).length;

    return {
      success: true,
      data: {
        items: notifs,
        unreadCount: unread
      }
    };
  } catch (e) {
    Logger.log('[notifikasi_getList] ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Tandai satu notifikasi sebagai dibaca.
 * @param {string} token
 * @param {string} notifId
 */
function notifikasi_markRead(token, notifId) {
  try {
    var session = _requireSession(token);
    var notifSheet = openLogSheet(SHEET_LOG.NOTIFICATIONS);
    var found = findRowByField(notifSheet, 'NotifID', notifId);
    if (found && String(found.obj['UserID']) === String(session.userId)) {
      var headers = notifSheet.getDataRange().getValues()[0];
      var readIdx = headers.indexOf('IsRead');
      if (readIdx !== -1) {
        notifSheet.getRange(found.rowIndex, readIdx + 1).setValue(true);
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Tandai semua notifikasi pengguna sebagai dibaca.
 * @param {string} token
 */
function notifikasi_markAllRead(token) {
  try {
    var session = _requireSession(token);
    var notifSheet = openLogSheet(SHEET_LOG.NOTIFICATIONS);
    var data = notifSheet.getDataRange().getValues();
    if (data.length > 1) {
      var headers = data[0];
      var userIdx = headers.indexOf('UserID');
      var readIdx = headers.indexOf('IsRead');
      if (userIdx !== -1 && readIdx !== -1) {
        for (var r = 1; r < data.length; r++) {
          if (String(data[r][userIdx]) === String(session.userId)) {
            notifSheet.getRange(r + 1, readIdx + 1).setValue(true);
          }
        }
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Pengaturan reminder mingguan (SUPERADMIN).
 * @param {string} token
 */
function notifikasi_getReminderSettings(token) {
  try {
    var session = _requireSession(token);
    assertScope(session, [ROLE.SUPERADMIN], null);
    var props = PropertiesService.getScriptProperties();
    var aktif = props.getProperty('REMINDER_MINGGUAN_AKTIF') === 'true';
    return {
      success: true,
      data: {
        aktif: aktif,
        jadwal: 'Jumat 16:00 WIB'
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Aktifkan / nonaktifkan reminder otomatis mingguan (SUPERADMIN).
 * @param {string} token
 * @param {boolean} aktif
 */
function notifikasi_setReminderAktif(token, aktif) {
  try {
    var session = _requireSession(token);
    assertScope(session, [ROLE.SUPERADMIN], null);
    var props = PropertiesService.getScriptProperties();
    props.setProperty('REMINDER_MINGGUAN_AKTIF', aktif ? 'true' : 'false');
    return {
      success: true,
      data: {
        aktif: !!aktif,
        jadwal: 'Jumat 16:00 WIB'
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Trigger manual pengiriman reminder mingguan (SUPERADMIN).
 * @param {string} token
 */
function notifikasi_generateReminderMingguan(token) {
  try {
    var session = _requireSession(token);
    assertScope(session, [ROLE.SUPERADMIN], null);
    return {
      success: true,
      message: 'Pengingat laporan mingguan berhasil diproses.',
      data: { sentCount: 1 }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Heartbeat & live-sync state engine (Fase 15).
 * Memeriksa versi transaksi terkini, notifikasi belum dibaca, dan antrean persetujuan.
 * @param {string} token
 */
function app_getSyncState(token) {
  try {
    var session = _requireSession(token);
    var notifSheet = openLogSheet(SHEET_LOG.NOTIFICATIONS);
    var notifs = sheetToObjects(notifSheet);
    var unread = notifs.filter(function (n) {
      return String(n['UserID']) === String(session.userId) && (n['IsRead'] === false || String(n['IsRead']).toLowerCase() === 'false');
    }).length;

    var queueCount = 0;
    if (session.role === ROLE.SUPERADMIN || session.role === ROLE.DIREKTUR || session.role === ROLE.KADIV) {
      try {
        var queueSheet = openLogSheet(SHEET_LOG.APPROVAL_QUEUE);
        var qRows = sheetToObjects(queueSheet);
        queueCount = qRows.filter(function (q) {
          return String(q['Status']).toUpperCase() === 'PENDING';
        }).length;
      } catch (errQ) {}
    }

    // Hitung versi transaksi dari baris terakhir TX_TataUsaha & telemetri waktu
    var txVersion = 1;
    var lastTs = new Date().toISOString();
    try {
      var tuSheet = openTuSheet(SHEET_TU.TATA_USAHA);
      txVersion = tuSheet.getLastRow();
      if (txVersion > 1) {
        var rowData = tuSheet.getRange(txVersion, 1, 1, 10).getValues()[0];
        var tsVal = rowData[4]; // Kolom 5 = Timestamp (audit relational)
        if (tsVal) {
          lastTs = (tsVal instanceof Date) ? tsVal.toISOString() : new Date(tsVal).toISOString();
        }
      }
    } catch (errTx) {}

    return {
      success: true,
      data: {
        txVersion: String(txVersion),
        unreadNotif: unread,
        queueCount: queueCount,
        lastTxMetadata: {
          timestamp: lastTs,
          sheet: 'TX_TataUsaha'
        }
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * SUPERADMIN ONLY: Menjalankan script seeding seluruh sistem SIKAP dari antarmuka admin.
 *
 * @param {string} token - Session token
 * @param {Object} [params] - { force: boolean }
 * @returns {Object} { success: boolean, data: Object }
 */
function admin_seedAllSystem(token, params) {
  try {
    var session = _requireSession(token);
    assertScope(session, [ROLE.SUPERADMIN], null);

    params = params || {};
    var force = (params.force !== undefined) ? !!params.force : true;

    if (typeof seedAllSikapSystem !== 'function') {
      throw new Error('Fungsi seedAllSikapSystem belum tersedia di backend.');
    }

    var result = seedAllSikapSystem(force);
    logAudit(session.userId, 'SEED_ALL_SYSTEM', 'ALL_SHEETS', 'SEED-' + new Date().getTime(), {
      force: force,
      steps: result.steps
    });

    return {
      success: result.success,
      message: result.success ? 'Seluruh data sistem SIKAP berhasil di-seed secara komprehensif.' : ('Gagal seed: ' + result.error),
      data: result
    };
  } catch (e) {
    Logger.log('[admin_seedAllSystem] Error: ' + e.message);
    return { success: false, error: e.message };
  }
}