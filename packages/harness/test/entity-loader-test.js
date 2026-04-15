/* global Tinytest, KoadHarnessEntityLoader */
// Unit tests for the /entities endpoint support layer.
// Covers the punch list filed under koad/juno#73 against SPEC-063 §6 + SPEC-099:
//   - full-depth passthrough (no level)
//   - ?level=N ceiling (0..4)
//   - legacy {hue, saturation} alias normalization (SPEC-063 §7)
//   - single-entity vs. list shape equivalence
//   - avatar URL honors the configured harness prefix (no more hardcoded /harness/)
//   - SPEC-099 visual (LOD-3) + spatial (LOD-4) surfaced at correct ceilings
//
// We test at the pure-function layer — HTTP dispatch itself is thin and relies
// on Meteor's WebApp.rawConnectHandlers. The punch-list bugs all live in
// entity-loader.js.

const { filterOutfitByLevel, normalizeOutfit, getClientInfo } = KoadHarnessEntityLoader;

const fullOutfit = {
  h: 222,
  s: 28,
  typography: { heading: 'Playfair Display', body: 'Inter' },
  greeting: 'Hello.',
  personality: { tone: 'calm', tags: ['precision'] },
  motion: { easing: 'ease-out', durationMs: 250 },
  visual: { avatar: 'identity/avatar.png', format: 'png' },
  spatial: { mesh: 'identity/avatar.glb', format: 'glb' },
};

Tinytest.add('harness - filterOutfitByLevel - omitted level returns full depth', function (test) {
  const out = filterOutfitByLevel(fullOutfit);
  test.equal(out, fullOutfit);
  const outNull = filterOutfitByLevel(fullOutfit, null);
  test.equal(outNull, fullOutfit);
});

Tinytest.add('harness - filterOutfitByLevel - level 0 is palette only', function (test) {
  const out = filterOutfitByLevel(fullOutfit, 0);
  test.equal(out, { h: 222, s: 28 });
});

Tinytest.add('harness - filterOutfitByLevel - level 1 adds typography+greeting', function (test) {
  const out = filterOutfitByLevel(fullOutfit, 1);
  test.equal(out.h, 222);
  test.equal(out.typography.heading, 'Playfair Display');
  test.equal(out.greeting, 'Hello.');
  test.isUndefined(out.personality);
  test.isUndefined(out.motion);
  test.isUndefined(out.visual);
  test.isUndefined(out.spatial);
});

Tinytest.add('harness - filterOutfitByLevel - level 2 adds personality', function (test) {
  const out = filterOutfitByLevel(fullOutfit, 2);
  test.equal(out.personality.tone, 'calm');
  test.isUndefined(out.motion);
  test.isUndefined(out.visual);
});

Tinytest.add('harness - filterOutfitByLevel - level 3 includes motion AND visual (SPEC-099)', function (test) {
  const out = filterOutfitByLevel(fullOutfit, 3);
  test.equal(out.motion.easing, 'ease-out');
  test.equal(out.visual.avatar, 'identity/avatar.png');
  test.isUndefined(out.spatial);
});

Tinytest.add('harness - filterOutfitByLevel - level 4 adds spatial (SPEC-099)', function (test) {
  const out = filterOutfitByLevel(fullOutfit, 4);
  test.equal(out.spatial.mesh, 'identity/avatar.glb');
  test.equal(out.spatial.format, 'glb');
});

Tinytest.add('harness - filterOutfitByLevel - legacy outfit.model still surfaces at level 4 (back-compat)', function (test) {
  const legacy = { h: 1, s: 2, model: { kind: 'placeholder' } };
  const out = filterOutfitByLevel(legacy, 4);
  test.equal(out.model.kind, 'placeholder');
  const out3 = filterOutfitByLevel(legacy, 3);
  test.isUndefined(out3.model);
});

Tinytest.add('harness - normalizeOutfit - legacy {hue, saturation} aliases (SPEC-063 §7)', function (test) {
  const raw = { hue: 29, saturation: 54, brightness: 30 };
  const out = normalizeOutfit(raw);
  test.equal(out.h, 29);
  test.equal(out.s, 54);
  test.isUndefined(out.brightness, 'brightness must be dropped per SPEC-063 §7');
});

Tinytest.add('harness - normalizeOutfit - canonical fields pass through unchanged', function (test) {
  const raw = { h: 10, s: 20, typography: { body: 'Inter' }, visual: { avatar: 'x.png' } };
  const out = normalizeOutfit(raw);
  test.equal(out.h, 10);
  test.equal(out.s, 20);
  test.equal(out.typography.body, 'Inter');
  test.equal(out.visual.avatar, 'x.png');
});

Tinytest.add('harness - normalizeOutfit - empty/invalid input yields palette zeroes', function (test) {
  test.equal(normalizeOutfit(null), { h: 0, s: 0 });
  test.equal(normalizeOutfit(undefined), { h: 0, s: 0 });
  test.equal(normalizeOutfit('not an object'), { h: 0, s: 0 });
});

Tinytest.add('harness - getClientInfo - avatar URL honors harness prefix (no hardcoded /harness/)', function (test) {
  const entity = {
    handle: 'alice',
    name: 'Alice',
    role: 'guide',
    outfit: { h: 1, s: 2 },
    buttons: [],
    landingMd: null,
    avatarPath: '/some/path/avatar.png',
  };
  // Default harness namespace
  const underDefault = getClientInfo(entity, undefined, '/harness');
  test.equal(underDefault.avatarUrl, '/harness/entities/alice/avatar');
  // Per-entity prefix (the live bug this fixes)
  const underNamespaced = getClientInfo(entity, undefined, '/harness/alice');
  test.equal(underNamespaced.avatarUrl, '/harness/alice/entities/alice/avatar');
  // Completely custom mount path
  const underCustom = getClientInfo(entity, undefined, '/h/jesus');
  test.equal(underCustom.avatarUrl, '/h/jesus/entities/alice/avatar');
  // Trailing slash on prefix must not double-slash
  const underTrailing = getClientInfo(entity, undefined, '/harness/alice/');
  test.equal(underTrailing.avatarUrl, '/harness/alice/entities/alice/avatar');
});

Tinytest.add('harness - getClientInfo - no avatar → avatarUrl null', function (test) {
  const entity = { handle: 'x', name: 'X', role: '', outfit: { h: 0, s: 0 }, avatarPath: null };
  const info = getClientInfo(entity, undefined, '/harness');
  test.isNull(info.avatarUrl);
});

Tinytest.add('harness - getClientInfo - LOD ceiling applied to outfit field', function (test) {
  const entity = {
    handle: 'v',
    name: 'V',
    role: '',
    outfit: fullOutfit,
    avatarPath: '/p/a.png',
  };
  const info0 = getClientInfo(entity, 0, '/harness');
  test.equal(info0.outfit, { h: 222, s: 28 });
  const info4 = getClientInfo(entity, 4, '/harness');
  test.equal(info4.outfit.spatial.mesh, 'identity/avatar.glb');
});
