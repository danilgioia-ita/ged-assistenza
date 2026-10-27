import test from 'node:test'
import assert from 'node:assert/strict'
import { checksum, costruisciFrame, leggiFrame, erroreDelPayload, STX, ETX, ACK, NAK } from '../lib/protocollo.mjs'

test('il checksum torna sui frame VERI della cassa (22/10 e 27/10)', () => {
  // le risposte registrate: corpo → KK. Se la formula sbagliasse, queste non tornerebbero.
  assert.equal(checksum('0202005'), '45')            // 2005 fiscalizzazione accettata
  assert.equal(checksum('010100896IKN025881'), '95') // 1008 + matricola (Renella)
  assert.equal(checksum('030151500041000003694749642          '), '90') // 1515, chiusura 41 inviata
  assert.equal(checksum('0302006'), '47')            // 2006 test memorie (… 2006 → '030200647')
})

test('il frame è STX CC 0 comando KK ETX', () => {
  const f = costruisciFrame(7, '1008')
  assert.equal(f[0], STX)
  assert.equal(f[f.length - 1], ETX)
  assert.equal(f.subarray(1, -1).toString('ascii'), '0701008' + checksum('0701008'))
})

test('si legge una risposta vera: ACK + frame con checksum giusto', () => {
  // 1008 -> b'\x06\x02010100896IKN02588195\x03'  (K3 di Renella, 22/10)
  const r = leggiFrame(Buffer.from('\x06\x02010100896IKN02588195\x03', 'latin1'))
  assert.equal(r.tipo, 'frame')
  assert.equal(r.frame.payload, '100896IKN025881')
  assert.equal(r.frame.contatore, 1)
})

test('un frame con il checksum sbagliato NON si esegue: è «storto»', () => {
  const r = leggiFrame(Buffer.from('\x06\x02010100896IKN02588100\x03', 'latin1'))
  assert.equal(r.tipo, 'storto')
  assert.match(r.motivo, /checksum/)
})

test('manca l\'ETX: incompleto · un NAK al posto della risposta: nak', () => {
  assert.equal(leggiFrame(Buffer.from([STX, 0x30, 0x31])).tipo, 'incompleto')
  assert.equal(leggiFrame(Buffer.from([NAK])).tipo, 'nak')
  assert.equal(leggiFrame(Buffer.from([ACK])).tipo, 'incompleto')
})

test('gli errori: ERRnn e 1015ERRnnn', () => {
  assert.deepEqual(erroreDelPayload('ERR54'), { codice: 54, da1015: false })
  assert.deepEqual(erroreDelPayload('1015ERR213'), { codice: 213, da1015: true })
  assert.equal(erroreDelPayload('1015ERR000').codice, 0)
  assert.equal(erroreDelPayload('1008STITE350592'), null)
})

test('un comando non ASCII non diventa un frame', () => {
  assert.throws(() => costruisciFrame(1, '6302è'), /ASCII/)
})
