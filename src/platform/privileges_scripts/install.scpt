on run {daemon_file, agent_file, user}

  -- GED Assistance: il nome dell'app ha uno spazio («GED Assistance»), quindi ogni percorso va fra virgolette
  -- (quoted form). Le etichette e i plist usano il nome completo senza spazi (com.carriez.GED-Assistance, come la
  -- cartella delle preferenze che crea directories-next): correct_app_name() li sostituisce prima del resto.
  set daemon_plist to quoted form of "/Library/LaunchDaemons/com.carriez.RustDesk_service.plist"
  set agent_plist to quoted form of "/Library/LaunchAgents/com.carriez.RustDesk_server.plist"
  set prefs_dir to "/Users/" & user & "/Library/Preferences/com.carriez.RustDesk/"
  set prefs_toml to quoted form of (prefs_dir & "RustDesk.toml")
  set prefs2_toml to quoted form of (prefs_dir & "RustDesk2.toml")
  set root_prefs to quoted form of "/var/root/Library/Preferences/com.carriez.RustDesk/"

  set sh1 to "echo " & quoted form of daemon_file & " > " & daemon_plist & " && chown root:wheel " & daemon_plist & ";"

  set sh2 to "echo " & quoted form of agent_file & " > " & agent_plist & " && chown root:wheel " & agent_plist & ";"

  set sh3 to "mkdir -p " & root_prefs & "; cp -rf " & prefs_toml & " " & root_prefs & ";"

  set sh4 to "cp -rf " & prefs2_toml & " " & root_prefs & ";"

  set sh5 to "launchctl bootout system/com.carriez.RustDesk_service 2>/dev/null || launchctl unload -w " & daemon_plist & " 2>/dev/null || true; launchctl bootstrap system " & daemon_plist & " 2>/dev/null || launchctl load -w " & daemon_plist & ";"

  set sh to sh1 & sh2 & sh3 & sh4 & sh5

  do shell script sh with prompt "RustDesk deve installare il servizio per l'assistenza remota." with administrator privileges
end run
