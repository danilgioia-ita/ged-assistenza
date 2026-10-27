// La programmazione che il protocollo permette: intestazione (6302+6301+6303), aliquote (7113), data e ora (2001).
// Ognuna: legge, scrive SOLO ciò che serve, RILEGGE e confronta. Si ferma al primo errore della cassa (lo fa il client).
// 019, 910, 911, 520 non hanno comando di protocollo: stanno nella tastiera remota (server.mjs) e nelle spunte del tecnico.
import { cifre, testoCassa } from './protocollo.mjs'
import { interpreta1002, interpreta7112, interpreta1001, interpreta1106, oraRoma, scartoMinuti } from './stato.mjs'

export class ProgrammaErrore extends Error { constructor(m) { super(m); this.name = 'ProgrammaErrore' } }

export const STILI = { 1: 'Normale', 2: 'Grassetto', 3: 'Piccolo (42)', 4: 'Doppia altezza', 5: 'Doppia larghezza', 6: 'Corsivo' }

/** Le righe come le vuole la cassa: maiuscole, ASCII, 32 caratteri (col font piccolo 42 → fino a 44). */
export function preparaRighe(righe) {
  const out = []
  for (let i = 0; i < 9; i++) {
    const r = righe[i] || {}
    const tipo = Number(r.tipo) || 1
    if (!STILI[tipo]) throw new ProgrammaErrore(`riga ${i + 1}: stile ${tipo} non valido`)
    const max = tipo === 3 ? 44 : 32
    const grezzo = String(r.testo ?? '').toUpperCase()
    const testo = testoCassa(grezzo, 200)
    if (testo.length > max) throw new ProgrammaErrore(`riga ${i + 1}: ${testo.length} caratteri, al massimo ${max}`)
    out.push({ riga: i + 1, tipo, testo })
  }
  return out
}

export async function impostaIntestazione(s, righe, { maxRighe = null } = {}) {
  const pronte = preparaRighe(righe)
  const n = pronte.reduce((m, r) => (r.testo ? r.riga : m), 0)
  if (n === 0) throw new ProgrammaErrore('serve almeno una riga di intestazione')
  if (maxRighe && n > maxRighe) throw new ProgrammaErrore(`il profilo ammette al massimo ${maxRighe} righe, ne hai ${n}`)
  const comandi = []
  for (const r of pronte) {
    // una riga vuota si scrive come uno spazio (lunghezza minima 01), come negli script provati
    const t = r.testo || ' '
    comandi.push(`6302${r.riga}${r.tipo}${cifre(t.length, 2)}${t}`)
  }
  comandi.push(`6301${n}`, '63031')
  for (const c of comandi) await s.manda(c)
  const letto = await leggiIntestazione(s)
  const diff = []
  for (const r of pronte) {
    const l = letto.righe[r.riga - 1]
    if (l.testo.trim() !== r.testo.trim() || (r.testo && l.tipo !== r.tipo)) diff.push(`riga ${r.riga}: scritto «${r.testo}», riletto «${l.testo}» (stile ${l.tipo})`)
  }
  return { ok: diff.length === 0, diff, letto, comandi: comandi.length }
}

export async function leggiIntestazione(s) {
  const righe = []
  for (let i = 1; i <= 9; i++) righe.push(interpreta1002(await s.manda('1002' + i)) || { riga: i, tipo: 1, testo: '' })
  const n = Number((await s.manda('6801'))[4])
  return { righe, nStampate: Number.isFinite(n) ? n : null }
}

/** voluto: { 1: 22, 2: 10, 3: 5, 4: 4 } (indice → percentuale). Scrive SOLO le aliquote diverse, e solo se programmabili. */
export async function impostaAliquote(s, voluto) {
  const cambi = []
  const stato = []
  for (const [i, v] of Object.entries(voluto)) {
    if (v === null || v === '' || v === undefined) continue
    const idx = String(i).padStart(2, '0')
    const a = interpreta7112(await s.manda('7112' + idx))
    if (!a) throw new ProgrammaErrore(`aliquota ${i}: risposta illeggibile`)
    const num = Number(v)
    if (!Number.isFinite(num) || num < 0 || num >= 100) throw new ProgrammaErrore(`aliquota ${i}: «${v}» non è una percentuale valida`)
    stato.push({ indice: +i, ora: a.valore, voluto: num })
    if (Math.abs(a.valore - num) < 0.001) continue
    if (!a.programmabile) throw new ProgrammaErrore(`l'aliquota ${i} (ora ${a.valore}%) non è programmabile su questa cassa`)
    cambi.push({ indice: +i, idx, num })
  }
  for (const c of cambi) {
    const desc = c.num.toFixed(2).replace('.', ',') + '%'
    await s.manda(`7113${c.idx}${cifre(Math.round(c.num * 100), 4)}0${cifre(desc.length, 2)}${desc}`)
  }
  const diff = []
  for (const x of stato) {
    const a = interpreta7112(await s.manda('7112' + String(x.indice).padStart(2, '0')))
    if (!a || Math.abs(a.valore - x.voluto) > 0.001) diff.push(`aliquota ${x.indice}: voluta ${x.voluto}%, riletta ${a ? a.valore + '%' : '?'}`)
  }
  return { ok: diff.length === 0, diff, scritte: cambi.length }
}

/** Data e ora della cassa = ora italiana del Mac. Mai prima dell'ultima chiusura (la cassa non lo accetterebbe, e non si insiste). */
export async function impostaOra(s, { adesso = new Date() } = {}) {
  const mac = oraRoma(adesso)
  const uc = interpreta1106(await s.manda('1106').catch(() => null))
  if (uc && scartoMinuti(mac, uc) < 0) throw new ProgrammaErrore('l\'ora del Mac è precedente all\'ultima chiusura della cassa: non la imposto')
  const z = (n, l = 2) => String(n).padStart(l, '0')
  const cmd = `2001${z(mac.g)}${z(mac.m)}${z(mac.a % 100)}${z(mac.h)}${z(mac.mi)}`
  const r = await s.manda(cmd)
  const step = r[4]
  if (step === '1' || step === '2') return { ok: false, serveConferma: Number(step), comando: cmd, nota: `la cassa chiede la ${step === '1' ? 'conferma' : 'seconda conferma'} (la data supera di due o più giorni l'ultima chiusura): rimanda lo stesso comando con un nuovo clic` }
  const oc = interpreta1001(await s.manda('1001'))
  const d = oc ? scartoMinuti(oc, oraRoma(adesso)) : null
  return { ok: d !== null && Math.abs(d) <= 2, scarto: d, comando: cmd }
}
