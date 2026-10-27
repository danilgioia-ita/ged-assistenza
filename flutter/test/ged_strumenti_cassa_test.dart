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

  test('l\'indirizzo letto dal file vale solo se e\' completo', () {
    expect(gedIndirizzoDaFile('http://127.0.0.1:5123/ab12cd/\n'),
        'http://127.0.0.1:5123/ab12cd/');
    expect(gedIndirizzoDaFile(null), isNull);
    expect(gedIndirizzoDaFile(''), isNull);
    expect(gedIndirizzoDaFile('http://127.0.0.1:5123/ab12'), isNull); // senza barra finale: scritto a meta'
    expect(gedIndirizzoDaFile('http://evil.example:80/ab12cd/'), isNull);
  });

  test('il clic riapre solo se il file c\'e\' E il programma risponde', () {
    const ind = 'http://127.0.0.1:5123/ab12cd/';
    expect(gedDecidiMossa(indirizzoDaFile: ind, risponde: true), GedMossa.riapri);
    // file rimasto dopo un programma morto: si riparte
    expect(gedDecidiMossa(indirizzoDaFile: ind, risponde: false), GedMossa.avvia);
    expect(gedDecidiMossa(indirizzoDaFile: null, risponde: true), GedMossa.avvia);
  });

  test('launchctl submit: etichetta, log, node diretto (mai una shell in mezzo) e uscita per inattivita\'', () {
    final a = gedArgomentiSubmit(
        node: '/opt/homebrew/bin/node',
        server: '/App/server.mjs',
        fileIndirizzo: '/h/ind.txt',
        fileLog: '/h/p.log');
    expect(a.first, 'submit');
    expect(a[a.indexOf('-l') + 1], kGedEtichettaJob);
    final dopo = a.sublist(a.indexOf('--') + 1);
    // il processo del job DEVE essere node: e' lui il responsabile della rete locale
    expect(dopo.first, '/opt/homebrew/bin/node');
    expect(dopo[1], '/App/server.mjs');
    expect(dopo, isNot(contains('--con-padre')));
    expect(dopo[dopo.indexOf('--indirizzo-su-file') + 1], '/h/ind.txt');
    expect(dopo[dopo.indexOf('--inattivo-minuti') + 1], '$kGedInattivoMinuti');
    expect(dopo[dopo.indexOf('--rimuovi-job') + 1], kGedEtichettaJob);
    expect(gedFileIndirizzo('/Users/x'),
        '/Users/x/Library/Application Support/GED Assistance/strumenti-cassa/indirizzo.txt');
  });

  testWidgets('la voce mostra «Strumenti cassa»', (t) async {
    await t.pumpWidget(
        const MaterialApp(home: Scaffold(body: GedStrumentiCassaVoce())));
    expect(find.text('Strumenti cassa'), findsOneWidget);
  });
}
