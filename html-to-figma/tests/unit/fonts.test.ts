import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cssMatchFace, describeFont, faceFromPostScript, matchFigmaFont, styleWeight } from '../../shared/fonts';

const faces = [400, 500, 600].map((w) => ({ weightMin: w, weightMax: w, italic: false, oblique: false })).concat([{ weightMin: 400, weightMax: 400, italic: true, oblique: false }]);

test('подбор начертания CSS: веса и синтетические варианты', () => {
  assert.equal(cssMatchFace(faces, 500, false)!.weight, 500);
  assert.equal(cssMatchFace(faces, 700, false)!.weight, 600, 'нет 700 → ближайшее тяжелее/легче');
  const b = cssMatchFace([{ weightMin: 400, weightMax: 400, italic: false, oblique: false }], 700, false)!;
  assert.ok(b.syntheticBold, 'браузер синтезирует bold');
  assert.equal(cssMatchFace(faces, 500, true)!.weight, 400, 'курсив только 400');
  const v = cssMatchFace([{ weightMin: 100, weightMax: 900, italic: false, oblique: false }], 550, false)!;
  assert.equal(v.weight, 550, 'вариативный — точный вес');
});

const avail = [
  { family: 'Cormorant Garamond', style: 'Medium' }, { family: 'Cormorant Garamond', style: 'Medium Italic' }, { family: 'Cormorant Garamond', style: 'Regular' },
  { family: 'EB Garamond SemiBold', style: 'Regular' }, { family: 'Inter', style: 'Regular' }, { family: 'Inter', style: 'Bold' },
];

test('поиск в Figma: точное начертание, суффиксы статических TTF, без подмены семейства', () => {
  assert.deepEqual(matchFigmaFont({ key: 'k', family: 'Cormorant Garamond', weight: 500, italic: true }, avail).font, { family: 'Cormorant Garamond', style: 'Medium Italic' });
  assert.deepEqual(matchFigmaFont({ key: 'k', family: 'EB Garamond', weight: 600, italic: false }, avail).font, { family: 'EB Garamond SemiBold', style: 'Regular' }, '«Семейство Стиль / Regular»');
  assert.equal(matchFigmaFont({ key: 'k', family: 'Cormorant Garamond', weight: 600, italic: false }, avail).font, null, 'нет SemiBold — не подменяем Medium');
  assert.equal(matchFigmaFont({ key: 'k', family: 'Cormorant', weight: 400, italic: false }, avail).font, null, 'другое семейство не подходит');
  assert.equal(matchFigmaFont({ key: 'k', family: 'Inter Tight', weight: 400, italic: false }, avail).font, null);
  const vf = matchFigmaFont({ key: 'k', family: 'Inter', weight: 550, italic: false }, avail, new Set(['Inter']));
  assert.equal(vf.variation, 550);
  assert.equal(styleWeight('SemiBold Italic'), 600);
  assert.equal(describeFont({ family: 'EB Garamond', weight: 400, italic: true }), 'EB Garamond Italic');
});

test('UTF-16: длины диапазонов для суррогатных пар', () => {
  const s = 'A😀Б';
  assert.equal(s.length, 4, 'эмодзи занимает 2 единицы UTF-16 — так считает API диапазонов Figma');
  assert.equal(Array.from(s).length, 3);
});

test('начертание по PostScript-имени системного шрифта', () => {
  assert.deepEqual(faceFromPostScript('LiberationSerif'), { weight: 400, italic: false });
  assert.deepEqual(faceFromPostScript('LiberationSerif-Italic'), { weight: 400, italic: true });
  assert.deepEqual(faceFromPostScript('LiberationSans-Bold'), { weight: 700, italic: false });
  assert.deepEqual(faceFromPostScript('Arial-BoldItalicMT'), { weight: 700, italic: true });
  assert.deepEqual(faceFromPostScript('TimesNewRomanPSMT'), { weight: 400, italic: false });
  assert.deepEqual(faceFromPostScript('DejaVuSansMono-BoldOblique'), { weight: 700, italic: true });
  assert.deepEqual(faceFromPostScript('Inter-SemiBold'), { weight: 600, italic: false });
  assert.equal(faceFromPostScript(undefined), null);
});
