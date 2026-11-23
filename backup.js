const fs = require('fs');
const os = require('os');
const path = require('path');

// ZIP entries use the "store" method. SQLite databases are already compressed
// poorly by generic deflate, and storing avoids extra CPU while keeping the
// backup format simple and dependency-free.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function zip(entries) {
  const now = dosDateTime();
  const local = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(0, 8); // store
    header.writeUInt16LE(now.time, 10);
    header.writeUInt16LE(now.date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, data);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4); // made by
    directory.writeUInt16LE(20, 6); // version needed
    directory.writeUInt16LE(0, 8);
    directory.writeUInt16LE(0, 10);
    directory.writeUInt16LE(now.time, 12);
    directory.writeUInt16LE(now.date, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt16LE(0, 30);
    directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34);
    directory.writeUInt16LE(0, 36);
    directory.writeUInt32LE(0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...local, ...central, end]);
}

async function createBackup(db) {
  // Checkpoint first so committed WAL pages are persisted before the snapshot.
  db.pragma('wal_checkpoint(TRUNCATE)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todolist-backup-'));
  const snapshot = path.join(dir, 'todolist.db');
  try {
    await db.backup(snapshot);
    const database = fs.readFileSync(snapshot);
    const manifest = [
      'ToDoList Web SQLite backup',
      `Created: ${new Date().toISOString()}`,
      'Restore: replace the application database file with backup/todolist.db while the server is stopped.',
      '',
    ].join('\n');
    return zip([
      { name: 'backup/todolist.db', data: database },
      { name: 'backup/README.txt', data: manifest },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { createBackup };
