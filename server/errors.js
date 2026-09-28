class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

const bad = (msg) => new HttpError(400, msg);

module.exports = { HttpError, bad };

