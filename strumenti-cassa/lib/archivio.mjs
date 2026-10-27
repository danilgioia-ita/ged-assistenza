// Cosa il programma si ricorda fra un avvio e l'altro (cartella dati, vedi registro.mjs):
//   impostazioni.json       tecnico, laboratorio, ultima cassa
//   cassa-<matricola>.json  profilo scelto, spunte del tecnico, intestazione preparata, check-list
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { nomeSicuro } from './registro.mjs'

export const IMPOSTAZIONI_DI_PARTENZA = {
  tecnico: { nome: 'Ercole Danilo Gioia', cf: 'GIORLD84C23A024D' },
  laboratorio: { nome: 'GED Service', piva: '07300661217' },
  ultimaIp: '',
}

const leggi = (f, vuoto) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : vuoto } catch { return vuoto } }
function scrivi(f, o) { const t = f + '.tmp'; writeFileSync(t, JSON.stringify(o, null, 2)); renameSync(t, f) }

export function creaArchivio(cartella) {
  mkdirSync(cartella, { recursive: true })
  const fImp = join(cartella, 'impostazioni.json')
  const fCassa = (m) => join(cartella, `cassa-${nomeSicuro(m)}.json`)
  return {
    impostazioni() {
      const l = leggi(fImp, {})
      return { ...IMPOSTAZIONI_DI_PARTENZA, ...l, tecnico: { ...IMPOSTAZIONI_DI_PARTENZA.tecnico, ...(l.tecnico || {}) }, laboratorio: { ...IMPOSTAZIONI_DI_PARTENZA.laboratorio, ...(l.laboratorio || {}) } }
    },
    salvaImpostazioni(i) { scrivi(fImp, i); return i },
    cassa(m) { return { profilo: 'diretto', spunte: {}, intestazioneVoluta: null, checklist: { dati: {}, spunte: {} }, ...leggi(fCassa(m), {}) } },
    salvaCassa(m, o) { scrivi(fCassa(m), o); return o },
    /** Le casse preparate: un file cassa-<matricola>.json ciascuna; l'ultima attività dal registro <matricola>.log. */
    elenco() {
      const out = []
      for (const f of readdirSync(cartella)) {
        const m = /^cassa-([A-Za-z0-9]+)\.json$/.exec(f)
        if (!m) continue
        const matricola = m[1]
        const c = this.cassa(matricola)
        const log = join(cartella, `${matricola}.log`)
        let ultima = null
        if (existsSync(log)) {
          const righe = readFileSync(log, 'utf8').split('\n').filter(Boolean)
          for (let i = righe.length - 1; i >= 0 && !ultima; i--) {
            const r = /^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d)/.exec(righe[i])
            if (r) ultima = { testo: `${r[1]}/${r[2]}/${r[3]} ${r[4]}:${r[5]}`, ordine: `${r[3]}${r[2]}${r[1]}${r[4]}${r[5]}` }
          }
          if (!ultima) { const d = statSync(log).mtime; ultima = { testo: d.toLocaleString('it-IT', { timeZone: 'Europe/Rome' }), ordine: d.toISOString() } }
        }
        const sp = { ...(c.spunte || {}), ...(c.checklist?.spunte || {}) }
        out.push({
          matricola, profilo: c.profilo, esercente: c.checklist?.dati?.esercente || '', ip: c.ip || '', nota: c.nota || '',
          ultimaAttivita: ultima?.testo || null, _ordine: ultima?.ordine || '', vp: c.vp || null,
          spuntate: Object.values(sp).filter(Boolean).length, righeVerificate: Object.keys(c.checklist?.auto || {}).length,
        })
      }
      return out.sort((a, b) => b._ordine.localeCompare(a._ordine)).map(({ _ordine, ...x }) => x)
    },
  }
}

// CF e P.IVA: controlli di forma, non di esistenza
export const cfValido = (s) => /^[A-Z0-9]{16}$/.test(String(s))
export const pivaValida = (s) => /^\d{11}$/.test(String(s))
