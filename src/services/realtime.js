// Thin wrapper so services can push live events without depending on Socket.IO directly.
let io = null;

function attach(server) { io = server; }

function emit(event, payload) {
  if (io) io.to('authenticated').emit(event, payload);
}

module.exports = { attach, emit };
