import 'package:flutter/material.dart';
import 'package:flutter_hbb/desktop/widgets/ged_strumenti_cassa.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('la voce c\'e\' solo nel Tecnico (sola uscita) su Mac', () {
    expect(gedMostraStrumentiCassa(outgoingOnly: true, macOS: true), isTrue);
    // versione cliente (sola entrata) su Mac
    expect(gedMostraStrumentiCassa(outgoingOnly: false, macOS: true), isFalse);
    // Tecnico su Windows o Linux
    expect(gedMostraStrumentiCassa(outgoingOnly: true, macOS: false), isFalse);
    expect(gedMostraStrumentiCassa(outgoingOnly: false, macOS: false), isFalse);
  });

  test('node si cerca nei posti noti prima, poi nel PATH', () {
    final c = gedCandidatiNode('/usr/bin::/Users/x/.volta/bin');
    expect(c.first, '/opt/homebrew/bin/node');
    expect(c[1], '/usr/local/bin/node');
    expect(c, contains('/Users/x/.volta/bin/node'));
    expect(c, isNot(contains('/node')));
    expect(gedPrimoNode(c, (p) => p == '/usr/bin/node'), '/usr/bin/node');
    expect(gedPrimoNode(c, (p) => false), isNull);
    expect(gedCandidatiNode(null).length, 2);
  });

  testWidgets('la voce mostra «Strumenti cassa»', (t) async {
    await t.pumpWidget(
        const MaterialApp(home: Scaffold(body: GedStrumentiCassaVoce())));
    expect(find.text('Strumenti cassa'), findsOneWidget);
  });
}
