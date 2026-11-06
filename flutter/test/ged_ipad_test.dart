import 'package:flutter_hbb/common/ged_ipad.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('i link a RustDesk spariscono solo nel Tecnico su iOS', () {
    expect(gedMostraLinkRustDesk(outgoingOnly: true, isIOS: true), isFalse);
    expect(gedMostraLinkRustDesk(outgoingOnly: false, isIOS: true), isTrue);
    expect(gedMostraLinkRustDesk(outgoingOnly: true, isIOS: false), isTrue);
  });

  test('il lato «controllato» sparisce solo nel Tecnico su iOS', () {
    expect(gedNascondiLatoControllato(outgoingOnly: true, isIOS: true), isTrue);
    // versione cliente su iOS, Tecnico su altri sistemi: come prima
    expect(gedNascondiLatoControllato(outgoingOnly: false, isIOS: true), isFalse);
    expect(gedNascondiLatoControllato(outgoingOnly: true, isIOS: false), isFalse);
    expect(gedMostraIdLocale(outgoingOnly: true, isIOS: true), isFalse);
    expect(gedMostraIdLocale(outgoingOnly: false, isIOS: true), isTrue);
    expect(gedMostraIdLocale(outgoingOnly: true, isIOS: false), isTrue);
  });

  test('la scheda Condividi non c\'e\' sul Tecnico iOS e non c\'e\' mai su iOS', () {
    expect(
        gedMostraSchedaCondividi(
            outgoingOnly: true, isIOS: true, isAndroid: false),
        isFalse);
    expect(
        gedMostraSchedaCondividi(
            outgoingOnly: false, isIOS: false, isAndroid: true),
        isTrue);
    expect(
        gedMostraSchedaCondividi(
            outgoingOnly: false, isIOS: true, isAndroid: false),
        isFalse);
  });

  test('due colonne dal lato corto 600 in su, in verticale e in orizzontale', () {
    bool d(double w) =>
        gedLayoutDueColonne(outgoingOnly: true, isIOS: true, latoCorto: w);
    expect(d(599.9), isFalse);
    expect(d(600), isTrue);
    expect(d(768), isTrue); // iPad verticale: lato corto 768
    expect(d(390), isFalse); // iPhone verticale
    expect(d(430), isFalse); // iPhone Pro Max: il lato corto resta < 600
    // il tablet non Tecnico o non iOS non cambia
    expect(gedLayoutDueColonne(outgoingOnly: false, isIOS: true, latoCorto: 800),
        isFalse);
    expect(gedLayoutDueColonne(outgoingOnly: true, isIOS: false, latoCorto: 800),
        isFalse);
  });

  test('tasti mai sotto 44 pt, campo ID piu\' grande sul tablet', () {
    expect(gedAltezzaTasto(30), 44);
    expect(gedAltezzaTasto(60), 60);
    expect(gedAltezzaCampoId(true), greaterThan(gedAltezzaCampoId(false)));
    expect(gedFontCampoId(true), greaterThan(gedFontCampoId(false)));
  });

  test('Strumenti cassa sul mobile non si mostrano ancora (fase C)', () {
    expect(gedMostraStrumentiCassaMobile(outgoingOnly: true, isIOS: true),
        isFalse);
  });
}
