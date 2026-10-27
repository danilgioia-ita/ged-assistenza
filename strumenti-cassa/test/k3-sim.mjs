// SIMULATORE DELLA CASSA CUSTOM K3F-N, in memoria, per le prove. Le risposte vengono da quelle VERE viste il 15-16, 22 e 27
// ottobre 2026 (e dal simulatore di GED Connect, mocks/k3.ts, da cui riprende il comportamento di scontrini e annulli).
// Non è la cassa: i formati che il manuale dice e il campo non ha confermato sono quelli del manuale.
//
// Registra OGNI comando arrivato (`registro`), così le prove possono asserire cosa NON è mai partito (3006, 6401, 8007...).
// Ha anche un finto web server (Status.htm, index.htm, GetDisplay.cgi) con Basic auth utente = password = matricola.
import net from 'node:net'
import http from 'node:http'
import { ACK, ETX, STX, checksum, leggiFrame } from '../lib/protocollo.mjs'

const pausa = (ms) => new Promise((r) => setTimeout(r, ms))
const n9 = (n) => String(Math.max(0, Math.round(n))).padStart(9, '0')
const z2 = (n) => String(n).padStart(2, '0')

export function avviaSimulatore(o = {}) {
  const opz = { host: '127.0.0.1', matricola: 'STITE350592', invioMs: 120, statoInvio: 0, chiusure: 11, attiva: true, fiscalizzata: true, censita: true, chiave: true, demo: false, firmware: '15.04.05', modello: 'K3F-N', conWeb: false, ...o }
  const adesso = o.adesso || (() => new Date())
  let chiusure = opz.chiusure
  let nDoc = 0
  let step = 0
  let righe = []
  let pagato = 0
  let ultimoErrore = 0
  let invioFinoA = 0
  let controllatoDi = null
  let lettureStampate = 0
  let chiusuraRichiesta = false
  let ackRicevuti = 0
  let conn = null
  let inizioIntervento = false
  const docs = []
  const registro = []
  const trappole = []
  const stampe = []
  const guasti = [] // { quando(cmd, n), azione: 'tace'|'cade'|'err', eseguito }
  let nMut = 0
  let offsetOraMin = o.offsetOraMin || 0
  const stato = {
    chiave: opz.chiave, censita: opz.censita, attivata: opz.attiva, inServizio: opz.attiva, fiscalizzata: opz.fiscalizzata, demo: opz.demo,
    certificato: opz.attiva, dgfe: 0, ultimaChiusura: adesso(),
  }
  const intestazione = Array.from({ length: 9 }, (_, i) => ({ tipo: 1, testo: ['K3F-N', 'CUSTOM SPA', 'Via I. Newton, 4', '43010 Fontevivo (PR)', '', '', '', '', ''][i] }))
  let nRigheInt = 4
  const aliquote = []
  const base = [[22, 0, 0, '22,00%'], [10, 0, 0, '10,00%'], [4, 0, 1, '4,00%'], [0, 0, 1, ''], [0, 1, 0, 'N1 ESCLUSO'], [0, 2, 0, 'N2 NON SOGG.'], [0, 3, 0, 'N3 NON IMP.'], [0, 4, 0, 'N4 ESENTE'], [0, 5, 0, 'N5 REGIME MARGINE'], [0, 6, 0, 'N6 ALTRO'], [0, 0, 0, '']]
  base.forEach(([v, e, p, d], i) => aliquote.push({ valore: v, esente: e, prog: p, desc: d }))
  // 1,2: 22 e 10 non programmabili; 3,4 programmabili
  aliquote[0].prog = 0; aliquote[1].prog = 0; aliquote[2].prog = 1; aliquote[3].prog = 1
  const display = { testo: 'R  01/01/2026 12:00', tasti: [] }

  const oraCassa = () => new Date(adesso().getTime() + offsetOraMin * 60000)
  const rome = (d) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]))
    return { g: p.day, m: p.month, a: p.year.slice(2), h: String(+p.hour % 24).padStart(2, '0'), mi: p.minute, s: p.second }
  }
  const subtotale = () => righe.reduce((s, r) => s + Math.round((r.cent * (r.qtyMilli || 1000)) / 1000), 0)
  const err = (n) => { ultimoErrore = n; return n < 100 ? `ERR${z2(n)}` : 'ERR99' }
  const aggiungiDoc = (extra) => { nDoc++; const d = { chiusura: chiusure + 1, numero: nDoc, data: oraCassa(), totaleCent: subtotale(), tipo: 1, annullato: false, ...extra }; docs.push(d); return d }
  const occupataInvio = () => Date.now() < invioFinoA

  function chiudiGiornata() {
    chiusure += opz.saltoChiusure ?? 1; nDoc = 0; stato.ultimaChiusura = oraCassa()
    invioFinoA = Date.now() + opz.invioMs
  }

  async function esegui(cmd) {
    const h = cmd.slice(0, 4)
    if (occupataInvio() && !'1008|1012|1016|1017|1104|1015|1511|1013|1001|1106|1515'.includes(h)) return err(213)
    switch (h) {
      case '1008': return '1008' + opz.matricola
      case '1013': return '1013' + `${opz.modello} ${opz.firmware} 02/07/26`.padEnd(32, ' ')
      case '1214': return '12144'
      case '1512': return '15121'
      case '1009': return '100900'
      case '1209': return '1209000000'
      case '1023': return '10231107'
      case '1012': return '1012' + step
      case '1016': return '1016' + (step >= 1 && step <= 3 ? '100' : '000')
      case '1015': return '1015ERR' + String(ultimoErrore).padStart(3, '0')
      case '1104': return '1104' + String(chiusure).padStart(4, '0') + String(stato.dgfe).padStart(4, '0')
      case '1001': { const r = rome(oraCassa()); return '1001' + r.g + r.m + r.a + r.h + r.mi }
      case '1106': { const r = rome(stato.ultimaChiusura); return '1106' + r.g + r.m + r.a + r.h + r.mi + r.s }
      case '1511': {
        const f = (b) => (b ? '1' : '0')
        let p = '1511' + '1' + opz.matricola.padEnd(11, ' ') + ' '.repeat(10) + f(stato.chiave) + f(stato.censita) + f(stato.attivata) + f(stato.inServizio) + '000000' + '0' + f(stato.demo) + '1' + '0' + '0' + '2'
        if (cmd === '15111') p += f(stato.certificato) + (stato.certificato ? '260826' + '260834' : '000000000000')
        return p
      }
      case '1017': {
        const d = docs[docs.length - 1]
        if (!d) return err(3)
        const r = rome(d.data)
        return '1017' + r.g + r.m + r.a + r.h + r.mi + String(d.numero).padStart(4, '0') + n9(d.totaleCent) + String(d.tipo) + (d.annullato ? '1' : '0')
      }
      case '1003': { const sub = subtotale(); const resta = sub - pagato; return '1003' + n9(0) + n9(0) + n9(0) + n9(0) + '+' + n9(sub) + (resta > 0 ? '+' : '-') + n9(Math.abs(resta)) + String(nDoc).padStart(4, '0') + '1' }
      case '6801': return '6801' + nRigheInt
      case '1002': { const i = Number(cmd[4]); const r = intestazione[i - 1]; return '1002' + i + r.tipo + z2(r.testo.length) + r.testo }
      case '6302': {
        const i = Number(cmd[4]); const tipo = Number(cmd[5]); const l = Number(cmd.slice(6, 8)); const t = cmd.slice(8, 8 + l)
        if (t.length !== l) return err(3)
        intestazione[i - 1] = { tipo, testo: t.trim() === '' ? '' : t }
        return '6302'
      }
      case '6301': nRigheInt = Number(cmd[4]); return '6301'
      case '6303': return '6303' + '0001' + '0100'
      case '7112': { const i = Number(cmd.slice(4, 6)); const a = aliquote[i - 1]; if (!a) return err(3); return '7112' + z2(i) + String(Math.round(a.valore * 100)).padStart(4, '0') + a.esente + a.prog + a.desc.padEnd(25, ' ') }
      case '7113': {
        const i = Number(cmd.slice(4, 6)); const a = aliquote[i - 1]
        if (!a || !a.prog) return err(3)
        if (chiusuraNecessariaPerAliquote) return err(54)
        a.valore = Number(cmd.slice(6, 10)) / 100; a.esente = Number(cmd[10]); a.desc = cmd.slice(13, 13 + Number(cmd.slice(11, 13)))
        return '7113' + z2(i)
      }
      case '2001': {
        const g = cmd.slice(4); const d = new Date(Date.UTC(2000 + Number(g.slice(4, 6)), Number(g.slice(2, 4)) - 1, Number(g.slice(0, 2)), Number(g.slice(6, 8)), Number(g.slice(8, 10))))
        // la cassa va a quell'ora: l'offset diventa la differenza fra l'ora scritta (Roma) e quella del Mac (Roma)
        const mac = rome(adesso())
        const macMin = Date.UTC(2000 + Number(mac.a), Number(mac.m) - 1, Number(mac.g), Number(mac.h), Number(mac.mi)) / 60000
        offsetOraMin = d.getTime() / 60000 - macMin
        return '20010'
      }
      case '2002': {
        if (step !== 0) return err(5)
        chiudiGiornata()
        return '2002'
      }
      case '2005': {
        if (!stato.chiave) return err(3)
        if (stato.fiscalizzata) return err(3)
        stato.fiscalizzata = true; stato.dgfe = 0
        return '2005'
      }
      case '2006': {
        if (occupataInvio()) return err(213)
        await pausa(opz.ritardo2006Ms || 5)
        stampe.push(cmd)
        return '2006'
      }
      case '8008': return '8008' + '000'
      case '8007': return err(32)
      case '8002': { stampe.push(cmd); return '8002' }
      case '6404': {
        if (cmd[4] === '0') { inizioIntervento = true; return '6404' }
        if (cmd[4] === '1') {
          if (!inizioIntervento) return err(5)
          inizioIntervento = false
          if (opz.chiusuraAutomatica !== false) setTimeout(() => { if (step === 0) chiudiGiornata() }, opz.ritardoZautoMs ?? 60)
          return '6404'
        }
        return err(3)
      }
      case '3301': {
        const tipo = cmd[4]
        if (tipo === '8') { if (step !== 1 && step !== 2) return err(5); step = 0; righe = []; pagato = 0; aggiungiDoc({ annullato: true }); return '3301' }
        if (tipo !== '1') return err(3)
        const lun = Number(cmd.slice(17, 19)); const descr = cmd.slice(19, 19 + lun); const coda = cmd.slice(19 + lun)
        if (!/^\d{9}$/.test(cmd.slice(5, 14)) || cmd.slice(14, 17) !== '001' || descr.length !== lun || !/^\d{9}(0\d|1[01])$/.test(coda)) return err(3)
        if (opz.erroreSuRiga) return err(opz.erroreSuRiga)
        if (step !== 0 && step !== 1) return err(5)
        step = 1; righe.push({ cent: Number(coda.slice(0, 9)), qtyMilli: Number(cmd.slice(5, 14)) })
        return '3301'
      }
      case '3006': trappole.push(cmd); pagato = subtotale(); step = 3; return '3006-' + n9(0)
      case '3007': {
        if (step !== 1 && step !== 2) return err(5)
        const paym = cmd.slice(4, 6); const lun = Number(cmd.slice(8, 10)); const imp = cmd.slice(10 + lun)
        if (!/^\d{9}$/.test(imp)) return err(3)
        const cent = Number(imp)
        if (cent > subtotale() - pagato) return err(46)
        if (paym === '09') return err(3)
        pagato += cent; step = pagato >= subtotale() ? 3 : 2
        const r = subtotale() - pagato
        return '3007' + (r > 0 ? '+' : '-') + n9(Math.abs(r))
      }
      case '3011': if (step !== 3) return err(5); chiusuraRichiesta = true; return '3011'
      case '3013': {
        if (step !== 3 || !chiusuraRichiesta) return err(5)
        aggiungiDoc({}); step = 0; righe = []; pagato = 0; chiusuraRichiesta = false
        return '3013'
      }
      case '1515': {
        if (occupataInvio()) return err(213)
        return '1515' + '0' + cmd.slice(5, 9) + '0000' + String(opz.statoInvio) + (opz.statoInvio === 0 ? '12345678901234567890' : '')
      }
      case '7101': {
        if (cmd[4] !== 'A') { if (cmd === '71010') lettureStampate++; return err(3) }
        const z = Number(cmd.slice(5, 9)); const n = Number(cmd.slice(9, 13)); const gg = cmd.slice(13, 19); const oper = cmd[19]
        if (oper === '0') { lettureStampate++; return '71011' }
        const doc = docs.find((d) => d.chiusura === z && d.numero === n && !d.annullato && d.tipo === 1)
        const esiste = docs.find((d) => d.chiusura === z && d.numero === n)
        const r = rome(doc?.data || esiste?.data || oraCassa())
        const dataOk = gg === r.g + r.m + r.a
        if (oper === '8') {
          if (stato.demo || !esiste || !dataOk) { controllatoDi = null; return '71010' }
          if (!doc || doc.annullatoDa) { controllatoDi = null; return '71012' }
          controllatoDi = doc; return '71011'
        }
        if (!doc || controllatoDi !== doc) return err(5)
        aggiungiDoc({ tipo: 3 }); doc.annullatoDa = nDoc; controllatoDi = null
        return '71011'
      }
      default: return err(3)
    }
  }
  let chiusuraNecessariaPerAliquote = !!opz.chiusuraPerAliquote

  async function gestisci(s) {
    let buf = Buffer.alloc(0); let coda = Promise.resolve()
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      coda = coda.then(async () => {
        for (;;) {
          let i = 0
          while (i < buf.length && buf[i] === ACK) { ackRicevuti++; i++ }
          buf = buf.subarray(i)
          if (buf.length === 0) return
          const r = leggiFrame(buf)
          if (r.tipo === 'incompleto') return
          if (r.tipo === 'nak') { buf = buf.subarray(r.consumati); continue }
          if (r.tipo === 'storto') { buf = buf.subarray(r.consumati); s.write(Buffer.from([0x15])); continue }
          buf = buf.subarray(r.consumati)
          const cmd = r.frame.payload
          const mutante = !/^(1003|1008|1009|1012|1013|1015|1016|1017|1001|1002|1023|1104|1106|1209|1214|1511|1512|1515|6801|7012|7112|8008)/.test(cmd)
          if (mutante) nMut++
          const g = guasti.find((x) => x.quando(cmd, nMut))
          if (g) {
            guasti.splice(guasti.indexOf(g), 1)
            if (g.eseguito) await esegui(cmd)
            registro.push({ cmd, risposta: `(guasto: ${g.azione}${g.eseguito ? ', eseguito' : ', NON eseguito'})` })
            if (g.azione === 'cade') s.destroy()
            continue
          }
          if (opz.silenzioSu && cmd.startsWith(opz.silenzioSu)) { registro.push({ cmd, risposta: '(silenzio)' }); if (opz.silenzioEseguito) await esegui(cmd); continue }
          const p = await esegui(cmd)
          registro.push({ cmd, risposta: p })
          const corpo = z2(r.frame.contatore) + '0' + p
          if (!s.destroyed) s.write(Buffer.concat([Buffer.from([ACK, STX]), Buffer.from(corpo + checksum(corpo), 'ascii'), Buffer.from([ETX])]))
        }
      }).catch(() => undefined)
    })
    s.on('close', () => { if (conn === s) conn = null })
    s.on('error', () => undefined)
  }

  // ───── finto web server ─────
  const html = {
    status: () => `<html><body><header><table><tr><td class="headertableright">Matricola: ${opz.matricola}<br>${opz.firmware}<br>16/07/26</td></tr></table></header><div class="infostatus"><table>` +
      [['MATRICOLA RT', opz.matricola], ['FISCALIZZATA', stato.fiscalizzata ? 'SI' : 'NO'], ['STATO MACCHINA', stato.attivata ? 'IN SERVIZIO' : 'NON ATTIVATA'], ['N. CHIUSURE', String(chiusure)], ['CHIAVE PRIVATA', stato.chiave ? 'SI' : 'NO'], ['CERTIFICATO', stato.certificato ? 'SI' : 'NO'], ['CERT.VALIDO FINO', '26/08/2034'], ['CF/PIVA ESERCENTE', opz.pivaEsercente || '11142291217']]
        .map(([k, v]) => `<tr><td class="infoleft">${k}:</td><td>${v}</td></tr>`).join('') + '</table></div></body></html>',
    index: () => `<html><body><header><table><tr><td class="headertablecenter">WEB SERVER DI ${opz.modello}<td class="headertableright">Matricola: ${opz.matricola}<br>${opz.firmware}<br>16/07/26</td></tr></table></header><a href="ExpCorNO.htm">Corrispettivi non inviati (${opz.nonInviati ?? 0})</a><a href="ExpCorKO.htm">Corrispettivi falliti (${opz.falliti ?? 0})</a></body></html>`,
  }
  const webRichieste = []
  const web = http.createServer((req, res) => {
    const auth = 'Basic ' + Buffer.from(`${opz.matricola}:${opz.matricola}`).toString('base64')
    webRichieste.push({ metodo: req.method, url: req.url })
    if (req.headers.authorization !== auth) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Custom K3"' }); return res.end('no') }
    const parti = []
    req.on('data', (d) => parti.push(d))
    req.on('end', () => {
      if (req.url === '/Status.htm') return res.end(html.status())
      if (req.url === '/index.htm') return res.end(html.index())
      if (req.url === '/Censimento.htm') return res.end('<form method="POST"><input class="filltext" name="CfTecnico" type="text" value=""><input name="CfLaboratorio" type="text" value=""><input name="Captcha" type="text"><input type="submit" name="Censimento" value="conferma"></form>')
      if (req.url === '/GetDisplay.cgi') {
        if (req.method === 'POST') { const k = /KeyPressed=(\d+)/.exec(Buffer.concat(parti).toString()); if (k) { display.tasti.push(Number(k[1])); display.testo = `tasto ${k[1]}` } }
        return res.end(`<textarea>${display.testo}</textarea>`)
      }
      res.writeHead(404); res.end('no')
    })
  })

  return new Promise((ok) => {
    const server = net.createServer((s) => {
      if (conn && !conn.destroyed) { s.destroy(); return }
      conn = s; gestisci(s)
    })
    server.listen(opz.porta ?? 0, opz.host, async () => {
      let portaWeb = null
      if (opz.conWeb || opz.webPorta) { await new Promise((r) => web.listen(opz.webPorta ?? 0, opz.host, r)); portaWeb = web.address().port }
      ok({
        host: opz.host, porta: server.address().port, portaWeb, registro, trappole, stampe, webRichieste, display, stato, docs, intestazione, aliquote,
        get letture() { return lettureStampate },
        get acks() { return ackRicevuti },
        comandi: () => registro.map((r) => r.cmd),
        guasti,
        imposta(x) { Object.assign(opz, x); if ('chiusuraPerAliquote' in x) chiusuraNecessariaPerAliquote = !!x.chiusuraPerAliquote; if ('offsetOraMin' in x) offsetOraMin = x.offsetOraMin },
        statoInterno: () => ({ step, chiusure, nDoc, inizioIntervento, nRigheInt, offsetOraMin }),
        chiudi: () => new Promise((r) => { conn?.destroy(); web.close(); web.closeAllConnections?.(); server.close(() => r()) }),
      })
    })
  })
}
