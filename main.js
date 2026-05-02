const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── Base de données SQLite ───────────────────────────────────────────────────
let db;

function initDatabase() {
  const Database = require('better-sqlite3');
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'tresorerie.db');
  
  console.log('📁 Base de données :', dbPath);
  db = new Database(dbPath);

  // Activer WAL pour meilleures performances
  db.pragma('journal_mode = WAL');

  // Créer la table si elle n'existe pas
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      date      TEXT    NOT NULL,
      cat       TEXT    NOT NULL,
      desc      TEXT    NOT NULL,
      type      TEXT    NOT NULL CHECK(type IN ('Entrée','Sortie')),
      montant   REAL    NOT NULL CHECK(montant > 0),
      mode      TEXT    DEFAULT '',
      created_at TEXT   DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_type ON transactions(type);
    CREATE INDEX IF NOT EXISTS idx_cat  ON transactions(cat);
  `);

  // Insérer données de démo si table vide
  const count = db.prepare('SELECT COUNT(*) as n FROM transactions').get();
  if (count.n === 0) {
    const insert = db.prepare(
      'INSERT INTO transactions (date,cat,desc,type,montant,mode) VALUES (?,?,?,?,?,?)'
    );
    const demo = [
      ['2025-01-25','Vente',    'Produit A',        'Entrée', 150000, 'Espèces'],
      ['2025-01-05','Transport','Course X',          'Entrée',  50000, 'Mobile Money'],
      ['2025-01-07','Achat',    'Fourniture bureau', 'Sortie',  40000, 'Virement'],
      ['2025-02-02','Service',  'Prestation client', 'Sortie', 120000, 'Chèque'],
      ['2025-02-03','Transport','Carburant',         'Entrée',  30000, 'Espèces'],
      ['2025-03-15','Vente',    'Produit B',         'Entrée',  85000, 'Mobile Money'],
      ['2025-03-20','Salaire',  'Salaire employé',   'Sortie',  75000, 'Virement'],
      ['2025-04-10','Service',  'Consultation',      'Entrée',  60000, 'Espèces'],
      ['2025-05-05','Achat',    'Matériel IT',       'Sortie',  45000, 'Virement'],
      ['2025-10-08','Vente',    'Produit A',         'Entrée',  30000, ''],
      ['2025-10-09','Transport','Course X',           'Entrée',  30000, ''],
    ];
    const insertMany = db.transaction((rows) => {
      for (const row of rows) insert.run(...row);
    });
    insertMany(demo);
  }
}

// ─── Handlers IPC (communication Renderer ↔ Main) ─────────────────────────────

ipcMain.handle('db-get-all', () => {
  return db.prepare('SELECT * FROM transactions ORDER BY date DESC').all();
});

ipcMain.handle('db-add', (_, t) => {
  const stmt = db.prepare(
    'INSERT INTO transactions (date,cat,desc,type,montant,mode) VALUES (@date,@cat,@desc,@type,@montant,@mode)'
  );
  const info = stmt.run(t);
  return { id: info.lastInsertRowid, ...t };
});

ipcMain.handle('db-update', (_, t) => {
  db.prepare(
    'UPDATE transactions SET date=@date,cat=@cat,desc=@desc,type=@type,montant=@montant,mode=@mode WHERE id=@id'
  ).run(t);
  return t;
});

ipcMain.handle('db-delete', (_, id) => {
  db.prepare('DELETE FROM transactions WHERE id=?').run(id);
  return { deleted: id };
});

ipcMain.handle('db-stats', () => {
  const total   = db.prepare('SELECT COUNT(*) as n FROM transactions').get().n;
  const size    = (() => {
    try {
      const p = path.join(app.getPath('userData'), 'tresorerie.db');
      return (fs.statSync(p).size / 1024).toFixed(1) + ' Ko';
    } catch { return '—'; }
  })();
  const dbPath  = path.join(app.getPath('userData'), 'tresorerie.db');
  return { total, size, dbPath };
});

ipcMain.handle('db-backup', async () => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Sauvegarder la base de données',
    defaultPath: `backup_smarters_${new Date().toISOString().split('T')[0]}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false };
  const all = db.prepare('SELECT * FROM transactions ORDER BY date ASC').all();
  fs.writeFileSync(filePath, JSON.stringify({ version: 2, exportDate: new Date().toISOString(), transactions: all }, null, 2), 'utf8');
  return { ok: true, path: filePath, count: all.length };
});

ipcMain.handle('db-restore', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: 'Restaurer depuis une sauvegarde',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths.length) return { ok: false };
  try {
    const raw  = fs.readFileSync(filePaths[0], 'utf8');
    const data = JSON.parse(raw);
    const list = data.transactions || data;
    if (!Array.isArray(list)) throw new Error('Format invalide');
    const insert = db.prepare(
      'INSERT INTO transactions (date,cat,desc,type,montant,mode) VALUES (@date,@cat,@desc,@type,@montant,@mode)'
    );
    const restore = db.transaction((rows) => {
      db.prepare('DELETE FROM transactions').run();
      for (const r of rows) {
        const copy = { date:r.date, cat:r.cat, desc:r.desc, type:r.type, montant:r.montant, mode:r.mode||'' };
        insert.run(copy);
      }
    });
    restore(list);
    return { ok: true, count: list.length };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('open-db-folder', () => {
  shell.openPath(app.getPath('userData'));
});

// ─── Fenêtre principale ────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Smarters Trésorerie',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#f0f4f8',
    show: false,
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
  });

  // Menu minimal
  const { Menu } = require('electron');
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  initDatabase();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
