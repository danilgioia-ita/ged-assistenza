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

// ---- dalla revisione del 4/11: i travestimenti, i PDF a più flussi, i messaggi e i nomi dei file ----
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { ibanValido } from './guardia.mjs'

const tipiIn = (testo, a = vuoti()) => cercaNelTesto(testo, a).map(t => t.tipo)

test('i travestimenti: spazi, punti, trattini, minuscole, [at], spazi invisibili', () => {
  const spaziata = PIVA.slice(0, 3) + ' ' + PIVA.slice(3, 7) + ' ' + PIVA.slice(7)
  assert.ok(tipiIn(`piva ${spaziata}`).includes('partita IVA'))
  assert.ok(tipiIn(`piva ${PIVA.split('').join('.')}`).includes('partita IVA'))
  assert.ok(tipiIn(`cf ${CF.slice(0, 6)}-${CF.slice(6, 11)}-${CF.slice(11)}`).includes('codice fiscale'))
  assert.ok(tipiIn(`cf ${CF.slice(0, 8)}​${CF.slice(8)}`).includes('codice fiscale'))
  assert.ok(tipiIn(`matricola ${MATRICOLA.toLowerCase()}`).includes('matricola RT'))
  assert.ok(tipiIn(`scrivi a ${PEC.replace('@', ' [at] ')}`).includes('email o PEC'))
  assert.ok(tipiIn(`scrivi a ${PEC.replace('@', '&#64;')}`).includes('email o PEC'))
})

test('IBAN a gruppi di quattro e di altri paesi, col controllo mod-97', () => {
  const aGruppi = IBAN.match(/.{1,4}/g).join(' ')
  assert.ok(ibanValido(IBAN))
  assert.ok(tipiIn(`iban ${aGruppi}`).includes('IBAN'))
  assert.equal(ibanValido(IBAN.slice(0, -1) + ((Number(IBAN.at(-1)) + 1) % 10)), false)
})

test('«Icon@2x.png» non è un\'email', () => {
  assert.deepEqual(tipiIn('Icon-App-20x20@2x.png'), [])
})

test('un valore dichiarato con l\'impronta passa senza essere scritto in chiaro', () => {
  const a = vuoti()
  a.impronte = new Set([createHash('sha256').update(PIVA).digest('hex')])
  assert.deepEqual(tipiIn(`C.F. e P.IVA: ${PIVA}`, a), [])
})

function pdfConFlussi(testi) {
  let corpo = '%PDF-1.4\n'
  const parti = [Buffer.from(corpo)]
  testi.forEach((t, i) => {
    const f = deflateSync(Buffer.from(t))
    parti.push(Buffer.from(`${i + 1} 0 obj << /Filter /FlateDecode /Length ${f.length} >>\nstream\n`), f, Buffer.from('\nendstream\nendobj\n'))
  })
  parti.push(Buffer.from('%%EOF\n'))
  return Buffer.concat(parti)
}

test('PDF a più flussi: il dato si vede anche nel secondo, nel terzo e nel quarto', () => {
  for (let n = 2; n <= 4; n++) {
    const testi = Array.from({ length: n }, (_, i) => i === n - 1 ? `BT [(P.IVA ${PIVA.slice(0, 5)})-20(${PIVA.slice(5)})] TJ ET` : 'BT (niente) Tj ET')
    const esiti = controllaContenuto('m.pdf', pdfConFlussi(testi), null, vuoti())
    assert.ok(esiti.some(e => e.tipo === 'partita IVA'), `flusso ${n} di ${n}`)
  }
})

test('PDF: stringhe esadecimali ed escape ottali', () => {
  const esa = '<' + Buffer.from(`P.IVA ${PIVA}`).toString('hex') + '>'
  assert.ok(controllaContenuto('m.pdf', pdfConFlussi([`BT ${esa} Tj ET`]), null, vuoti()).some(e => e.tipo === 'partita IVA'))
  const ottale = PIVA.split('').map(c => '\\' + c.charCodeAt(0).toString(8)).join('')
  assert.ok(controllaContenuto('m.pdf', pdfConFlussi([`BT (${ottale}) Tj ET`]), null, vuoti()).some(e => e.tipo === 'partita IVA'))
})

test('nel repository: messaggio del commit e nome del file vengono guardati, e i valori escono mascherati', () => {
  const guardia = join(dirname(fileURLToPath(import.meta.url)), 'guardia.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'guardia-'))
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' }).toString()
  try {
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 'prova@example.com'); g('config', 'user.name', 'Prova')
    writeFileSync(join(dir, 'pulito.txt'), 'niente\n'); g('add', '.'); g('commit', '-q', '-m', 'primo')
    const base = g('rev-parse', 'HEAD').trim()
    writeFileSync(join(dir, 'altro.txt'), 'niente\n'); g('add', '.'); g('commit', '-q', '-m', `cliente con piva ${PIVA}`)
    writeFileSync(join(dir, `scontrino-${CF}.txt`), 'niente\n'); g('add', '.'); g('commit', '-q', '-m', 'file')
    let uscita = ''
    try { execFileSync('node', [guardia, '--ammessi', '/dev/null', '--range', `${base}..HEAD`], { cwd: dir, stdio: 'pipe' }); assert.fail('doveva bloccare') } catch (e) { uscita = e.stderr.toString(); assert.equal(e.status, 1) }
    assert.match(uscita, /messaggio del commit/)
    assert.match(uscita, /nome di un file/)
    assert.ok(!uscita.includes(PIVA) && !uscita.includes(CF), 'mai in chiaro')
    // un intervallo vuoto con --almeno-uno è un errore, non un «pulito»
    try { execFileSync('node', [guardia, '--almeno-uno', '--range', 'HEAD..HEAD'], { cwd: dir, stdio: 'pipe' }); assert.fail('doveva bloccare') } catch (e) { assert.equal(e.status, 2) }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
