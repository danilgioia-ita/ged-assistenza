// L'ingresso FISSO con cui si prova `componi()` sui dati veri della cassa KAMMOR (96IKN014404, 27/10/2026).
import { baseDaCassa, datiComposti } from '../lib/checklist.mjs'
import { componi } from '../lib/verifica.mjs'

export const INTESTAZIONE_KAMMOR = ['KAMMOR', 'PIZZERIA E FRIGGITORIA', 'DA ALE E MIMMO', 'VIA SALVATOR ROSA 76', 'NAPOLI 80135', 'PI 11130901215', '', '', '']
export const IMPOSTAZIONI = { tecnico: { nome: 'Ercole Danilo Gioia', cf: 'GIORLD84C23A024D', sigillo: 'GED01' }, laboratorio: { piva: '07300661217' } }
export const AUTO_KAMMOR = {
  '2.2': { ok: true, valore: 'si', testo: 'Firmware sulla cassa: 15.04.05' }, '2.3': { ok: true, valore: 'si', testo: 'È l\'ultimo' }, '2.4': { ok: true, valore: 'no', testo: 'non serviva' },
  '2.8': { ok: true, valore: 'si', testo: 'Chiusura prima (Z 2)' }, '2.9': { ok: true, valore: 'si', testo: 'Documenti di prova' }, '2.10': { ok: true, valore: 'si', testo: 'Annullo' },
  '2.12': { ok: true, valore: 'si', testo: 'Chiusura coerente' }, '2.13': { ok: true, valore: 'si', testo: 'Invio XML' }, '2.14': { ok: true, valore: 'si', testo: 'DGFE' }, '4.1': { ok: true, valore: 'si', testo: 'Dati tecnico' }, '4.2': { ok: true, valore: 'si', testo: 'Esito' },
}
export function verificaKammor(extra = {}) {
  const { base } = baseDaCassa({ matricola: '96IKN014404', righe: INTESTAZIONE_KAMMOR, webPiva: '11130901215', chiusure: 4, modello: 'K3F-N 15.04.05 02/07/26', firmwareUltimo: '15.04.05', impostazioni: IMPOSTAZIONI })
  return componi({
    salvate: { sigillo_tipo: 'percussione', luogo: 'cliente', riferimento: 'pagamento', ...(extra.salvate || {}) }, auto: AUTO_KAMMOR,
    dati: datiComposti({ data: '27/10/2026', cliente_firmatario: 'Mimmo Esposito', ...(extra.dati || {}) }, base),
    firmware: { installato: '15.04.05', ultimo: '15.04.05' }, firme: { tecnico: 'firma-tecnico.png', cliente: 'firma-cliente.png', ...(extra.firme || {}) },
    vp: { data: '27/10/2026', prossima: '10/2028' }, adesso: new Date('2026-10-27T15:00:00Z'),
  })
}
