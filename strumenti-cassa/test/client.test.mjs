import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cassa, ErroreCassa, NessunaRisposta, MatricolaDiversa, ConfermaMancante, IndirizzoNonAmmesso, indirizzoPrivato } from '../lib/cassa.mjs'
import { ComandoNonAmmesso } from '../lib/listabianca.mjs'
import { creaRegistro } from '../lib/registro.mjs'
import { avviaSimulatore } from './k3-sim.mjs'

async function con(opz, f) {
  const sim = await avviaSimulatore(opz)
  const dir = mkdtempSync(join(tmpdir(), 'cassa-cl-'))
  const registro = creaRegistro(dir)
  const cassa = new Cassa({ ip: '127.0.0.1', porta: sim.porta, registro, consentiLoopback: true, timeoutMs: opz?.timeoutMs ?? 2000, attendi: () => Promise.resolve() })
  try { return await f({ sim, cassa, registro }) } finally { await sim.chiudi() }
}

test('solo indirizzi privati: 10., 172.16-31., 192.168.', () => {
  for (const ip of ['10.0.0.5', '172.16.0.1', '172.31.255.1', '192.168.1.45']) assert.equal(indirizzoPrivato(ip), true, ip)
  for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.1.1', '127.0.0.1', '1.2.3', 'cassa.local', '192.168.1.256']) assert.equal(indirizzoPrivato(ip), false, ip)
  assert.throws(() => new Cassa({ ip: '8.8.8.8' }), IndirizzoNonAmmesso)
  assert.throws(() => new Cassa({ ip: '127.0.0.1' }), IndirizzoNonAmmesso)   // il loopback serve solo alle prove, e lo dicono loro
})

test('legge la matricola con 1008 e fa una lettura', () => con({}, async ({ cassa, sim }) => {
  const r = await cassa.sessione(async (s) => ({ m: s.matricola, f: await s.manda('1013') }))
  assert.equal(r.m, 'STITE350592')
  assert.match(r.f, /K3F-N 15\.04\.05/)
  assert.equal(sim.comandi()[0], '1008')
  await new Promise((r) => setTimeout(r, 80))
  assert.ok(sim.acks >= 2, 'ogni risposta va confermata con un ACK')
}))

test('MATRICOLA DIVERSA: non si manda niente a una cassa che non è la nostra', () => con({}, async ({ cassa, sim }) => {
  cassa.matricolaAttesa = 'ALTRA0000001'
  await assert.rejects(cassa.sessione(async (s) => s.manda('1012')), MatricolaDiversa)
  assert.deepEqual(sim.comandi(), ['1008'], 'dopo il 1008 non è partito nient\'altro')
}))

test('un comando che scrive senza conferma NON parte', () => con({}, async ({ cassa, sim }) => {
  await assert.rejects(cassa.sessione(async (s) => s.manda('64040')), ConfermaMancante)
  await assert.rejects(cassa.sessione(async (s) => s.manda('20020'), { conferma: { clic: true } }), ConfermaMancante, 'la chiusura vuole anche la scritta')
  await assert.rejects(cassa.sessione(async (s) => s.manda('2005'), { conferma: { clic: true } }), ConfermaMancante)
  assert.deepEqual(sim.comandi().filter((c) => c !== '1008'), [])
}))

test('LISTA BIANCA: un comando non ammesso viene rifiutato e non arriva alla cassa', () => con({}, async ({ cassa, sim, registro }) => {
  const tutto = { clic: true, scritta: true }
  const vietati = ['3006', '71010', '8007', '64012' + '16GIORLD84C23A024D11073006612170', 'RESET 3', '9999', '7101A0041000127102600']
  for (const c of vietati) await assert.rejects(cassa.sessione(async (s) => s.manda(c), { conferma: tutto }), ComandoNonAmmesso, c)
  assert.deepEqual(sim.comandi(), vietati.map(() => '1008'), 'solo i 1008 d\'apertura')
  assert.equal(sim.trappole.length, 0)
  assert.match(readFileSync(registro.file('STITE350592'), 'utf8'), /NO .*non ammesso/, 'i rifiuti finiscono nel registro')
}))

test('ci si ferma al primo ERR e l\'errore arriva SPIEGATO (ERR54 → chiusura necessaria)', () => con({ chiusuraNecessaria: true, erroreSuRiga: 54 }, async ({ cassa, sim }) => {
  const riga = '3301' + '1' + '000000000' + '001' + '04' + 'PROVA' .slice(0, 4) + '000000111' + '00'
  const e = await cassa.sessione(async (s) => {
    await s.manda(riga)
    await s.manda('3011')
  }, { conferma: { clic: true } }).catch((x) => x)
  assert.ok(e instanceof ErroreCassa)
  assert.equal(e.codice, 54)
  assert.ok(e.spiegato.titolo.length > 3 && e.spiegato.spiegazione.length > 10, 'ha il titolo e la spiegazione del manuale')
  assert.ok(!sim.comandi().includes('3011'), 'dopo l\'errore non è partito il comando successivo')
}))

test('ERR99 → il client legge il 1015 e porta il codice vero (213 = occupata)', () => con({ invioMs: 400 }, async ({ cassa }) => {
  const e = await cassa.sessione(async (s) => { await s.manda('2002'.slice(0, 4) + '0') }, { conferma: { clic: true, scritta: true } }).then(() => null, (x) => x)
  assert.equal(e, null)   // la prima chiusura va
  const e2 = await cassa.sessione(async (s) => s.manda('1515' + '0' + '0012' + '0000')).catch((x) => x)
  assert.ok(e2 instanceof ErroreCassa)
  assert.equal(e2.codice, 213)
  assert.equal(e2.spiegato.azione, 'riprova')
}))

test('UN COMANDO SENZA RISPOSTA non vuol dire «non fatto»: non si rimanda, e si dice che è mutante', () => con({ silenzioSu: '64040', silenzioEseguito: true, timeoutMs: 250 }, async ({ cassa, sim }) => {
  const e = await cassa.sessione(async (s) => s.manda('64040'), { conferma: { clic: true } }).catch((x) => x)
  assert.ok(e instanceof NessunaRisposta)
  assert.equal(e.mutante, true)
  assert.equal(sim.comandi().filter((c) => c === '64040').length, 1, 'il comando è partito UNA volta sola')
}))

test('una lettura senza risposta non è «mutante»', () => con({ silenzioSu: '1012', timeoutMs: 200 }, async ({ cassa }) => {
  const e = await cassa.sessione(async (s) => s.manda('1012')).catch((x) => x)
  assert.ok(e instanceof NessunaRisposta)
  assert.equal(e.mutante, false)
}))

test('il collegamento caduto con un comando che scrive in volo: errore chiaro, nessun rinvio', () => con({}, async ({ cassa, sim }) => {
  sim.guasti.push({ quando: (c) => c === '64040', azione: 'cade', eseguito: true })
  const e = await cassa.sessione(async (s) => s.manda('64040'), { conferma: { clic: true } }).catch((x) => x)
  assert.equal(e.name, 'ConnessioneCaduta')
  assert.equal(e.mutante, true)
  assert.equal(sim.comandi().filter((c) => c === '64040').length, 1)
}))

test('una sessione alla volta per cassa: due lavori insieme non si sovrappongono', () => con({}, async ({ cassa, sim }) => {
  const a = cassa.sessione(async (s) => { await s.manda('1012'); await new Promise((r) => setTimeout(r, 80)); await s.manda('1012'); return 'a' })
  const b = cassa.sessione(async (s) => { await s.manda('1104'); return 'b' })
  assert.deepEqual(await Promise.all([a, b]), ['a', 'b'])
  assert.deepEqual(sim.comandi(), ['1008', '1012', '1012', '1008', '1104'])
}))

test('il registro scrive ogni comando e ogni risposta, con l\'ora italiana', () => con({}, async ({ cassa, registro }) => {
  await cassa.sessione(async (s) => { await s.manda('1104') })
  const t = readFileSync(registro.file('STITE350592'), 'utf8')
  assert.match(t, /^\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d +MANDO +1008$/m)
  assert.match(t, /RISP +1008STITE350592/)
  assert.match(t, /MANDO +1104/)
  assert.match(t, /RISP +1104001100?0?/)
}))
