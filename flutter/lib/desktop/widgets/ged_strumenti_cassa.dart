import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';

// GED Assistance Tecnico per Mac: la voce «Strumenti cassa» avvia il programma locale (Node, cartella
// strumenti-cassa nelle Resources del pacchetto) e apre il browser sul suo indirizzo.

const String kGedNodeMancante =
    'Per gli Strumenti cassa serve Node.js: installalo da nodejs.org';

// Solo nel Tecnico (sola uscita) e solo su Mac: la versione cliente non la vede mai.
bool gedMostraStrumentiCassa(
        {required bool outgoingOnly, required bool macOS}) =>
    outgoingOnly && macOS;

// Un'app lanciata dal Finder non ha il PATH del terminale: si guardano prima i posti noti, poi il PATH.
List<String> gedCandidatiNode(String? path) => [
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
      if (path != null)
        for (final d in path.split(':'))
          if (d.isNotEmpty) '$d/node',
    ];

String? gedPrimoNode(Iterable<String> candidati, bool Function(String) esiste) {
  for (final c in candidati) {
    if (esiste(c)) return c;
  }
  return null;
}

class GedStrumentiCassaErrore implements Exception {
  final String messaggio;
  GedStrumentiCassaErrore(this.messaggio);
  @override
  String toString() => messaggio;
}

class GedStrumentiCassa {
  static Process? _processo;
  static String? _indirizzo;

  static String _cartellaNelPacchetto() {
    // .../GED Assistance Tecnico.app/Contents/MacOS/<eseguibile> -> .../Contents/Resources/strumenti-cassa
    final contents = File(Platform.resolvedExecutable).parent.parent.path;
    return '$contents/Resources/strumenti-cassa';
  }

  static Future<String?> _trovaNode() async {
    final dalPosto = gedPrimoNode(
        gedCandidatiNode(Platform.environment['PATH']),
        (p) => File(p).existsSync());
    if (dalPosto != null) return dalPosto;
    // nvm, volta, asdf: stanno nel PATH della shell dell'utente, non in quello dell'app.
    try {
      final r = await Process.run('/bin/zsh', ['-lc', 'command -v node'])
          .timeout(const Duration(seconds: 5));
      final p = (r.stdout as String).trim().split('\n').last.trim();
      if (r.exitCode == 0 && p.isNotEmpty && File(p).existsSync()) return p;
    } catch (_) {}
    return null;
  }

  static Future<void> apri() async {
    final vivo = _processo != null && _indirizzo != null;
    if (vivo) {
      await Process.run('open', [_indirizzo!]);
      return;
    }
    final server = '${_cartellaNelPacchetto()}/server.mjs';
    if (!File(server).existsSync()) {
      throw GedStrumentiCassaErrore(
          'Gli Strumenti cassa non sono dentro questa copia dell\'app ($server).');
    }
    final node = await _trovaNode();
    if (node == null) throw GedStrumentiCassaErrore(kGedNodeMancante);

    final p = await Process.start(node, [server, '--no-apri', '--con-padre']);
    final trovato = Completer<String>();
    final uscita = StringBuffer();
    p.stdout.transform(utf8.decoder).listen((d) {
      uscita.write(d);
      final m =
          RegExp(r'http://127\.0\.0\.1:\d+/\S+').firstMatch(uscita.toString());
      if (m != null && !trovato.isCompleted) trovato.complete(m.group(0)!);
    });
    final errori = StringBuffer();
    p.stderr.transform(utf8.decoder).listen(errori.write);
    unawaited(p.exitCode.then((c) {
      if (identical(_processo, p)) {
        _processo = null;
        _indirizzo = null;
      }
      if (!trovato.isCompleted) {
        trovato.completeError(GedStrumentiCassaErrore(
            'Il programma degli Strumenti cassa si è fermato (codice $c). ${errori.toString().trim()}'));
      }
    }));
    try {
      final indirizzo = await trovato.future.timeout(const Duration(seconds: 15));
      _processo = p;
      _indirizzo = indirizzo;
      await Process.run('open', [indirizzo]);
    } on TimeoutException {
      p.kill();
      throw GedStrumentiCassaErrore(
          'Il programma degli Strumenti cassa non ha risposto entro 15 secondi.');
    }
  }
}

class GedStrumentiCassaVoce extends StatelessWidget {
  const GedStrumentiCassaVoce({super.key});

  Future<void> _premuto(BuildContext context) async {
    String? errore;
    try {
      await GedStrumentiCassa.apri();
    } on GedStrumentiCassaErrore catch (e) {
      errore = e.messaggio;
    } catch (e) {
      errore = 'Non riesco ad avviare gli Strumenti cassa: $e';
    }
    if (errore == null || !context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Strumenti cassa'),
        content: Text(errore!),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(c).pop(), child: const Text('OK'))
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 20.0, right: 16, top: 4, bottom: 8),
      child: Align(
        alignment: Alignment.centerLeft,
        child: OutlinedButton.icon(
          onPressed: () => _premuto(context),
          icon: const Icon(Icons.point_of_sale, size: 18),
          label: const Text('Strumenti cassa'),
        ),
      ),
    );
  }
}
