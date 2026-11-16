import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { SITUATION_MAP_HTML } from '../../src/views/situation-map.js';

type Fill = { color: string; x: number; y: number; w: number; h: number };
type Sent = { jsonrpc: string; id?: number; method?: string; params?: Record<string, unknown>; result?: unknown };

/**
 * Load the view in jsdom with a fake host. In jsdom the window is its own parent, so
 * `window.parent.postMessage` is `window.postMessage`: replacing it captures what the view sends,
 * and a MessageEvent with `source: window` plays the host.
 */
function openView() {
  const sent: Sent[] = [];
  const fills: Fill[] = [];
  const dom = new JSDOM(SITUATION_MAP_HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.postMessage = ((msg: Sent) => {
        sent.push(msg);
      }) as typeof window.postMessage;
      const ctx = {
        fillStyle: '',
        fillRect(x: number, y: number, w: number, h: number) {
          fills.push({ color: this.fillStyle, x, y, w, h });
        },
      };
      window.HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
    },
  });
  const { window } = dom;
  const host = (data: unknown): void => {
    window.dispatchEvent(new window.MessageEvent('message', { data, source: window as never }));
  };
  return { window, document: window.document, sent, fills, host };
}

const GRID_RESULT = {
  content: [{ type: 'text', text: '{}' }],
  structuredContent: {
    valid: { from: '2026-11-17T10:00:00+01:00', hours: 1 },
    run: '2026-11-17T06:00:00+01:00',
    points: 5800,
    regions: [
      { id: 'mittelland', name: 'Mittelland', points: 2000, dominant: 'fog_or_stratus', bands: [], fog_top_m: 900 },
      { id: 'wallis', name: 'Wallis', points: 500, dominant: 'sunny', bands: [{ band: '<500', points: 500, pct: { sunny: 90 }, dominant: 'sunny' }] },
    ],
    legend: { sunny: 'Sunny', snow: 'Snow' },
    grid: {
      crs: 'EPSG:2056',
      cell_m: 5000,
      west: 2480000,
      north: 1300000,
      rows: ['SW.', '.FS'],
      key: { S: 'sunny', W: 'snow', F: 'fog_or_stratus', '.': 'no forecast point' },
    },
    source: 'Source: MeteoSwiss',
  },
};

describe('weather map view in a fake host', () => {
  it('starts the handshake: ui/initialize first, ui/notifications/initialized after the answer', () => {
    const { sent, host } = openView();
    const init = sent.find((m) => m.method === 'ui/initialize');
    expect(init).toBeDefined();
    expect(init?.params).toMatchObject({ protocolVersion: '2026-01-26' });
    expect(sent.some((m) => m.method === 'ui/notifications/initialized')).toBe(false);

    host({ jsonrpc: '2.0', id: init?.id, result: { protocolVersion: '2026-01-26', hostContext: { theme: 'dark' } } });
    return Promise.resolve().then(() => {
      expect(sent.some((m) => m.method === 'ui/notifications/initialized')).toBe(true);
    });
  });

  it('takes the theme of the host', async () => {
    const { sent, host, document } = openView();
    const id = sent.find((m) => m.method === 'ui/initialize')?.id;
    host({ jsonrpc: '2.0', id, result: { hostContext: { theme: 'dark' } } });
    await Promise.resolve();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    host({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'light' } });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('draws one coloured cell per grid character and leaves cells without a point empty', () => {
    const { host, fills, document } = openView();
    host({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: GRID_RESULT });
    const canvas = document.querySelector('canvas');
    expect(canvas?.width).toBe(30);
    expect(canvas?.height).toBe(20);
    expect(fills).toHaveLength(4); // SW. and .FS: two "." cells stay empty
    const at = (x: number, y: number) => fills.find((f) => f.x === x * 10 && f.y === y * 10)?.color;
    expect(at(0, 0)).toBe('#f7b500'); // sunny
    expect(at(1, 0)).toBe('#b5defa'); // snow
    expect(at(2, 0)).toBeUndefined();
    expect(at(1, 1)).toBe('#b9a9d6'); // fog or low cloud
    expect(at(2, 1)).toBe('#f7b500');
  });

  it('labels the regions, shows the legend, the time and the source', () => {
    const { host, document } = openView();
    host({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: GRID_RESULT });
    const text = document.body.textContent ?? '';
    expect(text).toContain('Mittelland: Fog or low cloud, fog up to 900 m');
    expect(text).toContain('Wallis: Sunny (90 %)');
    expect(text).toContain('2026-11-17 10:00');
    expect(text).toContain('Source: MeteoSwiss');
    const legend = [...document.querySelectorAll('.legend li')].map((li) => li.textContent);
    expect(legend).toEqual(expect.arrayContaining(['Sunny', 'Snow', 'Fog or low cloud']));
  });

  it('shows a window as from to until', () => {
    const { host, document } = openView();
    const data = structuredClone(GRID_RESULT);
    data.structuredContent.valid = { from: '2026-11-17T10:00:00+01:00', until: '2026-11-17T14:00:00+01:00', hours: 5 } as never;
    host({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: data });
    expect(document.body.textContent).toContain('2026-11-17 10:00 to 14:00');
  });

  it('writes text from the result as text, never as HTML', () => {
    const { host, document } = openView();
    const data = structuredClone(GRID_RESULT);
    data.structuredContent.regions[0]!.name = '<img src=x onerror="window.pwned=1"><b>x</b>';
    data.structuredContent.source = '<script>window.pwned=1</script>';
    host({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: data });
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(document.querySelectorAll('script')).toHaveLength(1); // the view's own
    expect(document.body.textContent).toContain('<img src=x onerror=');
  });

  it('sends no size before the handshake is done', () => {
    const { host, sent } = openView();
    host({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: GRID_RESULT });
    expect(sent.some((m) => m.method === 'ui/notifications/size-changed')).toBe(false);
  });

  it('shows the text of the answer when there is no grid, and reports its size', async () => {
    const { host, document, sent } = openView();
    host({ jsonrpc: '2.0', id: sent.find((m) => m.method === 'ui/initialize')?.id, result: {} });
    await Promise.resolve();
    host({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: { isError: true, content: [{ type: 'text', text: 'Failed to get the weather map: time is not in the run' }] },
    });
    expect(document.body.textContent).toContain('time is not in the run');
    expect(document.querySelector('canvas')).toBeNull();
    expect(sent.some((m) => m.method === 'ui/notifications/size-changed')).toBe(true);
  });

  it('answers a teardown request with an empty result under the same id', () => {
    const { host, sent } = openView();
    host({ jsonrpc: '2.0', id: 77, method: 'ui/resource-teardown', params: { reason: 'closed' } });
    expect(sent.find((m) => m.id === 77)).toEqual({ jsonrpc: '2.0', id: 77, result: {} });
  });

  it('ignores a message that does not come from the host window', () => {
    const { window, document } = openView();
    const stranger = new JSDOM('').window;
    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: GRID_RESULT },
        source: stranger as never,
      })
    );
    expect(document.querySelector('canvas')).toBeNull();
  });
});
