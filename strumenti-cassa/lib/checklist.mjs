// La check-list Mod. 10.1 + 10.2 a fine verificazione: le righe che compila la procedura (blu), quelle fisiche che spunta
// il tecnico (grigio), i dati del modulo, e due uscite: pagina stampabile e testo da copiare nel GST del CRM.
// La firma a distanza e la scrittura nel CRM NON ci sono ancora: sono il «prossimo passo» e la pagina lo dice.
import { oraItaliana } from './registro.mjs'

// [riga, testo, chi]  chi: 'p' = la compila la procedura · 't' = la spunta il tecnico
export const RIGHE = [
  ['1.1', 'Integrità dell\'involucro', 't'], ['1.2', 'Targhetta presente e integra', 't'], ['1.3', 'Sigillo fiscale integro', 't'],
  ['1.5', 'QR Code presente e conforme', 't'], ['1.6', 'QR uguale alla targhetta', 't'], ['1.7', 'Dati dell\'esercente nel QR', 't'],
  ['2.1', 'Firmware letto dal QR', 't'], ['2.2', 'Firmware sulla cassa', 'p'], ['2.3', 'È l\'ultimo del produttore', 'p'], ['2.4', 'Aggiornamento firmware', 'p'],
  ['2.5', 'Tasti', 't'], ['2.6', 'Display operatore e cliente', 't'], ['2.7', 'Utente informato sulle memorie', 't'],
  ['2.8', 'Chiusura prima dell\'intervento', 'p'], ['2.9', 'Due documenti di prova', 'p'], ['2.10', 'Annullo dei documenti di prova', 'p'],
  ['2.11', 'Qualità di stampa', 't'], ['2.12', 'Chiusura coerente', 'p'], ['2.13', 'Invio XML con esito positivo', 'p'], ['2.14', 'DGFE delle prove stampato', 'p'],
  ['4.1', 'Dati del tecnico e del laboratorio sul RT', 'p'], ['4.2', 'Esito registrato sul RT', 'p'], ['4.3', 'Documento gestionale', 't'],
]

export const CAMPI = [
  ['matricola', 'Matricola'], ['esercente', 'Esercente'], ['pivaEsercente', 'P.IVA esercente'], ['indirizzo', 'Indirizzo'],
  ['azzeramenti', 'Azzeramenti'], ['sigillo', 'Tipo di sigillo'], ['tecnicoCF', 'Tecnico (C.F.)'], ['labPIVA', 'Laboratorio (P.IVA)'],
  ['nota', 'Nota sulla cassa (max 50 caratteri)'], ['firmatario', 'Chi firma per il cliente'],
]

export const PROSSIMO_PASSO = 'Prossimo passo (non ancora fatto): la firma del cliente a distanza e la scrittura dell\'esito nel GST del CRM. Per ora: stampa o salva in PDF questa pagina, fai firmare il cliente, e incolla il testo riepilogativo nell\'intervento del CRM.'

export function righeComposte(stato) {
  const auto = stato.auto || {}, spunte = stato.spunte || {}
  return RIGHE.map(([riga, testo, chi]) => {
    if (chi === 'p') { const a = auto[riga]; return { riga, testo: a?.testo || testo, chi: 'procedura', verificata: !!a, si: a ? !!a.ok : !!spunte[riga] } }
    return { riga, testo, chi: 'tecnico', verificata: false, si: !!spunte[riga] }
  })
}

export function datiComposti(stato, base = {}) {
  const d = { ...base, ...(stato.dati || {}) }
  if (d.nota) d.nota = String(d.nota).slice(0, 50)
  return d
}

export function testoRiepilogo({ ip, modello, firmware, profilo, stato, base }) {
  const d = datiComposti(stato, base)
  const righe = righeComposte(stato)
  const esito = (r) => `${r.riga} ${r.testo}: ${r.si ? 'OK' : 'NON SPUNTATA'}${r.chi === 'procedura' && r.verificata ? ' (verificata dalla procedura)' : ''}`
  return [
    `VERIFICAZIONE PERIODICA — Mod. 10.1 + 10.2`,
    `Cassa: ${modello || 'K3F-N'} · matricola ${d.matricola || '?'} · firmware ${firmware || '?'} · ${ip || ''} · profilo ${profilo || ''}`.trim(),
    `Esercente: ${d.esercente || '—'} · P.IVA ${d.pivaEsercente || '—'} · ${d.indirizzo || '—'}`,
    `Azzeramenti: ${d.azzeramenti || '—'} · sigillo: ${d.sigillo || '—'}`,
    `Tecnico C.F. ${d.tecnicoCF || '—'} · laboratorio P.IVA ${d.labPIVA || '—'}`,
    `Nota sulla cassa: ${d.nota || '—'}`,
    `Compilata il ${oraItaliana()}`,
    '', ...righe.map(esito), '',
    `Firma del cliente: ${d.firmatario ? d.firmatario : '— (da raccogliere)'}`,
    PROSSIMO_PASSO,
  ].join('\n')
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function paginaStampabile({ ip, modello, firmware, profilo, stato, base }) {
  const d = datiComposti(stato, base)
  const righe = righeComposte(stato)
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Check-list Mod. 10.1 + 10.2 — ${esc(d.matricola)}</title>
<style>
body{font:14px/1.4 -apple-system,'IBM Plex Sans',system-ui,sans-serif;color:#17212b;margin:24px auto;max-width:860px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 6px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #b9c3cd;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#f3f5f7;width:34%}.ok{font-weight:700}.no{color:#c4321f;font-weight:700}.p{color:#0b5f73;font-size:12px}
.firma{height:90px;border:1px dashed #8a96a3;margin-top:6px}.nota{margin-top:18px;padding:10px;border:1px solid #e0c98a;background:#fffaf0;font-size:13px}
@media print{.nota{border:1px solid #999;background:#fff}}
</style></head><body>
<h1>Verificazione periodica — Mod. 10.1 + 10.2</h1>
<div>${esc(modello || 'K3F-N')} · firmware ${esc(firmware || '?')} · ${esc(ip || '')} · compilata il ${esc(oraItaliana())}</div>
<h2>Dati del modulo</h2>
<table>${CAMPI.map(([k, et]) => `<tr><th>${esc(et)}</th><td>${esc(d[k] || '')}</td></tr>`).join('')}</table>
<h2>Righe</h2>
<table><tr><th style="width:60px">Riga</th><th style="width:auto">Controllo</th><th style="width:90px">Esito</th><th style="width:140px">Chi</th></tr>
${righe.map((r) => `<tr><td>${esc(r.riga)}</td><td>${esc(r.testo)}</td><td class="${r.si ? 'ok' : 'no'}">${r.si ? 'OK' : '—'}</td><td class="p">${r.chi === 'procedura' ? (r.verificata ? 'verificato dalla procedura' : 'non ancora verificata dalla procedura') : 'spunta del tecnico'}</td></tr>`).join('')}</table>
<h2>Firma del cliente</h2><div>${esc(d.firmatario || '')}</div><div class="firma"></div>
<div class="nota">${esc(PROSSIMO_PASSO)}</div>
</body></html>`
}

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

/** I valori di partenza del modulo. Il tecnico può correggerli: una sua modifica non si sovrascrive (vedi `datiComposti`). */
export function baseDaCassa({ matricola, righe = [], webPiva = '', chiusure = null, impostazioni }) {
  const d = deduciDaIntestazione(righe)
  const wp = String(webPiva || '').trim()
  return {
    base: {
      matricola: matricola || '', esercente: d.esercente, pivaEsercente: /^[A-Za-z0-9]{11,16}$/.test(wp) ? wp : d.piva, indirizzo: d.indirizzo,
      azzeramenti: chiusure != null ? String(chiusure) : '', tecnicoCF: impostazioni.tecnico.cf, labPIVA: impostazioni.laboratorio.piva,
    },
    avvisi: d.fabbrica ? ['Intestazione di fabbrica: esercente, indirizzo e P.IVA non si possono dedurre. Imposta prima l\'intestazione (sezione Programmazione) o compilali a mano.'] : [],
  }
}
