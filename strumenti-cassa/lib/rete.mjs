// «Cerca in rete»: prova la porta 9100 su una /24 e riconosce la cassa dal suo web server (la tastiera remota,
// GetDisplay.cgi, esiste solo sulle Custom: una stampante qualsiasi risponde 404 o niente).
// Sulla 9100 NON si manda niente: una stampante qualunque stamperebbe la spazzatura. Solo un connect e via.
import net from 'node:net'
import http from 'node:http'
import os from 'node:os'
import { indirizzoPrivato } from './cassa.mjs'

export function sottoretiLocali(interfacce = os.networkInterfaces()) {
  const out = new Set()
  for (const lista of Object.values(interfacce)) for (const i of lista || []) {
    if (i.family !== 'IPv4' || i.internal || !indirizzoPrivato(i.address)) continue
    out.add(i.address.split('.').slice(0, 3).join('.'))
  }
  return [...out]
}

function porta(ip, p, timeoutMs) {
  return new Promise((ok) => {
    const s = net.connect({ host: ip, port: p })
    const fine = (v) => { s.destroy(); ok(v) }
    s.setTimeout(timeoutMs, () => fine(false))
    s.once('connect', () => fine(true))
    s.once('error', () => fine(false))
  })
}

function pagina(ip, p, path, timeoutMs) {
  return new Promise((ok) => {
    const req = http.get({ host: ip, port: p, path, timeout: timeoutMs }, (res) => {
      const parti = []
      res.on('data', (d) => { if (parti.length < 8) parti.push(d) })
      res.on('end', () => ok({ stato: res.statusCode, realm: res.headers['www-authenticate'] || '', corpo: Buffer.concat(parti).toString('latin1').slice(0, 4000) }))
    })
    req.on('timeout', () => { req.destroy(); ok(null) })
    req.on('error', () => ok(null))
  })
}

export async function riconosci(ip, { portaWeb = 80, timeoutMs = 1500 } = {}) {
  const tastiera = await pagina(ip, portaWeb, '/GetDisplay.cgi', timeoutMs)
  const home = tastiera && (tastiera.stato === 401 || tastiera.stato === 200) ? tastiera : await pagina(ip, portaWeb, '/', timeoutMs)
  const testo = (home?.realm || '') + ' ' + (home?.corpo || '')
  const tastieraRemota = !!tastiera && (tastiera.stato === 401 || tastiera.stato === 200)
  const modello = /WEB SERVER DI ([A-Z0-9-]+)/.exec(testo)?.[1] ?? null
  return { webServer: !!home, tastieraRemota, riconosciuta: tastieraRemota || /custom|K3F|K3-N/i.test(testo), modello }
}

/** `ips`: elenco esplicito (per le prove) · altrimenti tutte le /24 delle interfacce private del Mac. */
export async function cercaInRete({ ips = null, portaCassa = 9100, portaWeb = 80, timeoutMs = 700, concorrenza = 64, consentiLoopback = false } = {}) {
  const lista = ips || sottoretiLocali().flatMap((p) => Array.from({ length: 254 }, (_, i) => `${p}.${i + 1}`))
  const ok = lista.filter((ip) => indirizzoPrivato(ip) || (consentiLoopback && /^127\./.test(ip)))
  const trovate = []
  let i = 0
  async function lavora() {
    while (i < ok.length) {
      const ip = ok[i++]
      if (!(await porta(ip, portaCassa, timeoutMs))) continue
      trovate.push({ ip, porta: portaCassa, ...(await riconosci(ip, { portaWeb })) })
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrenza, ok.length || 1) }, lavora))
  trovate.sort((a, b) => Number(b.riconosciuta) - Number(a.riconosciuta) || a.ip.localeCompare(b.ip, 'en', { numeric: true }))
  return { provati: ok.length, trovate }
}
