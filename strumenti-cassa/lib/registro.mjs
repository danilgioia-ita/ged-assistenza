// Il registro: ogni comando mandato e ogni risposta, un file per cassa, con l'ora italiana.
// ~/Library/Application Support/GED Assistance/strumenti-cassa/<matricola>.log
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function cartellaDati() {
  return process.env.GED_CASSA_DATI || join(homedir(), 'Library', 'Application Support', 'GED Assistance', 'strumenti-cassa')
}

export const oraItaliana = (d = new Date()) => d.toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour12: false, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(',', '')

// la matricola finisce nel nome di un file: solo lettere e cifre
export const nomeSicuro = (m) => (String(m || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 24) || '_collegamento')

export function creaRegistro(cartella = cartellaDati(), adesso = () => new Date()) {
  mkdirSync(cartella, { recursive: true })
  const file = (matricola) => join(cartella, nomeSicuro(matricola) + '.log')
  function scrivi(matricola, tipo, testo) {
    const riga = `${oraItaliana(adesso())}  ${String(tipo).padEnd(6)} ${String(testo).replace(/[\r\n]+/g, ' ')}\n`
    appendFileSync(file(matricola), riga)
    return riga
  }
  return {
    cartella,
    file,
    comando: (m, cmd) => scrivi(m, 'MANDO', cmd),
    risposta: (m, r) => scrivi(m, 'RISP', r),
    errore: (m, t) => scrivi(m, 'ERRORE', t),
    rifiuto: (m, t) => scrivi(m, 'NO', t),
    evento: (m, t) => scrivi(m, 'NOTA', t),
    web: (m, t) => scrivi(m, 'WEB', t),
    coda(matricola, righe = 200) {
      const f = file(matricola)
      if (!existsSync(f)) return []
      return readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-righe)
    },
  }
}
