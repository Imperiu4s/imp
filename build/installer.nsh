; Extra NSIS steps for the Imp installer.
; Registers Imp as a web browser so it shows up in Windows "Default apps"
; and can be chosen for http/https links and .html files.

!macro customInstall
  StrCpy $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

  ; ProgIDs
  WriteRegStr SHCTX "Software\Classes\ImpURL" "" "Imp URL"
  WriteRegStr SHCTX "Software\Classes\ImpURL" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\ImpURL\DefaultIcon" "" "$0,0"
  WriteRegStr SHCTX "Software\Classes\ImpURL\shell\open\command" "" '"$0" "%1"'
  WriteRegStr SHCTX "Software\Classes\ImpHTML" "" "Imp HTML Document"
  WriteRegStr SHCTX "Software\Classes\ImpHTML\DefaultIcon" "" "$0,0"
  WriteRegStr SHCTX "Software\Classes\ImpHTML\shell\open\command" "" '"$0" "%1"'

  ; Browser registration (StartMenuInternet + Capabilities)
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Imp" "" "Imp"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Imp\DefaultIcon" "" "$0,0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Imp\shell\open\command" "" '"$0"'
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Imp\Capabilities" "ApplicationName" "Imp"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Imp\Capabilities" "ApplicationIcon" "$0,0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Imp\Capabilities" "ApplicationDescription" "Fast, private, lightweight web browser"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Imp\Capabilities\StartMenu" "StartMenuInternet" "Imp"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Imp\Capabilities\URLAssociations" "http" "ImpURL"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Imp\Capabilities\URLAssociations" "https" "ImpURL"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Imp\Capabilities\FileAssociations" ".htm" "ImpHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Imp\Capabilities\FileAssociations" ".html" "ImpHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Imp\Capabilities\FileAssociations" ".xhtml" "ImpHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Imp\Capabilities\FileAssociations" ".pdf" "ImpHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Imp\Capabilities\FileAssociations" ".svg" "ImpHTML"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Imp" "Software\Clients\StartMenuInternet\Imp\Capabilities"

  ; Let Explorer know associations changed
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\Imp"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Imp"
  DeleteRegKey SHCTX "Software\Classes\ImpURL"
  DeleteRegKey SHCTX "Software\Classes\ImpHTML"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
