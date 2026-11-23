// Existing business assertions migrated to the async MySQL contract.
await import('./mysql-contracts/attack-defense-analysis.test.js');
await import('./mysql-contracts/battle-attributions.test.js');
await import('./mysql-contracts/battle-csv-summary.test.js');
await import('./mysql-contracts/battle-member-sync.test.js');
await import('./mysql-contracts/battle-metadata.test.js');
await import('./mysql-contracts/battle-records.test.js');
await import('./mysql-contracts/calendar-access.test.js');
await import('./mysql-contracts/calendar-video-form.test.js');
await import('./mysql-contracts/discord-notifications.test.js');
await import('./mysql-contracts/duties.test.js');
await import('./mysql-contracts/event-attendance.test.js');
await import('./mysql-contracts/event-batches.test.js');
await import('./mysql-contracts/event-management.test.js');
await import('./mysql-contracts/event-types.test.js');
await import('./mysql-contracts/event-videos.test.js');
await import('./mysql-contracts/events.test.js');
await import('./mysql-contracts/historical-sync.test.js');
await import('./mysql-contracts/legacy-import.test.js');
await import('./mysql-contracts/lineup-empty-person.test.js');
await import('./mysql-contracts/lineup-read-efficiency.test.js');
await import('./mysql-contracts/lineup-rounds.test.js');
await import('./mysql-contracts/lineup-sources.test.js');
await import('./mysql-contracts/lineup-template-save.test.js');
await import('./mysql-contracts/lineups.test.js');
await import('./mysql-contracts/lottery.test.js');
await import('./mysql-contracts/member-external.test.js');
await import('./mysql-contracts/member-history-filters.test.js');
await import('./mysql-contracts/member-import.test.js');
await import('./mysql-contracts/member-choices.test.js');
await import('./mysql-contracts/member-maintenance.test.js');
await import('./mysql-contracts/member-membership.test.js');
await import('./mysql-contracts/members.test.js');
await import('./mysql-contracts/optional-event-title.test.js');
await import('./mysql-contracts/participation-concurrency.test.js');
await import('./mysql-contracts/participation-form.test.js');
await import('./mysql-contracts/participation-lineups.test.js');
await import('./mysql-contracts/participation.test.js');
await import('./mysql-contracts/password-length.test.js');
await import('./mysql-contracts/persistence.test.js');
await import('./mysql-contracts/personal-battle-records.test.js');
await import('./mysql-contracts/personal-battle-selection.test.js');
await import('./mysql-contracts/platform-icon.test.js');
await import('./mysql-contracts/platform-settings.test.js');
await import('./mysql-contracts/team-battle-analysis.test.js');
await import('./mysql-contracts/transactions.test.js');
await import('./mysql-contracts/video-browser.test.js');
await import('./mysql-contracts/video-profession-edit.test.js');
await import('./mysql-contracts/video-edit.test.js');
// HTTP contracts share the repositorytest schema, so they must run in this same process.
await import('./mysql-http.test.js');

await import('./mysql-contracts/attendance-history.test.js');

await import('./mysql-contracts/participation-revisions.test.js');

// Scenarios carried over from the retired storage tests.
await import('./mysql-scenarios/admin.test.js');
await import('./mysql-scenarios/event-management-list.test.js');
await import('./mysql-scenarios/attack-defense-analysis.test.js');
await import('./mysql-scenarios/auth.test.js');
await import('./mysql-scenarios/battle-attributions.test.js');
await import('./mysql-scenarios/battle-delete.test.js');
await import('./mysql-scenarios/battle-member-sync.test.js');
await import('./mysql-scenarios/battle-metadata-read.test.js');
await import('./mysql-scenarios/battle-metadata.test.js');
await import('./mysql-scenarios/battle-records.test.js');
await import('./mysql-scenarios/calendar-access.test.js');
await import('./mysql-scenarios/calendar-video-form.test.js');
await import('./mysql-scenarios/duties.test.js');
await import('./mysql-scenarios/event-attendance.test.js');
await import('./mysql-scenarios/event-batches.test.js');
await import('./mysql-scenarios/event-management.test.js');
await import('./mysql-scenarios/event-videos.test.js');
await import('./mysql-scenarios/guest-delete.test.js');
await import('./mysql-scenarios/lineup-alias.test.js');
await import('./mysql-scenarios/lineup-index.test.js');
await import('./mysql-scenarios/lineup-read-efficiency.test.js');
await import('./mysql-scenarios/lineup-template-save.test.js');
await import('./mysql-scenarios/lottery.test.js');
await import('./mysql-scenarios/member-analysis-access.test.js');
await import('./mysql-scenarios/member-import.test.js');
await import('./mysql-scenarios/member-maintenance.test.js');
await import('./mysql-scenarios/member-membership.test.js');
await import('./mysql-scenarios/member-roster-access.test.js');
await import('./mysql-scenarios/members.test.js');
await import('./mysql-scenarios/optional-event-title.test.js');
await import('./mysql-scenarios/participation-access.test.js');
await import('./mysql-scenarios/participation-form.test.js');
await import('./mysql-scenarios/participation-read-optimization.test.js');
await import('./mysql-scenarios/participation.test.js');
await import('./mysql-scenarios/personal-battle-selection.test.js');
await import('./mysql-scenarios/platform-icon.test.js');
await import('./mysql-scenarios/platform-settings.test.js');
await import('./mysql-scenarios/team-battle-analysis.test.js');
await import('./mysql-scenarios/video-browser.test.js');
await import('./mysql-scenarios/video-profession-edit.test.js');
await import('./mysql-scenarios/video-edit.test.js');
await import('./mysql-contracts/profession-management.test.js');

await import('./mysql-contracts/lineup-history-batch.test.js');

await import('./mysql-contracts/video-pagination.test.js');

await import('./mysql-contracts/member-maintenance-batch.test.js');

await import('./benchmark.test.js');
