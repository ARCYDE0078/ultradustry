# ULTRAdustry

A Mindustry mod that replaces the game's soundtrack with **ULTRAKILL** music — and turns the main menu into a black terminal.

**The mod itself is tiny (~0.4 MB): it contains no audio.** The tracks are downloaded from the ULTRAKILL wiki into a folder next to your game data (`ultradustry-music`), only when you ask for them (or when the mod needs them while you play).

## Features

- **Sector music follows the threat level.** Low/medium, high, extreme and eradication sectors each have their own set of tracks; a few special sectors get their own pairs.
- **Guardians (bosses) get their own themes**, with an intro that starts *before* the wave arrives.
- **Calm moments and captured sectors** play quiet tracks; PvP / Cyber-grind style modes rotate through their own themes.
- **Combat music** follows a "threat points" sum of the enemies on the field (configurable threshold).
- **Terminal main menu** (black screen, big buttons, typing diagnostics readout, unit picker in the settings). The standard menu is one click away.
- **Menu and map editor music** come from the pack too, with seasonal menu themes (Halloween / Christmas / Easter, or force one in the settings).
- Schematics, database and research screens have their own short themes.

## Install

- In game: open **Mods**, press the mod browser button and search for `ULTRAdustry` (new mods show up in the list after its next refresh); or
- **Mods → Import Mod → Import from GitHub** and enter `ARCYDE0078/ultradustry`; or
- download the repository as a `.zip` and put it into the game's `mods` folder.

Works on desktop and Android (`minGameVersion` 154). The mod is `hidden`: it is not required to join multiplayer servers.

## Getting the music

On the first launch a welcome window tells you where to look:

**Settings → ULTRAdustry → "Music pack: download and manage"**

Download the track groups you want (the whole pack is about 700 MB; one threat group is 90–120 MB). With *automatic download* on (the default) the mod also fetches what the current sector needs while you play — until the files arrive the game's normal music plays. The same window can delete everything it downloaded.

Downloads are verified by size and SHA-1 (`tracks.json`), so a half-downloaded or replaced file is never played.

## Known limits

- Only the menu and map-editor tracks are replaced among the game's own music; the launch/landing jingles stay vanilla.
- Sector/boss/PvP music needs the corresponding files to be downloaded; the very first minutes on a new install can be silent or vanilla.
- The wiki must be reachable from your network (some filters block `wiki.gg`).

## Disclaimer

This is an unofficial fan project, not affiliated with the ULTRAKILL developers. ULTRAKILL and its music belong to their respective owners (Hakita / New Blood Interactive; soundtrack by Heaven Pierce Her). The mod does not contain or redistribute any audio: it only downloads files the wiki already hosts, to your own device.

---

## По-русски

Мод для Mindustry: музыка из **ULTRAKILL** вместо стандартной и главное меню в виде чёрного терминала.

**Треков внутри мода нет** (он весит ~0,4 МБ): они скачиваются с вики ULTRAKILL в папку `ultradustry-music` рядом с данными игры. Откройте **Настройки → ULTRAdustry → «Набор музыки: скачать и управлять»** и скачайте нужные группы (весь набор ~700 МБ, одна группа угрозы 90–120 МБ) — или оставьте включённой автозагрузку, и мод сам докачает нужное по ходу игры. Пока файла нет, играет обычная музыка игры.

Музыка сектора зависит от уровня угрозы, у стражей свои темы, в затишье и на захваченных секторах играют спокойные треки. Меню и редактор карт тоже играют скачанные треки (есть праздничные темы).
