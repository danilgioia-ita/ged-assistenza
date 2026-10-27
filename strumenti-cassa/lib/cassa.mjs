// IL CLIENT: un collegamento TCP alla cassa fiscale, i frame, le attese, gli errori.
//
// REGOLE (viste sulla K3F-N, non dedotte):
//  - UN SOLO COLLEGAMENTO ALLA VOLTA PER CASSA: una coda per indirizzo in tutto il processo; si chiude subito dopo il lavoro.
//  - PRIMA DI TUTTO 1008, e la matricola deve essere quella attesa: altrimenti non si manda NIENTE.
//  - UN COMANDO SENZA RISPOSTA NON E' «NON FATTO»: la cassa può eseguirlo dopo. Si segnala (NessunaRisposta, mutante) e
//    NON si rimanda: si rilegge lo stato. Un NAK invece vuol dire «non eseguito» e si ripete (al più tre volte).
//  - ERR99 = «guarda il 1015»: lo fa il client e porta il codice vero. Ci si FERMA al primo errore (nessun tentativo qui:
//    chi vuole aspettare — 1515 dopo la chiusura — lo decide chi chiama).
//  - TUTTO passa dalla lista bianca (listabianca.mjs) e dal livello di conferma della sessione.
//  - Solo indirizzi privati (10., 172.16-31., 192.168.).
import net from 'node:net'
import { ACK, costruisciFrame, erroreDelPayload, leggiFrame } from './protocollo.mjs'
import { spiegaErrore } from './errori.mjs'
import { classifica, ComandoNonAmmesso } from './listabianca.mjs'

export class CassaErrore extends Error { constructor(m, tipo) { super(m); this.name = new.target.name; this.tipo = tipo } }
export class IndirizzoNonAmmesso extends CassaErrore { constructor(ip) { super(`«${String(ip).slice(0, 40)}» non è un indirizzo di rete locale (10.x, 172.16-31.x, 192.168.x): non mi collego`, 'indirizzo') } }
export class ReteErrore extends CassaErrore { constructor(m) { super(m, 'rete') } }
export class CassaInLocale extends CassaErrore { constructor() { super('la cassa non risponde al programma: è in modalità tastiera (LOCAL) oppure ferma in attesa del POS. In LOCAL: portarla su R (Registrazione) e premere 2, 2, 2 e CHIAVE. Ferma sul POS: controllare il POS, poi spegnere e riaccendere', 'in_locale') } }
export class MatricolaDiversa extends CassaErrore {
  constructor(attesa, letta) { super(`la matricola della cassa («${letta}») non è quella attesa («${attesa}»): mi fermo senza mandare nulla`, 'matricola'); this.attesa = attesa; this.letta = letta }
}
export class ConfermaMancante extends CassaErrore {
  constructor(comando, nome, livello) { super(`il comando ${comando.slice(0, 5)} (${nome}) scrive sulla cassa e serve la ${livello === 'scritta' ? 'conferma scritta' : 'conferma con un clic'}: non è partito`, 'conferma'); this.livello = livello }
}
export class ErroreCassa extends CassaErrore {
  constructor(comando, spiegato) { super(`la cassa ha risposto ERR ${spiegato.codice} (${spiegato.titolo}) al comando ${comando.slice(0, 5)}: ${spiegato.spiegazione}`, 'errore_cassa'); this.comando = comando; this.spiegato = spiegato; this.codice = spiegato.codice }
}
export class NessunaRisposta extends CassaErrore {
  constructor(comando, mutante, ms) { super(`nessuna risposta al comando ${comando.slice(0, 5)} entro ${Math.round(ms / 1000)} s${mutante ? ': la cassa POTREBBE averlo eseguito. Non lo rimando: rileggo lo stato' : ''}`, 'nessuna_risposta'); this.comando = comando; this.mutante = mutante }
}
export class ConnessioneCaduta extends CassaErrore {
  constructor(comando, mutante) { super(`il collegamento è caduto durante il comando ${comando.slice(0, 5)}${mutante ? ': non si sa se è stato eseguito, rileggo lo stato' : ''}`, 'connessione_caduta'); this.comando = comando; this.mutante = mutante }
}
export class RispostaNonValida extends CassaErrore { constructor(m) { super(m, 'risposta_non_valida') } }

export function indirizzoPrivato(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip))
  if (!m) return false
  const [a, b, c, d] = m.slice(1).map(Number)
  if ([a, b, c, d].some((x) => x > 255)) return false
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

// quanto aspettare, per comando (secondi visti sul campo: 2006 e 8002 fino a 45 s, 2005 fino a 40 s)
function timeoutDi(cmd, base, rapido) {
  if (rapido) return base
  if (cmd.startsWith('2005')) return Math.max(base, 60_000)
  if (cmd.startsWith('2006') || cmd.startsWith('8002')) return Math.max(base, 45_000)
  if (cmd.startsWith('2002') || cmd.startsWith('64041') || cmd.startsWith('6303')) return Math.max(base, 30_000)
  return base
}

const attesaVera = (ms) => new Promise((r) => setTimeout(r, ms))
const CODA = new Map()

class Sessione {
  constructor(socket, cassa, conferma) {
    this.socket = socket; this.cassa = cassa; this.conferma = conferma
    this.matricola = ''; this.contatore = 0; this.buf = Buffer.alloc(0); this.aperta = true; this.inAttesa = null
    this.pre = []
    socket.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.inAttesa?.() })
    socket.on('close', () => { this.aperta = false; this.inAttesa?.() })
    socket.on('error', () => { this.aperta = false; this.inAttesa?.() })
  }

  log(tipo, testo) {
    const r = this.cassa.registro
    if (!r) return
    if (!this.matricola) { this.pre.push([tipo, testo]); return }
    r[tipo](this.matricola, testo)
  }
  svuotaPre() { for (const [t, x] of this.pre.splice(0)) this.cassa.registro?.[t](this.matricola, x) }

  chiudi(forza = true) {
    this.aperta = false
    if (forza) { this.socket.destroy(); return }
    this.socket.end()
    setTimeout(() => this.socket.destroy(), 300).unref()
  }

  async leggi(comando, timeoutMs, mutante) {
    const scadenza = Date.now() + timeoutMs
    for (;;) {
      const r = leggiFrame(this.buf)
      if (r.tipo === 'nak') { this.buf = this.buf.subarray(r.consumati); return 'nak' }
      if (r.tipo === 'frame') {
        this.buf = this.buf.subarray(r.consumati)
        if (this.aperta) this.socket.write(Buffer.from([ACK]))
        return r.frame.payload
      }
      if (r.tipo === 'storto') { this.buf = this.buf.subarray(r.consumati); throw new RispostaNonValida(`risposta della cassa illeggibile al comando ${comando.slice(0, 5)}: ${r.motivo}`) }
      if (!this.aperta) throw new ConnessioneCaduta(comando, mutante)
      const resta = scadenza - Date.now()
      if (resta <= 0) throw new NessunaRisposta(comando, mutante, timeoutMs)
      await new Promise((ok) => {
        const t = setTimeout(() => { this.inAttesa = null; ok() }, resta)
        this.inAttesa = () => { clearTimeout(t); this.inAttesa = null; ok() }
      })
    }
  }

  // uno scambio nudo: il comando DEVE essere già passato dalla lista bianca
  async scambio(comando, timeoutMs, mutante) {
    for (let nak = 0; ; nak++) {
      this.buf = Buffer.alloc(0)
      this.log('comando', comando)
      this.socket.write(costruisciFrame(this.contatore, comando))
      this.contatore = (this.contatore + 1) % 100
      let p
      try { p = await this.leggi(comando, timeoutMs, mutante) } catch (e) {
        this.log('errore', `${e.name}: ${e.message}`)
        if (e instanceof NessunaRisposta || e instanceof ConnessioneCaduta) this.chiudi()
        throw e
      }
      if (p === 'nak') {
        this.log('risposta', 'NAK (frame non accettato: il comando NON è stato eseguito)')
        if (nak >= 2) throw new RispostaNonValida(`la cassa ha rifiutato il frame del comando ${comando.slice(0, 5)} per tre volte (NAK)`)
        continue
      }
      this.log('risposta', p)
      if (!erroreDelPayload(p) && !p.startsWith(comando.slice(0, 4))) throw new RispostaNonValida(`la cassa ha risposto «${p.slice(0, 12)}» al comando ${comando.slice(0, 5)}: è la risposta di un altro comando`)
      return p
    }
  }

  /**
   * Manda un comando della lista bianca e restituisce il payload di una risposta SENZA errore.
   * Al primo errore della cassa si ferma: ErroreCassa col codice spiegato (ERR99 già risolto col 1015).
   */
  async manda(comando, opz = {}) {
    let c
    try { c = classifica(comando) } catch (e) {
      if (e instanceof ComandoNonAmmesso) this.log('rifiuto', e.message)
      throw e
    }
    if (c.livello === 'clic' && !(this.conferma.clic || this.conferma.scritta)) { this.log('rifiuto', `senza conferma: ${comando}`); throw new ConfermaMancante(comando, c.nome, 'clic') }
    if (c.livello === 'scritta' && !(this.conferma.clic && this.conferma.scritta)) { this.log('rifiuto', `senza conferma scritta: ${comando}`); throw new ConfermaMancante(comando, c.nome, 'scritta') }
    const mutante = c.tipo === 'scrittura'
    const timeoutMs = opz.timeoutMs ?? timeoutDi(comando, this.cassa.timeoutMs, this.cassa.rapido)
    const p = await this.scambio(comando, timeoutMs, mutante)
    const err = erroreDelPayload(p)
    if (!err) return p
    let codice = err.codice
    if (codice === 99 && !err.da1015) {
      const p2 = await this.scambio('1015', this.cassa.timeoutMs, false)
      const e2 = erroreDelPayload(p2)
      if (e2?.da1015 && e2.codice !== 0) codice = e2.codice
    }
    const sp = spiegaErrore(codice)
    this.log('errore', `ERR ${codice} ${sp.titolo}: ${sp.spiegazione}`)
    throw new ErroreCassa(comando, sp)
  }

  /** Come manda(), ma l'ERR99 (e 213/97/98) è «occupata»: restituisce null invece di lanciare. Per il ciclo su 1515. */
  async mandaSeLibera(comando, opz = {}) {
    try { return await this.manda(comando, opz) } catch (e) {
      if (e instanceof ErroreCassa && [213, 97, 98, 0].includes(e.codice)) return null
      throw e
    }
  }
}

export class Cassa {
  constructor({ ip, porta = 9100, matricolaAttesa = null, registro = null, timeoutMs = 10_000, timeoutConnessioneMs = 5_000, attendi = attesaVera, consentiLoopback = false, rapido = false } = {}) {
    if (!indirizzoPrivato(ip) && !(consentiLoopback && /^127\./.test(ip))) throw new IndirizzoNonAmmesso(ip)
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) throw new CassaErrore('porta non valida', 'configurazione')
    Object.assign(this, { ip, porta, matricolaAttesa, registro, timeoutMs, timeoutConnessioneMs, attendi, rapido })
  }
  get chiave() { return `${this.ip}:${this.porta}` }

  /** Una sessione: si entra nella coda della cassa, si apre, si legge 1008, si controlla la matricola, si lavora, si chiude. */
  sessione(lavoro, { conferma = {} } = {}) {
    const prima = CODA.get(this.chiave) ?? Promise.resolve()
    const questa = prima.catch(() => undefined).then(() => this.#esegui(lavoro, { clic: !!conferma.clic, scritta: !!conferma.scritta }))
    CODA.set(this.chiave, questa.catch(() => undefined))
    return questa
  }

  #apri() {
    return new Promise((ok, no) => {
      const s = net.connect({ host: this.ip, port: this.porta })
      s.setNoDelay(true)
      const t = setTimeout(() => { s.destroy(); no(new ReteErrore(`la cassa ${this.chiave} non risponde alla connessione entro ${Math.round(this.timeoutConnessioneMs / 1000)} s`)) }, this.timeoutConnessioneMs)
      s.once('connect', () => { clearTimeout(t); s.removeAllListeners('error'); ok(s) })
      s.once('error', (e) => { clearTimeout(t); no(new ReteErrore(`impossibile collegarsi alla cassa ${this.chiave}: ${e.message}`)) })
    })
  }

  async #apriEIdentifica(conferma) {
    let ultimo
    for (let t = 1; t <= 3; t++) {
      let s = null
      try {
        s = new Sessione(await this.#apri(), this, conferma)
        let p = null
        for (let k = 0; k < 2 && p === null; k++) {
          try { p = await s.scambio('1008', this.timeoutMs, false) } catch (e) { if (!(e instanceof NessunaRisposta)) throw e }
        }
        if (p === null) { s.chiudi(); throw new CassaInLocale() }
        return { s, p }
      } catch (e) {
        s?.chiudi()
        if (!(e instanceof ConnessioneCaduta || e instanceof ReteErrore) || t === 3) throw e
        ultimo = e
        await this.attendi(300)
      }
    }
    throw ultimo
  }

  async #esegui(lavoro, conferma) {
    const { s, p } = await this.#apriEIdentifica(conferma)
    try {
      const err = erroreDelPayload(p)
      if (err) throw new ErroreCassa('1008', spiegaErrore(err.codice))
      const matricola = p.slice(4).trim()
      if (!matricola) throw new RispostaNonValida('la risposta a 1008 non contiene la matricola')
      if (this.matricolaAttesa && !matricola.includes(this.matricolaAttesa)) {
        this.registro?.rifiuto(this.matricolaAttesa, `matricola letta «${matricola.slice(0, 24)}» diversa da quella attesa: sessione chiusa senza mandare nulla`)
        throw new MatricolaDiversa(this.matricolaAttesa, matricola.slice(0, 24))
      }
      s.matricola = matricola.slice(0, 24)
      s.svuotaPre()
      return await lavoro(s)
    } finally { s.chiudi(false) }
  }
}
