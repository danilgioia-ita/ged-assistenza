import test from 'node:test'
import assert from 'node:assert/strict'
import { ambiente } from './aiuto.mjs'

const letture = /^(1003|1008|1009|1012|1013|1015|1016|1017|1001|1002|1023|1104|1106|1209|1214|1511|1512|1515|6801|7012|7112|8008)/
const scritture = (sim) => sim.comandi().filter((c) => !letture.test(c))
const mai = (sim) => {
  const c = sim.comandi()
  assert.equal(sim.trappole.length, 0, '3006 non deve MAI arrivare alla cassa')
  assert.equal(sim.letture, 0, 'nessuna lettura stampata (7101 OPER 0)')
  assert.ok(!c.some((x) => x.startsWith('3006')), '3006')
  assert.ok(!c.some((x) => x.startsWith('6401')), '6401 (chiave/censimento/attivazione) non parte mai dal programma')
  assert.ok(!c.some((x) => x.startsWith('8007')), '8007')
  assert.ok(!c.some((x) => /^7101A.{14}0$/.test(x)), '7101 OPER 0')
}

async function esegueVP(a, { fino = 15 } = {}) {
  const ok = (r, i) => assert.ok(!r.errore && r.passi[i].stato === 'ok', `passo ${i + 1} (${r.passi?.[i]?.titolo}): ${JSON.stringify(r.passi?.[i]?.errore || r.errore)}`)
  await a.collega()
  await a.chiama('POST', 'procedura/avvia', { id: 'vp' })
  const input = { 1: { conferma: true, scritta: 'CHIUSURA' }, 3: { conferma: true }, 4: { conferma: true }, 5: { conferma: true, scritta: 'CHIUSURA' }, 7: { conferma: true }, 8: { conferma: true }, 10: { conferma: true, mm: '10', aa: '28' }, 11: { conferma: true } }
  let r
  for (let i = 0; i < Math.min(fino, 13); i++) { r = await a.passo(i, input[i] || {}); ok(r, i) }
  return r
}

test('VERIFICAZIONE PERIODICA: la sequenza degli script, comando per comando', async () => {
  const a = await ambiente({ chiusure: 11 })
  try {
    const r = await esegueVP(a)
    assert.equal(r.corrente, 13, 'restano i due passi che fa il tecnico (P601 e controlli fisici)')
    const riga = (d, cent) => '3301' + '1' + '000000000' + '001' + String(d.length).padStart(2, '0') + d + String(cent).padStart(9, '0') + '00'
    const pag = '3007' + '03' + '00' + '11' + 'ELETTRONICO' + '000000222'
    const sc = [riga('PROVA VERIFICA 1', 111), riga('PROVA VERIFICA 2', 111), pag, '3011', '3013']
    const data = a.sim.comandi().find((c) => c.startsWith('7101A')).slice(13, 19)
    assert.match(data, /^\d{6}$/)
    // chiusura (Z12) · due scontrini · annulli con Z = 1104 + 1 = 13 · chiusura (Z13) · intervento · 2006 · DGFE
    assert.deepEqual(scritture(a.sim), [
      '20020', ...sc, ...sc,
      `7101A00130001${data}8`, `7101A00130001${data}1`, `7101A00130002${data}8`, `7101A00130002${data}1`,
      '20020', '64040', '64041316GIORLD84C23A024D110730066121700', '20061028', `8002${data}000100040`,
    ])
    mai(a.sim)
    // la chiusura automatica dopo la fine intervento è la 14
    assert.equal(a.sim.statoInterno().chiusure, 14)
    // la check-list ufficiale è compilata dalla procedura (fonte «procedura»), nelle righe che la procedura verifica davvero
    const cl = await a.chiama('GET', 'checklist')
    const rg = Object.fromEntries(cl.righe.flatMap((s) => s.righe).map((x) => [x.numero, x]))
    for (const k of ['2.2', '2.3', '2.8', '2.9', '2.10', '2.12', '2.13', '2.14', '4.1', '4.2']) { assert.equal(rg[k].fonte, 'procedura', `riga ${k}`); assert.equal(rg[k].valore, 'si', `riga ${k}`) }
    assert.equal(rg['2.4'].fonte, 'procedura'); assert.equal(rg['2.4'].valore, 'no', 'firmware già aggiornato: nessun aggiornamento')
    for (const k of ['1.1', '2.5', '2.11', '4.3']) assert.equal(rg[k].fonte, 'proposta', `la riga ${k} la guarda il tecnico`)
    assert.equal(cl.dati.azzeramenti, '14')
  } finally { await a.chiudi() }
})

test('i passi vanno nell\'ordine: saltare avanti non manda niente', async () => {
  const a = await ambiente()
  try {
    await a.collega()
    await a.chiama('POST', 'procedura/avvia', { id: 'vp' })
    const before = a.sim.comandi().length
    const r = await a.chiama('POST', 'procedura/esegui', { passo: 4, input: { conferma: true } })
    assert.match(r.errore, /passo giusto/)
    const r2 = await a.chiama('POST', 'procedura/esegui', { passo: 1, input: { conferma: true, scritta: 'CHIUSURA' } })
    assert.match(r2.errore, /passo giusto/, 'la chiusura non si sblocca prima dei controlli')
    assert.equal(a.sim.comandi().length, before)
  } finally { await a.chiudi() }
})

test('la CHIUSURA vuole il clic E la parola: senza, il 20020 non parte', async () => {
  const a = await ambiente()
  try {
    await a.collega()
    await a.chiama('POST', 'procedura/avvia', { id: 'chiusura' })
    assert.ok(!(await a.passo(0)).errore)
    const n = () => a.sim.comandi().filter((c) => c === '20020').length
    assert.match((await a.chiama('POST', 'procedura/esegui', { passo: 1, input: {} })).errore, /conferma con il clic/)
    assert.match((await a.chiama('POST', 'procedura/esegui', { passo: 1, input: { conferma: true } })).errore, /parola CHIUSURA/)
    assert.match((await a.chiama('POST', 'procedura/esegui', { passo: 1, input: { conferma: true, scritta: 'chiudi' } })).errore, /parola CHIUSURA/)
    assert.equal(n(), 0)
    const r = await a.passo(1, { conferma: true, scritta: 'chiusura' })
    assert.equal(r.passi[1].stato, 'ok')
    assert.equal(n(), 1)
    const fine = await a.passo(2)
    assert.equal(fine.passi[2].stato, 'ok')
    assert.equal(fine.finita, true)
  } finally { await a.chiudi() }
})

test('chiusura forzata: con uno scontrino aperto ci si ferma e non si chiude', async () => {
  const a = await ambiente()
  try {
    await a.collega()
    // un altro ha aperto uno scontrino da tastiera
    const riga = '3301' + '1' + '000000000' + '001' + '04' + 'PROV' + '000000100' + '00'
    const { Cassa } = await import('../lib/cassa.mjs')
    await new Cassa({ ip: '127.0.0.1', porta: a.sim.porta, consentiLoopback: true }).sessione((s) => s.manda(riga), { conferma: { clic: true } })
    await a.chiama('POST', 'procedura/avvia', { id: 'chiusura' })
    const r = await a.passo(0)
    assert.equal(r.passi[0].stato, 'errore')
    assert.match(r.passi[0].errore.messaggio, /documento aperto/)
    assert.equal(r.corrente, 0)
    assert.ok(!a.sim.comandi().includes('20020'))
  } finally { await a.chiudi() }
})

test('ERR sul secondo scontrino: ci si ferma, il passo dopo NON si sblocca, il codice è spiegato', async () => {
  const a = await ambiente({ chiusure: 11 })
  try {
    await esegueVP(a, { fino: 3 })
    a.sim.imposta({ erroreSuRiga: 54 })
    const r = await a.passo(3, { conferma: true })
    assert.equal(r.passi[3].stato, 'errore')
    assert.equal(r.passi[3].errore.codice, 54)
    assert.ok(r.passi[3].errore.titolo && r.passi[3].errore.spiegazione)
    assert.equal(r.corrente, 3, 'i passi dopo restano chiusi')
    assert.match((await a.chiama('POST', 'procedura/esegui', { passo: 4, input: { conferma: true } })).errore, /passo giusto/)
    assert.deepEqual(scritture(a.sim).filter((c) => c.startsWith('7101A')), [])
    mai(a.sim)
  } finally { await a.chiudi() }
})

test('il ciclo su 1515: ERR99 (cassa occupata a inviare) si aspetta, poi passa', async () => {
  const a = await ambiente({ chiusure: 11, invioMs: 120 })
  try {
    await esegueVP(a, { fino: 2 })
    const r = await a.passo(2)
    assert.equal(r.passi[2].stato, 'ok', JSON.stringify(r.passi[2]))
    const n1515 = a.sim.registro.filter((x) => x.cmd.startsWith('1515'))
    assert.ok(n1515.length >= 2, `doveva ripetere (${n1515.length})`)
    assert.ok(n1515.slice(0, -1).every((x) => x.risposta === 'ERR99'), 'tutte ERR99 tranne l\'ultima')
    assert.match(n1515.at(-1).risposta, /^15150001200000/)
    assert.match(r.passi[2].esito, /inviato/)
  } finally { await a.chiudi() }
})

test('se l\'Agenzia dice «fallito» il passo si ferma e lo dice', async () => {
  const a = await ambiente({ chiusure: 11, invioMs: 10, statoInvio: 1 })
  try {
    await esegueVP(a, { fino: 2 })
    const r = await a.passo(2)
    assert.equal(r.passi[2].stato, 'errore')
    assert.match(r.passi[2].errore.messaggio, /fallita/)
  } finally { await a.chiudi() }
})

test('chiusura SENZA RISPOSTA: non si rimanda; il passo è «da verificare»; la rilettura trova la chiusura fatta', async () => {
  const a = await ambiente({ chiusure: 11, silenzioSu: '20020', silenzioEseguito: true, timeoutMs: 300 })
  try {
    await a.collega()
    a.app.sess.cassa.timeoutMs = 250
    await a.chiama('POST', 'procedura/avvia', { id: 'vp' })
    await a.passo(0)
    const r = await a.passo(1, { conferma: true, scritta: 'CHIUSURA' })
    assert.equal(r.passi[1].stato, 'errore')
    assert.equal(r.passi[1].daVerificare, true)
    assert.equal(a.sim.comandi().filter((c) => c === '20020').length, 1, 'MAI rimandato alla cieca')
    const x = await a.chiama('POST', 'procedura/controlla', { passo: 1 })
    assert.equal(x.rilettura.ok, true, x.rilettura.testo)
    assert.equal(x.procedura.corrente, 2, 'la rilettura ha trovato la chiusura fatta e sblocca il passo dopo')
    assert.equal(a.sim.comandi().filter((c) => c === '20020').length, 1)
  } finally { await a.chiudi() }
})

test('chiusura senza risposta E NON eseguita: la rilettura lo dice e il passo resta aperto', async () => {
  const a = await ambiente({ chiusure: 11, silenzioSu: '20020', silenzioEseguito: false })
  try {
    await a.collega()
    a.app.sess.cassa.timeoutMs = 250
    await a.chiama('POST', 'procedura/avvia', { id: 'chiusura' })
    await a.passo(0)
    const r = await a.passo(1, { conferma: true, scritta: 'CHIUSURA' })
    assert.equal(r.passi[1].daVerificare, true)
    const x = await a.chiama('POST', 'procedura/controlla', { passo: 1 })
    assert.equal(x.rilettura.ok, false)
    assert.match(x.rilettura.testo, /NON risulta fatta/)
    assert.equal(x.procedura.corrente, 1)
  } finally { await a.chiudi() }
})

test('gli annulli in demo: il controllo risponde 0, il programma non annulla e lo dice', async () => {
  const a = await ambiente({ chiusure: 11, demo: true })
  try {
    await a.collega()
    await a.chiama('POST', 'procedura/avvia', { id: 'vp' })
    const r = await a.passo(0)
    assert.match(r.passi[0].errore.messaggio, /demo/, 'la procedura si ferma subito, in demo')
    assert.equal(scritture(a.sim).length, 0)
  } finally { await a.chiudi() }
})

test('CICLO FISCALE di una cassa nuova: guidato, ogni passo si sblocca rileggendo la cassa; fiscalizzazione a doppia conferma', async () => {
  const a = await ambiente({ chiusure: 0, fiscalizzata: false, chiave: false, censita: false, attiva: false })
  try {
    await a.collega()
    let r = await a.chiama('POST', 'procedura/avvia', { id: 'ciclo' })
    assert.equal(r.corrente, 0, 'chiave privata: tocca al tecnico')
    // il tecnico NON ha ancora fatto niente: la rilettura non sblocca
    let x = await a.chiama('POST', 'procedura/controlla', { passo: 0 })
    assert.equal(x.rilettura.ok, false)
    assert.equal(x.procedura.corrente, 0)
    // niente comando automatico per la chiave: «esegui» non è ammesso
    assert.match((await a.chiama('POST', 'procedura/esegui', { passo: 0, input: { conferma: true } })).errore, /fai tu/)
    // il tecnico genera la chiave (P699): la rilettura lo vede
    a.sim.stato.chiave = true
    x = await a.chiama('POST', 'procedura/controlla', { passo: 0 })
    assert.equal(x.rilettura.ok, true)
    assert.equal(x.procedura.corrente, 1)
    // censimento: prima no, poi sì
    x = await a.chiama('POST', 'procedura/controlla', { passo: 1 })
    assert.equal(x.rilettura.ok, false)
    a.sim.stato.censita = true
    x = await a.chiama('POST', 'procedura/controlla', { passo: 1 })
    assert.equal(x.procedura.corrente, 2, 'ora tocca alla fiscalizzazione')
    assert.equal(x.procedura.passi[2].conferma, 'scritta')
    assert.equal(x.procedura.passi[2].fiscalizzazione, true)

    const n2005 = () => a.sim.comandi().filter((c) => c === '2005').length
    // senza niente, con solo il clic, con la matricola sbagliata, senza la parola: NON parte
    for (const input of [{}, { conferma: true }, { conferma: true, matricola: 'STITE350592' }, { conferma: true, matricola: 'ALTRA', scritta: 'IRREVERSIBILE' }, { conferma: true, matricola: 'STITE350592', scritta: 'si' }, { matricola: 'STITE350592', scritta: 'IRREVERSIBILE' }]) {
      const e = await a.chiama('POST', 'procedura/esegui', { passo: 2, input })
      assert.ok(e.errore, JSON.stringify(input))
    }
    assert.equal(n2005(), 0)
    // tutto giusto, ma l'intestazione è ancora quella di fabbrica: i controlli la fermano PRIMA di fiscalizzare
    let f = await a.passo(2, { conferma: true, matricola: 'STITE350592', scritta: 'IRREVERSIBILE' })
    assert.equal(f.passi[2].stato, 'errore')
    assert.match(f.passi[2].errore.messaggio, /di fabbrica/)
    assert.equal(n2005(), 0)
    // imposto l'intestazione (sezione Programmazione)
    const pr = await a.chiama('POST', 'programma/intestazione', { conferma: true, righe: [{ testo: 'minimarket', tipo: 4 }, { testo: 'di raza ali', tipo: 2 }, { testo: 'via salvator rosa 71' }, { testo: '80135 napoli' }, { testo: 'p.iva 11142291217' }] })
    assert.equal(pr.ok, true, JSON.stringify(pr))
    // ora diversa: si ferma
    a.sim.imposta({ offsetOraMin: 40 })
    f = await a.passo(2, { conferma: true, matricola: 'STITE350592', scritta: 'IRREVERSIBILE' })
    assert.match(f.passi[2].errore.messaggio, /data e ora/)
    assert.equal(n2005(), 0)
    a.sim.imposta({ offsetOraMin: 0 })
    // ora sì: UN solo 2005, e MAI il 8007 dopo
    f = await a.passo(2, { conferma: true, matricola: 'STITE350592', scritta: 'IRREVERSIBILE' })
    assert.equal(f.passi[2].stato, 'ok', JSON.stringify(f.passi[2]))
    assert.equal(n2005(), 1)
    assert.match(f.passi[2].esito, /FISCALIZZATA: SI/)
    assert.equal(f.corrente, 3)
    // accreditamento (esercente): lo spunta il tecnico
    f = await a.chiama('POST', 'procedura/segna', { passo: 3 })
    assert.equal(f.corrente, 4)
    // attivazione guidata
    x = await a.chiama('POST', 'procedura/controlla', { passo: 4 })
    assert.equal(x.rilettura.ok, false)
    a.sim.stato.attivata = true; a.sim.stato.inServizio = true
    x = await a.chiama('POST', 'procedura/controlla', { passo: 4 })
    assert.equal(x.procedura.corrente, 5)
    f = await a.chiama('POST', 'procedura/segna', { passo: 5 })
    assert.equal(f.finita, true)
    mai(a.sim)
    // il web server: niente POST a Censimento/Attivazione, mai
    assert.ok(a.sim.webRichieste.every((q) => q.metodo === 'GET'), 'solo GET al web server')
  } finally { await a.chiudi() }
})

test('cassa GIÀ fiscalizzata: il ciclo salta da solo il passo (e non manda 2005)', async () => {
  const a = await ambiente({ fiscalizzata: true, chiave: true, censita: true, attiva: false })
  try {
    await a.collega()
    const r = await a.chiama('POST', 'procedura/avvia', { id: 'ciclo' })
    assert.equal(r.corrente, 3, 'chiave, censimento e fiscalizzazione già a posto: si riparte dall\'accreditamento')
    assert.match(r.passi[2].esito, /già a posto/)
    assert.equal(a.sim.comandi().filter((c) => c === '2005').length, 0)
  } finally { await a.chiudi() }
})

test('la chiusura che «salta» o non avviene: il contatore non è salito di UNO, il passo si ferma e non dice «fatto»', async () => {
  for (const salto of [0, 2]) {
    const a = await ambiente({ chiusure: 11, saltoChiusure: salto })
    try {
      await a.collega()
      await a.chiama('POST', 'procedura/avvia', { id: 'chiusura' })
      await a.passo(0)
      const r = await a.passo(1, { conferma: true, scritta: 'CHIUSURA' })
      assert.equal(r.passi[1].stato, 'errore', `salto ${salto}`)
      assert.match(r.passi[1].errore.messaggio, /contatore delle chiusure non è salito/)
      assert.equal(r.passi[1].daVerificare, true)
      assert.equal(r.corrente, 1)
      assert.equal(a.sim.comandi().filter((c) => c === '20020').length, 1, 'e non si rimanda')
    } finally { await a.chiudi() }
  }
})

test('B1 · scontrini di prova: dopo un errore a metà si emettono SOLO quelli che mancano, e gli annulli li coprono tutti', async () => {
  const a = await ambiente({ chiusure: 11, erroreDopoRighe: 3 })
  try {
    await esegueVP(a, { fino: 3 })
    const r = await a.passo(3, { conferma: true })
    assert.equal(r.passi[3].stato, 'errore')
    assert.match(r.passi[3].errore.messaggio, /scontrino aperto/)
    // il tecnico annulla lo scontrino rimasto aperto
    const { Cassa } = await import('../lib/cassa.mjs')
    const { STRINGA_ANNULLO_IN_CORSO } = await import('../lib/listabianca.mjs')
    await new Cassa({ ip: '127.0.0.1', porta: a.sim.porta, consentiLoopback: true }).sessione((s) => s.manda(STRINGA_ANNULLO_IN_CORSO), { conferma: { clic: true } })
    const r2 = await a.passo(3, { conferma: true })
    assert.equal(r2.passi[3].stato, 'ok', JSON.stringify(r2.passi[3]))
    const emessi = a.sim.docs.filter((d) => d.tipo === 1 && !d.annullato)
    assert.equal(emessi.length, 2, 'due scontrini veri, non tre')
    assert.equal(a.app.sess.motore.run.vars.ricevute.length, 2)
    const r3 = await a.passo(4, { conferma: true })
    assert.equal(r3.passi[4].stato, 'ok', JSON.stringify(r3.passi[4]))
    assert.ok(emessi.every((d) => d.annullatoDa), 'NESSUNO scontrino resta non annullato')
  } finally { await a.chiudi() }
})

test('B2 · nessuna risposta su 2006: la rilettura dei passi che si possono rileggere, e per 2006 si esce senza buttare la procedura', async () => {
  const a = await ambiente({ chiusure: 11 })
  try {
    await esegueVP(a, { fino: 10 })
    a.sim.imposta({ silenzioSu: '2006', silenzioEseguito: true })
    a.app.sess.cassa.timeoutMs = 250
    const r = await a.passo(10, { conferma: true, mm: '10', aa: '28' })
    assert.equal(r.passi[10].stato, 'errore')
    assert.equal(r.passi[10].daVerificare, true)
    assert.equal(r.passi[10].senzaRilettura, true)
    assert.equal(a.sim.comandi().filter((c) => c.startsWith('2006')).length, 1, 'non rimandato')
    const s = await a.chiama('POST', 'procedura/segna', { passo: 10 })
    assert.equal(s.corrente, 11, 'considera fatto: la procedura prosegue')
    a.sim.imposta({ silenzioSu: null })
    const d = await a.passo(11, { conferma: true })
    assert.equal(d.passi[11].stato, 'ok')
  } finally { await a.chiudi() }
})

test('B2 · fine intervento senza risposta: la rilettura (1104) trova la chiusura automatica e lo dà per fatto', async () => {
  const a = await ambiente({ chiusure: 11 })
  try {
    await esegueVP(a, { fino: 8 })
    a.sim.imposta({ silenzioSu: '64041', silenzioEseguito: true })
    a.app.sess.cassa.timeoutMs = 250
    const r = await a.passo(8, { conferma: true })
    assert.equal(r.passi[8].daVerificare, true)
    await new Promise((x) => setTimeout(x, 150))
    const x = await a.chiama('POST', 'procedura/controlla', { passo: 8 })
    assert.equal(x.rilettura.ok, true, x.rilettura.testo)
    assert.equal(x.procedura.corrente, 9)
    assert.equal(a.sim.comandi().filter((c) => c.startsWith('64041')).length, 1)
  } finally { await a.chiudi() }
})

test('B2 · annulli senza risposta: la rilettura di 1017 dice se gli annulli ci sono', async () => {
  const a = await ambiente({ chiusure: 11 })
  try {
    await esegueVP(a, { fino: 4 })
    a.sim.imposta({ silenzioSu: '7101A00130002', silenzioEseguito: true })
    a.app.sess.cassa.timeoutMs = 250
    const r = await a.passo(4, { conferma: true })
    assert.equal(r.passi[4].stato, 'errore')
    assert.equal(r.passi[4].puoVerificare, true)
    const x = await a.chiama('POST', 'procedura/controlla', { passo: 4 })
    assert.equal(x.rilettura.ok, false, 'il secondo annullo (1) è stato mangiato dal silenzio ma era solo il controllo: non tutti emessi')
  } finally { await a.chiudi() }
})

test('M1 · durante un passo in esecuzione: niente collega, scollega, tastiera, programmazione', async () => {
  const a = await ambiente({ chiusure: 11 })
  try {
    await esegueVP(a, { fino: 1 })
    a.app.sess.motore.run.inEsecuzione = true
    for (const [n, c] of [['collega', { ip: '127.0.0.1' }], ['scollega', {}], ['tasto', { tasto: 'CHIAVE', conferma: true }], ['programma/ora', { conferma: true }]])
      assert.match((await a.chiama('POST', n, c)).errore, /passo della procedura è in corso/, n)
    a.app.sess.motore.run.inEsecuzione = false
  } finally { await a.chiudi() }
})

test('M2 · ERR99 con 1015 = 000 durante l\'attesa dell\'invio è «occupata»: si aspetta, non si ferma', async () => {
  const a = await ambiente({ chiusure: 11, invioMs: 100 })
  try {
    await esegueVP(a, { fino: 2 })
    // il sim risponde 1015 = 000 mentre è occupato
    a.sim.imposta({ ultimoErroreFinto: true })
    const r = await a.passo(2)
    assert.equal(r.passi[2].stato, 'ok', JSON.stringify(r.passi[2]))
  } finally { await a.chiudi() }
})
