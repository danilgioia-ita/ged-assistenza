// LA CHECK-LIST UFFICIALE (Mod. 10.1 + 10.2 / 10.3): righe, regole e dati che il modulo chiede. Porta in Node delle regole di
// `CheckListUfficiale.php` del CRM (crm-core/app/Services/Verificazione/): STESSE righe, STESSE regole, e il PDF lo compila
// `lib/pdf/modulo.mjs` con la stessa logica. Cambiano solo le fonti dei dati: qui vengono dalla cassa e dalle risposte salvate
// nell'archivio, non da un intervento del CRM.
//
//  - Il modulo della pagina 2 lo sceglie la riga 1.3 (sigillo presente SI → 10.2, NO → 10.3), non il tecnico.
//  - Le righe partono PROPOSTE su SI (regola di Danilo, 18/10), dichiarate tali; la coppia del firmware segue l'aggiornamento;
//    gli esercizi ambulanti (sezione 3 del 10.2) non si propongono mai. Quello che la procedura ha verificato, o che il
//    tecnico ha toccato, vince sempre sulla proposta.
//  - L'esito «positivo» si propone solo se NESSUNA riga è NO (la coppia del firmware non conta: una delle due è NO per costruzione).
//  - Se manca un campo obbligatorio il modulo NON si genera, e si elencano TUTTI i campi che mancano in una volta sola.
//  - Differenza dal CRM, voluta: le firme (tecnico e cliente) NON sono obbligatorie. Se non c'è un'immagine, il riquadro esce
//    vuoto da firmare a penna. Tutto il resto è obbligatorio come nel CRM.
import { oraRoma } from './stato.mjs'

export const PROPOSTA = 'si'
export const SEZIONE_AMBULANTI = '3. RT su aree pubbliche'
export const TIPI_SIGILLO = { adesiva: 'Targhetta adesiva', percussione: 'Percussione (piombo/PVC)', tamper: 'Tamper' }
export const LUOGHI = { cliente: 'Presso il cliente', laboratorio: 'Presso il nostro laboratorio', remoto: 'A distanza (da remoto)' }
export const RIFERIMENTI = { pagamento: 'A pagamento', garanzia: 'In garanzia', abbonamento: 'Cliente in abbonamento' }
export const MESI_VERIFICA = 24

export const RIGHE_10_2 = [
  ['1. Esame visivo RT', { '1.1': 'Integrità del modulo fiscale (involucro RT)', '1.2': 'Targhetta identificativa del RT presente, conforme e integra', '1.5': 'QR Code presente e nel formato conforme', '1.6': 'Lettura QR Code: dati corrispondenti alla targhetta del RT', '1.7': 'Lettura QR Code: dati dell\'esercente coerenti e completi' }],
  ['2. Prove su tutti gli RT', { '2.1': 'Lettura QR Code: versione firmware risultante', '2.2': 'Versione firmware identificata sul RT (non dal QR Code)', '2.3': 'La versione identificata è l\'ultima dichiarata dal produttore', '2.4': 'Aggiornamento firmware del dispositivo', '2.5': 'Funzionalità dei singoli tasti (tastiera d\'emergenza ove prevista)', '2.6': 'Funzionalità del display, lato cliente e lato operatore', '2.7': 'Utente informato dell\'accesso riservato alle memorie', '2.8': 'Chiusura giornaliera prima dell\'intervento, se non fatta dall\'utente', '2.9': 'Almeno 2 documenti commerciali di prova (lotteria e barcode)', '2.10': 'Annullo o reso dei documenti del punto 2.9', '2.11': 'Qualità di stampa e struttura del documento commerciale', '2.12': 'Chiusura giornaliera coerente con le prove eseguite', '2.13': 'Invio XML con «ESITO POSITIVO» dell\'Agenzia', '2.14': 'Stampa della memoria di dettaglio (DGFE) delle prove' }],
  [SEZIONE_AMBULANTI, { '3.1': 'Copertura della tastiera a tenuta stagna', '3.2': 'Indicatore dello stato di carica della batteria', '3.3': 'Collegamenti elettrici protetti e non pericolosi' }],
  ['4. Chiusura intervento su RT', { '4.1': 'Inseriti sul RT i dati del tecnico (C.F.) e del laboratorio (P. IVA)', '4.2': 'Registrato sul RT l\'esito della verificazione', '4.3': 'Documento gestionale a chiusura intervento' }],
]
export const RIGHE_10_3 = [
  ['1. Esame visivo RT', { '1.1': 'Integrità del modulo fiscale (involucro RT)', '1.2': 'Targhetta identificativa del RT presente, conforme e integra' }],
  ['2. Prove su RT privo del sigillo fiscale', { '2.1': 'Autocertificazione dell\'utente sul motivo dell\'assenza del sigillo', '2.2': 'Memorie disconnesse: il RT non emette documenti e segnala guasto', '2.3': 'Display disconnesso: il RT non emette documenti e segnala malfunzionamento' }],
  ['3. Prove su tutti gli RT', { '3.1': 'QR Code presente e nel formato conforme', '3.2': 'Lettura QR Code: dati corrispondenti alla targhetta del RT', '3.3': 'Lettura QR Code: dati dell\'esercente coerenti e completi', '3.4': 'Lettura QR Code: versione firmware risultante', '3.5': 'Versione firmware identificata sul RT (non dal QR Code)', '3.6': 'La versione identificata è l\'ultima dichiarata dal produttore', '3.7': 'Aggiornamento firmware del dispositivo', '3.8': 'Funzionalità dei singoli tasti (tastiera d\'emergenza ove prevista)', '3.9': 'Funzionalità del display, lato cliente e lato operatore', '3.10': 'Utente informato dell\'accesso riservato alle memorie', '3.11': 'Chiusura giornaliera prima dell\'intervento, se non fatta dall\'utente', '3.12': 'Almeno 2 documenti commerciali di prova (lotteria e barcode)', '3.13': 'Annullo o reso dei documenti del punto 3.12', '3.14': 'Qualità di stampa e struttura del documento commerciale', '3.15': 'Chiusura giornaliera coerente con le prove eseguite', '3.16': 'Invio XML con «ESITO POSITIVO» dell\'Agenzia', '3.17': 'Stampa della memoria di dettaglio (DGFE) delle prove' }],
  ['4. Chiusura intervento su RT', { '4.1': 'Inseriti sul RT i dati del tecnico (C.F.) e del laboratorio (P. IVA)', '4.2': 'Registrato sul RT l\'esito della verificazione', '4.3': 'Documento gestionale a chiusura intervento' }],
]
export const COPPIA_FIRMWARE = { '10.2': ['2.3', '2.4'], '10.3': ['3.6', '3.7'] }
/** Le righe che la procedura verifica, nella numerazione del 10.2, e la riga corrispondente nel 10.3. */
export const RIGA_10_3 = { '2.2': '3.5', '2.3': '3.6', '2.4': '3.7', '2.8': '3.11', '2.9': '3.12', '2.10': '3.13', '2.12': '3.15', '2.13': '3.16', '2.14': '3.17', '4.1': '4.1', '4.2': '4.2' }
export const INTERVENTI = { attivazione: 'Attivazione e verifica periodica RT', verifica: 'Verifica periodica RT' }

/** I campi «piatti» del modulo: [chiave, etichetta, gruppo, obbligatorio?]. L'ordine è quello in cui si leggono. */
export const CAMPI = [
  ['cliente', 'Utente RT (ragione sociale)', 'Cliente', true], ['partita_iva', 'Partita IVA', 'Cliente', true], ['codice_fiscale_cliente', 'Codice fiscale (se manca la P.IVA)', 'Cliente', false],
  ['sede_legale_indirizzo', 'Sede legale · indirizzo', 'Sede legale', true], ['sede_legale_cap', 'CAP', 'Sede legale', false], ['sede_legale_comune', 'Comune', 'Sede legale', true], ['sede_legale_provincia', 'Provincia', 'Sede legale', false],
  ['ubicazione_indirizzo', 'Ubicazione esercizio · indirizzo', 'Ubicazione', true], ['ubicazione_cap', 'CAP', 'Ubicazione', false], ['ubicazione_comune', 'Comune', 'Ubicazione', true], ['ubicazione_provincia', 'Provincia', 'Ubicazione', false],
  ['sdi', 'Codice SDI', 'Cliente', false], ['pec', 'PEC', 'Cliente', false],
  ['marca', 'Marca RT', 'Registratore', true], ['modello', 'Modello RT', 'Registratore', true], ['matricola', 'Matricola RT', 'Registratore', true], ['firmware_ultimo', 'Ultimo firmware del modello', 'Registratore', false],
  ['azzeramenti', 'Ultima chiusura (azzeramenti)', 'Registratore', true],
  ['richiesta_numero', 'Richiesta intervento N.', 'Intervento', false], ['richiesta_data', 'Data richiesta', 'Intervento', false], ['richiesta_ora', 'Ora richiesta', 'Intervento', false],
  ['descrizione', 'Descrizione dell\'intervento', 'Intervento', false], ['data', 'Data della verificazione', 'Intervento', true], ['scadenza', 'Prossima verificazione (MM/AAAA)', 'Intervento', false],
  ['cliente_firmatario', 'Chi firma per il cliente', 'Firme', false], ['tecnico_nome', 'Tecnico (nome e cognome)', 'Firme', true], ['tecnico_sigillo', 'Sigillo Id. Tecnico', 'Firme', true],
]

const pieno = (v) => v !== null && v !== undefined && String(v).trim() !== ''
const pulito = (v) => (pieno(v) ? String(v).trim() : null)
const sezioni = (modello) => (modello === '10.3' ? RIGHE_10_3 : RIGHE_10_2)
export const righePiatte = (modello) => Object.assign({}, ...sezioni(modello).map(([, r]) => r))

/**
 * `ingresso`:
 *   salvate    le risposte del tecnico (sigillo_presente, sigillo_tipo, area_pubblica, esito, luogo, riferimento,
 *              versione_identificata, versione_installata, documento_chiusura, intervento, aggiornamento_firmware, voci:{'10.2':{..},'10.3':{..}})
 *   auto       ciò che la procedura ha verificato, numerazione 10.2: { '2.2': {ok, testo, valore?} }
 *   dati       i dati piatti già composti (base dedotta dalla cassa + correzioni del tecnico)
 *   firmware   { installato, ultimo }
 *   firme      { tecnico: percorso|null, cliente: percorso|null }
 *   vp         { data, prossima } della verificazione fatta da qui, se c'è
 */
export function componi(ingresso) {
  const { salvate = {}, auto = {}, dati = {}, firmware = {}, firme = {}, vp = null, adesso = new Date() } = ingresso
  const sigilloPresente = ['si', 'no'].includes(salvate.sigillo_presente) ? salvate.sigillo_presente : null
  const modello = sigilloPresente === 'no' ? '10.3' : '10.2'
  const piatte = righePiatte(modello)
  const [cA, cB] = COPPIA_FIRMWARE[modello]
  const conAggiornamento = !!salvate.aggiornamento_firmware
  const contraddetta = pieno(firmware.installato) && pieno(firmware.ultimo) && firmware.installato.trim().toLowerCase() !== firmware.ultimo.trim().toLowerCase()

  // 1. proposte
  const voci = {}
  const fonte = {}
  for (const [sez, righe] of sezioni(modello)) {
    if (sez.startsWith(SEZIONE_AMBULANTI)) continue
    for (const n of Object.keys(righe)) { voci[n] = PROPOSTA; fonte[n] = 'proposta' }
  }
  const coppia = conAggiornamento ? ['no', 'si'] : [contraddetta ? null : 'si', 'no']
  ;[cA, cB].forEach((n, i) => { if (coppia[i] === null) { delete voci[n]; delete fonte[n] } else { voci[n] = coppia[i]; fonte[n] = 'proposta' } })

  // 2. quello che la procedura ha verificato
  const note = {}
  for (const [n10_2, a] of Object.entries(auto)) {
    const n = modello === '10.3' ? RIGA_10_3[n10_2] : n10_2
    if (!n || !piatte[n]) continue
    let valore = a.valore
    if (valore === undefined) valore = a.ok ? (n10_2 === '2.4' ? 'no' : 'si') : undefined // forma vecchia: ok=true, 2.4 «non serviva»
    if (valore === 'si' || valore === 'no') { voci[n] = valore; fonte[n] = 'procedura' }
    if (a.testo) note[n] = a.testo
  }

  // 3. quello che il tecnico ha toccato
  const sue = salvate.voci?.[modello] || {}
  for (const [n, v] of Object.entries(sue)) if (piatte[n] && (v === 'si' || v === 'no')) { voci[n] = v; fonte[n] = 'tecnico' }

  // ordine come nel CRM: l'ordine delle sezioni del modulo (decide l'ordine delle crocette nel PDF)
  const vociOrdinate = []
  for (const [, righe] of sezioni(modello)) for (const n of Object.keys(righe)) if (voci[n] !== undefined) vociOrdinate.push([n, voci[n]])

  const tuttePositive = () => {
    for (const [sez, righe] of sezioni(modello)) {
      const ambulanti = sez.startsWith(SEZIONE_AMBULANTI)
      for (const n of Object.keys(righe)) {
        const v = voci[n]
        if (ambulanti) { if (v === 'no') return false; continue }
        if (v === 'si') continue
        if ((n === cA || n === cB) && v === 'no' && !(voci[cA] === 'no' && voci[cB] === 'no')) continue
        return false
      }
    }
    return true
  }
  const qualcheNo = vociOrdinate.some(([n, v]) => v === 'no' && !((n === cA || n === cB) && !(voci[cA] === 'no' && voci[cB] === 'no')))

  const identificata = pulito(salvate.versione_identificata) ?? pulito(firmware.installato)
  const installata = pulito(salvate.versione_installata) ?? (voci[cB] === 'si' ? pulito(firmware.ultimo) : null)
  const esito = ['positivo', 'negativo'].includes(salvate.esito) ? salvate.esito : (tuttePositive() ? 'positivo' : null)
  const area = ['si', 'no'].includes(salvate.area_pubblica) ? salvate.area_pubblica : 'no'
  const risposte = {
    sigillo_presente: sigilloPresente ?? 'si', sigillo_tipo: TIPI_SIGILLO[salvate.sigillo_tipo] ? salvate.sigillo_tipo : null, area_pubblica: area,
    versione_identificata: identificata, versione_installata: installata, documento_chiusura: pulito(salvate.documento_chiusura), esito,
    luogo: LUOGHI[salvate.luogo] ? salvate.luogo : null, riferimento: RIFERIMENTI[salvate.riferimento] ? salvate.riferimento : null,
  }

  // dati per il PDF
  const avvisi = []
  const o = oraRoma(adesso)
  const oggi = `${String(o.g).padStart(2, '0')}/${String(o.m).padStart(2, '0')}/${o.a}`
  const dataVerifica = pieno(dati.data) ? dati.data.trim() : (vp?.data || oggi)
  let scadenza = null
  if (esito === 'positivo') {
    if (pieno(dati.scadenza)) scadenza = dati.scadenza.trim()
    else if (vp?.prossima) scadenza = vp.prossima
    else { const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(dataVerifica); if (m) { const tot = Number(m[3]) * 12 + Number(m[2]) - 1 + MESI_VERIFICA; scadenza = `${String((tot % 12) + 1).padStart(2, '0')}/${Math.floor(tot / 12)}` } }
    const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(dataVerifica)
    if (m && scadenza) { const tot = Number(m[3]) * 12 + Number(m[2]) - 1 + MESI_VERIFICA; const attesa = `${String((tot % 12) + 1).padStart(2, '0')}/${Math.floor(tot / 12)}`; if (attesa !== scadenza) avvisi.push(`La prossima verificazione è ${scadenza}, non data + ${MESI_VERIFICA} mesi (${attesa}): controlla.`) }
  }
  const d = (k) => pulito(dati[k])
  const ultimaChiusura = /^\d+$/.test(String(dati.azzeramenti ?? '').trim()) ? Number(String(dati.azzeramenti).trim()) : null
  const datiPdf = {
    richiesta_numero: d('richiesta_numero'), richiesta_data: d('richiesta_data'), richiesta_ora: d('richiesta_ora'),
    cliente: d('cliente'),
    sede_legale: { indirizzo: d('sede_legale_indirizzo'), cap: d('sede_legale_cap'), comune: d('sede_legale_comune'), provincia: d('sede_legale_provincia') },
    sede: null,
    ubicazione: { indirizzo: d('ubicazione_indirizzo'), cap: d('ubicazione_cap'), comune: d('ubicazione_comune'), provincia: d('ubicazione_provincia') },
    partita_iva: d('partita_iva'), codice_fiscale_cliente: d('codice_fiscale_cliente'), sdi: d('sdi'), pec: d('pec'),
    marca: d('marca'), modello: d('modello'), matricola: d('matricola'), firmware_ultimo: d('firmware_ultimo'), firmware_installato: pulito(firmware.installato),
    contratto_fino_al: null,
    tecnico_nome: d('tecnico_nome'), tecnico_sigillo: d('tecnico_sigillo'), tecnico_firma: firme.tecnico ?? null, cliente_firma: firme.cliente ?? null,
    cliente_firmatario: d('cliente_firmatario'), descrizione: d('descrizione') ?? 'Verificazione periodica RT',
    ultima_chiusura: ultimaChiusura, data: dataVerifica, scadenza,
  }

  const interventi = []
  interventi.push(salvate.intervento === 'attivazione' ? 'attivazione' : 'verifica_periodica')
  if (conAggiornamento || voci[cB] === 'si') interventi.push('firmware')

  // cosa manca
  const mancano = []
  const manca = (campo, cosa) => mancano.push({ campo, cosa })
  if (!datiPdf.cliente) manca('cliente', 'Nome dell\'utente RT (ragione sociale del cliente)')
  if (!datiPdf.partita_iva && !datiPdf.codice_fiscale_cliente) manca('partita_iva', 'Partita IVA (o codice fiscale) dell\'utente RT')
  if (!datiPdf.sede_legale.indirizzo || !datiPdf.sede_legale.comune) manca('sede_legale', 'Sede legale del cliente (indirizzo e comune)')
  if (!datiPdf.ubicazione.indirizzo || !datiPdf.ubicazione.comune) manca('ubicazione', 'Ubicazione dell\'esercizio (indirizzo e comune)')
  if (!datiPdf.marca) manca('marca', 'Marca del registratore')
  if (!datiPdf.modello) manca('modello', 'Modello del registratore')
  if (!datiPdf.matricola) manca('matricola', 'Matricola del registratore')
  if (!datiPdf.tecnico_nome) manca('tecnico_nome', 'Tecnico che ha eseguito l\'intervento')
  if (!datiPdf.tecnico_sigillo) manca('tecnico_sigillo', 'Sigillo identificativo del tecnico (logotipo)')
  if (sigilloPresente !== 'no' && !risposte.sigillo_tipo) manca('sigillo_tipo', 'Riga 1.4 — Tipologia del sigillo fiscale: adesiva, percussione o tamper')
  if (ultimaChiusura === null) manca('azzeramenti', 'Numero dell\'ultima chiusura fiscale letto sulla cassa (azzeramenti)')
  const senza = Object.keys(piatte).filter((n) => !sezioni(modello).find(([s, r]) => s.startsWith(SEZIONE_AMBULANTI) && r[n]) && !['si', 'no'].includes(voci[n]))
  if (senza.length) manca('voci', `Righe SI/NO senza risposta: ${senza.join(', ')}`)
  if (!esito) manca('esito', 'Esito della verificazione periodica: POSITIVO o NEGATIVO — c\'è una riga segnata NO')
  const [rId, rAgg] = modello === '10.3' ? ['3.5', '3.7'] : ['2.2', '2.4']
  if (!risposte.versione_identificata) manca('versione_identificata', `Riga ${rId} — Versione firmware identificata sul RT`)
  if (voci[rAgg] === 'si' && !risposte.versione_installata) manca('versione_installata', `Riga ${rAgg} — Versione firmware installata sul RT`)
  if (esito === 'positivo' && !scadenza) manca('scadenza', 'Scadenza della prossima verificazione periodica (mese/anno)')

  if (!firme.tecnico) avvisi.push('Firma del tecnico: nessuna immagine, il riquadro esce vuoto da firmare a penna.')
  if (!firme.cliente) avvisi.push('Firma del cliente: nessuna immagine, il riquadro esce vuoto da firmare a penna.')
  if (qualcheNo) avvisi.push('Hai segnato almeno una riga NO: l\'esito non si propone, lo decidi tu.')

  const righe = sezioni(modello).map(([sez, rr]) => ({
    sezione: sez, ambulanti: sez.startsWith(SEZIONE_AMBULANTI),
    righe: Object.entries(rr).map(([numero, testo]) => ({ numero, testo, valore: voci[numero] ?? null, fonte: fonte[numero] ?? null, nota: note[numero] ?? null, coppiaFirmware: numero === cA || numero === cB })),
  }))

  return {
    modello, sigilloPresente: sigilloPresente ?? 'si', soloRapporto: false,
    // la forma che riceve lib/pdf/modulo.mjs (la stessa che il CRM dà a ModuloUfficiale)
    pdf: { modello, soloRapporto: false, sigilloPresente: sigilloPresente ?? 'si', dati: datiPdf, risposte, risposteSalvate: salvate, voci: vociOrdinate, areePubblicheDaCompilare: modello === '10.2' && area === 'si', interventiRichiesti: [...new Set(interventi)] },
    righe, risposte, esitoProposto: tuttePositive() ? 'positivo' : null, mancano, avvisi, precompilata: !salvate.aggiornata_il,
    scadenza, conAggiornamento, qualcheNo,
  }
}

export function perciascuna(righeComposte) { return righeComposte.flatMap((s) => s.righe) }
