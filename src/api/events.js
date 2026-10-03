export function createEventClient({
  source = 'local',
  fetchImpl = globalThis.fetch,
  googleRun,
} = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  async function call(method, input) {
    if (source === 'gas') {
      const run = googleRun || globalThis.google?.script?.run;
      if (!run) throw new Error('雲端活動資料尚未串接');
      return new Promise((resolve, reject) => {
        const runner = run
          .withSuccessHandler(resolve)
          .withFailureHandler((error) =>
            reject(new Error(error?.message || '雲端活動操作失敗，請稍後再試')),
          );
        if (method === 'GET') runner.getEvents();
        else runner.createEvent(input);
      });
    }
    let response;
    try {
      response = await fetchImpl('/api/events', {
        method,
        ...(input
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
          : {}),
      });
    } catch {
      throw new Error('無法連線，請確認本機服務已啟動後重試');
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('資料回應格式不正確，請稍後再試');
    }
    if (!response.ok) {
      const error = new Error(data.error?.message || '目前無法完成操作，請稍後再試');
      error.fields = data.error?.fields || {};
      error.code = data.error?.code;
      throw error;
    }
    return data;
  }
  return { getEvents: () => call('GET'), createEvent: (input) => call('POST', input) };
}
