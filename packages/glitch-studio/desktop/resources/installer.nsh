; media-file-types.cjs と一致させる。両者の差分はテストで検出する。
; インストール・アンインストールで同じ拡張子一覧を使い、他のアプリの登録は残す。
!macro forEachMediaExtension ACTION
  !insertmacro ${ACTION} "png"
  !insertmacro ${ACTION} "jpg"
  !insertmacro ${ACTION} "jpeg"
  !insertmacro ${ACTION} "gif"
  !insertmacro ${ACTION} "webp"
  !insertmacro ${ACTION} "avif"
  !insertmacro ${ACTION} "bmp"
  !insertmacro ${ACTION} "mp4"
  !insertmacro ${ACTION} "m4v"
  !insertmacro ${ACTION} "mov"
  !insertmacro ${ACTION} "webm"
  !insertmacro ${ACTION} "mkv"
!macroend

!macro registerMediaExtension EXT
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "GlitchStudio.Media"
!macroend

!macro unregisterMediaExtension EXT
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "GlitchStudio.Media"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.${EXT}"
!macroend

!macro customInstall
  ; SHELL_CONTEXTはelectron-builderが選んだインストール先のスコープに従う。
  ; 拡張子の既定値・UserChoiceには書き込まず、「プログラムから開く」の候補だけを追加する。
  WriteRegStr SHELL_CONTEXT "Software\Classes\GlitchStudio.Media" "" "Glitch Studio media"
  WriteRegStr SHELL_CONTEXT "Software\Classes\GlitchStudio.Media" "FriendlyTypeName" "Glitch Studio media"
  WriteRegStr SHELL_CONTEXT "Software\Classes\GlitchStudio.Media\Application" "ApplicationName" "Glitch Studio"
  WriteRegStr SHELL_CONTEXT "Software\Classes\GlitchStudio.Media\DefaultIcon" "" '$\"$appExe$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\GlitchStudio.Media\shell\open\command" "" '$\"$appExe$\" $\"%1$\"'
  !insertmacro forEachMediaExtension registerMediaExtension
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro forEachMediaExtension unregisterMediaExtension
  DeleteRegKey SHELL_CONTEXT "Software\Classes\GlitchStudio.Media"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
