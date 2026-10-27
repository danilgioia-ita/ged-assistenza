// Il web server della cassa (http://<IP>/, Basic auth con utente e password = matricola).
//
// SOLO LETTURA DI PAGINE + LA TASTIERA REMOTA. Le pagine di scrittura (Censimento, Attivazione, SelIntTec, ParamUpg) si
// possono leggere (i campi) ma NON si inviano mai: qui non esiste nessun POST se non a GetDisplay.cgi, e con codici di
// tasto di una lista chiusa.
import http from 'node:http'

const PAGINE_LEGGIBILI = /^\/(Status|index|ExpCorOK|ExpCorNO|ExpCorKO|ExpCorEx|Censimento|Attivazione|SelIntTec|ParamUpg|ExtKeyboard|TinyKeyboard)\.htm$|^\/GetDisplay\.cgi$/

// I tasti che il pannello della tastiera remota offre (codici di ExtKeyboard.htm): cifre, CHIAVE, CANCELLA, SUBTOTALE, TOTALE,
// X, punto, 00/000, SHIFT, VAI_R/X/Z/P. Niente ZREPORT, niente annulli: quelli si fanno sul pannello vero, guardando la cassa.
export const TASTI = {
  CHIAVE: 1, CANCELLA: 3, X: 42, '.': 43, '000': 46, '00': 47,
  0: 48, 1: 49, 2: 50, 3: 51, 4: 52, 5: 53, 6: 54, 7: 55, 8: 56, 9: 57,
  SUBTOTALE: 101, TOTALE: 102, SHIFT: 95, VAI_R: 941, VAI_X: 942, VAI_Z: 943, VAI_P: 944,
}
const CODICI_TASTI = new Set(Object.values(TASTI))

export class WebErrore extends Error { constructor(m) { super(m); this.name = 'WebErrore' } }

export function creaWeb({ ip, matricola, porta = 80, timeoutMs = 5000, registro = null, attesaTastoMs = 700 }) {
  const auth = 'Basic ' + Buffer.from(`${matricola}:${matricola}`).toString('base64')
  function chiedi(metodo, path, corpo) {
    return new Promise((ok, no) => {
      const req = http.request({ host: ip, port: porta, method: metodo, path, headers: { Authorization: auth, ...(corpo ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(corpo) } : {}) }, timeout: timeoutMs }, (res) => {
        const parti = []
        res.on('data', (d) => parti.push(d))
        res.on('end', () => {
          if (res.statusCode === 401) return no(new WebErrore('il web server della cassa rifiuta utente e password (devono essere uguali alla matricola)'))
          if (res.statusCode >= 400) return no(new WebErrore(`il web server della cassa ha risposto ${res.statusCode} a ${path}`))
          ok(Buffer.concat(parti).toString('latin1'))
        })
      })
      req.on('timeout', () => { req.destroy(); no(new WebErrore(`il web server della cassa non risponde (${path})`)) })
      req.on('error', (e) => no(new WebErrore(`web server della cassa non raggiungibile: ${e.message}`)))
      if (corpo) req.write(corpo)
      req.end()
    })
  }
  return {
    /** GET di una pagina della lista. */
    leggi(path) {
      if (!PAGINE_LEGGIBILI.test(path)) return Promise.reject(new WebErrore(`pagina ${path} non in lista`))
      return chiedi('GET', path)
    },
    async display() { return testoDisplay(await chiedi('GET', '/GetDisplay.cgi')) },
    /** Preme UN tasto della tastiera remota e rilegge il display. Va sempre dietro un clic dell'utente. */
    async premi(codice) {
      if (!Number.isInteger(codice) || !CODICI_TASTI.has(codice)) throw new WebErrore(`tasto ${codice} non ammesso`)
      registro?.web(matricola, `tasto ${codice}`)
      await chiedi('POST', '/GetDisplay.cgi', `KeyPressed=${codice}`)
      await new Promise((r) => setTimeout(r, attesaTastoMs))
      return testoDisplay(await chiedi('GET', '/GetDisplay.cgi'))
    },
  }
}

export const testoDisplay = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()

const dec = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()

/** Status.htm → { 'FISCALIZZATA': 'SI', ..., _firmware, _matricola, _modello } */
export function leggiStatus(html) {
  const r = {}
  for (const m of html.matchAll(/<td class="infoleft">([^<]*?)<\/td><td>([^<]*)<\/td>/g)) { const k = dec(m[1]).replace(/:$/, ''); if (!(k in r)) r[k] = dec(m[2]) }
  const h = /Matricola:\s*([A-Za-z0-9]+)<br>\s*([0-9]+\.[0-9]+\.[0-9]+)<br>\s*(\d\d\/\d\d\/\d\d)/.exec(html)
  if (h) { r._matricola = h[1]; r._firmware = h[2]; r._dataFirmware = h[3] }
  const mod = /WEB SERVER DI ([A-Z0-9-]+)/.exec(html)
  if (mod) r._modello = mod[1]
  return r
}

/** index.htm → corrispettivi non inviati / falliti / esportati + firmware. */
export function leggiIndice(html) {
  const n = (re) => { const m = re.exec(html); return m ? Number(m[1]) : null }
  const h = /Matricola:\s*([A-Za-z0-9]+)<br>\s*([0-9]+\.[0-9]+\.[0-9]+)/.exec(html)
  const mod = /WEB SERVER DI ([A-Z0-9-]+)/.exec(html)
  return {
    nonInviati: n(/non inviati \((\d+)\)/), falliti: n(/falliti \((\d+)\)/), esportati: n(/esportati \((\d+)\)/),
    firmware: h?.[2] ?? null, matricola: h?.[1] ?? null, modello: mod?.[1] ?? null,
  }
}

/** I campi di un modulo (SOLO LETTURA: serve a mostrare cosa chiede la cassa; il modulo non si invia mai). */
export function leggiCampi(html) {
  const out = []
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0]
    const g = (a) => new RegExp(`${a}="([^"]*)"`, 'i').exec(tag)?.[1] ?? null
    const nome = g('name')
    if (nome) out.push({ nome, tipo: g('type'), valore: g('value') })
  }
  return out
}
