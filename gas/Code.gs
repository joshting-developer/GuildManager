// Frontend-callable wrappers expose only the documented RPC allowlist.
function doGet() {
  const platform = GuildGas.pagePlatform();
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

// Sends a test message to each configured Discord webhook; results appear in the log.
function testDiscordWebhooks() {
  requireGasExecutor_();
  const results = GuildGas.testDiscordWebhooks();
  results.forEach(function (line) {
    Logger.log(line);
  });
  return results;
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

function getEvent(eventId, context) {
  return GuildGas.rpc('getEvent', [eventId], context);
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

function getEventParticipationForm(eventId, context) {
  return GuildGas.rpc('getEventParticipationForm', [eventId], context);
}

function getEventVideoForm(eventId, context) {
  return GuildGas.rpc('getEventVideoForm', [eventId], context);
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

function deleteGuestRegistration(eventId, id, revision, context) {
  return GuildGas.rpc('deleteGuestRegistration', [eventId, id, revision], context);
}

function cancelGuestRegistration(eventId, id, revision, context) {
  return GuildGas.rpc('cancelGuestRegistration', [eventId, id, revision], context);
}

// Older pages call getLineupIndex(context); newer ones pass options first.
function getLineupIndex(options, context) {
  if (context === undefined) return GuildGas.rpc('getLineupIndex', [], options);
  return GuildGas.rpc('getLineupIndex', [options], context);
}

function getLineupEditor(eventId, context) {
  return GuildGas.rpc('getLineupEditor', [eventId], context);
}

function getLineupEvent(eventId, includeCatalogs, context) {
  return GuildGas.rpc('getLineupEvent', [eventId, includeCatalogs], context);
}

function getLineupTemplates(context) {
  return GuildGas.rpc('getLineupTemplates', [], context);
}

function getLineupSources(eventId, context) {
  return GuildGas.rpc('getLineupSources', [eventId], context);
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

function deleteLineupTemplate(id, context) {
  return GuildGas.rpc('deleteLineupTemplate', [id], context);
}

function applyLineupTemplate(templateId, eventId, context) {
  return GuildGas.rpc('applyLineupTemplate', [templateId, eventId], context);
}

function getBattleRecords(page, eventId, context) {
  return GuildGas.rpc('getBattleRecords', [page, eventId], context);
}

function getBattleUploadRoster(context) {
  return GuildGas.rpc('getBattleUploadRoster', [], context);
}

function getBattleRecord(id, options, context) {
  // Older clients pass their session as the second argument.
  if (context === undefined && options && typeof options === 'object' &&
      ('sessionToken' in options || 'csrfToken' in options)) {
    context = options;
    options = {};
  }
  return GuildGas.rpc('getBattleRecord', [id, options === undefined ? {} : options], context);
}

function getBattleMetadata(id, context) {
  return GuildGas.rpc('getBattleMetadata', [id], context);
}

function getBattleTeamAnalysis(id, context) {
  return GuildGas.rpc('getBattleTeamAnalysis', [id], context);
}

function previewBattleMemberSync(context) {
  return GuildGas.rpc('previewBattleMemberSync', [], context);
}

function syncBattleMembers(input, context) {
  return GuildGas.rpc('syncBattleMembers', [input], context);
}

function updateBattleRecord(id, input, context) {
  return GuildGas.rpc('updateBattleRecord', [id, input], context);
}

function deleteBattleRecord(id, revision, context) {
  return GuildGas.rpc('deleteBattleRecord', [id, revision], context);
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

function getVideoBrowser(eventId, context) {
  return GuildGas.rpc('getVideoBrowser', [eventId], context);
}

function submitEventVideo(eventId, input, context) {
  return GuildGas.rpc('submitEventVideo', [eventId, input], context);
}

function updateEventVideoProfession(eventId, videoId, input, context) {
  return GuildGas.rpc('updateEventVideoProfession', [eventId, videoId, input], context);
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

function getMemberMaintenance(uid, context) {
  return GuildGas.rpc('getMemberMaintenance', [uid], context);
}

function maintainMember(uid, input, context) {
  return GuildGas.rpc('maintainMember', [uid, input], context);
}

function saveMemberNameHistory(uid, input, context) {
  return GuildGas.rpc('saveMemberNameHistory', [uid, input], context);
}

function deleteMemberPermanently(uid, input, context) {
  return GuildGas.rpc('deleteMemberPermanently', [uid, input], context);
}
