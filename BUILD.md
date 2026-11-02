# Сборка Windows x64

1. Node.js 24, pnpm 11.25.0; `pnpm install --frozen-lockfile`.
2. Если бинарный runtime отсутствует: `node node_modules/electron/install.js`.
3. Поместить проверенные engine-компоненты в `engine/`: bin, sing-box/sing-box-1.14.2-windows-amd64 и tg-ws, включая LICENSE.txt. Эти бинарники не скачиваются произвольно во время сборки.
4. `node scripts/engine-integrity.js` печатает фактический manifest. Сборка сравнивает его с `src/config/engine-lock.json` и останавливается при расхождении. Обновлять эталон только после отдельной проверки источника, версии и лицензий. Текущий эталон фиксирует локальный набор; это не удостоверение подлинности upstream.
5. `node scripts/build-process-host.js` компилирует исходник `native/ProcessHost.cs` системным x64 .NET Framework C# compiler. `pnpm test`, затем `node scripts/runtime-smoke.js`. Smoke использует временный профиль, не включает сетевые компоненты, не читает пользовательские VPN-секреты и проверяет завершение собственного тестового процесса при выходе Electron.
6. `pnpm build:stage` создаёт новый чистый `outputs/Local Route <version>` из закреплённого Electron и allowlist исходников. Старые сборки не копируются, существующий каталог не перезаписывается.
7. `pnpm build:installer` создаёт NSIS в `outputs/installer-<version>` без публикации.

Не включаются: recovery-скрипты, пользовательские настройки, журналы, тесты, dev node_modules и tg-build. Копии ядер повторно сверяются по manifest. build-info.json содержит версии и manifest, не пользовательские данные.

Начиная с 0.28 в staging включается собственный `native/LocalRoute.ProcessHost.exe`; его SHA-256 записывается в build-info и проверяется перед упаковкой. Это same-privilege supervisor, не elevated service. Он использует Windows 10+ JOB_LIST и требует .NET Framework 4 runtime, обычно присутствующий на поддерживаемых Windows. Отдельный тест старых минимальных Windows 10 обязателен до обещаний совместимости всех сборок ОС.

Сборка не требует предыдущего EXE. Она требует отдельно подготовленные engine-зависимости: их загрузка из официальных источников и полная автоматизация Windows release CI ещё не реализованы. Установщик без предоставленного сертификата остаётся неподписанным. Повышенные права основного приложения пока не устранены.
