# Strumenti cassa — GED Assistance Tecnico

Programma locale per il Mac del tecnico che comanda le casse fiscali **Custom K3F-N** in rete. Node puro, zero dipendenze.

    node strumenti-cassa/server.mjs              # apre il browser su 127.0.0.1:<porta>/<codice segreto>/
    node strumenti-cassa/server.mjs --simulatore # cassa FINTA, per provare l'interfaccia
    node --test strumenti-cassa/test/*.test.mjs  # prove contro il simulatore K3

Lanciatore: `~/Desktop/Strumenti cassa.command`. Registro per cassa: `~/Library/Application Support/GED Assistance/strumenti-cassa/<matricola>.log`.

## Regole (non negoziabili, tutte nei test)
- Tutto passa da `lib/listabianca.mjs`: in sola lettura solo richieste dati; ogni scrittura vuole un clic; fiscalizzazione e chiusura anche la conferma scritta.
- Mai 3006, mai 7101 OPER 0, mai reset/HW-INIT/firmware, mai 8007, mai 6401 (chiave, censimento, attivazione restano guidati).
- Un comando senza risposta non si rimanda: si rilegge lo stato. Ci si ferma al primo ERR.
- Solo indirizzi privati. Web server della cassa: solo GET (e i tasti della tastiera remota, da lista chiusa).

## Cosa c'è
Collega · profili (Diretto / Flatpay / Mooney in `dati/profili.json`) · stato con spie · programmazione (intestazione, aliquote, data e ora; 019/910/911/520 con tastiera remota e spunte) · procedure (verificazione periodica, chiusura forzata, ciclo fiscale guidato) · check-list UFFICIALE Mod. 10.1 + 10.2/10.3 (il PDF depositato compilato, identico a quello del CRM; firma col dito; appunto per il GST che dice di NON essere il modulo).
Ultimo firmware per modello: `dati/ultimi-firmware.json`.

## Prossimo passo (non fatto)
Firma del cliente a distanza, scrittura nel CRM, collegamento al CRM per profili e firmware.

## Il modulo ufficiale (decisione di Danilo, 27/10/2026)
«La check-list si deve usare per forza quella ufficiale: le due pagine depositate, approvate e depositate AE.» Il PDF si genera da
`lib/pdf/` (porta in Node di `ModuloUfficiale.php`, `ScrittorePdf.php`, `LettorePdf.php` del CRM) sui PDF originali in
`dati/modulistica/`, di cui si controlla l'impronta sha256 (`IMPRONTE.json`): un file diverso viene rifiutato. Le regole (10.2 o 10.3 dalla
riga 1.3, esito mai proposto se c'è un NO, campi obbligatori) sono in `lib/verifica.mjs`. Differenza dal CRM, voluta: le firme non sono
obbligatorie (senza immagine il riquadro resta vuoto, da firmare a penna).

**Prova di identità col CRM:** `test/fixtures/crm/golden/*.pdf` li ha generati il codice PHP vero del CRM con gli stessi dati degli scenari
(`test/fixtures/crm/scenari/`); `test/confronto-crm.test.mjs` li rigenera in Node e confronta byte per byte. Per rigenerare i golden
(solo se cambia il CRM): `php test/confronto-crm/genera-crm.php <crm-core> test/fixtures/crm/scenari test/fixtures/crm/golden test/fixtures/crm/firme`.

## La firma del tecnico (per ora caricata a mano; la fonte definitiva sarà il CRM)
La firma del tecnico sul modulo è quella che il tecnico ha già nel CRM (`technicians.signature_path`). Oggi l'API di sola lettura del CRM
esclude apposta le immagini delle firme, quindi **per ora** si carica UNA volta, come PNG, in «Impostazioni del tecnico → Firma del tecnico
(dal CRM)»: si salva nell'archivio con permessi 600, legata al codice fiscale del tecnico (`firma-tecnico-<CF>.png`; se il CF cambia, la firma
non vale più). Il modulo la usa sempre, nello stesso punto e alla stessa scala del CRM. **La fonte definitiva sarà un endpoint nuovo del CRM**
(da fare nel progetto CRM): allora questo caricamento sparisce. Il riquadro col dito resta solo per il cliente.

I file PNG di prova (`test/fixtures/crm/firme/`) vanno aggiunti con `git add -f`: il `.gitignore` del repository scarta `*png`, e senza di loro il
PDF generato ha meno oggetti e il confronto con il CRM non torna.
