const { StringDecoder } = require('node:string_decoder');
// Redact complete lines, including secrets split between arbitrary stream chunks.
function createLineSink(write, secrets = []) {
  const decoder = new StringDecoder('utf8');
  let pending = ''; let discarding = false;
  function emit(line) {
    for (const secret of secrets.filter(Boolean)) line = line.replaceAll(secret, '[секрет скрыт]');
    line = line.replace(/(?:vless|hy2|hysteria2|tg):\/\/\S+/gi, '[ссылка скрыта]').trim();
    if (line) write(line);
  }
  function consume(text) {
    if (discarding) {
      const end = text.indexOf('\n');
      if (end < 0) return;
      text = text.slice(end + 1); discarding = false;
    }
    pending += text;
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      if (line.length <= 65536) emit(line);
    }
    if (pending.length > 65536) { pending = ''; discarding = true; }
  }
  const sink = (chunk) => consume(decoder.write(chunk));
  sink.end = () => { consume(decoder.end()); if (!discarding) emit(pending); pending = ''; };
  return sink;
}
module.exports = { createLineSink };
