// Gli errori della cassa Custom, spiegati. Il manuale è in dati/errori_custom.json (Custom, protocollo fiscale rev 2.00,
// copiato da GED Connect). Dove il campo dice altro dal manuale vince il campo (DAL_CAMPO).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dati = JSON.parse(readFileSync(fileURLToPath(new URL('../dati/errori_custom.json', import.meta.url)), 'utf8'))
const PROTOCOLLO = new Map(dati.protocollo.map((e) => [e.codice, e]))

const DAL_CAMPO = {
  7: 'Sconto non permesso in quel punto.',
  98: 'La cassa sta facendo qualcosa da sola. Non insistere: attendere e rileggere lo stato.',
  213: 'Occupata a inviare all\'Agenzia: dopo ogni chiusura aspettare l\'esito (1515) e ripetere.',
  225: 'Il pagamento con il POS non è riuscito.',
}
const AZIONE = { 213: 'riprova', 97: 'riprova', 98: 'occupata', 16: 'attendi_carta', 54: 'chiusura', 5: 'documento_aperto', 225: 'pos_non_riuscito' }

export function spiegaErrore(codice) {
  const e = PROTOCOLLO.get(codice)
  return {
    codice,
    titolo: e?.titolo ?? 'CODICE NON IN ELENCO',
    spiegazione: DAL_CAMPO[codice] ?? e?.testo ?? 'Codice non presente nel manuale Custom.',
    manuale: e?.testo ?? 'Codice non presente nel manuale Custom.',
    azione: AZIONE[codice] ?? 'fermati_e_avvisa',
  }
}
export const quantiCodici = () => PROTOCOLLO.size
