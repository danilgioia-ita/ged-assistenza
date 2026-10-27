// L'APPUNTO PER IL GST — NON È IL MODULO. La check-list ufficiale (Mod. 10.1 + 10.2 / 10.3) è il PDF depositato, che si genera con
// lib/pdf/modulo.mjs e lib/verifica.mjs. Questo file contiene solo ciò che serve a precompilarne i dati dalla cassa e il breve
// riepilogo testuale da incollare nel GST del CRM, che dice di non essere il modulo.
import { oraItaliana } from './registro.mjs'

// ───────────── i dati del modulo, DEDOTTI da ciò che la cassa dice ─────────────
const VIA = /^(VIA|V\.LE|VLE|VIALE|PIAZZA|P\.ZZA|P\.ZA|P\.ZZ|CORSO|C\.SO|LARGO|VICO|VICOLO|STRADA|S\.S\.|SS\s?\d|LOC\.|LOCALITA|TRAV\.?|CALATA|RIVIERA|CONTRADA|C\.DA|PIAZZALE|P\.LE|LUNGOMARE|VIA\w)/i
const FABBRICA = /CUSTOM\s*SPA|FONTEVIVO|NEWTON|^K3F-?N$/i
const TELEFONO = /^(TEL|TELEFONO|CELL|FAX)\b/i

/** Dalle righe d'intestazione: esercente (righe che non sono indirizzo, CAP/città o P.IVA), indirizzo, P.IVA. */
export function deduciDaIntestazione(righe) {
  const piene = righe.map((r) => String(r ?? '').trim()).filter(Boolean)
  if (piene.some((r) => FABBRICA.test(r))) return { esercente: '', indirizzo: '', piva: '', fabbrica: true }
  const esercente = [], indirizzo = []
  let piva = ''
  for (const r of piene) {
    const p = /(?<!\d)(\d{11})(?!\d)/.exec(r)
    if (p) { piva ||= p[1]; continue }
    if (TELEFONO.test(r)) continue
    if (VIA.test(r) || /(?<!\d)\d{5}(?!\d)/.test(r)) { indirizzo.push(r); continue }
    esercente.push(r)
  }
  return { esercente: esercente.join(' / '), indirizzo: indirizzo.join(', '), piva, fabbrica: false }
}


/** «VIA SALVATOR ROSA 76, NAPOLI 80135» → { indirizzo, cap, comune, provincia }. Quello che non si riconosce resta vuoto. */
export function parteIndirizzo(testo) {
  const parti = String(testo ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  let via = [], cap = '', comune = '', provincia = ''
  for (const p of parti) {
    const c = /(?<!\d)(\d{5})(?!\d)/.exec(p)
    if (c && !VIA.test(p)) {
      cap = c[1]
      const pr = /\(([A-Za-z]{2})\)/.exec(p)
      if (pr) provincia = pr[1].toUpperCase()
      comune = p.replace(c[1], '').replace(/\([A-Za-z]{2}\)/, '').replace(/\s+/g, ' ').trim()
    } else via.push(p)
  }
  return { indirizzo: via.join(', '), cap, comune, provincia }
}

/** I valori di partenza del modulo, dedotti da ciò che la cassa dice. Il tecnico li può correggere; una sua correzione non si sovrascrive. */
export function baseDaCassa({ matricola, righe = [], webPiva = '', chiusure = null, modello = '', firmwareUltimo = '', impostazioni }) {
  const d = deduciDaIntestazione(righe)
  const wp = String(webPiva || '').trim()
  const ind = parteIndirizzo(d.indirizzo)
  const avvisi = []
  if (d.fabbrica) avvisi.push('Intestazione di fabbrica: esercente, indirizzo e P.IVA non si possono dedurre. Imposta prima l\'intestazione (sezione Programmazione) o compilali a mano.')
  else if (ind.indirizzo) avvisi.push('Sede legale presa dall\'intestazione della cassa: correggila se è diversa.')
  const modelloRt = /(K3[A-Z0-9-]*)/.exec(modello)?.[1] || String(modello || '').trim()
  return {
    base: {
      cliente: d.esercente.replaceAll(' / ', ' '), partita_iva: /^[A-Za-z0-9]{11,16}$/.test(wp) ? wp : d.piva,
      sede_legale_indirizzo: ind.indirizzo, sede_legale_cap: ind.cap, sede_legale_comune: ind.comune, sede_legale_provincia: ind.provincia,
      ubicazione_indirizzo: ind.indirizzo, ubicazione_cap: ind.cap, ubicazione_comune: ind.comune, ubicazione_provincia: ind.provincia,
      marca: /^K3/i.test(modelloRt) ? 'CUSTOM' : '', modello: modelloRt, matricola: matricola || '', firmware_ultimo: firmwareUltimo || '',
      azzeramenti: chiusure != null ? String(chiusure) : '',
      tecnico_nome: impostazioni.tecnico.nome || '', tecnico_sigillo: impostazioni.tecnico.sigillo || '',
    },
    avvisi,
  }
}

/** Gli unici campi che si salvano come «correzione del tecnico». */
export function datiComposti(salvati, base) { return { ...base, ...(salvati || {}) } }

const VOCE = { si: 'SI', no: 'NO' }
/** Il riepilogo da incollare nel GST. NON è il modulo: il modulo è il PDF ufficiale. */
export function testoAppunto({ ip, modello, firmware, profilo, verifica, dati, nomeFile }) {
  const righe = verifica.righe.flatMap((s) => s.righe)
  return [
    'APPUNTO PER IL GST — NON È IL MODULO',
    'Il documento ufficiale è il PDF «Mod. 10.1 + 10.' + (verifica.modello === '10.3' ? '3' : '2') + '» generato dagli Strumenti cassa' + (nomeFile ? ` (${nomeFile})` : '') + '.',
    '',
    `Cassa: ${modello || 'K3F-N'} · matricola ${dati.matricola || '?'} · firmware ${firmware || '?'} · ${ip || ''} · profilo ${profilo || ''}`.trim(),
    `Esercente: ${dati.cliente || '—'} · P.IVA ${dati.partita_iva || '—'} · ${[dati.ubicazione_indirizzo, dati.ubicazione_cap, dati.ubicazione_comune].filter(Boolean).join(' ') || '—'}`,
    `Azzeramenti: ${dati.azzeramenti || '—'} · sigillo: ${verifica.risposte.sigillo_tipo || '—'} · esito: ${verifica.risposte.esito || '—'} · prossima verificazione: ${verifica.scadenza || '—'}`,
    `Compilato il ${oraItaliana()}`,
    '', ...righe.filter((r) => r.valore).map((r) => `${r.numero} ${r.testo}: ${VOCE[r.valore]}${r.fonte === 'procedura' ? ' (verificata dalla procedura)' : ''}`),
    '',
    'Firma del cliente e del tecnico: sul PDF (a penna se il riquadro è vuoto).',
    'Prossimo passo (non ancora fatto): la firma del cliente a distanza e la scrittura dell\'esito nel GST del CRM.',
  ].join('\n')
}

/** I nomi vecchi dei campi (prima del modulo ufficiale) diventano quelli di adesso, senza perdere ciò che il tecnico aveva scritto. */
export function migraDati(dati = {}) {
  const o = { ...dati }
  const sposta = (da, a) => { if (pieno(o[da]) && !pieno(o[a])) o[a] = o[da]; delete o[da] }
  sposta('esercente', 'cliente'); sposta('pivaEsercente', 'partita_iva'); sposta('sigillo', 'tecnico_sigillo'); sposta('firmatario', 'cliente_firmatario')
  for (const k of ['indirizzo', 'tecnicoCF', 'labPIVA', 'nota']) delete o[k]
  return o
}
const pieno = (v) => v !== null && v !== undefined && String(v).trim() !== ''
