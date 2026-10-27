import test from 'node:test'
import assert from 'node:assert/strict'
import { classifica, ComandoNonAmmesso } from '../lib/listabianca.mjs'

const rifiuta = (c, re) => assert.throws(() => classifica(c), (e) => e instanceof ComandoNonAmmesso && (!re || re.test(e.message)), `doveva essere rifiutato: ${c}`)

test('le richieste dati passano come lettura', () => {
  for (const c of ['1008', '1013', '1511', '15111', '1512', '1001', '1106', '1104', '1012', '1017', '1002' + 3, '7112' + '04', '6801', '1023', '1214', '1515000410000', '8008', '1015'])
    assert.equal(classifica(c).tipo, 'lettura', c)
})

test('i comandi che scrivono sono «scrittura», e fiscalizzazione e chiusura vogliono la scritta', () => {
  assert.equal(classifica('20020').livello, 'scritta')
  assert.equal(classifica('2005').livello, 'scritta')
  assert.equal(classifica('63031').livello, 'clic')
  assert.equal(classifica('2001' + '2710261420').livello, 'clic')
  assert.equal(classifica('7101A004100012710268').livello, 'clic')
  assert.equal(classifica('8002271026000100040').livello, 'clic')
})

test('3006 NON passa mai (non chiama il POS e segna pagato con carta senza addebito)', () => {
  rifiuta('3006', /POS/)
  rifiuta('30060100', /3006/)
})

test('7101 con OPER 0 NON passa (farebbe stampare una lettura)', () => {
  rifiuta('71010')
  rifiuta('7101A00410001271026' + '0', /OPER 0/)
  rifiuta('7101A0041000127102600', /lettura/)
  rifiuta('7101' + '1')
})

test('niente RESET, HW-INIT, firmware, 8007, e niente 6401 (chiave, censimento, attivazione restano guidati)', () => {
  for (const c of ['RESET 3', 'HW-INIT', 'FW-UPGRADE', 'FIRMWARE']) rifiuta(c)
  rifiuta('8007', /fiscalizzazione la fa già/)
  rifiuta('64011', /guidati/)
  rifiuta('64012' + '16GIORLD84C23A024D' + '11' + '07300661217', /guidati/)
  rifiuta('64013' + '16GIORLD84C23A024D' + '11' + '07300661217' + '11' + '06261261215' + '0000001', /guidati/)
})

test('Custom Pay (3007 PAYM 09) non parte da qui', () => {
  rifiuta('3007' + '09' + '00' + '11' + 'ELETTRONICO' + '000000222', /POS/)
  assert.equal(classifica('3007' + '03' + '00' + '11' + 'ELETTRONICO' + '000000222').livello, 'clic')
})

test('un comando qualunque fuori elenco è rifiutato, anche se sembra innocuo', () => {
  for (const c of ['2002', '2000', '1999', '9999', 'ciao', '', '  ', '7113', '6302', '630212', '20019999999999', '2006133', '3301'])
    rifiuta(c)
})

test('le stringhe malformate non passano nemmeno se cominciano bene', () => {
  rifiuta('6302' + '1' + '4' + '10' + 'MINIMARKET1')
  rifiuta('6302' + '1' + '4' + '03' + 'AB')
  rifiuta('6302' + '0' + '1' + '01' + 'A')              // riga 0
  rifiuta('7113' + '03' + '0500' + '0' + '09' + '5,00%')   // LUN sbagliata
  rifiuta('2001' + '3213261420')                           // giorno 32
  rifiuta('64041' + '7' + '16' + 'GIORLD84C23A024D' + '11' + '07300661217' + '00')   // codice esito 7
  rifiuta('8002' + '271026' + '0001' + '0004' + '1')       // TIPO deve essere 0
})
