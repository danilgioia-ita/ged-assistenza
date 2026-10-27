#!/usr/bin/env node
// STRUMENTI CASSA — GED Assistance Tecnico. Programma locale per il Mac del tecnico che comanda le casse fiscali
// Custom K3F-N in rete. Node puro, zero dipendenze.
//
//   node strumenti-cassa/server.mjs            apre il browser su http://127.0.0.1:<porta libera>/<token>/
//   node strumenti-cassa/server.mjs --no-apri  non apre il browser (stampa solo l'indirizzo)
//   --con-padre                                 esce da solo quando si chiude stdin (lo usa l'app Tecnico)
//   --indirizzo-su-file <percorso>              scrive l'indirizzo in un file riservato (600) e lo toglie all'uscita (lo usa l'app
//                                               Tecnico quando avvia il programma come job di launchd: niente stdout da leggere)
//   --inattivo-minuti <N>                       esce da solo dopo N minuti senza richieste (mai con un passo in corso)
//   --rimuovi-job <etichetta>                   all'uscita toglie il proprio job di launchd (un job lanciato con `launchctl submit` altrimenti
//                                               viene rilanciato da launchd dopo ogni uscita, con un codice nuovo)
//   node strumenti-cassa/server.mjs --simulatore  parte con una cassa FINTA (per provare l'interfaccia, mai sulla cassa vera)
//
// SICUREZZA: ascolta SOLO su 127.0.0.1; il token casuale è nell'indirizzo; si controllano Host e intestazione di richiesta,
// così una pagina web qualunque non può far partire comandi. Ai comandi verso la cassa provvede la lista bianca (lib/listabianca.mjs).
import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, rmSync, chmodSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { Cassa, ErroreCassa, CassaErrore, indirizzoPrivato } from './lib/cassa.mjs'
import { creaRegistro, cartellaDati, oraItaliana } from './lib/registro.mjs'
import { creaArchivio, cfValido, pivaValida } from './lib/archivio.mjs'
import { creaWeb, leggiIndice, leggiCampi, TASTI, WebErrore } from './lib/web.mjs'
import { leggiCassa, leggiWeb, valuta, conRiprova, interpreta1002, interpreta1104 } from './lib/stato.mjs'
import { impostaIntestazione, impostaAliquote, impostaOra, preparaRighe, STILI, ProgrammaErrore } from './lib/programma.mjs'
import { leggiStatus } from './lib/web.mjs'
import { Motore, PassoErrore, descriviErrore } from './lib/procedure.mjs'
import { cercaInRete } from './lib/rete.mjs'
import { baseDaCassa, datiComposti, migraDati, testoAppunto } from './lib/checklist.mjs'
import { componi, CAMPI, TIPI_SIGILLO, LUOGHI, RIFERIMENTI } from './lib/verifica.mjs'
import { generaModulo } from './lib/pdf/modulo.mjs'
import { decodificaPng } from './lib/pdf/png.mjs'
import { mkdirSync, writeFileSync, readFileSync as leggiFile, existsSync, unlinkSync } from 'node:fs'

const QUI = dirname(fileURLToPath(import.meta.url))
const leggiJson = (f) => JSON.parse(readFileSync(join(QUI, 'dati', f), 'utf8'))

const TIPI = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

export async function avvia(opz = {}) {
  const {
    porta = 0, apri = false, cartella = cartellaDati(), consentiLoopback = false,
    rapido = false, attesaTastoMs = 700, attendi = (ms) => new Promise((r) => setTimeout(r, ms)), adesso = () => new Date(), intervalloMs = 15_000, inattivoMs = 0, suInattivo = null, token = randomBytes(18).toString('hex'),
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
    webIndice: async () => { try { return leggiIndice(await conRiprova(() => sess.web.leggi('/index.htm'), { attendi })) } catch { return null } },
    impostazioni: () => archivio.impostazioni(),
    matricola: () => sess.matricola,
    firmwareUltimo: () => profiloDi().firmwareUltimo || ultimiFirmware.modelli[sess.modello] || null,
    checklist: {
      auto: (id, x) => { const c = archivio.cassa(sess.matricola); c.checklist.auto = { ...(c.checklist.auto || {}), [id]: x }; archivio.salvaCassa(sess.matricola, c) },
      firmware: () => ({ installato: sess.firmware, ultimo: profiloDi().firmwareUltimo || ultimiFirmware.modelli[sess.modello] || null }),
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
      return { matricola: m, profilo: c.profilo, nomeProfilo: profili[c.profilo]?.nome, ip: c.ip || '', nota: c.nota || '', vp: c.vp || null, dati: c.checklist?.dati || {}, righe: componi({ salvate: c.checklist?.risposte || {}, auto: c.checklist?.auto || {}, dati: migraDati(c.checklist?.dati), vp: c.vp || null }).righe.flatMap((s) => s.righe).filter((r) => r.valore && r.fonte !== 'proposta'), spunte: c.spunte || {}, registro: registro.coda(m, 40) }
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
      sess.baseLetta = null
      sess.motore = new Motore(ctxMotore())
      { const c = archivio.cassa(sess.matricola); c.ip = ip; archivio.salvaCassa(sess.matricola, c) }
      const imp = archivio.impostazioni(); imp.ultimaIp = ip; archivio.salvaImpostazioni(imp)
      registro.evento(sess.matricola, `collegata ${ip} (${sess.modello || '?'} ${sess.firmware || '?'})`)
      return azioni['GET stato-app']()
    },
    async 'POST scollega'() { libera(); Object.assign(sess, { cassa: null, web: null, ip: '', matricola: '', modello: null, firmware: null, motore: null, ultimoStato: null, baseLetta: null }); return azioni['GET stato-app']() },
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
      // uno dopo l'altro: il web server della cassa è lento se nello stesso momento parla anche il protocollo
      const letture = await cassa.sessione((s) => leggiCassa(s))
      const web = await leggiWeb(sess.web, { attendi })
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
      const { v, dati, base } = await verificaCorrente()
      const c = archivio.cassa(sess.matricola)
      return {
        campi: CAMPI, dati, base, righe: v.righe, risposte: v.risposte, modello: v.modello, mancano: v.mancano, avvisi: v.avvisi, precompilata: v.precompilata,
        esitoProposto: v.esitoProposto, scadenza: v.scadenza, conAggiornamento: v.conAggiornamento, salvate: c.checklist.risposte || {},
        firme: { tecnico: firmaEsiste('tecnico'), cliente: firmaEsiste('cliente') }, tipiSigillo: TIPI_SIGILLO, luoghi: LUOGHI, riferimenti: RIFERIMENTI,
        pdfPronto: v.mancano.length === 0,
      }
    },
    async 'POST checklist'(b) {
      cassaCollegata()
      const a = archivio.cassa(sess.matricola)
      const { base } = await baseChecklist(false)
      if (b?.dati) {
        const dati = migraDati(a.checklist.dati)
        for (const [k] of CAMPI) {
          if (!(k in b.dati)) continue
          const v = String(b.dati[k]).slice(0, 120)
          // uguale a quello dedotto dalla cassa: si lascia «seguire» la cassa; diverso (anche vuoto): è una correzione del tecnico e non si tocca più
          if (v === (base[k] ?? '')) delete dati[k]; else dati[k] = v
        }
        a.checklist.dati = dati
      }
      const r = { ...(a.checklist.risposte || {}) }
      const R = b?.risposte || {}
      for (const [k, ammessi] of [['sigillo_presente', ['si', 'no']], ['area_pubblica', ['si', 'no']], ['esito', ['positivo', 'negativo']], ['intervento', ['verifica', 'attivazione']], ['sigillo_tipo', Object.keys(TIPI_SIGILLO)], ['luogo', Object.keys(LUOGHI)], ['riferimento', Object.keys(RIFERIMENTI)]]) {
        if (k in R) { if (ammessi.includes(R[k])) r[k] = R[k]; else delete r[k] }
      }
      for (const k of ['versione_identificata', 'versione_installata', 'documento_chiusura']) if (k in R) { const v = String(R[k] ?? '').trim().slice(0, 40); if (v) r[k] = v; else delete r[k] }
      if ('aggiornamento_firmware' in R) r.aggiornamento_firmware = !!R.aggiornamento_firmware
      if (b?.voci) {
        const modello = r.sigillo_presente === 'no' ? '10.3' : '10.2'
        r.voci = { ...(r.voci || {}) }
        r.voci[modello] = { ...(r.voci[modello] || {}) }
        for (const [n, v] of Object.entries(b.voci)) { if (v === 'si' || v === 'no') r.voci[modello][n] = v; else delete r.voci[modello][n] }
      }
      r.aggiornata_il = new Date().toISOString()
      a.checklist.risposte = r
      archivio.salvaCassa(sess.matricola, a)
      return azioni['GET checklist']()
    },
    // «Conferma tutte SI» è un gesto del tecnico: le righe ancora proposte diventano risposte sue (la coppia del firmware resta com'è)
    async 'POST checklist/conferma-tutte-si'() {
      cassaCollegata()
      const { v } = await verificaCorrente(false)
      const a = archivio.cassa(sess.matricola)
      const r = { ...(a.checklist.risposte || {}) }
      const mod = v.modello
      r.voci = { ...(r.voci || {}) }; r.voci[mod] = { ...(r.voci[mod] || {}) }
      for (const s of v.righe) { if (s.ambulanti) continue; for (const x of s.righe) if (x.valore && x.fonte === 'proposta') r.voci[mod][x.numero] = x.valore }
      r.aggiornata_il = new Date().toISOString()
      a.checklist.risposte = r; archivio.salvaCassa(sess.matricola, a)
      return azioni['GET checklist']()
    },
    async 'POST checklist/firma'(b) {
      cassaCollegata()
      const chi = b?.chi === 'tecnico' ? 'tecnico' : b?.chi === 'cliente' ? 'cliente' : null
      if (!chi) throw new CassaErrore('di chi è la firma?', 'dati')
      const f = percorsoFirma(fileFirma(chi))
      if (b.cancella) { if (existsSync(f)) unlinkSync(f); return { ok: true } }
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.png || ''))
      if (!m) throw new CassaErrore('la firma deve essere un\'immagine PNG', 'dati')
      const buf = Buffer.from(m[1], 'base64')
      if (buf.length > 600_000 || !decodificaPng(buf)) throw new CassaErrore('la firma non si legge (serve un PNG non interlacciato, non troppo grande)', 'dati')
      writeFileSync(f, buf)
      registro.evento(sess.matricola, `firma ${chi} salvata`)
      return { ok: true }
    },
    async 'GET registro'(_, q) { cassaCollegata(); return { righe: registro.coda(sess.matricola, Math.min(Number(q.get('righe')) || 200, 1000)), file: registro.file(sess.matricola) } },
  }

  // ───────────────────────── la check-list ufficiale ─────────────────────────
  const fileFirma = (chi) => (chi === 'tecnico' ? 'firma-tecnico.png' : `firma-cliente-${sess.matricola.replace(/[^A-Za-z0-9]/g, '')}.png`)
  const percorsoFirma = (nome) => join(cartella, nome)
  const firmaEsiste = (chi) => existsSync(percorsoFirma(fileFirma(chi)))
  const leggiFirma = (nome) => { const f = percorsoFirma(nome); return /^firma-[A-Za-z0-9.-]+\.png$/.test(nome) && existsSync(f) ? leggiFile(f) : null }

  // I dati del modulo di partenza, dedotti da ciò che la cassa dice (intestazione, 1104, web server). Con un passo in corso
  // si usa l'ultima lettura: non si mette in coda una lettura dietro a una procedura.
  async function baseChecklist(fresco = true) {
    if (fresco && sess.cassa && !sess.motore?.run?.inEsecuzione) {
      try {
        const l = await sess.cassa.sessione(async (s) => {
          const righe = []
          for (let i = 1; i <= 9; i++) righe.push(interpreta1002(await s.manda('1002' + i))?.testo || '')
          return { righe, chiusure: interpreta1104(await s.manda('1104'))?.chiusure ?? null }
        })
        let webPiva = ''
        try { webPiva = leggiStatus(await conRiprova(() => sess.web.leggi('/Status.htm'), { attendi, tentativi: 2 }))['CF/PIVA ESERCENTE'] || '' } catch {}
        sess.baseLetta = { ...l, webPiva }
      } catch { /* la cassa non risponde: valgono i valori dell'ultima lettura */ }
    }
    const r = baseDaCassa({ matricola: sess.matricola, ...(sess.baseLetta || {}), modello: sess.modello || '', firmwareUltimo: profiloDi().firmwareUltimo || ultimiFirmware.modelli[sess.modello] || '', impostazioni: archivio.impostazioni() })
    if (r.base.cliente) { const c = archivio.cassa(sess.matricola); if (c.esercente !== r.base.cliente) { c.esercente = r.base.cliente; archivio.salvaCassa(sess.matricola, c) } }
    return r
  }

  async function verificaCorrente(fresco = true) {
    const c = archivio.cassa(sess.matricola)
    const { base, avvisi: avvisiBase } = await baseChecklist(fresco)
    const dati = datiComposti(migraDati(c.checklist.dati), base)
    const imp = archivio.impostazioni()
    const v = componi({
      salvate: c.checklist.risposte || {}, auto: c.checklist.auto || {}, dati,
      firmware: { installato: sess.firmware, ultimo: profiloDi().firmwareUltimo || ultimiFirmware.modelli[sess.modello] || null },
      firme: { tecnico: firmaEsiste('tecnico') ? fileFirma('tecnico') : null, cliente: firmaEsiste('cliente') ? fileFirma('cliente') : null },
      vp: c.vp || null, adesso: adesso(),
    })
    v.avvisi = [...avvisiBase, ...v.avvisi]
    return { v, dati, base, c, imp }
  }
  const contestoCl = async () => { const { v, dati } = await verificaCorrente(false); return { ip: sess.ip, modello: sess.modello, firmware: sess.firmware, profilo: profiloDi().nome, verifica: v, dati } }

  // ───────────────────────── il server ─────────────────────────
  const tokenBuf = Buffer.from(token)
  let ultimaAttivita = Date.now(); let inVolo = 0
  const server = http.createServer(async (req, res) => {
    ultimaAttivita = Date.now(); inVolo++; res.on('close', () => { inVolo--; ultimaAttivita = Date.now() })
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
        if (req.method === 'GET' && nome === 'modulo-ufficiale.pdf') {
          if (!sess.cassa) return nega(409, 'nessuna cassa collegata')
          const { v } = await verificaCorrente(false)
          if (v.mancano.length) return nega(409, 'Il modulo ufficiale non si genera: mancano ' + v.mancano.map((x) => x.cosa).join('; '))
          const pdf = generaModulo(v.pdf, { firma: leggiFirma })
          const nomeFile = `${sess.matricola}-VP-${oraItaliana(adesso()).replace(/[^0-9]/g, '').slice(0, 12)}.pdf`
          const cartellaModuli = join(cartella, 'moduli', sess.matricola.replace(/[^A-Za-z0-9]/g, ''))
          mkdirSync(cartellaModuli, { recursive: true })
          writeFileSync(join(cartellaModuli, nomeFile), pdf)
          registro.evento(sess.matricola, `modulo ufficiale generato: ${join(cartellaModuli, nomeFile)}`)
          res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nomeFile}"`, 'Cache-Control': 'no-store' })
          return res.end(pdf)
        }
        if (req.method === 'GET' && nome === 'checklist/testo') {
          const cx = await contestoCl()
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
          return res.end(testoAppunto(cx))
        }
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
  // Uscita per inattività: nessuna richiesta da N minuti, nessuna richiesta in volo, nessun passo di procedura in corso.
  let guardia = null
  if (inattivoMs > 0) {
    guardia = setInterval(() => {
      if (inVolo > 0 || sess.motore?.run?.inEsecuzione) return
      if (Date.now() - ultimaAttivita >= inattivoMs) { clearInterval(guardia); suInattivo?.() }
    }, Math.max(20, Math.min(30_000, Math.floor(inattivoMs / 4))))
    guardia.unref?.()
  }
  if (apri) execFile('open', [indirizzo], () => {})
  return {
    server, indirizzo, token, porta: server.address().port, sess, registro, archivio,
    chiudi: () => new Promise((ok) => { if (guardia) clearInterval(guardia); server.closeAllConnections?.(); server.close(() => ok()) }),
  }
}

// Scrive l'indirizzo (contiene il codice segreto) in un file leggibile solo dall'utente: prima il temporaneo a 600, poi rename,
// così chi lo legge non vede mai un file a metà.
export function scriviIndirizzoSuFile(percorso, indirizzo) {
  mkdirSync(dirname(percorso), { recursive: true, mode: 0o700 })
  const tmp = `${percorso}.${process.pid}.tmp`
  writeFileSync(tmp, indirizzo + '\n', { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, percorso)
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
  const valoreDi = (nome) => { const i = args.indexOf(nome); return i >= 0 && i + 1 < args.length ? args[i + 1] : null }
  const fileIndirizzo = valoreDi('--indirizzo-su-file')
  const minuti = Number(valoreDi('--inattivo-minuti'))
  let esciInattivo = () => {}
  const app = await avvia({ apri: !args.includes('--no-apri'), inattivoMs: minuti > 0 ? minuti * 60_000 : 0, suInattivo: () => esciInattivo(), consentiLoopback: simulatore, simulatore: sim ? { host: sim.host, porta: sim.porta, portaWeb: sim.portaWeb } : null })
  console.log(`\nStrumenti cassa — GED Assistance Tecnico\n${app.indirizzo}\n\nL'indirizzo contiene un codice segreto: vale solo finché il programma è acceso. Chiudi con Ctrl+C.\nRegistro dei comandi: ${app.registro.cartella}\n`)
  if (fileIndirizzo) scriviIndirizzoSuFile(fileIndirizzo, app.indirizzo)
  const job = valoreDi('--rimuovi-job')
  let uscendo = false
  const esci = () => {
    if (uscendo) return; uscendo = true
    if (fileIndirizzo) rmSync(fileIndirizzo, { force: true })
    app.chiudi().then(() => sim?.chiudi()).then(() => {
      // launchctl remove dà SIGTERM a questo stesso processo: se non arriva in fretta usciamo da soli
      if (job && /^[A-Za-z0-9._-]+$/.test(job)) execFile('/bin/launchctl', ['remove', job], () => process.exit(0))
      else process.exit(0)
    })
  }
  esciInattivo = esci
  process.on('SIGINT', esci); process.on('SIGTERM', esci)
  // Avviato dall'app Tecnico: se l'app si chiude (o muore) il canale su stdin si chiude e il programma va via con lei,
  // senza lasciare server orfani con il loro codice segreto.
  if (args.includes('--con-padre')) { process.stdin.on('end', esci); process.stdin.on('close', esci); process.stdin.resume() }
}
