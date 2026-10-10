// pair-server.js
// Small web server that serves the pairing page and creates WhatsApp pairing codes.
// Each phone number gets its own session folder, so numbers never share a session.

const express = require('express');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
// If your package.json uses a different Baileys package, change this name.
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  delay
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSIONS_DIR = path.join(__dirname, 'pair-sessions'); // add this folder to .gitignore
const CODE_WAIT_MS = 2 * 60 * 1000; // how long a user has to enter the code

fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const pending = new Set(); // numbers waiting for a user to enter their code

// Opens a socket for one number and keeps it online after it is linked.
async function connect(number) {
  const dir = path.join(SESSIONS_DIR, number);
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome')
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log(`[${number}] linked and online`);
      pending.delete(number);
    }

    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode;

      if (status === DisconnectReason.loggedOut) {
        // The user removed the device in WhatsApp. Delete the dead session.
        console.log(`[${number}] logged out, session deleted`);
        fs.rmSync(dir, { recursive: true, force: true });
        pending.delete(number);
      } else if (sock.authState.creds.registered) {
        // WhatsApp closes the socket right after linking (status 515). Reconnect to finish.
        console.log(`[${number}] connection closed (${status}), reconnecting...`);
        connect(number).catch((e) => console.error(`[${number}] reconnect failed:`, e.message));
      }
    }
  });

  // TODO: attach your bot's message handler here, for example:
  // sock.ev.on('messages.upsert', (m) => handleMessages(sock, m));

  return sock;
}

app.use(express.static(path.join(__dirname, 'public')));

// GET /pair?number=254712345678  ->  { code: "ABCD1234" }
app.get('/pair', async (req, res) => {
  const number = String(req.query.number || '').replace(/\D/g, '');

  if (number.length < 10 || number.length > 15) {
    return res.status(400).json({ error: 'Invalid number. Include the country code, for example 254712345678.' });
  }
  if (pending.has(number)) {
    return res.status(429).json({ error: 'A code was already requested for this number. Wait 2 minutes and try again.' });
  }

  pending.add(number);

  try {
    const sock = await connect(number);

    if (sock.authState.creds.registered) {
      pending.delete(number);
      return res.status(409).json({ error: 'This number is already linked.' });
    }

    await delay(3000); // give the socket a moment to connect before asking for a code
    const code = await sock.requestPairingCode(number);
    res.json({ code });

    // If the user never enters the code, close the socket and clean up.
    setTimeout(() => {
      if (!sock.authState.creds.registered) {
        console.log(`[${number}] code expired, cleaning up`);
        try { sock.end(undefined); } catch (e) {}
        fs.rmSync(path.join(SESSIONS_DIR, number), { recursive: true, force: true });
        pending.delete(number);
      }
    }, CODE_WAIT_MS);
  } catch (err) {
    console.error(`[${number}] pairing failed:`, err.message);
    pending.delete(number);
    res.status(500).json({ error: 'Could not create a pairing code. Try again in a moment.' });
  }
});

// On startup, bring back every number that was already linked.
async function restoreSessions() {
  for (const number of fs.readdirSync(SESSIONS_DIR)) {
    const credsFile = path.join(SESSIONS_DIR, number, 'creds.json');
    if (!fs.existsSync(credsFile)) continue;
    try {
      const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
      if (creds.registered) {
        console.log(`[${number}] restoring session`);
        await connect(number);
        await delay(1500);
      }
    } catch (e) {
      console.error(`[${number}] could not restore:`, e.message);
    }
  }
}

app.listen(PORT, () => {
  console.log(`Pairing server running on port ${PORT}`);
  restoreSessions();
});
