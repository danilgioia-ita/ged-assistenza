// COMPONE UN PDF CON LE PAGINE DEL MODULO DEPOSITATO, E CI SCRIVE SOPRA. Porta in Node di `ScrittorePdf.php` del CRM, stesso
// ordine delle operazioni (numerazione degli oggetti compresa): a parità di dati il PDF esce identico byte per byte.
// Le pagine si copiano intatte; si aggiungono solo un flusso con testo e crocette e le immagini delle firme.
import zlib from 'node:zlib'
import { decodificaPng, riduci } from './png.mjs'

const lung = (s) => Buffer.byteLength(s, 'latin1')

export class ScrittorePdf {
  constructor() {
    this.oggetti = new Map()
    this.prossimo = 3
    this.sorgenti = new Map()
    this.pagine = []
    this.dizionariPagina = new Map()
    this.sopra = new Map()
    this.immagini = new Map()
    this.fontNormale = null
    this.fontGrassetto = null
    this._idSorgente = new WeakMap()
    this._nSorgenti = 0
  }

  importaPagina(lettore, indice) {
    const pagine = lettore.pagine()
    if (!pagine[indice]) throw new Error(`Il modulo non ha la pagina ${indice + 1}.`)
    if (!this._idSorgente.has(lettore)) this._idSorgente.set(lettore, ++this._nSorgenti)
    const chiave = this._idSorgente.get(lettore)
    if (!this.sorgenti.has(chiave)) this.sorgenti.set(chiave, { reader: lettore, mappa: new Map() })

    const pagina = lettore.risolvi(pagine[indice])
    const d = new Map(pagina[1])

    for (const e of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
      if (!d.has(e)) {
        let genitore = lettore.risolvi(d.get('Parent') ?? null)
        while (Array.isArray(genitore) && genitore[0] === 'D') {
          if (genitore[1].has(e)) { d.set(e, genitore[1].get(e)); break }
          genitore = lettore.risolvi(genitore[1].get('Parent') ?? null)
        }
      }
    }
    for (const k of ['Parent', 'StructParents', 'Annots', 'Tabs', 'B', 'Metadata']) d.delete(k)

    const risorseOrig = lettore.risolvi(d.get('Resources') ?? ['D', new Map()])
    const risorse = ['D', new Map(risorseOrig[1])]
    for (const sotto of ['Font', 'XObject']) if (risorse[1].has(sotto)) risorse[1].set(sotto, lettore.risolvi(risorse[1].get(sotto)))

    const contenuti = lettore.risolvi(d.get('Contents') ?? ['A', []])
    const elenco = contenuti?.[0] === 'A' ? contenuti[1] : [d.get('Contents')]
    d.delete('Type'); d.delete('Contents'); d.delete('Resources')

    const numPagina = this.prossimo++
    for (const [k, v] of [...d]) d.set(k, this.#copiaValore(chiave, v))
    d.set('Resources', this.#copiaValore(chiave, risorse))
    d.set('Contents', ['A', elenco.map((c) => this.#copiaValore(chiave, c))])

    this.pagine.push(numPagina)
    this.dizionariPagina.set(numPagina, d)
    this.sopra.set(numPagina, '')
    this.immagini.set(numPagina, new Map())
    return this.pagine.length - 1
  }

  disegna(pagina, operatori) { const n = this.pagine[pagina]; this.sopra.set(n, this.sopra.get(n) + operatori + '\n') }

  /** Registra un'immagine PNG e restituisce il nome da usare con «Do» su quella pagina (null se non si legge). */
  immagine(pagina, byte) {
    let img = decodificaPng(byte)
    if (!img) return null
    if (img.larghezza > 700) img = riduci(img, 700)
    const { larghezza, altezza } = img
    const maschera = this.#nuovoOggetto(`<< /Type /XObject /Subtype /Image /Width ${larghezza} /Height ${altezza} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length %d >>`, zlib.deflateSync(img.alfa, { level: 9 }).toString('latin1'))
    const num = this.#nuovoOggetto(`<< /Type /XObject /Subtype /Image /Width ${larghezza} /Height ${altezza} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${maschera} 0 R /Filter /FlateDecode /Length %d >>`, zlib.deflateSync(img.rgb, { level: 9 }).toString('latin1'))
    const numPagina = this.pagine[pagina]
    const m = this.immagini.get(numPagina)
    const nome = 'GedImg' + (m.size + 1)
    m.set(nome, num)
    return { nome, larghezza, altezza }
  }

  genera() {
    this.fontNormale ??= this.#nuovoOggetto('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    this.fontGrassetto ??= this.#nuovoOggetto('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
    const apri = this.#nuovoOggetto('<< /Length %d >>', 'q\n')
    const chiudi = this.#nuovoOggetto('<< /Length %d >>', '\nQ\n')

    for (const num of this.pagine) {
      const d = this.dizionariPagina.get(num)
      const contenuti = [...d.get('Contents')[1]]
      contenuti.unshift(['R', apri, 0])
      contenuti.push(['R', chiudi, 0])
      if (this.sopra.get(num) !== '') contenuti.push(['R', this.#nuovoOggetto('<< /Length %d >>', this.sopra.get(num)), 0])
      d.set('Contents', ['A', contenuti])

      const risorse = new Map(d.get('Resources')[1])
      const font = risorse.get('Font')?.[0] === 'D' ? new Map(risorse.get('Font')[1]) : new Map()
      font.set('GedF1', ['R', this.fontNormale, 0]); font.set('GedF2', ['R', this.fontGrassetto, 0])
      risorse.set('Font', ['D', font])
      if (this.immagini.get(num).size) {
        const xo = risorse.get('XObject')?.[0] === 'D' ? new Map(risorse.get('XObject')[1]) : new Map()
        for (const [nome, n] of this.immagini.get(num)) xo.set(nome, ['R', n, 0])
        risorse.set('XObject', ['D', xo])
      }
      d.set('Resources', ['D', risorse])
      this.oggetti.set(num, '<< /Type /Page /Parent 2 0 R ' + this.#serializza(['D', d]).slice(2))
    }

    const kids = this.pagine.map((n) => `${n} 0 R`).join(' ')
    this.oggetti.set(1, '<< /Type /Catalog /Pages 2 0 R >>')
    this.oggetti.set(2, `<< /Type /Pages /Kids [${kids}] /Count ${this.pagine.length} >>`)
    const ordine = [...this.oggetti.keys()].sort((a, b) => a - b)

    let uscita = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'
    const offsets = new Map()
    for (const num of ordine) { offsets.set(num, lung(uscita)); uscita += `${num} 0 obj\n${this.oggetti.get(num)}\nendobj\n` }
    const massimo = Math.max(...ordine)
    const xref = lung(uscita)
    uscita += `xref\n0 ${massimo + 1}\n0000000000 65535 f \n`
    for (let i = 1; i <= massimo; i++) uscita += offsets.has(i) ? `${String(offsets.get(i)).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n'
    uscita += `trailer << /Size ${massimo + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return Buffer.from(uscita, 'latin1')
  }

  #copiaValore(sorgente, valore) {
    if (!Array.isArray(valore)) return valore
    switch (valore[0]) {
      case 'R': return ['R', this.#copiaOggetto(sorgente, valore[1]), 0]
      case 'D': {
        const copia = new Map()
        for (const [k, v] of valore[1]) {
          if (k === 'Parent' || k === 'StructParent' || k === 'StructParents') continue
          copia.set(k, this.#copiaValore(sorgente, v))
        }
        return ['D', copia]
      }
      case 'A': return ['A', valore[1].map((v) => this.#copiaValore(sorgente, v))]
      case 'T': return ['T', this.#copiaValore(sorgente, valore[1]), valore[2]]
      default: return valore
    }
  }

  #copiaOggetto(sorgente, vecchio) {
    const mappa = this.sorgenti.get(sorgente).mappa
    if (mappa.has(vecchio)) return mappa.get(vecchio)
    const nuovo = this.prossimo++
    mappa.set(vecchio, nuovo)
    this.oggetti.set(nuovo, 'null')
    const originale = this.sorgenti.get(sorgente).reader.oggetto(vecchio)
    this.oggetti.set(nuovo, this.#serializza(this.#copiaValore(sorgente, originale)))
    return nuovo
  }

  #nuovoOggetto(dizionario, flusso = null) {
    const num = this.prossimo++
    this.oggetti.set(num, flusso === null ? dizionario : dizionario.replace('%d', String(lung(flusso))) + '\nstream\n' + flusso + '\nendstream')
    return num
  }

  #serializza(valore) {
    switch (valore[0]) {
      case 'R': return `${valore[1]} ${valore[2]} R`
      case 'N': return '/' + valore[1]
      case 'S': return valore[1]
      case 'A': return '[' + valore[1].map((v) => this.#serializza(v)).join(' ') + ']'
      case 'D': return '<< ' + [...valore[1]].map(([k, v]) => '/' + k + ' ' + this.#serializza(v)).join(' ') + ' >>'
      case 'T': {
        const dizionario = new Map(valore[1][1])
        dizionario.delete('Length')
        dizionario.set('Length', ['S', String(lung(valore[2]))])
        return this.#serializza(['D', dizionario]) + '\nstream\n' + valore[2] + '\nendstream'
      }
    }
    throw new Error('Valore PDF sconosciuto.')
  }
}
