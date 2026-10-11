import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandWebComponents } from '../../src/data/meteoswiss-web-components.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, '../__fixtures__/content');

function domFrom(html: string): Document {
  return new JSDOM(html).window.document;
}

describe('expandWebComponents', () => {
  describe('mch-text', () => {
    it('should replace mch-text with its html attribute content', () => {
      const doc = domFrom('<mch-text html="<p>Hello world</p>" slot="main"></mch-text>');
      expandWebComponents(doc);
      expect(doc.querySelector('p')!.textContent).toBe('Hello world');
      expect(doc.querySelector('mch-text')).toBeNull();
    });

    it('should handle multiple mch-text elements', () => {
      const doc = domFrom(
        '<mch-text html="<h2>Title</h2>" slot="main"></mch-text>' +
          '<mch-text html="<p>Paragraph</p>" slot="main"></mch-text>'
      );
      expandWebComponents(doc);
      expect(doc.querySelector('h2')!.textContent).toBe('Title');
      expect(doc.querySelector('p')!.textContent).toBe('Paragraph');
    });

    it('should handle HTML entities in the html attribute', () => {
      const doc = domFrom('<mch-text html="<p>Gr&uuml;ezi Z&uuml;rich</p>"></mch-text>');
      expandWebComponents(doc);
      expect(doc.querySelector('p')!.textContent).toBe('Grüezi Zürich');
    });

    it('should skip mch-text without html attribute', () => {
      const doc = domFrom('<div><mch-text></mch-text></div>');
      expandWebComponents(doc);
      // Element without html attr is left as-is (no crash)
      expect(doc.body.children.length).toBeGreaterThan(0);
    });
  });

  describe('mch-page-intro', () => {
    it('should extract heading and text into h1 and p', () => {
      const doc = domFrom(
        '<mch-page-intro heading="Wind" text="Lead paragraph about wind."></mch-page-intro>'
      );
      expandWebComponents(doc);
      expect(doc.querySelector('h1')!.textContent).toBe('Wind');
      expect(doc.querySelector('p')!.textContent).toBe('Lead paragraph about wind.');
      expect(doc.querySelector('mch-page-intro')).toBeNull();
    });

    it('should handle heading only', () => {
      const doc = domFrom('<mch-page-intro heading="Title Only"></mch-page-intro>');
      expandWebComponents(doc);
      expect(doc.querySelector('h1')!.textContent).toBe('Title Only');
      expect(doc.querySelector('p')).toBeNull();
    });

    it('should skip intro without heading or text', () => {
      const doc = domFrom('<mch-page-intro type="simple"></mch-page-intro>');
      expandWebComponents(doc);
      // Not expanded — left as-is
      expect(doc.querySelector('mch-page-intro')).not.toBeNull();
    });
  });

  describe('mch-image-component', () => {
    it('should create figure with img and figcaption', () => {
      const doc = domFrom(
        '<mch-image-component alt="A photo" caption="Photo caption" src="/img/photo.jpg"></mch-image-component>'
      );
      expandWebComponents(doc);
      const figure = doc.querySelector('figure')!;
      expect(figure).not.toBeNull();
      const img = figure.querySelector('img')!;
      expect(img.getAttribute('alt')).toBe('A photo');
      expect(img.getAttribute('src')).toBe('/img/photo.jpg');
      expect(figure.querySelector('figcaption')!.textContent).toBe('Photo caption');
    });

    it('should handle image without caption', () => {
      const doc = domFrom(
        '<mch-image-component alt="Alt text" src="/img/photo.jpg"></mch-image-component>'
      );
      expandWebComponents(doc);
      expect(doc.querySelector('img')!.getAttribute('src')).toBe('/img/photo.jpg');
      expect(doc.querySelector('figcaption')).toBeNull();
    });

    it('should skip image without any attributes', () => {
      const doc = domFrom('<mch-image-component></mch-image-component>');
      expandWebComponents(doc);
      expect(doc.querySelector('figure')).toBeNull();
    });
  });

  describe('mch-link-download-list', () => {
    it('should create link list from JSON links attribute', () => {
      const links = JSON.stringify([
        { href: 'https://example.com/a', label: 'Link A', type: 'internalLink' },
        { href: 'https://example.com/b', label: 'Link B', type: 'externalLink' },
      ]);
      const doc = domFrom(`<mch-link-download-list links='${links}'></mch-link-download-list>`);
      expandWebComponents(doc);
      const items = doc.querySelectorAll('li');
      expect(items.length).toBe(2);
      const firstLink = items[0]!.querySelector('a')!;
      expect(firstLink.getAttribute('href')).toBe('https://example.com/a');
      expect(firstLink.textContent).toBe('Link A');
    });

    it('should include title as h3 when present', () => {
      const links = JSON.stringify([{ href: '/page', label: 'Page' }]);
      const doc = domFrom(
        `<mch-link-download-list links='${links}' title="Related links"></mch-link-download-list>`
      );
      expandWebComponents(doc);
      expect(doc.querySelector('h3')!.textContent).toBe('Related links');
    });

    it('should handle malformed JSON gracefully', () => {
      const doc = domFrom(
        '<mch-link-download-list links="not valid json"></mch-link-download-list>'
      );
      // Should not throw
      expandWebComponents(doc);
      expect(doc.querySelector('ul')).toBeNull();
    });
  });

  describe('mch-accordion-panel', () => {
    it('should expand accordion panel title as h3', () => {
      const doc = domFrom(
        '<mch-accordion-panel title="Details"><p>Inner content</p></mch-accordion-panel>'
      );
      expandWebComponents(doc);
      expect(doc.querySelector('h3')!.textContent).toBe('Details');
      expect(doc.querySelector('p')!.textContent).toBe('Inner content');
    });
  });

  describe('mch-title', () => {
    it('should convert to heading with correct level', () => {
      const doc = domFrom('<mch-title level="2">Section Title</mch-title>');
      expandWebComponents(doc);
      expect(doc.querySelector('h2')!.textContent).toBe('Section Title');
      expect(doc.querySelector('mch-title')).toBeNull();
    });

    it('should clamp level to valid range', () => {
      const doc = domFrom('<mch-title level="99">Clamped</mch-title>');
      expandWebComponents(doc);
      expect(doc.querySelector('h6')!.textContent).toBe('Clamped');
    });

    it('should skip empty titles', () => {
      const doc = domFrom('<mch-title level="1"></mch-title>');
      expandWebComponents(doc);
      expect(doc.querySelector('h1')).toBeNull();
    });
  });

  describe('mch-video', () => {
    it('should create a link to the video', () => {
      const doc = domFrom(
        '<mch-video src="https://player.vimeo.com/video/12345"></mch-video>'
      );
      expandWebComponents(doc);
      const link = doc.querySelector('a')!;
      expect(link.getAttribute('href')).toBe('https://player.vimeo.com/video/12345');
      expect(link.textContent).toBe('Video');
    });
  });

  describe('non-content element removal', () => {
    it('should unwrap qs-shadow-template elements (keep children)', () => {
      const doc = domFrom(
        '<div><qs-shadow-template><p>inner content</p></qs-shadow-template><p>outer</p></div>'
      );
      expandWebComponents(doc);
      expect(doc.querySelector('qs-shadow-template')).toBeNull();
      // Inner content is preserved after unwrapping
      expect(doc.querySelectorAll('p').length).toBe(2);
    });

    it('should remove mch-header and mch-footer', () => {
      const doc = domFrom(
        '<mch-header>nav</mch-header><main><p>body</p></main><mch-footer>foot</mch-footer>'
      );
      expandWebComponents(doc);
      expect(doc.querySelector('mch-header')).toBeNull();
      expect(doc.querySelector('mch-footer')).toBeNull();
      expect(doc.querySelector('p')!.textContent).toBe('body');
    });
  });

  describe('full page integration', () => {
    it('should produce meaningful content from the wind.html fixture', () => {
      const html = fs.readFileSync(path.join(FIXTURES_ROOT, 'de', 'wind.html'), 'utf-8');
      const doc = domFrom(html);
      expandWebComponents(doc);

      const main = doc.querySelector('main');
      expect(main).not.toBeNull();
      const text = main!.textContent ?? '';

      // Must contain content from mch-page-intro
      expect(text).toContain('Wind');
      expect(text).toContain('Windereignisse');

      // Must contain content from mch-text html attributes
      expect(text).toContain('Verhaltensempfehlungen vor Windereignissen');

      // Must contain content from mch-link-download-list
      expect(text).toContain('Gefahrenstufen von Wind');

      // Must NOT contain noise from removed elements
      expect(doc.querySelector('qs-shadow-template')).toBeNull();
      expect(doc.querySelector('mch-footer')).toBeNull();
    });
  });
});
