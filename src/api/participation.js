export function createParticipationClient({
  source = 'local',
  fetchImpl = globalThis.fetch,
  googleRun,
} = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  async function call(operation, eventId, method = 'GET', input, registrationId) {
    if (source === 'gas') {
      const run = googleRun || globalThis.google?.script?.run;
      if (!run) throw new Error('雲端報名／請假尚未串接');
      const args = registrationId
        ? [eventId, registrationId, input.revision]
        : input
          ? [eventId, input]
          : [eventId];
      return new Promise((resolve, reject) => {
        run
          .withSuccessHandler(resolve)
          .withFailureHandler((error) =>
            reject(new Error(error?.message || '雲端報名／請假操作失敗')),
          )
          [operation](...args);
      });
    }
    const path = registrationId
      ? `registrations/${encodeURIComponent(registrationId)}`
      : method === 'POST'
        ? 'registrations'
        : 'participation';
    let response;
    try {
      response = await fetchImpl(`/api/events/${encodeURIComponent(eventId)}/${path}`, {
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
      const error = new Error(data.error?.message || '目前無法完成報名／請假');
      error.code = data.error?.code;
      throw error;
    }
    return data;
  }
  return {
    getParticipation: (eventId) => call('getEventParticipation', eventId),
    saveResponse: (eventId, input) => call('saveMemberResponse', eventId, 'PATCH', input),
    registerGuest: (eventId, input) => call('addGuestRegistration', eventId, 'POST', input),
    cancelGuest: (eventId, id, revision) =>
      call('cancelGuestRegistration', eventId, 'DELETE', { revision }, id),
  };
}
