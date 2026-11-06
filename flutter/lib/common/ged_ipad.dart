// GED Assistance Tecnico per iPad e iPhone: funzioni PURE che decidono cosa mostrare e come disporlo.
// Stanno qui, senza dipendere da Flutter ne' dal bridge, perche' siano provabili da un test senza un telefono.

// Soglia Apple/Material fra telefono e tablet: lato corto >= 600 pt. Vale in verticale e in orizzontale,
// perche' si guarda il lato CORTO (un iPhone in orizzontale resta un telefono, un iPad in verticale no).
const double kGedSogliaTablet = 600;

// Misura minima di un bersaglio al tocco (Human Interface Guidelines Apple).
const double kGedTastoMinimo = 44;

// Il Tecnico e' SOLA USCITA: su iOS non si lascia controllare, quindi tutto cio' che serve a «essere controllato»
// (pagina Condividi, ID e password locali, permessi di cattura) non va mostrato. La versione cliente e gli altri
// sistemi restano com'erano.
bool gedNascondiLatoControllato(
        {required bool outgoingOnly, required bool isIOS}) =>
    outgoingOnly && isIOS;

// ID locale e password: servono solo a chi viene controllato.
bool gedMostraIdLocale({required bool outgoingOnly, required bool isIOS}) =>
    !gedNascondiLatoControllato(outgoingOnly: outgoingOnly, isIOS: isIOS);

// Link al sito e all'informativa di RustDesk: nel Tecnico su iOS non devono comparire (e' un prodotto di GED Service,
// e non abbiamo ancora un indirizzo sicuro per la sua informativa privacy: finche' non c'e', la voce si nasconde).
bool gedMostraLinkRustDesk({required bool outgoingOnly, required bool isIOS}) =>
    !gedNascondiLatoControllato(outgoingOnly: outgoingOnly, isIOS: isIOS);

// Scheda «Condividi» (server_page): oggi esiste solo su Android, ma la regola e' scritta qui per non dipendere
// da un'altra condizione sparsa nel codice.
bool gedMostraSchedaCondividi(
        {required bool outgoingOnly,
        required bool isIOS,
        required bool isAndroid}) =>
    isAndroid &&
    !gedNascondiLatoControllato(outgoingOnly: outgoingOnly, isIOS: isIOS);

// Strumenti cassa sul mobile: arriveranno nella fase C. Finche' non ci sono, la voce NON si mostra
// (la funzione per il Mac e' gedMostraStrumentiCassa).
bool gedMostraStrumentiCassaMobile(
        {required bool outgoingOnly, required bool isIOS}) =>
    false;

// Layout a due colonne (elenco a sinistra, dettaglio a destra) solo sul Tecnico su iOS con schermo largo.
bool gedLayoutDueColonne({
  required bool outgoingOnly,
  required bool isIOS,
  required double latoCorto,
}) =>
    outgoingOnly && isIOS && latoCorto >= kGedSogliaTablet;

// Altezza del campo ID: piu' grande sul tablet.
double gedAltezzaCampoId(bool dueColonne) => dueColonne ? 104 : 84;
double gedFontCampoId(bool dueColonne) => dueColonne ? 38 : 30;

// Nessun tasto sotto i 44 pt.
double gedAltezzaTasto(double richiesta) =>
    richiesta < kGedTastoMinimo ? kGedTastoMinimo : richiesta;
