#!/usr/bin/env node
// GUARDIA DEI DATI VERI — nata il 3/11/2026, dopo che codice fiscale, P.IVA e dati di clienti veri erano finiti
// nei file di prova di questo repository PUBBLICO. Regola di Danilo: «i dati nostri e dei clienti non possono
// uscire, non esiste». Questa guardia è il controllo che lo rende vero: gira nel pre-push e in GitHub.
//
// Cosa guarda: le righe AGGIUNTE da ogni commit (non l'albero intero: il codice di RustDesk è pieno di numeri
// che somigliano a una P.IVA, e non sono nostri) e ogni file binario aggiunto. Cerca codici fiscali e P.IVA con
// la cifra di controllo giusta, matricole dei registratori telematici, email e PEC, cellulari, IBAN. Un'immagine
// o un PDF nuovi passano solo se la loro impronta è in ammessi.txt: una firma vera non si riconosce dal
// contenuto, si riconosce solo chiedendo a chi la aggiunge di dichiararla.
//
// Nei messaggi i valori trovati escono MASCHERATI: i registri di GitHub di un repository pubblico li legge chiunque.
//
//   node tools/guardia-dati-veri/guardia.mjs --range <da>..<a>          commit nell'intervallo
//   node tools/guardia-dati-veri/guardia.mjs --nuovi <sha> <remote>      commit non ancora su <remote>
//   node tools/guardia-dati-veri/guardia.mjs --file <percorso>...        file sul disco, interi
//
// Uscita 0 = pulito, 1 = trovato qualcosa, 2 = uso sbagliato o errore (anche questo blocca: nel dubbio, no).

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const QUI = dirname(fileURLToPath(import.meta.url))

// ---------- riconoscitori ----------

const DISPARI_CF = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23]
const OMOCODIA = 'LMNPQRSTUV'

export function cfValido(cf) {
  cf = cf.toUpperCase()
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) return false
  let somma = 0
  for (let i = 0; i < 15; i++) {
    let c = cf[i]
    if (/[0-9]/.test(c)) c = String.fromCharCode(65 + Number(c))
    const n = c.charCodeAt(0) - 65
    somma += i % 2 === 0 ? DISPARI_CF[n] : n
  }
  return String.fromCharCode(65 + (somma % 26)) === cf[15]
}

export function pivaValida(p) {
  if (!/^[0-9]{11}$/.test(p) || /^(\d)\1{10}$/.test(p)) return false
  let s = 0
  for (let i = 0; i < 10; i++) {
    let d = Number(p[i])
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    s += d
  }
  return (10 - (s % 10)) % 10 === Number(p[10])
}

const RICONOSCITORI = [
  { tipo: 'codice fiscale', re: /(?<![A-Z0-9])[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z](?![A-Z0-9])/gi, vale: cfValido },
  { tipo: 'partita IVA', re: /(?<![0-9])[0-9]{11}(?![0-9])/g, vale: pivaValida },
  // matricola RT: anno/tipo (2 cifre) + produttore (3 lettere) + progressivo (6 cifre), es. 99ZZZ012345 (ZZZ = finta, ammessa)
  { tipo: 'matricola RT', re: /(?<![A-Z0-9])[0-9]{2}[A-Z]{3}[0-9]{6}(?![A-Z0-9])/g, vale: m => !/^[0-9]{2}ZZZ/.test(m) },
  { tipo: 'email o PEC', re: /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi, vale: (e, a) => !dominioAmmesso(e, a) },
  { tipo: 'cellulare', re: /(?<![0-9])(?:\+39[ .-]?)?3[0-9]{2}[ .-]?[0-9]{3}[ .-]?[0-9]{3,4}(?![0-9])/g, vale: t => t.replace(/\D/g, '').replace(/^39(?=3)/, '').length === 10 },
  { tipo: 'IBAN', re: /(?<![A-Z0-9])IT[0-9]{2}[A-Z][0-9]{10}[0-9A-Z]{12}(?![A-Z0-9])/g, vale: () => true },
]

const BINARI = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.bmp', '.tif', '.tiff', '.pdf', '.ico', '.icns', '.svg'])

function dominioAmmesso(email, ammessi) {
  const dom = email.split('@')[1].toLowerCase()
  return [...ammessi.domini].some(d => dom === d || dom.endsWith('.' + d))
}

export function maschera(v) {
  return v.length <= 4 ? '****' : v.slice(0, 2) + '*'.repeat(Math.max(3, v.length - 4)) + v.slice(-2)
}

// ---------- ammessi ----------

export function leggiAmmessi(file = join(QUI, 'ammessi.txt')) {
  const a = { valori: new Set(), domini: new Set(), binari: new Set() }
  if (!existsSync(file)) return a
  for (const riga of readFileSync(file, 'utf8').split('\n')) {
    const r = riga.replace(/#.*/, '').trim()
    if (!r) continue
    const [chi, val] = r.split(/\s+/)
    if (chi === 'valore') a.valori.add(val.toUpperCase())
    else if (chi === 'dominio') a.domini.add(val.toLowerCase())
    else if (chi === 'binario') a.binari.add(val.toLowerCase())
    else throw new Error(`ammessi.txt: riga non capita «${r}»`)
  }
  return a
}

// ---------- analisi ----------

export function cercaNelTesto(testo, ammessi) {
  const trovati = []
  for (const { tipo, re, vale } of RICONOSCITORI) {
    for (const m of testo.matchAll(re)) {
      const v = m[0]
      if (ammessi.valori.has(v.toUpperCase()) || ammessi.valori.has(v.replace(/\D/g, ''))) continue
      if (vale(v, ammessi)) trovati.push({ tipo, valore: v })
    }
  }
  return trovati
}

// Il testo dei PDF sta in flussi compressi: li apriamo, così un modulo compilato con dati veri si vede anche
// quando l'impronta è stata ammessa per sbaglio.
function testoDelPdf(buf) {
  const s = buf.toString('latin1')
  let testo = s
  const re = /stream\r?\n/g
  let m
  while ((m = re.exec(s))) {
    const fine = s.indexOf('endstream', m.index)
    if (fine < 0) break
    try { testo += '\n' + inflateSync(buf.subarray(m.index + m[0].length, fine)).toString('latin1') } catch { /* non compresso o immagine */ }
    re.lastIndex = fine
  }
  // le stringhe dei PDF sono fra parentesi, con escape: (\(...\))
  return testo.replace(/\\([()\\])/g, '$1')
}

export function controllaContenuto(percorso, buf, soloRighe, ammessi) {
  const esiti = []
  const ext = extname(percorso).toLowerCase()
  const binario = BINARI.has(ext) || buf.subarray(0, 8000).includes(0)
  if (binario) {
    const impronta = createHash('sha256').update(buf).digest('hex')
    if (!ammessi.binari.has(impronta)) esiti.push({ percorso, riga: 0, tipo: 'file binario non dichiarato', valore: impronta, mostra: `impronta ${impronta} (se è finto o pubblico, aggiungi «binario ${impronta}» ad ammessi.txt con una nota)` })
    if (ext === '.pdf' || buf.subarray(0, 5).toString() === '%PDF-') {
      for (const t of cercaNelTesto(testoDelPdf(buf), ammessi)) esiti.push({ percorso, riga: 0, ...t })
    }
    return esiti
  }
  const righe = buf.toString('utf8').split('\n')
  righe.forEach((r, i) => {
    if (soloRighe && !soloRighe.has(i + 1)) return
    for (const t of cercaNelTesto(r, ammessi)) esiti.push({ percorso, riga: i + 1, ...t })
  })
  return esiti
}

// ---------- git ----------

const git = (args, opz = {}) => execFileSync('git', args, { maxBuffer: 1 << 30, ...opz })

// Numeri delle righe aggiunte nel file nuovo, dal diff a contesto zero.
function righeAggiunte(vecchio, nuovo) {
  const diff = git(['diff', '--no-color', '-U0', '--no-ext-diff', vecchio, nuovo]).toString('utf8')
  const set = new Set()
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const da = Number(m[1]), quante = m[2] === undefined ? 1 : Number(m[2])
    for (let i = 0; i < quante; i++) set.add(da + i)
  }
  return set
}

const VUOTO = /^0+$/

export function controllaCommit(commit, ammessi) {
  const esiti = []
  // --root: anche il primo commit di un repository; -m --first-parent: i merge contano per ciò che portano nel ramo
  const uscita = git(['diff-tree', '-r', '--root', '--no-commit-id', '--no-renames', '-m', '--first-parent', '-z', commit]).toString('utf8')
  const parti = uscita.split('\0').filter(Boolean)
  for (let i = 0; i + 1 < parti.length; i += 2) {
    const [, modo, vecchio, nuovo, stato] = parti[i].replace(/^:/, '').split(' ')
    const percorso = parti[i + 1]
    if (stato === 'D' || VUOTO.test(nuovo) || modo === '160000') continue // cancellati e sottomoduli
    const buf = git(['cat-file', 'blob', nuovo])
    const solo = VUOTO.test(vecchio) ? null : righeAggiunte(vecchio, nuovo)
    for (const e of controllaContenuto(percorso, buf, solo, ammessi)) esiti.push({ commit: commit.slice(0, 9), ...e })
  }
  return esiti
}

function commitDa(args) {
  return git(['rev-list', '--reverse', ...args]).toString().split('\n').filter(Boolean)
}

// ---------- principale ----------

function stampa(esiti) {
  const visti = new Set()
  for (const e of esiti) {
    const dove = `${e.commit ? e.commit + ' ' : ''}${e.percorso}${e.riga ? ':' + e.riga : ''}`
    const chiave = dove + e.tipo + e.valore
    if (visti.has(chiave)) continue
    visti.add(chiave)
    console.error(`  ✗ ${dove} — ${e.tipo}: ${e.mostra ?? maschera(e.valore)}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [modo, ...resto] = process.argv.slice(2)
    const ammessi = leggiAmmessi()
    let esiti = []
    let quanti = 0
    if (modo === '--range' && resto.length === 1) {
      for (const c of commitDa([resto[0]])) { esiti.push(...controllaCommit(c, ammessi)); quanti++ }
    } else if (modo === '--nuovi' && resto.length === 2) {
      for (const c of commitDa([resto[0], '--not', `--remotes=${resto[1]}`])) { esiti.push(...controllaCommit(c, ammessi)); quanti++ }
    } else if (modo === '--file' && resto.length) {
      for (const f of resto) { esiti.push(...controllaContenuto(f, readFileSync(f), null, ammessi)); quanti++ }
    } else {
      console.error('uso: guardia.mjs --range <da>..<a> | --nuovi <sha> <remote> | --file <percorso>...')
      process.exit(2)
    }
    if (esiti.length) {
      console.error(`GUARDIA DEI DATI VERI: ${esiti.length} cose da guardare in ${quanti} ${modo === '--file' ? 'file' : 'commit'}. Niente esce finché non sono sistemate.`)
      stampa(esiti)
      console.error('Se un valore è inventato o pubblico (non di una persona né di un cliente), dichiaralo in tools/guardia-dati-veri/ammessi.txt.')
      process.exit(1)
    }
    console.log(`guardia dei dati veri: pulito (${quanti} ${modo === '--file' ? 'file' : 'commit'})`)
  } catch (e) {
    console.error('GUARDIA DEI DATI VERI: errore, nel dubbio blocco —', e.message)
    process.exit(2)
  }
}
