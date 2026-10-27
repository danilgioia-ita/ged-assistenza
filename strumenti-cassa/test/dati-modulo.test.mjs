import test from 'node:test'
import assert from 'node:assert/strict'
import { deduciDaIntestazione, baseDaCassa } from '../lib/checklist.mjs'
import { ambiente } from './aiuto.mjs'

const KAMMOR = ['KAMMOR', 'PIZZERIA E FRIGGITORIA', 'DA ALE E MIMMO', 'VIA SALVATOR ROSA 76', 'NAPOLI 80135', 'PI 11130901215', '', '', '']
const MINIMARKET = ['MINIMARKET', 'DI RAZA ALI', 'VIA SALVATOR ROSA 71', '80135 NAPOLI', 'P.IVA 11142291217', '', '', '', '']
const FABBRICA = ['K3F-N', 'CUSTOM SPA', 'Via I. Newton, 4', '43010 Fontevivo (PR)', '', '', '', '', '']
const imp = { tecnico: { cf: 'GIORLD84C23A024D' }, laboratorio: { piva: '07300661217' } }
const mettiIntestazione = (sim, righe) => righe.forEach((t, i) => { sim.intestazione[i] = { tipo: 1, testo: t } })

test('DEDUZIONE dall\'intestazione: le due intestazioni VERE', () => {
  assert.deepEqual(deduciDaIntestazione(KAMMOR), { esercente: 'KAMMOR / PIZZERIA E FRIGGITORIA / DA ALE E MIMMO', indirizzo: 'VIA SALVATOR ROSA 76, NAPOLI 80135', piva: '11130901215', fabbrica: false })
  assert.deepEqual(deduciDaIntestazione(MINIMARKET), { esercente: 'MINIMARKET / DI RAZA ALI', indirizzo: 'VIA SALVATOR ROSA 71, 80135 NAPOLI', piva: '11142291217', fabbrica: false })
})

test('DEDUZIONE: l\'intestazione di FABBRICA non diventa l\'esercente: resta vuoto e compare l\'avviso', () => {
  assert.deepEqual(deduciDaIntestazione(FABBRICA), { esercente: '', indirizzo: '', piva: '', fabbrica: true })
  const b = baseDaCassa({ matricola: 'M1', righe: FABBRICA, chiusure: 3, impostazioni: imp })
  assert.equal(b.base.esercente, ''); assert.equal(b.base.indirizzo, '')
  assert.match(b.avvisi[0], /Intestazione di fabbrica/)
  assert.equal(b.base.matricola, 'M1'); assert.equal(b.base.azzeramenti, '3'); assert.equal(b.base.tecnicoCF, 'GIORLD84C23A024D'); assert.equal(b.base.labPIVA, '07300661217')
})

test('DEDUZIONE: altre forme di via, il telefono non è esercente, la P.IVA del web server vince su quella della riga', () => {
  assert.equal(deduciDaIntestazione(['BAR SOLE', 'V.LE DELLE TERME 3', '80100 NAPOLI (NA)', 'TEL 0815551234', 'C.F. 11142291217']).indirizzo, 'V.LE DELLE TERME 3, 80100 NAPOLI (NA)')
  assert.equal(deduciDaIntestazione(['BAR SOLE', 'TEL 0815551234']).esercente, 'BAR SOLE')
  const b = baseDaCassa({ matricola: 'M', righe: KAMMOR, webPiva: '99999999999', impostazioni: imp })
  assert.equal(b.base.pivaEsercente, '99999999999')
  assert.equal(baseDaCassa({ matricola: 'M', righe: KAMMOR, webPiva: '---', impostazioni: imp }).base.pivaEsercente, '11130901215')
})

test('CHECK-LIST dalla cassa: i dati si precompilano, una correzione del tecnico non si sovrascrive', async () => {
  const a = await ambiente({ chiusure: 3, webDown: true })
  try {
    await a.collega()
    mettiIntestazione(a.sim, KAMMOR)
    let c = await a.chiama('GET', 'checklist')
    assert.equal(c.dati.matricola, 'STITE350592')
    assert.equal(c.dati.esercente, 'KAMMOR / PIZZERIA E FRIGGITORIA / DA ALE E MIMMO')
    assert.equal(c.dati.indirizzo, 'VIA SALVATOR ROSA 76, NAPOLI 80135')
    assert.equal(c.dati.pivaEsercente, '11130901215', 'web server muto: la P.IVA viene dalla riga d\'intestazione')
    assert.equal(c.dati.azzeramenti, '3')
    assert.equal(c.dati.tecnicoCF, 'GIORLD84C23A024D'); assert.equal(c.dati.labPIVA, '07300661217')
    assert.deepEqual(c.avvisi, [])
    // il tecnico salva i dati così come sono: niente viene «congelato»
    await a.chiama('POST', 'checklist', { dati: c.dati })
    mettiIntestazione(a.sim, MINIMARKET)
    c = await a.chiama('GET', 'checklist')
    assert.equal(c.dati.esercente, 'MINIMARKET / DI RAZA ALI', 'quello non toccato segue la cassa')
    // il tecnico corregge l'esercente: la correzione resta, anche se la cassa dice altro
    await a.chiama('POST', 'checklist', { dati: { ...c.dati, esercente: 'MINIMARKET DI RAZA ALI SRL' } })
    mettiIntestazione(a.sim, KAMMOR)
    c = await a.chiama('GET', 'checklist')
    assert.equal(c.dati.esercente, 'MINIMARKET DI RAZA ALI SRL')
    assert.equal(c.dati.indirizzo, 'VIA SALVATOR ROSA 76, NAPOLI 80135')
    // e se lo svuota apposta, resta vuoto
    await a.chiama('POST', 'checklist', { dati: { ...c.dati, esercente: '' } })
    assert.equal((await a.chiama('GET', 'checklist')).dati.esercente, '')
    // fabbrica: esercente vuoto e avviso
    mettiIntestazione(a.sim, FABBRICA)
    const f = await a.chiama('GET', 'checklist')
    assert.equal(f.dati.indirizzo, ''); assert.match(f.avvisi[0], /fabbrica/)
  } finally { await a.chiudi() }
})

test('CHECK-LIST: la P.IVA dal web server (Status.htm) vince su quella dell\'intestazione', async () => {
  const a = await ambiente({ pivaEsercente: '11142291217' })
  try {
    await a.collega()
    mettiIntestazione(a.sim, KAMMOR)
    assert.equal((await a.chiama('GET', 'checklist')).dati.pivaEsercente, '11142291217')
  } finally { await a.chiudi() }
})

test('CORRISPETTIVI: se il web server tace si usano le ricevute 1515; «fallito» è rosso', async () => {
  const a = await ambiente({ chiusure: 5, webDown: true, invioMs: 1 })
  try {
    await a.collega()
    await new Promise((r) => setTimeout(r, 30))
    let s = await a.chiama('GET', 'cassa')
    let c = s.spie.find((x) => x.id === 'corrispettivi')
    assert.equal(c.colore, 'v', JSON.stringify(c)); assert.match(c.nota, /1515/)
    a.sim.imposta({ statoInvio: 1 })
    s = await a.chiama('GET', 'cassa')
    c = s.spie.find((x) => x.id === 'corrispettivi')
    assert.equal(c.colore, 'r'); assert.match(c.valore, /fallito/)
  } finally { await a.chiudi() }
})

test('PROSSIMA VERIFICA: il campo parte compilato con oggi + 24 mesi, la P601 mostra la stessa data, e non si lascia vuoto', async () => {
  const a = await ambiente({ chiusure: 11 }, { adesso: () => new Date('2026-10-27T10:00:00Z') })
  try {
    await a.collega()
    await a.chiama('POST', 'procedura/avvia', { id: 'vp' })
    const p = await a.chiama('GET', 'procedura')
    const m = p.passi.find((x) => x.id === 'memorie'), p601 = p.passi.find((x) => x.id === 'p601')
    assert.deepEqual(m.predefiniti, { mm: '10', aa: '28' })
    assert.match(p601.istruzioni.join(' '), /27\/10\/2028/)
    assert.equal(m.anteprima[0], '20061028')
  } finally { await a.chiudi() }
})

test('PROSSIMA VERIFICA vuota: il passo lo dice e non manda 2006', async () => {
  const { ambiente: amb } = await import('./aiuto.mjs')
  const a = await amb({ chiusure: 11 })
  try {
    await a.collega()
    await a.chiama('POST', 'procedura/avvia', { id: 'vp' })
    // porto la procedura al passo «memorie» con la stessa sequenza del test della VP
    const input = { 1: { conferma: true, scritta: 'CHIUSURA' }, 3: { conferma: true }, 4: { conferma: true }, 5: { conferma: true, scritta: 'CHIUSURA' }, 7: { conferma: true }, 8: { conferma: true } }
    for (let i = 0; i < 10; i++) await a.passo(i, input[i] || {})
    for (const mmaa of [{}, { mm: '', aa: '' }, { mm: '10' }]) {
      const r = await a.passo(10, { conferma: true, ...mmaa })
      assert.equal(r.passi[10].stato, 'errore')
      assert.match(r.passi[10].errore.messaggio, /scrivi mese e anno/)
    }
    assert.ok(!a.sim.comandi().some((c) => c.startsWith('2006')))
    const r = await a.passo(10, { conferma: true, mm: '10', aa: '27' })
    assert.equal(r.passi[10].stato, 'ok')
  } finally { await a.chiudi() }
})

test('VP con il web server muto: la rilettura finale usa la ricevuta 1515 dell\'ultima chiusura', async () => {
  const a = await ambiente({ chiusure: 11, webDown: true })
  try {
    await a.collega()
    await a.chiama('POST', 'procedura/avvia', { id: 'vp' })
    const input = { 1: { conferma: true, scritta: 'CHIUSURA' }, 3: { conferma: true }, 4: { conferma: true }, 5: { conferma: true, scritta: 'CHIUSURA' }, 7: { conferma: true }, 8: { conferma: true }, 10: { conferma: true, mm: '10', aa: '28' }, 11: { conferma: true } }
    let r
    for (let i = 0; i < 13; i++) r = await a.passo(i, input[i] || {})
    assert.equal(r.passi[12].stato, 'ok', JSON.stringify(r.passi[12]))
    assert.match(r.passi[12].esito, /ricevuta 1515/)
  } finally { await a.chiudi() }
})
