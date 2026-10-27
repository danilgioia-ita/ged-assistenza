// LA LISTA BIANCA. Tutto ciò che parte verso la cassa passa da `classifica()`: ciò che non c'è qui non parte, punto.
//
//   lettura  → RICHIESTE DATI: passano sempre.
//   clic     → scrive: serve il clic di conferma dell'utente (`conferma.clic`).
//   scritta  → scrive e non si disfa (fiscalizzazione, chiusura): serve anche la conferma scritta (`conferma.scritta`).
//
// Le stringhe sono quelle PROVATE sulla K3F-N (script del 15-16, 22 e 27 ottobre 2026), non dedotte dal manuale.
// Vietati per nome (e quindi anche con messaggio chiaro): 3006, 7101 OPER 0, RESET, HW-INIT, firmware.

export class ComandoNonAmmesso extends Error {
  constructor(comando, motivo) { super(`comando ${String(comando).slice(0, 12)} non ammesso: ${motivo}`); this.name = 'ComandoNonAmmesso'; this.comando = comando; this.motivo = motivo }
}

const LETTURE = [
  /^1001$/, /^1002[1-9]$/, /^1003$/, /^1008$/, /^1009$/, /^1012$/, /^1013$/, /^1015$/, /^1016$/, /^1017$/, /^1023$/,
  /^1104$/, /^1106$/, /^1209$/, /^1214$/, /^1511[01]?$/, /^1512$/, /^1515[01]\d{8}$/, /^6801$/, /^7012$/,
  /^7112(0[1-9]|1[01])$/, /^8008$/,
]

// campo con lunghezza dichiarata subito prima: LL + testo di LL caratteri
function conLunghezza(s, max) {
  const l = Number(s.slice(0, 2))
  const t = s.slice(2, 2 + l)
  return /^\d\d/.test(s) && l >= 1 && l <= max && t.length === l && /^[\x20-\x7e]+$/.test(t) ? { l, t, resto: s.slice(2 + l) } : null
}

const STRINGA_ANNULLO_IN_CORSO = '3301' + '8' + '000000000' + '001' + '17' + 'ANNULLO SCONTRINO' + '000000100' + '01'

const SCRITTURE = [
  // intestazione: riga (1-9), tipo (1-6), LL, testo ≤ 44
  { nome: 'intestazione, riga', livello: 'clic', ok: (c) => { const m = /^6302([1-9])([1-6])(.*)$/.exec(c); return !!m && !!conLunghezza(m[3], 44) && conLunghezza(m[3], 44).resto === '' } },
  { nome: 'intestazione, numero di righe', livello: 'clic', ok: (c) => /^6301[0-9]$/.test(c) },
  { nome: 'intestazione, salvataggio', livello: 'clic', ok: (c) => c === '63031' },
  // aliquota: indice, 4 cifre, codice esente 0-6, LL, descrizione ≤ 25 (anche vuota: LL 00)
  { nome: 'aliquota IVA', livello: 'clic', ok: (c) => { const m = /^7113(0[1-9]|1[01])(\d{4})([0-6])(\d\d)(.*)$/.exec(c); return !!m && Number(m[4]) === m[5].length && m[5].length <= 25 && /^[\x20-\x7e]*$/.test(m[5]) } },
  { nome: 'data e ora', livello: 'clic', ok: (c) => { const m = /^2001(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(c); return !!m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12 && +m[4] <= 23 && +m[5] <= 59 } },
  { nome: 'chiusura giornaliera', livello: 'scritta', ok: (c) => c === '20020' },
  { nome: 'fiscalizzazione', livello: 'scritta', ok: (c) => c === '2005' },
  { nome: 'verificazione periodica, test memorie', livello: 'clic', ok: (c) => /^2006(0[1-9]|1[0-2])\d\d$/.test(c) },
  // intervento tecnico: inizio, fine (esito 1-6, CF, P.IVA lab, nota vuota «00»)
  { nome: 'intervento tecnico, inizio', livello: 'clic', ok: (c) => c === '64040' },
  { nome: 'intervento tecnico, fine', livello: 'clic', ok: (c) => { const m = /^64041([1-6])(.*)$/.exec(c); if (!m) return false; const a = conLunghezza(m[2], 16); const b = a && conLunghezza(a.resto, 16); return !!b && b.resto === '00' } },
  // scontrini di prova della verificazione
  { nome: 'riga di vendita', livello: 'clic', ok: (c) => { const m = /^33011(\d{9})001(.*)$/.exec(c); if (!m) return false; const d = conLunghezza(m[2], 44); return !!d && /^\d{9}(0\d|1[01])$/.test(d.resto) && Number(d.resto.slice(0, 9)) > 0 } },
  { nome: 'pagamento (contanti o già pagato altrove)', livello: 'clic', ok: (c) => { const m = /^3007(01|03)00(.*)$/.exec(c); if (!m) return false; const d = conLunghezza(m[2], 30); return !!d && /^\d{9}$/.test(d.resto) } },
  { nome: 'richiesta di chiusura scontrino', livello: 'clic', ok: (c) => c === '3011' },
  { nome: 'chiusura scontrino', livello: 'clic', ok: (c) => c === '3013' },
  { nome: 'annullo dello scontrino in corso', livello: 'clic', ok: (c) => c === STRINGA_ANNULLO_IN_CORSO },
  // annullo di uno scontrino emesso: SOLO controllo (8) e annullo (1). L'OPER 0 fa stampare una lettura: mai.
  { nome: 'annullo documento (controllo o annullo)', livello: 'clic', ok: (c) => /^7101A\d{4}\d{4}\d{6}[81]$/.test(c) },
  // stampa della memoria di dettaglio per data e numeri di scontrino
  { nome: 'stampa DGFE degli scontrini di prova', livello: 'clic', ok: (c) => /^8002\d{6}\d{4}\d{4}0$/.test(c) },
]

const VIETATI = [
  { ok: (c) => c.startsWith('3006'), motivo: '3006 non chiama il POS e segna lo scontrino pagato con carta senza addebito (provato il 16/10)' },
  { ok: (c) => c.startsWith('3007') && c.slice(4, 6) === '09', motivo: 'il pagamento con il POS (Custom Pay) non si fa da qui' },
  { ok: (c) => c.startsWith('7101') && !/^7101A\d{14}[81]$/.test(c), motivo: '7101 con OPER 0 (o altro) fa stampare una lettura della memoria: decisione di Danilo del 16/10' },
  { ok: (c) => /RESET|INIT|FIRMWARE|UPGRADE/i.test(c), motivo: 'reset, inizializzazione e firmware non si fanno da qui' },
  { ok: (c) => c.startsWith('6401'), motivo: 'chiave privata, censimento e attivazione si fanno guidati, da tastiera o dal web server: nessun comando automatico' },
  { ok: (c) => c.startsWith('8007'), motivo: '8007 (inizializzazione memoria di dettaglio): sulla K3 la fiscalizzazione la fa già da sola, il 22/10 il comando dopo è stato rifiutato (ERR 32)' },
]

export function classifica(comando) {
  if (typeof comando !== 'string' || !/^[\x20-\x7e]+$/.test(comando)) throw new ComandoNonAmmesso(String(comando), 'non è testo ASCII')
  for (const v of VIETATI) if (v.ok(comando)) throw new ComandoNonAmmesso(comando, `vietato: ${v.motivo}`)
  if (LETTURE.some((r) => r.test(comando))) return { tipo: 'lettura', livello: 'lettura', nome: 'richiesta dati' }
  const s = SCRITTURE.find((x) => x.ok(comando))
  if (s) return { tipo: 'scrittura', livello: s.livello, nome: s.nome }
  throw new ComandoNonAmmesso(comando, 'non è nella lista bianca')
}

export const eMutante = (comando) => classifica(comando).tipo === 'scrittura'
export { STRINGA_ANNULLO_IN_CORSO }
