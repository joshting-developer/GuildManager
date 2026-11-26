import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vue from 'vue';
import { validateVideoDetails } from '../src/domain/event-videos.js';
import { memberChoices, inNameSource } from '../src/domain/member-choices.js';

function setup(file, props, exports, overrides = {}) {
  const script = readFileSync(new URL('../src/pages/' + file, import.meta.url), 'utf8')
    .match(/<script setup>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*;\n/gm, '');
  const context = { ...vue, validateVideoDetails, memberChoices, inNameSource,
    defineProps: () => props, defineEmits: () => () => {},
    defineExpose: () => {}, onUnmounted: () => {},
    createEventVideoClient: () => ({}), createEventClient: () => ({}), ...overrides };
  return new Function(...Object.keys(context), script + '\nreturn {' + exports + '};')(...Object.values(context));
}

test('manual tab is third for video; profession-filtered participation keeps two tabs', () => {
  for (const [showManual, expected] of [[true, ['guild', 'club', 'manual']], [undefined, ['guild', 'club']]]) {
    const picker = setup('NameSourcePicker.vue', { filterByProfession: true, showManual, members: [] }, 'sources');
    assert.deepEqual(picker.sources.value.map(item => item.value), expected);
  }
});

test('video keeps selected secondary profession and clears members after profession or roster changes', async () => {
  const member = { uid: 'a', name: '角色', isInGuild: true, primaryProfessionId: 1, secondaryProfessionId: 2 };
  const props = vue.reactive({ members: [member], event: { id: 1 } });
  const form = setup('VideoUploadForm.vue', props, 'draft,nameSource,selectedMemberUid');
  assert.equal(form.nameSource.value, 'guild');
  form.draft.value.professionId = 2;
  form.selectedMemberUid.value = 'a';
  await vue.nextTick();
  assert.equal(form.draft.value.name, '角色');
  assert.equal(form.draft.value.professionId, 2);
  form.draft.value.professionId = 3;
  await vue.nextTick();
  assert.equal(form.selectedMemberUid.value, null);
  assert.equal(form.draft.value.name, '');
  form.draft.value.professionId = 1;
  form.selectedMemberUid.value = 'a';
  await vue.nextTick();
  props.members = [];
  await vue.nextTick();
  assert.equal(form.selectedMemberUid.value, null);
});

test('video submits selected profession and UID; manual input omits UID and validates profession', async () => {
  for (const manual of [false, true]) {
    let payload;
    const props = { members: [{ uid: 'a', name: '角色', isInGuild: true, primaryProfessionId: 1, secondaryProfessionId: 2 }], event: { id: 1 } };
    const form = setup('VideoUploadForm.vue', props, 'draft,nameSource,selectedMemberUid,submit,errors', {
      createEventVideoClient: () => ({ submitVideo: async (_id, input) => { payload = input; } }),
    });
    if (manual) { form.nameSource.value = 'manual'; await vue.nextTick(); }
    Object.assign(form.draft.value, { name: '角色', professionId: 2, firstUrl: 'https://example.com/video', groupName: '進攻一' });
    if (!manual) form.selectedMemberUid.value = 'a';
    await vue.nextTick();
    await form.submit();
    assert.equal(payload.professionId, 2);
    assert.equal(payload.memberUid, manual ? undefined : 'a');
    assert.ok(payload.requestId);
    assert.equal(form.draft.value.name, '');
    if (manual) {
      Object.assign(form.draft.value, { name: '角色', firstUrl: 'https://example.com/video', groupName: '進攻一' });
      await form.submit();
      assert.equal(form.errors.value.professionId, '請選擇職業');
    }
  }
});

test('video submit without profession points to the profession field first in every source', async () => {
  for (const source of ['guild', 'club', 'manual']) {
    const form = setup('VideoUploadForm.vue', { members: [], event: { id: 1 } }, 'submit,errors,nameSource');
    form.nameSource.value = source;
    await vue.nextTick();
    await form.submit();
    assert.equal(form.errors.value.professionId, '請選擇職業');
    assert.equal(form.errors.value.name, undefined);
  }
});
