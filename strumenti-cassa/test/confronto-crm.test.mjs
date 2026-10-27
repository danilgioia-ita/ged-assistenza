// IL PDF DEGLI STRUMENTI CASSA È IDENTICO A QUELLO DEL CRM.
//
// I file in fixtures/crm/golden/ li ha generati il codice PHP VERO del CRM (ModuloUfficiale + ScrittorePdf + LettorePdf, lette dal
// suo albero senza cambiare una riga: vedi confronto-crm/genera-crm.php) con gli STESSI dati degli scenari in fixtures/crm/scenari/.
// Qui la porta Node li rigenera e li confronta BYTE PER BYTE. Se il confronto è rosso, i due moduli non sono più lo stesso modulo.
// Per rigenerare i golden (solo se cambia il CRM): vedi il LEGGIMI.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { generaModulo, leggiModulo, CARTELLA_MODULI, FILE_10_2, FILE_10_3, fmt } from '../lib/pdf/modulo.mjs'
import { LettorePdf } from '../lib/pdf/lettore.mjs'

const QUI = new URL('.', import.meta.url).pathname
const SCENARI = join(QUI, 'fixtures/crm/scenari'), GOLDEN = join(QUI, 'fixtures/crm/golden'), FIRME = join(QUI, 'fixtures/crm/firme')
const firma = (p) => (existsSync(join(FIRME, p)) ? readFileSync(join(FIRME, p)) : null)
const scenari = readdirSync(SCENARI).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))

function primaDifferenza(a, b) { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i; return a.length === b.length ? -1 : n }

for (const nome of scenari) {
  test(`CRM = Strumenti cassa, byte per byte: ${nome}`, () => {
    const s = JSON.parse(readFileSync(join(SCENARI, nome + '.json'), 'utf8'))
    const mio = generaModulo(s, { firma })
    const crm = readFileSync(join(GOLDEN, nome + '.pdf'))
    const i = primaDifferenza(mio, crm)
    assert.equal(i, -1, `il PDF differisce dal CRM al byte ${i}: «${mio.subarray(Math.max(0, i - 60), i + 60).toString('latin1')}» contro «${crm.subarray(Math.max(0, i - 60), i + 60).toString('latin1')}»`)
    assert.equal(createHash('sha256').update(mio).digest('hex'), createHash('sha256').update(crm).digest('hex'))
  })
}

test('gli avvisi di troncamento sono gli stessi del CRM', () => {
  // il CRM scrive l'avviso quando il testo non entra: nel caso difficile deve esserci, e uguale
  const s = JSON.parse(readFileSync(join(SCENARI, 'testi-difficili.json'), 'utf8'))
  const crm = JSON.parse(readFileSync(join(GOLDEN, 'testi-difficili.avvisi.json'), 'utf8'))
  assert.ok(crm.length >= 1, 'lo scenario difficile deve davvero troncare qualcosa')
  const avvisi = []
  generaModulo(s, { firma, avvisi: (a) => avvisi.push(...a) })
  assert.deepEqual(avvisi, crm)
})

test('le pagine originali restano INTATTE: i flussi del modulo depositato sono copiati byte per byte', () => {
  const lettore = LettorePdf.daBuffer(readFileSync(join(CARTELLA_MODULI, FILE_10_2)))
  const originale = lettore.pagine().map((rif) => lettore.risolvi(lettore.risolvi(rif)[1].get('Contents')))
  const s = JSON.parse(readFileSync(join(SCENARI, 'kammor-102.json'), 'utf8'))
  const pdf = generaModulo(s, { firma }).toString('latin1')
  // ogni flusso di disegno della pagina originale compare, intero, nel PDF compilato
  let controllati = 0
  for (const c of originale) {
    const flussi = c[0] === 'A' ? c[1].map((r) => lettore.risolvi(r)) : [c]
    for (const f of flussi) { if (f[0] === 'T' && f[2].length > 200) { assert.ok(pdf.includes(f[2]), 'un flusso del modulo originale è stato alterato'); controllati++ } }
  }
  assert.ok(controllati >= 2)
})

test('IMPRONTE: un PDF diverso dall\'originale depositato viene RIFIUTATO', () => {
  // copia la cartella dei moduli, altera un byte, e prova a generare puntando lì
  const ok = createHash('sha256').update(readFileSync(join(CARTELLA_MODULI, FILE_10_2))).digest('hex')
  const imp = JSON.parse(readFileSync(join(CARTELLA_MODULI, 'IMPRONTE.json'), 'utf8'))
  assert.equal(imp[FILE_10_2], ok)
  assert.equal(imp[FILE_10_3], createHash('sha256').update(readFileSync(join(CARTELLA_MODULI, FILE_10_3))).digest('hex'))
  const dir = mkdtempSync(join(tmpdir(), 'moduli-'))
  try {
    for (const f of [FILE_10_2, FILE_10_3, 'IMPRONTE.json']) copyFileSync(join(CARTELLA_MODULI, f), join(dir, f))
    const buf = readFileSync(join(dir, FILE_10_2)); buf[buf.length - 20] ^= 1
    writeFileSync(join(dir, FILE_10_2), buf)
    assert.throws(() => leggiModulo(FILE_10_2, dir), /non è quello depositato/)
    assert.doesNotThrow(() => leggiModulo(FILE_10_3, dir))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('«%.2F» come PHP: i pareggi esatti vanno alla cifra pari', () => {
  assert.equal(fmt(0.125, 2), '0.12'); assert.equal(fmt(0.375, 2), '0.38'); assert.equal(fmt(2.675, 2), '2.67'); assert.equal(fmt(747.42, 2), '747.42')
})
