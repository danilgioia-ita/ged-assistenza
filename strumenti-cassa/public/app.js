'use strict'
// Strumenti cassa — l'interfaccia. Niente librerie. Ogni testo che arriva dalla cassa entra nella pagina come TESTO, mai come HTML.
const BASE = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/'
const S = {
  app: null, cassa: null, proc: null, aperto: '', ip: '', trovate: null, cercando: false, collegando: false,
  intest: null, aliquote: null, conf: {}, input: {}, riletto: {}, check: null, registro: [], testoCrm: '', lettura: false, display: '',
}

// ───────────────────────── utilità ─────────────────────────
function h(tag, attrs, ...figli) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue
    if (k === 'class') e.className = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else if (k === 'value') e.value = v
    else if (k === 'checked' || k === 'disabled' || k === 'selected') e[k] = !!v
    else e.setAttribute(k, v === true ? '' : v)
  }
  for (const f of figli.flat(Infinity)) if (f !== null && f !== undefined && f !== false) e.append(f.nodeType ? f : document.createTextNode(String(f)))
  return e
}
const $ = (id) => document.getElementById(id)
const riempi = (id, ...figli) => { const el = $(id); el.replaceChildren(...figli.flat(Infinity).filter(Boolean)) }

async function api(metodo, nome, corpo) {
  const r = await fetch(BASE + 'api/' + nome, { method: metodo, headers: { 'content-type': 'application/json', 'x-strumenti-cassa': '1' }, body: metodo === 'POST' ? JSON.stringify(corpo ?? {}) : undefined })
  const j = await r.json()
  if (j && j.errore) { const e = new Error(j.errore); e.dettaglio = j.dettaglio; throw e }
  return j
}

function avviso(testo, tipo = 'info', dettaglio) {
  const box = $('avviso')
  const m = h('div', { class: 'msg ' + tipo, role: tipo === 'male' ? 'alert' : 'status' },
    h('div', null, testo, dettaglio?.manuale && dettaglio.manuale !== dettaglio.spiegazione ? h('div', { class: 'piccolo' }, 'Manuale: ' + dettaglio.manuale) : null),
    h('button', { onclick: () => m.remove() }, 'chiudi'))
  box.prepend(m)
  while (box.children.length > 3) box.lastChild.remove()
  if (tipo === 'bene') setTimeout(() => m.remove(), 12000)
}

async function agisci(f, ok) {
  if (S.occupato) return
  S.occupato = true
  document.body.style.cursor = 'progress'
  try { const r = await f(); if (ok) avviso(typeof ok === 'function' ? ok(r) : ok, 'bene'); return r } catch (e) { avviso(e.message, 'male', e.dettaglio) } finally { S.occupato = false; document.body.style.cursor = '' }
}

const colori = { v: 'v', r: 'r', a: 'a', g: 'g' }
const NOMI_SPIA = { v: 'a posto', r: 'da fare', a: 'da guardare', g: 'non leggibile dal PC' }
const spia = (s) => h('div', { class: 'spia' }, h('span', { class: 'pallino ' + colori[s.colore], role: 'img', 'aria-label': NOMI_SPIA[s.colore] }), h('div', { class: 't' }, h('span', { class: 'piccolo' }, s.cosa), h('b', null, s.valore), s.nota ? h('span', { class: 'piccolo' }, s.nota) : null))
const spiaDi = (id) => S.cassa?.spie?.find((s) => s.id === id)
const profilo = () => S.app?.profili?.[S.app?.profilo] || null

// ───────────────────────── caricamenti ─────────────────────────
async function caricaApp() { S.app = await api('GET', 'stato-app'); if (!S.ip) S.ip = S.app.ultimaIp || (S.app.simulatore ? S.app.simulatore.host : '') }
async function rileggi() {
  S.cassa = await api('GET', 'cassa')
  S.intest = (S.cassa.intestazioneVoluta?.length ? S.cassa.intestazioneVoluta.map((r) => ({ testo: r.testo, tipo: r.tipo })) : S.cassa.intestazione.map((r) => ({ testo: r.testo, tipo: r.tipo || 1 })))
  while (S.intest.length < 9) S.intest.push({ testo: '', tipo: 1 })
  const voluto = profilo()?.aliquote || {}
  S.aliquote = {}
  for (let i = 1; i <= 5; i++) S.aliquote[i] = voluto[i] !== undefined ? String(voluto[i]) : (S.cassa.aliquote.find((a) => a.indice === i)?.valore ?? '').toString()
  await caricaApp()
  disegnaTutto()
}
async function caricaProcedura() { S.proc = await api('GET', 'procedura'); disegnaProcedure() }
async function caricaCheck() { S.check = await api('GET', 'checklist'); disegnaCheck() }
async function caricaRegistro() { S.registro = (await api('GET', 'registro?righe=200')).righe; disegnaRegistro() }

// ───────────────────────── testata e collegamento ─────────────────────────
function disegnaTestata() {
  const a = S.app
  riempi('testata',
    h('div', { class: 'riga fra', style: 'align-items:flex-end' },
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('div', { class: 'sopra' }, 'GED Assistance Tecnico · Strumenti cassa'),
        h('h1', null, a?.collegata ? `${a.modello || 'Cassa Custom'} · ${a.matricola}` : 'Strumenti cassa'),
        h('p', { class: 'tenue', style: 'margin:0' }, a?.collegata
          ? `${a.ip} · firmware ${a.firmware || '?'}${S.cassa?.firmwareUltimo ? ` (ultimo dichiarato ${S.cassa.firmwareUltimo})` : ''} · profilo ${profilo()?.nome || ''} · tecnico: ${a.impostazioni.tecnico.nome}`
          : 'Collega una cassa Custom K3F-N della rete. Lo strumento legge, confronta col profilo e fa le procedure un passo alla volta.')),
      a?.collegata ? h('button', { class: 'contorno', onclick: () => agisci(rileggi, 'Cassa riletta') }, 'Rileggi la cassa') : null),
    a?.simulatore ? h('div', { class: 'msg info', style: 'margin-top:10px' }, 'CASSA FINTA: stai provando lo strumento su un simulatore, non su una cassa vera.') : null)
}

function disegnaCollega() {
  const a = S.app
  if (a?.collegata) {
    riempi('s-collega', h('div', { class: 'riga fra' },
      h('div', null, h('b', null, 'Collegata: '), `${a.matricola} su ${a.ip}`, h('div', { class: 'piccolo' }, 'La matricola si rilegge (1008) e si controlla prima di ogni scrittura.')),
      h('button', { onclick: () => agisci(async () => { await api('POST', 'scollega'); S.cassa = null; S.proc = null; S.check = null; await caricaApp(); disegnaTutto() }) }, 'Scollega')))
    return
  }
  riempi('s-collega',
    h('h2', null, 'Collega la cassa'),
    h('div', { class: 'riga' },
      h('div', { class: 'campo', style: 'flex:1 1 220px;max-width:300px' }, h('label', { for: 'ip' }, 'Indirizzo IP della cassa'), h('input', { id: 'ip', type: 'text', value: S.ip, placeholder: '192.168.1.45', oninput: (e) => { S.ip = e.target.value.trim() } })),
      h('button', { class: 'primario', disabled: S.collegando, onclick: collega }, S.collegando ? 'Mi collego…' : 'Collega'),
      a?.simulatore ? null : h('button', { class: 'contorno', disabled: S.cercando, onclick: cerca }, S.cercando ? 'Cerco…' : 'Cerca in rete')),
    h('p', { class: 'piccolo', style: 'margin:0' }, 'Solo indirizzi di rete locale (10.x, 172.16-31.x, 192.168.x). «Cerca in rete» prova la porta 9100 sulla rete del Mac e riconosce la cassa dalla sua tastiera remota; sulla 9100 non manda niente.'),
    S.trovate ? (S.trovate.trovate.length === 0 ? h('p', { class: 'ambra-t' }, `Nessuna cassa trovata (provati ${S.trovate.provati} indirizzi). Controlla di essere sulla stessa rete.`)
      : h('div', { class: 'griglia' }, S.trovate.trovate.map((t) => h('button', { class: 'scelta', onclick: () => { S.ip = t.ip; disegnaCollega() } },
        h('b', null, t.ip), h('div', { class: 'piccolo' }, t.riconosciuta ? `Custom${t.modello ? ' ' + t.modello : ''} · tastiera remota presente` : 'porta 9100 aperta, non riconosciuta (potrebbe essere una stampante)'))))) : null)
}
async function collega() {
  if (!S.ip) return avviso('Scrivi l\'indirizzo IP della cassa', 'male')
  S.collegando = true; disegnaCollega()
  try {
    const sim = S.app.simulatore
    await api('POST', 'collega', { ip: S.ip, ...(sim ? { porta: sim.porta, portaWeb: sim.portaWeb } : {}) })
    await rileggi(); await caricaCheck(); await caricaRegistro(); await caricaProcedura()
    avviso('Cassa collegata e letta', 'bene')
  } catch (e) { avviso(e.message, 'male', e.dettaglio) } finally { S.collegando = false; disegnaTutto() }
}
async function cerca() {
  S.cercando = true; disegnaCollega()
  try { S.trovate = await api('POST', 'cerca', {}) } catch (e) { avviso(e.message, 'male') } finally { S.cercando = false; disegnaCollega() }
}

// ───────────────────────── profilo ─────────────────────────
function disegnaProfilo() {
  if (!S.app?.collegata) return riempi('s-profilo')
  const p = profilo()
  const ordine = [['diretto', 'Diretto nostro'], ['flatpay', 'Flatpay'], ['mooney', 'Mooney']]
  riempi('s-profilo',
    h('h2', null, '1 · Di chi è la cassa'),
    h('div', { class: 'riga', role: 'radiogroup', 'aria-label': 'Di chi è la cassa' }, ordine.map(([k, n]) => h('button', { class: 'scelta' + (S.app.profilo === k ? ' on' : ''), role: 'radio', 'aria-checked': String(S.app.profilo === k), onclick: () => agisci(async () => { await api('POST', 'profilo', { profilo: k }); await rileggi() }) }, n))),
    h('div', { class: 'griglia larga' },
      h('div', { class: 'riquadro' }, h('span', { class: 'piccolo' }, 'Dove si registra'), h('b', null, p.registra), h('span', { class: 'piccolo' }, p.nota)),
      h('div', { class: 'riquadro' }, h('span', { class: 'piccolo' }, `Profilo «${p.nome}» applicato`), h('div', { class: 'riga', style: 'gap:6px' }, p.etichette.map((t) => h('span', { class: 'chip' }, t))))))
}

// ───────────────────────── stato ─────────────────────────
function disegnaStato() {
  const c = S.cassa
  if (!c) return riempi('s-stato')
  riempi('s-stato',
    h('div', { class: 'riga fra' }, h('h2', null, '2 · Stato della cassa'), h('span', { class: 'tenue' }, `Letta il ${c.letta} · confrontata con il profilo ${profilo()?.nome || ''}`)),
    h('div', { class: 'griglia' }, c.spie.map(spia)),
    c.webErrore ? h('p', { class: 'ambra-t', style: 'margin:0' }, 'Web server della cassa: ' + c.webErrore + ' (le spie che ne dipendono restano grigie).') : null,
    Object.keys(c.erroriLettura || {}).length ? h('p', { class: 'piccolo', style: 'margin:0' }, 'Letture che la cassa non ha accettato: ' + Object.keys(c.erroriLettura).join(', ')) : null)
}

// ───────────────────────── programmazione ─────────────────────────
const STILI = { 1: 'Normale', 2: 'Grassetto', 4: 'Doppia altezza', 5: 'Doppia larghezza', 6: 'Corsivo', 3: 'Piccolo (42)' }

function barraConferma(id, titolo, comandi, onSi, irrev) {
  if (!S.conf[id]) return null
  return h('div', { class: 'conferma' + (irrev ? ' irrev' : '') },
    h('b', null, titolo),
    comandi?.length ? h('div', null, comandi.map((c) => [h('span', { class: 'cmd' }, c), ' '])) : null,
    h('div', { class: 'riga' },
      h('button', { class: 'primario', onclick: () => { S.conf[id] = false; agisci(onSi) } }, 'Conferma e scrivi sulla cassa'),
      h('button', { onclick: () => { S.conf[id] = false; disegnaProgramma() } }, 'Annulla')))
}

function gruppo(id, nome, colore, sintesi, corpo) {
  const aperto = S.aperto === id
  return h('div', { class: 'gruppo' },
    h('button', { class: 'testa' + (aperto ? ' on' : ''), 'aria-expanded': String(aperto), onclick: () => { S.aperto = aperto ? '' : id; disegnaProgramma() } },
      h('span', { class: 'pallino ' + colore, 'aria-hidden': 'true' }), h('b', { style: 'font-size:16px' }, nome), h('span', { class: 'tenue', style: 'flex:1 1 auto' }, sintesi), h('span', { 'aria-hidden': 'true' }, aperto ? '▴' : '▾')),
    aperto ? h('div', { class: 'corpo' }, corpo()) : null)
}

function tastiera() {
  const tasti = S.app.tasti
  const gruppoTasti = ['7', '8', '9', 'CANCELLA', '4', '5', '6', 'CHIAVE', '1', '2', '3', 'SUBTOTALE', '0', '00', '.', 'TOTALE', 'X', 'SHIFT', 'VAI_R', 'VAI_P', 'VAI_X', 'VAI_Z']
  const pre = h('pre', { class: 'display', 'aria-live': 'polite' }, S.display || '(display della cassa: premi un tasto o «Leggi il display»)')
  const premi = async (t) => {
    try { const r = await api('POST', 'tasto', { tasto: t, conferma: true }); S.display = r.display; pre.textContent = r.display } catch (e) { avviso(e.message, 'male') }
  }
  return h('div', { class: 'riquadro' },
    h('b', null, 'Tastiera remota'), h('span', { class: 'piccolo' }, 'Ogni tasto è un tuo clic: lo mando alla cassa e rileggo il display. Si usa guardando la cassa.'),
    pre,
    h('div', { class: 'tasti' }, gruppoTasti.filter((t) => t in tasti).map((t) => h('button', { onclick: () => premi(t) }, t))),
    h('button', { onclick: async () => { try { const r = await api('GET', 'display'); S.display = r.display; pre.textContent = r.display } catch (e) { avviso(e.message, 'male') } } }, 'Leggi il display'))
}

function voceManuale(m) {
  const spunta = !!S.cassa.spunte?.[m.id]
  return h('div', { class: 'riquadro' },
    h('div', { class: 'riga fra' }, h('b', null, `${m.codice} · ${m.cosa}`), h('span', { class: 'chip' }, 'Voluto: ' + m.voluto)),
    h('span', { class: 'piccolo' }, m.come),
    m.id === 'eth910' ? null : h('label', { class: 'riga', style: 'color:var(--testo);font-size:14px' }, h('input', { type: 'checkbox', style: 'width:20px;height:20px', checked: spunta, onchange: (e) => agisci(async () => { await api('POST', 'spunta', { id: m.id, valore: e.target.checked }); await rileggi() }) }), 'Controllato e a posto (spunta del tecnico)'))
}

function disegnaProgramma() {
  const c = S.cassa
  if (!c) return riempi('s-programma')
  const colore = (id) => spiaDi(id)?.colore || 'g'
  const sintesi = (id, vuoto = '') => spiaDi(id)?.valore || vuoto
  const manuali = profilo()?.manuali || []
  const gruppi = [
    gruppo('intest', 'Intestazione', colore('intestazione'), sintesi('intestazione'), corpoIntestazione),
    gruppo('aliq', 'Aliquote IVA', colore('aliquote'), sintesi('aliquote'), corpoAliquote),
    gruppo('ora', 'Data e ora', colore('ora'), sintesi('ora'), corpoOra),
  ]
  if (manuali.length) {
    const eth = manuali.find((m) => m.id === 'eth910'), ip = manuali.find((m) => m.id === 'ip911'), cas = manuali.find((m) => m.id === 'cassetto520'), fpu = manuali.find((m) => m.id === 'fpu019')
    gruppi.push(
      gruppo('rete', 'Rete · 910 / 911 / 912', ip && !S.cassa.spunte?.ip911 ? 'g' : 'v', 'Ethernet · IP fisso (spunta)', () => [voceManuale(eth), voceManuale(ip), tastiera()]),
      gruppo('pag', 'Pagamenti e cassetto · 520', colore('cassetto520'), sintesi('cassetto520'), () => [voceManuale(cas), tastiera()]),
      gruppo('fpu', 'FPU · 019', colore('fpu019'), sintesi('fpu019'), () => [voceManuale(fpu), tastiera()]))
  }
  riempi('s-programma',
    h('div', { class: 'riga fra' }, h('h2', null, '3 · Programmazione'), h('span', { class: 'tenue' }, 'Tocca una voce per aprirla (una alla volta). Ogni scrittura chiede la tua conferma e poi rilegge.')),
    gruppi)
}

function corpoIntestazione() {
  const maxR = profilo()?.intestazioneMaxRighe
  const anteprima = h('div', { class: 'scontrino' })
  const aggiorna = () => {
    anteprima.replaceChildren(h('div', { class: 'piccolo' }, '[logo, da tastiera]'), ...S.intest.filter((r) => r.testo.trim()).map((r) => h('div', { style: `font-size:${r.tipo === 4 ? 22 : r.tipo === 3 ? 12 : 15}px;font-weight:${[2, 4, 5].includes(r.tipo) ? 700 : 400};font-style:${r.tipo === 6 ? 'italic' : 'normal'};letter-spacing:${r.tipo === 5 ? '.18em' : '0'}` }, r.testo)), h('div', { class: 'piccolo' }, 'DOCUMENTO COMMERCIALE'))
  }
  aggiorna()
  const righe = S.intest.map((r, i) => h('div', { class: 'rigaint' },
    h('label', { for: 'ri' + i }, 'Riga ' + (i + 1)),
    h('input', { id: 'ri' + i, type: 'text', maxlength: r.tipo === 3 ? 44 : 32, value: r.testo, placeholder: 'vuota', oninput: (e) => { r.testo = e.target.value.toUpperCase(); e.target.value = r.testo; aggiorna() } }),
    h('select', { 'aria-label': 'Stile della riga ' + (i + 1), onchange: (e) => { r.tipo = Number(e.target.value); aggiorna() } }, Object.entries(STILI).map(([k, n]) => h('option', { value: k, selected: Number(k) === r.tipo }, n)))))
  const comandi = () => [...S.intest.map((r, i) => `6302 ${i + 1} ${r.tipo} …`).slice(0, 2), '… (9 righe)', `6301 ${S.intest.reduce((m, r, i) => (r.testo.trim() ? i + 1 : m), 0)}`, '6303 1']
  return [
    h('div', { class: 'tavolo' }, h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, righe, h('p', { class: 'piccolo', style: 'margin:0' }, `Al massimo 32 caratteri per riga (44 col font piccolo)${maxR ? `; il profilo ammette fino a ${maxR} righe` : ''}. Le righe vuote non si stampano.`)),
      h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, h('b', null, 'Come esce sullo scontrino'), anteprima)),
    h('div', { class: 'riga' }, h('button', { class: 'primario', onclick: () => { S.conf.intest = true; disegnaProgramma() } }, 'Imposta e rileggi'), h('span', { class: 'piccolo' }, 'Manda le righe (6302), quante stamparne (6301), la salva (6303) e la rilegge.')),
    barraConferma('intest', 'Sto per scrivere l\'intestazione sulla cassa', comandi(), async () => {
      const r = await api('POST', 'programma/intestazione', { conferma: true, righe: S.intest })
      avviso(r.ok ? 'Intestazione scritta e riletta: corrisponde' : 'Scritta, ma la rilettura non corrisponde: ' + r.diff.join('; '), r.ok ? 'bene' : 'male')
      await rileggi()
    }),
  ]
}

function corpoAliquote() {
  const nomi = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E' }
  const righe = [1, 2, 3, 4, 5].map((i) => {
    const a = S.cassa.aliquote.find((x) => x.indice === i)
    return h('div', { style: 'display:flex;flex-wrap:wrap;gap:10px;align-items:center' },
      h('span', { style: 'flex:0 0 120px;font-size:14px' }, `${nomi[i]} (${i})${a && !a.programmabile ? ' · fissa' : ''}`),
      h('span', { style: 'flex:1 1 140px;font-size:14px;color:var(--tenue)' }, `Ora: ${a ? a.valore + '%' : '?'}${a?.descrizione ? ' «' + a.descrizione + '»' : ''}`),
      h('input', { type: 'text', style: 'flex:1 1 140px;max-width:200px', 'aria-label': 'Aliquota ' + nomi[i], value: S.aliquote[i], disabled: a && !a.programmabile, placeholder: 'vuota = non toccare', oninput: (e) => { S.aliquote[i] = e.target.value.replace(',', '.') } }))
  })
  return [
    ...righe,
    h('div', { class: 'riga' }, h('button', { class: 'primario', onclick: () => { S.conf.aliq = true; disegnaProgramma() } }, 'Imposta e rileggi'), h('span', { class: 'piccolo' }, 'Comando 7113, solo per le aliquote diverse da quelle volute e programmabili. Se la cassa chiede la chiusura (ERR 54), prima si fa la chiusura.')),
    barraConferma('aliq', 'Sto per programmare le aliquote', Object.entries(S.aliquote).filter(([, v]) => v !== '').map(([i, v]) => `${nomi[i]} = ${v}%`), async () => {
      const valori = Object.fromEntries(Object.entries(S.aliquote).filter(([i, v]) => v !== '' && (S.cassa.aliquote.find((x) => x.indice === Number(i))?.programmabile !== false)).map(([i, v]) => [i, Number(v)]))
      const r = await api('POST', 'programma/aliquote', { conferma: true, valori })
      avviso(r.ok ? `Aliquote riletta: a posto (${r.scritte} scritte)` : 'Rilettura diversa: ' + r.diff.join('; '), r.ok ? 'bene' : 'male')
      await rileggi()
    }),
  ]
}

function corpoOra() {
  const o = spiaDi('ora')
  return [
    h('div', { class: 'riquadro' }, h('span', { class: 'piccolo' }, 'La cassa'), h('b', null, o?.valore || '?'), h('span', { class: 'piccolo' }, 'Si imposta l\'ora italiana del Mac, mai prima dell\'ultima chiusura (comando 2001).')),
    h('div', { class: 'riga' }, h('button', { class: 'primario', onclick: () => { S.conf.ora = true; disegnaProgramma() } }, 'Imposta e rileggi')),
    barraConferma('ora', 'Sto per allineare data e ora della cassa a quelle del Mac', ['2001 GGMMAAHHmm'], async () => {
      const r = await api('POST', 'programma/ora', { conferma: true })
      if (r.serveConferma) avviso(r.nota, 'male')
      else avviso(r.ok ? 'Data e ora allineate' : `Allineata, ma resta uno scarto di ${r.scarto} min`, r.ok ? 'bene' : 'male')
      await rileggi()
    }),
  ]
}

// ───────────────────────── procedure ─────────────────────────
const PROCEDURE = [
  ['vp', 'Verificazione periodica', 'Provata su due K3F-N'],
  ['chiusura', 'Chiusura forzata', 'Quando la cassa la chiede'],
  ['ciclo', 'Ciclo fiscale (cassa nuova)', 'Guidato · fiscalizzazione irreversibile'],
]

function disegnaProcedure() {
  if (!S.app?.collegata) return riempi('s-procedure')
  const p = S.proc
  riempi('s-procedure',
    h('h2', null, '4 · Procedure'),
    h('div', { class: 'griglia' }, PROCEDURE.map(([id, nome, nota]) => h('button', { class: 'scelta' + (p?.id === id ? ' on' : ''), style: 'min-height:76px;display:flex;flex-direction:column;gap:4px', disabled: p?.inEsecuzione, onclick: () => agisci(async () => { S.proc = await api('POST', 'procedura/avvia', { id }); S.input = {}; S.riletto = {}; disegnaProcedure() }) },
      h('b', null, nome), h('span', { class: 'piccolo' }, p?.id === id ? (p.finita ? 'finita' : `passo ${p.corrente + 1} di ${p.passi.length}`) : nota)))),
    p ? [
      h('div', { class: 'riga fra' }, h('h3', null, p.titolo), h('span', { class: 'tenue' }, p.nota)),
      h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, p.passi.map((s, i) => passo(p, s, i))),
      h('div', { class: 'riga' }, h('button', { disabled: p.inEsecuzione, onclick: () => agisci(async () => { await api('POST', 'procedura/annulla'); S.proc = null; disegnaProcedure() }) }, 'Fermati qui (chiudi la procedura)'),
        p.finita ? h('span', { class: 'ok-t' }, 'Procedura finita.') : null),
    ] : null)
}

function inputPasso(s, k) { S.input[s.id] = S.input[s.id] || {}; return S.input[s.id] }

function passo(p, s, i) {
  const corrente = i === p.corrente && !p.finita
  const manuale = s.tipo === 'manuale' || s.tipo === 'guidato'
  const stato = s.stato === 'ok' ? 'ok' : s.stato === 'errore' ? 'errore' : s.stato === 'in_corso' ? 'in_corso' : manuale && corrente ? 'tu' : ''
  const inp = inputPasso(s)
  const corpo = []
  if (s.istruzioni?.length) corpo.push(h('ul', { style: 'margin:0;padding-left:20px' }, s.istruzioni.map((t) => h('li', null, t))))
  if (corrente && s.anteprima?.length && s.tipo !== 'manuale' && s.tipo !== 'guidato') corpo.push(h('div', null, h('span', { class: 'piccolo' }, 'Comandi che mando: '), s.anteprima.map((c) => [h('span', { class: 'cmd' }, c), ' '])))
  if (s.stato === 'in_corso') corpo.push(h('div', { class: 'ambra-t' }, s.avanzamento || 'in corso…'))
  if (s.stato === 'ok' && s.esito) corpo.push(h('div', { class: 'ok-t' }, s.esito))
  if (s.stato === 'errore' && s.errore) {
    corpo.push(h('div', { class: 'errore' }, s.errore.codice ? `Cassa: ERR ${s.errore.codice} — ${s.errore.titolo}` : s.errore.messaggio),
      s.errore.codice ? h('div', { class: 'piccolo' }, s.errore.spiegazione) : null,
      s.daVerificare ? h('div', { class: 'ambra-t' }, 'Il comando potrebbe essere stato eseguito. NON lo rimando alla cieca: prima rileggi lo stato.') : null)
  }
  if (!s.errore && s.esito && s.stato !== 'ok' && corrente) corpo.push(h('div', { class: 'piccolo' }, 'Rilettura: ' + s.esito))
  if (corrente && s.stato !== 'in_corso') {
    const az = []
    const eseguiBtn = (testo, extra) => h('button', { class: 'primario' + (s.fiscalizzazione ? ' pericolo' : ''), disabled: s.daVerificare && !S.riletto[s.id], onclick: () => lancia(s, inp), ...extra }, testo)
    if (s.tipo === 'lettura') az.push(eseguiBtn('Esegui questo passo'))
    else if (s.tipo === 'scrive') {
      if (s.fiscalizzazione) corpo.push(h('div', { class: 'conferma irrev' },
        h('div', { class: 'irrev-titolo' }, 'IRREVERSIBILE'),
        h('div', null, 'La fiscalizzazione non si può disfare. Per confermare riscrivi la matricola della cassa e la parola IRREVERSIBILE.'),
        h('div', { class: 'griglia' },
          h('div', { class: 'campo' }, h('label', { for: 'fm' }, 'Matricola'), h('input', { id: 'fm', type: 'text', autocomplete: 'off', value: inp.matricola || '', placeholder: S.app.matricola, oninput: (e) => { inp.matricola = e.target.value.trim() } })),
          h('div', { class: 'campo' }, h('label', { for: 'fp' }, 'Scrivi: IRREVERSIBILE'), h('input', { id: 'fp', type: 'text', autocomplete: 'off', value: inp.scritta || '', oninput: (e) => { inp.scritta = e.target.value.trim() } })))))
      else if (s.conferma === 'scritta') corpo.push(h('div', { class: 'conferma' }, h('div', null, `Per confermare scrivi la parola ${s.parola}.`), h('div', { class: 'campo', style: 'max-width:240px' }, h('input', { type: 'text', 'aria-label': 'Conferma scritta', autocomplete: 'off', value: inp.scritta || '', placeholder: s.parola, oninput: (e) => { inp.scritta = e.target.value.trim() } }))))
      if (s.conCampi) corpo.push(h('div', { class: 'riga' }, h('div', { class: 'campo', style: 'width:110px' }, h('label', null, 'Mese prossima'), h('input', { type: 'text', value: inp.mm || '', placeholder: 'MM', oninput: (e) => { inp.mm = e.target.value.trim() } })), h('div', { class: 'campo', style: 'width:110px' }, h('label', null, 'Anno (2 cifre)'), h('input', { type: 'text', value: inp.aa || '', placeholder: 'AA', oninput: (e) => { inp.aa = e.target.value.trim() } })), h('span', { class: 'piccolo' }, 'Vuoti = fra 24 mesi.')))
      az.push(eseguiBtn(s.stato === 'errore' ? 'Conferma e rimanda questo passo' : 'Conferma e manda', {}))
    } else if (s.tipo === 'guidato') {
      az.push(h('button', { class: 'primario', onclick: () => rilettura(s, i) }, 'Rileggi la cassa'))
      if (s.pagina) az.push(h('a', { href: `http://${S.app.ip}${s.pagina}`, target: '_blank', rel: 'noopener' }, `Apri la pagina ${s.pagina.slice(1, -4)} del web server`))
    } else if (s.tipo === 'manuale') {
      az.push(h('button', { class: 'primario', onclick: () => agisci(async () => { S.proc = await api('POST', 'procedura/segna', { passo: i }); disegnaProcedure() }) }, 'L\'ho fatto'))
    }
    if (s.puoVerificare && s.stato === 'errore') az.push(h('button', { class: 'contorno', onclick: () => rilettura(s, i) }, 'Rileggi lo stato'))
    if (s.senzaRilettura && s.stato === 'errore' && s.daVerificare && !S.riletto[s.id]) az.push(h('button', { class: 'contorno', onclick: () => { S.riletto[s.id] = true; disegnaProcedure() } }, 'Ho guardato la carta: è stato fatto'))
    if (s.tipo === 'scrive' && s.stato === 'errore' && !s.fiscalizzazione) az.push(h('button', { disabled: s.daVerificare && !S.riletto[s.id], onclick: () => agisci(async () => { S.proc = await api('POST', 'procedura/segna', { passo: i }); disegnaProcedure() }) }, 'Considera fatto (l\'ho visto sulla cassa)'))
    corpo.push(h('div', { class: 'riga' }, az))
    if (s.tastiera || s.id === 'p601') corpo.push(tastiera())
  }
  return h('div', { class: 'passo' + (corrente ? ' corrente' : '') + (stato === 'tu' ? ' tu' : '') },
    h('span', { class: 'n ' + stato }, s.stato === 'ok' ? '✓' : String(s.n)),
    h('div', { class: 'c' }, h('b', null, s.titolo), h('span', { class: 'tenue' }, s.dettaglio), corpo))
}

async function lancia(s, inp) {
  const input = { conferma: true, ...inp }
  const i = S.proc.passi.findIndex((x) => x.id === s.id)
  if (S.occupato) return
  try {
    S.proc = await api('POST', 'procedura/esegui', { passo: i, input })
    disegnaProcedure()
    S.riletto[s.id] = false
    await segui()
  } catch (e) { avviso(e.message, 'male', e.dettaglio) }
}
async function segui() {
  while (S.proc?.inEsecuzione) {
    await new Promise((r) => setTimeout(r, 800))
    S.proc = await api('GET', 'procedura')
    disegnaProcedure()
  }
  const f = S.proc?.passi?.[Math.max(0, (S.proc?.corrente ?? 1) - 1)]
  if (S.proc?.passi?.some((x) => x.stato === 'errore')) avviso('Il passo si è fermato: guarda l\'errore sotto il passo.', 'male')
  else if (f) avviso(`Passo riuscito: ${f.titolo}`, 'bene')
  caricaCheck(); caricaRegistro()
}
async function rilettura(s, i) {
  await agisci(async () => {
    const r = await api('POST', 'procedura/controlla', { passo: i })
    S.proc = r.procedura
    S.riletto[s.id] = true
    avviso((r.rilettura.ok ? 'Rilettura: ' : 'Rilettura, non ancora: ') + r.rilettura.testo, r.rilettura.ok ? 'bene' : 'info')
    disegnaProcedure()
  })
  caricaCheck(); caricaRegistro()
}

// ───────────────────────── check-list ─────────────────────────
function disegnaCheck() {
  const c = S.check
  if (!c || !S.app?.collegata) return riempi('s-checklist')
  const salva = () => agisci(async () => { S.check = await api('POST', 'checklist', { dati: c.dati, spunte: Object.fromEntries(c.righe.map((r) => [r.riga, r.si])) }); disegnaCheck() }, 'Check-list salvata')
  riempi('s-checklist',
    h('div', { class: 'riga fra' }, h('h2', null, '5 · Check-list Mod. 10.1 + 10.2'), h('span', { class: 'tenue' }, 'Blu = l\'ha verificato la procedura · grigio = lo spunti tu')),
    h('div', { class: 'griglia' }, c.campi.map(([k, et]) => h('div', { class: 'campo' }, h('label', { for: 'cl-' + k }, et), h('input', { id: 'cl-' + k, type: 'text', value: c.dati[k] || '', maxlength: k === 'nota' ? 50 : 120, oninput: (e) => { c.dati[k] = e.target.value } })))),
    h('div', { class: 'griglia larga' }, c.righe.map((r) => h('label', { class: 'check' + (r.verificata ? ' auto' : '') },
      h('input', { type: 'checkbox', checked: r.si, disabled: r.verificata && r.si, onchange: (e) => { r.si = e.target.checked } }),
      h('span', null, h('span', null, h('span', { class: 'nr' }, r.riga + ' '), r.testo), h('div', { class: 'ruolo', style: `color:${r.verificata ? 'var(--blu)' : 'var(--tenue)'}` }, r.chi === 'procedura' ? (r.verificata ? 'verificato dalla procedura' : 'non ancora verificata dalla procedura (puoi spuntarla tu)') : 'spunta del tecnico'))))),
    h('div', { class: 'riga' },
      h('button', { class: 'primario', onclick: salva }, 'Salva'),
      h('button', { class: 'contorno', onclick: async () => { await salva(); window.open(BASE + 'api/checklist/stampa', '_blank', 'noopener') } }, 'Apri la pagina stampabile'),
      h('button', { class: 'contorno', onclick: async () => { await salva(); try { const t = await (await fetch(BASE + 'api/checklist/testo')).text(); S.testoCrm = t; try { await navigator.clipboard.writeText(t); avviso('Testo copiato: incollalo nel GST del CRM', 'bene') } catch { avviso('Non riesco a copiare da solo: seleziona il testo qui sotto', 'info') } disegnaCheck() } catch (e) { avviso(e.message, 'male') } } }, 'Copia il testo per il GST del CRM')),
    S.testoCrm ? h('pre', { class: 'registro', style: 'max-height:260px' }, S.testoCrm) : null,
    h('div', { class: 'riquadro' }, h('b', null, 'Prossimo passo (non ancora fatto)'), h('span', { class: 'tenue' }, 'La firma del cliente a distanza e la scrittura dell\'esito nel GST del CRM non si fanno ancora da qui. Per ora: stampa o salva in PDF la pagina, fai firmare il cliente, e incolla il testo riepilogativo nell\'intervento del CRM.')))
}

// ───────────────────────── registro e impostazioni ─────────────────────────
function disegnaRegistro() {
  if (!S.app?.collegata) return riempi('s-registro')
  riempi('s-registro',
    h('div', { class: 'riga fra' }, h('h2', null, '6 · Registro'), h('div', { class: 'riga' }, h('span', { class: 'piccolo' }, 'Ogni comando mandato e ogni risposta, ora italiana'), h('button', { onclick: () => caricaRegistro() }, 'Aggiorna'))),
    h('pre', { class: 'registro', tabindex: '0' }, S.registro.length ? S.registro.join('\n') : '(ancora vuoto)'),
    h('span', { class: 'piccolo' }, 'File: ~/Library/Application Support/GED Assistance/strumenti-cassa/' + S.app.matricola + '.log'))
}

function disegnaImpostazioni() {
  const i = S.app?.impostazioni
  if (!i) return riempi('s-impostazioni')
  const v = { cf: i.tecnico.cf, piva: i.laboratorio.piva, nome: i.tecnico.nome }
  riempi('s-impostazioni',
    h('h2', null, 'Impostazioni del tecnico'),
    h('div', { class: 'griglia' },
      h('div', { class: 'campo' }, h('label', { for: 'imp-n' }, 'Tecnico'), h('input', { id: 'imp-n', type: 'text', value: v.nome, oninput: (e) => { v.nome = e.target.value } })),
      h('div', { class: 'campo' }, h('label', { for: 'imp-cf' }, 'Codice fiscale del tecnico (16 caratteri)'), h('input', { id: 'imp-cf', type: 'text', maxlength: 16, value: v.cf, oninput: (e) => { v.cf = e.target.value.toUpperCase() } })),
      h('div', { class: 'campo' }, h('label', { for: 'imp-p' }, 'P.IVA del laboratorio (11 cifre)'), h('input', { id: 'imp-p', type: 'text', maxlength: 11, value: v.piva, oninput: (e) => { v.piva = e.target.value } }))),
    h('div', { class: 'riga' }, h('button', { onclick: () => agisci(async () => { S.app = await api('POST', 'impostazioni', { tecnico: { cf: v.cf, nome: v.nome }, laboratorio: { piva: v.piva } }); disegnaTutto() }, 'Impostazioni salvate') }, 'Salva'), h('span', { class: 'piccolo' }, 'Si usano nell\'intervento tecnico della verificazione e nei dati del modulo.')))
}

function disegnaPiede() {
  riempi('piede', h('p', { class: 'piccolo' }, 'Strumenti cassa è un programma locale: ascolta solo su questo Mac, l\'indirizzo contiene un codice segreto e vale finché il programma è acceso. Mai 3006, mai la lettura stampata (7101 OPER 0), mai reset né firmware; chiave, censimento e attivazione restano guidati.'))
}

function disegnaTutto() { disegnaTestata(); disegnaCollega(); disegnaProfilo(); disegnaStato(); disegnaProgramma(); disegnaProcedure(); disegnaCheck(); disegnaRegistro(); disegnaImpostazioni(); disegnaPiede() }

;(async () => {
  try { await caricaApp() } catch (e) { avviso('Non riesco a parlare col programma: ' + e.message, 'male') }
  disegnaTutto()
  if (S.app?.collegata) { try { await rileggi(); await caricaCheck(); await caricaRegistro(); await caricaProcedura(); if (S.proc?.inEsecuzione) segui() } catch (e) { avviso(e.message, 'male') } }
})()
