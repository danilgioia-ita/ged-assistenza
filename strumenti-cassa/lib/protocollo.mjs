// Il filo del protocollo Custom (TCP 9100): costruire e leggere i frame. NIENTE socket, NIENTE orologio.
//
// Frame verificato sui byte veri della K3F-N (GED Connect, 15-16 ottobre 2026; 22 e 27 ottobre da qui):
//     STX  CC  0  <comando>  KK  ETX
// CC = contatore a 2 cifre, KK = somma dei byte di «CC 0 comando» modulo 100 a 2 cifre.
// La risposta ha la stessa forma, preceduta a volte da un ACK; chi la riceve la conferma con un byte ACK.
// Un NAK (0x15) al posto della risposta vuol dire «frame non accettato»: il comando NON è stato eseguito.

export const STX = 0x02
export const ETX = 0x03
export const ACK = 0x06
export const NAK = 0x15

export function checksum(corpo) {
  let s = 0
  for (let i = 0; i < corpo.length; i++) s += corpo.charCodeAt(i)
  return String(s % 100).padStart(2, '0')
}

export function costruisciFrame(contatore, comando) {
  if (!/^[\x20-\x7e]+$/.test(comando)) throw new Error('comando non ASCII: la cassa non lo capirebbe')
  const corpo = String(((contatore % 100) + 100) % 100).padStart(2, '0') + '0' + comando
  return Buffer.concat([Buffer.from([STX]), Buffer.from(corpo + checksum(corpo), 'ascii'), Buffer.from([ETX])])
}

/**
 * Legge UN frame dall'inizio del buffer. Gli ACK davanti si saltano.
 * Esiti: incompleto (manca l'ETX) · nak · frame {contatore, payload} · storto (completo ma non torna: non si esegue
 * niente sulla fede di un frame che non torna).
 */
export function leggiFrame(buf) {
  let i = 0
  while (i < buf.length && buf[i] === ACK) i++
  if (i >= buf.length) return { tipo: 'incompleto' }
  if (buf[i] === NAK) return { tipo: 'nak', consumati: i + 1 }
  if (buf[i] !== STX) {
    const s = buf.indexOf(STX, i)
    if (s < 0) return { tipo: 'incompleto' }
    i = s
  }
  const fine = buf.indexOf(ETX, i + 1)
  if (fine < 0) return { tipo: 'incompleto' }
  const consumati = fine + 1
  const testo = buf.subarray(i + 1, fine).toString('latin1')
  if (testo.length < 5) return { tipo: 'storto', motivo: 'frame troppo corto', consumati }
  const corpo = testo.slice(0, -2)
  const chk = testo.slice(-2)
  if (!/^\d\d$/.test(chk) || checksum(corpo) !== chk) return { tipo: 'storto', motivo: `checksum errato (atteso ${checksum(corpo)}, ricevuto ${chk})`, consumati }
  if (!/^\d\d/.test(corpo) || corpo[2] !== '0') return { tipo: 'storto', motivo: 'intestazione del frame non valida', consumati }
  return { tipo: 'frame', frame: { contatore: Number(corpo.slice(0, 2)), payload: corpo.slice(3) }, consumati }
}

/** Errore dentro un payload: `ERRnn` in risposta a un comando; `1015ERRnnn` alla lettura dell'ultimo errore. */
export function erroreDelPayload(payload) {
  let m = /^ERR(\d{2})$/.exec(payload)
  if (m) return { codice: Number(m[1]), da1015: false }
  m = /^1015ERR(\d{3})$/.exec(payload)
  if (m) return { codice: Number(m[1]), da1015: true }
  return null
}

export const cifre = (n, l) => {
  if (!Number.isInteger(n) || n < 0 || n >= 10 ** l) throw new RangeError(`numero fuori campo (${n}, ${l} cifre)`)
  return String(n).padStart(l, '0')
}

/** Testo per la cassa: ASCII stampabile (accenti tolti). */
export function testoCassa(testo, max) {
  return String(testo ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}
