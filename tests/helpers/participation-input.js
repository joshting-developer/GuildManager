import { participationTarget } from '../../src/domain/participation-target.js';

// Legacy business cases now capture an individual expectation instead of a form hash.
export async function submitFromCurrentForm(repository, eventId, input) {
  if (!Object.hasOwn(input, 'expectedParticipant')) {
    const snapshot = await repository.getEventParticipationForm(eventId);
    input.expectedParticipant = { person: participationTarget(input, snapshot) };
  }
  return repository.submitParticipation(eventId, input);
}
