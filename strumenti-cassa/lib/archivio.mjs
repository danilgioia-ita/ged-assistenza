// Cosa il programma si ricorda fra un avvio e l'altro (cartella dati, vedi registro.mjs):
//   impostazioni.json       tecnico, laboratorio, ultima cassa
//   cassa-<matricola>.json  profilo scelto, spunte del tecnico, intestazione preparata, check-list
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
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
  }
}

// CF e P.IVA: controlli di forma, non di esistenza
export const cfValido = (s) => /^[A-Z0-9]{16}$/.test(String(s))
export const pivaValida = (s) => /^\d{11}$/.test(String(s))
