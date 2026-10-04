const MEMBER_EVENT_TYPES = ['guild_war', 'dragon_tiger'];
export function calendarRequiresLogin(event) {
  return MEMBER_EVENT_TYPES.includes(event.type);
}
export function visibleCalendarEvents(events, user) {
  const signedIn = ['member', 'manager', 'admin'].includes(user?.role);
  return events.filter((event) => signedIn || !calendarRequiresLogin(event));
}
