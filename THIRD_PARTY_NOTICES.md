# Third-party notices

This distribution includes the local network engine and configuration assets from [Flowseal/zapret-discord-youtube](https://github.com/Flowseal/zapret-discord-youtube), licensed under MIT.

Copyright (c) 2016–2026 bol-van
Copyright (c) 2024–2026 Flowseal

The included `WinDivert.dll` and `WinDivert64.sys` components are distributed under the WinDivert license, at the user's choice LGPLv3 or GPLv2. Sources and license terms: https://github.com/basil00/WinDivert.

The complete upstream MIT notice is included in `engine/LICENSE.txt` in the packaged build.

Versioned DPI profiles in `src/config/flowseal-1.10.4.json` are adapted from Flowseal 1.10.4 (strategy snapshot also matches commit `2401b7a13837139b0265632464ba563dddbf80d8`). They retain selected-service scope; broad IPSet/GameFilter and the original ALT5 are not imported. Reference BAT files and the upstream MIT notice are in `test/fixtures/flowseal-1.10.4/` and are never executed by Local Route.

# sing-box

Local Route bundles `sing-box` 1.14.2 for selective VLESS routing on Windows.
It is obtained from the official SagerNet release and distributed under its included license:
`engine/sing-box/sing-box-1.14.2-windows-amd64/LICENSE`.

# TGWs Proxy

The console-only Telegram component is built from Flowseal/tg-ws-proxy 1.11.2,
commit `307a384ab7f522e34bb1a045884d0bd90f40bee5`, under MIT.
Source: https://github.com/Flowseal/tg-ws-proxy/tree/307a384ab7f522e34bb1a045884d0bd90f40bee5
The upstream notice is bundled at `engine/tg-ws/LICENSE`.
Python and Python dependencies retain their notices in the bundled `_internal` directory.
