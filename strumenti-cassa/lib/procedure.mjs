// LE PROCEDURE: passi uno alla volta, conferma esplicita per ogni passo che scrive, rilettura dopo.
//
//   vp         Verificazione periodica (sequenza provata il 22/10 e il 27/10, riscritta dagli script Python)
//   chiusura   Chiusura forzata (2002 + attesa dell'invio)
//   ciclo      Ciclo fiscale per una cassa NUOVA, GUIDATO: chiave, censimento, fiscalizzazione, accreditamento,
//              attivazione, QR. Solo la fiscalizzazione ha un comando (2005, stringa provata il 22/10), dietro doppia conferma.
//
// REGOLE DEL MOTORE
//  - Un solo passo alla volta, nell'ordine: il successivo si sblocca solo quando il precedente è riuscito.
//  - Un passo che scrive parte solo con `input.conferma === true`; chiusura e fiscalizzazione chiedono anche la scritta.
//  - Al primo errore ci si ferma. Se un comando che scrive non ha risposto, il passo diventa «da verificare»: NON si rimanda
//    alla cieca, si rilegge lo stato (`verifica`) e solo un nuovo clic esplicito lo ripete.
import { cifre } from './protocollo.mjs'
import { CassaErrore, ErroreCassa, NessunaRisposta, ConnessioneCaduta } from './cassa.mjs'
import { interpreta1104, interpreta1012, interpreta1017, interpreta1515, interpreta1511, interpreta1001, oraRoma, scartoMinuti, dataIt } from './stato.mjs'
import { leggiStatus } from './web.mjs'

export class PassoErrore extends Error { constructor(m, daVerificare = false) { super(m); this.name = 'PassoErrore'; this.daVerificare = daVerificare } }

const z2 = (n) => String(n).padStart(2, '0')

// ───────────────────────── pezzi riusabili ─────────────────────────

/** Attesa dell'invio all'Agenzia: ciclo su 1515 (come negli script: ogni 15 s finché non c'è più ERR99). */
async function attendiInvio(ctx, st, z, { tentativi = 12 } = {}) {
  for (let t = 1; t <= tentativi; t++) {
    const r = await ctx.sessione((s) => s.mandaSeLibera('1515' + '0' + cifre(z, 4) + '0000'), {})
    if (r !== null) {
      const x = interpreta1515(r)
      if (!x) throw new PassoErrore(`risposta illeggibile a 1515: «${r.slice(0, 30)}»`)
      if (x.stato === 'inviato') return x
      if (x.stato === 'via_browser') return { ...x, nota: 'inviata usando il browser del PC' }
      throw new PassoErrore(`la chiusura ${z} risulta «${x.stato === 'fallito' ? 'inviata ma fallita' : 'inviata senza risposta'}»: guarda l'esito sul web server (Corrispettivi) e sulla carta`)
    }
    st.avanza(`la cassa sta ancora inviando la chiusura ${z} all'Agenzia (controllo ${t}/${tentativi}, ogni ${Math.round(ctx.intervalloMs / 1000)} s)`)
    await ctx.attendi(ctx.intervalloMs)
  }
  throw new PassoErrore(`la chiusura ${z} non risulta ancora inviata dopo ${tentativi} controlli: attendi e premi «Rileggi»`)
}

/** Una chiusura (2002): conta le chiusure prima e dopo. Il comando non si ripete mai da solo. */
async function chiudi(ctx, st) {
  return ctx.sessione(async (s) => {
    const prima = interpreta1104(await s.manda('1104'))
    if (!prima) throw new PassoErrore('1104 illeggibile')
    if (interpreta1012(await s.manda('1012')) !== 0) throw new PassoErrore('c\'è un documento aperto sulla cassa: annullalo o chiudilo, poi riprova')
    st.vars.chiusureAttese = prima.chiusure
    await s.manda('20020')
    const dopo = interpreta1104(await s.manda('1104'))
    if (!dopo || dopo.chiusure !== prima.chiusure + 1) throw new PassoErrore(`il contatore delle chiusure non è salito (era ${prima.chiusure}, ora ${dopo ? dopo.chiusure : '?'}): non rimando il comando, rileggo`, true)
    return dopo.chiusure
  }, { clic: true, scritta: true })
}

const verificaChiusura = (ctx, st) => async () => {
  const r = await ctx.sessione(async (s) => interpreta1104(await s.manda('1104')))
  const att = st.vars.chiusureAttese
  if (att == null) return { ok: false, testo: `1104: ${r?.chiusure} chiusure. Non so da quale numero partivo: guarda la carta.` }
  return r && r.chiusure === att + 1 ? { ok: true, testo: `la chiusura è stata fatta: ${att} → ${r.chiusure}` } : { ok: false, testo: `le chiusure sono ancora ${r?.chiusure} (partivo da ${att}): la chiusura NON risulta fatta` }
}

function rigaVendita(descr, cent) { return '3301' + '1' + '000000000' + '001' + cifre(descr.length, 2) + descr + cifre(cent, 9) + '00' }
function pagamentoElettronico(cent) { return '3007' + '03' + '00' + cifre('ELETTRONICO'.length, 2) + 'ELETTRONICO' + cifre(cent, 9) }

function prossimaVerifica(adesso, mesi = 24) {
  const o = oraRoma(adesso)
  const tot = o.a * 12 + (o.m - 1) + mesi
  return { mm: z2((tot % 12) + 1), aa: z2(Math.floor(tot / 12) % 100) }
}

// ───────────────────────── verificazione periodica ─────────────────────────

function defVP(ctx) {
  const imp = () => ctx.impostazioni()
  const mmaa = (st) => st.vars.prossima || prossimaVerifica(ctx.adesso())
  return {
    id: 'vp', titolo: 'Verificazione periodica', nota: 'Sequenza provata su due K3F-N (22/10 e 27/10). I passi che scrivono chiedono un clic; le chiusure anche la scritta.',
    passi: [
      {
        id: 'controlli', titolo: 'Controlli di partenza', dettaglio: 'Matricola, nessun documento aperto, cassa attivata e non in demo, firmware, CF del tecnico e P.IVA del laboratorio.', tipo: 'lettura', anteprima: () => ['1008', '1012', '1511', '1013', '1104'],
        async esegui(st) {
          const i = imp()
          if (!/^[A-Z0-9]{16}$/.test(i.tecnico.cf)) throw new PassoErrore('il codice fiscale del tecnico nelle impostazioni non ha 16 caratteri')
          if (!/^\d{11}$/.test(i.laboratorio.piva)) throw new PassoErrore('la P.IVA del laboratorio nelle impostazioni non ha 11 cifre')
          const r = await ctx.sessione(async (s) => ({
            doc: interpreta1012(await s.manda('1012')), stato: interpreta1511(await s.manda('1511')), chiusure: interpreta1104(await s.manda('1104')),
            fw: /(\d{1,2}\.\d{2}\.\d{2})/.exec(await s.manda('1013'))?.[1] ?? null,
          }))
          if (r.doc !== 0) throw new PassoErrore('c\'è un documento aperto sulla cassa: annullalo o chiudilo, poi riprova')
          if (!r.stato?.attivata || !r.stato?.inServizio) throw new PassoErrore('la cassa non è attivata e in servizio: la verificazione periodica si fa su una cassa in servizio')
          if (r.stato.demo || r.stato.simulazione) throw new PassoErrore('la cassa è in demo/simulazione: gli annulli non sarebbero controllabili. Togli la demo prima')
          st.vars.chiusure0 = r.chiusure?.chiusure
          st.vars.firmware = r.fw
          const ultimo = ctx.firmwareUltimo(r.fw)
          ctx.checklist.auto('2.2', { ok: !!r.fw, testo: `Firmware sulla cassa: ${r.fw ?? 'non letto'}` })
          ctx.checklist.auto('2.3', { ok: !!ultimo && r.fw === ultimo, testo: ultimo ? `È l'ultimo del produttore (${ultimo})` : 'Ultimo del produttore non dichiarato' })
          ctx.checklist.auto('2.4', { ok: !!ultimo && r.fw === ultimo, testo: !!ultimo && r.fw === ultimo ? 'Aggiornamento firmware: non serviva' : 'Aggiornamento firmware: da fare / da dichiarare' })
          return `chiusure finora: ${r.chiusure?.chiusure} · firmware ${r.fw ?? '?'}${ultimo && r.fw !== ultimo ? ` (l'ultimo dichiarato è ${ultimo}: la riga 2.4 resta da spuntare a mano)` : ''}`
        },
      },
      {
        id: 'chiusura1', titolo: 'Chiusura prima dell\'intervento', dettaglio: 'Chiusura giornaliera: azzera la giornata, così le prove stanno da sole in quella dopo.', tipo: 'scrive', conferma: 'scritta', parola: 'CHIUSURA', anteprima: () => ['1104', '1012', '20020', '1104'],
        async esegui(st) { const z = await chiudi(ctx, st); st.vars.z1 = z; ctx.checklist.auto('2.8', { ok: true, testo: `Chiusura prima dell'intervento (Z ${z})` }); return `chiusura ${z} fatta` },
        verifica: (st) => verificaChiusura(ctx, st)().then((r) => { if (r.ok) st.vars.z1 = st.vars.chiusureAttese + 1; return r }),
      },
      {
        id: 'invio1', titolo: 'Invio della chiusura', dettaglio: 'Si aspetta che l\'Agenzia la riceva: 1515 ogni 15 secondi finché non risponde senza ERR99.', tipo: 'lettura', anteprima: (st) => [`1515 0 ${st.vars.z1 ?? '<Z>'} 0000 (ripetuto)`],
        async esegui(st) { const x = await attendiInvio(ctx, st, st.vars.z1); return `Z ${x.chiusura}: ${x.stato}${x.nota ? ' (' + x.nota + ')' : ''}` },
      },
      {
        id: 'scontrini', titolo: 'Due scontrini di prova', dettaglio: 'Due scontrini da due righe da 1,11 €, pagamento elettronico: 2,22 € ciascuno.', tipo: 'scrive', conferma: 'clic',
        anteprima: () => [rigaVendita('PROVA VERIFICA 1', 111), rigaVendita('PROVA VERIFICA 2', 111), pagamentoElettronico(222), '3011', '3013', '1017', '(poi lo stesso per il secondo)'],
        async esegui(st) {
          st.vars.ricevute = []
          await ctx.sessione(async (s) => {
            if (interpreta1012(await s.manda('1012')) !== 0) throw new PassoErrore('c\'è un documento aperto sulla cassa')
            for (let k = 1; k <= 2; k++) {
              try {
                for (const c of [rigaVendita('PROVA VERIFICA 1', 111), rigaVendita('PROVA VERIFICA 2', 111), pagamentoElettronico(222), '3011', '3013']) await s.manda(c)
              } catch (e) {
                const aperto = await s.manda('1012').then(interpreta1012).catch(() => null)
                if (aperto) e.message += ` — Attenzione: sulla cassa c'è uno scontrino aperto (1012 = ${aperto}): annullalo con il tasto ANNUL.SCONTRINO della tastiera remota e rifai il passo.`
                throw e
              }
              const d = interpreta1017(await s.manda('1017'))
              if (!d) throw new PassoErrore('1017 illeggibile dopo lo scontrino', true)
              st.vars.ricevute.push({ n: d.numero, ggmmaa: d.ggmmaa, totaleCent: d.totaleCent })
              st.avanza(`scontrino ${k} emesso: n° ${d.numero}`)
            }
          }, { clic: true })
          ctx.checklist.auto('2.9', { ok: true, testo: `Due documenti di prova (n° ${st.vars.ricevute.map((r) => r.n).join(' e ')})` })
          return `emessi gli scontrini n° ${st.vars.ricevute.map((r) => r.n).join(' e ')}`
        },
        verifica: (st) => ctx.sessione(async (s) => { const d = interpreta1017(await s.manda('1017')); const a = interpreta1012(await s.manda('1012')); return { ok: false, testo: `Ultimo documento: n° ${d?.numero} da ${d ? (d.totaleCent / 100).toFixed(2) : '?'} €, stato scontrino (1012) = ${a}. Se vedi i due scontrini sulla carta, usa «Considera fatto».` } }),
      },
      {
        id: 'annulli', titolo: 'Annullo dei due scontrini', dettaglio: 'Per ciascuno: prima il controllo (senza stampa, deve rispondere 1), poi il documento di annullo. Numero di chiusura = chiusure + 1.', tipo: 'scrive', conferma: 'clic',
        anteprima: (st) => (st.vars.ricevute || [{}, {}]).flatMap((r) => [`7101A <Z=1104+1> ${cifre(r.n ?? 0, 4)} ${r.ggmmaa ?? '<data>'} 8`, `7101A <Z> ${cifre(r.n ?? 0, 4)} ${r.ggmmaa ?? '<data>'} 1`]),
        async esegui(st) {
          if (!st.vars.ricevute?.length) throw new PassoErrore('non ho i numeri degli scontrini di prova: rifai il passo precedente')
          let ultimo
          await ctx.sessione(async (s) => {
            const c = interpreta1104(await s.manda('1104'))
            const Z = c.chiusure + 1
            st.vars.zAnnulli = Z
            for (const r of st.vars.ricevute) {
              const base = `7101A${cifre(Z, 4)}${cifre(r.n, 4)}${r.ggmmaa}`
              const ctrl = await s.manda(base + '8')
              if (ctrl !== '71011') throw new PassoErrore(`controllo dell'annullo del documento ${r.n} non superato (risposta ${ctrl}, FLAG ${ctrl[4]}: 1 trovato, 0 non trovato — succede in demo —, 2 non permesso). Non annullo.`)
              const ann = await s.manda(base + '1')
              if (ann !== '71011') throw new PassoErrore(`l'annullo del documento ${r.n} non è stato accettato (risposta ${ann})`, true)
              ultimo = interpreta1017(await s.manda('1017'))
              st.avanza(`annullato il documento ${r.n}`)
            }
          }, { clic: true })
          st.vars.ultimoDoc = ultimo?.numero
          ctx.checklist.auto('2.10', { ok: true, testo: `Annullo dei documenti di prova (n° ${st.vars.ricevute.map((r) => r.n).join(' e ')}, Z ${st.vars.zAnnulli})` })
          return `annullati i documenti ${st.vars.ricevute.map((r) => r.n).join(' e ')} (ultimo documento: ${ultimo?.numero ?? '?'})`
        },
      },
      {
        id: 'chiusura2', titolo: 'Chiusura con le prove dentro', dettaglio: 'La chiusura che contiene gli scontrini di prova e i loro annulli.', tipo: 'scrive', conferma: 'scritta', parola: 'CHIUSURA', anteprima: () => ['1104', '1012', '20020', '1104'],
        async esegui(st) { const z = await chiudi(ctx, st); st.vars.z2 = z; ctx.checklist.auto('2.12', { ok: true, testo: `Chiusura coerente (Z ${z})` }); return `chiusura ${z} fatta` },
        verifica: (st) => verificaChiusura(ctx, st)().then((r) => { if (r.ok) st.vars.z2 = st.vars.chiusureAttese + 1; return r }),
      },
      {
        id: 'invio2', titolo: 'Invio della chiusura con le prove', dettaglio: 'Di nuovo l\'attesa dell\'Agenzia.', tipo: 'lettura', anteprima: (st) => [`1515 0 ${st.vars.z2 ?? '<Z>'} 0000 (ripetuto)`],
        async esegui(st) { const x = await attendiInvio(ctx, st, st.vars.z2); ctx.checklist.auto('2.13', { ok: true, testo: `Invio XML con esito positivo (Z ${x.chiusura})` }); return `Z ${x.chiusura}: ${x.stato}` },
      },
      {
        id: 'inizio', titolo: 'Intervento tecnico: inizio', dettaglio: 'Apre l\'intervento sulla cassa (6404 fase 0).', tipo: 'scrive', conferma: 'clic', anteprima: () => ['64040'],
        async esegui() { await ctx.sessione(async (s) => { await s.manda('64040') }, { clic: true }); return 'intervento aperto' },
      },
      {
        id: 'fine', titolo: 'Intervento tecnico: fine (verifica positiva)', dettaglio: 'Chiude l\'intervento con esito 3 (verifica periodica positiva), il tuo codice fiscale e la P.IVA del laboratorio. La cassa poi chiude da sola.', tipo: 'scrive', conferma: 'clic',
        anteprima: () => [fineCmd(imp())],
        async esegui(st) {
          const c = fineCmd(imp())
          const dopo = await ctx.sessione(async (s) => { const p = interpreta1104(await s.manda('1104')); await s.manda(c); return p }, { clic: true })
          st.vars.chiusureDopoFine = dopo?.chiusure
          ctx.checklist.auto('4.1', { ok: true, testo: 'Dati del tecnico e del laboratorio sul RT' })
          ctx.checklist.auto('4.2', { ok: true, testo: 'Esito registrato sul RT (verifica periodica positiva)' })
          return 'intervento chiuso con esito 3'
        },
      },
      {
        id: 'zauto', titolo: 'Chiusura automatica e invio', dettaglio: 'Dopo la fine dell\'intervento la cassa chiude da sola: aspetto che il contatore salga e che l\'Agenzia riceva.', tipo: 'lettura', anteprima: () => ['1104 (ripetuto)', '1515 0 <Z> 0000 (ripetuto)'],
        async esegui(st) {
          const base = st.vars.chiusureDopoFine ?? st.vars.z2
          let z = null
          for (let t = 1; t <= 18 && z === null; t++) {
            const c = await ctx.sessione(async (s) => interpreta1104(await s.manda('1104')))
            if (c && c.chiusure > base) z = c.chiusure
            else { st.avanza(`aspetto la chiusura automatica della cassa (controllo ${t}/18)`); await ctx.attendi(Math.min(ctx.intervalloMs, 5000)) }
          }
          if (z === null) throw new PassoErrore('la cassa non ha fatto la chiusura automatica dopo la fine dell\'intervento: guarda la carta e il display')
          st.vars.z3 = z
          const x = await attendiInvio(ctx, st, z)
          return `chiusura automatica Z ${z}: ${x.stato}`
        },
      },
      {
        id: 'memorie', titolo: 'Test delle memorie', dettaglio: 'La cassa stampa «avvio procedura verif. periodica». Mese e anno della PROSSIMA verifica (di norma fra 24 mesi). Può durare fino a 45 secondi.', tipo: 'scrive', conferma: 'clic', conCampi: ['mm', 'aa'],
        anteprima: (st) => [`2006${mmaa(st).mm}${mmaa(st).aa}`],
        async esegui(st, input) {
          const mm = String(input.mm ?? mmaa(st).mm).padStart(2, '0'); const aa = String(input.aa ?? mmaa(st).aa).padStart(2, '0')
          if (!/^(0[1-9]|1[0-2])$/.test(mm) || !/^\d\d$/.test(aa)) throw new PassoErrore('mese e anno della prossima verifica non validi')
          st.vars.prossima = { mm, aa }
          for (let t = 1; t <= 4; t++) {
            try { await ctx.sessione(async (s) => { await s.manda('2006' + mm + aa) }, { clic: true }); return `test delle memorie fatto, prossima verifica ${mm}/20${aa}` } catch (e) {
              // 213/97: la cassa NON ha eseguito perché occupata a inviare → si attende e si ripete. Qualsiasi altra cosa si ferma.
              if (e instanceof ErroreCassa && (e.codice === 213 || e.codice === 97) && t < 4) { st.avanza(`la cassa è occupata (ERR ${e.codice}), riprovo fra poco (${t}/3)`); await ctx.attendi(ctx.intervalloMs); continue }
              throw e
            }
          }
        },
      },
      {
        id: 'dgfe', titolo: 'Stampa DGFE degli scontrini di prova', dettaglio: 'Stampa la memoria di dettaglio dei documenti di prova (e dei loro annulli).', tipo: 'scrive', conferma: 'clic',
        anteprima: (st) => [dgfeCmd(st)],
        async esegui(st) {
          const c = dgfeCmd(st)
          if (/<|\?/.test(c)) throw new PassoErrore('non ho data e numeri degli scontrini di prova')
          await ctx.sessione(async (s) => { await s.manda(c) }, { clic: true })
          ctx.checklist.auto('2.14', { ok: true, testo: 'DGFE delle prove stampato' })
          return 'DGFE stampata'
        },
      },
      {
        id: 'rilettura', titolo: 'Rilettura finale', dettaglio: 'Chiusure, documento aperto, corrispettivi non inviati: quello che finisce nella check-list.', tipo: 'lettura', anteprima: () => ['1104', '1012', '1017', '(web server) index.htm'],
        async esegui(st) {
          const r = await ctx.sessione(async (s) => ({ c: interpreta1104(await s.manda('1104')), a: interpreta1012(await s.manda('1012')), d: interpreta1017(await s.manda('1017')) }))
          const w = await ctx.webIndice()
          if (r.a !== 0) throw new PassoErrore(`sulla cassa c'è un documento aperto (1012 = ${r.a})`)
          if (w && (w.nonInviati || w.falliti)) throw new PassoErrore(`corrispettivi non a posto: ${w.nonInviati} non inviati, ${w.falliti} falliti`)
          ctx.checklist.dati({ azzeramenti: String(r.c?.chiusure ?? '') })
          const m = mmaa(st); const o = oraRoma(ctx.adesso())
          ctx.salvaVP({ data: dataIt(o), prossima: `${m.mm}/20${m.aa}` })
          return `${r.c?.chiusure} chiusure · nessun documento aperto${w ? ` · corrispettivi: ${w.nonInviati} non inviati, ${w.falliti} falliti` : ' · corrispettivi non leggibili dal web server'}`
        },
      },
      {
        id: 'p601', titolo: 'P601 — scadenza della prossima verifica', dettaglio: 'Dalla tastiera della cassa (o dalla tastiera remota qui sotto): P601 con la data della prossima verifica. Nessun comando di protocollo.', tipo: 'manuale', tastiera: true,
        istruzioni: (st) => [`Assetto PROGRAMMAZIONE → P601 → giorno, mese, anno → conferma.`, `Data da scrivere: ${dataProssima(ctx.adesso(), st)}`, 'Poi spunta «L\'ho fatto».'],
      },
      { id: 'fisici', titolo: 'Controlli fisici e check-list', dettaglio: 'Involucro, targhetta, sigillo, QR, tasti, display, stampa: li spunti nella check-list qui sotto, poi la esporti.', tipo: 'manuale', istruzioni: () => ['Apri la check-list (sezione sotto), spunta le righe grigie, compila i dati del modulo.', 'Poi spunta «L\'ho fatto».'] },
    ],
  }
}

const fineCmd = (i) => `64041` + '3' + cifre(i.tecnico.cf.length, 2) + i.tecnico.cf + cifre(i.laboratorio.piva.length, 2) + i.laboratorio.piva + '00'
function dgfeCmd(st) {
  const r = st.vars.ricevute
  if (!r?.length || !st.vars.ultimoDoc) return '8002<ggmmaa><primo><ultimo>0'
  return `8002${r[0].ggmmaa}${cifre(r[0].n, 4)}${cifre(st.vars.ultimoDoc, 4)}0`
}
function dataProssima(adesso, st) {
  const m = st.vars.prossima || prossimaVerifica(adesso)
  const o = oraRoma(adesso)
  return `${z2(o.g)}/${m.mm}/20${m.aa}`
}

// ───────────────────────── chiusura forzata ─────────────────────────

function defChiusura(ctx) {
  return {
    id: 'chiusura', titolo: 'Chiusura forzata', nota: 'Quando la cassa la chiede o è bloccata. Chiusura giornaliera + attesa dell\'invio all\'Agenzia.',
    passi: [
      {
        id: 'controllo', titolo: 'Nessun documento aperto', dettaglio: 'Se c\'è uno scontrino a metà ci si ferma e si dice.', tipo: 'lettura', anteprima: () => ['1012', '1104'],
        async esegui(st) {
          const r = await ctx.sessione(async (s) => ({ a: interpreta1012(await s.manda('1012')), c: interpreta1104(await s.manda('1104')) }))
          if (r.a !== 0) throw new PassoErrore(`sulla cassa c'è un documento aperto (1012 = ${r.a}): annullalo o chiudilo, poi riprova`)
          st.vars.chiusure0 = r.c?.chiusure
          return `nessun documento aperto · ${r.c?.chiusure} chiusure finora`
        },
      },
      {
        id: 'chiusura', titolo: 'Chiusura', dettaglio: 'Solo dopo il tuo sì, e scrivendo la parola.', tipo: 'scrive', conferma: 'scritta', parola: 'CHIUSURA', anteprima: () => ['1104', '1012', '20020', '1104'],
        async esegui(st) { const z = await chiudi(ctx, st); st.vars.z = z; return `chiusura ${z} fatta` },
        verifica: (st) => verificaChiusura(ctx, st)().then((r) => { if (r.ok) st.vars.z = st.vars.chiusureAttese + 1; return r }),
      },
      {
        id: 'invio', titolo: 'Invio all\'Agenzia', dettaglio: 'Si aspetta la ricevuta.', tipo: 'lettura', anteprima: (st) => [`1515 0 ${st.vars.z ?? '<Z>'} 0000 (ripetuto)`],
        async esegui(st) { const x = await attendiInvio(ctx, st, st.vars.z); return `Z ${x.chiusura}: ${x.stato}` },
      },
    ],
  }
}

// ───────────────────────── ciclo fiscale, guidato ─────────────────────────

const leggiFasi = (ctx) => ctx.sessione(async (s) => interpreta1511(await s.manda('15111').catch(() => s.manda('1511'))))
async function fiscalizzataDalWeb(ctx) {
  const w = ctx.web()
  if (!w) return null
  try { const st = leggiStatus(await w.leggi('/Status.htm')); return st.FISCALIZZATA === 'SI' ? true : st.FISCALIZZATA === 'NO' ? false : null } catch { return null }
}

function defCiclo(ctx) {
  const imp = () => ctx.impostazioni()
  const guida = (id, titolo, dettaglio, istruzioni, controllo, extra = {}) => ({
    id, titolo, dettaglio, tipo: 'guidato', istruzioni, controllo, ...extra,
  })
  return {
    id: 'ciclo', titolo: 'Ciclo fiscale (cassa nuova)', nota: 'GUIDATO. Ordine vincolante del manuale Custom: chiave privata, censimento, fiscalizzazione (IRREVERSIBILE), accreditamento dell\'esercente, attivazione, QR. Ogni passo si conferma rileggendo la cassa.',
    passi: [
      guida('chiave', 'Chiave privata', 'Si genera UNA SOLA VOLTA (manuale, pag. 89). Non è una procedura da avviare «per vedere».', () => ['Sulla cassa: assetto PROGRAMMAZIONE → P699 → MENU TECNICO → conferma SI → esce uno scontrino con l\'esito.', 'In alternativa dal web server della cassa. Dal programma non c\'è nessun comando.'],
        async () => { const s = await leggiFasi(ctx); return s?.chiave ? { ok: true, testo: 'chiave privata generata (1511)' } : { ok: false, testo: 'la cassa dice «chiave non generata»' } }, { tastiera: true }),
      guida('censimento', 'Censimento', 'Solo dopo la chiave privata (pag. 90). Porta il codice fiscale del tecnico: è lui che risponde della macchina davanti all\'Agenzia.',
        () => ['Sulla cassa: P699 → MENU TECNICO → CODICE FISCALE (16 caratteri) → laboratorio.', `Dal web server: pagina Censimento (utente e password = matricola). Campi: CfTecnico = ${imp().tecnico.cf} · CfLaboratorio = ${imp().laboratorio.piva} · Captcha (lo mostra la pagina).`, 'Il programma NON invia il modulo e non manda il comando: lo fai tu. L\'Agenzia risponde dopo qualche decina di secondi: premi «Rileggi».', 'Esito positivo: due scontrini, CENSIMENTO e MIGRA SETDEVICE STATUS.'],
        async () => { const s = await leggiFasi(ctx); return s?.censita ? { ok: true, testo: 'cassa censita (1511)' } : { ok: false, testo: 'la cassa dice «non censita» (se l\'Agenzia sta ancora rispondendo, riprova fra poco)' } }, { tastiera: true, pagina: '/Censimento.htm' }),
      {
        id: 'fiscalizzazione', titolo: 'Fiscalizzazione — IRREVERSIBILE', dettaglio: 'Comando 2005, quello mandato il 22/10 sulla K3 96IKN025881 (risposta «2005», DGFE inizializzata da sola). Dopo non si torna indietro. NON si manda l\'inizializzazione della memoria di dettaglio (8007): la fa già la fiscalizzazione.',
        tipo: 'scrive', conferma: 'scritta', fiscalizzazione: true, anteprima: () => ['1008', '1511', '1012', '1001', '1002N', '8008', '2005'],
        saltabile: async () => { const f = await fiscalizzataDalWeb(ctx); return f === true ? 'la cassa risulta già fiscalizzata (web server)' : null },
        async esegui(st, input) {
          const matricola = ctx.matricola()
          if (String(input.matricola || '').trim() !== matricola) throw new PassoErrore('la matricola riscritta non coincide con quella della cassa collegata: non mando niente')
          if (String(input.scritta || '').trim().toUpperCase() !== 'IRREVERSIBILE') throw new PassoErrore('manca la parola IRREVERSIBILE')
          // i controlli, in sessione, PRIMA del comando (la matricola la controlla già la sessione col 1008)
          const esito = await ctx.sessione(async (s) => {
            const fasi = interpreta1511(await s.manda('15111').catch(() => s.manda('1511')))
            if (!fasi?.chiave) throw new PassoErrore('la chiave privata non risulta generata: la fiscalizzazione viene dopo (1511)')
            if (!fasi.censita) throw new PassoErrore('la cassa non risulta censita: la fiscalizzazione viene dopo il censimento (1511)')
            if (interpreta1012(await s.manda('1012')) !== 0) throw new PassoErrore('c\'è un documento aperto sulla cassa')
            const oc = interpreta1001(await s.manda('1001'))
            const d = oc ? Math.abs(scartoMinuti(oc, oraRoma(ctx.adesso()))) : null
            if (d === null || d > 5) throw new PassoErrore(`data e ora della cassa non coincidono con quelle del Mac (scarto ${d ?? '?'} min): impostale prima nella sezione Programmazione`)
            const righe = []
            for (let i = 1; i <= 9; i++) righe.push(await s.manda('1002' + i))
            if (righe.some((r) => /CUSTOM\s*SPA|FONTEVIVO|NEWTON/i.test(r))) throw new PassoErrore('l\'intestazione è ancora quella di fabbrica (CUSTOM SPA): impostala prima nella sezione Programmazione')
            const dgfe = await s.manda('8008').catch((e) => (e instanceof ErroreCassa ? 'ERR' : Promise.reject(e)))
            st.avanza('controlli superati: mando la fiscalizzazione')
            await s.manda('2005')
            return { dgfe }
          }, { clic: true, scritta: true })
          // rilettura: la prova che è riuscita è lo stato, non il silenzio
          const f = await fiscalizzataDalWeb(ctx)
          const dopo = await ctx.sessione(async (s) => ({ c: interpreta1104(await s.manda('1104')), dgfe: await s.manda('8008').catch(() => null) }))
          if (f === false) throw new PassoErrore('la cassa ha accettato 2005 ma il web server dice ancora «non fiscalizzata»: rileggi tra poco, non rimando il comando', true)
          return `fiscalizzazione accettata${f ? ' e confermata dal web server (FISCALIZZATA: SI)' : ' (il web server non è leggibile: conferma dal display)'} · DGFE: ${dopo.dgfe ?? 'non letta'} · chiusure ${dopo.c?.chiusure ?? '?'}`
        },
        controllo: async () => { const f = await fiscalizzataDalWeb(ctx); return f === true ? { ok: true, testo: 'FISCALIZZATA: SI (web server)' } : { ok: false, testo: f === false ? 'FISCALIZZATA: NO' : 'il web server non risponde' } },
        verifica: async () => { const f = await fiscalizzataDalWeb(ctx); return f === true ? { ok: true, testo: 'FISCALIZZATA: SI (web server)' } : { ok: false, testo: f === false ? 'FISCALIZZATA: NO — non è stata fatta' : 'web server non raggiungibile: guarda il display della cassa' } },
      },
      { id: 'accredito', titolo: 'Accreditamento a Fisconline — a carico dell\'ESERCENTE', dettaglio: 'Prima dell\'attivazione l\'esercente (o il suo commercialista) deve accreditarsi al portale Fisconline per ricevere l\'autorizzazione (pag. 92).', tipo: 'manuale', istruzioni: () => ['https://telematici.agenziaentrate.gov.it — lo fa l\'esercente, non il tecnico.', 'Un\'installazione ferma qui non è un problema tecnico: è il cliente che non si è ancora accreditato.', 'Spunta «L\'ho fatto» quando l\'esercente conferma.'] },
      guida('attivazione', 'Attivazione', 'Passa la cassa a registratore telematico (pag. 93). Data 000000 = adesso.',
        () => ['Sulla cassa: P699 → MENU TECNICO → attivazione. Il 22/10 è stata fatta da tastiera.', `Dati: CF tecnico ${imp().tecnico.cf} · P.IVA laboratorio ${imp().laboratorio.piva} · P.IVA/CF dell'esercente (la stessa dell'intestazione) · messa in servizio immediata (data 000000).`, 'Dal web server: pagina Attivazione (campi CfTecnico, CfLaboratorio, CfEsercente, FlagAttivazione, Captcha). Il programma NON la invia.', 'Alla prima operazione esce «MESSA IN SERVIZIO COMPLETATA». Premi «Rileggi».'],
        async () => { const s = await leggiFasi(ctx); return s?.attivata && s?.inServizio ? { ok: true, testo: 'attivata e in servizio (1511)' } : s?.attivata ? { ok: false, testo: 'attivata ma non ancora «in servizio» (messa in servizio differita?)' } : { ok: false, testo: 'la cassa dice «non attivata»' } }, { tastiera: true, pagina: '/Attivazione.htm' }),
      { id: 'qr', titolo: 'QR code — a carico dell\'ESERCENTE', dettaglio: 'Dopo l\'attivazione l\'esercente scarica da Fisconline il QR della macchina, lo stampa e lo applica sul dispositivo (D.Lgs 175/2015, pag. 96).', tipo: 'manuale', istruzioni: () => ['Il tecnico non può scaricarlo al posto suo, ma può accorgersi che manca.', 'Spunta «L\'ho fatto» quando il QR è sulla macchina (o ricordalo al cliente).'] },
    ],
  }
}

export const DEFINIZIONI = { vp: defVP, chiusura: defChiusura, ciclo: defCiclo }

// ───────────────────────── il motore ─────────────────────────

export class Motore {
  constructor(ctx) { this.ctx = { intervalloMs: 15_000, ...ctx }; this.run = null }

  avvia(id) {
    const f = DEFINIZIONI[id]
    if (!f) throw new PassoErrore(`procedura «${id}» sconosciuta`)
    if (this.run?.inEsecuzione) throw new PassoErrore('un passo è ancora in corso: aspetta che finisca')
    const def = f(this.ctx)
    this.run = { id, def, vars: {}, stati: def.passi.map(() => ({ stato: 'da_fare', esito: '', errore: null, daVerificare: false, avanzamento: '' })), corrente: 0, inEsecuzione: false, finita: null }
    this.ctx.registro?.evento(`procedura «${def.titolo}» avviata`)
    return this.#autoAvanza()
  }

  #passo(i) { const p = this.run?.def.passi[i]; if (!p) throw new PassoErrore('passo inesistente'); return p }

  stato() {
    const r = this.run
    if (!r) return null
    return {
      id: r.id, titolo: r.def.titolo, nota: r.def.nota, corrente: r.corrente, inEsecuzione: r.inEsecuzione, finita: r.corrente >= r.def.passi.length,
      passi: r.def.passi.map((p, i) => ({
        n: i + 1, id: p.id, titolo: p.titolo, dettaglio: p.dettaglio, tipo: p.tipo, conferma: p.conferma || null, parola: p.parola || null, fiscalizzazione: !!p.fiscalizzazione,
        conCampi: p.conCampi || null, tastiera: !!p.tastiera, pagina: p.pagina || null,
        anteprima: p.anteprima ? safe(() => p.anteprima({ vars: r.vars })) : [], istruzioni: p.istruzioni ? safe(() => p.istruzioni({ vars: r.vars })) : [],
        puoVerificare: !!p.verifica, ...r.stati[i],
      })),
    }
  }

  /** Avvia il passo i (deve essere quello corrente). Non aspetta la fine: `finita` è la promessa, per i test. */
  esegui(i, input = {}) {
    const r = this.run
    if (!r) throw new PassoErrore('nessuna procedura avviata')
    if (r.inEsecuzione) throw new PassoErrore('un passo è ancora in corso')
    const p = this.#passo(i)
    if (i !== r.corrente) throw new PassoErrore(`non è il passo giusto: ora tocca al ${r.corrente + 1}`)
    if (p.tipo === 'manuale' || p.tipo === 'guidato') throw new PassoErrore('questo passo lo fai tu sulla cassa: usa «Rileggi» o «L\'ho fatto»')
    if (p.tipo === 'scrive' && input.conferma !== true) throw new PassoErrore('questo passo scrive sulla cassa: serve la conferma con il clic')
    if (p.conferma === 'scritta') {
      if (p.fiscalizzazione) {
        if (String(input.matricola || '').trim() !== this.ctx.matricola()) throw new PassoErrore('riscrivi la matricola della cassa per confermare')
        if (String(input.scritta || '').trim().toUpperCase() !== 'IRREVERSIBILE') throw new PassoErrore('scrivi la parola IRREVERSIBILE per confermare')
      } else if (String(input.scritta || '').trim().toUpperCase() !== p.parola) throw new PassoErrore(`scrivi la parola ${p.parola} per confermare`)
    }
    const s = r.stati[i]
    Object.assign(s, { stato: 'in_corso', errore: null, daVerificare: false, avanzamento: '', esito: '' })
    r.inEsecuzione = true
    const st = { vars: r.vars, avanza: (t) => { s.avanzamento = t } }
    this.ctx.registro?.evento(`passo ${i + 1} «${p.titolo}» avviato`)
    r.finita = (async () => {
      try {
        s.esito = await p.esegui(st, input) || ''
        s.stato = 'ok'; s.avanzamento = ''
        this.ctx.registro?.evento(`passo ${i + 1} riuscito: ${s.esito}`)
        r.corrente = i + 1
      } catch (e) {
        s.stato = 'errore'; s.avanzamento = ''
        s.errore = descriviErrore(e)
        s.daVerificare = !!(e.daVerificare || ((e instanceof NessunaRisposta || e instanceof ConnessioneCaduta) && e.mutante))
        this.ctx.registro?.evento(`passo ${i + 1} fermo: ${s.errore.messaggio}`)
      } finally { r.inEsecuzione = false }
      if (s.stato === 'ok') await this.#autoAvanza()
    })()
    return r.finita
  }

  /** «Rileggi»: per i passi guidati controlla lo stato; per gli altri usa `verifica` (solo letture). */
  async controlla(i) {
    const r = this.run
    if (!r) throw new PassoErrore('nessuna procedura avviata')
    if (r.inEsecuzione) throw new PassoErrore('un passo è ancora in corso')
    const p = this.#passo(i)
    const f = p.verifica || p.controllo
    if (!f) throw new PassoErrore('questo passo non ha una rilettura: usa «L\'ho fatto»')
    const s = r.stati[i]
    r.inEsecuzione = true
    try {
      const x = await f({ vars: r.vars, avanza: () => {} })
      s.esito = x.testo
      if (x.ok && i === r.corrente) { s.stato = 'ok'; s.errore = null; s.daVerificare = false; r.corrente = i + 1 }
      else if (x.ok && s.stato === 'errore') { s.stato = 'ok'; s.errore = null; s.daVerificare = false; if (i === r.corrente) r.corrente = i + 1 }
      this.ctx.registro?.evento(`rilettura del passo ${i + 1}: ${x.testo}`)
      return x
    } catch (e) {
      s.errore = descriviErrore(e); return { ok: false, testo: s.errore.messaggio }
    } finally { r.inEsecuzione = false; if (r.stati[i].stato === 'ok') await this.#autoAvanza() }
  }

  /** «L'ho fatto» (passi manuali) e «Considera fatto» (dopo una rilettura a occhio). */
  segna(i) {
    const r = this.run
    if (!r) throw new PassoErrore('nessuna procedura avviata')
    if (r.inEsecuzione) throw new PassoErrore('un passo è ancora in corso')
    const p = this.#passo(i)
    if (i !== r.corrente) throw new PassoErrore(`non è il passo giusto: ora tocca al ${r.corrente + 1}`)
    const s = r.stati[i]
    if (p.tipo === 'scrive' && s.stato !== 'errore') throw new PassoErrore('questo passo va eseguito, non spuntato')
    if (p.tipo === 'lettura') throw new PassoErrore('questo passo è una lettura: eseguilo')
    s.stato = 'ok'; s.esito = s.esito || 'segnato come fatto dal tecnico'; s.errore = null; s.daVerificare = false
    r.corrente = i + 1
    this.ctx.registro?.evento(`passo ${i + 1} «${p.titolo}» segnato come fatto dal tecnico`)
    return this.#autoAvanza()
  }

  annulla() { if (this.run?.inEsecuzione) throw new PassoErrore('un passo è ancora in corso'); this.run = null }

  // i passi guidati già a posto (o saltabili) si superano da soli, SOLO leggendo
  async #autoAvanza() {
    const r = this.run
    while (r.corrente < r.def.passi.length) {
      const p = r.def.passi[r.corrente]
      const s = r.stati[r.corrente]
      let x = null
      try {
        if (p.saltabile) { const m = await p.saltabile(); if (m) x = { ok: true, testo: m } }
        else if (p.tipo === 'guidato' && p.controllo) x = await p.controllo({ vars: r.vars })
      } catch { x = null }
      if (!x?.ok) break
      s.stato = 'ok'; s.esito = 'già a posto — ' + x.testo
      this.ctx.registro?.evento(`passo ${r.corrente + 1} «${p.titolo}» già a posto: ${x.testo}`)
      r.corrente++
    }
  }
}

function safe(f) { try { return f() } catch { return [] } }

export function descriviErrore(e) {
  if (e instanceof ErroreCassa) return { messaggio: e.message, codice: e.codice, titolo: e.spiegato.titolo, spiegazione: e.spiegato.spiegazione, manuale: e.spiegato.manuale }
  return { messaggio: e?.message || String(e), tipo: e?.tipo || e?.name }
}
