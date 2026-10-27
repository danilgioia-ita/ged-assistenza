// IL MODULO UFFICIALE COMPILATO: le pagine depositate (Mod. 10.1 + 10.2 o 10.3), con sopra soltanto testo in stampatello,
// crocette dentro le caselle e le immagini delle firme. Porta in Node, riga per riga, di `ModuloUfficiale.php` del CRM
// (crm-core/app/Services/Verificazione/): LE COORDINATE SONO QUELLE MISURATE LÌ, e il PDF che esce è identico a quello del CRM
// a parità di dati (lo prova test/confronto-crm.test.mjs contro file generati dal codice PHP vero).
//
// «Se vogliamo mandargli la CHECK-LIST DI VERIFICA, che è ufficiale, dobbiamo mandargli per forza quella là che ti ho
// fornito. Questo è vincolante.» (Danilo, 17/9; ribadito il 27/10: «quella approvata e basta, ufficiale e depositata AE»)
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { LettorePdf } from './lettore.mjs'
import { ScrittorePdf } from './scrittore.mjs'

const QUI = dirname(fileURLToPath(import.meta.url))
export const CARTELLA_MODULI = join(QUI, '..', '..', 'dati', 'modulistica')
export const FILE_10_2 = 'MOD_10.1_10.2_RT_SIGILLO_INTEGRO_Rev2023-10-10.pdf'
export const FILE_10_3 = 'MOD_10.3_RT_PRIVO_SIGILLO_Rev0_2023-10-10.pdf'
export const TIPI_SIGILLO = { adesiva: 'Targhetta adesiva (All. «A» Provv. AdE 06/05/2010)', percussione: 'Percussione (piombo/PVC)', tamper: 'Tamper' }

const ALTEZZA_PAGINA = 841.92
const CASELLA = 6.2
const CORPO = 8.0
const CORPO_MINIMO = 5.5

const SINO_10_2 = {
  si: 510.2, no: 545.5,
  righe: { '1.1': 113.8, '1.2': 131.0, '1.3': 151.8, '1.5': 184.0, '1.6': 199.2, '1.7': 213.0, '2.1': 256.0, '2.2': 278.5, '2.3': 303.5, '2.4': 325.5, '2.5': 345.8, '2.6': 363.2, '2.7': 384.5, '2.8': 405.5, '2.9': 457.8, '2.10': 506.0, '2.11': 519.5, '2.12': 542.2, '2.13': 573.8, '2.14': 605.2, '3.1': 647.0, '3.2': 660.8, '3.3': 678.2, '4.1': 706.8, '4.2': 720.5, '4.3': 734.2 },
  sigillo: { y: 168.8, adesiva: 184.0, percussione: 389.8, tamper: 510.2 },
  non_applicabile: [510.2, 630.2],
  esito: { y: 748.5, positivo: 379.0, negativo: 478.2 },
  versione_identificata: [208, 297, 500], versione_installata: [199, 339, 500],
  documento: [235, 770.5, 322],
  scadenza: { linea: 770.5, mese: 494, anno: 532 },
  firme: { alto: 783.75, basso: 808.5, data: [49.25, 123.75], sigillo: [123.75, 208.75], tecnico: [208.75, 350.75], cliente: [350.75, 577.5] },
}
const SINO_10_3 = {
  si: 517.0, no: 545.5,
  righe: { '1.1': 114.0, '1.2': 130.5, '1.3': 151.0, '2.1': 194.0, '2.2': 216.0, '2.3': 245.5, '3.1': 301.2, '3.2': 319.5, '3.3': 333.2, '3.4': 347.0, '3.5': 369.0, '3.6': 392.5, '3.7': 414.2, '3.8': 434.5, '3.9': 451.2, '3.10': 471.5, '3.11': 491.5, '3.12': 531.0, '3.13': 567.2, '3.14': 580.8, '3.15': 602.5, '3.16': 632.2, '3.17': 662.2, '4.1': 695.0, '4.2': 708.8, '4.3': 722.8 },
  sigillo: { y: 168.0, adesiva: 184.0, percussione: 389.8, tamper: 517.0 },
  non_applicabile: null,
  esito: { y: 736.8, positivo: 379.0, negativo: 478.2 },
  versione_identificata: [201, 387, 500], versione_installata: [193, 427, 500],
  documento: [235, 758.5, 322],
  scadenza: { linea: 758.5, mese: 494, anno: 532 },
  firme: { alto: 772.0, basso: 796.75, data: [49.25, 123.75], sigillo: [123.75, 208.75], tecnico: [208.75, 350.75], cliente: [350.75, 577.5] },
}
const TESTATA = { linea: 94.5, nome: [49.25, 194.5], piva: [194.5, 340.0], modello: [340.0, 446.5], matricola: [446.5, 577.5] }
const PAGINA_1 = {
  richiesta_numero: [147, 75, 224], richiesta_data: [330, 72, 458], richiesta_ora: [482, 72, 572],
  cliente: [88, 89, 572], sede_legale: [105, 103, 572], sede_comune: [238, 117, 440], sede_provincia: [469, 117, 572],
  ubicazione: [136, 131, 572], ubicazione_comune: [238, 145, 440], ubicazione_provincia: [469, 145, 572],
  partita_iva: [101, 159, 380], codice_fiscale: [437, 159, 572], sdi: [197, 174, 295], pec: [324, 174, 572],
  marca: [98, 189, 295], modello: [348, 189, 572], matricola: [108, 204, 295], firmware_ultimo: [492, 204, 572],
  descrizione: [57, 296, 572], sottoscritto: [108, 712.5, 330],
  cap_sede: 117, cap_ubicazione: 145, cap_caselle: [130.75, 143.75, 155.75, 169.75, 184.0, 198.25],
  ubicazione_rt: { y: 210.0, fissa: 237.2, pubblica: 372.0 },
  interventi: {
    censimento: [56.5, 231.75], attivazione: [56.5, 241.0], verifica_periodica: [56.5, 250.2], disattivazione: [56.5, 259.5], dismissione: [56.5, 268.5],
    manutenzione: [308.25, 231.75], variazione_dati: [308.25, 241.0], memoria: [308.25, 250.25], firmware: [308.25, 259.5], altro: [308.25, 268.5],
  },
  luogo: { cliente: [74.5, 321.0], laboratorio: [74.5, 339.2], remoto: [74.5, 366.8] },
  riferimento: { pagamento: [304.8, 321.2], garanzia: [304.8, 344.0], abbonamento: [304.8, 367.8] },
  scadenza_abbonamento: { linea: 376, giorno: 511, mese: 532, anno: 559 },
  vp_si: [333.2, 622.0], vp_no: [404.25, 622.0],
  esito: { y: 645.5, positivo: 386.2, negativo: 478.2 },
  firme: { alto: 776.0, basso: 801.0, sigillo: [53.0, 177.0], tecnico: [177.0, 354.25], cliente: [354.25, 574.0] },
}

// ── PHP sprintf('%.nF') e iconv, riprodotti ──────────────────────────────────────────────────────
/** Come `%.nF` di PHP: arrotonda a metà verso la cifra pari sui pareggi esatti (0,125 → 0,12), dove toFixed va in su. */
export function fmt(x, d) {
  const lungo = x.toFixed(Math.min(100, d + 30))
  const punto = lungo.indexOf('.')
  const resto = lungo.slice(punto + 1 + d)
  if (/^50*$/.test(resto)) {
    const troncato = lungo.slice(0, punto + 1 + d)
    if (Number(troncato.slice(-1)) % 2 === 0) return troncato
  }
  return x.toFixed(d)
}

const CP1252_ALTO = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F }
/** UTF-8 → WinAnsi (CP1252), come `iconv('UTF-8', 'CP1252//TRANSLIT')`: ciò che non c'è diventa la lettera senza segno o «?». */
export function winAnsi(testo) {
  let out = ''
  for (const ch of testo) {
    const cp = ch.codePointAt(0)
    if (cp < 0x80 || (cp >= 0xA0 && cp <= 0xFF)) out += String.fromCharCode(cp)
    else if (CP1252_ALTO[cp]) out += String.fromCharCode(CP1252_ALTO[cp])
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
      out += /^[\x20-\x7e]$/.test(base) ? base : '?'
    }
  }
  return out
}

let LARGHEZZE = null
const metriche = () => (LARGHEZZE ??= JSON.parse(readFileSync(join(QUI, '..', '..', 'dati', 'helvetica-larghezze.json'), 'utf8')).larghezze)

export function leggiModulo(nome, cartella = CARTELLA_MODULI) {
  const buf = readFileSync(join(cartella, nome))
  const attesa = JSON.parse(readFileSync(join(cartella, 'IMPRONTE.json'), 'utf8'))[nome]
  const vera = createHash('sha256').update(buf).digest('hex')
  if (!attesa || vera !== attesa) throw new Error(`Il modulo «${nome}» non è quello depositato (impronta ${vera.slice(0, 12)}…, attesa ${String(attesa).slice(0, 12)}…): non genero niente.`)
  return LettorePdf.daBuffer(buf)
}

const cifreSole = (s) => String(s ?? '').replace(/\D/g, '')
const pieno = (v) => !(v === null || v === undefined || String(v).trim() === '')
const maiuscolo = (s) => s.trim().toUpperCase()

/**
 * `modello` è la forma stessa che il CRM dà a `ModuloUfficiale` (via `CheckListUfficiale`):
 *   { modello: '10.2'|'10.3', soloRapporto, sigilloPresente: 'si'|'no'|null, dati, risposte, voci: [[numero, 'si'|'no'], ...],
 *     areePubblicheDaCompilare, interventiRichiesti: [..], risposteSalvate }
 * `opzioni.firma(percorso)` restituisce i byte PNG di una firma, o null.
 */
export function generaModulo(m, opzioni = {}) {
  return new Compilatore(m, opzioni).genera()
}

class Compilatore {
  constructor(m, opzioni) { this.m = m; this.opz = opzioni; this.avvisi = []; this.pdf = new ScrittorePdf() }

  genera() {
    const m = this.m
    const a = leggiModulo(FILE_10_2)
    this.pdf.importaPagina(a, 0)
    if (m.soloRapporto) { /* niente pagina 2 */ }
    else if (m.modello === '10.3') this.pdf.importaPagina(leggiModulo(FILE_10_3), 0)
    else this.pdf.importaPagina(a, 1)
    this.compilaRapporto()
    if (!m.soloRapporto) this.compilaCheckList(m.modello === '10.3' ? SINO_10_3 : SINO_10_2)
    if (this.opz.avvisi) this.opz.avvisi(this.avvisi)
    return this.pdf.genera()
  }

  // ── pagina 1: Mod. 10.1 ──
  compilaRapporto() {
    const { dati: d, risposte: r = {}, risposteSalvate = {} } = this.m
    const p = PAGINA_1
    const pagina = 0
    for (const campo of ['richiesta_numero', 'richiesta_data', 'richiesta_ora', 'cliente', 'partita_iva', 'sdi', 'pec', 'marca', 'modello', 'matricola', 'firmware_ultimo', 'descrizione'])
      this.scriviCampo(pagina, campo, d[campo] ?? null, ...p[campo])
    this.scriviCampo(pagina, 'codice_fiscale', d.codice_fiscale_cliente ?? null, ...p.codice_fiscale)

    for (const [prefisso, chiave] of [['sede', 'sede_legale'], ['ubicazione', 'ubicazione']]) {
      const ind = d[chiave] || {}
      const campoIndirizzo = prefisso === 'sede' ? 'sede_legale' : 'ubicazione'
      this.scriviCampo(pagina, campoIndirizzo, ind.indirizzo ?? null, ...p[campoIndirizzo])
      this.scriviCampo(pagina, `${prefisso}_comune`, ind.comune ?? null, ...p[`${prefisso}_comune`])
      this.scriviCampo(pagina, `${prefisso}_provincia`, ind.provincia ?? null, ...p[`${prefisso}_provincia`])
      this.scriviCap(pagina, ind.cap ?? null, p[`cap_${prefisso}`])
    }
    this.scriviCampo(pagina, 'sottoscritto', d.cliente_firmatario ?? null, ...p.sottoscritto)

    for (const casella of this.m.interventiRichiesti) this.crocetta(pagina, ...p.interventi[casella])
    this.crocetta(pagina, ...p[this.m.soloRapporto ? 'vp_no' : 'vp_si'])

    const area = this.m.soloRapporto ? (risposteSalvate.area_pubblica ?? null) : (r.area_pubblica ?? null)
    if (area === 'si' || area === 'no') this.crocetta(pagina, p.ubicazione_rt[area === 'si' ? 'pubblica' : 'fissa'], p.ubicazione_rt.y)
    if (p.luogo[r.luogo ?? '']) this.crocetta(pagina, ...p.luogo[r.luogo])
    if (p.riferimento[r.riferimento ?? '']) {
      this.crocetta(pagina, ...p.riferimento[r.riferimento])
      if (r.riferimento === 'abbonamento' && d.contratto_fino_al) {
        const s = p.scadenza_abbonamento
        const [aa, mm, gg] = String(d.contratto_fino_al).slice(0, 10).split('-')
        this.testoCentrato(pagina, gg, s.giorno, s.linea, 20)
        this.testoCentrato(pagina, mm, s.mese, s.linea, 20)
        this.testoCentrato(pagina, aa.slice(-2), s.anno, s.linea, 20)
      }
    }
    if (!this.m.soloRapporto && p.esito[r.esito ?? ''] !== undefined && r.esito) this.crocetta(pagina, p.esito[r.esito], p.esito.y)

    const f = p.firme
    this.testoCentrato(pagina, d.tecnico_sigillo ?? null, (f.sigillo[0] + f.sigillo[1]) / 2, (f.alto + f.basso) / 2 + 3, f.sigillo[1] - f.sigillo[0] - 6, true)
    this.firma(pagina, d.tecnico_firma ?? null, f.tecnico, f.alto, f.basso, d.tecnico_nome ?? null)
    this.firma(pagina, d.cliente_firma ?? null, f.cliente, f.alto, f.basso, null)
  }

  // ── pagina 2: Mod. 10.2 / 10.3 ──
  compilaCheckList(mm) {
    const { dati: d, risposte: r = {} } = this.m
    const pagina = 1
    const t = TESTATA
    const celle = { nome: d.cliente ?? null, piva: d.partita_iva ?? d.codice_fiscale_cliente ?? null, modello: d.modello ?? null, matricola: d.matricola ?? null }
    for (const [cella, valore] of Object.entries(celle)) {
      const [sx, dx] = t[cella]
      if (cella === 'nome' && valore && this.larghezza(maiuscolo(valore), 6.5) > dx - sx - 7) { this.scriviDueRighe(pagina, `check-list ${cella}`, valore, sx + 4, t.linea, dx - 3); continue }
      this.scriviCampo(pagina, `check-list ${cella}`, valore, sx + 4, t.linea, dx - 3)
    }

    if (this.m.sigilloPresente !== null && this.m.sigilloPresente !== undefined) this.crocetta(pagina, mm[this.m.sigilloPresente], mm.righe['1.3'])
    if (TIPI_SIGILLO[r.sigillo_tipo ?? '']) this.crocetta(pagina, mm.sigillo[r.sigillo_tipo], mm.sigillo.y)

    const aree = !!this.m.areePubblicheDaCompilare
    if (mm.non_applicabile && (r.area_pubblica ?? null) === 'no') this.crocetta(pagina, ...mm.non_applicabile)

    for (const [numero, valore] of this.m.voci) {
      if (mm.righe[numero] === undefined || (valore !== 'si' && valore !== 'no')) continue
      if (mm.non_applicabile && numero.startsWith('3.') && !aree) continue
      this.crocetta(pagina, mm[valore], mm.righe[numero])
    }

    this.scriviCampo(pagina, 'versione identificata', r.versione_identificata ?? null, ...mm.versione_identificata)
    this.scriviCampo(pagina, 'versione installata', r.versione_installata ?? null, ...mm.versione_installata)
    if (r.esito && mm.esito[r.esito] !== undefined ) this.crocetta(pagina, mm.esito[r.esito], mm.esito.y)

    this.scriviCampo(pagina, 'documento gestionale', r.documento_chiusura ?? null, ...mm.documento)
    const s = /^(\d{2})\/(\d{4})$/.exec(d.scadenza ?? '')
    if (s) { this.testoCentrato(pagina, s[1], mm.scadenza.mese, mm.scadenza.linea, 22); this.testoCentrato(pagina, s[2], mm.scadenza.anno, mm.scadenza.linea, 44) }

    const f = mm.firme
    const centro = (f.alto + f.basso) / 2 + 3
    this.testoCentrato(pagina, d.data ?? null, (f.data[0] + f.data[1]) / 2, centro, f.data[1] - f.data[0] - 6)
    this.testoCentrato(pagina, d.tecnico_sigillo ?? null, (f.sigillo[0] + f.sigillo[1]) / 2, centro, f.sigillo[1] - f.sigillo[0] - 6, true)
    this.firma(pagina, d.tecnico_firma ?? null, f.tecnico, f.alto, f.basso, d.tecnico_nome ?? null)
    this.firma(pagina, d.cliente_firma ?? null, f.cliente, f.alto, f.basso, null)
  }

  // ── disegno ──
  crocetta(pagina, x, yAlto) {
    const margine = 1.1
    const x1 = x + margine, x2 = x + CASELLA - margine
    const y1 = this.y(yAlto + margine), y2 = this.y(yAlto + CASELLA - margine)
    this.pdf.disegna(pagina, `q 0 0 0 RG 1 w 1 J ${fmt(x1, 2)} ${fmt(y1, 2)} m ${fmt(x2, 2)} ${fmt(y2, 2)} l S ${fmt(x1, 2)} ${fmt(y2, 2)} m ${fmt(x2, 2)} ${fmt(y1, 2)} l S Q`)
  }

  scriviCampo(pagina, nome, valore, x, linea, xMassima) {
    if (!pieno(valore)) return
    const [testo, corpo] = this.adatta(nome, maiuscolo(String(valore)), xMassima - x)
    this.testo(pagina, testo, x, linea, corpo)
  }

  scriviDueRighe(pagina, nome, valore, x, linea, xMassima) {
    const spazio = xMassima - x
    const parole = maiuscolo(String(valore)).split(/\s+/)
    let prima = ''
    while (parole.length && this.larghezza((prima + ' ' + parole[0]).trim(), 6.5) <= spazio) prima = (prima + ' ' + parole.shift()).trim()
    if (prima === '') { this.scriviCampo(pagina, nome, valore, x, linea, xMassima); return }
    this.testo(pagina, prima, x, linea - 4.5, 6.5)
    if (parole.length) {
      const [seconda, corpo] = this.adatta(nome, parole.join(' '), spazio)
      this.testo(pagina, seconda, x, linea + 2.5, Math.min(corpo, 6.5))
    }
  }

  testoCentrato(pagina, valore, centro, linea, larghezza, grassetto = false) {
    if (!pieno(valore)) return
    const [testo, corpo] = this.adatta('centrato', maiuscolo(String(valore)), larghezza, grassetto)
    this.testo(pagina, testo, centro - this.larghezza(testo, corpo) / 2, linea, corpo, grassetto)
  }

  scriviCap(pagina, cap, linea) {
    const cifre = cifreSole(cap)
    const caselle = PAGINA_1.cap_caselle
    for (let i = 0; i < Math.min(5, cifre.length); i++) {
      const centro = (caselle[i] + caselle[i + 1]) / 2
      this.testo(pagina, cifre[i], centro - this.larghezza(cifre[i], CORPO) / 2, linea, CORPO)
    }
  }

  firma(pagina, percorso, colonna, alto, basso, nome) {
    const [sx, dx] = colonna
    const spazioNome = nome ? 6.0 : 0.0
    const byte = percorso && this.opz.firma ? this.opz.firma(percorso) : null
    if (byte) {
      const img = this.pdf.immagine(pagina, byte)
      if (img) {
        const larghezzaMax = dx - sx - 8
        const altezzaMax = basso - alto - 2 - spazioNome
        const scala = Math.min(larghezzaMax / img.larghezza, altezzaMax / img.altezza)
        const w = img.larghezza * scala, h = img.altezza * scala
        const x = (sx + dx) / 2 - w / 2
        const y = this.y(alto + 1 + h)
        this.pdf.disegna(pagina, `q ${fmt(w, 3)} 0 0 ${fmt(h, 3)} ${fmt(x, 2)} ${fmt(y, 2)} cm /${img.nome} Do Q`)
      }
    }
    if (pieno(nome)) this.testoCentrato(pagina, nome, (sx + dx) / 2, basso - 1.6, dx - sx - 8)
  }

  testo(pagina, testo, x, linea, corpo, grassetto = false) {
    this.pdf.disegna(pagina, `BT 0 0 0 rg /${grassetto ? 'GedF2' : 'GedF1'} ${fmt(corpo, 2)} Tf ${fmt(x, 2)} ${fmt(this.y(linea), 2)} Td (${this.stringaPdf(testo)}) Tj ET`)
  }

  adatta(campo, testo, spazio, grassetto = false) {
    let corpo = CORPO
    while (corpo > CORPO_MINIMO && this.larghezza(testo, corpo, grassetto) > spazio) corpo -= 0.25
    if (this.larghezza(testo, corpo, grassetto) <= spazio) return [testo, corpo]
    const intero = testo
    let c = Array.from(testo)
    while (c.length > 1 && this.larghezza(c.join('') + '…', corpo, grassetto) > spazio) c.pop()
    this.avvisi.push(`«${campo}»: il testo non entra nel riquadro ed è stato accorciato (era «${intero}»).`)
    return [c.join('').trimEnd() + '…', corpo]
  }

  larghezza(testo, corpo, grassetto = false) {
    const m = metriche()
    let totale = 0
    for (const ch of winAnsi(testo)) totale += m[ch.charCodeAt(0)] ?? 556
    return totale / 1000 * corpo * (grassetto ? 1.06 : 1.0)
  }

  stringaPdf(testo) { return winAnsi(testo).replace(/[\\()\r\n]/g, (c) => ({ '\\': '\\\\', '(': '\\(', ')': '\\)', '\r': ' ', '\n': ' ' }[c])) }

  y(dallAlto) { return ALTEZZA_PAGINA - dallAlto }
}
