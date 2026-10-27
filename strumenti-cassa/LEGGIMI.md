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
Collega · profili (Diretto / Flatpay / Mooney in `dati/profili.json`) · stato con spie · programmazione (intestazione, aliquote, data e ora; 019/910/911/520 con tastiera remota e spunte) · procedure (verificazione periodica, chiusura forzata, ciclo fiscale guidato) · check-list Mod. 10.1+10.2 (pagina stampabile e testo per il GST).
Ultimo firmware per modello: `dati/ultimi-firmware.json`.

## Prossimo passo (non fatto)
Firma del cliente a distanza, scrittura nel CRM, collegamento al CRM per profili e firmware.
