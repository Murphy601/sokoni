import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validatePayload, MESSAGE_KINDS } from "../lib/message-kinds.js";

const WA = readFileSync(new URL("./whatsapp.js", import.meta.url), "utf8");
const API = readFileSync(new URL("../routes/socialApi.js", import.meta.url), "utf8");
const REPO = readFileSync(new URL("../db/repositories/social.js", import.meta.url), "utf8");
const BRIDGE = readFileSync(new URL("./inbox-bridge.js", import.meta.url), "utf8");
const WEBHOOK = readFileSync(new URL("../handlers/webhookHandler.js", import.meta.url), "utf8");
const INBOX = readFileSync(new URL("../../../website/assets/js/inbox.js", import.meta.url), "utf8");
const PURGE = readFileSync(new URL("../../../scripts/purge-waha-media.sh", import.meta.url), "utf8");

describe("audio never passes through this process", () => {
  it("streams rather than buffering", () => {
    // downloadWahaMedia uses an arraybuffer, which is right when the bot needs
    // the bytes. Serving a thread is not that: a hundred voice notes would go
    // through a heap capped at 450MB.
    const fn = WA.slice(WA.indexOf("export async function streamWahaMedia"));
    assert.match(fn.slice(0, 1400), /responseType: "stream"/);
    assert.doesNotMatch(fn.slice(0, 1400), /arraybuffer/);
  });

  it("pipes to the response instead of collecting it", () => {
    const route = API.slice(API.indexOf('router.get("/chat/media/:messageId"'));
    assert.match(route.slice(0, 2600), /stream\.pipe\(res\)/);
    assert.doesNotMatch(route.slice(0, 2600), /Buffer\.concat/);
  });

  it("stops pulling from WAHA when the listener leaves", () => {
    const route = API.slice(API.indexOf('router.get("/chat/media/:messageId"'));
    assert.match(route.slice(0, 2600), /res\.on\("close"/);
  });

  it("stores a pointer, never the audio", () => {
    const fn = BRIDGE.slice(BRIDGE.indexOf("export async function tryHandleInboxVoiceNote"));
    assert.match(fn.slice(0, 1600), /mediaUrl: String\(mediaUrl\)/);
    assert.doesNotMatch(fn.slice(0, 1600), /base64|Buffer|readFile/i);
  });
});

describe("who may hear a voice note", () => {
  it("is limited to the two people in the thread", () => {
    // Message ids are sequential. Without this, one id is a directory of every
    // voice note on the platform.
    const fn = REPO.slice(REPO.indexOf("export async function getMessageMedia"));
    assert.match(fn.slice(0, 1800), /not_in_thread/);
    assert.match(fn.slice(0, 1800), /sender_user_id\) !== viewer && Number\(row\.receiver_user_id\) !== viewer/);
  });

  it("refuses media that has expired", () => {
    const fn = REPO.slice(REPO.indexOf("export async function getMessageMedia"));
    assert.match(fn.slice(0, 1800), /media_expired/);
  });

  it("is not cached publicly", () => {
    const route = API.slice(API.indexOf('router.get("/chat/media/:messageId"'));
    assert.match(route.slice(0, 2600), /Cache-Control", "private/);
  });
});

describe("the media payload contract", () => {
  it("names the field the reader actually uses", () => {
    // getMessageMedia reads payload.mediaUrl. Requiring "url" meant every
    // voice note failed validation while looking correct in the logs.
    assert.equal(validatePayload(MESSAGE_KINDS.VOICE, { mediaUrl: "/a.ogg" }).ok, true);
    assert.equal(validatePayload(MESSAGE_KINDS.VOICE, { url: "/a.ogg" }).ok, false);
    assert.match(REPO, /String\(payload\.mediaUrl \|\| ""\)/);
  });

  it("accepts a note whose length WAHA did not report", () => {
    assert.equal(validatePayload(MESSAGE_KINDS.VOICE, { mediaUrl: "/a.ogg" }).ok, true);
  });
});

describe("duration is read, not invented", () => {
  it("pulls the real seconds off the payload", () => {
    assert.match(WEBHOOK, /audioMessage\?\.seconds/);
    assert.match(WEBHOOK, /mediaDurationMs/);
  });

  it("leaves it out when unknown rather than defaulting", () => {
    // Every note showing 0:00 is worse than a player that reads the length
    // off the stream itself.
    assert.match(WEBHOOK, /seconds > 0 \? Math\.round\(seconds \* 1000\) : null/);
    const fn = BRIDGE.slice(BRIDGE.indexOf("export async function tryHandleInboxVoiceNote"));
    assert.match(fn.slice(0, 1600), /Number\(durationMs\) > 0 \?/);
  });
});

describe("a voice note only lands in an open chat", () => {
  it("uses the same window as a text reply", () => {
    const fn = BRIDGE.slice(BRIDGE.indexOf("export async function tryHandleInboxVoiceNote"));
    assert.match(fn.slice(0, 900), /activeInboxThread\(customerKey\)/);
    assert.match(fn.slice(0, 900), /if \(!thread\) return false/);
  });

  it("otherwise falls through to transcription as before", () => {
    const block = WEBHOOK.slice(WEBHOOK.indexOf("tryHandleInboxVoiceNote") - 500, WEBHOOK.indexOf("tryHandleInboxVoiceNote") + 700);
    assert.match(block, /if \(routed\) return;/);
    assert.match(block, /catch \(err\)/);
  });
});

describe("the inbox plays them lazily", () => {
  it("does not fetch audio until play is pressed", () => {
    // Opening a thread of a hundred notes must cost one request, not a hundred.
    assert.match(INBOX, /preload="none"/);
  });

  it("points at the streaming endpoint, not a file", () => {
    assert.match(INBOX, /chat\/media\/\$\{msg\.id\}/);
  });

  it("hides the length when it is unknown", () => {
    assert.match(INBOX, /len \? `<span class="inbox-voice-len">/);
  });
});

describe("the media volume is bounded", () => {
  it("has a purge, because WAHA keeps files forever", () => {
    // WHATSAPP_FILES_LIFETIME=0 is deliberate -- the 180s default deleted
    // files mid-album -- but nothing else ever clears the volume.
    assert.match(PURGE, /WHATSAPP_FILES_LIFETIME=0/);
    assert.match(PURGE, /-mtime "\+\$DAYS"/);
  });

  it("can be rehearsed before it deletes anything", () => {
    assert.match(PURGE, /DRY_RUN/);
  });

  it("deletes via find, so no filename reaches a shell", () => {
    assert.match(PURGE, /-delete/);
    assert.doesNotMatch(PURGE, /xargs rm|\| *rm /);
  });

  it("refuses a nonsense retention rather than deleting everything", () => {
    assert.match(PURGE, /DAYS" =~ \^\[0-9\]\+\$/);
  });
});
