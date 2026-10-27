// LEGGE UN PDF VERO, SENZA RIDISEGNARLO. Porta in Node (zero dipendenze) di `LettorePdf.php` del CRM
// (crm-core/app/Services/Verificazione/Pdf/LettorePdf.php): stessa struttura, stesso ordine delle operazioni, perché il PDF
// che esce sia IDENTICO byte per byte a quello del CRM.
//
// Le stringhe sono «binarie» (latin1: un carattere = un byte), come in PHP. I flussi delle pagine non si decomprimono mai e si
// copiano byte per byte: è la garanzia che la grafica del modulo resta quella depositata.
//
// FORMA DEI VALORI (come nel CRM):
//   ['D', Map]  dizionario · ['A', [..]] array · ['N', 'Nome'] nome · ['R', num, gen] riferimento
//   ['S', 'testo grezzo']  numero, stringa, booleano, null · ['T', dizionario, byte]  flusso (byte ancora codificati)
import zlib from 'node:zlib'

const SPAZI = new Set([' ', '\n', '\r', '\t', '\f', '\0'])
const DELIM = ' \t\r\n\f\0()<>[]{}/%'

function errore(m) { return new Error(m) }

export class LettorePdf {
  constructor(byte) {
    if (!byte.startsWith('%PDF-')) throw errore('Il file non è un PDF.')
    this.byte = byte
    this.tabella = new Map()
    this.cache = new Map()
    this.flussiOggetti = new Map()
    this.datiFlussiOggetti = new Map()
    this.trailer = new Map()
    this.#leggiTabelle()
  }

  static daBuffer(buf) { return new LettorePdf(Buffer.from(buf).toString('latin1')) }

  pagine() {
    const catalogo = this.risolvi(this.trailer.get('Root') ?? null)
    const radice = this.risolvi(catalogo[1].get('Pages') ?? null)
    const pagine = []
    this.#raccogliPagine(catalogo[1].get('Pages'), radice, pagine, 0)
    return pagine
  }

  risolvi(valore) {
    let giri = 0
    while (Array.isArray(valore) && valore[0] === 'R') {
      valore = this.oggetto(valore[1])
      if (++giri > 32) throw errore('Catena di riferimenti circolare.')
    }
    return valore
  }

  oggetto(num) {
    if (this.cache.has(num)) return this.cache.get(num)
    const voce = this.tabella.get(num)
    if (voce === undefined) { const v = ['S', 'null']; this.cache.set(num, v); return v }
    let out
    if (voce[0] === 1) {
      const c = { p: voce[1] }
      this.#intero(this.byte, c); this.#intero(this.byte, c); this.#parola(this.byte, c, 'obj')
      let valore = this.#valore(this.byte, c)
      valore = this.#forseFlusso(this.byte, valore, c.p)
      out = valore
    } else {
      const [flusso, posizioni] = this.#flussoDiOggetti(voce[1])
      out = posizioni.has(num) ? this.#valore(flusso, { p: posizioni.get(num) }) : ['S', 'null']
    }
    this.cache.set(num, out)
    return out
  }

  decodifica(flusso) {
    const [, dizionario, dati0] = flusso
    let dati = dati0
    const filtri = this.risolvi(dizionario[1].get('Filter') ?? null)
    let parametri = this.risolvi(dizionario[1].get('DecodeParms') ?? null)
    let elenco = []
    if (Array.isArray(filtri) && filtri[0] === 'N') { elenco = [filtri[1]]; parametri = [parametri] }
    else if (Array.isArray(filtri) && filtri[0] === 'A') {
      elenco = filtri[1].map((f) => this.risolvi(f)[1])
      parametri = Array.isArray(parametri) && parametri[0] === 'A' ? parametri[1] : []
    }
    elenco.forEach((filtro, i) => {
      if (filtro !== 'FlateDecode') throw errore(`Filtro non gestito: ${filtro}`)
      let d
      try { d = zlib.inflateSync(Buffer.from(dati, 'latin1'), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('latin1') } catch { throw errore('Flusso compresso illeggibile.') }
      dati = this.#predittore(d, this.risolvi(parametri[i] ?? null))
    })
    return dati
  }

  // ── tabelle degli oggetti ──
  #leggiTabelle() {
    const coda = this.byte.slice(-1024)
    const m = [...coda.matchAll(/startxref\s+(\d+)/g)]
    if (!m.length) throw errore('startxref non trovato.')
    let offset = Number(m[m.length - 1][1])
    const visti = new Set()
    while (offset !== null && !visti.has(offset)) { visti.add(offset); offset = this.#leggiSezione(offset) }
  }

  #leggiSezione(offset) {
    const b = this.byte
    const c = { p: offset }
    this.#spazi(b, c)
    if (b.substr(c.p, 4) === 'xref') {
      c.p += 4
      this.#leggiTabellaClassica(c)
      this.#parola(b, c, 'trailer')
      const diz = this.#valore(b, c)
      this.#uniscaTrailer(diz[1])
      if (diz[1].has('XRefStm')) this.#leggiSezione(Number(diz[1].get('XRefStm')[1]))
      return diz[1].has('Prev') ? Number(diz[1].get('Prev')[1]) : null
    }
    this.#intero(b, c); this.#intero(b, c); this.#parola(b, c, 'obj')
    const dizionario = this.#valore(b, c)
    const flusso = this.#forseFlusso(b, dizionario, c.p)
    if (flusso[0] !== 'T') throw errore('Tabella compressa senza flusso.')
    const d = flusso[1][1]
    this.#uniscaTrailer(d)
    const larghezze = d.get('W')[1].map((w) => Number(w[1]))
    const indice = d.has('Index') ? d.get('Index')[1].map((v) => Number(v[1])) : [0, Number(d.get('Size')[1])]
    const dati = this.decodifica(flusso)
    const riga = larghezze.reduce((a, x) => a + x, 0)
    let p = 0
    for (let k = 0; k + 1 < indice.length; k += 2) {
      const [primo, quanti] = [indice[k], indice[k + 1]]
      for (let i = 0; i < quanti; i++, p += riga) {
        const campi = []
        let q = p
        for (const w of larghezze) {
          let n = 0
          for (let bb = 0; bb < w; bb++) n = n * 256 + (dati.charCodeAt(q + bb) || 0)
          campi.push(n); q += w
        }
        const tipo = larghezze[0] === 0 ? 1 : campi[0]
        const num = primo + i
        if (this.tabella.has(num)) continue
        if (tipo === 1) this.tabella.set(num, [1, campi[1]])
        else if (tipo === 2) this.tabella.set(num, [2, campi[1], campi[2]])
        else this.tabella.set(num, [0, 0])
      }
    }
    return d.has('Prev') ? Number(d.get('Prev')[1]) : null
  }

  #leggiTabellaClassica(c) {
    const b = this.byte
    for (;;) {
      this.#spazi(b, c)
      const m = this.#sticky(/(\d+)\s+(\d+)/y, b, c.p)
      if (!m) return
      c.p += m[0].length
      const [primo, quanti] = [Number(m[1]), Number(m[2])]
      for (let i = 0; i < quanti; i++) {
        this.#spazi(b, c)
        const e = this.#sticky(/(\d{10}) (\d{5}) ([nf])/y, b, c.p)
        if (!e) throw errore('Tabella degli oggetti malformata.')
        c.p += e[0].length
        const num = primo + i
        if (this.tabella.has(num)) continue
        this.tabella.set(num, e[3] === 'n' ? [1, Number(e[1])] : [0, 0])
      }
    }
  }

  #uniscaTrailer(diz) { for (const [k, v] of diz) if (!this.trailer.has(k)) this.trailer.set(k, v) }

  #flussoDiOggetti(num) {
    if (!this.flussiOggetti.has(num)) {
      const flusso = this.oggetto(num)
      const dati = this.decodifica(flusso)
      const d = flusso[1][1]
      const quanti = Number(this.risolvi(d.get('N'))[1])
      const primo = Number(this.risolvi(d.get('First'))[1])
      const numeri = dati.slice(0, primo).trim().split(/\s+/)
      const posizioni = new Map()
      for (let i = 0; i < quanti; i++) posizioni.set(Number(numeri[2 * i]), primo + Number(numeri[2 * i + 1]))
      this.flussiOggetti.set(num, posizioni)
      this.datiFlussiOggetti.set(num, dati)
    }
    return [this.datiFlussiOggetti.get(num), this.flussiOggetti.get(num)]
  }

  #predittore(dati, parametri) {
    if (!Array.isArray(parametri) || parametri[0] !== 'D') return dati
    const predittore = Number(parametri[1].get('Predictor')?.[1] ?? 1)
    if (predittore < 10) return dati
    const colonne = Number(parametri[1].get('Columns')?.[1] ?? 1)
    const uscita = []
    let precedente = '\0'.repeat(colonne)
    const riga = colonne + 1
    for (let p = 0; p + riga <= dati.length; p += riga) {
      const tipo = dati.charCodeAt(p)
      const corrente = dati.substr(p + 1, colonne)
      const nuova = []
      for (let i = 0; i < colonne; i++) {
        const sinistra = i > 0 ? nuova[i - 1] : 0
        const sopra = precedente.charCodeAt(i)
        const altoSx = i > 0 ? precedente.charCodeAt(i - 1) : 0
        const x = corrente.charCodeAt(i)
        let v
        switch (tipo) {
          case 1: v = x + sinistra; break
          case 2: v = x + sopra; break
          case 3: v = x + Math.trunc((sinistra + sopra) / 2); break
          case 4: v = x + this.#paeth(sinistra, sopra, altoSx); break
          default: v = x
        }
        nuova.push(v & 0xFF)
      }
      const s = String.fromCharCode(...nuova)
      uscita.push(s); precedente = s
    }
    return uscita.join('')
  }

  #paeth(a, b, c) {
    const p = a + b - c
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)]
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }

  #raccogliPagine(rif, nodo, pagine, profondita) {
    if (profondita > 32 || !Array.isArray(nodo) || nodo[0] !== 'D') return
    const tipo = nodo[1].get('Type')?.[1] ?? null
    if (tipo === 'Page') { pagine.push(rif); return }
    for (const figlio of this.risolvi(nodo[1].get('Kids') ?? ['A', []])[1]) this.#raccogliPagine(figlio, this.risolvi(figlio), pagine, profondita + 1)
  }

  // ── analisi dei valori ──
  #sticky(re, b, pos) { re.lastIndex = pos; return re.exec(b) }

  #spazi(b, c) {
    const n = b.length
    while (c.p < n) {
      const ch = b[c.p]
      if (SPAZI.has(ch)) c.p++
      else if (ch === '%') { while (c.p < n && b[c.p] !== '\n' && b[c.p] !== '\r') c.p++ }
      else return
    }
  }

  #intero(b, c) {
    this.#spazi(b, c)
    const m = this.#sticky(/[+-]?\d+/y, b, c.p)
    if (!m) throw errore(`Atteso un numero alla posizione ${c.p}.`)
    c.p += m[0].length
    return Number(m[0])
  }

  #parola(b, c, parola) {
    this.#spazi(b, c)
    if (b.substr(c.p, parola.length) !== parola) throw errore(`Attesa la parola «${parola}» alla posizione ${c.p}.`)
    c.p += parola.length
  }

  #delim(ch) { return DELIM.includes(ch) }

  #valore(b, c) {
    this.#spazi(b, c)
    const ch = b[c.p] ?? ''
    if (ch === '<' && (b[c.p + 1] ?? '') === '<') {
      c.p += 2
      const diz = new Map()
      for (;;) {
        this.#spazi(b, c)
        if (b.substr(c.p, 2) === '>>') { c.p += 2; return ['D', diz] }
        const chiave = this.#valore(b, c)
        if (!Array.isArray(chiave) || chiave[0] !== 'N') throw errore(`Chiave di dizionario non valida alla posizione ${c.p}.`)
        diz.set(chiave[1], this.#valore(b, c))
      }
    }
    if (ch === '[') {
      c.p++
      const el = []
      for (;;) {
        this.#spazi(b, c)
        if ((b[c.p] ?? ']') === ']') { c.p++; return ['A', el] }
        el.push(this.#valore(b, c))
      }
    }
    if (ch === '/') {
      const inizio = ++c.p
      while (c.p < b.length && !this.#delim(b[c.p])) c.p++
      return ['N', b.slice(inizio, c.p)]
    }
    if (ch === '(') {
      const inizio = c.p
      c.p++
      let livello = 1
      while (c.p < b.length && livello > 0) {
        const x = b[c.p]
        if (x === '\\') { c.p += 2; continue }
        if (x === '(') livello++
        else if (x === ')') livello--
        c.p++
      }
      return ['S', b.slice(inizio, c.p)]
    }
    if (ch === '<') {
      const fine = b.indexOf('>', c.p)
      const inizio = c.p
      c.p = fine + 1
      return ['S', b.slice(inizio, c.p)]
    }
    const r = this.#sticky(/(\d+)\s+(\d+)\s+R(?=[\s/[\]<>()%]|$)/y, b, c.p)
    if (r) { c.p += r[0].length; return ['R', Number(r[1]), Number(r[2])] }
    const inizio = c.p
    while (c.p < b.length && !this.#delim(b[c.p])) c.p++
    if (c.p === inizio) throw errore(`Valore non riconosciuto alla posizione ${c.p}.`)
    return ['S', b.slice(inizio, c.p)]
  }

  #forseFlusso(b, valore, pos) {
    if (!Array.isArray(valore) || valore[0] !== 'D') return valore
    const c = { p: pos }
    this.#spazi(b, c)
    if (b.substr(c.p, 6) !== 'stream') return valore
    c.p += 6
    if ((b[c.p] ?? '') === '\r') c.p++
    if ((b[c.p] ?? '') === '\n') c.p++
    const lunghezza = Number(this.risolvi(valore[1].get('Length') ?? ['S', '0'])[1])
    return ['T', valore, b.substr(c.p, lunghezza)]
  }
}
