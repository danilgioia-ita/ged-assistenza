import test from 'node:test'
import assert from 'node:assert/strict'
import { ambiente } from './aiuto.mjs'

const scrittura = /^(6302|6301|6303|7113|2001|2002|2005|2006|3301|3007|3011|3013|6404|7101A|8002)/

test('INTESTAZIONE: 9 righe con stile, 6301 col numero, 6303 per salvare, e la rilegge', async () => {
  const a = await ambiente()
  try {
    await a.collega()
    const r = await a.chiama('POST', 'programma/intestazione', { conferma: true, righe: [{ testo: 'Minimarket', tipo: 4 }, { testo: 'di Raza Ali', tipo: 2 }, { testo: 'Via Salvator Rosa 71' }, { testo: '80135 Napoli' }, { testo: 'P.IVA 11142291217' }] })
    assert.equal(r.ok, true, JSON.stringify(r))
    const c = a.sim.comandi().filter((x) => /^(6302|6301|6303)/.test(x))
    assert.equal(c.length, 9 + 2)
    assert.equal(c[0], '6302' + '1' + '4' + '10' + 'MINIMARKET')
    assert.equal(c[1], '6302' + '2' + '2' + '11' + 'DI RAZA ALI')
    assert.equal(c[5], '6302' + '6' + '1' + '01' + ' ', 'una riga vuota si scrive come uno spazio')
    assert.equal(c[9], '63015')
    assert.equal(c[10], '63031')
    assert.equal(a.sim.intestazione[0].testo, 'MINIMARKET')
    assert.equal(a.sim.intestazione[0].tipo, 4)
    assert.equal(a.sim.statoInterno().nRigheInt, 5)
    // la riletta è nella risposta
    assert.equal(r.letto.righe[4].testo, 'P.IVA 11142291217')
  } finally { await a.chiudi() }
})

test('INTESTAZIONE: senza il clic non parte niente; col profilo Flatpay più di 7 righe sono rifiutate PRIMA di scrivere', async () => {
  const a = await ambiente()
  try {
    await a.collega()
    const righe = Array.from({ length: 8 }, (_, i) => ({ testo: 'RIGA ' + (i + 1) }))
    assert.match((await a.chiama('POST', 'programma/intestazione', { righe })).errore, /conferma/)
    await a.chiama('POST', 'profilo', { profilo: 'flatpay' })
    const e = await a.chiama('POST', 'programma/intestazione', { conferma: true, righe })
    assert.match(e.errore, /al massimo 7 righe/)
    assert.equal(a.sim.comandi().filter((c) => scrittura.test(c)).length, 0)
    const lunga = await a.chiama('POST', 'programma/intestazione', { conferma: true, righe: [{ testo: 'X'.repeat(33) }] })
    assert.match(lunga.errore, /33 caratteri/)
    assert.equal(a.sim.comandi().filter((c) => scrittura.test(c)).length, 0)
  } finally { await a.chiudi() }
})

test('ALIQUOTE: scrive solo quelle diverse, con la descrizione provata, e rilegge', async () => {
  const a = await ambiente()
  try {
    await a.collega()
    const r = await a.chiama('POST', 'programma/aliquote', { conferma: true, valori: { 1: 22, 2: 10, 3: 5, 4: 4 } })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.scritte, 2)
    // quelle stringhe sono ESATTAMENTE quelle provate sulla cassa di Flatpay (scrivi-flatpay.mjs, 27/10)
    assert.deepEqual(a.sim.comandi().filter((c) => c.startsWith('7113')), ['7113' + '03' + '0500' + '0' + '05' + '5,00%', '7113' + '04' + '0400' + '0' + '05' + '4,00%'])
    assert.equal(a.sim.aliquote[2].valore, 5)
    assert.equal(a.sim.aliquote[3].valore, 4)
  } finally { await a.chiudi() }
})

test('ALIQUOTE: una non programmabile (22 → 21) si dice e non si scrive; chiusura necessaria = ERR e stop', async () => {
  const a = await ambiente()
  try {
    await a.collega()
    const e = await a.chiama('POST', 'programma/aliquote', { conferma: true, valori: { 1: 21, 3: 5 } })
    assert.match(e.errore, /non è programmabile/)
    assert.equal(a.sim.comandi().filter((c) => c.startsWith('7113')).length, 0, 'prima si controlla tutto, poi si scrive')
    a.sim.imposta({ chiusuraPerAliquote: true })
    const e2 = await a.chiama('POST', 'programma/aliquote', { conferma: true, valori: { 3: 5, 4: 4 } })
    assert.equal(e2.dettaglio.codice, 54)
    assert.equal(a.sim.comandi().filter((c) => c.startsWith('7113')).length, 1, 'si ferma al primo ERR, la seconda non parte')
  } finally { await a.chiudi() }
})

test('DATA E ORA: allinea la cassa all\'ora italiana del Mac e rilegge', async () => {
  const a = await ambiente({ offsetOraMin: 37 })
  try {
    await a.collega()
    const r = await a.chiama('POST', 'programma/ora', { conferma: true })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.match(a.sim.comandi().find((c) => c.startsWith('2001')), /^2001\d{10}$/)
    assert.equal(a.sim.statoInterno().offsetOraMin, 0)
    const st = await a.chiama('GET', 'cassa')
    assert.equal(st.spie.find((s) => s.id === 'ora').colore, 'v')
  } finally { await a.chiudi() }
})

test('DATA E ORA: se la cassa chiede la conferma (2 giorni dopo l\'ultima chiusura) non si rimanda da soli', async () => {
  const a = await ambiente()
  try {
    await a.collega()
    const { impostaOra } = await import('../lib/programma.mjs')
    const ora = new Date(Date.now() + 5 * 86400000)
    // un 2001 che risponde «attesa conferma»: lo simulo sostituendo la risposta nella sessione
    const orig = a.sim.registro
    const r = await a.app.sess.cassa.sessione(async (s) => {
      const vero = s.manda.bind(s)
      s.manda = async (c) => (c.startsWith('2001') ? '20011' : vero(c))
      return impostaOra(s, { adesso: ora })
    }, { conferma: { clic: true } }).catch((e) => e)
    assert.equal(r.ok, false)
    assert.equal(r.serveConferma, 1)
    assert.ok(orig.every((x) => !x.cmd.startsWith('2001')), 'il simulatore non ha ricevuto nessun secondo 2001')
  } finally { await a.chiudi() }
})

test('019/910/911/520: nessun comando di protocollo, solo spunte; la tastiera remota va dietro un clic e con tasti di una lista chiusa', async () => {
  const a = await ambiente()
  try {
    await a.collega()
    await a.chiama('POST', 'profilo', { profilo: 'flatpay' })
    let st = await a.chiama('GET', 'cassa')
    const fpu = () => st.spie.find((s) => s.id === 'fpu019')
    assert.equal(fpu().colore, 'g', 'grigia finché il tecnico non spunta')
    assert.equal(st.spie.find((s) => s.id === 'cassetto520').colore, 'g')
    await a.chiama('POST', 'spunta', { id: 'fpu019', valore: true })
    st = await a.chiama('GET', 'cassa')
    assert.equal(fpu().colore, 'v')
    assert.match(fpu().valore, /spunta del tecnico/)
    // tastiera remota
    assert.match((await a.chiama('POST', 'tasto', { tasto: 'CHIAVE' })).errore, /conferma/)
    assert.equal(a.sim.display.tasti.length, 0)
    const ok = await a.chiama('POST', 'tasto', { tasto: 'CHIAVE', conferma: true })
    assert.match(ok.display, /tasto 1/)
    const ok2 = await a.chiama('POST', 'tasto', { tasto: '5', conferma: true })
    assert.match(ok2.display, /tasto 53/)
    for (const brutto of [22, 7, 999, 'ZREPORT', 0, -1, '1;2']) {
      const e = await a.chiama('POST', 'tasto', { tasto: brutto, conferma: true })
      assert.ok(e.errore, `tasto ${brutto}`)
    }
    assert.deepEqual(a.sim.display.tasti, [1, 53])
    assert.deepEqual(a.sim.webRichieste.filter((q) => q.metodo === 'POST').map((q) => q.url), ['/GetDisplay.cgi', '/GetDisplay.cgi'])
    assert.equal(a.sim.comandi().filter((c) => scrittura.test(c)).length, 0)
  } finally { await a.chiudi() }
})
