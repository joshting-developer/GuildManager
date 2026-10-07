// Frontend-callable wrappers expose only the documented RPC allowlist.
function doGet() {
  const settings = GuildGas.rpc('getPlatformSettings', []);
  const platform = settings.ok ? settings.data.platform : null;
  const name = platform ? platform.name : '幫會平台';
  const namespace = JSON.stringify(ScriptApp.getScriptId()).replace(/</g, '\\u003c');
  const branding = JSON.stringify(platform).replace(/</g, '\\u003c');
  const html = HtmlService.createHtmlOutputFromFile('Index')
    .getContent()
    .replace('</head>', function () {
      return '<script>window.__GUILD_GAS_KEY__=' + namespace + ';window.__GUILD_PLATFORM__=' + branding + ';</script></head>';
    });
  return HtmlService.createHtmlOutput(html)
    .setTitle(name + ' · 幫會管理平台')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// The editor hides underscore-suffixed helpers from its function selector.
// This runnable wrapper uses Google's server-side identity, never the app role.
// Web Apps must keep the documented "execute as deployer" configuration.
function setupGas() {
  requireGasExecutor_();
  return setupGas_();
}

// Recovery reads the new password only from private Script Properties.
function resetAdminPassword() {
  requireGasExecutor_();
  const result = GuildGas.resetAdminPassword();
  Logger.log(result.message);
  return result;
}

function requireGasExecutor_() {
  const activeEmail = Session.getActiveUser().getEmail();
  const effectiveEmail = Session.getEffectiveUser().getEmail();
  if (!activeEmail || !effectiveEmail || activeEmail !== effectiveEmail) {
    throw new Error('此操作需由 Google 執行帳號操作，請在 Apps Script 編輯器執行');
  }
}

// Preserve the private implementation; browsers cannot call this helper.
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

function getPlatformSettings(context) {
  return GuildGas.rpc('getPlatformSettings', [], context);
}

function updatePlatformSettings(input, context) {
  return GuildGas.rpc('updatePlatformSettings', [input], context);
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

function getMemberBattleRecords(uid, page, filters, context) {
  // Preserve older clients that pass their session context as the third argument.
  if (context === undefined) {
    context = filters;
    filters = {};
  }
  return GuildGas.rpc('getMemberBattleRecords', [uid, page, filters], context);
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

function getEventAttendance(eventId, context) {
  return GuildGas.rpc('getEventAttendance', [eventId], context);
}

function cancelEventLeave(eventId, input, context) {
  return GuildGas.rpc('cancelEventLeave', [eventId, input], context);
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

function updateBattleRecord(id, input, context) {
  return GuildGas.rpc('updateBattleRecord', [id, input], context);
}

function saveBattleRecords(input, context) {
  return GuildGas.rpc('saveBattleRecords', [input], context);
}

function getBattleAttachment(id, kind, context) {
  return GuildGas.rpc('getBattleAttachment', [id, kind], context);
}

function getEventVideos(eventId, context) {
  return GuildGas.rpc('getEventVideos', [eventId], context);
}

function submitEventVideo(eventId, input, context) {
  return GuildGas.rpc('submitEventVideo', [eventId, input], context);
}

function getLottery(context) {
  return GuildGas.rpc('getLottery', [], context);
}

function saveLottery(input, context) {
  return GuildGas.rpc('saveLottery', [input], context);
}

function drawLotteryPrize(input, context) {
  return GuildGas.rpc('drawLotteryPrize', [input], context);
}

function resetLottery(input, context) {
  return GuildGas.rpc('resetLottery', [input], context);
}
