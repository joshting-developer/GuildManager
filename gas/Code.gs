function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('逆水寒 · 幫會管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
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
  throw new Error('雲端成員移除尚未串接');
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
