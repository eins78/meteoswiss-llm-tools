/**
 * The view of the weather map MCP App: one self-contained HTML page (inline style and script,
 * no network, no external file) that colours the 5 km grid of a `meteoswissWeatherSituation`
 * answer and lists the regions and the legend.
 *
 * It runs inside a sandboxed iframe of the host (Claude, ChatGPT, VS Code, ...) with the default
 * CSP of MCP Apps: `connect-src 'none'`, so it cannot fetch anything. It reads the tool result
 * the host sends over `postMessage` (`ui/notifications/tool-result`) and draws from
 * `structuredContent`. Everything from the result goes into the page with `textContent`, never
 * as HTML.
 *
 * The script avoids backticks, `${` and backslashes: the page is a template literal.
 */

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1c2530;--muted:#5b6673;--line:#d5dbe2;--nodata:#eceff3;--panel:#f6f8fa}
:root[data-theme=dark]{--bg:#15191e;--fg:#e8edf2;--muted:#9aa6b2;--line:#2c353f;--nodata:#222930;--panel:#1c2229}
*{box-sizing:border-box}
body{margin:0;padding:12px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}
h1{font-size:16px;margin:0 0 2px}
.sub{color:var(--muted);font-size:12px;margin:0 0 10px}
.map{position:relative;max-width:760px}
canvas{display:block;width:100%;height:auto;background:var(--nodata);border:1px solid var(--line);border-radius:6px;image-rendering:pixelated}
.tip{position:absolute;pointer-events:none;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:4px;padding:2px 6px;font-size:12px;white-space:nowrap;display:none}
.legend,.regions{display:flex;flex-wrap:wrap;gap:6px 14px;list-style:none;padding:0;margin:10px 0 0}
.legend li,.regions li{display:flex;align-items:center;gap:6px;font-size:12px}
.sw{width:12px;height:12px;border-radius:2px;border:1px solid rgba(0,0,0,.25);flex:none}
.regions li{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:3px 8px}
.msg{padding:16px;color:var(--muted)}
.src{color:var(--muted);font-size:11px;margin:10px 0 0}
`;

const SCRIPT = `
(function () {
  var COLORS = {
    sunny: '#f7b500', clear_night: '#27376b', partly_sunny: '#f3d98b', cloudy: '#97a3b0',
    high_cloud: '#cfd8e0', fog_or_stratus: '#b9a9d6', rain: '#3d7fc4', sleet: '#79a9c9',
    snow: '#b5defa', thunder: '#7a3fa8'
  };
  var NAMES = {
    sunny: 'Sunny', clear_night: 'Clear night', partly_sunny: 'Partly sunny', cloudy: 'Cloudy',
    high_cloud: 'High cloud', fog_or_stratus: 'Fog or low cloud', rain: 'Rain', sleet: 'Sleet',
    snow: 'Snow', thunder: 'Thunderstorm'
  };
  var CELL = 10;
  var app = document.getElementById('app');
  var nextId = 1;
  var pending = {};
  var current = null;
  var ready = false;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function swatch(category) {
    var s = el('span', 'sw');
    s.style.background = COLORS[category] || '#999';
    return s;
  }
  function message(text) {
    app.textContent = '';
    app.appendChild(el('div', 'msg', text));
    reportSize();
  }

  function send(msg) { window.parent.postMessage(msg, '*'); }
  function request(method, params) {
    var id = nextId++;
    return new Promise(function (resolve) {
      pending[id] = resolve;
      send({ jsonrpc: '2.0', id: id, method: method, params: params });
    });
  }
  function notify(method, params) { send({ jsonrpc: '2.0', method: method, params: params || {} }); }
  function reportSize() {
    if (!ready) return;
    var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
    notify('ui/notifications/size-changed', { width: Math.ceil(document.documentElement.scrollWidth), height: h });
  }

  function applyTheme(ctx) {
    if (ctx && (ctx.theme === 'dark' || ctx.theme === 'light')) {
      document.documentElement.setAttribute('data-theme', ctx.theme);
    }
  }

  function when(valid) {
    if (!valid || typeof valid.from !== 'string') return '';
    var from = valid.from.slice(0, 16).replace('T', ' ');
    if (typeof valid.until === 'string' && valid.until !== valid.from) {
      return from + ' to ' + valid.until.slice(11, 16);
    }
    return from;
  }

  function draw(canvas, grid) {
    var rows = grid.rows;
    var cols = 0;
    for (var r = 0; r < rows.length; r++) if (rows[r].length > cols) cols = rows[r].length;
    canvas.width = cols * CELL;
    canvas.height = rows.length * CELL;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    for (var y = 0; y < rows.length; y++) {
      for (var x = 0; x < rows[y].length; x++) {
        var category = grid.key[rows[y].charAt(x)];
        if (!category || !COLORS[category]) continue;
        ctx.fillStyle = COLORS[category];
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
  }

  function cellAt(grid, canvas, ev) {
    var box = canvas.getBoundingClientRect();
    var x = Math.floor(((ev.clientX - box.left) / box.width) * canvas.width / CELL);
    var y = Math.floor(((ev.clientY - box.top) / box.height) * canvas.height / CELL);
    var row = grid.rows[y];
    if (row === undefined || x < 0 || x >= row.length) return null;
    return { x: x, y: y, category: grid.key[row.charAt(x)] || null };
  }

  // The tool sends its answer twice: as structuredContent and as JSON text. A host that passes
  // only the content blocks to the view still gives the same answer.
  function answerOf(result) {
    if (!result) return null;
    if (result.structuredContent) return result.structuredContent;
    var first = Array.isArray(result.content) ? result.content[0] : null;
    if (!first || typeof first.text !== 'string') return null;
    try { return JSON.parse(first.text); } catch (e) { return null; }
  }

  function render(result) {
    var data = answerOf(result);
    if (!data || !data.grid || !Array.isArray(data.grid.rows)) {
      var text = '';
      if (result && Array.isArray(result.content) && result.content[0] && typeof result.content[0].text === 'string') {
        text = result.content[0].text;
      }
      message(text || 'No weather map in this answer.');
      return;
    }
    var grid = data.grid;
    app.textContent = '';
    app.appendChild(el('h1', '', 'Weather over Switzerland'));
    var run = typeof data.run === 'string' ? ', forecast run ' + data.run.slice(0, 16).replace('T', ' ') : '';
    app.appendChild(el('p', 'sub', when(data.valid) + ' (local time)' + run + ', ' + data.points + ' forecast points'));

    var wrap = el('div', 'map');
    var canvas = el('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Map of Switzerland, north at the top, one cell per 5 km, coloured by the most frequent weather. The regions and the legend are listed below.');
    var tip = el('div', 'tip');
    wrap.appendChild(canvas);
    wrap.appendChild(tip);
    app.appendChild(wrap);
    draw(canvas, grid);
    canvas.addEventListener('mousemove', function (ev) {
      var c = cellAt(grid, canvas, ev);
      if (!c || !c.category) { tip.style.display = 'none'; return; }
      var box = canvas.getBoundingClientRect();
      tip.textContent = NAMES[c.category] || c.category;
      tip.style.display = 'block';
      tip.style.left = Math.min(ev.clientX - box.left + 10, box.width - 120) + 'px';
      tip.style.top = (ev.clientY - box.top + 10) + 'px';
    });
    canvas.addEventListener('mouseleave', function () { tip.style.display = 'none'; });

    var legend = el('ul', 'legend');
    var seen = {};
    for (var ch in grid.key) {
      if (Object.prototype.hasOwnProperty.call(grid.key, ch)) seen[grid.key[ch]] = true;
    }
    Object.keys(COLORS).forEach(function (category) {
      if (!seen[category] && !(data.legend && data.legend[category])) return;
      var li = el('li');
      li.appendChild(swatch(category));
      li.appendChild(el('span', '', NAMES[category]));
      legend.appendChild(li);
    });
    app.appendChild(legend);

    var regions = el('ul', 'regions');
    (Array.isArray(data.regions) ? data.regions : []).forEach(function (region) {
      var li = el('li');
      li.appendChild(swatch(region.dominant));
      var share = region.bands && region.bands.length === 1 && region.bands[0].pct ? region.bands[0].pct[region.dominant] : undefined;
      var label = region.name + ': ' + (NAMES[region.dominant] || region.dominant) + (share !== undefined ? ' (' + share + ' %)' : '');
      if (typeof region.fog_top_m === 'number') label += ', fog up to ' + region.fog_top_m + ' m';
      li.appendChild(el('span', '', label));
      regions.appendChild(li);
    });
    app.appendChild(regions);

    if (typeof data.source === 'string') app.appendChild(el('p', 'src', data.source));
    reportSize();
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent) return;
    var msg = ev.data;
    if (!msg || msg.jsonrpc !== '2.0') return;
    if (msg.id !== undefined && msg.method === undefined) {
      var done = pending[msg.id];
      if (done) { delete pending[msg.id]; done(msg); }
      return;
    }
    if (msg.method === 'ui/notifications/tool-result') {
      current = msg.params;
      render(current);
    } else if (msg.method === 'ui/notifications/host-context-changed') {
      applyTheme(msg.params);
    } else if (msg.method === 'ui/resource-teardown' && msg.id !== undefined) {
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
    }
  });

  if (typeof ResizeObserver === 'function') new ResizeObserver(reportSize).observe(document.body);

  message('Waiting for the weather map ...');
  // The fields are those of McpUiInitializeRequest in the MCP Apps spec (2026-01-26): a host
  // validates them and answers an invalid request with an error, not with a result.
  request('ui/initialize', {
    protocolVersion: '2026-01-26',
    appInfo: { name: 'meteoswiss-situation-map', version: '1.0.0' },
    appCapabilities: {}
  }).then(function (reply) {
    if (reply && reply.error) {
      message('The host refused to start the weather map: ' + (reply.error.message || 'unknown error'));
      return;
    }
    if (reply && reply.result) applyTheme(reply.result.hostContext);
    notify('ui/notifications/initialized');
    ready = true;
    reportSize();
  });
})();
`;

/** The complete HTML page of the weather map view. */
export const SITUATION_MAP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weather map of Switzerland</title>
<style>${STYLE}</style>
</head>
<body>
<div id="app"></div>
<script>${SCRIPT}</script>
</body>
</html>
`;
