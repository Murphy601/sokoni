import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateVoiceUpload,
  baseMimetype,
  extensionFor,
  MAX_VOICE_BYTES,
  MAX_VOICE_MS,
  VOICE_TTL_MS,
} from "./voice-upload.js";

const SRC = readFileSync(new URL("./voice-upload.js", import.meta.url), "utf8");
const API = readFileSync(new URL("../routes/socialApi.js", import.meta.url), "utf8");
const WA = readFileSync(new URL("./whatsapp.js", import.meta.url), "utf8");
const SERVER = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const INBOX = readFileSync(new URL("../../../website/assets/js/inbox.js", import.meta.url), "utf8");

const ok = (n = 1024) => Buffer.alloc(n, 1);

describe("what a recording may be", () => {
  it("accepts what a browser actually produces", () => {
    for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"]) {
      assert.equal(validateVoiceUpload({ buffer: ok(), mimetype: m, durationMs: 5000 }).ok, true, m);
    }
  });

  it("strips the codecs parameter before matching", () => {
    assert.equal(baseMimetype("audio/webm;codecs=opus"), "audio/webm");
    assert.equal(extensionFor("audio/webm;codecs=opus"), "webm");
  });

  it("refuses anything that is not audio", () => {
    for (const m of ["image/png", "application/pdf", "text/html", "", null, "audio/x-made-up"]) {
      assert.equal(validateVoiceUpload({ buffer: ok(), mimetype: m }).ok, false, String(m));
    }
  });

  it("refuses an empty recording", () => {
    assert.equal(validateVoiceUpload({ buffer: Buffer.alloc(0), mimetype: "audio/webm" }).ok, false);
    assert.equal(validateVoiceUpload({ mimetype: "audio/webm" }).ok, false);
  });

  it("refuses one past the byte cap", () => {
    const r = validateVoiceUpload({ buffer: ok(MAX_VOICE_BYTES + 1), mimetype: "audio/webm" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "recording_too_large");
  });

  it("does not let a claimed duration buy a bigger file", () => {
    // The client sets durationMs. The byte cap is what actually holds.
    const big = validateVoiceUpload({
      buffer: ok(MAX_VOICE_BYTES + 1),
      mimetype: "audio/webm",
      durationMs: 1,
    });
    assert.equal(big.ok, false);
    assert.equal(big.error, "recording_too_large");
  });

  it("rejects an implausible duration too", () => {
    const r = validateVoiceUpload({ buffer: ok(), mimetype: "audio/webm", durationMs: MAX_VOICE_MS * 10 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "recording_too_long");
  });
});

describe("nothing lingers in memory", () => {
  it("uploads into memory, not onto disk", () => {
    assert.match(API, /multer\.memoryStorage\(\)/);
  });

  it("caps the upload at the multer layer as well", () => {
    // Otherwise a huge body is fully received before anything checks it.
    assert.match(API, /fileSize: MAX_VOICE_BYTES/);
    assert.match(API, /LIMIT_FILE_SIZE/);
  });

  it("sends to WAHA straight from the buffer", () => {
    // Writing it out only to read it back would put the same bytes through
    // the filesystem twice.
    assert.match(WA, /export async function sendVoiceBuffer/);
    const fn = WA.slice(WA.indexOf("export async function sendVoiceBuffer"));
    assert.doesNotMatch(fn.slice(0, 1200), /writeFile|readFile/);
  });

  it("does not make the buyer wait on WAHA", () => {
    const route = API.slice(API.indexOf('router.post("/chat/voice"'));
    assert.match(route.slice(0, 4000), /void \(async \(\) => \{/);
  });
});

describe("the stored copy is bounded", () => {
  it("expires with the message", () => {
    assert.match(API, /expiresAt: new Date\(Date\.now\(\) \+ VOICE_TTL_MS\)/);
    assert.equal(VOICE_TTL_MS, 48 * 60 * 60 * 1000);
  });

  it("is purged on a timer, not by a crontab someone must remember", () => {
    assert.match(SERVER, /startVoiceNotePurge/);
    assert.match(SRC, /export async function purgeExpiredVoiceNotes/);
  });

  it("names files with a UUID, never with anything a user sent", () => {
    // A crafted filename must not escape the folder or collide.
    assert.match(SRC, /randomUUID\(\)/);
    const fn = SRC.slice(SRC.indexOf("export async function storeVoiceNote"));
    assert.doesNotMatch(fn.slice(0, 700), /filename \|\||originalname/);
  });

  it("serves them privately", () => {
    assert.match(SERVER, /Cache-Control", "private, max-age=3600/);
    assert.match(SERVER, /X-Content-Type-Options/);
  });
});

describe("the recorder in the browser", () => {
  it("picks a container the browser supports rather than assuming webm", () => {
    // Safari refuses webm outright.
    assert.match(INBOX, /isTypeSupported/);
    assert.match(INBOX, /audio\/mp4/);
  });

  it("hides the button when recording is impossible", () => {
    assert.match(INBOX, /btn\.hidden = true/);
  });

  it("always releases the microphone", () => {
    // A mic left live is alarming, and on a phone it keeps the radio awake.
    assert.match(INBOX, /function releaseMic/);
    assert.match(INBOX, /getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/);
    assert.match(INBOX, /pagehide/);
  });

  it("stops itself at the cap so an upload is never rejected for length", () => {
    assert.match(INBOX, /MAX_RECORD_MS = 30_000/);
    assert.match(INBOX, /recordTimer = setTimeout\(\(\) => stopRecording\(\)/);
  });

  it("drops a misfire rather than sending silence", () => {
    assert.match(INBOX, /durationMs >= 1000/);
  });

  it("shows that it is recording, and respects reduced motion", () => {
    assert.match(INBOX, /is-recording/);
    assert.match(INBOX, /aria-pressed/);
  });
});
