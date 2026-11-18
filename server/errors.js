export class DutyError extends Error {
  constructor(message, status = 422, code = 'DUTY_INVALID') {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = {};
  }
}

export class ParticipationError extends Error {
  constructor(message, status = 422, code = 'PARTICIPATION_INVALID') {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = {};
  }
}
