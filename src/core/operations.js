// No Electron or OS dependencies: the same lifecycle can be used by another host.
function createOperationCoordinator() {
  let current = null;
  return {
    begin(kind) {
      if (current) return null;
      const controller = new AbortController();
      let complete;
      current = { kind, controller, signal: controller.signal, cancelled: false, progress: null,
        done: new Promise((resolve) => { complete = resolve; }), complete };
      return current;
    },
    cancel() {
      if (current) { current.cancelled = true; current.controller.abort(); }
      return current;
    },
    finish(operation) {
      if (!operation) return;
      if (current === operation) current = null;
      operation.complete();
    },
    get current() { return current; }
  };
}
function checkOperation(operation) {
  if (operation?.cancelled || operation?.signal.aborted) {
    const error = new Error('Операция остановлена пользователем.');
    error.code = 'ABORT_ERR';
    throw error;
  }
}
module.exports = { createOperationCoordinator, checkOperation };
