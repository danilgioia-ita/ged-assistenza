import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { ambiente } from './aiuto.mjs'
import { cercaInRete } from '../lib/rete.mjs'
import { leggiStatus, leggiIndice, leggiCampi, creaWeb, WebErrore } from '../lib/web.mjs'
import { readFileSync } from 'node:fs'
import { oraItaliana } from '../lib/registro.mjs'

const grezzo = (url, { metodo = 'GET', host, intestazioni = {}, corpo } = {}) => new Promise((ok, no) => {
  const u = new URL(url)
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: metodo, headers: { ...(host ? { Host: host } : {}), ...intestazioni } }, (res) => {
    const p = []; res.on('data', (d) => p.push(d)); res.on('end', () => ok({ stato: res.statusCode, corpo: Buffer.concat(p).toString() }))
  })
  req.on('error', no); if (corpo) req.write(corpo); req.end()
})

test('SICUREZZA DEL SERVER: token, Host, intestazione e JSON per ogni POST', async () => {
  const a = await ambiente()
  try {
    const base = a.app.indirizzo
    const porta = a.app.porta
    assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{36}\/$/)
    assert.equal(a.app.server.address().address, '127.0.0.1', 'ascolta solo in locale')
    // pagina e file statici col token giusto
    assert.equal((await grezzo(base)).stato, 200)
    // token sbagliato / assente
    assert.equal((await grezzo(`http://127.0.0.1:${porta}/`)).stato, 404)
    assert.equal((await grezzo(`http://127.0.0.1:${porta}/${'0'.repeat(36)}/`)).stato, 404)
    assert.equal((await grezzo(`http://127.0.0.1:${porta}/${a.app.token}x/`)).stato, 404)
    // Host che non è il nostro (DNS rebinding)
    assert.equal((await grezzo(base, { host: 'evil.example.com' })).stato, 403)
    // un POST senza la nostra intestazione, o non JSON, non passa (un form altrui non può comandare la cassa)
    const url = base + 'api/collega'
    const corpo = JSON.stringify({ ip: '127.0.0.1', porta: a.sim.porta, portaWeb: a.sim.portaWeb })
    assert.equal((await grezzo(url, { metodo: 'POST', corpo, intestazioni: { 'content-type': 'application/json' } })).stato, 403)
    assert.equal((await grezzo(url, { metodo: 'POST', corpo, intestazioni: { 'x-strumenti-cassa': '1', 'content-type': 'text/plain' } })).stato, 403)
    assert.equal((await grezzo(url, { metodo: 'POST', corpo, intestazioni: { 'x-strumenti-cassa': '1', 'content-type': 'application/json', origin: 'https://evil.example.com' } })).stato, 403)
    assert.deepEqual(a.sim.comandi(), [], 'niente di tutto questo è arrivato alla cassa')
    // le azioni che scrivono non si raggiungono con GET
    assert.equal((await grezzo(base + 'api/programma/ora')).stato, 404)
    // e col giusto va
    assert.equal((await grezzo(url, { metodo: 'POST', corpo, intestazioni: { 'x-strumenti-cassa': '1', 'content-type': 'application/json' } })).stato, 200)
  } finally { await a.chiudi() }
})

test('indirizzi non privati rifiutati a livello di rotta (collega e cerca)', async () => {
  const a = await ambiente({}, { consentiLoopback: false })
  try {
    for (const ip of ['8.8.8.8', '127.0.0.1', '172.32.0.1', 'www.example.com'])
      assert.match((await a.chiama('POST', 'collega', { ip })).errore, /indirizzo di rete locale/, ip)
    assert.deepEqual(a.sim.comandi(), [])
    const c = await a.chiama('POST', 'cerca', { ips: ['8.8.8.8', '127.0.0.1'] })
    assert.equal(c.provati, 0)
  } finally { await a.chiudi() }
})

test('COLLEGA: legge la matricola; senza collegamento le azioni dicono «collega»', async () => {
  const a = await ambiente()
  try {
    assert.match((await a.chiama('GET', 'cassa')).errore, /nessuna cassa collegata/)
    assert.match((await a.chiama('POST', 'programma/ora', { conferma: true })).errore, /nessuna cassa collegata/)
    const s = await a.collega()
    assert.equal(s.matricola, 'STITE350592')
    assert.equal(s.modello, 'K3F-N')
    assert.equal(s.firmware, '15.04.05')
    // dopo il collegamento ogni sessione verifica la matricola: se la cassa cambia, non si manda niente
    a.sim.comandi().length
    a.app.sess.cassa.matricolaAttesa = 'ALTRA0000001'
    const prima = a.sim.comandi().length
    assert.match((await a.chiama('POST', 'programma/ora', { conferma: true })).errore, /matricola/)
    assert.equal(a.sim.comandi().length, prima + 1, 'solo il 1008 di controllo')
  } finally { await a.chiudi() }
})

test('STATO: le spie, col profilo Flatpay', async () => {
  const a = await ambiente({ nonInviati: 0 })
  try {
    await a.collega()
    await a.chiama('POST', 'profilo', { profilo: 'flatpay' })
    let s = await a.chiama('GET', 'cassa')
    const c = (id) => s.spie.find((x) => x.id === id)
    assert.equal(c('fiscalizzata').colore, 'v')
    assert.equal(c('chiave').colore, 'v'); assert.equal(c('censita').colore, 'v'); assert.equal(c('attivata').colore, 'v'); assert.equal(c('servizio').colore, 'v')
    assert.equal(c('demo').colore, 'v')
    assert.equal(c('certificato').colore, 'v')
    assert.match(c('certificato').valore, /26\/08\/2026 → 26\/08\/2034/)
    assert.equal(c('firmware').colore, 'v'); assert.match(c('firmware').valore, /15\.04\.05 = ultimo/)
    assert.equal(c('corrispettivi').colore, 'v')
    assert.equal(c('ora').colore, 'v')
    assert.equal(c('intestazione').colore, 'r', 'è quella di fabbrica (CUSTOM SPA)')
    assert.equal(c('aliquote').colore, 'r', 'C=4 e D vuota: Flatpay vuole 5 e 4')
    assert.equal(c('fpu019').colore, 'g'); assert.equal(c('cassetto520').colore, 'g'); assert.equal(c('ip911').colore, 'g')
    assert.equal(c('eth910').colore, 'v')
    // dopo la programmazione diventano verdi
    await a.chiama('POST', 'programma/aliquote', { conferma: true, valori: { 1: 22, 2: 10, 3: 5, 4: 4 } })
    await a.chiama('POST', 'programma/intestazione', { conferma: true, righe: [{ testo: 'minimarket', tipo: 4 }, { testo: 'via roma 1' }] })
    s = await a.chiama('GET', 'cassa')
    assert.equal(c('aliquote').colore, 'v')
    assert.equal(c('intestazione').colore, 'v')
    // firmware vecchio, corrispettivi non inviati, ora sballata: rosso
    a.sim.imposta({ firmware: '15.03.75', nonInviati: 2, falliti: 1, offsetOraMin: 45 })
    s = await a.chiama('GET', 'cassa')
    assert.equal(c('firmware').colore, 'r'); assert.match(c('firmware').valore, /c'è il 15\.04\.05/)
    assert.equal(c('corrispettivi').colore, 'r'); assert.match(c('corrispettivi').valore, /2 non inviati, 1 falliti/)
    assert.equal(c('ora').colore, 'r')
    // cassa nuova: tutto da fare
    a.sim.stato.chiave = false; a.sim.stato.censita = false; a.sim.stato.attivata = false; a.sim.stato.inServizio = false; a.sim.stato.fiscalizzata = false
    s = await a.chiama('GET', 'cassa')
    assert.equal(c('fiscalizzata').colore, 'r'); assert.equal(c('chiave').colore, 'r'); assert.equal(c('attivata').colore, 'r')
    // e tutto questo è stato SOLO lettura
    const sc = a.sim.comandi().filter((x) => /^(6302|7113|2001|2002|2005)/.test(x))
    assert.equal(sc.filter((x) => x.startsWith('2002') || x.startsWith('2005')).length, 0)
  } finally { await a.chiudi() }
})

test('MOONEY: nessuna personalizzazione, nessun confronto; DIRETTO: standard', async () => {
  const a = await ambiente()
  try {
    await a.collega()
    await a.chiama('POST', 'profilo', { profilo: 'mooney' })
    let s = await a.chiama('GET', 'cassa')
    assert.equal(s.spie.find((x) => x.id === 'aliquote').colore, 'g')
    assert.ok(!s.spie.some((x) => x.id === 'fpu019'))
    await a.chiama('POST', 'profilo', { profilo: 'diretto' })
    s = await a.chiama('GET', 'cassa')
    assert.equal(s.spie.find((x) => x.id === 'aliquote').colore, 'r')
    assert.match((await a.chiama('POST', 'profilo', { profilo: 'nonesiste' })).errore, /profilo/)
  } finally { await a.chiudi() }
})

test('CHECK-LIST: pagina stampabile e testo da copiare, con le righe e il «prossimo passo»', async () => {
  const a = await ambiente()
  try {
    await a.collega()
    await a.chiama('POST', 'checklist', { dati: { esercente: 'MINIMARKET <DI> RAZA', indirizzo: 'Via Roma 1', sigillo: 'Piombo', nota: 'x'.repeat(80), firmatario: 'Ali Raza' }, spunte: { '1.1': true, '1.3': true, '9.9': true } })
    const cl = await a.chiama('GET', 'checklist')
    assert.equal(cl.dati.nota.length, 50, 'la nota è al massimo di 50 caratteri')
    assert.equal(cl.dati.tecnicoCF, 'GIORLD84C23A024D'); assert.equal(cl.dati.labPIVA, '07300661217'); assert.equal(cl.dati.matricola, 'STITE350592')
    assert.equal(cl.righe.length, 23)
    assert.equal(cl.righe.find((r) => r.riga === '1.1').si, true)
    assert.ok(!cl.righe.some((r) => r.riga === '9.9'), 'righe inventate non entrano')
    const h = await grezzo(a.app.indirizzo + 'api/checklist/stampa')
    assert.equal(h.stato, 200)
    assert.match(h.corpo, /Mod\. 10\.1 \+ 10\.2/)
    assert.ok(h.corpo.includes('MINIMARKET &lt;DI&gt; RAZA'), 'l\'HTML è protetto')
    assert.ok(!h.corpo.includes('<DI>'))
    assert.match(h.corpo, /Prossimo passo \(non ancora fatto\)/)
    assert.match(h.corpo, /firma del cliente a distanza e la scrittura dell&#39;esito nel GST del CRM/)
    assert.match(h.corpo, /non ancora verificata dalla procedura/)
    const t = await grezzo(a.app.indirizzo + 'api/checklist/testo')
    assert.match(t.corpo, /matricola STITE350592/)
    assert.match(t.corpo, /1\.1 Integrità dell'involucro: OK/)
    assert.match(t.corpo, /2\.8 Chiusura prima dell'intervento: NON SPUNTATA/)
    assert.match(t.corpo, /Prossimo passo/)
  } finally { await a.chiudi() }
})

test('REGISTRO: un file per cassa, nel posto giusto, con ora italiana', async () => {
  const a = await ambiente()
  try {
    await a.collega()
    await a.chiama('GET', 'cassa')
    assert.match(a.app.registro.file('STITE350592'), /STITE350592\.log$/)
    const t = a.log()
    assert.match(t, /MANDO +1511/)
    assert.match(t, /NOTA +collegata 127\.0\.0\.1/)
    const reg = await a.chiama('GET', 'registro?righe=5')
    assert.equal(reg.righe.length, 5)
    assert.match(oraItaliana(new Date('2026-10-27T11:20:05Z')), /^27\/10\/2026 12:20:05$/, 'ora italiana (CET, dopo il 25 ottobre)')
    assert.match(oraItaliana(new Date('2026-07-01T10:00:00Z')), /12:00:00$/, 'ora legale d\'estate')
  } finally { await a.chiudi() }
})

test('IMPOSTAZIONI: CF e P.IVA controllati e modificabili; la VP li usa', async () => {
  const a = await ambiente()
  try {
    assert.match((await a.chiama('POST', 'impostazioni', { tecnico: { cf: 'corto' } })).errore, /16 caratteri/)
    assert.match((await a.chiama('POST', 'impostazioni', { laboratorio: { piva: '123' } })).errore, /11 cifre/)
    const s = await a.chiama('POST', 'impostazioni', { tecnico: { cf: 'rssmra80a01h501u' }, laboratorio: { piva: '12345678901' } })
    assert.equal(s.impostazioni.tecnico.cf, 'RSSMRA80A01H501U')
    await a.collega()
    await a.chiama('POST', 'procedura/avvia', { id: 'vp' })
    const st = await a.chiama('GET', 'procedura')
    assert.ok(st.passi[8].anteprima[0].includes('RSSMRA80A01H501U') && st.passi[8].anteprima[0].includes('12345678901'))
  } finally { await a.chiudi() }
})

test('CERCA IN RETE: trova la porta 9100 e riconosce la cassa dalla tastiera remota (senza mandarle niente)', async () => {
  const a = await ambiente()
  try {
    const r = await cercaInRete({ ips: ['127.0.0.1'], portaCassa: a.sim.porta, portaWeb: a.sim.portaWeb, consentiLoopback: true, timeoutMs: 500 })
    assert.equal(r.trovate.length, 1)
    assert.equal(r.trovate[0].riconosciuta, true)
    assert.equal(r.trovate[0].tastieraRemota, true)
    assert.deepEqual(a.sim.comandi(), [], 'sulla 9100 non si manda niente')
    // una porta chiusa non è una cassa
    const v = await cercaInRete({ ips: ['127.0.0.1'], portaCassa: 1, consentiLoopback: true, timeoutMs: 200 })
    assert.equal(v.trovate.length, 0)
  } finally { await a.chiudi() }
})

test('WEB SERVER: si leggono le pagine di stato; i moduli si leggono ma non si inviano', async () => {
  const st = leggiStatus(readFileSync(new URL('./fixtures/Status.html', import.meta.url), 'latin1'))
  assert.equal(st.FISCALIZZATA, 'SI'); assert.equal(st['STATO MACCHINA'], 'IN SERVIZIO'); assert.equal(st._firmware, '15.04.05'); assert.equal(st._modello, 'K3F-N')
  const ix = leggiIndice(readFileSync(new URL('./fixtures/idx.html', import.meta.url), 'latin1'))
  assert.deepEqual([ix.nonInviati, ix.falliti], [0, 0])
  const a = await ambiente()
  try {
    await a.collega()
    const m = await a.chiama('GET', 'web/modulo?pagina=Censimento')
    assert.deepEqual(m.campi.map((c) => c.nome).slice(0, 3), ['CfTecnico', 'CfLaboratorio', 'Captcha'])
    assert.match((await a.chiama('GET', 'web/modulo?pagina=../etc/passwd')).errore, /non ammessa/)
    const w = creaWeb({ ip: '127.0.0.1', matricola: 'STITE350592', porta: a.sim.portaWeb })
    await assert.rejects(w.leggi('/Reboot.cgi'), WebErrore)
    await assert.rejects(creaWeb({ ip: '127.0.0.1', matricola: 'SBAGLIATA', porta: a.sim.portaWeb }).leggi('/Status.htm'), /rifiuta utente e password/)
    assert.ok(a.sim.webRichieste.every((q) => q.metodo === 'GET'), 'nessun POST ai moduli')
  } finally { await a.chiudi() }
})

test('CON PADRE: avviato dall\'app, esce da solo quando l\'app chiude il canale (niente server orfani)', async () => {
  const { spawn } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const srv = fileURLToPath(new URL('../server.mjs', import.meta.url))
  const figlio = spawn(process.execPath, [srv, '--no-apri', '--con-padre'], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, HOME: process.env.TMPDIR || '/tmp' } })
  let out = ''
  const indirizzo = await new Promise((ok, no) => {
    const t = setTimeout(() => { figlio.kill(); no(new Error('nessun indirizzo stampato')) }, 8000)
    figlio.stdout.on('data', (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+\/\S+/); if (m) { clearTimeout(t); ok(m[0]) } })
  })
  assert.match(indirizzo, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{16,}\/$/)
  const uscito = new Promise((ok) => figlio.on('exit', (c, s) => ok({ c, s })))
  figlio.stdin.end()
  const r = await Promise.race([uscito, new Promise((ok) => setTimeout(() => ok('ancora vivo'), 5000))])
  if (r === 'ancora vivo') figlio.kill()
  assert.notEqual(r, 'ancora vivo')
  assert.equal(r.c, 0)
})

test('INATTIVITÀ: senza richieste il server chiama l\'uscita; una richiesta rimanda la scadenza; un passo in corso la blocca', async () => {
  const { avvia } = await import('../server.mjs')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  let scaduto = 0
  const app = await avvia({ cartella: mkdtempSync(join(tmpdir(), 'sc-')), inattivoMs: 300, suInattivo: () => { scaduto++ } })
  try {
    // una richiesta ogni 100 ms per ~600 ms: non scade
    for (let i = 0; i < 6; i++) { await grezzo(app.indirizzo + 'api/casse'); await new Promise((r) => setTimeout(r, 100)) }
    assert.equal(scaduto, 0, 'con richieste in corso non deve scadere')
    // un passo in corso blocca la scadenza
    app.sess.motore = { run: { inEsecuzione: true } }
    await new Promise((r) => setTimeout(r, 700))
    assert.equal(scaduto, 0, 'con un passo in corso non deve scadere')
    app.sess.motore = null
    const t0 = Date.now()
    while (!scaduto && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 50))
    assert.equal(scaduto, 1, 'a riposo deve scadere una volta sola')
  } finally { await app.chiudi() }
})

test('SENZA inattivoMs il server non scade mai', async () => {
  const { avvia } = await import('../server.mjs')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  let scaduto = 0
  const app = await avvia({ cartella: mkdtempSync(join(tmpdir(), 'sc-')), suInattivo: () => { scaduto++ } })
  try { await new Promise((r) => setTimeout(r, 300)); assert.equal(scaduto, 0) } finally { await app.chiudi() }
})

test('INDIRIZZO SU FILE: scritto a 600, leggibile, tolto all\'uscita; il server esce da solo per inattività', async () => {
  const { spawn } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const { mkdtempSync, statSync, existsSync, readFileSync: leggi } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const srv = fileURLToPath(new URL('../server.mjs', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'sc-ind-'))
  const file = join(dir, 'sotto', 'indirizzo.txt')
  const figlio = spawn(process.execPath, [srv, '--no-apri', '--indirizzo-su-file', file, '--inattivo-minuti', '0.01'], { stdio: 'ignore', env: { ...process.env, GED_CASSA_DATI: join(dir, 'dati') } })
  const uscito = new Promise((ok) => figlio.on('exit', (c) => ok(c)))
  try {
    const t0 = Date.now()
    while (!existsSync(file) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 50))
    assert.ok(existsSync(file), 'il file dell\'indirizzo deve comparire')
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.match(leggi(file, 'utf8').trim(), /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{16,}\/$/)
    const r = await Promise.race([uscito, new Promise((ok) => setTimeout(() => ok('vivo'), 10000))])
    assert.equal(r, 0, '0,01 minuti = 600 ms: deve uscire da solo')
    assert.equal(existsSync(file), false, 'all\'uscita il file sparisce')
  } finally { figlio.kill() }
})
