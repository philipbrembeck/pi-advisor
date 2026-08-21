const { createService } = require(`${process.cwd()}/src`);

const value = createService([
  { id: "acct-1", preferences: { email: true }, version: 0 },
]);
value.service.update("acct-1", { sms: true });
value.service.update("acct-1", { push: true });
if (value.outbox.pending().length !== 2) {
  process.exit(1);
}
await value.dispatcher.dispatch();
if (value.outbox.pending().length !== 0) {
  process.exit(1);
}
if (value.client.calls.length !== 1) {
  process.exit(1);
}
const sent = value.client.calls[0].eventIds;
if (sent.length !== 2 || sent[0] === sent[1]) {
  process.exit(1);
}
if (value.client.calls[0].idempotencyKey !== sent.join(",")) {
  process.exit(1);
}

const retry = createService([{ id: "acct-2", preferences: {}, version: 0 }]);
retry.service.update("acct-2", { email: true });
retry.client.failAfterAccept = true;
try {
  await retry.dispatcher.dispatch();
  process.exit(1);
} catch (error) {
  if (!error.accepted) {
    process.exit(1);
  }
}
await retry.dispatcher.dispatch();
if (retry.client.calls.length !== 1 || retry.outbox.pending().length !== 0) {
  process.exit(1);
}

const rollback = createService([{ id: "acct-3", preferences: {}, version: 0 }]);
try {
  rollback.service.update("acct-3", { fax: true });
  process.exit(1);
} catch {
  // Invalid input must leave the transaction untouched.
}
if (rollback.accountRepository.get("acct-3").version !== 0) {
  process.exit(1);
}
if (rollback.outbox.pending().length !== 0) {
  process.exit(1);
}
