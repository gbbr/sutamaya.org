import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreTranslationPlace, translationPlace } from '../translationPlace';

function paneWithLines(lines: Array<[key: string, top: number, height: number]>, scale = 1) {
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  const pane = document.createElement('div');
  vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100 * scale, 500 * scale, 500 * scale));
  for (const [key, top, height] of lines) {
    const wrapper = document.createElement('div');
    wrapper.id = key;
    const line = document.createElement('p');
    line.dataset.seg = String(pane.children.length);
    vi.spyOn(line, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, top * scale, 400 * scale, height * scale));
    wrapper.appendChild(line);
    pane.appendChild(wrapper);
  }
  return pane;
}

afterEach(() => {
  document.documentElement.style.removeProperty('--ui-scale');
  vi.restoreAllMocks();
});

describe('translation positions', () => {
  it.each([1, 1.5, 2])('keeps the first whole English line below the 20px inset at scale %s', (scale) => {
    const pane = paneWithLines([
      ['mn1:1.1', 90, 35],
      ['mn1:1.2', 115, 35],
      ['mn1:1.3', 160, 35],
      ['mn1:1.4', 595, 35],
    ], scale);
    expect(translationPlace(pane)).toEqual({ key: 'mn1:1.3', offset: 60 });
  });

  it('uses an intersecting segment when no whole segment fits in the pane', () => {
    const pane = paneWithLines([['mn1:1.1', 80, 800]]);
    expect(translationPlace(pane)).toEqual({ key: 'mn1:1.1', offset: -20 });
  });

  it('has no segment anchor when the reader is above the text', () => {
    const pane = paneWithLines([['mn1:1.1', 650, 40]]);
    expect(translationPlace(pane)).toBeUndefined();
  });

  it.each([1, 1.5, 2])('restores a present line at its saved screen offset at scale %s', (scale) => {
    const pane = paneWithLines([['mn1:2.7', 270, 30]], scale);
    pane.scrollTop = 100;
    restoreTranslationPlace(pane, [{ key: 'mn1:2.7', en: 'English', pali: '' }], { key: 'mn1:2.7', offset: 25 });
    expect(pane.scrollTop).toBe(245);
  });

  it('uses the nearest earlier key, with numeric rather than lexical ordering', () => {
    const keys = ['mn1:2.2', 'mn1:2.9', 'mn1:2.11'];
    const pane = paneWithLines(keys.map((key, i) => [key, 200 + 70 * i, 30]));
    restoreTranslationPlace(pane, keys.map((key) => ({ key, en: 'English', pali: '' })), { key: 'mn1:2.10', offset: 25 });
    expect(pane.scrollTop).toBe(145);
  });

  it('uses the first line when the other translation has no predecessor', () => {
    const pane = paneWithLines([['mn1:2.7', 270, 30]]);
    restoreTranslationPlace(pane, [{ key: 'mn1:2.7', en: 'English', pali: '' }], { key: 'mn1:1.1', offset: 25 });
    expect(pane.scrollTop).toBe(145);
  });
});
