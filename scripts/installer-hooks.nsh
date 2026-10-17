!ifdef BUILD_UNINSTALLER
!include "StrFunc.nsh"
${UnStrStr}
!macro customUnInstall
  ; Never remove a task belonging to a separate portable installation.
  nsExec::ExecToStack '"$SYSDIR\schtasks.exe" /Query /TN "Local Route AutoStart" /XML'
  Pop $0
  Pop $1
  ${If} $0 == 0
    ${UnStrStr} $2 $1 "$INSTDIR\Local Route.exe"
    ${If} $2 != ""
      nsExec::ExecToStack '"$SYSDIR\schtasks.exe" /Delete /TN "Local Route AutoStart" /F'
      Pop $0
      Pop $1
    ${EndIf}
  ${EndIf}
!macroend
!endif
