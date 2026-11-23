; Kedaya Windows installer (Inno Setup 6)
;
; This file is compiled by .github/workflows/mobile-build.yml:
;   ISCC.exe /DAppVersion=0.1.0 /DSourceDir=...\Release /DOutputDir=...\artifacts ^
;            /DIconFile=...\windows\runner\resources\app_icon.ico kedaya.iss
;
; It intentionally contains ASCII-only strings: Inno Setup's handling of
; UTF-8 .iss files without a BOM varies by version, and a failed compile here
; would break the Windows job. Chinese display names can be added later once
; the installer is actually tested with a BOM/Unicode code page.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#ifndef SourceDir
  #error SourceDir must be defined (path to the Flutter Release folder)
#endif

#ifndef OutputDir
  #define OutputDir "."
#endif

#ifndef IconFile
  #define IconFile ""
#endif

[Setup]
AppId={{3F1C7B2E-9D4A-4E6B-8C1F-2A5D7E9B0C34}
AppName=Kedaya
AppVersion={#AppVersion}
AppVerName=Kedaya {#AppVersion}
AppPublisher=Kedaya
AppPublisherURL=https://github.com/tzhazuma/kedaya
DefaultDirName={autopf}\Kedaya
DefaultGroupName=Kedaya
DisableProgramGroupPage=yes
; Per-user install: no administrator prompt, works on locked-down student PCs.
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=kedaya-{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64
UninstallDisplayIcon={app}\kedaya.exe
#if FileExists(IconFile)
SetupIconFile={#IconFile}
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Kedaya"; Filename: "{app}\kedaya.exe"
Name: "{autodesktop}\Kedaya"; Filename: "{app}\kedaya.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\kedaya.exe"; Description: "{cm:LaunchProgram,Kedaya}"; Flags: nowait postinstall skipifsilent
