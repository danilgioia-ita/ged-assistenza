// Lo stato della cassa: legge (SOLO richieste dati) e interpreta. Le spie sono verdi / rosse / ambra / grigie:
//   v = a posto · r = da fare · a = da guardare · g = il PC non lo sa leggere (si controlla a mano).
import { ErroreCassa } from './cassa.mjs'
import { leggiStatus, leggiIndice, WebErrore } from './web.mjs'

// ───────────────────────── interpreti delle risposte (puri) ─────────────────────────

/** 1511 / 15111 (stato logico RT). Posizioni dal manuale Custom, confermate sulle risposte vere del 22 e 27 ottobre. */
export function interpreta1511(p) {
  if (typeof p !== 'string' || !p.startsWith('1511') || p.length < 30) return null
  const f = (i) => p[i] === '1'
  const r = {
    nativoRT: p[4] === '1', matricola: p.slice(5, 16).trim(), chiave: f(26), censita: f(27), attivata: f(28), inServizio: f(29),
    dataServizio: p.slice(30, 36), simulazione: f(36), demo: f(37), scontrinoRT: f(38), ventilazione: f(39), inattivo: f(40), lotteria: p[41] ?? '0',
  }
  if (p.length >= 55) {
    r.certificato = f(42)
    r.certDa = p.slice(43, 49)
    r.certA = p.slice(49, 55)
  }
  return r
}

export function interpreta1001(p) {
  const m = /^1001(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/.exec(p ?? '')
  return m ? { g: +m[1], m: +m[2], a: 2000 + +m[3], h: +m[4], mi: +m[5] } : null
}
export function interpreta1106(p) {
  const m = /^1106(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?/.exec(p ?? '')
  return m ? { g: +m[1], m: +m[2], a: 2000 + +m[3], h: +m[4], mi: +m[5] } : null
}
export function interpreta1002(p) {
  const m = /^1002([1-9])(\d)(\d\d)(.*)$/s.exec(p ?? '')
  if (!m) return null
  const l = Number(m[3])
  return { riga: +m[1], tipo: +m[2], testo: m[4].slice(0, l).trimEnd() }
}
export function interpreta7112(p) {
  const m = /^7112(\d\d)(\d{4})(\d)(\d)(.*)$/s.exec(p ?? '')
  return m ? { indice: +m[1], valore: Number(m[2]) / 100, esente: +m[3], programmabile: m[4] === '1', descrizione: m[5].trim() } : null
}
export function interpreta1104(p) { const m = /^1104(\d{4})(\d{4})/.exec(p ?? ''); return m ? { chiusure: +m[1], dgfe: +m[2] } : null }
export function interpreta1012(p) { const m = /^1012(\d)/.exec(p ?? ''); return m ? +m[1] : null }
export function interpreta1017(p) {
  const m = /^1017(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d{4})(\d{9})(\d)(\d)$/.exec(p ?? '')
  return m ? { g: m[1], m: m[2], a: m[3], ggmmaa: m[1] + m[2] + m[3], numero: +m[6], totaleCent: +m[7], tipo: +m[8], annullato: m[9] === '1' } : null
}
export function interpreta1515(p) {
  const m = /^1515(\d)(\d{4})(\d{4})([0-3])/.exec(p ?? '')
  return m ? { chiusura: +m[2], documento: +m[3], stato: ['inviato', 'fallito', 'senza_risposta', 'via_browser'][+m[4]] } : null
}

const IT_FASCE = 'Europe/Rome'
/** Ora italiana "adesso" come componenti (non dipende dal fuso del Mac). */
export function oraRoma(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('it-IT', { timeZone: IT_FASCE, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]))
  return { g: +p.day, m: +p.month, a: +p.year, h: +p.hour % 24, mi: +p.minute }
}
const inMinuti = (o) => Date.UTC(o.a, o.m - 1, o.g, o.h, o.mi) / 60000
export const scartoMinuti = (cassa, mac) => inMinuti(cassa) - inMinuti(mac)
const stessoGiorno = (a, b) => a.g === b.g && a.m === b.m && a.a === b.a
export const dataIt = (o) => `${String(o.g).padStart(2, '0')}/${String(o.m).padStart(2, '0')}/${o.a}`
export const oraIt = (o) => `${String(o.h).padStart(2, '0')}:${String(o.mi).padStart(2, '0')}`

export function confrontaVersioni(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1 }
  return 0
}
const ggmmaaData = (s) => (/^\d{6}$/.test(s) && s !== '000000' ? { g: +s.slice(0, 2), m: +s.slice(2, 4), a: 2000 + +s.slice(4, 6), h: 0, mi: 0 } : null)

// ───────────────────────── lettura dalla cassa ─────────────────────────

const COMANDI = ['1511', '15111', '1013', '1214', '1512', '1001', '1106', '1104', '1012', '6801', '1023']

/** Legge tutto con SOLE richieste dati. Un errore della cassa su UNA lettura non ferma le altre (ma si ricorda). */
export async function leggiCassa(s) {
  const r = { raw: {}, errori: {} }
  const prova = async (chiave, cmd) => {
    try { r.raw[chiave] = await s.manda(cmd) } catch (e) {
      if (e instanceof ErroreCassa) { r.raw[chiave] = null; r.errori[chiave] = e.message } else throw e
    }
  }
  for (const c of COMANDI) await prova(c, c)
  for (let i = 1; i <= 9; i++) await prova('1002' + i, '1002' + i)
  const tot = Math.min(Number(r.raw['1023']?.slice(4, 6)) || 11, 11)
  for (let i = 1; i <= tot; i++) await prova('7112' + String(i).padStart(2, '0'), '7112' + String(i).padStart(2, '0'))
  return r
}

export async function leggiWeb(web) {
  const out = { status: null, indice: null, errore: null }
  try { out.status = leggiStatus(await web.leggi('/Status.htm')) } catch (e) { if (e instanceof WebErrore) out.errore = e.message; else throw e }
  try { out.indice = leggiIndice(await web.leggi('/index.htm')) } catch (e) { if (e instanceof WebErrore) out.errore ||= e.message; else throw e }
  return out
}

// ───────────────────────── interpretazione e spie ─────────────────────────

export function valuta({ letture, web = {}, profilo, spunte = {}, intestazioneVoluta = null, ultimiFirmware, adesso = new Date(), vp = null }) {
  const raw = letture.raw
  const s1511 = interpreta1511(raw['15111']) || interpreta1511(raw['1511'])
  const st = web.status || {}
  const ix = web.indice || {}
  const spie = []
  const spia = (id, cosa, valore, colore, nota) => { spie.push({ id, cosa, valore, colore, ...(nota ? { nota } : {}) }); return colore }

  const fiscWeb = st.FISCALIZZATA
  const fiscalizzata = fiscWeb === 'SI' ? true : fiscWeb === 'NO' ? false : null
  spia('fiscalizzata', 'Fiscalizzata', fiscalizzata === null ? 'non leggibile (web server)' : fiscalizzata ? 'Sì' : 'No: da fiscalizzare', fiscalizzata === null ? 'g' : fiscalizzata ? 'v' : 'r')
  if (s1511) {
    spia('chiave', 'Chiave privata', s1511.chiave ? 'Generata' : 'Non generata', s1511.chiave ? 'v' : 'r')
    spia('censita', 'Censimento', s1511.censita ? 'Censita' : 'Non censita', s1511.censita ? 'v' : 'r')
    spia('attivata', 'Attivazione', s1511.attivata ? 'Attivata' : 'Non attivata', s1511.attivata ? 'v' : 'r')
    const sd = ggmmaaData(s1511.dataServizio)
    spia('servizio', 'Messa in servizio', s1511.inServizio ? 'In servizio' + (sd ? ` dal ${dataIt(sd)}` : '') : 'Non in servizio', s1511.inServizio ? 'v' : 'r')
    const dem = s1511.demo || s1511.simulazione
    spia('demo', 'Demo / simulazione', dem ? 'ATTIVA (non emette documenti veri)' : 'Spente', dem ? (s1511.attivata ? 'r' : 'a') : 'v')
    if (s1511.certificato !== undefined) {
      const fine = ggmmaaData(s1511.certA), ini = ggmmaaData(s1511.certDa)
      const scaduto = fine && inMinuti(fine) < inMinuti(oraRoma(adesso))
      spia('certificato', 'Certificato', !s1511.certificato ? 'Non presente' : `Valido ${ini ? dataIt(ini) : '?'} → ${fine ? dataIt(fine) : '?'}${scaduto ? ' (SCADUTO)' : ''}`, !s1511.certificato ? (s1511.attivata ? 'r' : 'g') : scaduto ? 'r' : 'v')
    } else if (st.CERTIFICATO) spia('certificato', 'Certificato', st.CERTIFICATO === 'SI' ? `Valido fino al ${st['CERT.VALIDO FINO']}` : 'Non presente', st.CERTIFICATO === 'SI' ? 'v' : 'g')
  } else spia('stato1511', 'Stato RT (1511)', 'la cassa non risponde a 1511', 'g')
  if (raw['1512']) spia('telematica', 'Telematica', 'Versione ' + (raw['1512'][4] === '1' ? '7' : raw['1512'][4] === '0' ? '6' : '?'), 'v')

  // firmware
  const reg1013 = /(\d{1,2}\.\d{2}\.\d{2})/.exec(raw['1013'] ?? '')
  const modello = (/(K3[A-Z0-9-]*)/.exec(raw['1013'] ?? '') || [])[1] || st._modello || ix.modello || null
  const fw = reg1013?.[1] || st._firmware || ix.firmware || null
  const ultimo = profilo.firmwareUltimo || (modello && ultimiFirmware?.modelli?.[modello]) || null
  if (!fw) spia('firmware', 'Firmware', 'non leggibile', 'g')
  else if (!ultimo) spia('firmware', 'Firmware', `${fw} (ultimo del modello non dichiarato)`, 'a')
  else {
    const c = confrontaVersioni(fw, ultimo)
    spia('firmware', 'Firmware', c === 0 ? `${fw} = ultimo` : c < 0 ? `${fw}: c'è il ${ultimo}` : `${fw} (più nuovo del dichiarato ${ultimo})`, c === 0 ? 'v' : c < 0 ? 'r' : 'a')
  }

  // ultima chiusura
  const mac = oraRoma(adesso)
  const uc = interpreta1106(raw['1106'])
  if (uc) spia('chiusura', 'Ultima chiusura', `${dataIt(uc)} alle ${oraIt(uc)}`, stessoGiorno(uc, mac) ? 'v' : 'a')
  else spia('chiusura', 'Ultima chiusura', 'nessuna ancora', 'g')

  // corrispettivi
  if (ix.nonInviati != null) {
    const brutti = (ix.nonInviati || 0) + (ix.falliti || 0)
    spia('corrispettivi', 'Corrispettivi', brutti === 0 ? 'Tutti inviati' : `${ix.nonInviati} non inviati, ${ix.falliti ?? '?'} falliti`, brutti === 0 ? 'v' : 'r')
  } else spia('corrispettivi', 'Corrispettivi', 'non leggibili (web server)', 'g')

  // ora
  const oc = interpreta1001(raw['1001'])
  if (oc) {
    const d = scartoMinuti(oc, mac)
    spia('ora', 'Ora della cassa', `${dataIt(oc)} ${oraIt(oc)} (${d === 0 ? 'uguale al Mac' : (d > 0 ? '+' : '') + d + ' min sul Mac'})`, Math.abs(d) <= 2 ? 'v' : Math.abs(d) <= 10 ? 'a' : 'r')
  } else spia('ora', 'Ora della cassa', 'non leggibile', 'g')

  // intestazione
  const righe = []
  for (let i = 1; i <= 9; i++) { const x = interpreta1002(raw['1002' + i]); righe.push(x || { riga: i, tipo: 1, testo: '' }) }
  const piene = righe.filter((x) => x.testo.trim() !== '')
  const nStampa = Number(raw['6801']?.[4])
  const diFabbrica = piene.some((x) => /CUSTOM\s*SPA|FONTEVIVO|NEWTON/i.test(x.testo))
  const max = profilo.intestazioneMaxRighe
  let ci = 'v', vi = `${piene.length} righe: ${piene.slice(0, 2).map((x) => x.testo).join(' / ')}${piene.length > 2 ? ' …' : ''}`
  if (!piene.length) { ci = 'r'; vi = 'vuota' } else if (diFabbrica) { ci = 'r'; vi = 'di fabbrica (CUSTOM SPA): da impostare' } else if (max && piene.length > max) { ci = 'r'; vi = `${piene.length} righe: il profilo ne ammette ${max}` } else if (intestazioneVoluta && !stessaIntestazione(piene, intestazioneVoluta)) { ci = 'a'; vi += ' (diversa da quella preparata)' }
  spia('intestazione', 'Intestazione', vi, ci, Number.isFinite(nStampa) ? `la cassa ne stampa ${nStampa}` : undefined)

  // aliquote
  const aliq = []
  for (let i = 1; i <= 11; i++) { const x = interpreta7112(raw['7112' + String(i).padStart(2, '0')]); if (x) aliq.push(x) }
  if (profilo.aliquote) {
    const diff = Object.entries(profilo.aliquote).filter(([i, v]) => { const a = aliq.find((x) => x.indice === +i); return !a || Math.abs(a.valore - v) > 0.001 })
    const ora = Object.keys(profilo.aliquote).map((i) => { const a = aliq.find((x) => x.indice === +i); return a ? `${a.valore}` : '?' }).join(' · ')
    spia('aliquote', 'Aliquote', diff.length ? `${ora}: il profilo vuole ${Object.values(profilo.aliquote).join(' · ')}` : `${ora} come il profilo`, diff.length ? 'r' : 'v')
  } else spia('aliquote', 'Aliquote', aliq.slice(0, 4).map((x) => x.valore).join(' · ') + ' (nessun confronto)', 'g')
  if (profilo.nature) {
    const natura = aliq.filter((x) => x.indice >= 5)
    const testo = natura.map((x) => `${x.descrizione || 'N' + x.esente}`).join(' · ')
    const tutte = profilo.nature.every((n) => natura.some((x) => new RegExp(n.replace('.', '\\.') + '(?!\\d)', 'i').test(x.descrizione) || `N${x.esente}` === n))
    spia('nature', 'Nature esenti', testo || 'non lette', tutte ? 'v' : 'a', `il profilo cita: ${profilo.nature.join(' · ')}`)
  }

  // programmazioni che il PC non legge: grigie con la spunta del tecnico
  for (const m of profilo.manuali || []) {
    if (m.id === 'eth910') spia(m.id, `${m.codice} ${m.cosa}`, 'Ethernet (il programma parla in rete)', 'v')
    else spia(m.id, `${m.codice} ${m.cosa}`, spunte[m.id] ? `${m.voluto} (spunta del tecnico)` : `${m.voluto}: non leggibile dal PC`, spunte[m.id] ? 'v' : 'g')
  }

  if (vp) spia('verificazione', 'Verificazione', `Fatta il ${vp.data} · prossima ${vp.prossima}`, 'v')
  else spia('verificazione', 'Verificazione', 'non registrata da qui', 'g')

  const chiusure = interpreta1104(raw['1104'])
  return {
    spie,
    modello, firmware: fw, firmwareUltimo: ultimo,
    matricola: s1511?.matricola || st._matricola || '',
    fasi: { fiscalizzata, chiave: !!s1511?.chiave, censita: !!s1511?.censita, attivata: !!s1511?.attivata, inServizio: !!s1511?.inServizio, demo: !!(s1511?.demo || s1511?.simulazione) },
    chiusure: chiusure?.chiusure ?? null,
    documentoAperto: interpreta1012(raw['1012']) !== null && interpreta1012(raw['1012']) !== 0,
    oraCassa: oc, intestazione: righe, nRigheStampate: Number.isFinite(nStampa) ? nStampa : null, aliquote: aliq,
    esercente: { piva: st['CF/PIVA ESERCENTE'] && st['CF/PIVA ESERCENTE'] !== '---' ? st['CF/PIVA ESERCENTE'] : '' },
    corrispettivi: ix.nonInviati != null ? { nonInviati: ix.nonInviati, falliti: ix.falliti } : null,
    webErrore: web.errore || null,
    erroriLettura: letture.errori,
    s1511,
  }
}

export function stessaIntestazione(piene, voluta) {
  const v = voluta.filter((x) => (x.testo || '').trim() !== '')
  if (v.length !== piene.length) return false
  return v.every((x, i) => (x.testo || '').trim().toUpperCase() === piene[i].testo.trim().toUpperCase() && (x.tipo || 1) === piene[i].tipo)
}
