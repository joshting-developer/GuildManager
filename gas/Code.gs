// Frontend-callable wrappers expose only the documented RPC allowlist.
function doGet() {
  const namespace = JSON.stringify(ScriptApp.getScriptId()).replace(/</g, '\u003c');
  const html = HtmlService.createHtmlOutputFromFile('Index')
    .getContent()
    .replace('</head>', '<script>window.__GUILD_GAS_KEY__=' + namespace + ';</script></head>');
  return HtmlService.createHtmlOutput(html)
    .setTitle('逆水寒 · 幫會管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// Run once in the editor after setting private Script Properties. The trailing
// underscore prevents browser calls through google.script.run.
function setupGas_() {
  return GuildGas.setup();
}

function getAuthSession(context) {
  return GuildGas.rpc('getAuthSession', [], context);
}

function login(input, context) {
  return GuildGas.rpc('login', [input], context);
}

function loginMember(input, context) {
  return GuildGas.rpc('loginMember', [input], context);
}

function logout(context) {
  return GuildGas.rpc('logout', [], context);
}

function getAccountSettings(context) {
  return GuildGas.rpc('getAccountSettings', [], context);
}

function changeAdminPassword(input, context) {
  return GuildGas.rpc('changeAdminPassword', [input], context);
}

function createManager(input, context) {
  return GuildGas.rpc('createManager', [input], context);
}

function updateManager(input, context) {
  return GuildGas.rpc('updateManager', [input], context);
}

function setMemberToken(input, context) {
  return GuildGas.rpc('setMemberToken', [input], context);
}

function getHomeData(context) {
  return GuildGas.rpc('getHomeData', [], context);
}

function getMembers(context) {
  return GuildGas.rpc('getMembers', [], context);
}

function getProfessions(context) {
  return GuildGas.rpc('getProfessions', [], context);
}

function getParticipationMembers(context) {
  return GuildGas.rpc('getParticipationMembers', [], context);
}

function getMemberBattleRecords(uid, page, context) {
  return GuildGas.rpc('getMemberBattleRecords', [uid, page], context);
}

function addMember(input, context) {
  return GuildGas.rpc('addMember', [input], context);
}

function updateMember(uid, input, context) {
  return GuildGas.rpc('updateMember', [uid, input], context);
}

function removeMember(uid, revision, context) {
  return GuildGas.rpc('removeMember', [uid, revision], context);
}

function previewMemberImport(input, context) {
  return GuildGas.rpc('previewMemberImport', [input], context);
}

function importMembers(input, context) {
  return GuildGas.rpc('importMembers', [input], context);
}

function getEvents(context) {
  return GuildGas.rpc('getEvents', [], context);
}

function createEvent(input, context) {
  return GuildGas.rpc('createEvent', [input], context);
}

function updateEvent(id, input, context) {
  return GuildGas.rpc('updateEvent', [id, input], context);
}

function deleteEvent(id, revision, context) {
  return GuildGas.rpc('deleteEvent', [id, revision], context);
}

function getDuties(context) {
  return GuildGas.rpc('getDuties', [], context);
}

function addDuty(input, context) {
  return GuildGas.rpc('addDuty', [input], context);
}

function updateDuty(id, input, context) {
  return GuildGas.rpc('updateDuty', [id, input], context);
}

function getEventParticipation(eventId, context) {
  return GuildGas.rpc('getEventParticipation', [eventId], context);
}

function getEventParticipationMembers(eventId, context) {
  return GuildGas.rpc('getEventParticipationMembers', [eventId], context);
}

function submitParticipation(eventId, input, context) {
  return GuildGas.rpc('submitParticipation', [eventId, input], context);
}

function saveMemberResponse(eventId, input, context) {
  return GuildGas.rpc('saveMemberResponse', [eventId, input], context);
}

function addGuestRegistration(eventId, input, context) {
  return GuildGas.rpc('addGuestRegistration', [eventId, input], context);
}

function cancelGuestRegistration(eventId, id, revision, context) {
  return GuildGas.rpc('cancelGuestRegistration', [eventId, id, revision], context);
}

function getLineupIndex(context) {
  return GuildGas.rpc('getLineupIndex', [], context);
}

function getLineupHistory(eventId, context) {
  return GuildGas.rpc('getLineupHistory', [eventId], context);
}

function confirmLineup(input, context) {
  return GuildGas.rpc('confirmLineup', [input], context);
}

function createLineupTemplate(input, context) {
  return GuildGas.rpc('createLineupTemplate', [input], context);
}

function applyLineupTemplate(templateId, eventId, context) {
  return GuildGas.rpc('applyLineupTemplate', [templateId, eventId], context);
}

function getBattleRecords(page, eventId, context) {
  return GuildGas.rpc('getBattleRecords', [page, eventId], context);
}

function getBattleRecord(id, context) {
  return GuildGas.rpc('getBattleRecord', [id], context);
}

function saveBattleRecords(input, context) {
  return GuildGas.rpc('saveBattleRecords', [input], context);
}

function getBattleAttachment(id, kind, context) {
  return GuildGas.rpc('getBattleAttachment', [id, kind], context);
}
