// ULTRAdustry — музыка из ULTRAKILL вместо ванильного OST.
//
// Что делает мод:
//  * сектор кампании -> пара calm/combat по его сложности (low … eradication, сектор 27 — отдельная тема);
//  * страж (босс волны) -> своя тема: интро -> петля -> вторая фаза, когда у стража осталось <= 50% хп;
//  * захваченный сектор / песочница / долго нет врагов -> "тихая" тема;
//  * PvP -> одна из тем PvP (кибергринд, Versus, Duel), интро -> петля, раз в несколько минут смена;
//  * главное меню: в дни праздников ULTRAKILL (Хэллоуин, Рождество, Пасха) играет праздничная The Fire Is Gone;
//  * окна схем / базы данных / исследований -> свои треки на весь экран.
// Какой трек к чему относится — написано в tracks.json (его генерирует gen_tracks_json.py из
// каталога ~/projects/ultradustry-sources), в коде названий треков нет.
//
// ТРЕКОВ В МОДЕ НЕТ СОВСЕМ (с 2.4.0). Всё скачивается отдельно, с вики ULTRAKILL, в папку данных игры
// (ultradustry-music/): мод весит доли мегабайта, а репозиторий на GitHub не раздаёт чужие записи.
// Нужное для текущего сектора и стражей докачивается само (настройка autodl); остальное —
// кнопкой в Настройки -> ULTRAdustry -> "Музыка". Музыку главного меню и редактора мод подставляет
// вместо ванильной в рантайме (слоты, см. applyMusicSlots), экраны схем/базы/исследований играют
// скачанные терминальные темы (tracks.json -> special).
//
// Собственный плавный микшер: встроенный fade у SoundControl (finTime/foutTime) сидит в
// protected-методе play(), недоступном модам.

// Порог угрозы: боевая музыка включается, когда суммарная угроза живых врагов (см. unitThreat) не меньше него.
// Ключ НОВЫЙ: старый "ultradustry-enemy-threshold" был в штуках врагов, его число в очках угрозы значило бы совсем другое.
const SETTING_THREAT_THRESHOLD = "ultradustry-threat-threshold";
const THREAT_THRESHOLD_DEFAULT = 4;
const SETTING_WAVE_SWITCH = "ultradustry-wave-switch";
const SETTING_MENU_BG = "ultradustry-menu-bg";
const SETTING_MENU_UNIT = "ultradustry-menu-unit";
const SETTING_AUTODL = "ultradustry-autodl";
const SETTING_PEACE_DELAY = "ultradustry-peace-delay";
const SETTING_BOSS_LEAD = "ultradustry-boss-lead";
const SETTING_HOLIDAY = "ultradustry-menu-holiday";   // 0 по дате, 1 без праздников, 2 Хэллоуин, 3 Рождество, 4 Пасха
const SETTING_TERMINAL = "ultradustry-menu-terminal"; // главное меню в виде терминала
const SETTING_TERM_UNIT = "ultradustry-term-unit";    // фигура юнита (картинка, имя, характеристики, описание) в терминальном меню
const SETTING_UNIT_PICK = "ultradustry-menu-unit-pick"; // имя выбранного юнита; пусто = случайный (общий для терминала и стандартного меню)

const FADE_SECONDS = 2.0; // длительность плавного перехода между треками
const TIER_ORDER = ["low", "medium", "high", "extreme", "eradication"]; // порядок как у Sector.threats в движке
// Ключи списков в tracks.json -> tiers. low и medium слиты в один список "lowmedium": секторов с низкой угрозой в игре
// почти нет, и играть в них одни и те же три пары было бы скучно. Сектор 27 ("unreasonable") — отдельный список.
const POOL_TIERS = ["lowmedium", "high", "extreme", "eradication", "unreasonable"];
const POOL_OF_TIER = {low: "lowmedium", medium: "lowmedium", high: "high", extreme: "extreme",
    eradication: "eradication", unreasonable: "unreasonable"};
const UNREASONABLE_DIFFICULTY = 13; // SectorDifficulty.unreasonable — "зарезервировано под сектор 27"
const HTTP_UA = "ULTRAdustry-Mindustry-mod"; // без User-Agent вики отвечает 403

function getThreatThreshold(){ return Core.settings.getInt(SETTING_THREAT_THRESHOLD, THREAT_THRESHOLD_DEFAULT); }
function isWaveSwitchEnabled(){ return Core.settings.getBool(SETTING_WAVE_SWITCH, true); }
function isMenuBgEnabled(){ return Core.settings.getBool(SETTING_MENU_BG, true); }
function isMenuUnitEnabled(){ return Core.settings.getBool(SETTING_MENU_UNIT, true); }
function isAutoDownload(){ return Core.settings.getBool(SETTING_AUTODL, true); }
function getPeaceDelay(){ return Core.settings.getInt(SETTING_PEACE_DELAY, 60); }
function getBossLeadMs(){ return Core.settings.getInt(SETTING_BOSS_LEAD, BOSS_LEAD_DEFAULT_MS); }
function isTerminalMenu(){ return Core.settings.getBool(SETTING_TERMINAL, true); }
function isTermUnitEnabled(){ return Core.settings.getBool(SETTING_TERM_UNIT, true); }
function musicVolume(){ return Core.settings.getInt("musicvol", 100) / 100; }

function getMod(){
    let mod = Vars.mods.list().find(m => m.name == "ultradustry");
    if (mod == null) ulog.err("[ULTRAdustry] мод не найден по имени 'ultradustry', проверь mod.json -> name");
    return mod;
}

function bundleText(key, a, b, c){
    let s = String(Core.bundle.get(key));
    let args = [a, b, c];
    for (let i = 0; i < args.length; i++) {
        if (args[i] !== undefined) s = s.split("{" + i + "}").join(String(args[i]));
    }
    return s;
}

function randomOf(list){ return list[Math.floor(Math.random() * list.length)]; }

// ---------- журнал и ОТЛАДОЧНАЯ СБОРКА ----------
// ulog — обычный журнал игры ("[ULTRAdustry] ..."): в обычной сборке это просто Log.*, в отладочной ещё и строка в файле.
//
// DEBUG = true стоит ТОЛЬКО в отладочной сборке (её делает ~/projects/ultradustry-pack/build_debug.py, подменяя эту строку).
// В обычной сборке каждый вызов dbg*() прикрыт `if (DEBUG)` прямо на месте вызова: ни работы, ни побочных эффектов.
//
// ЗАЧЕМ. У одного из игроков музыка не играла совсем, и по тишине причину не угадать: сеть (вики недоступна/режется), битый или
// подменённый файл, сбой открытия или запуска, звук не инициализирован, сцена не выбирается... Отладочная сборка пишет
// подробный журнал:
//  * файл <папка данных игры>/ultradustry-debug.log (каждый запуск игры начинает его заново, прошлый лежит рядом как
//    ultradustry-debug.prev.log): отчёт о системе при запуске, проба сети, каждый шаг скачивания / открытия / запуска трека,
//    причина «почему сейчас тишина», «пульс» состояния раз в 10 с;
//  * копию всех строк, кроме «пульса», в общий журнал игры last_log.txt - его выгружает штатная кнопка «Экспорт отчёта об
//    ошибках» (Настройки -> Игра); на телефоне это самый удобный путь.
// Окно «Отладка» (Настройки -> ULTRAdustry): тест звука, проба сети, экспорт отчёта, копия хвоста журнала в буфер обмена.
const DEBUG = false;

const ulog = {
    info: m => { Log.info(m); if (DEBUG) dbgWrite("INFO", m, true); },
    warn: m => { Log.warn(m); if (DEBUG) dbgWrite("WARN", m, true); },
    err: m => { Log.err(m); if (DEBUG) dbgWrite("ERR ", m, true); }
};

const DBG_MAX_BYTES = 6000000;      // потолок размера файла журнала (дальше не пишем)
const DBG_TAIL_LINES = 120;         // сколько последних строк держим в памяти (буфер обмена, запасной вывод)
const DBG_BEAT_GAME = 10;           // «пульс» состояния: раз в столько секунд в игре...
const DBG_BEAT_MENU = 30;           // ...и в меню
const DBG_VERSION = "2.4.1-debug";

let dbgFile = null;                 // Fi журнала
let dbgExec = null;                 // ОДИН поток записи: из него же правятся dbgTail и dbgBytes (вызывают из любых потоков)
let dbgT0 = 0;                      // начало отсчёта «+N с»
let dbgBytes = 0;
let dbgOff = false;                 // журнал сломался (нельзя создать файл) - молчим, игру не трогаем
let dbgTail = [];
let dbgFrames = 0;
let dbgBeatAt = 0;
let dbgWhyAt = {};                  // ключ -> когда последний раз считали причину (мс)
let dbgWhyLast = {};                // ключ -> последний записанный текст причины (повторы не пишем)
let dbgNetExec = null;
let dbgTestExec = null;
let dbgDialog = null;
let dbgFrameErr = 0;
let dbgFailProbes = 0;             // сколько раз сеть пробовали сразу после сбоя скачивания (хватит двух)

function dbgProp(k){
    try { return String(Packages.java.lang.System.getProperty(k)); } catch (e) { return "?"; }
}

// Текст ошибки со стеком и цепочкой «Caused by» (у сетевых сбоев причина — в них: UnknownHostException, SSL...).
function dbgErrText(e){
    let s = String(e);
    try {
        let ex = (e != null && e.javaException != null) ? e.javaException : e;
        if (ex != null && typeof ex.printStackTrace == "function") {
            let sw = new Packages.java.io.StringWriter();
            ex.printStackTrace(new Packages.java.io.PrintWriter(sw));
            s = String(sw.toString());
        } else if (e != null && e.stack) {
            s += "\n" + String(e.stack);
        }
    } catch (e2) {}
    // Настоящий стек Java из ~25 строк, из них полезны 3-5: кадры Rhino, рефлексии и пула потоков одинаковы у любой ошибки и
    // только мешают читать. Оставляем саму ошибку, «Caused by», кадры сети/ввода-вывода и кадры мода (main.js), всего до 14 строк.
    let ls = s.split("\n"), keep = [];
    for (let i = 0; i < ls.length && keep.length < 14; i++) {
        let l = ls[i];
        if (l.length == 0) continue;
        if (l.indexOf("main.js") < 0 && (l.indexOf("\tat rhino") == 0 || l.indexOf("\tat jdk.proxy") == 0 || l.indexOf("jdk.internal.reflect") >= 0
            || l.indexOf("java.lang.reflect.Method") >= 0 || l.indexOf("java.util.concurrent") >= 0 || l.indexOf("java.lang.Thread.run") >= 0)) continue;
        keep.push(l);
    }
    if (keep.length < ls.length) keep.push("\t...(кадры Rhino/потоков опущены)");
    s = keep.join("\n");
    return s.length > 2200 ? s.substring(0, 2200) + " ...(обрезано)" : s;
}

// Домашнюю папку пользователя прячем (в пути бывает имя учётной записи); непривычные символы в пути помечаем: на них
// иногда спотыкается открытие файла.
function dbgPath(p){
    let s = String(p);
    try {
        let home = dbgProp("user.home");
        if (home.length > 3 && s.indexOf(home) == 0) s = "~" + s.substring(home.length);
    } catch (e) {}
    for (let i = 0; i < s.length; i++) {
        if (s.charCodeAt(i) > 127) return s + "  [В ПУТИ ЕСТЬ НЕ-ASCII СИМВОЛЫ]";
    }
    return s;
}

function dbgBaseDir(){
    return (Vars.dataDirectory != null) ? Vars.dataDirectory : Core.settings.getDataDirectory();
}

function dbgInit(){
    if (!DEBUG || dbgFile != null || dbgOff) return;
    try {
        let base = dbgBaseDir();
        let f = base.child("ultradustry-debug.log");
        let prev = base.child("ultradustry-debug.prev.log");
        if (f.exists()) {
            if (prev.exists()) prev.delete();
            f.file().renameTo(prev.file());
        }
        f.writeString("", false); // проверяем, что писать вообще можно
        dbgFile = f;
        try { dbgExec = makeAudioThread("ULTRAdustry-debuglog"); } catch (e1) { dbgExec = null; }
        dbgEmit("===== ULTRAdustry " + DBG_VERSION + ": журнал начат " + new Date(Number(Time.millis())).toISOString() + " (UTC) =====");
    } catch (e) {
        dbgOff = true;
        Log.err("[ULTRAdustry] отладочный журнал не создался: " + e);
    }
}

// Запись строки. Любой поток. Форматируем тут, а в общий список и файл пишет только поток журнала.
function dbgWrite(level, msg, noMirror){
    if (!DEBUG || dbgOff) return;
    try {
        let now = Number(Time.millis());
        if (dbgT0 == 0) dbgT0 = now;
        let line = new Date(now).toISOString().substring(11, 23) + " +" + fixed((now - dbgT0) / 1000, 1) + "s " + level + " " + msg;
        if (!noMirror) Log.info("[ULTRAdustry-DBG] " + msg);
        if (dbgFile == null) dbgInit();
        if (dbgExec != null) dbgExec.execute(() => { dbgEmit(line); });
        else dbgEmit(line);
    } catch (e) {}
}

// ТОЛЬКО в потоке журнала (или пока потока нет).
function dbgEmit(line){
    dbgTail.push(line);
    if (dbgTail.length > DBG_TAIL_LINES) dbgTail.shift();
    if (dbgFile == null || dbgBytes > DBG_MAX_BYTES) return;
    dbgBytes += line.length + 1;
    try {
        dbgFile.writeString(line + "\n", true);
        if (dbgBytes > DBG_MAX_BYTES) dbgFile.writeString("... журнал достиг предела размера, дальше не пишу ...\n", true);
    } catch (e) { dbgOff = true; }
}

function dbg(msg){ dbgWrite("DBG ", msg, false); }
// из чужого потока (загрузчик, звуковые потоки): пусть строку оформит и запишет главный
function dbgPost(msg){ try { Core.app.post(() => dbg(msg)); } catch (e) {} }

// Дождаться, пока поток журнала допишет всё накопленное (перед экспортом / чтением файла).
function dbgFlush(){
    if (dbgExec == null) return;
    try {
        let latch = new Packages.java.util.concurrent.CountDownLatch(1);
        dbgExec.execute(() => { latch.countDown(); });
        latch.await(2, Packages.java.util.concurrent.TimeUnit.SECONDS);
    } catch (e) {}
}

// «Почему так»: причину считаем не чаще раза в секунду на ключ и пишем только когда текст сменился.
function dbgWhy(key, fn){
    if (!DEBUG) return;
    try {
        let now = Number(Time.millis());
        if (dbgWhyAt[key] !== undefined && now - dbgWhyAt[key] < 1000) return;
        dbgWhyAt[key] = now;
        let text = String(fn());
        if (dbgWhyLast[key] === text) return;
        dbgWhyLast[key] = text;
        dbg("почему так [" + key + "]: " + text);
    } catch (e) { dbg("почему так [" + key + "]: сам расчёт упал: " + dbgErrText(e)); }
}

function dbgTry(label, fn){
    try { dbg(label + ": " + fn()); } catch (e) { dbg(label + ": ОШИБКА " + dbgErrText(e)); }
}

function dbgFilesState(names){
    return names.map(n => n + "[" + (fileOk(n) ? "ок" : "НЕТ") + (badFiles[n] ? ",БИТЫЙ" : "") + (dl.fails[n] ? ",неудач=" + dl.fails[n] : "") + (isPending(n) ? ",в-очереди" : "") + "]").join(" ");
}

// Почему сейчас нет сцены (вызывается, когда pickScene вернул null в игре).
function dbgNoSceneText(){
    let pool = pairPool();
    let ready = pool.filter(pairPlayable);
    let t = "сектор=" + sectorTier() + " пар в списке=" + pool.length + " играбельных=" + ready.length
        + " автозагрузка=" + isAutoDownload() + " очередь=" + dl.queue.length + " качается=" + (dl.current != null ? dl.current.name : "нет")
        + " скачано всего=" + dbgCountOk();
    if (session.want != null) t += " | ждём пару " + session.want + ": " + dbgFilesState(trackFileNames(session.want));
    if (dl.lastError != null) t += " | последняя ошибка скачивания: " + dl.lastError;
    return t;
}

// Почему pickScene вернул null (повторяет его условия по порядку).
function dbgNoSceneWhy(){
    if (Vars.state.rules.editor || Vars.ui.editor.isShown()) return "открыт редактор карт — мод молчит по задумке";
    if (session.t < STARTUP_DELAY_SECONDS) return "после захода на карту прошло " + fixed(session.t, 1) + " с, мод ждёт " + STARTUP_DELAY_SECONDS + " с";
    if (musicVolume() <= 0) return "ГРОМКОСТЬ МУЗЫКИ В НАСТРОЙКАХ ИГРЫ = 0 — мод молчит по задумке";
    return dbgNoSceneText();
}

// Сцена выбрана, а голосов нет: что с файлами сцены.
function dbgNoVoicesWhy(){
    let names = sceneFileNames();
    if (names.length == 0) return "сцена " + scene.key + " без файлов?!";
    return "сцена " + scene.key + " уже " + fixed(session.t - scene.since, 0) + " с, голосов нет; файлы: "
        + names.map(n => { let r = opened[n]; return n + "[" + (fileOk(n) ? "на-диске" : "НЕТ-НА-ДИСКЕ") + ",открытие=" + (r == null ? "не-начато" : (r.state == 1 ? "готов" : (r.state == 0 ? "идёт" : "СБОЙ"))) + (badFiles[n] ? ",БИТЫЙ" : "") + (dl.fails[n] ? ",неудач=" + dl.fails[n] : "") + (isPending(n) ? ",в-очереди" : "") + "]"; }).join(" ");
}

function dbgCountOk(){
    let n = 0, names = Object.keys(tracksData.files);
    for (let i = 0; i < names.length; i++) if (downloadable(names[i]) && fileOk(names[i])) n++;
    return n;
}

function dbgVoiceText(v){
    return v.name + "{gain=" + fixed(v.gain, 2) + " отпр=" + v.sent + (v.startedAt > 0 ? "" : " ЕЩЁ-НЕ-ЗАПУЩЕН") + (v.keep ? " keep" : "") + "}";
}

// Одна строка «пульса»: всё, что нужно, чтобы понять, чем сейчас занят мод.
function dbgStateLine(){
    let p = [];
    p.push("кадров=" + dbgFrames);
    if (tracksData == null) p.push("tracksData=NULL(мод не работает)");
    if (mixerDisabled) p.push("МИКШЕР-ОТКЛЮЧЁН");
    if (tickErrors > 0) p.push("сбоев-подряд=" + tickErrors);
    let inGame = Vars.state.isGame();
    p.push(inGame ? "в игре" : "меню");
    p.push("музыка=" + Core.settings.getInt("musicvol", 100) + "%");
    if (inGame) {
        let tier = null;
        try { tier = sectorTier(); } catch (e) {}
        p.push("сектор=" + tier + " t=" + fixed(session.t, 0) + "с враги=" + Vars.state.enemies + " угроза=" + fixed(session.threat, 1)
            + " бой=" + combatWanted + " затишье=" + fixed(peaceTimer, 0) + "с пауза=" + Vars.state.isPaused());
    }
    p.push("сцена=" + (scene.key == null ? "нет" : scene.key) + (overlayFile != null ? " экран=" + overlayFile : ""));
    let names = Object.keys(voices);
    p.push("голоса=[" + names.map(n => dbgVoiceText(voices[n])).join(" ") + "]");
    p.push("скачивание: " + (dl.current != null ? dl.current.name : "нет") + " очередь=" + dl.queue.length + " готово=" + dl.done
        + " файлов-с-неудачами=" + Object.keys(dl.fails).length + (dl.lastError != null ? " последняя-ошибка=" + dl.lastError : ""));
    let bad = Object.keys(badFiles).filter(k => badFiles[k]);
    if (bad.length > 0) p.push("не-открылись=" + bad.join(","));
    p.push("открыто файлов=" + Object.keys(opened).length);
    return p.join(" | ");
}

function dbgEnterGame(){
    let s = [];
    try { s.push("карта=" + Vars.state.map.name()); } catch (e) {}
    try { let r = Vars.state.rules; s.push("waves=" + r.waves + " attack=" + r.attackMode + " pvp=" + r.pvp + " editor=" + r.editor); } catch (e) {}
    try { s.push(Vars.state.getSector() != null ? "сектор кампании, угроза=" + sectorTier() : "не кампания (сектора нет)"); } catch (e) {}
    try { s.push("сеть=" + Vars.net.active()); } catch (e) {}
    dbg("ВХОД В ИГРУ: " + s.join(", "));
}

// Заглянуть в начало файла: вместо ogg вики иногда отдаёт страницу-заглушку (антибот, «доступ ограничен»), и тогда размер не
// сходится; по первым байтам это видно сразу.
function dbgBytesText(buf, n){
    if (n <= 0) return "(пусто)";
    let s = String(new Packages.java.lang.String(buf, 0, n, "ISO-8859-1"));
    let t = "";
    for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        t += (c >= 32 && c < 127) ? s.charAt(i) : ".";
    }
    return (s.substring(0, 4) == "OggS" ? "[заголовок ogg OggS есть] " : "[это НЕ ogg] ") + t;
}

function dbgPeek(fi){
    try {
        if (!fi.exists()) return;
        let is = fi.read();
        let buf = Packages.java.lang.reflect.Array.newInstance(Packages.java.lang.Byte.TYPE, 200);
        let n = Number(is.read(buf));
        is.close();
        dbg("начало файла " + fi.name() + " (" + fi.length() + " байт): " + dbgBytesText(buf, n));
    } catch (e) { dbg("не смог заглянуть в " + fi.name() + ": " + dbgErrText(e)); }
}

// Проба сети: DNS (в своём потоке - может висеть секундами) и настоящий HTTP-запрос к самому маленькому файлу каталога
// (читаем только первые 2 КБ). Ответ «OggS» = вики отдаёт настоящий файл; иначе видно, что пришло вместо него.
function dbgNetProbe(tag){
    if (tracksData == null) { dbg("СЕТЬ [" + tag + "]: каталога нет, пробовать нечего"); return; }
    let name = null, best = 0;
    let all = Object.keys(tracksData.files);
    for (let i = 0; i < all.length; i++) {
        let m = tracksData.files[all[i]];
        if (!downloadable(all[i])) continue;
        if (name == null || m.bytes < best) { name = all[i]; best = m.bytes; }
    }
    if (name == null) { dbg("СЕТЬ [" + tag + "]: в каталоге нет скачиваемых файлов"); return; }
    let url = String(tracksData.files[name].url);
    let host = url.split("/")[2];
    if (host.indexOf("[") != 0 && host.indexOf(":") > 0) host = host.split(":")[0];     // без порта: «host:8765» DNS принимает за адрес IPv6
    dbg("СЕТЬ [" + tag + "]: проба " + host + ", файл " + name + " (" + best + " байт)");
    try {
        if (dbgNetExec == null) dbgNetExec = makeAudioThread("ULTRAdustry-dbgnet");
        dbgNetExec.execute(() => {
            let t0 = Time.millis(), msg;
            try {
                let a = Packages.java.net.InetAddress.getAllByName(host);
                let ips = [];
                for (let i = 0; i < a.length; i++) ips.push(String(a[i].getHostAddress()));
                msg = "СЕТЬ: DNS " + host + " -> " + ips.join(", ") + " за " + (Time.millis() - t0) + " мс";
            } catch (e) {
                msg = "СЕТЬ: DNS " + host + " НЕ РАЗРЕШИЛСЯ за " + (Time.millis() - t0) + " мс: " + dbgErrText(e);
            }
            dbgPost(msg);
        });
    } catch (e) { dbg("СЕТЬ: не смог запустить проверку DNS: " + dbgErrText(e)); }
    let t1 = Time.millis();
    try {
        let req = Http.get(url);
        req.timeout = 20000;
        req.header("User-Agent", HTTP_UA)
            .header("X-ULTRAdustry-Probe", "1")       // метка пробы: по ней тестовый стенд не считает её скачиванием
            .redirects(true)
            .error(err => { dbgPost("СЕТЬ: HTTP-запрос НЕ УДАЛСЯ за " + (Time.millis() - t1) + " мс: " + dbgErrText(err)); })
            .submit(res => {
                let msg;
                try {
                    let ct = null, cl = -1;
                    try { ct = res.getHeader("Content-Type"); } catch (e1) {}
                    try { cl = Number(res.getContentLength()); } catch (e2) {}
                    let is = res.getResultAsStream();
                    let buf = Packages.java.lang.reflect.Array.newInstance(Packages.java.lang.Byte.TYPE, 2048);
                    let n = Number(is.read(buf));
                    try { is.close(); } catch (e3) {}
                    msg = "СЕТЬ: HTTP " + res.getStatus() + " за " + (Time.millis() - t1) + " мс, тип=" + ct + " длина=" + cl
                        + " (ждали " + best + "); начало: " + dbgBytesText(buf, n);
                } catch (e) { msg = "СЕТЬ: ответ получен, но прочитать не вышло: " + dbgErrText(e); }
                dbgPost(msg);
            });
    } catch (e) { dbg("СЕТЬ: не смог отправить запрос: " + dbgErrText(e)); }
}

// Отчёт о системе при запуске: всё, что может объяснить тишину, одним куском.
function dbgReport(){
    dbg("===== ОТЧЁТ ПРИ ЗАПУСКЕ =====");
    dbgTry("мод", () => { let m = getMod(); return m == null ? "НЕ НАЙДЕН" : m.meta.name + " " + m.meta.version + ", файл " + dbgPath(m.file.absolutePath()) + ", включён=" + m.enabled(); });
    dbgTry("игра", () => {
        let V = Packages.mindustry.core.Version;
        return String(V.combined()).split("\n").join(" ") + " (type=" + V.type + ", modifier=" + V.modifier + ", build=" + V.build + ", number=" + V.number + ")";
    });
    dbgTry("платформа", () => "приложение=" + Core.app.getClass().getName() + " тип=" + Core.app.getType() + " mobile=" + Vars.mobile + " android=" + Vars.android + " ios=" + Vars.ios + " headless=" + Vars.headless);
    dbgTry("система", () => dbgProp("os.name") + " " + dbgProp("os.version") + " " + dbgProp("os.arch") + ", java " + dbgProp("java.version") + " (" + dbgProp("java.vendor") + "), язык=" + dbgProp("user.language") + ", кодировка файлов=" + dbgProp("file.encoding"));
    dbgTry("прокси", () => "http=" + dbgProp("http.proxyHost") + " https=" + dbgProp("https.proxyHost") + " socks=" + dbgProp("socksProxyHost") + " useSystemProxies=" + dbgProp("java.net.useSystemProxies"));
    dbgTry("звук", () => {
        let a = Core.audio;
        return a == null ? "Core.audio = null (звука НЕТ)" : "класс " + a.getClass().getName() + ", initialized=" + a.initialized();
    });
    dbgTry("громкость в настройках игры", () => "музыка=" + Core.settings.getInt("musicvol", 100) + "% звуки=" + Core.settings.getInt("sfxvol", 100) + "%");
    dbgTry("настройки мода", () => "autodl=" + isAutoDownload() + " порог угрозы=" + getThreatThreshold() + " смена по волнам=" + isWaveSwitchEnabled()
        + " затишье=" + getPeaceDelay() + "с запас стража=" + getBossLeadMs() + "мс терминал=" + isTerminalMenu());
    dbgTry("встроенная музыка игры", () => {
        let s = Vars.control.sound;
        return s.getClass().getName() + ": ambient=" + s.ambientMusic.size + " dark=" + s.darkMusic.size + " boss=" + s.bossMusic.size + " musicWaveChance=" + s.musicWaveChance;
    });
    dbgTry("моды", () => {
        let l = Vars.mods.list(), out = [];
        for (let i = 0; i < l.size; i++) { let m = l.get(i); out.push(m.name + " " + m.meta.version + (m.enabled() ? "" : "(выкл)")); }
        return l.size + " шт: " + out.join(", ");
    });
    dbgTry("папка данных", () => { let b = dbgBaseDir(); return dbgPath(b.absolutePath()) + " существует=" + b.exists(); });
    if (tracksData == null) { dbg("tracks.json НЕ ПРОЧИТАН - мод работать не будет (причина выше, в строках с ERR)"); return; }
    dbgTry("каталог", () => "версия=" + tracksData.version + " файлов=" + Object.keys(tracksData.files).length + " пар=" + allPairs().length + " тем PvP=" + tracksData.pvp.length);
    dbgTry("папка треков", () => {
        let d = cacheDir(), f = d.file();
        return dbgPath(d.absolutePath()) + " существует=" + d.exists() + " папка=" + f.isDirectory() + " писать=" + f.canWrite() + " свободно МБ=" + Math.round(Number(f.getUsableSpace()) / 1048576);
    });
    dbgTry("пробная запись", () => {
        let t = cacheDir().child("dbg-write-test.tmp");
        t.writeString("x", false);
        let ok = t.exists() && Number(t.length()) == 1;
        t.delete();
        return ok ? "ок" : "НЕ ПОЛУЧИЛОСЬ (файл не создался)";
    });
    dbgTry("скачанные треки", () => {
        let names = Object.keys(tracksData.files), have = 0, missing = 0, wrong = [];
        for (let i = 0; i < names.length; i++) {
            if (!downloadable(names[i])) continue;
            let f = cacheDir().child(names[i]);
            if (!f.exists()) { missing++; continue; }
            let len = Number(f.length());
            if (len == tracksData.files[names[i]].bytes) have++;
            else wrong.push(names[i] + " " + len + "/" + tracksData.files[names[i]].bytes);
        }
        return "целых=" + have + " нет=" + missing + " неверного размера=" + wrong.length + (wrong.length > 0 ? " (" + wrong.slice(0, 8).join(", ") + ")" : "");
    });
    dbgTry("недокачанные .part", () => {
        let arr = cacheDir().list(), parts = [];
        for (let i = 0; i < arr.length; i++) { let nm = String(arr[i].name()); if (nm.indexOf(".part") > 0) parts.push(nm); }
        return parts.length == 0 ? "нет" : parts.join(", ");
    });
    dbgTry("слоты музыки меню/редактора", () => {
        let out = [];
        for (let i = 0; i < SLOT_FIELDS.length; i++) {
            let f = SLOT_FIELDS[i], n = slotWantedFile(f);
            out.push(f + "=" + n + " (" + (n == null ? "не задан" : (fileOk(n) ? "скачан" : "НЕ скачан")) + ", " + (slotState[f] != null && slotState[f].name == n ? "подставлен" : "не подставлен") + ")");
        }
        return out.join("; ");
    });
    dbgNetProbe("старт");
    dbg("===== конец отчёта при запуске =====");
}

// ---- пульс и пробы голосов (каждый кадр, независимо от микшера: видно и когда микшер мёртв) ----

function dbgProbeVoice(v, stage){
    let mus = v.music, name = v.name;
    runAudio(audioControl, () => {
        let playing = null, pos = -1, vol = -1, err = null;
        try { playing = !!mus.isPlaying(); pos = Number(mus.getPosition()); vol = Number(mus.getVolume()); } catch (e) { err = dbgErrText(e); }
        let at = Number(Time.millis());
        Core.app.post(() => {
            let verdict = "";
            if (err == null) {
                if (!playing) verdict = "  <<< НЕ ИГРАЕТ";
                else if (v.dbgPos !== undefined) {
                    let wall = (at - v.dbgPos.at) / 1000;
                    verdict = (pos > v.dbgPos.pos + 0.5 * wall || pos < v.dbgPos.pos) ? "  (позиция идёт)" : "  <<< ПОЗИЦИЯ НЕ ДВИГАЕТСЯ (звука нет?)";
                }
                v.dbgPos = {pos: pos, at: at};
            }
            dbg("проба голоса #" + stage + " " + name + ": " + (err != null ? "ОШИБКА " + err
                : "isPlaying=" + playing + " позиция=" + fixed(pos, 2) + " с, громкость в Soloud=" + fixed(vol, 3) + ", должно быть gain*музыка=" + fixed(v.gain * musicVolume(), 3)) + verdict);
        });
    });
}

function dbgProbeVoices(now){
    let names = Object.keys(voices);
    for (let i = 0; i < names.length; i++) {
        let v = voices[names[i]];
        if (v == null || v.startedAt <= 0 || v.music == null) continue;
        let age = now - v.startedAt;
        let stage = v.dbgStage || 0;
        if (stage == 0 && age >= 1500) { /* первая проба */ }
        else if (stage == 1 && age >= 6000) { /* вторая: сверяем позицию с первой */ }
        else continue;
        v.dbgStage = stage + 1;
        dbgProbeVoice(v, stage + 1);
    }
}

function dbgFrame(){
    try {
        dbgFrames++;
        let now = Number(Time.millis());
        if (dbgFrames == 1) dbg("первый кадр: обновление игры идёт (tracksData=" + (tracksData != null) + ")");
        if (dbgBeatAt == 0) dbgBeatAt = now;
        let every = (Vars.state.isGame() ? DBG_BEAT_GAME : DBG_BEAT_MENU) * 1000;
        if (now - dbgBeatAt >= every) {
            dbgBeatAt = now;
            dbgWrite("BEAT", dbgStateLine(), true);
        }
        if (tracksData != null) dbgProbeVoices(now);
    } catch (e) {
        dbgFrameErr++;
        if (dbgFrameErr == 1 || dbgFrameErr % 600 == 0) dbg("сбой отладочного кадра (" + dbgFrameErr + "): " + dbgErrText(e));
    }
}

// ---- тест звука: проигрываем уже скачанный маленький файл (экранные темы / слоты) и смотрим, идёт ли позиция ----

function dbgToast(text){ try { Vars.ui.showInfoToast(text, 7); } catch (e) {} }

// Первый скачанный маленький файл для теста звука (экранные темы ~330 КБ, потом слоты), без него - null.
function dbgSoundTestFile(){
    let cand = [], sp = tracksData.special || {}, sl = tracksData.slots || {};
    let k = Object.keys(sp);
    for (let i = 0; i < k.length; i++) cand.push(sp[k[i]]);
    k = Object.keys(sl);
    for (let i = 0; i < k.length; i++) cand.push(sl[k[i]]);
    for (let i = 0; i < cand.length; i++) if (fileMeta(cand[i]) != null && fileOk(cand[i])) return cand[i];
    return null;
}

function dbgSoundTest(){
    dbg("ТЕСТ ЗВУКА: старт (Core.audio initialized=" + (function(){ try { return Core.audio.initialized(); } catch (e) { return "?"; } })() + ")");
    let tn = dbgSoundTestFile();
    if (tn == null) {
        // в самом моде файлов больше нет: берём любой маленький скачанный, а если ни одного — просим скачать и повторить позже
        let want = (tracksData.special && tracksData.special.schematics) || slotWantedFile("menu");
        if (want != null) enqueue([want], true, true);
        dbg("ТЕСТ ЗВУКА: нет ни одного скачанного маленького файла, поставил в очередь " + want);
        dbgToast("Тест звука: сперва нужен скачанный файл. Качаю, повторите через минуту");
        return;
    }
    let fi = cacheDir().child(tn);
    let vol = Math.max(0.3, musicVolume());
    dbgToast("Тест звука: играю ~3 секунды. Слышно?");
    try {
        if (dbgTestExec == null) dbgTestExec = makeAudioThread("ULTRAdustry-selftest");
        dbgTestExec.execute(() => {
            let out = [], mus = null, verdict = "";
            try {
                let t0 = Number(Time.millis());
                mus = new Music();
                loadMusicFile(mus, fi, true);
                out.push("открыт за " + (Number(Time.millis()) - t0) + " мс, длина " + fixed(Number(mus.getLength()), 1) + " с");
                mus.setLooping(false);
                mus.setVolume(vol);
                mus.play();
                out.push("play() вызван, громкость " + fixed(vol, 2) + ", isPlaying=" + mus.isPlaying());
                Packages.java.lang.Thread.sleep(1200);
                let p1 = Number(mus.getPosition());
                Packages.java.lang.Thread.sleep(2000);
                let p2 = Number(mus.getPosition());
                let ok = p2 > p1 + 1;
                out.push("позиция через 1,2 с: " + fixed(p1, 2) + ", через 3,2 с: " + fixed(p2, 2) + (ok ? " -> декодер и микшер работают" : "  <<< ПОЗИЦИЯ НЕ ДВИГАЕТСЯ: звуковой движок не играет"));
                verdict = ok ? "Тест звука: движок играет (если не слышно - проверь устройство вывода и громкость системы)" : "Тест звука: звуковой движок НЕ играет, см. журнал";
            } catch (e) {
                out.push("ОШИБКА: " + dbgErrText(e));
                verdict = "Тест звука: ОШИБКА, см. журнал";
            }
            try { if (mus != null) { mus.stop(); mus.dispose(); } } catch (e2) {}
            Core.app.post(() => {
                for (let i = 0; i < out.length; i++) dbg("ТЕСТ ЗВУКА: " + out[i]);
                dbgToast(verdict);
            });
        });
    } catch (e) { dbg("ТЕСТ ЗВУКА: не смог запустить: " + dbgErrText(e)); }
}

// ---- окно «Отладка» ----

function dbgReportText(){
    dbgFlush();
    let out = ["=== ULTRAdustry " + DBG_VERSION + ": отчёт ==="];
    try { out.push(String(dbgFile.readString())); } catch (e) { out.push("(файл журнала не прочитался: " + e + ")\n" + dbgTail.join("\n")); }
    try {
        let lg = dbgBaseDir().child("last_log.txt");
        if (lg.exists()) {
            let s = String(lg.readString());
            out.push("\n=== last_log.txt игры (последние 200 КБ) ===\n" + (s.length > 200000 ? s.substring(s.length - 200000) : s));
        }
    } catch (e) {}
    return out.join("\n");
}

function dbgCopyTail(){
    dbgFlush();
    let s = dbgTail.join("\n");
    if (s.length > 3500) s = s.substring(s.length - 3500);
    try {
        Core.app.setClipboardText(s);
        dbgToast("Хвост журнала скопирован в буфер обмена (" + s.length + " знаков)");
    } catch (e) { dbgToast("Не вышло скопировать: " + e); }
}

function dbgExport(){
    try {
        dbg("ЭКСПОРТ: открываю диалог сохранения файла ultradustry-report.txt (если окно не появилось - журнал и так лежит в папке данных)");
        Packages.mindustry.ui.FileChooser.export("ultradustry-report", "txt", file => {
            file.writeString(dbgReportText());
            dbg("ЭКСПОРТ: файл записан: " + dbgPath(file.absolutePath()));
        });
    } catch (e) {
        dbg("экспорт отчёта не удался: " + dbgErrText(e));
        dbgToast("Экспорт не вышел (" + e + "). Файл журнала лежит в папке данных игры: ultradustry-debug.log");
    }
}

function showDebugDialog(){
    if (dbgDialog == null) {
        dbgDialog = new BaseDialog("ULTRAdustry: отладка / debug");
        dbgDialog.addCloseButton();
        let t = dbgDialog.cont;
        t.add("Журнал / log: " + dbgPath(dbgFile != null ? dbgFile.absolutePath() : "(не создан)")).wrap().width(620).left().row();
        t.add("Версия отладочной сборки: " + DBG_VERSION).left().row();
        t.button("Тест звука / Sound test", () => dbgSoundTest()).growX().height(54).pad(6).row();
        t.button("Проверка сети / Network test", () => { dbgNetProbe("кнопка"); dbgToast("Проба сети запущена, результат в журнале"); }).growX().height(54).pad(6).row();
        t.button("Экспорт отчёта в файл / Export report", () => dbgExport()).growX().height(54).pad(6).row();
        t.button("Скопировать хвост журнала в буфер / Copy log tail", () => dbgCopyTail()).growX().height(54).pad(6).row();
        if (!Vars.mobile) t.button("Открыть папку с журналом / Open folder", () => { try { Core.app.openFolder(dbgBaseDir().absolutePath()); } catch (e) { dbgToast("" + e); } }).growX().height(54).pad(6).row();
    }
    dbgDialog.show();
}

function addDebugButton(table){
    try {
        let setting = extend(SettingsMenuDialog.SettingsTable.Setting, "ultradustry-debug", {
            add: function(t){
                t.button("ULTRAdustry: отладка / debug", () => showDebugDialog()).growX().height(50).pad(6).row();
            }
        });
        table.pref(setting);
    } catch (e) {
        ulog.warn("[ULTRAdustry] кнопка отладки не создалась (" + e + "), ставлю обычную");
        table.row();
        table.button("ULTRAdustry: отладка / debug", () => showDebugDialog()).growX().height(50).pad(6).row();
    }
}

if (DEBUG) {
    dbgInit();
    dbg("main.js загружен (отладочная сборка " + DBG_VERSION + ")");
    // Минимум о системе сразу при загрузке скрипта: если обработчик ClientLoadEvent так и не сработает, полный отчёт не появится
    dbgTry("игра", () => String(Packages.mindustry.core.Version.combined()).split("\n").join(" ") + ", " + dbgProp("os.name") + " " + dbgProp("os.arch") + ", java " + dbgProp("java.version"));
}

// ---------- каталог треков (tracks.json) и папка с загруженными файлами ----------

let tracksData = null;  // распарсенный tracks.json
let cacheDirFi = null;
let fileOkMemo = {};    // имя файла -> скачан и цел? (сбрасывается при скачивании/удалении/открытии окна)
let badFiles = {};      // файлы, которые не удалось открыть как музыку (чтобы не долбиться каждый кадр)

function loadTracksData(mod){
    try {
        let f = mod.root.child("tracks.json");
        if (!f.exists()) { ulog.err("[ULTRAdustry] в моде нет tracks.json"); return null; }
        let d = JSON.parse(String(f.readString()));
        if (!d.files || !d.tracks || !d.tiers) throw new Error("в tracks.json нет files/tracks/tiers");
        if (!d.pvp) d.pvp = [];
        if (!d.holidays) d.holidays = {};
        if (!d.slots) d.slots = {};
        if (!d.special) d.special = {};
        // самое длинное интро среди тем: за него (+ запас) до волны начинаем готовить тему стража
        d.maxIntro = 0;
        let ids = Object.keys(d.tracks);
        for (let i = 0; i < ids.length; i++) d.maxIntro = Math.max(d.maxIntro, Number(d.tracks[ids[i]].introSeconds) || 0);
        return d;
    } catch (e) {
        ulog.err("[ULTRAdustry] не прочитал tracks.json: " + e);
        return null;
    }
}

function cacheDir(){
    if (cacheDirFi == null) {
        let base = (Vars.dataDirectory != null) ? Vars.dataDirectory : Core.settings.getDataDirectory();
        cacheDirFi = base.child("ultradustry-music");
        cacheDirFi.mkdirs();
    }
    return cacheDirFi;
}

function fileMeta(name){ return tracksData.files[name]; }

// Файл можно играть: скачан целиком (размер совпадает с каталогом).
// Файлы без bytes (положенные вручную, как Clair de Lune) принимаем, если они не пустые.
function fileOk(name){
    if (tracksData == null) return false;
    let m = fileMeta(name);
    if (m == null || badFiles[name]) return false;
    if (fileOkMemo[name] !== undefined) return fileOkMemo[name];
    let ok = false;
    try {
        let f = cacheDir().child(name);
        ok = f.exists() && (m.bytes ? Number(f.length()) == m.bytes : Number(f.length()) > 0);
    } catch (e) { ok = false; }
    fileOkMemo[name] = ok;
    return ok;
}

function forgetFileState(name){
    delete fileOkMemo[name];
    delete badFiles[name];
}

// ---------- состав треков ----------

const FILE_KEYS = ["intro", "loop", "loop2", "calm", "combat"];

function trackFileNames(tid){
    let t = tracksData.tracks[tid];
    let out = [];
    for (let i = 0; i < FILE_KEYS.length; i++) if (t[FILE_KEYS[i]]) out.push(t[FILE_KEYS[i]]);
    if (t.variants) for (let j = 0; j < t.variants.length; j++) out.push(t.variants[j]);
    return out;
}

function pairPlayable(tid){
    let t = tracksData.tracks[tid];
    return !!(t.calm && t.combat && fileOk(t.calm) && fileOk(t.combat));
}

function bossThemeIds(){
    let ids = [];
    let g = tracksData.guardians;
    let keys = Object.keys(g); // for (const k in g) старый Rhino не разбирает
    for (let i = 0; i < keys.length; i++) if (ids.indexOf(g[keys[i]]) < 0) ids.push(g[keys[i]]);
    if (ids.indexOf(tracksData.guardianDefault) < 0) ids.push(tracksData.guardianDefault);
    return ids;
}

function peaceFileNames(){
    let out = [];
    for (let i = 0; i < tracksData.peace.length; i++) {
        let names = trackFileNames(tracksData.peace[i]);
        for (let j = 0; j < names.length; j++) out.push(names[j]);
    }
    return out;
}

// Файлы «обвязки» мода: музыка главного меню и карт-редактора (слоты), три экранные темы (схемы / база данных / исследования)
// и праздничные темы меню. РАНЬШЕ их не было в окне загрузки совсем: они докачивались только фоном (prefetchStartup / applyMusicSlots)
// и только при включённой автозагрузке, а «Скачать всё» их не включало - человек жал «Скачать всё», меню и редактор оставались
// ванильными, и кнопки, чтобы это исправить, не было (жалоба sonka 2026-11-15 «музыка из меню и редактора не изменились»).
// Порядок: меню, редактор, экраны, праздники. Файлов нет в каталоге (старый tracks.json) - группы в окне нет.
function menuGroupFiles(){
    let out = [], sl = tracksData.slots || {}, sp = tracksData.special || {}, hol = tracksData.holidays || {};
    let add = n => { if (n && tracksData.files[n] != null && out.indexOf(n) < 0) out.push(n); };
    let k = Object.keys(sl);
    for (let i = 0; i < k.length; i++) add(sl[k[i]]);
    k = Object.keys(sp);
    for (let i = 0; i < k.length; i++) add(sp[k[i]]);
    k = Object.keys(hol);
    for (let i = 0; i < k.length; i++) add(hol[k[i]] && hol[k[i]].file);
    return out;
}

// группы для окна загрузки: меню/редактор, сложности секторов, стражи, затишье
function packGroups(){
    let groups = [];
    let mf = menuGroupFiles();
    if (mf.length > 0) groups.push({id: "menu", tracks: [], files: mf});
    for (let i = 0; i < POOL_TIERS.length; i++) groups.push({id: POOL_TIERS[i], tracks: tracksData.tiers[POOL_TIERS[i]]});
    groups.push({id: "guardians", tracks: bossThemeIds()});
    groups.push({id: "peace", tracks: tracksData.peace});
    if (tracksData.pvp.length > 0) groups.push({id: "pvp", tracks: tracksData.pvp});
    return groups;
}

function groupFileNames(g){
    if (g.files != null) return g.files.slice(); // явный список файлов (группа меню/редактора), без треков каталога
    let out = [];
    for (let i = 0; i < g.tracks.length; i++) {
        let names = trackFileNames(g.tracks[i]);
        for (let j = 0; j < names.length; j++) if (out.indexOf(names[j]) < 0) out.push(names[j]);
    }
    return out;
}

// ---------- загрузчик ----------
// <downloader>
// Скачивание идёт по одному файлу, в потоке Http; в главный поток всё возвращается через Core.app.post.
// Файл пишется в имя.part, считается SHA-1, и только после совпадения размера и sha1 с каталогом
// переименовывается в имя — недокачанный/битый файл никогда не попадёт в игру.
// Ссылки на вики содержат хэш ревизии (?e72dce = начало sha1), то есть файл по ссылке не меняется.

const dl = {
    queue: [],        // имена файлов, ждущих скачивания
    current: null,    // {name, part, total, startedAt}
    fails: {},        // имя -> число неудач подряд (после 3 автоматически больше не пробуем)
    retryAt: 0,       // не стартовать новую загрузку раньше этого момента (мс)
    done: 0,          // сколько файлов скачано за сессию
    lastError: null
};

function downloadable(name){
    let m = tracksData.files[name];
    return m != null && !!m.url;
}

function isPending(name){
    return (dl.current != null && dl.current.name == name) || dl.queue.indexOf(name) >= 0;
}

// front = true: срочно (нужно прямо сейчас), ставим в начало очереди с сохранением порядка.
// force = true: пользователь нажал кнопку — сбрасываем счётчик неудач этих файлов.
function enqueue(names, front, force){
    let added = 0;
    let list = front ? names.slice().reverse() : names;
    for (let i = 0; i < list.length; i++) {
        let n = list[i];
        if (!downloadable(n)) continue;
        if (force) delete dl.fails[n];
        if (fileOk(n) || (dl.fails[n] || 0) >= 3) continue;
        if (dl.current != null && dl.current.name == n) continue;
        let at = dl.queue.indexOf(n);
        if (at >= 0) {
            if (front && at > 0) { dl.queue.splice(at, 1); dl.queue.unshift(n); }
            continue;
        }
        if (front) dl.queue.unshift(n); else dl.queue.push(n);
        added++;
    }
    if (DEBUG && (added > 0 || force)) dbg("ОЧЕРЕДЬ: +" + added + (front ? " (срочно)" : "") + (force ? " (по кнопке)" : "") + ", в очереди теперь " + dl.queue.length + ": " + names.slice(0, 6).join(", ") + (names.length > 6 ? " ..." : ""));
    pumpDownloads();
    return added;
}

function pumpDownloads(){
    if (dl.current != null || dl.queue.length == 0) return;
    if (Time.millis() < dl.retryAt) return;
    startDownload(dl.queue.shift());
}

function startDownload(name){
    let m = tracksData.files[name];
    let part = cacheDir().child(name + ".part");
    let cur = {name: name, part: part, total: m.bytes, startedAt: Time.millis()};
    dl.current = cur;
    if (DEBUG) dbg("СКАЧИВАНИЕ старт: " + name + " (ждём " + m.bytes + " байт) " + m.url + "  [попытка " + ((dl.fails[name] || 0) + 1) + ", осталось в очереди " + dl.queue.length + "]");
    try {
        if (part.exists()) part.delete();
        let req = Http.get(m.url);
        // timeout — и числовое ПОЛЕ, и метод HttpRequest; Rhino отдаёт поле и закрывает им метод
        // ("timeout is not a function, it is number"), поэтому задаём поле. 30 с и на соединение,
        // и на паузу между пакетами (по умолчанию 2 с); общее время загрузки не ограничено.
        req.timeout = 30000;
        req.header("User-Agent", HTTP_UA)
            .redirects(true)
            .error(err => {
                // в отладке берём полный текст со стеком и «Caused by» (UnknownHostException, SSL...): по голому String(err) причины не видно
                let text = DEBUG ? dbgErrText(err) : String(err);
                Core.app.post(() => downloadFailed(cur, text));
            })
            .submit(res => { downloadBody(cur, res); });
    } catch (e) {
        downloadFailed(cur, DEBUG ? dbgErrText(e) : String(e));
    }
}

// ВЫПОЛНЯЕТСЯ В ПОТОКЕ ЗАГРУЗКИ. Здесь только Java-вызовы, никакой игровой логики.
function downloadBody(cur, res){
    let sha = null, err = null;
    try {
        if (DEBUG) {
            let ct = null, cl = -1;
            try { ct = res.getHeader("Content-Type"); } catch (e1) {}
            try { cl = Number(res.getContentLength()); } catch (e2) {}
            dbgPost("СКАЧИВАНИЕ ответ: " + cur.name + " HTTP " + res.getStatus() + ", тип=" + ct + ", длина=" + cl + " (ждали " + cur.total + "), за " + (Time.millis() - cur.startedAt) + " мс");
        }
        if (String(res.getStatus()) != "OK") throw new Error("HTTP " + res.getStatus());
        let md = Packages.java.security.MessageDigest.getInstance("SHA-1");
        let input = new Packages.java.security.DigestInputStream(res.getResultAsStream(), md);
        let out = cur.part.write(false);
        try { Streams.copy(input, out); }
        finally { out.close(); input.close(); }
        sha = String(new Packages.java.math.BigInteger(1, md.digest()).toString(16));
        while (sha.length < 40) sha = "0" + sha;
    } catch (e) {
        err = DEBUG ? dbgErrText(e) : String(e);
    }
    Core.app.post(() => { if (err != null) downloadFailed(cur, err); else downloadFinished(cur, sha); });
}

function downloadFinished(cur, sha){
    let m = tracksData.files[cur.name];
    try {
        let len = Number(cur.part.length());
        if (len != m.bytes) throw new Error("размер " + len + " вместо " + m.bytes);
        if (sha != m.sha1) throw new Error("не сошлась контрольная сумма SHA-1 (получили " + sha + ", в каталоге " + m.sha1 + ")");
        let dest = cacheDir().child(cur.name);
        if (dest.exists()) dest.delete();
        // Fi.moveTo в Arc = копирование + удаление: файл ~10 МБ копировался бы в главном потоке (на медленном
        // диске / под антивирусом это заметный фриз). Переименование в той же папке мгновенное.
        let moved = false;
        try { moved = !!cur.part.file().renameTo(dest.file()); } catch (e1) { moved = false; }
        if (!moved) cur.part.moveTo(dest);
    } catch (e) {
        downloadFailed(cur, DEBUG ? dbgErrText(e) : String(e));
        return;
    }
    delete dl.fails[cur.name];
    forgetFileState(cur.name);
    unloadMusic(cur.name);
    dl.current = null;
    dl.done++;
    ulog.info("[ULTRAdustry] скачан " + cur.name + " (" + Math.round(Number(m.bytes) / 1024) + " КБ, " + (Time.millis() - cur.startedAt) + " мс)");
    pumpDownloads();
}

function downloadFailed(cur, msg){
    if (DEBUG) {
        // вместо ogg вики могла отдать страницу-заглушку: смотрим, что реально лежит в .part, пока его не стёрли
        dbgPeek(cur.part);
        dbg("СКАЧИВАНИЕ СБОЙ: " + cur.name + " за " + (Time.millis() - cur.startedAt) + " мс: " + msg);
        if (dbgFailProbes < 2) { dbgFailProbes++; dbgNetProbe("после сбоя скачивания #" + dbgFailProbes); }
    }
    try { if (cur.part.exists()) cur.part.delete(); } catch (e) {}
    if (dl.current !== cur) return; // этот запуск уже закрыт (не бывает, но на всякий случай)
    dl.current = null;
    dl.lastError = cur.name + ": " + msg;
    dl.fails[cur.name] = (dl.fails[cur.name] || 0) + 1;
    ulog.warn("[ULTRAdustry] не скачался " + cur.name + " (попытка " + dl.fails[cur.name] + "): " + (DEBUG ? String(msg).split("\n")[0] : msg));
    if (DEBUG && dl.fails[cur.name] >= 3) dbg("СКАЧИВАНИЕ: " + cur.name + " — 3 неудачи подряд, больше не пробуем до кнопки «Скачать» в окне «Музыка» или перезапуска");
    if (dl.fails[cur.name] < 3) {
        dl.queue.push(cur.name);                           // вернём в конец очереди
        dl.retryAt = Time.millis() + 5000 * dl.fails[cur.name]; // и подождём: 5 с, затем 10 с
    }
    pumpDownloads();
}

function cancelDownloads(){
    dl.queue.length = 0; // уже идущий файл доскачается сам (это секунды), остальные не стартуют
}
// </downloader>

function deleteDownloaded(){
    cancelDownloads();
    killAllVoices();
    releaseMusicSlots();
    let names = Object.keys(tracksData.files);
    for (let i = 0; i < names.length; i++) {
        if (!downloadable(names[i])) continue; // вручную положенные (Clair de Lune) не трогаем
        unloadMusic(names[i]);
        try {
            let f = cacheDir().child(names[i]);
            if (f.exists()) f.delete();
        } catch (e) { ulog.warn("[ULTRAdustry] не смог удалить " + names[i] + ": " + e); }
        forgetFileState(names[i]);
        delete dl.fails[names[i]];
    }
}

// ---------- аудио-потоки и открытие файлов ----------
//
// ПОЧЕМУ ТАК. Каждый вызов Music (setVolume, play, getPosition, stop...) берёт мьютекс звукового
// движка Soloud, а звуковой поток держит его, пока декодирует и смешивает. Файлы с вики имеют битрейт
// ~490 кбит/с (в 5 раз выше обычного ogg), поэтому такой вызов в главном потоке стоит ~1-2 мс, а
// всплесками до 20 мс — и в версии 2.0 мы звали setVolume у КАЖДОГО голоса КАЖДЫЙ кадр (плюс опрос
// позиции интро): кадры рвались, даже когда всё уже скачано. Открытие файла (new Music) — ещё ~170 мс
// плюс копия файла в кэш Arc, и тоже в главном потоке.
// Теперь ВСЕ вызовы Music идут в двух однопоточных исполнителях, а главный поток только раздаёт команды
// и принимает ответы через Core.app.post (как загрузчик):
//   audioLoader  — открыть файл (new Music + load + getLength): долго, но никому не мешает;
//   audioControl — play / stop / setVolume / dispose.
// Задачи на этих потоках трогают только свои Java-объекты и локальные значения, общее состояние мода
// (voices, scene, opened...) читает и пишет один главный поток.

let audioLoader = null;
let audioControl = null;
let audioThreadsFailed = false;

function makeAudioThread(label){
    return Packages.java.util.concurrent.Executors.newSingleThreadExecutor(r => {
        let t = new Packages.java.lang.Thread(r, label);
        t.setDaemon(true); // не держит выход из игры
        // без своего обработчика необработанная ошибка в потоке ушла бы в общий и уронила бы игру
        t.setUncaughtExceptionHandler((th, ex) => { ulog.err("[ULTRAdustry] сбой аудио-потока " + label + ": " + ex); });
        return t;
    });
}

function ensureAudioThreads(){
    if (audioControl != null || audioThreadsFailed) return;
    try {
        audioLoader = makeAudioThread("ULTRAdustry-loader");
        audioControl = makeAudioThread("ULTRAdustry-audio");
    } catch (e) {
        // запасной путь: выполняем всё в главном потоке, как в 2.0 — работает, но с лагами
        audioThreadsFailed = true;
        audioLoader = null;
        audioControl = null;
        ulog.err("[ULTRAdustry] не создал аудио-потоки (" + e + "), музыка будет играть из главного потока");
    }
}

function runAudio(ex, fn){
    if (ex == null) {
        try { fn(); } catch (e) { ulog.warn("[ULTRAdustry] аудио: " + e); }
        return;
    }
    ex.execute(() => {
        try { fn(); } catch (e) { ulog.warn("[ULTRAdustry] аудио-поток: " + e); }
    });
}

// Открытие файла в Music. ВАЖНО: перегрузка Music.load(Fi, boolean) («читать прямо с диска, без копии в кэше Arc») есть ТОЛЬКО
// в Arc форка клиента. В официальной игре (Steam и т.п.; так было у игрока с официальной сборкой: build 160.7, журнал отладочной сборки
// 2026-11-15) её нет: "Can't find method arc.audio.Music.load(...,boolean)" - и НИ ОДИН трек не открывался (32 из 32), мод
// молчал целиком. В официальном Arc есть только load(Fi): он сам копирует файл в кэш Arc (во временную папку ОС; один раз,
// повторно не копирует, если размер тот же) и читает копию. Нам это подходит: тот же результат, только +1 копия на диске.
// Поэтому: первый раз пробуем load(fi, direct); если такого метода нет - запоминаем и дальше зовём load(fi). Любую другую
// ошибку (нет файла, битый ogg) пробрасываем как есть, чтобы не маскировать настоящие сбои.
// ЗАВИСАНИЯ НА ПЕТЛЕ (жалоба sonka 2026-11-15 «при зацикливании треков небольшие зависания»). Замерено на настоящем Soloud (SoLoud
// 20260903 + MiniAudio, ogg ≈510 кбит/с как на вики): у голоса, открытого с ДИСКА (load(Fi) / load(Fi, boolean)), ПЕРВЫЙ перезапуск
// петли после каждого play() занимает ≈150 мс (при 4 голосах ≈325 мс) и держит мьютекс микшера: встают ВСЕ вызовы Soloud с главного
// потока (кадр, звуки выстрелов) и сам звук (следующий перезапуск наступает через 6,15 с вместо 6,0 у 6-секундного клипа). Остальные
// перезапуски чистые (1-8 мс); стоимость не зависит ни от битрейта, ни от длины трека, она на каждый play(), в том числе при повторном
// play() того же Music. Причина - диск: под strace видно по сотне тысяч lseek(0)/lseek(конец файла) в секунду, декодер читает файл
// через обёртку, которая на каждый запрос прыгает в конец и обратно. Тот же файл, загруженный из ПАМЯТИ (Music.load(byte[]) =
// Soloud.streamLoadBytes, одинаково в официальном Arc 159.7 и в форке), этого не делает: перезапуск петли 0,0-0,5 мс, период ровно
// 6,00 с, обычный вызов 0,01 мс вместо 0,5-10 мс, open 9 мс вместо ≈172, play() 0,6 мс вместо 11-17. Цена: нативная память
// ≈ размер файла (18 МБ ogg -> +23 МБ RSS, куча Java не растёт), поэтому держим открытыми не больше OPEN_BYTES_BUDGET (pruneLoaded).
// Порядок: load(byte[]) -> load(Fi, boolean) (форк) -> load(Fi) (старый официальный Arc, где нет и byte[]; в v146 нет). Настоящую
// ошибку (нет файла, битый ogg) пробрасываем как есть: «Can't find method» - единственный признак отсутствия перегрузки.
let memLoadOk = null;        // null - ещё не проверяли, true - есть load(byte[]), false - нет (идём старым путём)
let directLoadOk = null;     // null - ещё не проверяли, true - есть load(Fi, boolean), false - только load(Fi)
// true - файл открыт из памяти (весит в нативной памяти), false - с диска
function loadMusicFile(mus, fi, direct){
    if (memLoadOk === null) {
        // в отладочной сборке старый путь можно включить принудительно (сравнение/проверка отката): ultradustry-dbg-nomem
        memLoadOk = !(DEBUG && Core.settings.getBool("ultradustry-dbg-nomem", false));
        if (DEBUG) dbg("ОТКРЫТИЕ: файлы читаются " + (memLoadOk ? "ИЗ ПАМЯТИ, load(byte[]) (без зависания на первой петле), при отсутствии метода перейду на чтение с диска" : "с диска (память отключена настройкой ultradustry-dbg-nomem)"));
    }
    if (memLoadOk) {
        let bytes = fi.readBytes(); // ошибка чтения (нет файла) уходит наверх как есть
        try { mus.load(bytes); return true; }
        catch (e) {
            if (String(e).indexOf("Can't find method") < 0) throw e;
            memLoadOk = false;
            ulog.info("[ULTRAdustry] в этом Arc нет Music.load(byte[]): открываю файлы с диска (на первой петле каждого трека возможен рывок ~150 мс)");
        }
    }
    // в отладочной сборке путь «официального Arc» можно включить принудительно (проверка на форке): ultradustry-dbg-nodirect
    if (directLoadOk === null) {
        directLoadOk = !(DEBUG && Core.settings.getBool("ultradustry-dbg-nodirect", false));
        if (DEBUG) dbg("ОТКРЫТИЕ: способ чтения файлов - " + (directLoadOk ? "load(Fi, boolean) (напрямую с диска), при отсутствии метода перейду на load(Fi)" : "load(Fi) (с копией в кэш Arc; включено принудительно настройкой ultradustry-dbg-nodirect)"));
    }
    if (directLoadOk) {
        try { mus.load(fi, direct); return false; }
        catch (e) {
            if (String(e).indexOf("Can't find method") < 0) throw e;
            directLoadOk = false;
            ulog.info("[ULTRAdustry] в этом Arc нет Music.load(Fi, boolean) (официальная сборка игры): открываю через load(Fi), файлы копируются в кэш Arc");
        }
    }
    mus.load(fi);
    return false;
}

// имя файла -> {name, music, state: 0 открывается | 1 готов | -1 не открылся, length (с), dead, memBytes (сколько весит в памяти)}
const opened = {};

// Состояние файла для вызывающего: 1 — готов играть, 0 — открывается (повторить в следующем кадре),
// -1 — играть нельзя. Первый вызов запускает открытие в фоне.
function ensureOpen(name){
    let r = opened[name];
    if (r != null) return r.state;
    if (!fileOk(name)) return -1;
    let m = fileMeta(name);
    let fi = null;
    try { fi = cacheDir().child(name); } catch (e) { fi = null; }
    if (fi == null) {
        ulog.warn("[ULTRAdustry] не нашёл файл " + name);
        badFiles[name] = true;
        return -1;
    }
    ensureAudioThreads();
    let rec = {name: name, music: null, state: 0, length: 0, dead: false};
    opened[name] = rec;
    if (DEBUG) dbg("ОТКРЫТИЕ старт: " + name + " <- " + dbgPath(fi.absolutePath()) + " (" + fi.length() + " байт на диске)" + ", потоки " + (audioThreadsFailed ? "ГЛАВНЫЙ (аудио-потоки не создались)" : "отдельные"));
    // с диска напрямую (load(fi, true)): Music(Fi) сперва копирует файл в кэш Arc (в официальном Arc прямого чтения нет, см. loadMusicFile);
    // но по умолчанию файл читается в память целиком (load(byte[])) - см. комментарий у loadMusicFile
    let direct = true;
    let fileBytes = m != null ? Number(m.bytes) || 0 : 0;
    runAudio(audioLoader, () => {
        let mus = null, len = 0, err = null, inMemory = false;
        let t0 = DEBUG ? Number(Time.millis()) : 0;
        try {
            mus = new Music();
            inMemory = loadMusicFile(mus, fi, direct);
        } catch (e) { err = DEBUG ? dbgErrText(e) : String(e); mus = null; }
        if (mus != null) { try { len = Number(mus.getLength()); } catch (e2) { len = 0; } }
        let took = DEBUG ? Number(Time.millis()) - t0 : 0;
        Core.app.post(() => openDone(rec, mus, len, err, took, inMemory ? fileBytes : 0));
    });
    return 0;
}

function openDone(rec, mus, len, err, took, memBytes){
    if (DEBUG) dbg("ОТКРЫТИЕ итог: " + rec.name + " -> " + (mus != null ? "открыт за " + took + " мс, длина " + fixed(len, 1) + " с" + (rec.dead ? " (но уже выгружен)" : "") + (len > 0 && len < 1e6 ? "" : "  <<< ДЛИНА НЕПОНЯТНАЯ (0 или огромная): файл не декодируется?") : "НЕ ОТКРЫЛСЯ: " + err));
    if (rec.dead) { // пока открывался, файл успели выгрузить (перекачка, удаление)
        if (mus != null) disposeMusic(mus);
        return;
    }
    if (mus == null) {
        ulog.warn("[ULTRAdustry] не смог открыть " + rec.name + ": " + (DEBUG ? String(err).split("\n")[0] : err));
        if (DEBUG) { let mm = fileMeta(rec.name); if (mm != null) dbgPeek(cacheDir().child(rec.name)); }
        badFiles[rec.name] = true;
        rec.state = -1;
        if (opened[rec.name] === rec) delete opened[rec.name];
        return;
    }
    rec.music = mus;
    rec.length = (len > 0 && len < 1e6) ? len : 0;
    rec.state = 1;
    rec.memBytes = Number(memBytes) || 0; // сколько файл весит в нативной памяти (0 - читается с диска)
    pruneLoaded();
}

function disposeMusic(mus){
    runAudio(audioControl, () => {
        try { mus.stop(); } catch (e) {}
        try { mus.dispose(); } catch (e2) { ulog.warn("[ULTRAdustry] не смог освободить трек: " + e2); }
    });
}

// Освободить файл (перед удалением / после перекачки / когда открытых слишком много).
function unloadMusic(name){
    let rec = opened[name];
    if (rec == null) return;
    delete opened[name];
    rec.dead = true;
    delete voices[name]; // Music под голосом ниже остановит и освободит disposeMusic
    if (rec.music != null) disposeMusic(rec.music);
}

// ---------- окно "Музыка" (Настройки -> ULTRAdustry -> Музыка) ----------

let packDialog = null;
let packBody = null;
let packSig = "";

function groupStat(g){
    let names = groupFileNames(g);
    let have = 0, total = 0, missingBytes = 0, manual = 0;
    for (let i = 0; i < names.length; i++) {
        let m = fileMeta(names[i]);
        if (!m.url) { manual++; continue; }
        total++;
        if (fileOk(names[i])) have++; else missingBytes += m.bytes;
    }
    return {names: names, have: have, total: total, missingBytes: missingBytes, manual: manual};
}

function mb(bytes){ return Math.max(1, Math.round(bytes / 1000000)); }

function packSignature(){
    return dl.queue.length + "|" + (dl.current ? dl.current.name : "") + "|" + dl.done + "|" + Object.keys(dl.fails).length;
}

function progressText(){
    let s;
    if (dl.current != null) {
        let pct = 0;
        try { pct = Math.min(99, Math.floor(Number(dl.current.part.length()) * 100 / dl.current.total)); } catch (e) {}
        s = bundleText("ultradustry.pack.active", dl.current.name, pct, dl.queue.length);
    } else if (dl.queue.length > 0) {
        s = bundleText("ultradustry.pack.waiting", dl.queue.length);
    } else {
        s = bundleText("ultradustry.pack.idle");
    }
    if (dl.lastError != null) s += "\n" + bundleText("ultradustry.pack.error", dl.lastError);
    return s;
}

// «Сейчас играет из мода: меню - slot-menu.ogg; редактор - ванильная»: видно, подставился ли скачанный файл в слот
function slotStatusText(){
    let van = bundleText("ultradustry.pack.slot.vanilla");
    let m = slotState.menu, e = slotState.editor;
    return bundleText("ultradustry.pack.slots", m != null ? m.name : van, e != null ? e.name : van);
}

function rebuildPack(){
    let t = packBody;
    t.clearChildren();
    packSig = packSignature();
    let width = Math.min(Core.graphics.getWidth() * 0.9, 760);
    t.defaults().pad(4);

    t.add(bundleText("ultradustry.pack.info")).wrap().width(width).left().row();
    t.add(bundleText("ultradustry.pack.folder", cacheDir().absolutePath())).wrap().width(width).left().color(Pal.lightishGray).row();
    t.label(() => progressText()).wrap().width(width).left().row();
    // что реально играет в меню и редакторе прямо сейчас (живая строка: подмена случается через пару секунд после скачивания)
    if (menuGroupFiles().length > 0) t.label(() => slotStatusText()).wrap().width(width).left().color(Pal.lightishGray).row();

    let allMissing = 0;
    let groups = packGroups();
    let rows = new Table();
    for (let i = 0; i < groups.length; i++) {
        let g = groups[i];
        let st = groupStat(g);
        allMissing += st.missingBytes;
        rows.add(bundleText("ultradustry.pack.group." + g.id)).left().growX().wrap().minWidth(width * 0.45);
        rows.add(st.total == 0 ? "" : (st.missingBytes == 0 ? bundleText("ultradustry.pack.ready", st.have, st.total)
                : bundleText("ultradustry.pack.partial", st.have, st.total, mb(st.missingBytes)))).left().padLeft(12).padRight(12);
        let names = st.names;
        let btn = rows.button(st.missingBytes == 0 ? bundleText("ultradustry.pack.done") : bundleText("ultradustry.pack.download"),
            () => { enqueue(names, false, true); rebuildPack(); }).width(150).height(40).get();
        btn.setDisabled(st.missingBytes == 0);
        rows.row();
    }
    t.add(rows).left().row();

    let bar = new Table();
    let allBtn = bar.button(bundleText("ultradustry.pack.all", mb(allMissing)), () => {
        let all = [];
        for (let i = 0; i < groups.length; i++) {
            let names = groupFileNames(groups[i]);
            for (let j = 0; j < names.length; j++) if (all.indexOf(names[j]) < 0) all.push(names[j]);
        }
        enqueue(all, false, true);
        rebuildPack();
    }).width(260).height(44).get();
    allBtn.setDisabled(allMissing == 0);
    bar.button(bundleText("ultradustry.pack.cancel"), () => { cancelDownloads(); rebuildPack(); }).width(180).height(44).padLeft(8)
        .get().setDisabled(dl.queue.length == 0);
    bar.button(bundleText("ultradustry.pack.delete"), () => {
        Vars.ui.showConfirm(bundleText("ultradustry.pack.delete.title"), bundleText("ultradustry.pack.delete.confirm"), () => {
            deleteDownloaded();
            rebuildPack();
        });
    }).width(260).height(44).padLeft(8);
    t.add(bar).left().row();

    t.add(bundleText("ultradustry.pack.manual")).wrap().width(width).left().color(Pal.lightishGray).row();
}

function showPackDialog(){
    if (tracksData == null) { Vars.ui.showInfo(bundleText("ultradustry.pack.notracks")); return; }
    if (packDialog == null) {
        packDialog = new BaseDialog(bundleText("ultradustry.pack.title"));
        packDialog.addCloseButton();
        packBody = new Table();
        let pane = new ScrollPane(packBody);
        pane.setScrollingDisabled(true, false);
        packDialog.cont.add(pane).grow();
        // перерисовываем список, когда меняется очередь/число скачанного; полоска прогресса — отдельный label
        packDialog.update(() => { if (packSignature() != packSig) { fileOkMemo = {}; rebuildPack(); } });
    }
    fileOkMemo = {}; // вдруг пользователь что-то положил/удалил руками
    badFiles = {};
    rebuildPack();
    packDialog.show();
}

// Кнопка в категории настроек. Обычный table.button() в категории выключает у неё строку поиска
// (форк не умеет искать по чужим элементам), поэтому оформляем кнопку как настоящий Setting.
function addPackButton(table){
    try {
        let setting = extend(SettingsMenuDialog.SettingsTable.Setting, "ultradustry-musicpack", {
            add: function(t){
                t.button(bundleText("ultradustry.pack.open"), () => showPackDialog()).growX().height(50).pad(6).row();
            }
        });
        table.pref(setting);
    } catch (e) {
        ulog.warn("[ULTRAdustry] кнопка-настройка не создалась (" + e + "), ставлю обычную");
        table.row();
        table.button(bundleText("ultradustry.pack.open"), () => showPackDialog()).growX().height(50).pad(6).row();
    }
}

// Выбор юнита главного меню. Раньше «Выбрать юнита / Случайный юнит» стояли ссылками под юнитом в терминальном меню
// (и картинка была кликабельной); управление перенесено в настройки мода, чтобы меню оставалось чистым.
// Выбор лежит в той же настройке SETTING_UNIT_PICK, поэтому меню подхватывает смену само (figTick / виджет стандартного меню
// сравнивают закреплённое имя с показанным юнитом каждый кадр) - колбэк после выбора не нужен.
function unitPickStatusText(){
    let cur = menuPickedName();
    if (cur != "") {
        let list = menuUnitList();
        for (let i = 0; i < list.length; i++) {
            if (String(list[i].name) == cur) return bundleText("ultradustry.unit.pick.now", list[i].localizedName);
        }
        // закреплённого юнита больше нет (убрали мод / он стал скрытым) - меню тихо работает как «случайный», пишем то же
    }
    return bundleText("ultradustry.unit.pick.random");
}

function buildUnitPickRows(t){
    let title = new Label(bundleText("ultradustry.unit.pick.title"));
    t.add(title).left().padTop(10).padLeft(6).row();
    let status = new Label(unitPickStatusText());
    status.setColor(Color.valueOf(TERM_ORANGE));
    // подпись обновляется на лету: окно выбора закрывается поверх настроек, и нажатие «Случайный юнит» тоже меняет режим тут же
    let shownName = menuPickedName();
    status.update(() => {
        let nm = menuPickedName();
        if (nm === shownName) return;
        shownName = nm;
        status.setText(unitPickStatusText());
    });
    t.add(status).left().padLeft(6).row();
    let row = new Table();
    row.button(bundleText("ultradustry.unit.pick"), () => showUnitPicker(null)).growX().height(50).pad(6);
    row.button(bundleText("ultradustry.unit.random"), () => setMenuPickedName("")).growX().height(50).pad(6);
    t.add(row).growX().row();
}

function addUnitPickButtons(table){
    try {
        let setting = extend(SettingsMenuDialog.SettingsTable.Setting, "ultradustry-unitpick", {
            add: function(t){ buildUnitPickRows(t); }
        });
        table.pref(setting);
    } catch (e) {
        ulog.warn("[ULTRAdustry] блок выбора юнита в настройках не создался (" + e + "), ставлю обычный");
        table.row();
        buildUnitPickRows(table);
    }
}

// ---------- праздники ULTRAKILL ----------
// В самой игре в эти дни меняется заставка меню (подзаголовок «HAPPY HALLOWEEN» и т.п.) и играет праздничная The Fire Is Gone
// (по вики ULTRAKILL, «Seasonal Events»): Хэллоуин 25-31 октября, Рождество 22-28 декабря, Пасха — от Страстной пятницы до
// воскресенья (дата Пасхи считается как в игре — по западному календарю). Файлы праздничных версий скачиваются, как и все
// остальные (tracks.json -> holidays), и встают на место музыки меню через слот menu (см. «слоты музыки» ниже).

const HOLIDAY_IDS = ["halloween", "christmas", "easter"];   // порядок = значения 2, 3, 4 у настройки ultradustry-menu-holiday

// Пасха по григорианскому календарю (алгоритм Мейуса-Джонса-Батчера): {month: 1-12, day}
function easterSunday(year){
    let a = year % 19, b = Math.floor(year / 100), c = year % 100;
    let d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    let h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    let l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    let t = h + l - 7 * m + 114;
    return {month: Math.floor(t / 31), day: (t % 31) + 1};
}

// Какой праздник приходится на дату (год, месяц 1-12, день), либо null
function holidayOn(year, month, day){
    if (month == 10 && day >= 25 && day <= 31) return "halloween";
    if (month == 12 && day >= 22 && day <= 28) return "christmas";
    let es = easterSunday(year);
    let at = Date.UTC(year, month - 1, day), sunday = Date.UTC(year, es.month - 1, es.day);
    let diff = Math.round((sunday - at) / 86400000);     // дней до пасхального воскресенья
    return (diff >= 0 && diff <= 2) ? "easter" : null;   // воскресенье, суббота, Страстная пятница
}

// Текущий праздник с учётом настройки: 0 по дате, 1 без праздников, 2-4 принудительно
function holidayToday(){
    let force = Core.settings.getInt(SETTING_HOLIDAY, 0);
    if (force == 1) return null;
    if (force >= 2 && force <= 4) return HOLIDAY_IDS[force - 2];
    let now = new Date();
    return holidayOn(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// ---------- слоты музыки: меню и редактор карт ----------
// Музыку главного меню и редактора играет сам движок (SoundControl: каждый кадр play(Musics.menu) / play(Musics.editor)),
// а в моде файлов нет совсем. Поэтому в эти статические поля подставляем скачанные треки, и SoundControl сам плавно
// перейдёт на них. Что подставлять: tracks.json -> slots.<поле>, а для menu в праздничные дни - holidays.<id>.file.
// Пока файла нет на диске, играет ванильный трек; скачался - подменяем на лету (проверка раз в SLOT_CHECK_SECONDS),
// перезапуск не нужен. Музыка запуска/посадки на планету и «fine» остаются ванильными: их Music запоминают объекты
// планет и ядер при создании, подменить их из мода нельзя.
const SLOT_FIELDS = ["menu", "editor"];
const SLOT_CHECK_SECONDS = 2;
let slotAcc = 1e9;
let slotState = {};     // поле -> {name, music, vanilla}: что мы поставили в Musics.<поле> и какой Music стоял там до нас
let slotOpening = {};   // поле -> имя файла, который сейчас открывается в фоне
let slotAsked = {};     // поле -> имя файла, который уже просили скачать (повторно не просим, пока не сменится)

function musicsClass(){ return (typeof Musics !== "undefined") ? Musics : Packages.mindustry.gen.Musics; }

function slotWantedFile(field){
    if (tracksData == null) return null;
    if (field == "menu") {
        let h = holidayToday();
        let hm = h == null ? null : tracksData.holidays[h];
        if (hm != null && hm.file && fileMeta(hm.file) != null) return hm.file;
    }
    let n = tracksData.slots[field];
    return (n && fileMeta(n) != null) ? n : null;
}

// Раз в SLOT_CHECK_SECONDS (и при старте): если нужный файл слота скачан, а в поле стоит что-то другое - открываем его в
// фоне и подставляем; если не скачан - просим скачать (один раз на имя файла, при включённой автозагрузке).
function applyMusicSlots(){
    if (tracksData == null) return;
    // musicvol = 0 при старте игры: Musics.load() тогда не грузил ванильные треки и сделает это позже ПРЯМО В ТЕКУЩИЕ
    // объекты полей - подставленный нами Music был бы затёрт ванильным файлом. При нулевой громкости не трогаем ничего.
    if (Core.settings.getInt("musicvol", 100) == 0) return;
    for (let i = 0; i < SLOT_FIELDS.length; i++) {
        let field = SLOT_FIELDS[i];
        let name = slotWantedFile(field);
        if (name == null) continue;
        let st = slotState[field];
        if ((st != null && st.name == name) || slotOpening[field] == name) continue;
        if (!fileOk(name)) {
            if (isAutoDownload() && slotAsked[field] != name) { slotAsked[field] = name; enqueue([name], false); }
            continue;
        }
        openSlot(field, name);
    }
}

function openSlot(field, name){
    let fi = null;
    try { fi = cacheDir().child(name); } catch (e) { fi = null; }
    if (fi == null) return;
    slotOpening[field] = name;
    ensureAudioThreads();
    runAudio(audioLoader, () => {
        let mus = null, err = null;
        try { mus = new Music(); loadMusicFile(mus, fi, true); } catch (e) { err = String(e); mus = null; }
        Core.app.post(() => slotOpened(field, name, mus, err));
    });
}

function slotOpened(field, name, mus, err){
    if (slotOpening[field] == name) delete slotOpening[field];
    if (mus == null) {
        ulog.warn("[ULTRAdustry] музыка слота " + field + " (" + name + ") не открылась: " + err);
        badFiles[name] = true; // иначе проверка раз в 2 с долбилась бы в тот же файл
        return;
    }
    // пока файл открывался, нужный файл мог смениться (поменяли праздник в настройках) или файлы удалили кнопкой
    if (slotWantedFile(field) != name || !fileOk(name)) { disposeMusic(mus); return; }
    try {
        let M = musicsClass();
        let old = slotState[field];
        let vanilla = old != null ? old.vanilla : M[field];
        M[field] = mus;
        slotState[field] = {name: name, music: mus, vanilla: vanilla};
        // прежний наш Music (если праздник сменили) не выгружаем: SoundControl мог ещё его затухать, а вызов у выгруженного опасен
        ulog.info("[ULTRAdustry] музыка слота " + field + ": " + name);
    } catch (e2) {
        ulog.warn("[ULTRAdustry] не смог подменить Musics." + field + ": " + e2);
        disposeMusic(mus);
    }
}

// «Удалить скачанное»: возвращаем ванильные Music на место, чтобы движок не играл файл, которого уже нет на диске.
// Наши Music не выгружаем (SoundControl мог держать один из них как текущий и сейчас затухает его).
function releaseMusicSlots(){
    let keys = Object.keys(slotState);
    for (let i = 0; i < keys.length; i++) {
        try { musicsClass()[keys[i]] = slotState[keys[i]].vanilla; } catch (e) { ulog.warn("[ULTRAdustry] не смог вернуть ванильный Musics." + keys[i] + ": " + e); }
    }
    slotState = {};
    slotOpening = {};
}

// При запуске игры (до всякого сектора) докачиваем то, без чего мод выглядит «пустым»: музыку меню, три экранные темы
// (схемы/база данных/исследования), музыку редактора. Всё мелкое (~8 МБ вместе), порядок: меню, экраны, редактор.
function prefetchStartup(){
    if (!isAutoDownload()) return;
    let names = [], sp = tracksData.special;
    let m = slotWantedFile("menu");
    if (m != null) names.push(m);
    let k = Object.keys(sp);
    for (let i = 0; i < k.length; i++) names.push(sp[k[i]]);
    let e = slotWantedFile("editor");
    if (e != null) names.push(e);
    enqueue(names, false);
}

// Приветствие: мод не хранит треки в себе, и человек, поставивший его впервые, должен знать, где их взять. Показываем
// один раз, и только если на диске ещё нет ни одного трека каталога (у тех, кто уже пользуется модом, окно не нужно).
const SETTING_WELCOME_SEEN = "ultradustry-welcome-seen";

function maybeShowWelcome(){
    if (Core.settings.getBool(SETTING_WELCOME_SEEN, false)) return;
    let names = Object.keys(tracksData.files);
    for (let i = 0; i < names.length; i++) if (downloadable(names[i]) && fileOk(names[i])) { Core.settings.put(SETTING_WELCOME_SEEN, true); return; }
    Core.settings.put(SETTING_WELCOME_SEEN, true); // показали - больше не показываем, даже если окно закрыли крестиком
    let dlg = new BaseDialog(bundleText("ultradustry.welcome.title"));
    let tw = 520;   // ширина текста в единицах Cell: не шире 85% экрана (на телефоне экран уже 560), если размер сцены не узнали - 520
    try { tw = Math.min(560, Core.scene.getWidth() * 0.85 / uiScl()); } catch (eS) { tw = 520; }
    dlg.cont.add(bundleText("ultradustry.welcome.text")).wrap().width(tw).left().row();
    dlg.buttons.defaults().size(240, 54).pad(4);
    dlg.buttons.button(bundleText("ultradustry.welcome.open"), () => { dlg.hide(); showPackDialog(); });
    dlg.buttons.button(bundleText("ultradustry.welcome.ok"), () => dlg.hide());
    dlg.show();
}

// ---------- запуск ----------

function onClientLoad(e){
    // отключаем встроенный реролл при начале волны — переключение полностью наше
    Vars.control.sound.musicWaveChance = 0;

    // очищаем ванильные списки, чтобы движок сам ничего не выбирал — управляем музыкой в игре
    // полностью вручную. bossMusic тоже: SoundControl запускает его через 8-15 с после волны со
    // стражем, и тогда поверх нашей темы стража заиграл бы ванильный boss1/boss2.
    Vars.control.sound.ambientMusic.clear();
    Vars.control.sound.darkMusic.clear();
    Vars.control.sound.bossMusic.clear();

    // настройки в меню Settings -> ULTRAdustry
    Vars.ui.settings.addCategory("ULTRAdustry", table => {
        if (DEBUG) addDebugButton(table);
        addPackButton(table);
        table.checkPref(SETTING_AUTODL, true);
        table.sliderPref(SETTING_PEACE_DELAY, 60, 10, 600, 10, i => i + " " + bundleText("ultradustry.unit.sec"));
        table.sliderPref(SETTING_BOSS_LEAD, BOSS_LEAD_DEFAULT_MS, 0, 2000, 50, i => i + " " + bundleText("ultradustry.unit.ms"));
        table.sliderPref(SETTING_THREAT_THRESHOLD, THREAT_THRESHOLD_DEFAULT, 1, 300, 1, i => i + " " + bundleText("ultradustry.threat.pts"));
        table.checkPref(SETTING_WAVE_SWITCH, true);
        table.checkPref(SETTING_TERMINAL, true);
        table.checkPref(SETTING_TERM_UNIT, true);
        table.sliderPref(SETTING_HOLIDAY, 0, 0, 4, 1, i => bundleText("ultradustry.holiday." + ["auto", "off"].concat(HOLIDAY_IDS)[i]));
        table.checkPref(SETTING_MENU_BG, true);
        table.checkPref(SETTING_MENU_UNIT, true);
        addUnitPickButtons(table);
    });

    let mod = getMod();
    if (mod == null) return;

    tracksData = loadTracksData(mod);
    if (tracksData != null) {
        let have = 0, total = 0;
        let names = Object.keys(tracksData.files);
        for (let i = 0; i < names.length; i++) {
            if (!downloadable(names[i])) continue;
            total++;
            if (fileOk(names[i])) have++;
        }
        ulog.info("[ULTRAdustry] каталог: " + total + " скачиваемых файлов, на диске " + have + ", папка " + cacheDir().absolutePath());
    }

    if (tracksData != null) {
        try { maybeShowWelcome(); } catch (eW) { ulog.warn("[ULTRAdustry] приветствие: " + eW); }
        try { prefetchStartup(); applyMusicSlots(); } catch (e2) { ulog.warn("[ULTRAdustry] музыка меню/редактора: " + e2); }
    }

    setupBgLayer(mod, 1, isMenuBgEnabled);
    // терминал строим всегда: включение/выключение настройки подхватывается на лету (см. root.update)
    try { setupTerminalMenu(mod); } catch (eT) { ulog.warn("[ULTRAdustry] терминальное меню не построилось: " + eT); }
    setupMenuUnitWidget();
}

Events.on(ClientLoadEvent, e => {
    if (!DEBUG) { onClientLoad(e); return; }
    // Отладочная сборка: после обработчика (в том числе упавшего посреди работы) пишем отчёт о системе. Ошибку пробрасываем
    // дальше, как в обычной сборке: отладка не должна менять поведение (в том числе падение).
    dbg("ClientLoadEvent: старт обработчика");
    try {
        onClientLoad(e);
        dbg("ClientLoadEvent: обработчик отработал без исключений");
    } catch (err) {
        dbg("ClientLoadEvent: ОБРАБОТЧИК УПАЛ: " + dbgErrText(err));
        try { dbgReport(); } catch (e2) {}
        throw err;
    }
    try { dbgReport(); } catch (e3) { dbg("отчёт при запуске упал: " + dbgErrText(e3)); }
});

// --- анимированный фон главного меню ---
// В оригинальном меню ULTRAKILL позади чёрный экран с «бегущими схемами» - дорожки платы медленно ползут вверх,
// будто мы падаем сквозь плату. Здесь то же самое на языке Mindustry: плата ЗАВОДА - чипы с подписями, узлы
// питания с лазерами и вертикальные конвейерные ленты, по которым бегут предметы настоящих цветов ресурсов.
//
// Как это устроено. Не покадровое видео (раньше было 26 jpg по 1600x900 - ступенчато и ~150 МБ видеопамяти), а три
// БЕСШОВНЫЕ плитки степени двойки (bg/net_far.png, net_near.png, net_items.png, генерирует gen_menu_bg.py из
// ~/projects/ultradustry-sources - с нуля, без чужих ассетов), которые мы гоним сдвигом UV-координат региона с режимом
// wrap=repeat. Слои едут с разной скоростью (параллакс): far - дальняя тусклая плата, near - основная, items -
// предметы на лентах; они обгоняют плату, поэтому именно «текут» по лентам, а не стоят на месте.
// Показ - тот же проверенный механизм Image + Texture (никакого своего draw()/Group.fill(DrawRect): такой слой
// у пользователя один раз молча не появился). Меняются только числовые поля региона u/v/u2/v2 - присваиванием
// полей, а не region.set(...): у set есть перегрузки (int,int,int,int) и (float,float,float,float), и Rhino на
// числах JS выбирает между ними неоднозначно.
//
// Масштаб привязан к высоте экрана (900 px = плитка в натуральную величину), поэтому на 720p и 1440p рисунок
// выглядит одинаково, а по ширине просто видно больше или меньше плиток.
const BG_LAYERS = [
    // vy - скорость сдвига в пикселях плитки в секунду (вверх); u0 - начальный сдвиг по горизонтали (доли плитки)
    {file: "net_far.png",   tw: 1024, th: 1024, vy: 12,  u0: 0.0,  breathe: 0.0},
    {file: "net_near.png",  tw: 2048, th: 1024, vy: 36,  u0: 0.13, breathe: 0.07},
    {file: "net_items.png", tw: 2048, th: 1024, vy: 170, u0: 0.13, breathe: 0.0}
];

// Общие часы слоёв: каждый слой зовёт bgTick() из своего update(), а время двигается один раз за кадр.
// Глитч (редкое короткое смещение слоёв в разные стороны) - в духе терминала ULTRAKILL.
const bgClock = {t: 0, frameId: -1, glitchAt: 7, glitchUntil: 0, glitchPx: 0};
function bgTick(){
    let fid = Number(Core.graphics.getFrameId());
    if (fid === bgClock.frameId) return;
    bgClock.frameId = fid;
    bgClock.t += Math.min(Time.delta, 12) / 60; // кламп: после лага не прыгать на полэкрана
    if (bgClock.t >= bgClock.glitchAt) {
        bgClock.glitchUntil = bgClock.t + 0.12;
        bgClock.glitchAt = bgClock.t + 9 + Math.random() * 14;
        bgClock.glitchPx = (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 24);
    }
}

// UV-окно слоя в момент t: какую часть плитки показываем, чтобы закрыть экран W x H.
function bgUv(L, W, H, t, glitchPx){
    let s = H / 900;
    let vw = W / (s * L.tw), vh = H / (s * L.th);
    let u0 = ((L.u0 + glitchPx / (s * L.tw)) % 1 + 1) % 1;
    let v0 = ((t * L.vy / L.th) % 1 + 1) % 1; // v растёт вниз по картинке -> окно едет вниз -> рисунок ползёт вверх
    return [u0, v0, u0 + vw, v0 + vh];
}

function loadBgLayer(mod, L){
    let f = mod.root.child("bg").child(L.file);
    if (!f.exists()) {
        ulog.warn("[ULTRAdustry] нет файла фона bg/" + L.file + " - слой пропущен");
        return null;
    }
    try {
        let tex = new Texture(f);
        tex.setFilter(Texture.TextureFilter.linear, Texture.TextureFilter.linear);
        tex.setWrap(Texture.TextureWrap.repeat, Texture.TextureWrap.repeat);
        return tex;
    } catch (e) {
        ulog.err("[ULTRAdustry] не смог загрузить bg/" + L.file + ": " + e);
        return null;
    }
}

// Реестр «будильников». Arc (Group.act) вызывает act/update ТОЛЬКО у видимых элементов, а наши слои и виджеты
// прячут себя из собственного update() по настройке: спрятавшись один раз, они уже не могли проснуться (включить
// настройку обратно можно было только перезапуском). Поэтому каждый регистрирует здесь свою функцию видимости, а
// драйвер терминального меню (он сам всегда видим) выставляет elem.visible каждый кадр.
let wakeList = [];
function registerWake(elem, fn){ wakeList.push({elem: elem, fn: fn}); }

// Один слой фона. Вынесено в функцию намеренно: замыкания, созданные прямо в теле цикла, в Rhino рискуют
// увидеть чужую переменную цикла, а параметры функции у каждого вызова свои.
function makeBgLayerImage(mod, layer, isEnabledFn){
    let tex = loadBgLayer(mod, layer);
    if (tex == null) return null;
    let region = new TextureRegion(tex);
    let image = new Image(region);
    image.setScaling(Scaling.stretch); // само окно UV уже подогнано под экран, растягиваем 1:1
    image.touchable = Touchable.disabled;
    // ВАЖНО: у Element одновременно есть И поле `visible` (boolean), И метод
    // `visible(Boolp)` с тем же именем - Rhino при вызове elem.visible(fn)
    // резолвит его как поле и падает ("Cannot call property visible...").
    // Поэтому включение/выключение через прямое присваивание полю ниже,
    // внутри update(), а не через elem.visible(isEnabledFn).
    image.update(() => {
        let enabled = isEnabledFn();
        image.visible = enabled;
        if (!enabled) return;
        bgTick();
        let W = Core.graphics.getWidth(), H = Core.graphics.getHeight();
        image.setSize(W, H);
        image.setPosition(0, 0);
        let g = (bgClock.t < bgClock.glitchUntil) ? bgClock.glitchPx : 0;
        // слои глитчат в РАЗНЫЕ стороны: near - вправо, items - влево
        let gl = layer.file == "net_near.png" ? g : (layer.file == "net_items.png" ? -g * 1.6 : 0);
        let uv = bgUv(layer, W, H, bgClock.t, gl);
        region.u = uv[0]; region.v = uv[1]; region.u2 = uv[2]; region.v2 = uv[3];
        if (layer.breathe > 0) {
            image.setColor(1, 1, 1, 1 - layer.breathe + layer.breathe * Math.sin(bgClock.t * 0.8));
        }
    });
    registerWake(image, isEnabledFn);
    return image;
}

// index: на какую позицию в дереве вставить первый слой (остальные идут следом)
// isEnabledFn: функция-геттер соответствующей настройки
function setupBgLayer(mod, index, isEnabledFn){
    // MenuFragment.build() создаёт свою WidgetGroup внутри Vars.ui.menuGroup
    // (та уже правильно скрывается вне меню - никакого риска перекрыть
    // геймплей) и первым же вызовом добавляет в неё отрисовку ванильного
    // MenuRenderer (индекс 0), а уже потом - панель кнопок, диалог и лого.
    // Вставляем свои картинки сразу за ним: они полностью перекрывают ванильный фон,
    // но остаются под кнопками. Порядок - снизу вверх: far, near, items.
    let outer = Vars.ui.menuGroup;
    if (outer == null || outer.getChildren().size == 0) {
        ulog.warn("[ULTRAdustry] не нашёл menuGroup - фон меню отключён (сменилась версия игры?)");
        return false;
    }
    let inner = outer.getChildren().first();

    let made = 0;
    for (let i = 0; i < BG_LAYERS.length; i++) {
        let image = makeBgLayerImage(mod, BG_LAYERS[i], isEnabledFn);
        if (image == null) continue;
        inner.addChildAt(index + made, image);
        made++;
    }
    if (made == 0) {
        ulog.warn("[ULTRAdustry] ни один слой фона не загрузился - фон меню отключён");
        return false;
    }
    ulog.info("[ULTRAdustry] фон меню включён: слоёв " + made + ", индекс " + index);
    return true;
}

// ---------- юниты для меню: список без скрытых, выбор и чёткая крупная иконка ----------
//
// Общее для двух мест: фигуры юнита в терминальном меню (setupTerminalMenu) и маленького виджета в
// стандартном меню (setupMenuUnitWidget). Живая перерисовка через Group.fill(DrawRect) в этом же моде уже
// один раз молча не заработала на клиенте пользователя (см. комментарий про фон-схему выше), поэтому
// везде — обычные Image/Label/Table, никакого своего draw().
const UNIT_CYCLE_SECONDS = 12;  // как часто менять юнита, пока выбор «случайный»
const CRISP_MAX_SCALE = 14;     // во сколько раз максимум увеличиваем мелкую иконку (дальше уже глыбы пикселей)
const UNIT_MIN_FRAC = 0.4;      // какую долю области занимает самый мелкий юнит списка (самый крупный занимает всю)
const STAT_ROWS_MAX = 3;        // строк характеристик под юнитом максимум (в сетке до 3 колонок = до 9 пунктов)
const DESC_LINES_MAX = 3;       // строк описания максимум; что не влезло - обрезается многоточием
const FIG_TYPE_CPS = 110;       // скорость «печати» характеристик и описания юнита, знаков в секунду (диагностика терминала - 48)
const FIG_TYPE_START = 0.3;     // пауза после смены юнита до начала печати: картинка успевает проявиться
const FIG_TYPE_GAP = 3;         // «передышка» между ячейками и строками в знаках: печать идёт рывками по строкам, а не сплошным потоком

// Скрытый юнит — тот, которого игрок не видит в базе данных: служебные типы движка и юниты, скрытые модами.
// isHidden() у движка и поля hidden/internal в разных версиях/форках устроены по-разному, поэтому проверяем
// все три: лишний «скрытый» не страшен, а показать служебного юнита без иконки/без смысла — страшно.
function menuUnitHidden(u){
    try { if (u.isHidden()) return true; } catch (e0) { /* нет метода - смотрим поля */ }
    return u.hidden === true || u.internal === true;
}

// Крупная иконка юнита. fullIcon — полный спрайт (корпус + оружие, с обводкой), а uiIcon для юнитов — маленькая
// «иконка интерфейса»: именно её раньше растягивали и получали мыло.
function unitBaseIcon(u){
    let r = u.fullIcon;
    if (r == null || !r.found()) r = u.uiIcon;
    return r;
}

let menuUnitsCache = null;
let menuUnitsCacheSize = -1;
// Список юнитов, которые можно показать в меню (JS-массив, порядок как в базе данных). Кэшируем: контент
// после загрузки не меняется, а список нужен и фигуре, и окну выбора.
function menuUnitList(){
    let all = Vars.content.units();
    if (menuUnitsCache != null && menuUnitsCacheSize == all.size) return menuUnitsCache;
    let out = [];
    let hidden = 0;
    for (let i = 0; i < all.size; i++) {
        let u = all.get(i);
        if (menuUnitHidden(u)) { hidden++; continue; }
        let r = unitBaseIcon(u);
        if (r == null || !r.found()) continue;
        out.push(u);
    }
    menuUnitsCache = out;
    menuUnitsCacheSize = all.size;
    ulog.info("[ULTRAdustry] юниты для меню: " + out.length + " из " + all.size + " (скрытых отброшено: " + hidden + ")");
    return out;
}

function menuPickedName(){ return String(Core.settings.getString(SETTING_UNIT_PICK, "")); }
function setMenuPickedName(name){ Core.settings.put(SETTING_UNIT_PICK, String(name)); }

// Какого юнита показывать: закреплённого (если он ещё есть в списке), иначе случайного, не равного prev.
function chooseMenuUnit(prev){
    let list = menuUnitList();
    if (list.length == 0) return null;
    let picked = menuPickedName();
    if (picked != "") {
        for (let i = 0; i < list.length; i++) if (String(list[i].name) == picked) return list[i];
        // закреплённого юнита больше нет (убрали мод / он стал скрытым) - тихо возвращаемся ко «случайному»
    }
    if (list.length == 1) return list[0];
    for (let t = 0; t < 12; t++) {
        let u = list[Math.floor(Math.random() * list.length)];
        if (prev == null || String(u.name) != String(prev.name)) return u;
    }
    return list[0];
}

// ---- характеристики и описание юнита (под картинкой) ----
function statNum(x){ let n = Number(x); return isNaN(n) ? 0 : n; }
function statFmt(x){ return String(Math.round(x * 10) / 10); }
function statPush(list, key, val){ list.push({l: bundleText("ultradustry.stat." + key).toUpperCase(), v: String(val)}); }

// Описание из базы данных (уже на языке игры) без цветовой разметки [accent]/[#ff0000]/[] и с одним пробелом вместо
// любых пропусков и переводов строк. Руками, без регулярок: в Rhino клиента квантификатор «+» в регулярках ведёт себя
// как «*» (/a+/.test("") даёт true, replace(/\s+/g, " ") вставляет пробел между всеми буквами) - см. заметку в памяти.
function unitDesc(u){
    let d = u.description;
    if (d == null) return "";
    let s = String(d);
    let out = "";
    let prevSpace = true;                 // true в начале: ведущие пропуски отбрасываются
    let i = 0;
    while (i < s.length) {
        let ch = s.charAt(i);
        if (ch == "[") {
            let j = s.indexOf("]", i);
            if (j > i && j - i <= 12) {   // тег цвета: только [#a-zA-Z0-9]* внутри
                let ok = true;
                for (let q = i + 1; q < j; q++) {
                    let c2 = s.charCodeAt(q);
                    if (!(c2 == 35 || (c2 >= 48 && c2 <= 57) || (c2 >= 65 && c2 <= 90) || (c2 >= 97 && c2 <= 122))) { ok = false; break; }
                }
                if (ok) { i = j + 1; continue; }
            }
        }
        if (ch == " " || ch == "\n" || ch == "\r" || ch == "\t") {
            if (!prevSpace) { out += " "; prevSpace = true; }
        } else {
            out += ch;
            prevSpace = false;
        }
        i++;
    }
    return prevSpace && out.length > 0 ? out.substring(0, out.length - 1) : out;
}

// Характеристики по важности (в сетке берутся первые STAT_ROWS_MAX*колонок): здоровье, броня, скорость (клеток/с),
// дальность (клеток) и цели - только у вооружённых, тип движения, потом то, что есть не у всех: орудия, добыча
// (уровень), стройка, трюм, размер. Значения - из полей юнита, поэтому юниты из модов/патчей тоже считаются верно.
function unitFacts(u){
    let st = [];
    let armed = u.weapons != null && u.weapons.size > 0;
    statPush(st, "hp", Math.round(statNum(u.health)));
    statPush(st, "armor", Math.round(statNum(u.armor)));
    statPush(st, "speed", statFmt(statNum(u.speed) * 60 / 8));
    if (armed) {
        let r = statNum(u.maxRange) > 0 ? statNum(u.maxRange) : statNum(u.range);
        if (r > 0) statPush(st, "range", statFmt(r / 8));
    }
    let ty = u.flying ? "air" : u.naval ? "naval" : u.allowLegStep ? "legs" : u.canBoost ? "boost" : u.hovering ? "hover" : "ground";
    statPush(st, "type", bundleText("ultradustry.stat.type." + ty).toUpperCase());
    if (armed) {
        let ta = u.targetAir !== false, tg = u.targetGround !== false;
        if (ta || tg) statPush(st, "targets", bundleText("ultradustry.stat.tgt." + (ta && tg ? "both" : ta ? "air" : "gnd")).toUpperCase());
        statPush(st, "guns", u.weapons.size);
    }
    let mines = Number(u.mineTier) >= 0;
    let builds = statNum(u.buildSpeed) > 0;
    if (mines) statPush(st, "mine", "T" + Math.round(Number(u.mineTier)));
    if (builds) statPush(st, "build", statFmt(statNum(u.buildSpeed)));
    if ((mines || builds) && statNum(u.itemCapacity) > 0) statPush(st, "cargo", Math.round(statNum(u.itemCapacity)));
    statPush(st, "size", statFmt(statNum(u.hitSize) / 8));
    return {stats: st, desc: unitDesc(u)};
}

// Измеритель ширины строки в px экрана для шрифта ff ({font, scale}, см. fontFor). Шрифт игры пропорциональный
// (не моно), поэтому ширину берём у настоящего GlyphLayout; если его нет (мок/сбой) - грубая оценка 0.55 em на знак.
function makeMeasure(ff, px){
    let gl = null;
    try { gl = new Packages.arc.graphics.g2d.GlyphLayout(); } catch (e0) { gl = null; }
    return function(str){
        if (gl != null) {
            try { gl.setText(ff.font, str); return gl.width * ff.scale; } catch (e1) { gl = null; }
        }
        return str.length * 0.55 * px;
    };
}

// «Печатающийся» текст. Что видно от строки full, когда напечатано chars знаков: ничего (одиночный пробел - пустой Label
// схлопнулся бы по высоте), напечатанная часть с курсором «_» или вся строка целиком.
function typedPart(full, chars){
    if (full.length == 0 || chars <= 0) return " ";
    if (chars >= full.length) return full;
    return full.substring(0, Math.floor(chars)) + "_";
}

// Сколько знаков «бюджета» съедает вся очередь строк (длина + передышка после каждой непустой).
function typedTotal(segs){
    let n = 0;
    for (let i = 0; i < segs.length; i++) if (segs[i].full.length > 0) n += segs[i].full.length + FIG_TYPE_GAP;
    return n;
}

// Выводит очередь строк segs ({lbl, full}) по порядку: каждая берёт из бюджета chars свою длину, остаток уходит следующей.
// Поэтому курсор есть только у одной строки - той, что печатается сейчас; предыдущие уже полные, следующие пустые.
// setText зовём лишь у строк, чей видимый текст изменился (запоминаем в seg.shown): иначе каждый кадр перекладывали бы
// десяток Label впустую.
function typedApply(segs, chars){
    let c = chars;
    for (let i = 0; i < segs.length; i++) {
        let sg = segs[i];
        let t = typedPart(sg.full, c);
        if (sg.shown !== t) { sg.lbl.setText(t); sg.shown = t; }
        if (sg.full.length > 0) c -= sg.full.length + FIG_TYPE_GAP;
    }
}

// Перенос по словам в maxLines строк шириной не больше maxW (meas - измеритель). Что не влезло - последняя строка
// обрезается и получает «...» (три точки, а не символ «…»: в шрифте игры его глифа может не быть). Слово шире
// строки режется по знакам, а не вылезает за рамку.
function wrapText(text, maxW, maxLines, meas){
    let words = text.length > 0 ? text.split(" ") : [];
    let lines = [];
    let cur = "";
    let idx = 0;
    while (idx < words.length) {
        let w = words[idx];
        let cand = cur == "" ? w : cur + " " + w;
        if (meas(cand) <= maxW) { cur = cand; idx++; continue; }
        if (cur == "") {
            let n = w.length;
            while (n > 1 && meas(w.substring(0, n)) > maxW) n--;
            cur = w.substring(0, n);
            words[idx] = w.substring(n);
            if (words[idx] == "") idx++;
        }
        lines.push(cur);
        cur = "";
        if (lines.length >= maxLines) break;
    }
    let cut = idx < words.length;
    if (!cut && cur != "") { if (lines.length < maxLines) lines.push(cur); else cut = true; }
    if (cut && lines.length > 0) {
        let last = lines[lines.length - 1];
        while (last.length > 1 && meas(last + "...") > maxW) {
            let sp = last.lastIndexOf(" ");
            last = sp > 0 ? last.substring(0, sp) : last.substring(0, last.length - 1);
        }
        // хвостовую пунктуацию/пробелы срезаем руками (регулярка с «+» в Rhino клиента ломается)
        while (last.length > 1 && " ,;:.-".indexOf(last.charAt(last.length - 1)) >= 0) last = last.substring(0, last.length - 1);
        lines[lines.length - 1] = last + "...";
    }
    return lines;
}

// Пункты характеристик ВСЕХ юнитов списка + измеритель с памятью: нужны, чтобы ширины колонок сетки были фиксированы
// (сетка не «ездит» при смене юнита) и считались по тому, что реально встаёт в каждую колонку.
function statMetrics(meas){
    let list = menuUnitList();
    let all = [], maxFacts = 1;
    let memo = {};
    let w = function(str){ if (memo[str] === undefined) memo[str] = meas(str); return memo[str]; };
    for (let i = 0; i < list.length; i++) {
        let st = unitFacts(list[i]).stats;
        if (st.length > maxFacts) maxFacts = st.length;
        all.push(st);
    }
    return {all: all, maxFacts: maxFacts, w: w};
}

// Ширины подписей (lw) и значений (vw) по колонкам для сетки из cols колонок и slots пунктов (раскладка по строкам:
// пункт j лежит в колонке j % cols) - у каждой колонки своя, поэтому сетка выходит заметно теснее, чем «самая
// широкая подпись во всех колонках».
function statColWidths(sm, cols, slots){
    let lw = [], vw = [];
    for (let c = 0; c < cols; c++) { lw.push(0); vw.push(0); }
    for (let i = 0; i < sm.all.length; i++) {
        let st = sm.all[i];
        for (let j = 0; j < st.length && j < slots; j++) {
            let c = j % cols;
            lw[c] = Math.max(lw[c], sm.w(st[j].l));
            vw[c] = Math.max(vw[c], sm.w(st[j].v));
        }
    }
    for (let q = 0; q < cols; q++) { lw[q] = Math.ceil(lw[q]); vw[q] = Math.ceil(vw[q]); }
    return {lw: lw, vw: vw};
}

// Крупная иконка БЕЗ мыла. Ванильный атлас идёт с линейным фильтром, и маленький спрайт, растянутый на 400 px,
// превращается в кашу. Пиксели из атласа взять нельзя (движок освобождает Pixmap страниц после загрузки, а
// Core.atlas.getPixmap вне createIcons кидает исключение «this will be a crash in the future»), поэтому поступаем
// как сама игра при выключенной «линейной фильтрации»: рисуем регион в ЦЕЛОЕ число раз крупнее (scale) и пока фигура
// видна, переключаем фильтр страницы атласа с этим регионом на nearest (crispFilterOn); при уходе из меню
// возвращаем прежний (crispFilterOff). Целый масштаб + nearest = ровные квадратные пиксели, как в пиксель-арте игры.
// Худший случай при сбое восстановления — вся игра выглядит так, как при выключенной настройке «линейная фильтрация».

// Диапазон размеров спрайтов (длинная сторона, px) среди юнитов списка: от моно (40) до окта (374). Нужен, чтобы мелкие
// юниты не раздувались на всю область, как крупные: размер на экране растёт вместе с размером самого юнита.
let sizeRangeCache = null;
function unitSizeRange(){
    let l = menuUnitList();
    if (sizeRangeCache != null && sizeRangeCache.n == l.length) return sizeRangeCache;
    let mn = 1e9, mx = 0;
    for (let i = 0; i < l.length; i++) {
        let r = unitBaseIcon(l[i]);
        let side = Math.max(r.width, r.height);
        if (side > 0 && side < mn) mn = side;
        if (side > mx) mx = side;
    }
    sizeRangeCache = {n: l.length, mn: mn, mx: mx};
    return sizeRangeCache;
}

// Доля области (UNIT_MIN_FRAC..1), которую занимает юнит. Шкала логарифмическая: спрайты различаются в ~9 раз, и
// линейная шкала делала бы средних юнитов крошечными, а логарифмическая даёт плавный ряд от 40% до 100%.
function unitSizeFrac(u){
    let rg = unitSizeRange();
    let r = unitBaseIcon(u);
    let side = Math.max(r.width, r.height);
    if (!(rg.mx > rg.mn) || !(side > 0)) return 1;
    let t = Math.log(Math.max(side, rg.mn) / rg.mn) / Math.log(rg.mx / rg.mn);
    return UNIT_MIN_FRAC + (1 - UNIT_MIN_FRAC) * Math.min(1, Math.max(0, t));
}

// План иконки под область boxPx (px экрана): масштаб — ближайшее ЦЕЛОЕ к желаемому размеру (доля unitSizeFrac от
// области), но не больше самой области. Возвращает {unit, region, scale, w, h}: w/h — размер на экране в px;
// scale == 0 — область так мала, что даже в натуральную величину спрайт крупнее желаемого: тогда рисуем уменьшенным
// (обычный линейный фильтр, nearest при уменьшении дал бы «рваные» края).
function crispPlan(unit, boxPx){
    let src = unitBaseIcon(unit);
    let side = Math.max(src.width, src.height);
    let want = boxPx * unitSizeFrac(unit);
    let s = Math.min(Math.round(want / side), CRISP_MAX_SCALE);
    while (s >= 1 && side * s > boxPx) s--;     // целый масштаб не должен вылезать за область
    if (s < 1) {
        let f = Math.min(want, boxPx) / side;
        return {unit: unit, region: src, scale: 0, w: src.width * f, h: src.height * f};
    }
    return {unit: unit, region: src, scale: s, w: src.width * s, h: src.height * s};
}

let crispFiltered = null;   // {tex, min, mag}: страница атласа, у которой мы временно включили nearest
function crispFilterOn(tex){
    if (crispFiltered != null) {
        if (crispFiltered.tex.equals(tex)) return;
        crispFilterOff();
    }
    let flt = Packages["arc.graphics.Texture$TextureFilter"];
    crispFiltered = {tex: tex, min: tex.getMinFilter(), mag: tex.getMagFilter()};
    tex.setFilter(flt.nearest, flt.nearest);
}
function crispFilterOff(){
    if (crispFiltered == null) return;
    let c = crispFiltered;
    crispFiltered = null;
    try { c.tex.setFilter(c.min, c.mag); } catch (eF) { ulog.warn("[ULTRAdustry] не вернул фильтр текстуры атласа: " + eF); }
}

// Окно выбора юнита: сетка иконок всех нескрытых юнитов + кнопка «случайный». Выбор сохраняется в настройке
// (общей для терминала и стандартного меню); открывается из настроек мода (addUnitPickButtons), onPick необязателен.
let unitPickerDlg = null;
function showUnitPicker(onPick){
    let list = menuUnitList();
    if (list.length == 0) return;
    if (unitPickerDlg == null) {
        unitPickerDlg = new BaseDialog(bundleText("ultradustry.unit.pick.title"));
        unitPickerDlg.addCloseButton();
    }
    let dlg = unitPickerDlg;
    dlg.cont.clearChildren();
    let cur = menuPickedName();
    let curUnit = null;
    for (let i = 0; i < list.length; i++) if (String(list[i].name) == cur) curUnit = list[i];

    let defaultText = curUnit != null ? bundleText("ultradustry.unit.pick.now", curUnit.localizedName)
                                      : bundleText("ultradustry.unit.pick.random");
    let info = new Label(defaultText);
    info.setColor(Color.valueOf(TERM_ORANGE));
    dlg.cont.add(info).padBottom(8).row();

    dlg.cont.button(bundleText("ultradustry.unit.random"), () => {
        setMenuPickedName("");
        dlg.hide();
        if (onPick) onPick();
    }).width(260).height(46).padBottom(8).row();

    let sw = Core.scene.getWidth() / uiScl();   // в единицах Cell (ячейки ниже тоже в них), иначе при масштабе интерфейса ≠ 100% сетка не влезает
    let cols = Math.max(3, Math.floor(Math.min(sw * 0.9, 1100) / 72));
    let grid = new Table();
    let cells = [];
    for (let i = 0; i < list.length; i++) {
        grid.add(makeUnitPickCell(list[i], String(list[i].name) == cur, dlg, onPick, cells)).size(66).pad(3);
        if ((i + 1) % cols == 0) grid.row();
    }
    let pane = new ScrollPane(grid);
    pane.setScrollingDisabled(true, false);
    dlg.cont.add(pane).grow();

    // подпись над сеткой показывает юнита под курсором, а без наведения — текущий выбор
    dlg.update(() => {
        let t = defaultText;
        for (let i = 0; i < cells.length; i++) if (cells[i].b.hasMouse()) { t = String(cells[i].u.localizedName); break; }
        if (!info.textEquals(t)) info.setText(t);
    });
    dlg.show();
}

// отдельная функция, а не тело цикла: замыкания в цикле в Rhino ловят последнее значение
function makeUnitPickCell(u, selected, dlg, onPick, cells){
    let b = new ImageButton(new TextureRegionDrawable(u.uiIcon), Packages.mindustry.ui.Styles.clearTogglei);
    b.resizeImage(52);
    b.setChecked(selected);
    b.clicked(() => {
        setMenuPickedName(u.name);
        dlg.hide();
        if (onPick) onPick();
    });
    cells.push({b: b, u: u});
    return b;
}

// --- виджет "случайный юнит" в углу СТАНДАРТНОГО меню: иконка юнита с лёгкой looping-анимацией;
// юнит перевыбирается раз в UNIT_CYCLE_SECONDS (или показывается закреплённый юнит, см. выбор
// в терминале). Тот же проверенный путь, что и у bgImage: Image.update() с setRotation/setColor.
function setupMenuUnitWidget(){
    let outer = Vars.ui.menuGroup;
    if (outer == null || outer.getChildren().size == 0) {
        ulog.warn("[ULTRAdustry] не нашёл menuGroup - виджет случайного юнита отключён");
        return;
    }
    let inner = outer.getChildren().first();

    let holder = new Table();
    holder.touchable = Touchable.disabled;

    let unitImage = new Image();
    unitImage.setScaling(Scaling.fit);
    unitImage.setOrigin(Align.center);

    holder.top().right();
    holder.add(unitImage).size(96).padTop(12).padRight(12).row();

    let animTime = 0;
    let cycleTime = UNIT_CYCLE_SECONDS; // сразу выбрать юнита на первом кадре
    let shown = null;

    holder.update(() => {
        let enabled = isMenuUnitEnabled() && !termState.active;
        holder.visible = enabled;
        if (!enabled) return;

        animTime += Time.delta / 60;
        cycleTime += Time.delta / 60;

        let wantPick = menuPickedName();
        let pickChanged = wantPick != "" && (shown == null || String(shown.name) != wantPick);
        if (cycleTime >= UNIT_CYCLE_SECONDS || pickChanged) {
            cycleTime = 0;
            let unit = chooseMenuUnit(shown);
            if (unit != null) {
                shown = unit;
                unitImage.setDrawable(new TextureRegionDrawable(unitBaseIcon(unit)));
            }
        }

        unitImage.setRotation(Math.sin(animTime * 2) * 15);
        unitImage.setColor(1, 1, 1, 0.85 + 0.15 * Math.sin(animTime * 3));
    });

    registerWake(holder, () => isMenuUnitEnabled() && !termState.active);
    holder.setFillParent(true);
    inner.addChild(holder); // добавлен последним - поверх фона-схемы и панели кнопок
    ulog.info("[ULTRAdustry] виджет случайного юнита в меню включён");
}

// --- главное меню в виде терминала (как стартовый экран ULTRAKILL, но из деталей Mindustry) ---
//
// Что рисуем: толстую белую рамку по краю экрана, логотип игры, оранжевую строку-подпись (в праздники —
// поздравление), три серые строки «диагностики», колонку широких кнопок с двойным контуром (выбранная —
// белая, как в оригинале), строку «INIT SOCIALS» со ссылками (фигуру случайного юнита справа убрали в 2.3.1 — в терминале она была лишней; юнит остался только виджетом стандартного меню).
// Фон — анимированная плата завода (слои net_*, см. setupBgLayer), он уже лежит под нами.
//
// ВАЖНО про технику: НИКАКОГО своего draw()/Group.fill(DrawRect) — выше в файле написано, что такой слой у
// пользователя один раз молча не появился. Здесь только Table/Image/Label/TextButton с готовыми 9-patch
// спрайтами из sprites/ (генерирует gen_terminal_sprites.py) — то же, на чём стоит весь остальной интерфейс.
//
// Ванильную колонку кнопок, логотип и прочее терминал не удаляет, а прячет (visible=false), пока включён;
// всё это (плюс кнопки, добавленные другими модами) доступно по ссылке «Стандартное меню» в углу.
const TERM_ORANGE = "ff9a00";
const TERM_GREY = "b9b9b9";
const TERM_DIM = 0.42; // насколько затемняем фон под терминалом (0 - никак, 1 - сплошной чёрный); плата сама по себе тусклая, поэтому меньше, чем было у схемы CPU (0.78)
function termKey(name){ return Packages.arc.input.KeyCode[name]; } // лениво: в мок-стенде Packages.arc нет
const termState = {active: false, std: false, failed: false}; // active — терминал сейчас на экране; std — игрок ушёл в стандартное меню

function termUpper(key){ return String(Core.bundle.get(key)).toUpperCase(); }

function termDrawable(name){
    let full = "ultradustry-" + name;
    if (!Core.atlas.has(full)) return null;
    return Core.atlas.getDrawable(full);
}

function termCheckPlay(run){
    if (!Vars.mods.hasContentErrors()) run();
    else Vars.ui.showInfo("@mod.noerrorplay");
}

function termOpenUrl(url){
    if (!Core.app.openURI(url)) {
        Vars.ui.showErrorMessage("@linkfail");
        Core.app.setClipboardText(url);
    }
}

function termSubtitle(version){
    let h = holidayToday();
    if (h != null) return bundleText("ultradustry.term.holiday." + h);
    return "ULTRAdustry v" + version;
}

// Три строки «диагностики». Версия движка — build.revision, число модов — из загрузчика модов.
function termDiagLines(){
    let ver = "";
    try {
        let V = Packages.mindustry.core.Version;
        ver = "V" + V.build + (V.revision != 0 ? "." + V.revision : "");
    } catch (e) { ver = ""; }
    let mods = 0;
    try { mods = Vars.mods.list().size; } catch (e) { mods = 0; }
    return [
        bundleText("ultradustry.term.line1", ver).toUpperCase(),
        bundleText("ultradustry.term.line2", mods).toUpperCase(),
        bundleText("ultradustry.term.line3").toUpperCase()
    ];
}

// --- чёткий текст терминала ---
// Ванильный Fonts.def сгенерирован на 18 px (с фильтром nearest), а крупные надписи терминала раньше получались
// растягиванием setFontScale(1.7-2.4) - отсюда «мыльные» блочные буквы. Теперь генерируем настоящий шрифт нужного
// размера из того же fonts/font.woff через FreeType (как это делает сама игра) и показываем 1:1. Единицы сцены в
// Mindustry = пиксели экрана, так что размер глифа в пикселях = размеру в сцене. incremental=true - глифы (в т.ч.
// кириллица) дорисовываются по мере надобности, поэтому генератор живёт до конца сессии. Размеры квантуем до чётных,
// чтобы при перетаскивании размера окна не плодить десятки шрифтов. Любой сбой (другая сборка/платформа без
// FreeType) -> null, и вызывающий код откатывается на Fonts.def с растяжением, как было.
let termFontCache = {};
let termFontGen = null;
let termFontFailed = false;
// Масштаб интерфейса (настройка «Масштаб интерфейса»): размеры в Cell (width/height/size/pad) рисуются в Scl.scl(1) раз
// крупнее/мельче записанных, а сама сцена Core.scene в этих единицах НЕ меряется (её размер - обычные пиксели). Всё, что
// мы считаем в пикселях (ширина текста из GlyphLayout, высота строки по размеру шрифта, размер окна), надо делить на
// это число, прежде чем отдавать в Cell, иначе при масштабе 70% ячейки у́же собственных подписей (подписи налезают на
// значения), а при 140% раскладка вылезает за экран. При 100% множитель 1 и ничего не меняется.
function uiScl(){
    let v = 1;
    try { v = Number(Packages.arc.scene.ui.layout.Scl.scl(1)); } catch (e0) { v = 1; }
    return (v > 0.05 && v < 20) ? v : 1;
}
function termFontPx(fs){
    return Math.max(8, 2 * Math.round(Packages.arc.scene.ui.layout.Scl.scl(18) * fs / 2));
}
function termFont(px){
    if (termFontFailed) return null;
    if (termFontCache[px] != null) return termFontCache[px];
    try {
        if (termFontGen == null) termFontGen = new Packages.arc.freetype.FreeTypeFontGenerator(Core.files.internal("fonts/font.woff"));
        let par = new Packages["arc.freetype.FreeTypeFontGenerator$FreeTypeFontParameter"]();
        par.size = px;
        par.incremental = true;
        par.shadowColor = Color.darkGray;
        par.shadowOffsetY = Math.max(1, Math.round(px / 16));
        let flt = Packages.mindustry.ui.Fonts.getTextFilter();
        par.magFilter = flt;
        par.minFilter = flt;
        let f = termFontGen.generateFont(par);
        termFontCache[px] = f;
        return f;
    } catch (eF) {
        termFontFailed = true;
        ulog.warn("[ULTRAdustry] чёткий шрифт терминала не создался, текст будет растянутым ванильным: " + eF);
        return null;
    }
}

function setupTerminalMenu(mod){
    let outer = Vars.ui.menuGroup;
    if (outer == null || outer.getChildren().size == 0) {
        ulog.warn("[ULTRAdustry] не нашёл menuGroup - терминальное меню отключено");
        return false;
    }
    let inner = outer.getChildren().first();

    let dFrame = termDrawable("term-frame");
    let dBtn = termDrawable("term-btn");
    let dSel = termDrawable("term-btn-sel");
    let dDown = termDrawable("term-btn-down");
    if (dFrame == null || dBtn == null || dSel == null || dDown == null) {
        ulog.warn("[ULTRAdustry] терминал: спрайтов term-* нет в атласе - остаётся стандартное меню");
        return false;
    }
    let logo = Core.atlas.find("logo");
    let font = Packages.mindustry.ui.Fonts.def;
    let version = String(mod.meta.version);
    let StyleCls = Packages["arc.scene.ui.TextButton$TextButtonStyle"];
    let LabelStyleCls = Packages["arc.scene.ui.Label$LabelStyle"];
    let orange = Color.valueOf(TERM_ORANGE);
    let grey = Color.valueOf(TERM_GREY);
    // Плата яркая: оранжевые линии и подписи чипов лезут под строки диагностики и мешают читать.
    // В оригинале фон тусклый, поэтому гасим его полупрозрачной чёрной подложкой (TERM_DIM).
    let dim = Packages.mindustry.gen.Tex.whiteui.tint(new Color(0, 0, 0, TERM_DIM));

    // Что прячем: всё, что MenuFragment положил в свою группу, кроме отрисовки фона (индекс 0) и наших
    // слоёв-картинок (фон net_*). Остальное — колонка кнопок, логотип с версией, Discord, значок
    // «flarogus», кнопки обновления форка — вытесняется терминалом.
    let vanilla = [];
    let kids = inner.getChildren();
    for (let i = 1; i < kids.size; i++) {
        let c = kids.get(i);
        let keep = (c instanceof Image);
        ulog.info("[ULTRAdustry] терминал: элемент меню #" + i + " " + c.getClass().getName() + " name=" + c.name + (keep ? " - оставляю" : " - прячу в терминале"));
        if (!keep) vanilla.push(c);
    }

    let root = new Table();
    root.name = "ultradustry-terminal";
    root.setFillParent(true);
    root.touchable = Touchable.childrenOnly;
    inner.addChild(root);

    let page = "main";
    let sel = 0;
    let dirty = true;
    let lastW = -1, lastH = -1;
    let twTime = 0;
    let btns = [];
    let items = [];
    let diagLabels = [];
    let diagFull = [];
    let lastMx = -1, lastMy = -1;

    function openPage(p){ page = p; sel = 0; dirty = true; }

    function pageItems(p){
        if (p == "play") return [
            {t: termUpper("campaign"), go: () => termCheckPlay(() => Vars.ui.planet.show())},
            {t: termUpper("joingame"), go: () => termCheckPlay(() => Vars.ui.join.show())},
            {t: termUpper("customgame"), go: () => termCheckPlay(() => Vars.ui.custom.show())},
            {t: termUpper("loadgame"), go: () => termCheckPlay(() => Vars.ui.load.show())},
            {t: termUpper("back"), go: () => openPage("main")}
        ];
        if (p == "db") return [
            {t: termUpper("schematics"), go: () => Vars.ui.schematics.show()},
            {t: termUpper("database"), go: () => Vars.ui.database.show()},
            {t: termUpper("about.button"), go: () => Vars.ui.about.show()},
            {t: termUpper("back"), go: () => openPage("main")}
        ];
        return [
            {t: termUpper("play"), go: () => openPage("play")},
            {t: termUpper("database.button"), go: () => openPage("db")},
            {t: termUpper("editor"), go: () => termCheckPlay(() => Vars.ui.maps.show())},
            {t: termUpper("mods"), go: () => Vars.ui.mods.show()},
            {t: termUpper("settings"), go: () => Vars.ui.settings.show()},
            {t: termUpper("quit"), go: () => Core.app.exit()}
        ];
    }

    // {font, scale}: чёткий шрифт нужного размера (масштаб 1) или запасной Fonts.def с растяжением fs
    function fontFor(fs){
        let f = termFont(termFontPx(fs));
        return f != null ? {font: f, scale: 1} : {font: font, scale: fs};
    }

    function mkLabel(text, fs, color){
        let ff = fontFor(fs);
        let l = new Label(text, new LabelStyleCls(ff.font, Color.white));
        l.setFontScale(ff.scale);
        l.setColor(color);
        return l;
    }

    function newStyle(f){
        let st = new StyleCls();
        st.up = dBtn; st.over = dSel; st.down = dDown; st.checked = dSel; st.checkedOver = dSel;
        st.font = f;
        st.fontColor = Color.white;
        st.overFontColor = Color.black; st.downFontColor = Color.black;
        st.checkedFontColor = Color.black; st.checkedOverFontColor = Color.black;
        return st;
    }

    function addTermButton(parent, idx, w, h, scale, gap, style){
        let btn = new TextButton(items[idx].t, style);
        btn.getLabel().setFontScale(scale);
        btn.getLabel().setAlignment(Align.center);
        btn.clicked(() => { sel = idx; items[idx].go(); });
        parent.add(btn).size(w, h).left().padTop(gap).row();
        btns.push(btn);
    }

    // Ссылка с подчёркиванием, при наведении оранжевеет.
    function makeLink(text, fs, lineH, go){
        let t = new Table();
        t.touchable = Touchable.enabled;
        let lbl = mkLabel(text, fs, Color.white);
        let line = new Image(Core.atlas.white());
        t.add(lbl).left().row();
        t.add(line).growX().height(lineH).padTop(1);
        t.clicked(go);
        t.update(() => {
            let c = t.hasMouse() ? orange : Color.white;
            lbl.setColor(c);
            line.setColor(c);
        });
        return t;
    }

    // ---- фигура юнита справа от колонки кнопок: картинка, имя, характеристики и описание, ссылки выбора ----
    // Состояние живёт вне rebuild(): при смене размера окна/страницы меню элементы пересоздаются, а юнит, его
    // набранный текст и таймер смены остаются. Любая ошибка фигуры гасит только её (figBroken), не весь терминал.
    let figUnit = null;        // показываемый юнит
    let figIcon = null;        // план иконки (crispPlan): регион атласа, целый масштаб, размер
    let figCycle = 0;          // секунд с выбора юнита (для авто-смены в режиме «случайный»)
    let figFade = 0;           // 0..1 проявление после смены
    let figAnim = 0;           // общее время для лёгкого «дыхания»
    let figImage = null, figName = null;
    let figStatCells = [], figDescLines = [];   // ячейки сетки характеристик {l, v} и строки описания (Label)
    let figTypeSegs = [], figTypeT = 0, figTypeDone = true;   // очередь «печати» (характеристики и описание текущего юнита), время с её начала, всё ли уже напечатано
    let figMeasure = null, figDescW = 0;       // измеритель текста и ширина переноса описания
    let figBoxSize = 0, figScenePpu = 1, figCellPx = 1;   // размер коробки в единицах Cell; пикселей экрана на единицу сцены / на единицу Cell
    let figBroken = false;

    function figGuard(what, fn){
        if (figBroken) return;
        try { fn(); } catch (eFig) {
            figBroken = true;
            figImage = null; figName = null; figStatCells = []; figDescLines = []; figTypeSegs = [];
            crispFilterOff();
            ulog.warn("[ULTRAdustry] фигура юнита в терминале сломалась (" + what + "), отключаю до перезапуска: " + eFig);
        }
    }

    // иконка под текущий размер коробки: целый масштаб + nearest (резко); если юнит не помещается даже в натуральную
    // величину - уменьшенная обычным фильтром. Размер на экране задаёт план (crispPlan), а Scaling.none рисует
    // картинку ровно этого размера в центре коробки: мелкие юниты остаются мелкими, а не растягиваются на всю коробку.
    function figApplyIcon(){
        if (figUnit == null || figImage == null) return;
        figIcon = crispPlan(figUnit, figBoxSize * figCellPx);
        let dr = new TextureRegionDrawable(figIcon.region);
        dr.setMinWidth(figIcon.w / figScenePpu);
        dr.setMinHeight(figIcon.h / figScenePpu);
        figImage.setScaling(Scaling.none);
        if (figIcon.scale >= 1) crispFilterOn(figIcon.region.texture);
        else crispFilterOff();
        figImage.setDrawable(dr);
    }

    // заполняет сетку характеристик и описание для юнита u (размеры панели зарезервированы в buildFigure заранее).
    // Сами тексты не выставляем, а ставим в очередь «печати»: порядок - ячейки сетки слева направо и сверху вниз (подпись,
    // затем значение), потом строки описания. Лишние ячейки и строки сразу пустые. Печать идёт в figTick.
    function figFillInfo(u){
        let facts = unitFacts(u);
        figTypeSegs = [];
        for (let i = 0; i < figStatCells.length; i++) {
            let c = figStatCells[i];
            if (i < facts.stats.length) {
                figTypeSegs.push({lbl: c.l, full: facts.stats[i].l, shown: null});
                figTypeSegs.push({lbl: c.v, full: facts.stats[i].v, shown: null});
            } else { c.l.setText(" "); c.v.setText(" "); }
        }
        if (figDescLines.length > 0) {
            let lines = figMeasure != null ? wrapText(facts.desc, figDescW, figDescLines.length, figMeasure) : [];
            for (let j = 0; j < figDescLines.length; j++) {
                if (j < lines.length) figTypeSegs.push({lbl: figDescLines[j], full: lines[j], shown: null});
                else figDescLines[j].setText(" ");
            }
        }
        figTypeT = 0; figTypeDone = false;
        typedApply(figTypeSegs, 0);    // всё пусто до начала печати (и стирает текст прежнего юнита)
    }

    // допечатать мгновенно (пересборка при смене размера окна/страницы: тот же юнит, печать заново не начинаем)
    function figTypeFinish(){
        typedApply(figTypeSegs, 1e9);
        figTypeDone = true;
    }

    function figSetUnit(u){
        if (u == null) return;
        figUnit = u;
        figFade = 0; figCycle = 0;
        figGuard("смена юнита", () => {
            figApplyIcon();
            if (figName != null) figName.setText(String(u.localizedName).toUpperCase());
            figFillInfo(u);
        });
    }

    // строит правую область; возвращает true, если фигура поместилась.
    // Сверху вниз: картинка, имя, сетка характеристик, описание, ссылки. Когда места мало, отбрасываем по очереди:
    // описание -> характеристики; картинка получает остаток, и если ей остаётся меньше 110 px, фигуры нет вовсе.
    // ЕДИНИЦЫ: всё здесь считается в единицах Cell (см. uiScl): размеры от шрифта (высота строки, ширина текста) переведены
    // из пикселей делением на us, размеры окна пришли уже поделёнными (см. rebuild).
    function buildFigure(frame, sw, sh, k, inset, colW, leftPad, smallFont, avail, us){
        figImage = null; figName = null; figStatCells = []; figDescLines = []; figMeasure = null; figTypeSegs = [];
        crispFilterOff();
        if (figBroken || !isTermUnitEnabled()) return false;
        if (menuUnitList().length == 0) return false;
        let figW = sw - (colW + leftPad) - 2 * inset - 36 * k;
        if (figW < 190) return false;

        let su = 1 / us;
        let nameFs = Math.max(0.95, 1.5 * k);
        let nameH = Math.round(termFontPx(nameFs) * 1.4) * su;
        let gap = Math.max(6, 10 * k);

        // характеристики и описание: шрифт как у мелких строк меню; число колонок сетки - сколько влезает по ширине
        let infoFs = smallFont;
        let infoPx = termFontPx(infoFs);
        let infoLineH = Math.round(infoPx * 1.3) * su;
        let infoFF = fontFor(infoFs);
        let rawMeasure = makeMeasure(infoFF, infoPx);
        figMeasure = function(str){ return rawMeasure(str) * su; };   // ширина текста в единицах Cell

        let sm = statMetrics(figMeasure);
        let cellGap = 16 * k, colGap = 22 * k;
        // колонок сетки - сколько влезает по ширине (до 3), пунктов - до STAT_ROWS_MAX строк
        let cols = 3, slots = 0, cw = null, statsW = 0;
        for (; cols >= 1; cols--) {
            slots = Math.min(sm.maxFacts, cols * STAT_ROWS_MAX);
            cw = statColWidths(sm, cols, slots);
            statsW = (cols - 1) * colGap;
            for (let c0 = 0; c0 < cols; c0++) statsW += cw.lw[c0] + cellGap + cw.vw[c0];
            if (statsW <= figW || cols == 1) break;
        }
        let statRows = Math.max(1, Math.ceil(slots / cols));
        let statH = statRows * infoLineH;
        let ideal = Math.min(figW, sh * 0.62);
        let blockW = Math.min(figW, Math.max(statsW, ideal * 0.9));
        let descH = DESC_LINES_MAX * infoLineH;
        figDescW = blockW;

        // внизу справа лежит угловая ссылка «Стандартное меню» (отступ 22 px + строка шрифта ~15 px, см. cornerLink): не залезаем на неё
        let cornerReserve = Math.max(0, (22 + Math.round(termFontPx(0.85 * su) * 1.5)) * su + 6 * k - inset);
        avail = avail - cornerReserve;

        let levels = [
            {stats: true, desc: true},
            {stats: true, desc: false},
            {stats: false, desc: false}
        ];
        let lv = null, box = 0;
        for (let li = 0; li < levels.length; li++) {
            let L = levels[li];
            let textH = nameH + gap + (L.stats ? statH + gap : 0) + (L.desc ? descH + gap : 0);
            let b = Math.min(ideal, avail - textH);
            // полный набор берём, только если картинка остаётся хотя бы вполовину «идеальной»; на последнем уровне - от 110 px
            let need = li < levels.length - 1 ? Math.max(150, ideal * 0.5) : 110;
            if (b >= need) { lv = L; box = b; break; }
        }
        if (lv == null) return false;
        figBoxSize = box;
        figScenePpu = Core.graphics.getWidth() / Core.scene.getWidth();   // пикселей экрана на единицу сцены
        figCellPx = figScenePpu * us;                                      // пикселей экрана на единицу Cell

        let fig = new Table();
        fig.center();
        frame.add(fig).grow().padRight(36 * k).padBottom(cornerReserve);

        let boxT = new Table();
        figImage = new Image();
        // по нижнему краю коробки: мелкий юнит «стоит» над именем (а не висит посреди пустоты), крупный заполняет коробку
        figImage.setAlign(Align.bottom);
        figImage.touchable = Touchable.disabled;
        boxT.add(figImage).size(box);
        fig.add(boxT).size(box).row();

        figName = mkLabel(" ", nameFs, orange);
        fig.add(figName).height(nameH).padTop(gap).row();

        let dimCol = Color.valueOf("8a8a8a");
        if (lv.stats) {
            let statT = new Table();
            statT.left().top();
            for (let r = 0; r < statRows; r++) {
                for (let c = 0; c < cols; c++) {
                    let lbl = mkLabel(" ", infoFs, dimCol);
                    let val = mkLabel(" ", infoFs, Color.white);
                    statT.add(lbl).left().width(cw.lw[c]).height(infoLineH).padRight(cellGap);
                    statT.add(val).left().width(cw.vw[c]).height(infoLineH).padRight(c < cols - 1 ? colGap : 0);
                    figStatCells.push({l: lbl, v: val});
                }
                statT.row();
            }
            fig.add(statT).width(blockW).left().padTop(gap).row();
        }
        if (lv.desc) {
            let descT = new Table();
            descT.left().top();
            let descCol = Color.valueOf("c8c8c8");
            for (let i = 0; i < DESC_LINES_MAX; i++) {
                let l = mkLabel(" ", infoFs, descCol);
                descT.add(l).left().width(blockW).height(infoLineH).row();
                figDescLines.push(l);
            }
            fig.add(descT).width(blockW).left().padTop(gap).row();
        }

        if (figUnit != null) {
            // пересборка (размер окна/страница): тот же юнит, проявление не повторяем
            let keepCycle = figCycle;
            figSetUnit(figUnit);
            figCycle = keepCycle; figFade = 1;
            figTypeFinish();
        }
        return true;
    }

    // покадрово: смена юнита, проявление, лёгкое дыхание
    function figTick(){
        if (figImage == null) return;
        let dt = Time.delta / 60;
        figAnim += dt;
        figCycle += dt;
        let want = menuPickedName();
        if (figUnit == null) figSetUnit(chooseMenuUnit(null));
        else if (want != "" && String(figUnit.name) != want) figSetUnit(chooseMenuUnit(figUnit));
        else if (want == "" && figCycle >= UNIT_CYCLE_SECONDS) figSetUnit(chooseMenuUnit(figUnit));
        if (figUnit == null) return;

        if (figIcon != null && figIcon.scale >= 1) crispFilterOn(figIcon.region.texture);
        figFade = Math.min(1, figFade + dt / 0.45);
        figImage.setColor(1, 1, 1, figFade * (0.94 + 0.06 * Math.sin(figAnim * 2.2)));

        // печать характеристик и описания: после паузы идёт со скоростью FIG_TYPE_CPS; когда допечатали - один раз выводим всё целиком
        if (!figTypeDone) {
            figTypeT += dt;
            let chars = Math.max(0, figTypeT - FIG_TYPE_START) * FIG_TYPE_CPS;
            if (chars >= typedTotal(figTypeSegs)) figTypeFinish();
            else typedApply(figTypeSegs, chars);
        }
    }

    function rebuild(){
        dirty = false;
        root.clearChildren();
        root.background(dim);
        btns = [];
        diagLabels = [];
        // sw/sh - размер экрана в единицах Cell (см. uiScl): так терминал занимает экран целиком при любом «Масштабе интерфейса»
        let us = uiScl();
        lastW = Core.scene.getWidth(); lastH = Core.scene.getHeight();
        let sw = lastW / us, sh = lastH / us;
        let k = Math.max(0.45, Math.min(sh / 1080, 1.5));
        let inset = Math.max(4, 8 * k);
        let wide = (sw / sh) >= 1.45;
        items = pageItems(page);
        let n = items.length;
        let colW = Math.min(wide ? sw * 0.46 : sw * 0.86, sh * 0.82);
        let btnW = Math.min(colW, Math.max(colW * 0.76, 250));
        let logoH = colW * logo.height / logo.width;
        let subH = 34 * k, diagH = 28 * k, socH = 30 * k;
        let gap = Math.max(5, 9 * k);
        let avail = sh - 2 * inset - 24 * k;
        let fixed = logoH + subH + diagH * 3 + socH * 2.2 + 70 * k;
        let btnH = Math.max(32, Math.min(105 * k, (avail - fixed) / n - gap));
        let btnFont = Math.max(0.75, Math.min(2.4, btnH / 105 * 2.3));
        let smallFont = Math.max(0.8, 1.35 * k);
        let leftPad = wide ? Math.max(18, sw * 0.066) : Math.max(14, sw * 0.05);

        let frame = new Table(dFrame);
        frame.left();
        root.add(frame).grow().pad(inset);

        let left = new Table();
        left.left();
        frame.add(left).width(colW).padLeft(leftPad);

        let logoImg = new Image(new TextureRegionDrawable(logo));
        logoImg.setScaling(Scaling.fit);
        left.add(logoImg).size(colW, logoH).left().row();

        let sub = mkLabel(termSubtitle(version), Math.max(0.9, 1.7 * k), orange);
        left.add(sub).left().height(subH).padTop(4 * k).row();

        diagFull = termDiagLines();
        for (let i = 0; i < diagFull.length; i++) {
            let lbl = mkLabel(" ", smallFont, grey);
            left.add(lbl).left().height(diagH).padTop(i == 0 ? 12 * k : 0).row();
            diagLabels.push(lbl);
        }

        let btnFF = fontFor(btnFont);
        let style = newStyle(btnFF.font);
        for (let i = 0; i < n; i++) addTermButton(left, i, btnW, btnH, btnFF.scale, i == 0 ? 10 * k : gap, style);
        if (sel >= n) sel = 0;

        let soc = mkLabel(bundleText("ultradustry.term.socials").toUpperCase(), smallFont, grey);
        left.add(soc).left().height(socH).padTop(16 * k).row();
        let links = new Table();
        links.left();
        let lineH = Math.max(1.5, 2 * k);
        links.add(makeLink("DISCORD", smallFont, lineH, () => Vars.ui.discord.show())).padRight(18 * k);
        links.add(makeLink("GITHUB", smallFont, lineH, () => termOpenUrl("https://github.com/Anuken/Mindustry"))).padRight(18 * k);
        links.add(makeLink("WIKI", smallFont, lineH, () => termOpenUrl("https://mindustrygame.github.io/wiki")));
        left.add(links).left().row();

        figGuard("раскладка", () => buildFigure(frame, sw, sh, k, inset, colW, leftPad, smallFont, avail, us));
    }

    // Угловые ссылки: «Стандартное меню» (в терминале) и «Терминал» (в стандартном), строятся один раз
    let corners = [];
    function cornerLink(text, top, rightSide, go, showFn){
        let holder = new Table();
        holder.setFillParent(true);
        holder.touchable = Touchable.childrenOnly;
        if (top) holder.top(); else holder.bottom();
        if (rightSide) holder.right(); else holder.left();
        // шрифт, подчёркивание и отступ заданы в пикселях (делим на масштаб интерфейса): ссылка одного размера при любом масштабе
        let cus = uiScl();
        let link = makeLink(text, 0.85 / cus, 1.5 / cus, go);
        holder.add(link).pad(22 / cus);
        // Видимость считает driver (см. ниже), а не holder.update: Group.act не вызывает act у невидимых детей,
        // и спрятавшаяся один раз ссылка уже никогда бы не проснулась.
        corners.push({holder: holder, showFn: showFn});
        inner.addChild(holder);
        return holder;
    }
    cornerLink(bundleText("ultradustry.term.std").toUpperCase(), false, true, () => { termState.std = true; },
        () => termState.active && !termState.failed);
    cornerLink(bundleText("ultradustry.term.back").toUpperCase(), true, false, () => { termState.std = false; dirty = true; },
        () => isTerminalMenu() && termState.std && !termState.failed);

    function tick(){
        let active = isTerminalMenu() && !termState.std;
        termState.active = active;
        root.visible = active;
        for (let i = 0; i < vanilla.length; i++) vanilla[i].visible = !active;
        if (!active) { crispFilterOff(); return; }

        let sw = Core.scene.getWidth(), sh = Core.scene.getHeight();
        if (dirty || sw != lastW || sh != lastH) rebuild();

        // «печатающаяся» диагностика
        twTime += Time.delta / 60;
        let chars = Math.floor(twTime * 48);
        for (let i = 0; i < diagLabels.length; i++) {
            let full = diagFull[i];
            let show = Math.max(0, Math.min(full.length, chars));
            chars -= full.length + 8;
            let text = full.substring(0, show);
            if (show > 0 && show < full.length) text += "_";
            diagLabels[i].setText(text.length == 0 ? " " : text);
        }
        figGuard("кадр", figTick);

        // В форке клиента ChatFragment открывает поле чата по Binding.chat (Enter) даже в главном меню и забирает
        // клавиатурный фокус: после первого же Enter Esc и стрелки блокировались бы нашим фильтром busy (hasKeyboard).
        // В меню чат не нужен (сообщений нет), поэтому закрываем его тут же. try - на ванили/другой сборке API может отличаться.
        if (Vars.state.isMenu()) {
            try { let cf = Vars.ui.chatfrag; if (cf != null && cf.shown()) cf.hide(true); } catch (eC) { /* нет чата - и не надо */ }
        }

        // клавиатура: стрелки и Enter, Esc = назад из подменю; не трогаем, пока открыт любой диалог
        let n = btns.length;
        let busy = !Vars.state.isMenu() || Core.scene.hasDialog() || Core.scene.hasKeyboard();
        if (!busy && n > 0) {
            if (Core.input.keyTap(termKey("down"))) sel = (sel + 1) % n;
            if (Core.input.keyTap(termKey("up"))) sel = (sel + n - 1) % n;
            if (Core.input.keyTap(termKey("enter"))) items[sel].go();
            if (page != "main" && Core.input.keyTap(termKey("escape"))) openPage("main");
        }
        // мышь: выбирает кнопку под курсором, только если курсор сдвинулся (иначе забивала бы клавиатуру)
        let mx = Core.input.mouseX(), my = Core.input.mouseY();
        if (mx != lastMx || my != lastMy) {
            lastMx = mx; lastMy = my;
            for (let i = 0; i < btns.length; i++) if (btns[i].hasMouse()) sel = i;
        }
        for (let i = 0; i < btns.length; i++) {
            let want = (i == sel);
            if (btns[i].isChecked() != want) btns[i].setChecked(want);
        }
    }

    // Любая ошибка в терминале (другая версия движка, нет метода) не должна ронять игру: update вызывается
    // каждый кадр, и необработанное исключение в нём превращается в окно «мод вызвал краш». Один раз пишем
    // в лог, прячем терминал и возвращаем стандартное меню до конца сессии.
    // ВАЖНО: тик висит на отдельном ВСЕГДА видимом пустом элементе, а не на root. Arc (Group.act) вызывает act только у
    // видимых детей; root мы сами прячем в режиме «стандартное меню» и при выключенной настройке, и на нём тик
    // замирал бы навсегда - вернуться в терминал и подхватить настройку на лету было бы нельзя. Проверено на настоящем
    // клиенте: ссылка «Терминал» после перехода в стандартное меню не появлялась (мок-стенд эту особенность не знает).
    let driver = new Table();
    driver.name = "ultradustry-terminal-driver";
    driver.touchable = Touchable.disabled;
    inner.addChild(driver);
    driver.update(() => {
        if (termState.failed) {
            // терминал сломан: ссылки не нужны
            for (let i = 0; i < corners.length; i++) corners[i].holder.visible = false;
            return;
        }
        try {
            tick();
            for (let i = 0; i < corners.length; i++) corners[i].holder.visible = corners[i].showFn();
            for (let i = 0; i < wakeList.length; i++) wakeList[i].elem.visible = wakeList[i].fn();
        } catch (e) {
            termState.failed = true;
            termState.active = false;
            root.visible = false;
            for (let i = 0; i < vanilla.length; i++) vanilla[i].visible = true;
            for (let i = 0; i < corners.length; i++) corners[i].holder.visible = false;
            ulog.err("[ULTRAdustry] терминальное меню сломалось, возвращаю стандартное: " + e);
        }
    });

    // Игра запущена -> menuGroup скрыт, и driver (а с ним tick) перестаёт обновляться: вернуть фильтр атласа (см.
    // crispFilterOn) надо отсюда, из обновления, которое идёт всегда.
    Events.run(Trigger.update, () => { if (crispFiltered != null && !Vars.state.isMenu()) crispFilterOff(); });

    ulog.info("[ULTRAdustry] терминальное главное меню готово (прячу ванильных элементов: " + vanilla.length + ")");
    return true;
}

// --- собственный плавный микшер, без участия SoundControl.playMusic ---
//
// Голос (voice) = один играющий файл со своей громкостью gain (0..1). Сцена (scene) = что должно
// звучать сейчас (пара сектора / тема стража / тихая тема / трек окна). Каждый кадр сцена выставляет
// голосам целевую громкость (targets), а микшер плавно подтягивает gain к цели за FADE_SECONDS.
// Голос с gain 0 и целью 0 останавливается, КРОМЕ голосов пары (keep): calm и combat одного
// сектора запускаются вместе и играют синхронно (у пар одинаковая длина), поэтому переключение
// calm <-> combat — это просто перекрёстный fade без разрыва по времени.

const voices = {};            // имя файла -> {name, music, gain, keep, loop, age}
const MAX_OPEN_MUSIC = 10;    // сколько открытых файлов держим про запас
// ...и не больше стольки байт: файл, открытый из памяти, весит в нативной памяти ≈ свой размер (см. loadMusicFile). Рабочий набор —
// тема стража (3 файла по 5-19 МБ) + пара (2 файла) ≈ 40-70 МБ; сверху про запас. Нужные сцене и играющие файлы не выгружаем никогда.
const OPEN_BYTES_BUDGET = 96 * 1048576;
const STARTUP_DELAY_SECONDS = 4;    // пауза после захода на карту, прежде чем мод решит, что включать
const PEACE_ROTATE_SECONDS = 240;   // как часто менять тихую тему, если затишье длится долго
const PVP_ROTATE_SECONDS = 420;     // как часто менять тему PvP (если скачано больше одной)
const PAIR_WAIT_SECONDS = 25;       // сколько ждать скачивания пары своего тира, прежде чем играть любую другую

// Файл экрана схем/БД/исследований, играющий ПОВЕРХ сцены (null = такого экрана нет). Выставляется каждый кадр в musicTick.
let overlayFile = null;

function newScene(){ return {key: null, kind: null, targets: {}, phase: 0, d: null, pre: false, introAllowed: true, loopGain: 0, introStart: 0, introMs: 0}; }
let scene = newScene();

function newSession(){
    return {
        t: 0,                // секунд с захода на карту
        pair: null,          // выбранная на всю сессию пара {id, calm, combat}
        want: null,          // пара своего тира, которую ждём (если ничего не скачано)
        waitSince: 0,
        peaceFile: null, peaceSince: 0, peaceAsked: false,
        pvp: null,           // выбранная тема PvP {id, since}
        pvpWant: null,       // тема PvP, которую ждём, пока ничего не скачано
        pvpWaitSince: 0,
        prefetched: false, hinted: false,
        bossAsked: {},
        waveAt: -1000,       // session.t последней волны (WaveEvent)
        waveSpawn: {},       // имя типа юнита -> session.t, когда волна заспавнила такого юнита (UnitSpawnEvent)
        waveSpawnWave: {},   // имя типа юнита -> state.wave в момент того спавна (номер волны до wave++)
        skippedWaves: {},    // номера волн (как в waveSpawnWave), запущенных досрочно («пропустить волну»): их стражу интро не нужно
        preFiles: [],        // файлы стража ближайшей волны: открыты заранее, выгружать нельзя
        speed: 1,            // скорость игры относительно реального времени (для отсчёта до волны)
        threat: 0, threatAt: -1e9  // суммарная угроза врагов и session.t её последнего пересчёта (раз в THREAT_POLL_SECONDS)
    };
}
let session = newSession();

let combatWanted = false;
let calmTimer = 0;
let peaceTimer = 0;
let wasInGame = false;

const VOLUME_PUSH_SECONDS = 0.05;   // громкость уходит в звуковой поток не чаще 20 раз в секунду
const OPEN_WAIT_SECONDS = 6;        // сколько сцена ждёт открытия файлов, прежде чем играть без необязательных
const INTRO_LEAD_MS = 5;            // петлю стража запускаем чуть раньше конца интро: на play() уходит ~11 мс

// Страж из волны: интро играет ДО волны и кончается к её началу, тема уже звучит, когда он появляется.
// Запас на докачку и открытие файлов: тему начинаем готовить за (длина её интро + PRE_PREPARE_SECONDS) до волны, сцена не меняется.
// Интро Дрона из 1-2 идёт 77 с, поэтому окно у каждой темы своё (prepareWindow).
const PRE_PREPARE_SECONDS = 40;
const PRE_LATE_TOLERANCE = 2;       // интро, которое не дотягивает до волны больше чем на столько секунд, пропускаем (опоздали / отсчёт короче интро)
const LIVE_INTRO_MAX_SECONDS = 60;  // страж уже появился: интро длиннее этого не играем (оно прошло бы поверх боя), сразу петля
// Интро должно кончиться ЧУТЬ РАНЬШЕ волны: между «мод решил запустить» и «звук в ушах» набегает задержка, которую мок и
// headless-стенд не видят: дискретность кадра (16-33 мс), передача команды звуковому потоку, play() (~11 мс), буфер вывода
// Soloud (50-250 мс, на Android больше). Опоздать хуже, чем начать петлю чуть заранее, поэтому запас с избытком; в настройках
// слайдер «Опережение интро стража» (ultradustry-boss-lead), если у кого-то всё равно рано/поздно.
const BOSS_LEAD_DEFAULT_MS = 350;
const PRE_NO_INTRO_LEAD = 3;        // у темы без интро (или пока оно открывается) петля стартует за столько секунд до волны
const PRE_REMAINING_SLACK = 3;      // отсчёт до волны вырос больше чем на столько секунд против начала предсцены -> снимаем её
const PRE_SPAWN_GRACE = 8;          // после начала волны ждём появления стража столько секунд, потом отпускаем сцену
// Волна запущена досрочно (кнопка «пропустить волну», logic.skipWave из консоли/процессора), если на прошлом тике до неё оставалось
// дольше стольких тиков (4 игровых секунды): у естественной волны там не больше шага логики (у клиента по сети - доля секунды рассинхрона).
const WAVE_SKIP_MIN_TICKS = 240;
const WAVE_SPAWN_FRESH = 20;        // юнит этого типа заспавнен волной не дольше стольких секунд назад => страж «из волны»

// Запустить голоса. Все файлы уже открыты (ensureOpen == 1). Несколько голосов (пара calm/combat)
// стартуют ОДНОЙ командой подряд — так их позиции совпадают с точностью до play() (~11 мс).
// Голос появляется в voices сразу (микшер считает его громкость), а реально заиграет через миллисекунды;
// ответ о запуске придёт в voiceStarted.
function launchVoices(specs){
    let vol = musicVolume();
    let made = [];
    let jobs = [];
    for (let i = 0; i < specs.length; i++) {
        let s = specs[i];
        let rec = opened[s.name];
        // сцена под экраном схем/БД/исследований молчит: голос, который она заводит в это время (петля после интро
        // стража, вторая фаза), стартует с нуля и нарастает уже после закрытия экрана, а не врезается поверх его музыки
        let g0 = (overlayFile != null && s.name != overlayFile) ? 0 : s.gain;
        let v = {name: s.name, music: rec.music, gain: g0, keep: !!s.keep, loop: s.loop,
            sent: Math.round(g0 * vol * 1000), startedAt: 0, length: rec.length};
        voices[s.name] = v;
        made.push(v);
        jobs.push({v: v, mus: rec.music, loop: s.loop, vol: g0 * vol});
    }
    if (DEBUG) dbg("ЗАПУСК ГОЛОСОВ: " + made.map(v => v.name + " (петля=" + v.loop + ", громкость " + fixed(v.gain * vol, 2) + ")").join(", ") + "; громкость музыки в игре " + fixed(vol, 2) + "; сцена=" + scene.key + (overlayFile != null ? "; экран=" + overlayFile : ""));
    runAudio(audioControl, () => {
        for (let i = 0; i < jobs.length; i++) {
            let j = jobs[i];
            let err = null, playing = null;
            try {
                j.mus.setLooping(j.loop);
                j.mus.setVolume(j.vol);
                j.mus.play();
                if (DEBUG) playing = !!j.mus.isPlaying();
            } catch (e) { err = DEBUG ? dbgErrText(e) : String(e); }
            let at = Time.millis();
            Core.app.post(() => voiceStarted(j.v, at, err, playing));
        }
    });
    return made;
}

function voiceStarted(v, at, err, playing){
    if (voices[v.name] !== v) { if (DEBUG) dbg("ЗАПУСК: ответ по " + v.name + " пришёл, но голос уже убран"); return; } // голос уже убрали
    if (DEBUG) dbg("ЗАПУСК итог: " + v.name + " -> " + (err != null ? "ОШИБКА " + err : "play() вернулся, isPlaying сразу после=" + playing + (playing === false ? "  <<< play() не запустил звук" : "")));
    if (err != null) {
        ulog.warn("[ULTRAdustry] не смог запустить " + v.name + ": " + (DEBUG ? String(err).split("\n")[0] : err));
        badFiles[v.name] = true; // fileOk станет ложью, сцена выберет что-то другое
        unloadMusic(v.name);
        return;
    }
    v.startedAt = at;
}

// Одиночный голос. null = файл ещё открывается (вызывающий повторит в следующем кадре) или не открылся.
function voiceStart(name, loop, startGain, keep){
    let have = voices[name];
    if (have != null) { if (keep) have.keep = true; return have; }
    if (ensureOpen(name) != 1) return null;
    return launchVoices([{name: name, loop: loop, gain: startGain, keep: keep}])[0];
}

function sceneFileNames(){
    let d = scene.d;
    if (d == null) return [];
    if (d.kind == "pair") return [d.calm, d.combat];
    if (d.kind == "boss" || d.kind == "pvp") return trackFileNames(d.theme.id);
    return [d.file];
}

function protectedFileNames(){
    let names = sceneFileNames().concat(session.preFiles);
    if (overlayFile != null) names.push(overlayFile);
    return names;
}

// Держим открытыми не больше MAX_OPEN_MUSIC файлов и не больше OPEN_BYTES_BUDGET байт в памяти; играющие, ещё открывающиеся
// и нужные сцене не трогаем (даже если из-за них бюджет превышен). Выгружаем с самых старых по порядку открытия.
function pruneLoaded(){
    let names = Object.keys(opened);
    let bytes = 0;
    for (let i = 0; i < names.length; i++) bytes += opened[names[i]].memBytes || 0;
    if (names.length <= MAX_OPEN_MUSIC && bytes <= OPEN_BYTES_BUDGET) return;
    let need = protectedFileNames();
    let count = names.length;
    for (let i = 0; i < names.length && (count > MAX_OPEN_MUSIC || bytes > OPEN_BYTES_BUDGET); i++) {
        let rec = opened[names[i]];
        if (rec == null || rec.state != 1 || voices[names[i]] != null || need.indexOf(names[i]) >= 0) continue;
        bytes -= rec.memBytes || 0;
        unloadMusic(names[i]);
        count--;
    }
}

function voiceKill(name){
    let v = voices[name];
    if (v == null) return;
    delete voices[name];
    if (DEBUG) dbg("ГОЛОС убран: " + name + " (играл " + (v.startedAt > 0 ? fixed((Number(Time.millis()) - v.startedAt) / 1000, 1) + " с" : "— не успел запуститься") + ")");
    let mus = v.music;
    runAudio(audioControl, () => { try { mus.stop(); } catch (e) {} });
    pruneLoaded();
}

function killAllVoices(){
    let names = Object.keys(voices);
    for (let i = 0; i < names.length; i++) voiceKill(names[i]);
    scene = newScene();
}

// ---------- что должно звучать ----------

// Сложность сектора — то же, что игра пишет в его описании (Sector.displayThreat):
// ступень = threat / 0.25 (low, medium, high, extreme, eradication), а у сектора с difficulty 13 —
// "unreasonable" (резерв под сектор 27). Вне кампании сектора нет -> null.
function sectorTier(){
    let s = Vars.state.getSector();
    if (s == null) return null;
    if (s.preset != null && Math.abs(Number(s.preset.difficulty) - UNREASONABLE_DIFFICULTY) < 0.001) return "unreasonable";
    let idx = Math.floor(Number(s.threat) / 0.25);
    return TIER_ORDER[Math.max(0, Math.min(idx, TIER_ORDER.length - 1))];
}

// Все пары всех списков, включая сектор 27: на пользовательских картах (выживание/атака вне кампании) сложности сектора
// нет, и там может играть любая пара.
function allPairs(){
    let all = [];
    for (let i = 0; i < POOL_TIERS.length; i++) all = all.concat(tracksData.tiers[POOL_TIERS[i]] || []);
    return all;
}

function pairPool(){
    let tier = sectorTier();
    let pool = tier != null ? POOL_OF_TIER[tier] : null;
    if (pool != null && tracksData.tiers[pool]) return tracksData.tiers[pool];
    return allPairs(); // не кампания: любые треки с любых угроз и сектора 27
}

function pairInfo(tid){
    let t = tracksData.tracks[tid];
    return {id: tid, calm: t.calm, combat: t.combat};
}

function hintOnce(key){
    if (session.hinted) return;
    session.hinted = true;
    try { Vars.ui.showInfoToast(bundleText(key), 8); } catch (e) {}
}

function currentPair(){
    let cur = session.pair;
    if (cur != null) {
        if (!pairPlayable(cur.id)) {
            session.pair = null; // файл удалили из окна загрузки или он не открылся — выбираем заново
        } else if (cur.fallback && session.want != null && pairPlayable(session.want)) {
            // играли запасную пару из чужого тира, а пара нужной сложности успела докачаться — переходим на неё
            session.pair = pairInfo(session.want);
            return session.pair;
        } else {
            return cur;
        }
    }
    let pool = pairPool();
    let ready = pool.filter(pairPlayable);
    if (ready.length > 0) { session.pair = pairInfo(randomOf(ready)); return session.pair; }

    // в тире этого сектора ничего не скачано: выбираем пару, качаем её срочно
    if (session.want == null) {
        session.want = randomOf(pool);
        session.waitSince = session.t;
        if (isAutoDownload()) { enqueue(trackFileNames(session.want), true); hintOnce("ultradustry.toast.downloading"); }
        else hintOnce("ultradustry.toast.nomusic");
    }
    let waiting = isAutoDownload() && session.t - session.waitSince < PAIR_WAIT_SECONDS
        && trackFileNames(session.want).some(isPending);
    if (waiting) return null;

    // не дождались / автозагрузка выключена: играем любую уже скачанную пару любого тира
    let any = allPairs().filter(pairPlayable);
    if (any.length > 0) {
        session.pair = pairInfo(randomOf(any));
        session.pair.fallback = true;
        return session.pair;
    }
    return null;
}

// Затишье: нет волн (песочница, захваченный сектор) либо врагов нет уже getPeaceDelay() секунд.
function peaceWanted(){
    let r = Vars.state.rules;
    if (r.pvp) return false; // в PvP бой идёт постоянно, а state.enemies там не показатель
    if (!r.waves && !r.attackMode) return true;
    return peaceTimer >= getPeaceDelay();
}

function peaceFile(){
    // Раньше список файлов тихих тем и фильтр по fileOk собирались каждый кадр затишья, хотя пока тема играет и срок
    // ротации не вышел, ответ - всегда текущий файл (первое условие ниже истинно при любом ready). Ответ тот же, без аллокаций.
    if (session.peaceFile != null && session.t - session.peaceSince < PEACE_ROTATE_SECONDS && fileOk(session.peaceFile)) return session.peaceFile;
    let all = peaceFileNames();
    let ready = all.filter(fileOk);
    if (session.peaceFile != null && fileOk(session.peaceFile)) {
        if (session.t - session.peaceSince < PEACE_ROTATE_SECONDS || ready.length < 2) return session.peaceFile;
        let others = ready.filter(n => n != session.peaceFile);
        session.peaceFile = randomOf(others);
        session.peaceSince = session.t;
        return session.peaceFile;
    }
    if (ready.length > 0) {
        session.peaceFile = randomOf(ready);
        session.peaceSince = session.t;
        return session.peaceFile;
    }
    if (isAutoDownload() && !session.peaceAsked) {
        session.peaceAsked = true;
        let dls = all.filter(n => downloadable(n) && (dl.fails[n] || 0) < 3);
        if (dls.length > 0) enqueue([randomOf(dls)], false);
    }
    return null;
}

// ---------- PvP ----------
// В PvP бой идёт постоянно и сложности сектора нет, поэтому вместо пар calm/combat играют темы из tracks.json -> pvp
// (кибергринд, Versus, Duel): интро один раз, потом петля; раз в PVP_ROTATE_SECONDS — другая скачанная тема.

function pvpPlayable(tid){
    let t = tracksData.tracks[tid];
    if (t == null || !fileOk(t.loop)) return false;
    return !t.intro || fileOk(t.intro); // интро есть в каталоге, но не докачано -> ждём, а не играем петлю без начала
}

function pvpTheme(){
    let cur = session.pvp;
    if (cur != null && !pvpPlayable(cur.id)) cur = session.pvp = null; // файл удалили / не открылся
    let ready = tracksData.pvp.filter(pvpPlayable);
    if (cur != null && (session.t - cur.since < PVP_ROTATE_SECONDS || ready.length < 2)) return themeOf(cur.id);
    if (ready.length > 0) {
        let others = ready.filter(id => cur == null || id != cur.id);
        session.pvp = {id: randomOf(others), since: session.t};
        // пока скачано меньше трёх тем, докачиваем ещё одну: разнообразие набирается само, сеть зря не жжётся
        if (isAutoDownload() && ready.length < 3 && !isAnyPending(tracksData.pvp)) {
            let miss = tracksData.pvp.filter(id => !pvpPlayable(id) && trackFileNames(id).every(n => (dl.fails[n] || 0) < 3));
            if (miss.length > 0) enqueue(trackFileNames(randomOf(miss)), false);
        }
        return themeOf(session.pvp.id);
    }
    // ничего не скачано: выбираем тему, качаем срочно, пока играет обычная пара
    let want = session.pvpWant;
    if (want != null && isAutoDownload() && !isAnyPending([want])) {
        // выбранная тема не докачалась (сбой сети): пробуем другую, которая ещё не исчерпала попытки
        let fresh = tracksData.pvp.filter(id => id != want && trackFileNames(id).every(n => (dl.fails[n] || 0) < 3));
        if (fresh.length > 0) { session.pvpWant = randomOf(fresh); enqueue(trackFileNames(session.pvpWant), true); }
    }
    if (session.pvpWant == null && tracksData.pvp.length > 0) {
        session.pvpWant = randomOf(tracksData.pvp);
        session.pvpWaitSince = session.t;
        if (isAutoDownload()) { enqueue(trackFileNames(session.pvpWant), true); hintOnce("ultradustry.toast.downloading"); }
        else hintOnce("ultradustry.toast.nomusic");
    }
    return null;
}

function isAnyPending(ids){
    for (let i = 0; i < ids.length; i++) if (trackFileNames(ids[i]).some(isPending)) return true;
    return false;
}

function guardianThemeId(unitName){
    let g = tracksData.guardians;
    return Object.prototype.hasOwnProperty.call(g, unitName) ? g[unitName] : tracksData.guardianDefault;
}

function themeOf(id){
    let t = tracksData.tracks[id];
    return {id: id, intro: t.intro || null, loop: t.loop, loop2: t.loop2 || null, introSeconds: Number(t.introSeconds) || 0};
}

function bossTheme(boss){
    return themeOf(guardianThemeId(String(boss.type.name)));
}

// Если стражей несколько, тема — у самого "жирного" (по максимальному здоровью): так выбор стабилен.
function pickBoss(){
    let list = Vars.state.teams.bosses;
    if (list == null || list.size == 0) return null;
    let best = null, bestHp = -1;
    for (let i = 0; i < list.size; i++) {
        let u = list.get(i);
        let hp = Number(u.maxHealth);
        if (best == null || hp > bestHp) { best = u; bestHp = hp; }
    }
    return best;
}

// Один раз за сессию: заранее докачать темы стражей, которые встретятся в ближайших волнах этого сектора.
function bossPrefetchNames(){
    let names = [];
    try {
        let spawns = Vars.state.rules.spawns;
        let wave = Number(Vars.state.wave);
        for (let i = 0; i < spawns.size; i++) {
            let g = spawns.get(i);
            if (g.effect == null || String(g.effect.name) != "boss") continue;
            if (Number(g.begin) > wave + 25) continue; // страж из далёких волн — докачаем, когда приблизится
            let fs = trackFileNames(guardianThemeId(String(g.type.name)));
            for (let j = 0; j < fs.length; j++) if (names.indexOf(fs[j]) < 0) names.push(fs[j]);
        }
    } catch (e) { ulog.warn("[ULTRAdustry] не смог посмотреть волны сектора: " + e); }
    return names;
}

function prefetchSession(){
    if (session.prefetched) return;
    session.prefetched = true;
    if (!isAutoDownload()) return;
    let names = bossPrefetchNames();

    // Тихие темы: одну докачиваем за заход, пока скачанных меньше трёх —
    // так без всякой возни в окне загрузки набирается разнообразие, а сеть не жжётся впустую.
    let peaceDl = peaceFileNames().filter(downloadable);
    if (peaceDl.filter(fileOk).length < 3) {
        let miss = peaceDl.filter(n => !fileOk(n) && (dl.fails[n] || 0) < 3);
        if (miss.length > 0) names.push(randomOf(miss));
    }
    enqueue(names, false);
}

// Файл музыки открытого экрана схем / базы данных / исследований (или null). Это НЕ сцена, а оверлей поверх неё:
// раньше экран подменял сцену целиком, и при закрытии она создавалась заново - интро стража проигрывалось ещё раз,
// петля и тихая тема начинались с нуля (у пары голоса keep, поэтому ей везло). Теперь сцена под экраном живёт как жила
// (её часы идут, голоса не убиваются), просто молчит; закрыли экран - она возвращается плавным fade-ом с того же места.
//
// Какой экран открыт, спрашиваем не каждый кадр, а раз в SPECIAL_POLL_SECONDS: каждая проверка - три вызова Java-моста
// (Vars.ui, поле-диалог, isShown), а их три штуки; задержка в 50 мс при открытии/закрытии экрана на кроссфейде не слышна.
// dt - длина кадра (как в musicTick, уже ограничена 0,1 с, то есть на медленных кадрах опрос идёт каждый кадр); без dt - сразу.
const SPECIAL_POLL_SECONDS = 0.05;
let specialPollAcc = 1e9;
let specialKeyCached = null;

function specialFile(dt){
    let sp = tracksData.special;
    if (!sp) return null;
    specialPollAcc += dt > 0 ? dt : 1e9;
    if (specialPollAcc >= SPECIAL_POLL_SECONDS) {
        specialPollAcc = 0;
        let shown = null;
        if (Vars.ui.schematics.isShown()) shown = "schematics";
        else if (Vars.ui.database.isShown()) shown = "database";
        else if (Vars.ui.research.isShown()) shown = "research";
        specialKeyCached = shown;
    }
    let key = specialKeyCached;
    if (key == null || !sp[key] || !fileOk(sp[key])) return null;
    return sp[key];
}

// Префетч (темы стражей из волн, одна тихая тема) ставим в очередь только когда уже выбрана сцена:
// загрузка идёт по одному файлу, и фоновый файл не должен занять слот раньше срочной пары/стража.
function desiredScene(){
    let d = pickScene();
    if (d != null) prefetchSession();
    return d;
}

// ---------- страж ближайшей волны: интро ДО неё ----------
//
// Волна со стражем идёт по отсчёту (state.wavetime): интро должно кончиться ровно к её началу, и тема стража уже
// звучит, когда он появляется. Поэтому за PRE_PREPARE_SECONDS мы докачиваем и открываем его файлы (сцена пока та же —
// играет пара), а за длину интро до волны включаем «предсцену» стража без самого стража (boss: null, pre: true).
// Страж, которого создал игрок (консоль, песочница) или который уже стоял на карте, интро НЕ получает: тема сразу.

// Тема стража для волны с индексом wave (как у WaveSpawner: state.wave - 1). Кэш: перебирать все группы каждый кадр дорого.
let upcomingCache = {wave: -1, size: -1, theme: null};

function bossThemeOfWave(wave){
    let spawns = Vars.state.rules.spawns;
    let size = Number(spawns.size);
    if (upcomingCache.wave === wave && upcomingCache.size === size) return upcomingCache.theme;
    let best = null, bestHp = -1;
    for (let i = 0; i < size; i++) {
        let g = spawns.get(i);
        if (g.type == null || g.effect == null || String(g.effect.name) != "boss") continue;
        if (Number(g.getSpawned(wave)) <= 0) continue;
        let hp = Number(g.type.health);
        if (best == null || hp > bestHp) { best = g; bestHp = hp; }
    }
    let theme = null;
    if (best != null) {
        let id = guardianThemeId(String(best.type.name));
        if (tracksData.tracks[id]) theme = themeOf(id);
    }
    upcomingCache = {wave: wave, size: size, theme: theme};
    return theme;
}

// {theme, remaining} — страж в следующей волне и сколько секунд (по часам, с поправкой на скорость игры) до неё;
// null — волны идут не по отсчёту, отсчёт стоит, либо стража в ближайшей волне нет или он ещё далеко.
function upcomingBoss(){
    let st = Vars.state, r = st.rules;
    if (!r.waves || !r.waveTimer || r.pvp || r.editor) return null;
    let remaining = Number(st.wavetime) / 60 / session.speed;
    if (remaining > PRE_PREPARE_SECONDS + tracksData.maxIntro) return null;   // далеко даже для самого длинного интро: не смотрим
    try { if (Vars.logic.isWaitingWave()) return null; } catch (e) {}   // отсчёт стоит, пока враги живы (waitEnemies)
    let th = bossThemeOfWave(Number(st.wave) - 1);
    if (th == null || remaining > prepareWindow(th)) return null;
    return {theme: th, remaining: remaining};
}

// За сколько секунд до волны тема стража начинает готовиться: её интро + запас на докачку/открытие.
function prepareWindow(th){
    return PRE_PREPARE_SECONDS + (th.intro ? th.introSeconds : 0);
}

// Докачать (срочно) и заранее открыть файлы стража, чтобы предсцена стартовала мгновенно.
function prepareBossTheme(th){
    session.preFiles = trackFileNames(th.id);
    if (isAutoDownload() && !session.bossAsked[th.id]) {
        session.bossAsked[th.id] = true;
        enqueue(trackFileNames(th.id), true);
    }
    if (fileOk(th.loop)) ensureOpen(th.loop);
    if (th.intro && fileOk(th.intro)) ensureOpen(th.intro);
    if (th.loop2 && fileOk(th.loop2)) ensureOpen(th.loop2);
}

// За сколько секунд до волны включать предсцену: длина интро (если файл уже открыт) + запас на запуск.
function preLead(th){
    if (th.intro && fileOk(th.intro)) {
        let r = opened[th.intro];
        if (r != null && r.state == 1 && r.length > 0.5) return r.length + getBossLeadMs() / 1000;
    }
    return PRE_NO_INTRO_LEAD;
}

function preBossScene(){
    // текущая сцена — предсцена, на которую живой страж ещё не пришёл (когда он придёт, scene.d заменится на d с boss)
    let cur = (scene.kind == "boss" && scene.d != null && scene.d.pre === true && scene.d.boss == null) ? scene.d : null;
    if (cur != null && session.waveAt >= scene.since) {
        // волна уже пришла (state.wave шагнул вперёд): ждём появления стража, но недолго — вдруг он не создался
        return (session.t - session.waveAt < PRE_SPAWN_GRACE) ? cur : null;
    }
    let up = upcomingBoss();
    if (up == null || (cur != null && up.theme.id != cur.theme.id)) {
        session.preFiles = [];
        return null;       // отсчёт встал / правила изменились / волна стала другой: предсцену снимаем
    }
    let th = up.theme;
    prepareBossTheme(th);
    if (!fileOk(th.loop)) return null;      // тема ещё качается — предсцены не будет, дальше обычный путь по появлению стража
    let lead = preLead(th);
    if (cur != null) {
        // отсчёт убежал вверх (его сбросили, поставили на паузу правилами…) — не играем петлю десятки секунд зря
        return up.remaining > lead + PRE_REMAINING_SLACK ? null : cur;
    }
    // интро, которое уже не доиграть до волны (отсчёт короче интро, тему докачали поздно), пропускаем:
    // тема стартует за PRE_NO_INTRO_LEAD секунд до волны, как у темы без интро (bossUpdate при запуске проверит то же самое)
    if (lead > PRE_NO_INTRO_LEAD && up.remaining < lead - PRE_LATE_TOLERANCE) lead = PRE_NO_INTRO_LEAD;
    if (up.remaining <= lead) return {key: "boss:" + th.id, kind: "boss", theme: th, boss: null, pre: true};
    return null;
}

// Юнита такого типа только что заспавнила волна (UnitSpawnEvent)? Эффект «страж» накладывается уже после этого события,
// поэтому смотрим на тип юнита, а не на сам статус.
function spawnedByWave(boss){
    try {
        let t = session.waveSpawn[String(boss.type.name)];
        return t !== undefined && session.t - t < WAVE_SPAWN_FRESH;
    } catch (e) { return false; }
}

// Эту волну запустили досрочно? Тип стража -> номер волны, которая его заспавнила (UnitSpawnEvent) -> помечена ли она в noteWaveSkip.
function spawnedBySkippedWave(boss){
    try {
        let w = session.waveSpawnWave[String(boss.type.name)];
        return w !== undefined && session.skippedWaves[w] === true;
    } catch (e) { return false; }
}

function pickScene(){
    if (!Vars.state.isGame()) return null; // в меню/редакторе музыкой занимается сам движок (menu.ogg/editor.ogg)
    if (Vars.state.rules.editor || Vars.ui.editor.isShown()) return null;
    if (session.t < STARTUP_DELAY_SECONDS) return null; // ещё не осмотрелись — не включаем ничего
    if (musicVolume() <= 0) return null;

    let boss = pickBoss();
    if (boss != null) {
        let th = bossTheme(boss);
        if (isAutoDownload() && !session.bossAsked[th.id]) {
            session.bossAsked[th.id] = true;
            enqueue(trackFileNames(th.id), true); // страж уже здесь — нужна срочно
        }
        if (fileOk(th.loop)) return {key: "boss:" + th.id, kind: "boss", theme: th, boss: boss};
    }
    let pre = preBossScene();
    if (pre != null) return pre;

    if (Vars.state.rules.pvp) {
        let pt = pvpTheme();
        if (pt != null) return {key: "pvp:" + pt.id, kind: "pvp", theme: pt};
        // тема PvP ещё качается: пока играет обычная пара (ниже)
    }

    if (peaceWanted()) {
        let f = peaceFile();
        if (f != null) return {key: "peace:" + f, kind: "peace", file: f};
    }

    let p = currentPair();
    if (p != null) return {key: "pair:" + p.id, kind: "pair", calm: p.calm, combat: p.combat};
    return null;
}

// ---------- сцены ----------

function enterScene(d){
    scene = {key: d == null ? null : d.key, kind: d == null ? null : d.kind, targets: {}, phase: 0, d: d, since: session.t,
        pre: false, introAllowed: true, introCut: false, loopGain: 0, introStart: 0, introMs: 0};
    if (DEBUG) dbg("СЦЕНА: " + (d == null ? "нет (тишина мода)" : d.key + " (" + d.kind + (d.kind == "pair" ? ": calm=" + d.calm + " combat=" + d.combat : "") + ")") + ", с захода на карту прошло " + fixed(session.t, 1) + " с");
    if (d == null) return;
    if (d.kind == "boss") {
        // интро — только стражу из волны: его предсцене либо тому, кого волна заспавнила секунды назад
        scene.pre = d.pre === true;
        // (страж из пропущенной волны не ждал отсчёта - интро ему не играем, тема сразу)
        scene.introAllowed = scene.pre || (spawnedByWave(d.boss) && !spawnedBySkippedWave(d.boss));
    }
    if (d.kind == "pvp") scene.introAllowed = true; // интро темы PvP — один раз при её включении
    if (d.kind == "pair") {
        // "тихие" голоса прежней пары больше не нужны — пусть затухнут и остановятся
        let names = Object.keys(voices);
        for (let i = 0; i < names.length; i++) {
            if (names[i] != d.calm && names[i] != d.combat) voices[names[i]].keep = false;
        }
    }
    // Сами голоса заводит updateScene (каждый кадр, пока файлы не откроются в фоне): enterScene только
    // выбирает сцену, а открытие файла ~170 мс и в главном потоке его ждать нельзя.
}

function bossHealthFraction(boss){
    try { return Number(boss.health) / Math.max(1, Number(boss.maxHealth)); }
    catch (e) { return 1; }
}

// Интро длиной len секунд успеет прозвучать как задумано? До волны (предсцена) оно должно кончиться к её началу; когда страж
// уже появился (или волна уже прошла) — не должно тянуться поверх боя; в PvP играет всегда.
function introFits(len){
    if (scene.kind == "pvp") return true;
    if (scene.pre && session.waveAt < scene.since) {
        let remaining = Number(Vars.state.wavetime) / 60 / session.speed;
        return remaining >= len - PRE_LATE_TOLERANCE;
    }
    return len <= LIVE_INTRO_MAX_SECONDS;
}

function bossUpdate(T){
    let th = scene.d.theme;
    if (scene.phase == 0) {
        // Интро проигрывается один раз и сразу на полной громкости; на его конце петля стартует без fade.
        // Конец интро ловим по часам: play() вернулся в момент startedAt, длина известна с открытия
        // файла (getLength) — опрашивать позицию у звукового потока каждый кадр нельзя, это и есть лаги.
        let loopState = ensureOpen(th.loop);
        if (loopState < 0) return; // pickScene выберет другую сцену, как только fileOk(петли) станет ложью
        let introState = (scene.introAllowed && th.intro && fileOk(th.intro)) ? ensureOpen(th.intro) : -1;
        let waited = session.t - scene.since;
        if (loopState == 0 || (introState == 0 && waited < OPEN_WAIT_SECONDS)) return; // файлы ещё открываются
        let irec = introState == 1 ? opened[th.intro] : null;
        let iv = voices[th.intro];
        if (iv == null && irec != null && !scene.introTried && !introFits(irec.length)) {
            scene.introAllowed = false; // интро не доиграть вовремя — петля без него (с fade-ом, а не врезкой)
            scene.introSkipped = true;
            irec = null;
        }
        if (iv == null && irec != null && irec.length > 0.5 && !scene.introTried) {
            scene.introTried = true;
            launchVoices([{name: th.intro, loop: false, gain: 1, keep: false}]);
            T[th.intro] = 1;
            return;
        }
        if (iv != null && !scene.introCut) {
            T[th.intro] = 1;
            if (iv.startedAt > 0 && !scene.introStart) { scene.introStart = iv.startedAt; scene.introMs = iv.length * 1000; }
            let ended = iv.startedAt > 0 && (Time.millis() - iv.startedAt) >= iv.length * 1000 - INTRO_LEAD_MS;
            if (!ended) return;
        }
        // Интро кончилось (или его нет / не открылось) — петля. Интро в T не попадает: догорает fade-ом и умирает.
        scene.phase = 1;
        // после интро и у стража без интро (создан игроком) петля сразу на полной; тема без интро у стража волны — с fade-ом
        // оборванное интро (волну пропустили, пока оно играло) в T не попало - догорает fade-ом, а петля нарастает ему навстречу
        scene.loopGain = scene.introCut ? (iv != null ? 0 : 1) : ((iv != null || (!scene.introAllowed && !scene.introSkipped)) ? 1 : 0);
        voiceStart(th.loop, true, scene.loopGain, false);
    }
    if (scene.phase == 1) {
        T[th.loop] = 1;
        if (voices[th.loop] == null) voiceStart(th.loop, true, scene.loopGain, false);
        if (th.loop2 && fileOk(th.loop2)) {
            ensureOpen(th.loop2); // открываем заранее, чтобы переход на 50% хп был мгновенным
            if (scene.d.boss != null && bossHealthFraction(scene.d.boss) <= 0.5) scene.phase = 2; // вторая фаза: назад не возвращаемся
        }
    }
    if (scene.phase == 2) {
        if (voices[th.loop2] == null) voiceStart(th.loop2, true, 0, false);
        let ready = voices[th.loop2] != null;
        T[th.loop2] = 1;
        T[th.loop] = ready ? 0 : 1; // пока вторая фаза не открылась, первая играет дальше
    }
}

// Пара calm+combat: оба файла должны быть открыты, тогда стартуют вместе (иначе позиции разойдутся).
function startPair(d){
    let hasCalm = voices[d.calm] != null, hasCombat = voices[d.combat] != null;
    if (hasCalm != hasCombat) { // остался один из двух — рассинхрон, начинаем заново
        voiceKill(hasCalm ? d.calm : d.combat);
        return;
    }
    let sc = ensureOpen(d.calm), sb = ensureOpen(d.combat);
    if (sc != 1 || sb != 1) return;
    launchVoices([{name: d.calm, loop: true, gain: 0, keep: true}, {name: d.combat, loop: true, gain: 0, keep: true}]);
}

function updateScene(){
    let d = scene.d;
    let T = {};
    if (d != null) {
        if (d.kind == "pair") {
            if (voices[d.calm] == null || voices[d.combat] == null) startPair(d);
            if (voices[d.combat] != null) {
                T[d.calm] = combatWanted ? 0 : 1;
                T[d.combat] = combatWanted ? 1 : 0;
            } else {
                T[d.calm] = 1;
            }
            if (voices[d.calm] != null) voices[d.calm].keep = true;
            if (voices[d.combat] != null) voices[d.combat].keep = true;
        } else if (d.kind == "peace") {
            if (voices[d.file] == null) voiceStart(d.file, true, 0, false); // нет голоса — файл ещё открывается
            T[d.file] = 1;
        } else if (d.kind == "boss" || d.kind == "pvp") {
            bossUpdate(T); // тема PvP живёт по тем же фазам, что и тема стража: интро -> петля
        }
    }
    scene.targets = T;
    // Экран схем/БД/исследований: его файл запускаем сами (нет голоса - файл ещё открывается, повторим в следующем кадре).
    // Громкость ему и приглушение сцены выставляет applyVoices.
    if (overlayFile != null && voices[overlayFile] == null) voiceStart(overlayFile, true, 0, false);
}

let volumeTimer = 0;

function applyVoices(dt){
    let vol = musicVolume();
    let step = dt / FADE_SECONDS;
    // fade считаем каждый кадр, а в звуковой поток громкость отправляем раз в 50 мс и только если она
    // изменилась (у тихого партнёра пары и у голосов на постоянной громкости — вообще никаких вызовов)
    volumeTimer += dt;
    let push = volumeTimer >= VOLUME_PUSH_SECONDS;
    if (push) volumeTimer = 0;
    let names = Object.keys(voices);
    for (let i = 0; i < names.length; i++) {
        let v = voices[names[i]];
        if (v == null) continue;
        let tgt = scene.targets[v.name];
        // голос, которого сцена хочет (даже с целью 0), не убиваем, пока на нём лежит экран: иначе после закрытия он
        // начнётся заново (интро стража, петля, тихая тема)
        let held = tgt !== undefined && v.name != overlayFile;
        if (v.name == overlayFile) tgt = 1;
        else if (overlayFile != null) tgt = 0;   // сцена под экраном схем/БД/исследований молчит, но продолжает идти
        else if (tgt === undefined) tgt = 0;
        if (v.gain < tgt) v.gain = Math.min(tgt, v.gain + step);
        else if (v.gain > tgt) v.gain = Math.max(tgt, v.gain - step);
        if (v.gain <= 0 && tgt <= 0 && !v.keep && !(held && overlayFile != null)) { voiceKill(v.name); continue; }
        let q = Math.round(v.gain * vol * 1000);
        if (push && q !== v.sent) {
            v.sent = q;
            let mus = v.music;
            let val = q / 1000;
            runAudio(audioControl, () => { try { mus.setVolume(val); } catch (e) {} });
        }
    }
}

// ---------- главный цикл ----------

Events.on(WaveEvent, e => {
    session.waveAt = session.t; // нужно предсцене стража, даже если переключение calm/combat по волнам выключено
    if (!noteWaveSkip()) logIntroSlack();   // у пропущенной волны «запас интро» не имеет смысла
    // с каждой волной просматриваем вперёд: страж из далёкой волны, которая приблизилась, докачивается заранее
    try { if (tracksData != null && isAutoDownload()) enqueue(bossPrefetchNames(), false); } catch (ex) {}
    if (!isWaveSwitchEnabled()) return;
    combatWanted = true;
    calmTimer = 0;
});

// Волну запустили досрочно? Движок при «пропустить волну» (Logic.skipWave = runWave) спавнит юнитов, делает wave++ и сразу
// сбрасывает отсчёт на полный, так что к самому событию отсчёта уже не видно: смотрим на то, что мы видели на прошлом тике
// (rateProbe.wt; -1 = замера нет, тогда считаем волну обычной). У естественной волны там не больше шага логики.
// Пропущенной волне стража не нужен разгон интро: его тема стартует сразу (см. enterScene), а если интро предсцены уже
// играет (отсчёт был в окне стража), его обрываем - bossUpdate докрутит переход на петлю.
function noteWaveSkip(){
    try {
        let before = Number(rateProbe.wt);
        if (!(before > WAVE_SKIP_MIN_TICKS)) return false;
        session.skippedWaves[Number(Vars.state.wave) - 1] = true;   // спавн юнитов был ДО wave++ (так же ключует UnitSpawnEvent)
        let cut = scene.kind == "boss" && scene.pre && scene.phase == 0;
        if (cut) { scene.introAllowed = false; scene.introCut = true; }
        ulog.info("[ULTRAdustry] волна пропущена (до неё оставалось ещё " + Math.round(before / 60) + " игровых с): тема стража без интро" + (cut ? ", интро предсцены оборвано" : ""));
        return true;
    } catch (e) { return false; }
}

// Сколько мс интро стража не дотянуло до волны / успело кончиться заранее — по часам мода, без задержки вывода звука
// (её не измерить). Строка нужна, чтобы по логу подобрать слайдер «Опережение интро стража».
function logIntroSlack(){
    try {
        if (scene.kind != "boss" || !(scene.introStart > 0)) return;
        let slack = Math.round(Number(Time.millis()) - (scene.introStart + scene.introMs));
        ulog.info("[ULTRAdustry] интро стража " + (slack >= 0 ? "кончилось за " + slack + " мс до волны" : "ещё играло, когда пришла волна (не хватило " + (-slack) + " мс)")
            + "; опережение " + getBossLeadMs() + " мс, скорость отсчёта x" + fixed(session.speed, 2));
    } catch (e) {}
}

// Каждого юнита, которого заспавнила волна (событие приходит ДО эффекта «страж»), запоминаем по имени типа: так мы
// отличаем стража волны (ему положено интро) от того, кого создал игрок или кто уже стоял на карте (тема сразу).
try {
    Events.on(UnitSpawnEvent, e => {
        try {
            let nm = String(e.unit.type.name);
            session.waveSpawn[nm] = session.t;
            session.waveSpawnWave[nm] = Number(Vars.state.wave);   // номер волны ДО wave++ (runWave: spawnEnemies, потом wave++)
        } catch (ex) {}
    });
} catch (e) { ulog.warn("[ULTRAdustry] нет события UnitSpawnEvent, страж из волны будет без интро: " + e); }

function resetSession(){
    session = newSession();
    upcomingCache = {wave: -1, size: -1, theme: null};
    rateProbe = {wave: -1, wt: -1, ms: 0, game: 0, wall: 0};
    combatWanted = false;
    calmTimer = 0;
    peaceTimer = 0;
}

let tickErrors = 0;
let mixerDisabled = false;

// Игровых секунд отсчёта до волны на реальную секунду (1 — обычная скорость). Меряем ПРЯМО по убыли state.wavetime за
// настоящее время, а не по Time.delta / getDeltaTime(): те берутся из одного источника и почти всегда дают 1, тогда как
// форк клиента может ускорять игру иначе (несколько шагов логики за кадр), а интро идёт по часам. Окна ≥1 с, EMA.
let rateProbe = {wave: -1, wt: -1, ms: 0, game: 0, wall: 0};

function trackCountdownRate(){
    try {
        let wt = Number(Vars.state.wavetime), wave = Number(Vars.state.wave), ms = Number(Time.millis());
        let p = rateProbe;
        if (p.wave === wave && p.wt >= 0 && ms > p.ms) {
            let drop = (p.wt - wt) / 60;              // игровых секунд, съеденных отсчётом с прошлого тика
            let wall = (ms - p.ms) / 1000;
            // стоит / сброшен вверх / скачок вниз (консоль, правила) / подвисание — выборку не берём: отсчёт не может убывать быстрее ~20x
            if (drop > 0 && wall < 0.5 && drop <= wall * 20 + 0.05) { p.game += drop; p.wall += wall; }
            if (p.wall >= 1) {
                let k = Math.max(0.05, Math.min(16, p.game / p.wall));
                session.speed += (k - session.speed) * 0.5;
                p.game = 0; p.wall = 0;
            }
        } else { p.game = 0; p.wall = 0; }
        p.wave = wave; p.wt = wt; p.ms = ms;
    } catch (e) {}
}

// ---------- угроза врагов ----------
// Боевая музыка включается не от ЧИСЛА врагов, а от их УГРОЗЫ: у каждого типа юнита свои очки, у Т1 мелкие, у Т5 крупные,
// и сравнивается сумма по всем живым врагам. Так один Reign (75) вызывает бой, а десять Flare (10) при пороге 12 - нет.
// Очки по тирам растут примерно втрое за ступень: это сила юнита (корень из здоровья на урон в секунду, в «даггерах» -
// Dagger = 1): Dagger 1, Mace 6, Fortress 3,4, Scepter 26, Reign 85. Для ванили берём точный тир по имени (оценка урона
// у юнитов шумная: у Mace 400 в секунду против 80 у Fortress, а тир у Fortress выше), для чужих юнитов из модов - ту же
// формулу «корень из здоровья на урон», она на ванили даёт 1-2 для Т1, 25-40 для Т4, 60-90 для Т5.
const THREAT_BY_TIER = [1, 3, 8, 25, 75];          // очки угрозы Т1..Т5
const TIER_UNITS = [
    ["dagger", "nova", "crawler", "flare", "mono", "risso", "retusa", "stell", "merui", "elude", "evoke"],
    ["mace", "pulsar", "atrax", "horizon", "poly", "minke", "oxynoe", "locus", "cleroi", "avert", "incite"],
    ["fortress", "quasar", "spiroct", "zenith", "mega", "bryde", "cyerce", "precept", "anthicus", "obviate", "emanate"],
    ["scepter", "vela", "arkyid", "antumbra", "quad", "sei", "aegires", "vanquish", "tecta", "quell"],
    ["reign", "corvus", "toxopid", "eclipse", "oct", "omura", "navanax", "conquer", "collaris", "disrupt"]
];
const THREAT_DAGGER_POWER = 79;       // sqrt(150 здоровья * 41.5 урона в секунду) у Dagger: единица шкалы формулы
const THREAT_MIN_DPS = 20;            // у юнитов без оружия (поддержка) урон считаем как у слабого, иначе их угроза была бы нулевой
const THREAT_POLL_SECONDS = 0.5;      // как часто пересчитываем сумму: боевая музыка переключается кроссфейдом 2 с и выходит из боя с гистерезисом 6 с, так что полсекунды запаздывания не слышно, а проход по врагам (каждый юнит = вызовы Java-моста, в Rhino на телефоне дорогие) вдвое реже
const THREAT_MIN = 0.5, THREAT_MAX = 100;

let threatTierOf = {};
for (let ti = 0; ti < TIER_UNITS.length; ti++) {
    for (let tj = 0; tj < TIER_UNITS[ti].length; tj++) threatTierOf["u:" + TIER_UNITS[ti][tj]] = ti;   // префикс: имя юнита не должно совпасть с toString/constructor объекта
}
let threatCache = {};      // имя типа -> очки (тип юнита не меняется за игру, а в сумму он входит сотни раз)

function estimateThreat(type){
    let hp = 0, dps = 0;
    try { hp = Number(type.health); } catch (e) {}
    try { dps = Number(type.estimateDps()); } catch (e) { try { dps = Number(type.dpsEstimate); } catch (e2) {} }
    if (!(hp > 0)) hp = 1;
    if (!(dps > THREAT_MIN_DPS)) dps = THREAT_MIN_DPS;
    return Math.max(THREAT_MIN, Math.min(THREAT_MAX, Math.sqrt(hp * dps) / THREAT_DAGGER_POWER));
}

// Очки угрозы одного юнита этого типа.
function unitThreat(type){
    let name = "";
    try { name = String(type.name); } catch (e) {}
    let key = "u:" + name;
    let c = threatCache[key];
    if (c !== undefined) return c;
    let v = threatTierOf[key] !== undefined ? THREAT_BY_TIER[threatTierOf[key]] : estimateThreat(type);
    if (name != "") threatCache[key] = v;
    return v;
}

// Суммарная угроза живых врагов: тот же отбор, что у движка для state.enemies (юниты волновой команды, которые isEnemy).
// На клиенте чужого сервера в списках юнитов лежат не все (дальние не присылаются), а state.enemies приходит с сервера
// целиком - недостающих считаем «средними» из тех, что видим (или по Т1, если не видим никого).
//
// Откуда берём юнитов. Быстрый путь - waveTeam.data().units (Teams.TeamData.units): движок пересобирает этот список раз
// в логический кадр (Teams.updateTeamStats, из Groups.unit, в том же порядке) ДО Trigger.update, так что в нём ровно те же юниты
// волновой команды, но без юнитов игрока и прочих команд, которых на поздних волнах сотни; прежний проход по всему
// Groups.unit тратил на каждого юнита чужой команды ещё 3 вызова моста (index, team, id) только ради «не наш». Порядок
// слагаемых тот же, поэтому и сумма бит-в-бит та же. countType(type)*unitThreat(type) НЕ берём: typeCounts считает ещё и
// юнитов внутри грузов (payload) - их нет в Groups.unit, сумма разошлась бы. Если быстрый путь упал (другая версия
// движка / мод подменил API) - один раз пишем в лог и возвращаемся к старому проходу по Groups.unit.
let threatSeen = 0;            // сколько врагов насчитал последний проход (второй результат функций ниже)
let threatFastBroken = false;

function threatFromTeamData(waveTeam){
    let units = waveTeam.data().units;
    let n = Number(units.size);
    let seen = 0, sum = 0;
    for (let i = 0; i < n; i++) {
        let u = units.get(i);
        if (u == null || !u.isEnemy()) continue;
        sum += unitThreat(u.type);
        seen++;
    }
    threatSeen = seen;
    return sum;
}

function threatFromGroups(waveTeam){
    let tid = Number(waveTeam.id);
    let list = Groups.unit;
    let n = Number(list.size());
    let seen = 0, sum = 0;
    for (let i = 0; i < n; i++) {
        let u = list.index(i);
        if (u == null || Number(u.team.id) !== tid || !u.isEnemy()) continue;
        sum += unitThreat(u.type);
        seen++;
    }
    threatSeen = seen;
    return sum;
}

function enemyThreat(){
    let waveTeam = Vars.state.rules.waveTeam;
    let sum = 0;
    let done = false;
    if (!threatFastBroken) {
        try { sum = threatFromTeamData(waveTeam); done = true; }
        catch (e) {
            threatFastBroken = true;
            ulog.warn("[ULTRAdustry] угроза: список юнитов команды недоступен (" + e + "), считаю по всем юнитам карты");
        }
    }
    if (!done) sum = threatFromGroups(waveTeam);
    let seen = threatSeen;
    try {
        let total = Number(Vars.state.enemies);
        if (Vars.net != null && Vars.net.client() && total > seen) sum += (total - seen) * (seen > 0 ? sum / seen : THREAT_BY_TIER[0]);
    } catch (e) {}
    return sum;
}

// Число с d знаками после запятой. Number.prototype.toFixed в Rhino (проверено на движке 159.7): округляет до d+1 ЗНАЧАЩИХ
// цифр, а не до d знаков после запятой: (75).toFixed(1) = "80.0", (123.4).toFixed(2) = "120.00". Node этого не ловит.
function fixed(x, d){
    let k = Math.pow(10, d);
    let s = String(Math.round(x * k) / k);
    let dot = s.indexOf(".");
    if (d <= 0) return dot < 0 ? s : s.substring(0, dot);
    if (dot < 0) { dot = s.length; s += "."; }
    while (s.length - dot - 1 < d) s += "0";
    return s;
}

// Угроза с кэшем на THREAT_POLL_SECONDS; без врагов - ноль сразу, без перебора.
function currentThreat(enemies){
    if (!(enemies > 0)) { session.threat = 0; session.threatAt = -1e9; return 0; }
    if (session.t - session.threatAt >= THREAT_POLL_SECONDS || session.threatAt > session.t) {
        session.threat = enemyThreat();
        session.threatAt = session.t;
    }
    return session.threat;
}

function musicTick(){
    let dt = Math.min(0.1, Time.delta / 60);
    pumpDownloads();
    slotAcc += dt;
    if (slotAcc >= SLOT_CHECK_SECONDS) { slotAcc = 0; applyMusicSlots(); }
    trackCountdownRate();

    if (Vars.state.isGame()) {
        if (!wasInGame) { wasInGame = true; resetSession(); if (DEBUG) dbgEnterGame(); }
        session.t += dt;

        let enemies = Vars.state.enemies;
        let threat = currentThreat(enemies);
        if (enemies > 0 && threat >= getThreatThreshold()) {
            if (!combatWanted) ulog.info("[ULTRAdustry] бой: угроза врагов " + fixed(threat, 1) + " (юнитов " + enemies + ") >= порога " + getThreatThreshold());
            combatWanted = true;
            calmTimer = 0;
        } else if (combatWanted) {
            calmTimer += dt;
            if (calmTimer >= 6) {
                combatWanted = false;
                ulog.info("[ULTRAdustry] бой кончился: угроза врагов " + fixed(threat, 1) + " (юнитов " + enemies + ") < порога " + getThreatThreshold());
            }
        }

        if (enemies <= 0) {
            peaceTimer += dt;
        } else {
            // Выбор тихой темы сбрасываем ОДИН РАЗ, когда враги появились после затишья. Раньше сбрасывали
            // каждый кадр: на картах без волн с врагами (waves=false, но enemies>0) тема перевыбиралась
            // каждый кадр, сцена менялась 60 раз в секунду.
            if (peaceTimer > 0) session.peaceFile = null;
            peaceTimer = 0;
        }
    } else if (wasInGame) {
        // только что вышли из игры насовсем — останавливаем ВСЁ, в том числе тихо игравших партнёров пары
        if (DEBUG) dbg("ВЫХОД ИЗ ИГРЫ: останавливаю все голоса (" + Object.keys(voices).length + ")");
        wasInGame = false;
        resetSession();
        killAllVoices();
    }

    overlayFile = specialFile(dt);
    let d = desiredScene();
    if (d == null) { if (scene.key != null) enterScene(null); }
    else if (d.key !== scene.key) enterScene(d);
    else scene.d = d;

    if (DEBUG && Vars.state.isGame()) {
        if (d == null) dbgWhy("нет-сцены", dbgNoSceneWhy);
        else if (Object.keys(voices).length == 0 && session.t - scene.since > 3) dbgWhy("сцена-без-голосов", dbgNoVoicesWhy);
    }

    updateScene();
    applyVoices(dt);
}

Events.run(Trigger.update, () => {
    if (DEBUG) dbgFrame(); // «пульс» и пробы идут даже при мёртвом микшере: по ним видно, что мод вообще получает кадры
    if (tracksData == null || mixerDisabled) return;
    try {
        musicTick();
        tickErrors = 0;
    } catch (e) {
        // исключение в обработчике Trigger.update валит игру целиком — глушим, пишем в лог и не спамим
        tickErrors++;
        if (tickErrors == 1 || tickErrors % 600 == 0) ulog.err("[ULTRAdustry] сбой микшера (" + tickErrors + "): " + (DEBUG ? dbgErrText(e) : e));
        if (tickErrors == 30) {
            ulog.err("[ULTRAdustry] микшер отключён до перезапуска игры после 30 сбоев подряд");
            try { killAllVoices(); } catch (e2) {}
            mixerDisabled = true;
        }
    }
});
