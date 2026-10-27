import 'dart:async';
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

// Perché un job di launchd e non un figlio dell'app: la privacy «Rete locale» di macOS si attribuisce al processo
// «responsabile». Per un figlio dell'app è l'app, che non ha mai chiesto il permesso (è il figlio a connettersi):
// ogni connessione alla cassa falliva con EHOSTUNREACH. Un job di launchd è responsabile di sé stesso: vale il
// permesso «node» che l'utente accende una volta sola.
const String kGedEtichettaJob = 'it.gedservice.strumenticassa';
const int kGedInattivoMinuti = 30;

// Il file dove il programma scrive il proprio indirizzo (con il codice segreto, permessi 600).
String gedFileIndirizzo(String home) =>
    '$home/Library/Application Support/GED Assistance/strumenti-cassa/indirizzo.txt';

String gedFileLog(String home) =>
    '$home/Library/Application Support/GED Assistance/strumenti-cassa/programma.log';

// Il contenuto del file è un indirizzo valido? Altrimenti null (file vuoto, a metà o estraneo).
String? gedIndirizzoDaFile(String? contenuto) {
  if (contenuto == null) return null;
  final t = contenuto.trim();
  return RegExp(r'^http://127\.0\.0\.1:\d+/[0-9a-f]+/$').hasMatch(t) ? t : null;
}

// Gli argomenti di `launchctl submit`. Il programma non ha più un padre che lo chiude: esce da solo dopo N minuti
// senza richieste e toglie il proprio job (--rimuovi-job), perché un job «submit» altrimenti verrebbe rilanciato.
List<String> gedArgomentiSubmit({
  required String node,
  required String server,
  required String fileIndirizzo,
  required String fileLog,
  String etichetta = kGedEtichettaJob,
  int inattivoMinuti = kGedInattivoMinuti,
}) =>
    [
      'submit',
      '-l', etichetta,
      '-o', fileLog,
      '-e', fileLog,
      '--',
      node,
      server,
      '--no-apri',
      '--indirizzo-su-file', fileIndirizzo,
      '--inattivo-minuti', '$inattivoMinuti',
      '--rimuovi-job', etichetta,
    ];

enum GedMossa { riapri, avvia }

// La decisione del clic: se il file ha un indirizzo e il programma risponde, si riapre; in ogni altro caso
// (nessun file, file sporco, programma morto lasciando il file) si riparte da zero.
GedMossa gedDecidiMossa({required String? indirizzoDaFile, required bool risponde}) =>
    indirizzoDaFile != null && risponde ? GedMossa.riapri : GedMossa.avvia;

class GedStrumentiCassa {
  static String _home() => Platform.environment['HOME'] ?? '';

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

  static String? _leggiFile(String percorso) {
    try {
      return File(percorso).readAsStringSync();
    } catch (_) {
      return null;
    }
  }

  // Il programma risponde? Basta una GET all'indirizzo: la pagina iniziale è 200 se il codice è quello giusto.
  static Future<bool> _risponde(String indirizzo) async {
    final c = HttpClient()..connectionTimeout = const Duration(seconds: 2);
    try {
      final req = await c.getUrl(Uri.parse(indirizzo));
      final res = await req.close().timeout(const Duration(seconds: 3));
      await res.drain<void>();
      return res.statusCode == 200;
    } catch (_) {
      return false;
    } finally {
      c.close(force: true);
    }
  }

  static Future<void> apri() async {
    final fileInd = gedFileIndirizzo(_home());
    final dalFile = gedIndirizzoDaFile(_leggiFile(fileInd));
    final mossa = gedDecidiMossa(
        indirizzoDaFile: dalFile,
        risponde: dalFile != null && await _risponde(dalFile));
    if (mossa == GedMossa.riapri) {
      await Process.run('open', [dalFile!]);
      return;
    }

    final server = '${_cartellaNelPacchetto()}/server.mjs';
    if (!File(server).existsSync()) {
      throw GedStrumentiCassaErrore(
          'Gli Strumenti cassa non sono dentro questa copia dell\'app ($server).');
    }
    final node = await _trovaNode();
    if (node == null) throw GedStrumentiCassaErrore(kGedNodeMancante);

    // Pulizia di un eventuale job vecchio o morto lasciato a metà, e del suo file.
    await Process.run('/bin/launchctl', ['remove', kGedEtichettaJob]);
    try {
      File(fileInd).deleteSync();
    } catch (_) {}
    try {
      Directory(File(fileInd).parent.path).createSync(recursive: true);
    } catch (_) {}

    final r = await Process.run(
        '/bin/launchctl',
        gedArgomentiSubmit(
            node: node,
            server: server,
            fileIndirizzo: fileInd,
            fileLog: gedFileLog(_home())));
    if (r.exitCode != 0) {
      throw GedStrumentiCassaErrore(
          'Non riesco ad avviare gli Strumenti cassa (launchctl ${r.exitCode}). ${r.stderr.toString().trim()}');
    }

    final fine = DateTime.now().add(const Duration(seconds: 15));
    while (DateTime.now().isBefore(fine)) {
      await Future<void>.delayed(const Duration(milliseconds: 250));
      final ind = gedIndirizzoDaFile(_leggiFile(fileInd));
      if (ind != null) {
        await Process.run('open', [ind]);
        return;
      }
    }
    await Process.run('/bin/launchctl', ['remove', kGedEtichettaJob]);
    throw GedStrumentiCassaErrore(
        'Il programma degli Strumenti cassa non ha risposto entro 15 secondi. Dettagli in ${gedFileLog(_home())}');
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
