import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { creaArchivio } from '../lib/archivio.mjs'
import { avvia } from '../server.mjs'
import { ambiente } from './aiuto.mjs'

function archivioFinto() {
  const dir = mkdtempSync(join(tmpdir(), 'cassa-elenco-'))
  writeFileSync(join(dir, 'cassa-AAA111.json'), JSON.stringify({ profilo: 'flatpay', spunte: { fpu019: true }, checklist: { dati: { esercente: 'BAR ROMA' }, spunte: { '1.1': true }, auto: { '2.2': { ok: true } } }, nota: 'Restano 019 e 910', ip: '192.168.1.45' }))
  writeFileSync(join(dir, 'AAA111.log'), '26/10/2026 09:00:00  MANDO  1008\n27/10/2026 12:59 [importato] altra riga\n')
  writeFileSync(join(dir, 'cassa-BBB222.json'), JSON.stringify({ profilo: 'mooney', checklist: { dati: {} } }))
  writeFileSync(join(dir, 'BBB222.log'), '28/10/2026 08:15:01  MANDO  1008\n')
  writeFileSync(join(dir, 'cassa-CCC333.json'), '{ rotto')
  writeFileSync(join(dir, 'impostazioni.json'), '{}')
  writeFileSync(join(dir, 'cassa-no spazi.json'), '{}')
  return dir
}

test('CASSE PREPARATE: elenco dall\'archivio, la più recente per prima, nota letta, file strani ignorati', () => {
  const dir = archivioFinto()
  try {
    const e = creaArchivio(dir).elenco()
    assert.deepEqual(e.map((x) => x.matricola), ['BBB222', 'AAA111', 'CCC333'])
    const a = e.find((x) => x.matricola === 'AAA111')
    assert.equal(a.profilo, 'flatpay'); assert.equal(a.esercente, 'BAR ROMA'); assert.equal(a.nota, 'Restano 019 e 910')
    assert.equal(a.ultimaAttivita, '27/10/2026 12:59'); assert.equal(a.ip, '192.168.1.45')
    assert.equal(a.spuntate, 2); assert.equal(a.righeVerificate, 1)
    assert.equal(e.find((x) => x.matricola === 'BBB222').ultimaAttivita, '28/10/2026 08:15')
    assert.equal(e.find((x) => x.matricola === 'CCC333').profilo, 'diretto', 'un file rotto non ferma l\'elenco')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('CASSE PREPARATE: la pagina funziona SENZA cassa collegata, la scheda è in sola lettura e non tocca la cassa', async () => {
  const dir = archivioFinto()
  const app = await avvia({ cartella: dir })
  try {
    const call = async (m, n, b) => (await fetch(app.indirizzo + 'api/' + n, { method: m, headers: { 'content-type': 'application/json', 'x-strumenti-cassa': '1' }, body: m === 'POST' ? JSON.stringify(b ?? {}) : undefined })).json()
    const r = await call('GET', 'casse')
    assert.equal(r.collegata, null); assert.equal(r.casse.length, 3)
    const s = await call('GET', 'casse/scheda?matricola=AAA111')
    assert.equal(s.nomeProfilo, 'Flatpay'); assert.equal(s.dati.esercente, 'BAR ROMA'); assert.equal(s.registro.length, 2)
    assert.ok(Array.isArray(s.righe))
    assert.match((await call('GET', 'casse/scheda?matricola=../x')).errore, /sconosciuta/)
    assert.match((await call('GET', 'casse/scheda?matricola=ZZZ999')).errore, /sconosciuta/)
    await call('POST', 'casse/nota', { matricola: 'AAA111', nota: 'Fatto tutto' })
    assert.equal((await call('GET', 'casse')).casse.find((x) => x.matricola === 'AAA111').nota, 'Fatto tutto')
    assert.match((await call('POST', 'casse/nota', { matricola: 'NOPE', nota: 'x' })).errore, /sconosciuta/)
  } finally { await app.chiudi(); rmSync(dir, { recursive: true, force: true }) }
})

test('CASSE PREPARATE: collegando una cassa, l\'IP si ricorda e la cassa entra nell\'elenco col tasto «Collega»', async () => {
  const a = await ambiente()
  try {
    await a.collega()
    await a.chiama('POST', 'profilo', { profilo: 'flatpay' })
    const e = (await a.chiama('GET', 'casse')).casse
    assert.equal(e.length, 1)
    assert.equal(e[0].matricola, 'STITE350592'); assert.equal(e[0].profilo, 'flatpay'); assert.equal(e[0].ip, '127.0.0.1')
    assert.ok(e[0].ultimaAttivita)
  } finally { await a.chiudi() }
})
