function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('逆水寒 · 幫會管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// Google identity and allowed management accounts must be verified server-side before enabling these.
function getAuthSession() {
  throw new Error('Google 登入尚未設定');
}
function login(input) {
  throw new Error('雲端不使用本機帳號密碼, Google 登入尚未設定');
}
function logout() {
  throw new Error('Google 登入尚未設定');
}
function getAccountSettings() {
  throw new Error('雲端帳號管理尚未串接');
}
function changeAdminPassword(input) {
  throw new Error('雲端帳號管理尚未串接');
}
function createManager(input) {
  throw new Error('雲端帳號管理尚未串接');
}
function updateManager(input) {
  throw new Error('雲端帳號管理尚未串接');
}
function setMemberToken(input) {
  throw new Error('雲端成員通行密碼管理尚未串接');
}
function loginMember(input) {
  throw new Error('雲端通行密碼登入尚未串接');
}
function getMemberBattleRecords(uid, page) {
  throw new Error('雲端個人戰績尚未串接');
}
function getParticipationMembers() {
  throw new Error('雲端報名成員選單尚未串接');
}

// This deployment scaffold intentionally has no access to the live spreadsheet.
// Implement authentication and the home DTO contract before reading live data.
function getHomeData() {
  throw new Error('雲端首頁資料尚未串接');
}

// Local member functions share these names; cloud persistence is implemented later.
function getMembers() {
  throw new Error('雲端成員資料尚未串接');
}
function getProfessions() {
  throw new Error('雲端職業資料尚未串接');
}
function addMember(input) {
  throw new Error('雲端成員新增尚未串接');
}
function updateMember(uid, input) {
  throw new Error('雲端成員修改尚未串接');
}
function removeMember(uid, revision) {
  throw new Error('雲端人員移至編外尚未串接');
}

function previewMemberImport(input) {
  throw new Error('雲端成員匯入預覽尚未串接');
}
function importMembers(input) {
  throw new Error('雲端成員匯入尚未串接');
}

function getEvents() {
  throw new Error('雲端活動資料尚未串接 Google 試算表');
}

function createEvent(input) {
  throw new Error('雲端活動建立尚未串接 Google 試算表');
}

function updateEvent(id, input) {
  throw new Error('雲端活動修改尚未串接 Google 試算表');
}

function deleteEvent(id, revision) {
  throw new Error('雲端活動刪除尚未串接 Google 試算表');
}

function getLineupIndex() {
  throw new Error('雲端戰場排表尚未串接 Google 試算表');
}
function getLineupHistory(eventId) {
  throw new Error('雲端排表歷史尚未串接 Google 試算表');
}
function confirmLineup(input) {
  throw new Error('雲端排表確認尚未串接 Google 試算表');
}
function createLineupTemplate(input) {
  throw new Error('雲端排表範本尚未串接 Google 試算表');
}
function applyLineupTemplate(templateId, eventId) {
  throw new Error('雲端排表範本套用尚未串接 Google 試算表');
}

function getDuties() {
  throw new Error('雲端職責清單尚未串接 Google 試算表');
}
function addDuty(input) {
  throw new Error('雲端職責新增尚未串接 Google 試算表');
}
function updateDuty(id, input) {
  throw new Error('雲端職責修改尚未串接 Google 試算表');
}

function getEventParticipation(eventId) {
  throw new Error('雲端報名／請假尚未串接 Google 試算表');
}
function getEventParticipationMembers(eventId) {
  throw new Error('雲端報名成員選單尚未串接');
}
function saveMemberResponse(eventId, input) {
  throw new Error('雲端報名／請假尚未串接 Google 試算表');
}
function submitParticipation(eventId, input) {
  throw new Error('雲端報名／請假尚未串接 Google 試算表');
}
function addGuestRegistration(eventId, input) {
  throw new Error('雲端額外報名尚未串接 Google 試算表');
}
function cancelGuestRegistration(eventId, id, revision) {
  throw new Error('雲端取消報名尚未串接 Google 試算表');
}
function getBattleRecords(page) {
  throw new Error('雲端戰績清單尚未串接 Google 試算表');
}
function getBattleRecord(id) {
  throw new Error('雲端戰績詳情尚未串接 Google 試算表');
}
function saveBattleRecords(input) {
  throw new Error('雲端戰績上傳尚未串接 Google 試算表與 Drive');
}
function getBattleAttachment(id, kind) {
  throw new Error('雲端戰績附件尚未串接 Drive');
}
