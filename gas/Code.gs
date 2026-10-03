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
