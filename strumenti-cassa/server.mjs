#!/usr/bin/env node
// STRUMENTI CASSA — GED Assistance Tecnico. Programma locale per il Mac del tecnico che comanda le casse fiscali
// Custom K3F-N in rete. Node puro, zero dipendenze.
//
//   node strumenti-cassa/server.mjs            apre il browser su http://127.0.0.1:<porta libera>/<token>/
//   node strumenti-cassa/server.mjs --no-apri  non apre il browser (stampa solo l'indirizzo)
//   --con-padre                                 esce da solo quando si chiude stdin (lo usa l'app Tecnico)
//   node strumenti-cassa/server.mjs --simulatore  parte con una cassa FINTA (per provare l'interfaccia, mai sulla cassa vera)
//
// SICUREZZA: ascolta SOLO su 127.0.0.1; il token casuale è nell'indirizzo; si controllano Host e intestazione di richiesta,
// così una pagina web qualunque non può far partire comandi. Ai comandi verso la cassa provvede la lista bianca (lib/listabianca.mjs).
import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { Cassa, ErroreCassa, CassaErrore, indirizzoPrivato } from './lib/cassa.mjs'
import { creaRegistro, cartellaDati, oraItaliana } from './lib/registro.mjs'
import { creaArchivio, cfValido, pivaValida } from './lib/archivio.mjs'
import { creaWeb, leggiIndice, leggiCampi, TASTI, WebErrore } from './lib/web.mjs'
import { leggiCassa, leggiWeb, valuta } from './lib/stato.mjs'
import { impostaIntestazione, impostaAliquote, impostaOra, preparaRighe, STILI, ProgrammaErrore } from './lib/programma.mjs'
import { Motore, PassoErrore, descriviErrore } from './lib/procedure.mjs'
import { cercaInRete } from './lib/rete.mjs'
import { RIGHE, CAMPI, righeComposte, datiComposti, testoRiepilogo, paginaStampabile } from './lib/checklist.mjs'

const QUI = dirname(fileURLToPath(import.meta.url))
const leggiJson = (f) => JSON.parse(readFileSync(join(QUI, 'dati', f), 'utf8'))

const TIPI = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

export async function avvia(opz = {}) {
  const {
    porta = 0, apri = false, cartella = cartellaDati(), consentiLoopback = false,
    rapido = false, attesaTastoMs = 700, attendi = (ms) => new Promise((r) => setTimeout(r, ms)), adesso = () => new Date(), intervalloMs = 15_000, token = randomBytes(18).toString('hex'),
  } = opz
  const profili = leggiJson('profili.json')
  const ultimiFirmware = leggiJson('ultimi-firmware.json')
  const registro = creaRegistro(cartella, adesso)
  const archivio = creaArchivio(cartella)

  // La cassa collegata (una per volta)
  const sess = { cassa: null, web: null, ip: '', porta: 9100, portaWeb: 80, matricola: '', modello: null, firmware: null, motore: null, ultimoStato: null }

  const profiloDi = () => profili[archivio.cassa(sess.matricola).profilo] || profili.diretto
  const ctxMotore = () => ({
    sessione: (lavoro, conferma = {}) => sess.cassa.sessione(lavoro, { conferma }),
    web: () => sess.web,
    webIndice: async () => { try { return leggiIndice(await sess.web.leggi('/index.htm')) } catch { return null } },
    impostazioni: () => archivio.impostazioni(),
    matricola: () => sess.matricola,
    firmwareUltimo: () => profiloDi().firmwareUltimo || ultimiFirmware.modelli[sess.modello] || null,
    checklist: {
      auto: (id, x) => { const c = archivio.cassa(sess.matricola); c.checklist.auto = { ...(c.checklist.auto || {}), [id]: x }; archivio.salvaCassa(sess.matricola, c) },
      dati: (d) => { const c = archivio.cassa(sess.matricola); c.checklist.dati = { ...c.checklist.dati, ...d }; archivio.salvaCassa(sess.matricola, c) },
    },
    salvaVP: (vp) => { const c = archivio.cassa(sess.matricola); c.vp = vp; archivio.salvaCassa(sess.matricola, c) },
    registro: { evento: (t) => registro.evento(sess.matricola, t) },
    attendi, adesso, intervalloMs,
  })

  const cassaCollegata = () => { if (!sess.cassa) throw new CassaErrore('nessuna cassa collegata: usa «Collega»', 'non_collegata'); return sess.cassa }
  const libera = () => { if (sess.motore?.run?.inEsecuzione) throw new CassaErrore('un passo della procedura è in corso: aspetta che finisca', 'occupato') }
  const conferma = (b) => { if (b?.conferma !== true) throw new CassaErrore('serve la conferma con il clic: non ho mandato niente', 'conferma'); return { clic: true } }

  // ───────────────────────── le azioni ─────────────────────────
  const azioni = {
    async 'GET stato-app'() {
      return {
        collegata: !!sess.cassa, ip: sess.ip, matricola: sess.matricola, modello: sess.modello, firmware: sess.firmware,
        profilo: sess.matricola ? archivio.cassa(sess.matricola).profilo : 'diretto', profili: Object.fromEntries(Object.entries(profili).map(([k, v]) => [k, { nome: v.nome, nota: v.nota, etichette: v.etichette, registra: v.registra, aliquote: v.aliquote, intestazioneMaxRighe: v.intestazioneMaxRighe, manuali: v.manuali }])),
        impostazioni: archivio.impostazioni(), ultimaIp: archivio.impostazioni().ultimaIp, stili: STILI, tasti: TASTI, ora: oraItaliana(adesso()),
        simulatore: opz.simulatore || null, cartellaDati: cartella,
      }
    },
    async 'GET casse'() { return { casse: archivio.elenco(), collegata: sess.matricola || null } },
    // la scheda di una cassa preparata, in SOLA LETTURA: non parla con la cassa
    async 'GET casse/scheda'(_, q) {
      const m = String(q.get('matricola') || '')
      if (!/^[A-Za-z0-9]{1,24}$/.test(m) || !archivio.elenco().some((x) => x.matricola === m)) throw new CassaErrore('cassa sconosciuta', 'dati')
      const c = archivio.cassa(m)
      return { matricola: m, profilo: c.profilo, nomeProfilo: profili[c.profilo]?.nome, ip: c.ip || '', nota: c.nota || '', vp: c.vp || null, dati: c.checklist?.dati || {}, righe: righeComposte(c.checklist || {}), spunte: c.spunte || {}, registro: registro.coda(m, 40) }
    },
    async 'POST casse/nota'(b) {
      const m = String(b?.matricola || '')
      if (!archivio.elenco().some((x) => x.matricola === m)) throw new CassaErrore('cassa sconosciuta', 'dati')
      const c = archivio.cassa(m); c.nota = String(b.nota ?? '').slice(0, 2000); archivio.salvaCassa(m, c)
      return { ok: true }
    },
    async 'POST cerca'(b) {
      const ips = Array.isArray(b?.ips) ? b.ips.map(String) : null
      return cercaInRete({ ips, consentiLoopback, portaCassa: consentiLoopback && b?.porta ? Number(b.porta) : 9100, portaWeb: consentiLoopback && b?.portaWeb ? Number(b.portaWeb) : 80 })
    },
    async 'POST collega'(b) {
      libera()
      const ip = String(b?.ip || '').trim()
      const porta9100 = consentiLoopback && b?.porta ? Number(b.porta) : 9100
      const cassa = new Cassa({ ip, porta: porta9100, registro, attendi, consentiLoopback, rapido })
      const letto = await cassa.sessione(async (s) => ({ matricola: s.matricola, p1013: await s.manda('1013').catch(() => '') }))
      cassa.matricolaAttesa = letto.matricola
      sess.cassa = cassa; sess.ip = ip; sess.porta = porta9100; sess.matricola = letto.matricola
      sess.portaWeb = consentiLoopback && b?.portaWeb ? Number(b.portaWeb) : 80
      sess.web = creaWeb({ ip, matricola: letto.matricola, porta: sess.portaWeb, registro, attesaTastoMs })
      sess.modello = (/(K3[A-Z0-9-]*)/.exec(letto.p1013) || [])[1] || null
      sess.firmware = (/(\d{1,2}\.\d{2}\.\d{2})/.exec(letto.p1013) || [])[1] || null
      sess.motore = new Motore(ctxMotore())
      { const c = archivio.cassa(sess.matricola); c.ip = ip; archivio.salvaCassa(sess.matricola, c) }
      const imp = archivio.impostazioni(); imp.ultimaIp = ip; archivio.salvaImpostazioni(imp)
      registro.evento(sess.matricola, `collegata ${ip} (${sess.modello || '?'} ${sess.firmware || '?'})`)
      return azioni['GET stato-app']()
    },
    async 'POST scollega'() { libera(); Object.assign(sess, { cassa: null, web: null, ip: '', matricola: '', modello: null, firmware: null, motore: null, ultimoStato: null }); return azioni['GET stato-app']() },
    async 'POST profilo'(b) {
      cassaCollegata()
      if (!profili[b?.profilo]) throw new CassaErrore('profilo sconosciuto', 'dati')
      const c = archivio.cassa(sess.matricola); c.profilo = b.profilo; archivio.salvaCassa(sess.matricola, c)
      registro.evento(sess.matricola, `profilo scelto: ${profili[b.profilo].nome}`)
      return azioni['GET stato-app']()
    },
    async 'POST impostazioni'(b) {
      const i = archivio.impostazioni()
      if (b?.tecnico?.cf !== undefined) { const cf = String(b.tecnico.cf).trim().toUpperCase(); if (!cfValido(cf)) throw new CassaErrore('il codice fiscale deve avere 16 caratteri', 'dati'); i.tecnico.cf = cf }
      if (b?.tecnico?.nome !== undefined) i.tecnico.nome = String(b.tecnico.nome).slice(0, 80)
      if (b?.laboratorio?.piva !== undefined) { const p = String(b.laboratorio.piva).trim(); if (!pivaValida(p)) throw new CassaErrore('la P.IVA deve avere 11 cifre', 'dati'); i.laboratorio.piva = p }
      archivio.salvaImpostazioni(i)
      return azioni['GET stato-app']()
    },
    async 'GET cassa'() {
      const cassa = cassaCollegata()
      const [letture, web] = await Promise.all([cassa.sessione((s) => leggiCassa(s)), leggiWeb(sess.web)])
      const a = archivio.cassa(sess.matricola)
      const v = valuta({ letture, web, profilo: profiloDi(), spunte: a.spunte, intestazioneVoluta: a.intestazioneVoluta, ultimiFirmware, adesso: adesso(), vp: a.vp || null })
      sess.ultimoStato = v
      if (v.modello) sess.modello = v.modello
      if (v.firmware) sess.firmware = v.firmware
      return { ...v, letta: oraItaliana(adesso()), intestazioneVoluta: a.intestazioneVoluta, spunte: a.spunte, profilo: a.profilo }
    },
    async 'POST spunta'(b) {
      cassaCollegata()
      const a = archivio.cassa(sess.matricola)
      a.spunte[String(b.id)] = !!b.valore
      archivio.salvaCassa(sess.matricola, a)
      return { ok: true }
    },
    async 'POST programma/intestazione'(b) {
      const cassa = cassaCollegata(); libera(); const c = conferma(b)
      const righe = preparaRighe(b.righe || [])
      const a = archivio.cassa(sess.matricola); a.intestazioneVoluta = righe.map((r) => ({ testo: r.testo, tipo: r.tipo })); archivio.salvaCassa(sess.matricola, a)
      return cassa.sessione((s) => impostaIntestazione(s, b.righe, { maxRighe: profiloDi().intestazioneMaxRighe }), { conferma: c })
    },
    async 'POST programma/aliquote'(b) {
      const cassa = cassaCollegata(); libera(); const c = conferma(b)
      return cassa.sessione((s) => impostaAliquote(s, b.valori || {}), { conferma: c })
    },
    async 'POST programma/ora'(b) {
      const cassa = cassaCollegata(); libera(); const c = conferma(b)
      return cassa.sessione((s) => impostaOra(s, { adesso: adesso() }), { conferma: c })
    },
    async 'POST tasto'(b) {
      cassaCollegata(); libera(); conferma(b)
      const codice = typeof b.tasto === 'string' && b.tasto in TASTI ? TASTI[b.tasto] : Number(b.tasto)
      return { display: await sess.web.premi(codice) }
    },
    async 'GET display'() { cassaCollegata(); return { display: await sess.web.display() } },
    async 'GET web/modulo'(_, q) {
      cassaCollegata()
      const nome = String(q.get('pagina') || '')
      if (!/^(Censimento|Attivazione|SelIntTec|ParamUpg)$/.test(nome)) throw new CassaErrore('pagina non ammessa', 'dati')
      return { pagina: nome, campi: leggiCampi(await sess.web.leggi(`/${nome}.htm`)), nota: 'SOLO LETTURA: il programma non invia mai questi moduli.' }
    },
    // procedure
    async 'POST procedura/avvia'(b) { cassaCollegata(); await sess.motore.avvia(String(b?.id)); return sess.motore.stato() },
    async 'GET procedura'() { return sess.motore?.stato() ?? null },
    async 'POST procedura/esegui'(b) { cassaCollegata(); sess.motore.esegui(Number(b.passo), b.input || {}).catch(() => {}); return sess.motore.stato() },
    async 'POST procedura/controlla'(b) { cassaCollegata(); const x = await sess.motore.controlla(Number(b.passo)); return { rilettura: x, procedura: sess.motore.stato() } },
    async 'POST procedura/segna'(b) { cassaCollegata(); await sess.motore.segna(Number(b.passo)); return sess.motore.stato() },
    async 'POST procedura/annulla'() { sess.motore?.annulla(); return null },
    // check-list
    async 'GET checklist'() {
      cassaCollegata()
      const a = archivio.cassa(sess.matricola)
      return { campi: CAMPI, righe: righeComposte(a.checklist), dati: datiComposti(a.checklist, baseChecklist()) }
    },
    async 'POST checklist'(b) {
      cassaCollegata()
      const a = archivio.cassa(sess.matricola)
      if (b?.dati) a.checklist.dati = { ...a.checklist.dati, ...Object.fromEntries(CAMPI.map(([k]) => k).filter((k) => k in b.dati).map((k) => [k, String(b.dati[k]).slice(0, k === 'nota' ? 50 : 120)])) }
      if (b?.spunte) a.checklist.spunte = { ...a.checklist.spunte, ...Object.fromEntries(RIGHE.map(([r]) => r).filter((r) => r in b.spunte).map((r) => [r, !!b.spunte[r]])) }
      archivio.salvaCassa(sess.matricola, a)
      return azioni['GET checklist']()
    },
    async 'GET registro'(_, q) { cassaCollegata(); return { righe: registro.coda(sess.matricola, Math.min(Number(q.get('righe')) || 200, 1000)), file: registro.file(sess.matricola) } },
  }

  const baseChecklist = () => {
    const i = archivio.impostazioni(); const v = sess.ultimoStato
    return { matricola: sess.matricola, pivaEsercente: v?.esercente?.piva || '', azzeramenti: v?.chiusure != null ? String(v.chiusure) : '', tecnicoCF: i.tecnico.cf, labPIVA: i.laboratorio.piva }
  }
  const contestoCl = () => { const a = archivio.cassa(sess.matricola); return { ip: sess.ip, modello: sess.modello, firmware: sess.firmware, profilo: profiloDi().nome, stato: a.checklist, base: baseChecklist() } }

  // ───────────────────────── il server ─────────────────────────
  const tokenBuf = Buffer.from(token)
  const server = http.createServer(async (req, res) => {
    const nega = (codice, t) => { res.writeHead(codice, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(t) }
    try {
      const host = String(req.headers.host || '')
      const p = server.address().port
      if (host !== `127.0.0.1:${p}` && host !== `localhost:${p}`) return nega(403, 'host non ammesso')
      const url = new URL(req.url, `http://127.0.0.1:${p}`)
      const m = /^\/([0-9a-f]+)(\/.*)?$/.exec(url.pathname)
      if (!m || m[1].length !== token.length || !timingSafeEqual(Buffer.from(m[1]), tokenBuf)) return nega(404, 'non trovato')
      const rest = m[2] || '/'
      const sicuro = (f) => { const dati = readFileSync(join(QUI, 'public', f)); res.writeHead(200, { 'Content-Type': TIPI[f.slice(f.lastIndexOf('.'))] || 'text/plain', 'Cache-Control': 'no-store' }); res.end(dati) }
      if (req.method === 'GET' && rest === '/') return sicuro('index.html')
      if (req.method === 'GET' && (rest === '/app.js' || rest === '/stile.css')) return sicuro(rest.slice(1))
      if (rest.startsWith('/api/')) {
        // le richieste che cambiano qualcosa devono venire da NOI (intestazione propria + JSON): un form altrui non le può fare
        if (req.method === 'POST' && (req.headers['x-strumenti-cassa'] !== '1' || !/application\/json/.test(req.headers['content-type'] || ''))) return nega(403, 'richiesta non ammessa')
        const origin = req.headers.origin
        if (origin && origin !== `http://127.0.0.1:${p}` && origin !== `http://localhost:${p}`) return nega(403, 'origine non ammessa')
        const nome = rest.slice(5)
        if (req.method === 'GET' && nome === 'checklist/stampa') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(paginaStampabile(contestoCl())) }
        if (req.method === 'GET' && nome === 'checklist/testo') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(testoRiepilogo(contestoCl())) }
        const f = azioni[`${req.method} ${nome}`]
        if (!f) return nega(404, 'azione sconosciuta')
        let corpo = null
        if (req.method === 'POST') {
          const parti = []; let tot = 0
          for await (const d of req) { tot += d.length; if (tot > 200_000) return nega(413, 'troppo grande'); parti.push(d) }
          try { corpo = parti.length ? JSON.parse(Buffer.concat(parti).toString('utf8')) : {} } catch { return nega(400, 'JSON non valido') }
        }
        try {
          const out = await f(corpo, url.searchParams)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          return res.end(JSON.stringify(out ?? null))
        } catch (e) {
          const d = descriviErrore(e)
          if (!(e instanceof CassaErrore || e instanceof WebErrore || e instanceof ProgrammaErrore || e instanceof PassoErrore)) console.error(e)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          return res.end(JSON.stringify({ errore: d.messaggio, dettaglio: d, tipo: e.tipo || e.name }))
        }
      }
      return nega(404, 'non trovato')
    } catch (e) { console.error(e); try { nega(500, 'errore interno') } catch {} }
  })

  await new Promise((ok) => server.listen(porta, '127.0.0.1', ok))
  const indirizzo = `http://127.0.0.1:${server.address().port}/${token}/`
  if (apri) execFile('open', [indirizzo], () => {})
  return {
    server, indirizzo, token, porta: server.address().port, sess, registro, archivio,
    chiudi: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()) }),
  }
}

// avvio da riga di comando
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const simulatore = args.includes('--simulatore')
  let sim = null
  if (simulatore) {
    const { avviaSimulatore } = await import('./test/k3-sim.mjs')
    sim = await avviaSimulatore({ porta: 0, conWeb: true })
    console.log(`Cassa FINTA su ${sim.host}: porta ${sim.porta} (protocollo) e ${sim.portaWeb} (web). Collega con IP ${sim.host} e questi numeri di porta.`)
  }
  const app = await avvia({ apri: !args.includes('--no-apri'), consentiLoopback: simulatore, simulatore: sim ? { host: sim.host, porta: sim.porta, portaWeb: sim.portaWeb } : null })
  console.log(`\nStrumenti cassa — GED Assistance Tecnico\n${app.indirizzo}\n\nL'indirizzo contiene un codice segreto: vale solo finché il programma è acceso. Chiudi con Ctrl+C.\nRegistro dei comandi: ${app.registro.cartella}\n`)
  const esci = () => { app.chiudi().then(() => sim?.chiudi()).then(() => process.exit(0)) }
  process.on('SIGINT', esci); process.on('SIGTERM', esci)
  // Avviato dall'app Tecnico: se l'app si chiude (o muore) il canale su stdin si chiude e il programma va via con lei,
  // senza lasciare server orfani con il loro codice segreto.
  if (args.includes('--con-padre')) { process.stdin.on('end', esci); process.stdin.on('close', esci); process.stdin.resume() }
}
