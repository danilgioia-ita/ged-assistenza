// Prove della guardia dei dati veri. I valori «veri» qui si COSTRUISCONO al volo (cifra di controllo calcolata),
// così questo file non contiene niente che la guardia stessa debba bloccare. Ogni prova rossa si è vista fallire
// togliendo il riconoscitore corrispondente.
//   node --test tools/guardia-dati-veri/guardia.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { cfValido, pivaValida, cercaNelTesto, controllaContenuto, leggiAmmessi, maschera } from './guardia.mjs'

const vuoti = () => ({ valori: new Set(), domini: new Set(['example.com']), binari: new Set() })

function conControlloPiva(dieci) {
  for (let c = 0; c <= 9; c++) if (pivaValida(dieci + c)) return dieci + c
}
function conControlloCf(quindici) {
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (cfValido(quindici + c)) return quindici + c
}

const PIVA = conControlloPiva('0123456789'.slice(0, 7) + '063')
const CF = conControlloCf('RSSMRA80A01H501')
const MATRICOLA = ['99', 'ABC', '012345'].join('')
const PEC = ['negozio', 'pec.vero-dominio.it'].join('@')
const TELEFONO = ['+39', '333', '1234567'].join(' ')
const IBAN = ['IT60X', '0542811101', '000000123456'].join('')

test('i valori costruiti sono validi, e uno sbagliato no', () => {
  assert.ok(PIVA && pivaValida(PIVA))
  assert.ok(CF && cfValido(CF))
  const sbagliata = PIVA.slice(0, 10) + ((Number(PIVA[10]) + 1) % 10)
  assert.equal(pivaValida(sbagliata), false)
  assert.equal(pivaValida('0'.repeat(11)), false)
})

test('trova P.IVA, codice fiscale, matricola, PEC, cellulare, IBAN', () => {
  const testo = `piva ${PIVA} cf ${CF.toLowerCase()} matricola ${MATRICOLA} pec ${PEC} tel ${TELEFONO} iban ${IBAN}`
  const tipi = cercaNelTesto(testo, vuoti()).map(t => t.tipo).sort()
  assert.deepEqual(tipi, ['IBAN', 'cellulare', 'codice fiscale', 'email o PEC', 'matricola RT', 'partita IVA'])
})

test('lascia passare ciò che è dichiarato o palesemente finto', () => {
  const a = vuoti()
  a.valori.add(PIVA)
  const testo = `piva ${PIVA} matricola 99ZZZ000001 mail prova@example.com sotto x@pec.example.com`
  assert.deepEqual(cercaNelTesto(testo, a), [])
})

test('un numero di 11 cifre con controllo sbagliato non è una P.IVA', () => {
  const sbagliata = PIVA.slice(0, 10) + ((Number(PIVA[10]) + 3) % 10)
  assert.deepEqual(cercaNelTesto(`x ${sbagliata} y`, vuoti()), [])
})

test('nel file guarda solo le righe aggiunte quando gli si dice quali', () => {
  const buf = Buffer.from(`riga uno ${PIVA}\nriga due pulita\n`)
  assert.equal(controllaContenuto('a.json', buf, new Set([2]), vuoti()).length, 0)
  assert.equal(controllaContenuto('a.json', buf, new Set([1]), vuoti()).length, 1)
  assert.equal(controllaContenuto('a.json', buf, null, vuoti()).length, 1)
})

test('un\'immagine nuova blocca finché la sua impronta non è dichiarata', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])
  const esiti = controllaContenuto('firma.png', png, null, vuoti())
  assert.equal(esiti.length, 1)
  const a = vuoti()
  a.binari.add(esiti[0].valore)
  assert.equal(controllaContenuto('firma.png', png, null, a).length, 0)
})

test('legge il testo dentro un PDF compresso, anche se l\'impronta è ammessa', () => {
  const flusso = deflateSync(Buffer.from(`BT (Partita IVA ${PIVA}) Tj ET`))
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj << /Filter /FlateDecode >>\nstream\n'), flusso, Buffer.from('\nendstream\nendobj\n%%EOF\n')])
  const a = vuoti()
  const esiti = controllaContenuto('modulo.pdf', pdf, null, a)
  assert.ok(esiti.some(e => e.tipo === 'partita IVA'))
  a.binari.add(esiti.find(e => e.tipo.startsWith('file binario')).valore)
  assert.ok(controllaContenuto('modulo.pdf', pdf, null, a).some(e => e.tipo === 'partita IVA'))
})

test('i valori escono mascherati', () => {
  const m = maschera(PIVA)
  assert.ok(!m.includes(PIVA.slice(2, 9)))
  assert.equal(m.length, PIVA.length)
})

test('ammessi.txt del repository si legge senza errori', () => {
  const a = leggiAmmessi()
  assert.ok(a.domini.has('example.com'))
})
