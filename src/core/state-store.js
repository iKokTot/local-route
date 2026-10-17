const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function createStateStore({ file, defaults, normalize, io = fs }) {
  const backup = `${file}.bak`;
  let warning = '';
  const fresh = () => normalize(JSON.parse(JSON.stringify(defaults)));
  function parse(target) {
    const raw = JSON.parse(io.readFileSync(target, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Некорректный формат настроек.');
    if ((raw.schemaVersion ?? 1) !== 1) throw Object.assign(new Error('Версия настроек не поддерживается этой сборкой. Файл сохранён.'), {code:'SCHEMA_UNSUPPORTED'});
    return normalize(raw);
  }
  function atomic(target, text) {
    const temporary = `${target}.${randomUUID()}.tmp`;
    let descriptor;
    try {
      descriptor = io.openSync(temporary, 'wx', 0o600);
      io.writeFileSync(descriptor, text, 'utf8');
      io.fsyncSync(descriptor);
      io.closeSync(descriptor); descriptor = undefined;
      io.renameSync(temporary, target);
    } finally {
      if (descriptor !== undefined) io.closeSync(descriptor);
      try { io.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return {
    read() {
      try { return parse(file); }
      catch (error) {
        if (error.code === 'SCHEMA_UNSUPPORTED') throw error;
        if (error.code && error.code !== 'ENOENT') throw new Error('Нет доступа к файлу настроек. Проверьте права и свободное место.');
        try {
          const restored = parse(backup);
          warning = 'Основной файл настроек повреждён или отсутствует. Используется последняя исправная копия.';
          return restored;
        } catch (backupError) {
          if (error.code === 'ENOENT' && backupError.code === 'ENOENT') return fresh();
          throw new Error('Не удалось прочитать настройки и резервную копию. Файлы сохранены; автоматический сброс отключён.');
        }
      }
    },
    write(next, { rewriteBackup = false } = {}) {
      const normalized = normalize(next);
      // Runtime flags are reconstructed from processes, never restored from disk.
      const { active, vlessActive, ...saved } = normalized;
      const text = JSON.stringify({ ...saved, schemaVersion: 1 }, null, 2);
      io.mkdirSync(path.dirname(file), { recursive: true });
      let previous;
      try { previous = parse(file); }
      catch (error) {
        if (error.code && error.code !== 'ENOENT') throw error;
        // A valid backup may be used to repair a corrupt primary. Preserve it.
        try { previous = parse(backup); }
        catch (backupError) { if (error.code !== 'ENOENT' || backupError.code !== 'ENOENT') throw new Error('Настройки повреждены. Сохранение без исправной копии запрещено.'); }
      }
      if (previous && !rewriteBackup) {
        const { active: oldActive, vlessActive: oldVlessActive, ...oldSaved } = previous;
        atomic(backup, JSON.stringify({ ...oldSaved, schemaVersion: 1 }, null, 2));
      } else atomic(backup, text);
      atomic(file, text);
      warning = '';
      return normalized;
    },
    get warning() { return warning; }
  };
}
module.exports = { createStateStore };
