// Ambiente di prova: il programma VERO (server.mjs) contro la cassa FINTA, parlando HTTP come farebbe il browser.
// Le prove passano così dai cablaggi (rotte → procedure → client → lista bianca → cassa), non solo dai moduli.
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { avvia } from '../server.mjs'
import { avviaSimulatore } from './k3-sim.mjs'

export async function ambiente(opzSim = {}, opzApp = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cassa-prova-'))
  const sim = await avviaSimulatore({ conWeb: true, ...opzSim })
  const app = await avvia({ cartella: dir, consentiLoopback: true, attendi: () => new Promise((r) => setTimeout(r, 15)), intervalloMs: 15, rapido: true, attesaTastoMs: 5, ...opzApp })
  const chiama = async (metodo, nome, corpo) => {
    const r = await fetch(app.indirizzo + 'api/' + nome, { method: metodo, headers: { 'content-type': 'application/json', 'x-strumenti-cassa': '1' }, body: metodo === 'POST' ? JSON.stringify(corpo ?? {}) : undefined })
    return r.json()
  }
  const collega = () => chiama('POST', 'collega', { ip: '127.0.0.1', porta: sim.porta, portaWeb: sim.portaWeb })
  /** Esegue un passo e aspetta che finisca (come fa il browser con il sondaggio). */
  const passo = async (i, input = {}) => {
    let r = await chiama('POST', 'procedura/esegui', { passo: i, input })
    if (r?.errore) return r
    for (let k = 0; k < 400; k++) { r = await chiama('GET', 'procedura'); if (!r.inEsecuzione) return r; await new Promise((x) => setTimeout(x, 10)) }
    throw new Error('il passo non finisce')
  }
  const log = () => { const f = app.registro.file(app.sess.matricola); return existsSync(f) ? readFileSync(f, 'utf8') : '' }
  const chiudi = async () => { await app.chiudi(); await sim.chiudi(); rmSync(dir, { recursive: true, force: true }) }
  return { dir, sim, app, chiama, collega, passo, log, chiudi }
}
