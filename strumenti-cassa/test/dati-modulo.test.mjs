import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { deduciDaIntestazione, baseDaCassa, parteIndirizzo, migraDati } from '../lib/checklist.mjs'
import { componi, righePiatte } from '../lib/verifica.mjs'
import { generaModulo } from '../lib/pdf/modulo.mjs'
import { ambiente } from './aiuto.mjs'
import { verificaKammor, INTESTAZIONE_KAMMOR, IMPOSTAZIONI } from './aiuto-verifica.mjs'

const KAMMOR = INTESTAZIONE_KAMMOR
const MINIMARKET = ['MINIMARKET', 'DI RAZA ALI', 'VIA SALVATOR ROSA 71', '80135 NAPOLI', 'P.IVA 11142291217', '', '', '', '']
const FABBRICA = ['K3F-N', 'CUSTOM SPA', 'Via I. Newton, 4', '43010 Fontevivo (PR)', '', '', '', '', '']
const imp = IMPOSTAZIONI
const mettiIntestazione = (sim, righe) => righe.forEach((t, i) => { sim.intestazione[i] = { tipo: 1, testo: t } })
const FIRME = new URL('./fixtures/crm/firme/', import.meta.url).pathname
const SCENARI = new URL('./fixtures/crm/scenari/', import.meta.url).pathname
const GOLDEN = new URL('./fixtures/crm/golden/', import.meta.url).pathname

test('DEDUZIONE dall\'intestazione: le due intestazioni VERE', () => {
  assert.deepEqual(deduciDaIntestazione(KAMMOR), { esercente: 'KAMMOR / PIZZERIA E FRIGGITORIA / DA ALE E MIMMO', indirizzo: 'VIA SALVATOR ROSA 76, NAPOLI 80135', piva: '11130901215', fabbrica: false })
  assert.deepEqual(deduciDaIntestazione(MINIMARKET), { esercente: 'MINIMARKET / DI RAZA ALI', indirizzo: 'VIA SALVATOR ROSA 71, 80135 NAPOLI', piva: '11142291217', fabbrica: false })
  assert.deepEqual(parteIndirizzo('VIA SALVATOR ROSA 76, NAPOLI 80135'), { indirizzo: 'VIA SALVATOR ROSA 76', cap: '80135', comune: 'NAPOLI', provincia: '' })
  assert.deepEqual(parteIndirizzo('V.LE DELLE TERME 3, 80100 NAPOLI (NA)'), { indirizzo: 'V.LE DELLE TERME 3', cap: '80100', comune: 'NAPOLI', provincia: 'NA' })
})

test('DEDUZIONE: l\'intestazione di FABBRICA non diventa l\'esercente: resta vuoto e compare l\'avviso', () => {
  assert.deepEqual(deduciDaIntestazione(FABBRICA), { esercente: '', indirizzo: '', piva: '', fabbrica: true })
  const b = baseDaCassa({ matricola: 'M1', righe: FABBRICA, chiusure: 3, modello: 'K3F-N 15.04.05', impostazioni: imp })
  assert.equal(b.base.cliente, ''); assert.equal(b.base.ubicazione_indirizzo, '')
  assert.match(b.avvisi[0], /Intestazione di fabbrica/)
  assert.equal(b.base.matricola, 'M1'); assert.equal(b.base.azzeramenti, '3'); assert.equal(b.base.marca, 'CUSTOM'); assert.equal(b.base.modello, 'K3F-N'); assert.equal(b.base.tecnico_sigillo, 'GED01')
})

test('DEDUZIONE: il telefono non è esercente, la P.IVA del web server vince su quella della riga', () => {
  assert.equal(deduciDaIntestazione(['BAR SOLE', 'TEL 0815551234']).esercente, 'BAR SOLE')
  assert.equal(baseDaCassa({ matricola: 'M', righe: KAMMOR, webPiva: '99999999999', impostazioni: imp }).base.partita_iva, '99999999999')
  assert.equal(baseDaCassa({ matricola: 'M', righe: KAMMOR, webPiva: '---', impostazioni: imp }).base.partita_iva, '11130901215')
})

test('MODULO: il modulo lo sceglie la riga 1.3; l\'esito non si propone se c\'è un NO; la coppia del firmware non è un NO', () => {
  let v = verificaKammor()
  assert.equal(v.modello, '10.2'); assert.equal(v.risposte.esito, 'positivo'); assert.deepEqual(v.mancano, [])
  v = verificaKammor({ salvate: { voci: { '10.2': { '2.5': 'no' } } } })
  assert.equal(v.risposte.esito, null, 'con una riga NO non si propone niente')
  assert.ok(v.mancano.some((m) => m.campo === 'esito'))
  v = verificaKammor({ salvate: { sigillo_presente: 'no' } })
  assert.equal(v.modello, '10.3'); assert.ok(righePiatte('10.3')['3.17']); assert.equal(v.pdf.voci.find(([n]) => n === '3.5')[1], 'si', '2.2 → 3.5')
  assert.equal(v.pdf.voci.find(([n]) => n === '3.7')[1], 'no')
  assert.ok(!v.mancano.some((m) => m.campo === 'sigillo_tipo'), 'sul 10.3 il tipo di sigillo non si chiede')
  // senza il tipo di sigillo (10.2) il modulo non si genera
  v = verificaKammor({ salvate: { sigillo_tipo: '' } })
  assert.ok(v.mancano.some((m) => m.campo === 'sigillo_tipo'))
  // firmware aggiornato: 2.3 NO, 2.4 SÌ, serve la versione installata, e c'è la casella «Aggiornamento firmware»
  v = verificaKammor({ salvate: { aggiornamento_firmware: true }, })
  assert.equal(v.pdf.voci.find(([n]) => n === '2.4')[1], 'no', 'la procedura aveva già detto «non serviva»: vince la procedura')
})

test('MODULO: le firme NON sono obbligatorie (riquadro vuoto da firmare a penna), tutto il resto sì', () => {
  const v = verificaKammor({ firme: { tecnico: null, cliente: null } })
  assert.deepEqual(v.mancano, [])
  assert.ok(v.avvisi.some((a) => /Firma del cliente/.test(a)))
  const incompleto = componi({ dati: {}, firmware: {}, adesso: new Date() })
  assert.ok(incompleto.mancano.length >= 8, 'elenca TUTTI i campi mancanti in una volta')
})

test('PDF dai dati degli Strumenti cassa = PDF del CRM con gli stessi dati (KAMMOR, byte per byte)', () => {
  const v = verificaKammor()
  const scenario = JSON.parse(readFileSync(join(SCENARI, 'da-strumenti-kammor.json'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(v.pdf)), scenario, 'i dati che gli Strumenti cassa danno al modulo sono quelli dello scenario generato dal CRM')
  const firma = (p) => (existsSync(join(FIRME, p)) ? readFileSync(join(FIRME, p)) : null)
  const mio = generaModulo(v.pdf, { firma })
  assert.ok(mio.equals(readFileSync(join(GOLDEN, 'da-strumenti-kammor.pdf'))), 'il PDF non è identico a quello generato dal codice del CRM')
})

test('CHECK-LIST dalla cassa: i dati si precompilano, una correzione del tecnico non si sovrascrive', async () => {
  const a = await ambiente({ chiusure: 3, webDown: true })
  try {
    await a.collega()
    mettiIntestazione(a.sim, KAMMOR)
    let c = await a.chiama('GET', 'checklist')
    assert.equal(c.dati.matricola, 'STITE350592')
    assert.equal(c.dati.cliente, 'KAMMOR PIZZERIA E FRIGGITORIA DA ALE E MIMMO')
    assert.equal(c.dati.ubicazione_indirizzo, 'VIA SALVATOR ROSA 76'); assert.equal(c.dati.ubicazione_cap, '80135'); assert.equal(c.dati.ubicazione_comune, 'NAPOLI')
    assert.equal(c.dati.partita_iva, '11130901215', 'web server muto: la P.IVA viene dalla riga d\'intestazione')
    assert.equal(c.dati.azzeramenti, '3'); assert.equal(c.dati.marca, 'CUSTOM'); assert.equal(c.dati.modello, 'K3F-N')
    assert.equal(c.dati.tecnico_sigillo, 'GED01'); assert.equal(c.dati.tecnico_nome, 'Ercole Danilo Gioia')
    // salvando i dati così come sono niente viene «congelato»
    await a.chiama('POST', 'checklist', { dati: c.dati })
    mettiIntestazione(a.sim, MINIMARKET)
    c = await a.chiama('GET', 'checklist')
    assert.equal(c.dati.cliente, 'MINIMARKET DI RAZA ALI', 'quello non toccato segue la cassa')
    // il tecnico corregge: la correzione resta, anche se la cassa dice altro
    await a.chiama('POST', 'checklist', { dati: { ...c.dati, cliente: 'MINIMARKET DI RAZA ALI SRL' } })
    mettiIntestazione(a.sim, KAMMOR)
    c = await a.chiama('GET', 'checklist')
    assert.equal(c.dati.cliente, 'MINIMARKET DI RAZA ALI SRL'); assert.equal(c.dati.ubicazione_indirizzo, 'VIA SALVATOR ROSA 76')
    await a.chiama('POST', 'checklist', { dati: { ...c.dati, cliente: '' } })
    assert.equal((await a.chiama('GET', 'checklist')).dati.cliente, '', 'svuotato apposta resta vuoto')
    mettiIntestazione(a.sim, FABBRICA)
    const f = await a.chiama('GET', 'checklist')
    assert.equal(f.dati.ubicazione_indirizzo, ''); assert.match(f.avvisi.join(' '), /fabbrica/)
  } finally { await a.chiudi() }
})

test('CHECK-LIST: la P.IVA dal web server (Status.htm) vince su quella dell\'intestazione', async () => {
  const a = await ambiente({ pivaEsercente: '11142291217' })
  try {
    await a.collega(); mettiIntestazione(a.sim, KAMMOR)
    assert.equal((await a.chiama('GET', 'checklist')).dati.partita_iva, '11142291217')
  } finally { await a.chiudi() }
})

test('I NOMI VECCHI dei campi diventano quelli nuovi, senza perdere ciò che il tecnico aveva scritto', () => {
  assert.deepEqual(migraDati({ esercente: 'KAMMOR SRL', sigillo: 'GED01', azzeramenti: '4', nota: 'x', indirizzo: 'VIA' }), { cliente: 'KAMMOR SRL', tecnico_sigillo: 'GED01', azzeramenti: '4' })
})

test('IL MODULO UFFICIALE da HTTP: bloccato finché mancano campi (e li dice TUTTI), poi il PDF vero, salvato nell\'archivio', async () => {
  const a = await ambiente({ chiusure: 4 })
  try {
    await a.collega(); mettiIntestazione(a.sim, KAMMOR)
    const pdfUrl = a.app.indirizzo + 'api/modulo-ufficiale.pdf'
    let c = await a.chiama('GET', 'checklist')
    assert.equal(c.pdfPronto, false); assert.deepEqual(c.mancano.map((m) => m.campo), ['sigillo_tipo'])
    let r = await fetch(pdfUrl)
    assert.equal(r.status, 409); assert.match(await r.text(), /mancano .*Tipologia del sigillo/)
    await a.chiama('POST', 'checklist', { risposte: { sigillo_tipo: 'percussione' } })
    assert.equal((await a.chiama('GET', 'checklist')).pdfPronto, true)
    r = await fetch(pdfUrl)
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/pdf')
    const pdf = Buffer.from(await r.arrayBuffer()).toString('latin1')
    assert.ok(pdf.startsWith('%PDF-1.7'))
    for (const s of ['(KAMMOR PIZZERIA E FRIGGITORIA DA ALE E MIMMO) Tj', '(STITE350592) Tj', '(GED01) Tj', '(K3F-N) Tj', '(CUSTOM) Tj', '(VIA SALVATOR ROSA 76) Tj', '(11142291217) Tj', '(15.04.05) Tj'])
      assert.ok(pdf.includes(s), 'nel modulo manca ' + s)
    assert.ok(!pdf.includes('GedImg1'), 'senza firma salvata, il riquadro resta vuoto')
    // salvato anche nell'archivio della cassa
    const dir = join(a.dir, 'moduli', 'STITE350592')
    const salvati = readdirSync(dir)
    assert.equal(salvati.length, 1); assert.match(salvati[0], /^STITE350592-VP-\d{12}\.pdf$/)
    assert.ok(readFileSync(join(dir, salvati[0])).equals(Buffer.from(pdf, 'latin1')))
    // con la firma del cliente col dito, l'immagine entra nel suo riquadro
    const png = readFileSync(join(FIRME, 'firma-cliente.png')).toString('base64')
    await a.chiama('POST', 'checklist/firma', { chi: 'cliente', png: 'data:image/png;base64,' + png })
    const conFirma = Buffer.from(await (await fetch(pdfUrl)).arrayBuffer()).toString('latin1')
    assert.ok(conFirma.includes('GedImg1'))
    assert.ok((await a.chiama('GET', 'checklist')).firme.cliente)
    assert.match((await a.chiama('POST', 'checklist/firma', { chi: 'cliente', png: 'data:image/png;base64,AAAA' })).errore, /non si legge/)
    assert.match((await a.chiama('POST', 'checklist/firma', { chi: 'cliente', png: 'ciao' })).errore, /PNG/)
  } finally { await a.chiudi() }
})

test('LA «PAGINA STAMPABILE» NOSTRA NON ESISTE PIÙ: nessun foglio nostro sembra il modulo; l\'appunto lo dice', async () => {
  const a = await ambiente()
  try {
    await a.collega()
    assert.equal((await fetch(a.app.indirizzo + 'api/checklist/stampa')).status, 404)
    const t = await (await fetch(a.app.indirizzo + 'api/checklist/testo')).text()
    assert.match(t, /^APPUNTO PER IL GST — NON È IL MODULO/)
    assert.match(t, /Il documento ufficiale è il PDF/)
    assert.match(t, /Prossimo passo \(non ancora fatto\)/)
  } finally { await a.chiudi() }
})

test('«CONFERMA TUTTE SÌ» è un gesto del tecnico: le proposte diventano sue; le risposte della procedura restano della procedura', async () => {
  const a = await ambiente()
  try {
    await a.collega()
    let c = await a.chiama('GET', 'checklist')
    const fonti = Object.fromEntries(c.righe.flatMap((s) => s.righe).map((r) => [r.numero, r.fonte]))
    assert.equal(fonti['1.1'], 'proposta'); assert.equal(c.precompilata, true)
    assert.equal(c.righe.find((s) => s.ambulanti).righe.every((r) => r.valore === null), true, 'gli ambulanti non si propongono mai')
    c = await a.chiama('POST', 'checklist/conferma-tutte-si')
    const dopo = Object.fromEntries(c.righe.flatMap((s) => s.righe).map((r) => [r.numero, r.fonte]))
    assert.equal(dopo['1.1'], 'tecnico'); assert.equal(c.precompilata, false)
    assert.equal(c.righe.find((s) => s.ambulanti).righe.every((r) => r.valore === null), true)
    // toccare una riga la cambia, e togliere la risposta la riporta alla proposta
    c = await a.chiama('POST', 'checklist', { voci: { '2.5': 'no' } })
    assert.equal(c.risposte.esito, null)
    c = await a.chiama('POST', 'checklist', { voci: { '2.5': '' } })
    assert.equal(c.righe.flatMap((s) => s.righe).find((r) => r.numero === '2.5').fonte, 'proposta')
  } finally { await a.chiudi() }
})

test('FIRMA DEL TECNICO «dal CRM»: caricata una volta, permessi 600, legata al codice fiscale; nel PDF sta dove la mette il CRM', async () => {
  const { statSync } = await import('node:fs')
  const a = await ambiente({ chiusure: 4 })
  try {
    await a.collega(); mettiIntestazione(a.sim, KAMMOR)
    await a.chiama('POST', 'checklist', { risposte: { sigillo_tipo: 'percussione' } })
    const pdfUrl = a.app.indirizzo + 'api/modulo-ufficiale.pdf'
    const senza = Buffer.from(await (await fetch(pdfUrl)).arrayBuffer()).toString('latin1')
    assert.ok(!senza.includes('GedImg1'), 'senza firma il riquadro resta vuoto')
    assert.equal((await a.chiama('GET', 'stato-app')).firmaTecnico, false)
    assert.match((await a.chiama('POST', 'checklist/firma', { chi: 'tecnico', png: 'data:image/png;base64,AAAA' })).errore, /Impostazioni/, 'dalla check-list il tecnico non firma più')
    const png = readFileSync(join(FIRME, 'firma-tecnico.png')).toString('base64')
    assert.match((await a.chiama('POST', 'impostazioni/firma-tecnico', { png: 'data:image/png;base64,AAAA' })).errore, /non si legge/)
    assert.equal((await a.chiama('POST', 'impostazioni/firma-tecnico', { png: 'data:image/png;base64,' + png })).firmaTecnico, true)
    const file = join(a.dir, 'firma-tecnico-GIORLD84C23A024D.png')
    assert.equal(statSync(file).mode & 0o777, 0o600, 'permessi 600')
    // il modulo la usa: stessa immagine, stessa posizione e stessa scala del CRM (il golden è generato dal codice del CRM con la stessa immagine)
    const pdf = Buffer.from(await (await fetch(pdfUrl)).arrayBuffer()).toString('latin1')
    const crm = readFileSync(join(GOLDEN, 'da-strumenti-kammor.pdf')).toString('latin1')
    const operatori = (s) => [...s.matchAll(/q [\d.]+ 0 0 [\d.]+ [\d.]+ [\d.]+ cm \/GedImg1 Do Q/g)].map((m) => m[0])
    assert.ok(operatori(crm).length >= 1)
    assert.deepEqual(operatori(pdf), operatori(crm).slice(0, operatori(pdf).length).length ? operatori(crm).slice(0, 2).filter((_, i) => i < operatori(pdf).length) : [])
    assert.match(pdf, /\/Width 240 \/Height 90/)
    // legata al codice fiscale: cambiato il CF, la firma non è più di questo tecnico
    await a.chiama('POST', 'impostazioni', { tecnico: { cf: 'RSSMRA80A01H501U' } })
    assert.equal((await a.chiama('GET', 'stato-app')).firmaTecnico, false)
    assert.equal((await a.chiama('GET', 'checklist')).firme.tecnico, false)
    // si toglie
    await a.chiama('POST', 'impostazioni', { tecnico: { cf: 'GIORLD84C23A024D' } })
    assert.equal((await a.chiama('POST', 'impostazioni/firma-tecnico', { cancella: true })).firmaTecnico, false)
  } finally { await a.chiudi() }
})
