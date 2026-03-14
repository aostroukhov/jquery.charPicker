/**
 * jquery.loadBundle.js
 * Утилиты ленивой загрузки CSS и JS для jQuery.
 *
 * Добавляет четыре свойства к объекту jQuery:
 *   $.loadCache         — хранилище промисов (для отладки и ручного сброса)
 *   $.getCss(attr)      — динамически подключить <link>
 *   $.getScriptCached(url) — динамически загрузить <script> с кэшированием
 *   $.loadBundle(css, js)  — загрузить CSS + JS параллельно
 *
 * Требования:
 *   - jQuery любой версии
 *   - Promise (нативный или полифил; IE11 требует полифил)
 *



  // Загрузка CSS с обработкой успешной загрузки
 $.getCss("/styles/main.css")
		 .then(() => {
				 console.log("CSS main.css успешно загружен.");
		 })
		 .catch((error) => {
				 console.error(error.message);
		 });

 // Загрузка CSS с атрибутами и обработкой ошибок
 $.getCss({ href: "/styles/print.css", media: "print" })
		 .then(() => {
				 console.log("CSS print.css успешно загружен.");
		 })
		 .catch((error) => {
				 console.error("Ошибка загрузки:", error.message);
		 });

 Пример с async/await:

 async function loadStyles() {
		 try {
				 await $.getCss("styles/main.css");
				 console.log("CSS main.css загружен.");
				 await $.getCss("styles/print.css");
				 console.log("CSS print.css загружен.");
		 } catch (error) {
				 console.error("Ошибка:", error.message);
		 }
 }

 loadStyles();






 */
 ;(function ($, window, document, undefined) {

  'use strict';

  // ─── Таймаут по умолчанию (мс). ────────────────────────────────────────────
  // Если сервер не ответил за это время — промис отклоняется.
  // Передаётся третьим аргументом в $.getCss / $.getScriptCached / $.loadBundle.
  // 0 или falsy — таймаут отключён (ждём вечно).
  var DEFAULT_TIMEOUT = 10000;


  // ─── $.loadCache ────────────────────────────────────────────────────────────
  // Хранилище промисов. Запись появляется при старте загрузки и остаётся
  // после завершения — это защищает от повторных запросов при параллельных
  // вызовах с одним URL. При ошибке запись удаляется, чтобы повторный
  // вызов мог попробовать снова.
  //
  // Отладка из консоли браузера:
  //   $.loadCache          → весь кэш
  //   $.loadCache.css      → { [href]: Promise, … }
  //   $.loadCache.js       → { [url]:  Promise, … }
  //
  // Принудительный сброс (например при hot-reload в разработке):
  //   delete $.loadCache.css['/js/charPicker.css'];
  $.loadCache = { css: {}, js: {} };


  // ─── Внутренняя утилита: Promise.race с таймаутом ───────────────────────────
  // Если timeout > 0 — добавляет в гонку отклоняющийся промис-таймер.
  // Используется внутри $.getCss и $.getScriptCached.
  //
  //   _withTimeout(promise, 5000, 'CSS: main.css')
  //   → Promise — резолвится если promise успел, иначе reject через 5с
  function _withTimeout(promise, timeout, label) {
    if (!timeout) return promise;
    var timer = new Promise(function (_, reject) {
      setTimeout(function () {
        reject(new Error('Таймаут загрузки (' + timeout + ' мс): ' + label));
      }, timeout);
    });
    return Promise.race([promise, timer]);
  }


  // ─── $.getCss(attributes [, timeout]) ───────────────────────────────────────
  // Динамически подключает CSS через вставку <link> в <head>.
  // Возвращает Promise, который резолвится после onload.
  //
  // Параметры:
  //   attributes  {string|object}
  //     string  → путь к файлу, например: $.getCss('/styles/main.css')
  //     object  → { href: '…', media: '…', crossorigin: '…', integrity: '…', … }
  //               Любые валидные атрибуты <link>. href обязателен.
  //   timeout  {number}  мс, опционально. 0 — отключить. По умолчанию DEFAULT_TIMEOUT.
  //
  // Поведение:
  //   • Если <link href="…"> уже есть в DOM (в т.ч. статически в HTML)
  //     → Promise.resolve() без повторной вставки. Проверка точная (href=, не href$=).
  //   • Если загрузка уже идёт или завершена → возвращает тот же Promise из кэша.
  //     Параллельные вызовы с одним URL безопасны — тег не дублируется.
  //   • При ошибке или таймауте → запись из кэша удаляется, Promise.reject().
  //
  // Примеры:
  //   $.getCss('/styles/main.css');
  //
  //   $.getCss({ href: 'styles/print.css', media: 'print' })
  //     .then(function() { console.log('загружен'); })
  //     .catch(function(err) { console.error(err.message); });
  //
  //   $.getCss('styles/heavy.css', 5000); // таймаут 5 секунд
  //
  //   // async/await:
  //   await $.getCss('styles/main.css');
  $.getCss = function (attributes, timeout) {
    if (typeof attributes === 'string') {
      attributes = { href: attributes };
    }
    attributes.rel = attributes.rel || 'stylesheet';

    var href = attributes.href;
    var ms   = (timeout !== undefined) ? timeout : DEFAULT_TIMEOUT;

    // Уже есть в DOM — резолвим сразу
    if ($('link[href="' + href + '"]').length) {
      return Promise.resolve(href);
    }

    // Уже грузится или загружен — возвращаем тот же промис
    if ($.loadCache.css[href]) return $.loadCache.css[href];

    var load = new Promise(function (resolve, reject) {
      var el = document.createElement('link');
      Object.keys(attributes).forEach(function (key) {
        el.setAttribute(key, attributes[key]);
      });
      el.onload  = function () { resolve(href); };
      el.onerror = function () {
        delete $.loadCache.css[href]; // сброс — повторный вызов попробует снова
        reject(new Error('Не удалось загрузить CSS: ' + href));
      };
      document.head.appendChild(el);
    });

    $.loadCache.css[href] = _withTimeout(load, ms, href);

    // Если таймаут сработал раньше onload — чистим кэш
    $.loadCache.css[href].catch(function () {
      delete $.loadCache.css[href];
    });

    return $.loadCache.css[href];
  };


  // ─── $.getScriptCached(url [, timeout]) ─────────────────────────────────────
  // Динамически загружает JS. В отличие от стандартного $.getScript,
  // не добавляет ?_=timestamp — браузер и CDN кэшируют файл нормально.
  // Возвращает Promise.
  //
  // Параметры:
  //   url      {string}  путь к скрипту
  //   timeout  {number}  мс, опционально. 0 — отключить. По умолчанию DEFAULT_TIMEOUT.
  //
  // Поведение:
  //   • Если <script src="…"> уже есть в DOM → Promise.resolve().
  //   • Параллельные вызовы с одним url безопасны — скрипт не грузится дважды.
  //   • Под капотом: $.ajax({ dataType: 'script', cache: true }).
  //     Скрипт исполняется сразу после загрузки.
  //   • При ошибке или таймауте → запись из кэша удаляется, Promise.reject().
  //
  // Примеры:
  //   $.getScriptCached('/js/plugin.js')
  //     .then(function() { $('#el').plugin(); })
  //     .catch(function(err) { console.error(err.message); });
  //
  //   $.getScriptCached('/js/plugin.js', 8000); // таймаут 8 секунд
  //
  //   // Последовательная загрузка (когда B зависит от A):
  //   $.getScriptCached('/js/lib.js')
  //     .then(function() { return $.getScriptCached('/js/plugin.js'); })
  //     .then(function() { $('#el').plugin(); });
  //
  //   // async/await:
  //   await $.getScriptCached('/js/lib.js');
  //   await $.getScriptCached('/js/plugin.js');
  //   $('#el').plugin();
  $.getScriptCached = function (url, timeout) {
    var ms = (timeout !== undefined) ? timeout : DEFAULT_TIMEOUT;

    // Уже есть в DOM
    if ($('script[src="' + url + '"]').length) {
      return Promise.resolve(url);
    }

    // Уже грузится или загружен
    if ($.loadCache.js[url]) return $.loadCache.js[url];

    var load = $.ajax({
			url: url,
			dataType: 'script',
			cache: true
		})
      .then(function () { return url; })
      .catch(function (err) {
        delete $.loadCache.js[url];
        return Promise.reject(err);
      });

    $.loadCache.js[url] = _withTimeout(load, ms, url);

    $.loadCache.js[url].catch(function () {
      delete $.loadCache.js[url];
    });

    return $.loadCache.js[url];
  };


  // ─── $.loadBundle(cssHref, jsSrc [, timeout]) ───────────────────────────────
  // Загружает CSS и JS параллельно. Резолвится когда оба загружены.
  // Удобно для инициализации плагинов, которым нужны оба файла.
  //
  // Параметры:
  //   cssHref  {string|object}  передаётся в $.getCss как есть
  //   jsSrc    {string}         передаётся в $.getScriptCached
  //   timeout  {number}         мс, опционально. Применяется к каждому файлу отдельно.
  //
  // Примеры:
  //   $.loadBundle('/jscript/jquery.charPicker/jquery.charPicker.min.css', '/jscript/jquery.charPicker/jquery.charPicker.min.charPicker.js')
  //     .then(function() {
  //       $('#textarea').charPicker();
  //     });
  //
  //   // prefetch CSS при фокусе, полная загрузка при клике:
  //   $('#textarea').one('focus', function() {
  //     $.getCss('/js/charPicker.css'); // начать грузить CSS заранее, не ждём
  //   });
  //   $('#btn').on('click', function() {
  //     $.loadBundle('/js/charPicker.css', '/js/charPicker.js')
  //       .then(function() { $('#textarea').charPicker('open'); });
  //   });
  //
  //   // async/await:
  //   await $.loadBundle('/js/charPicker.css', '/js/charPicker.js');
  //   $('#textarea').charPicker();
  $.loadBundle = function (cssHref, jsSrc, timeout) {
    return Promise.all([
      $.getCss(cssHref, timeout),
      $.getScriptCached(jsSrc, timeout)
    ]);
  };

})(jQuery, window, document);
