/**
 * Playing a voice note back.
 *
 * Two separate faults made notes unlistenable on a phone: the media route
 * ignored Range requests, so every rebuffer refetched from byte zero and the
 * audio cut out mid-sentence; and `<audio controls>` reads a MediaRecorder
 * WebM as zero seconds long, so the native player showed 0:00 / 0:00 with a
 * scrubber that did nothing.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localVoiceNoteName } from "../routes/socialApi.js";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const API = src("../routes/socialApi.js");
const INBOX = src("../../../website/assets/js/inbox.js");
const HTML = src("../../../website/inbox.html");
const CSS = src("../../../website/assets/css/depop-surfaces.css");

const MEDIA_ROUTE = API.slice(API.indexOf('router.get("/chat/media/:messageId"'));

describe("a note we recorded is served from disk", () => {
  it("goes out through sendFile so ranges work", () => {
    assert.match(MEDIA_ROUTE.slice(0, 3000), /localVoiceNoteName\(/);
    assert.match(MEDIA_ROUTE.slice(0, 3000), /serveLocalVoiceNote\(res/);
    const helper = API.slice(API.indexOf("function serveLocalVoiceNote"));
    assert.match(helper.slice(0, 600), /res\.sendFile\(/);
  });

  it("checks the local path before reaching for WAHA", () => {
    const head = MEDIA_ROUTE.slice(0, 3000);
    assert.ok(
      head.indexOf("localVoiceNoteName(") < head.indexOf("streamWahaMedia"),
      "the disk case has to be decided first or it never runs"
    );
  });

  it("tells a player it cannot seek a WAHA stream", () => {
    // A straight proxy cannot answer a partial range. Saying so is better than
    // letting the browser ask and get the whole file back.
    assert.match(MEDIA_ROUTE.slice(0, 3000), /Accept-Ranges", "none"/);
  });
});

describe("the filename never leaves its folder", () => {
  it("accepts a stored note", () => {
    assert.equal(
      localVoiceNoteName("https://bot.sokonimall.com/assets/voice-notes/abc-123.webm"),
      "abc-123.webm"
    );
  });

  it("refuses anything that is not one", () => {
    for (const url of [
      "https://waha.internal/api/files/x.oga",
      "https://bot.sokonimall.com/assets/boda-docs/id.jpg",
      "",
      null,
      undefined,
    ]) {
      assert.equal(localVoiceNoteName(url), null, String(url));
    }
  });

  it("refuses a traversal even though the value is ours", () => {
    // The name comes from the message payload, not the request, but a path
    // segment must not be able to walk out of the folder whatever wrote it.
    for (const url of [
      "https://bot.sokonimall.com/assets/voice-notes/../../config.json",
      "https://bot.sokonimall.com/assets/voice-notes/..%2f..%2fconfig.json",
      "https://bot.sokonimall.com/assets/voice-notes/sub/dir.webm",
    ]) {
      assert.equal(localVoiceNoteName(url), null, url);
    }
  });
});

describe("the player in the thread", () => {
  const BUBBLE = INBOX.slice(INBOX.indexOf("function voiceBubble"), INBOX.indexOf("function wireVoicePlayers"));

  it("does not use the native controls", () => {
    assert.doesNotMatch(BUBBLE, /<audio controls/);
    assert.match(CSS, /\.inbox-voice audio \{\s*display: none/);
  });

  it("still downloads nothing until play is pressed", () => {
    // The length comes off the message, so there is no reason to fetch the
    // file to find it out. A thread of a hundred notes stays one request.
    assert.match(BUBBLE, /preload="none"/);
  });

  it("shows the length the recorder measured", () => {
    assert.match(BUBBLE, /durationMs/);
    assert.match(BUBBLE, /data-voice-ms=/);
  });

  it("falls back to a placeholder rather than a lie", () => {
    // An unknown length shows --:--, never 0:00, which reads as a broken file.
    assert.match(BUBBLE, /"--:--"/);
  });

  it("only trusts the file's own duration when it is a real number", () => {
    // A WebM blob reports Infinity here.
    const wire = INBOX.slice(INBOX.indexOf("function wireVoicePlayers"));
    assert.match(wire.slice(0, 4000), /usable\(audio\.duration\)/);
  });

  it("stops any other note before starting one", () => {
    const wire = INBOX.slice(INBOX.indexOf("function wireVoicePlayers"));
    assert.match(wire.slice(0, 4000), /other !== audio && !other\.paused/);
  });

  it("wires each bubble once, so polling does not stack listeners", () => {
    const wire = INBOX.slice(INBOX.indexOf("function wireVoicePlayers"));
    assert.match(wire.slice(0, 1200), /voiceWired === "1"/);
  });

  it("is actually called after the thread renders", () => {
    assert.match(INBOX, /wireVoicePlayers\(wrap\)/);
  });
});

describe("the composer icons", () => {
  it("draws a microphone, not a dot", () => {
    const btn = HTML.slice(HTML.indexOf('id="chat-mic-btn"'), HTML.indexOf('id="chat-send-btn"'));
    assert.match(btn, /<svg/);
    assert.doesNotMatch(btn, /●/);
  });

  it("does not borrow Tailwind's .hidden for component state", () => {
    // Tailwind comes off a CDN. If that script is slow or blocked, a glyph
    // whose default state is a utility class shows both icons at once.
    assert.match(CSS, /\.inbox-voice-glyph-pause \{\s*display: none/);
    assert.match(CSS, /\.inbox-mic-stop \{\s*display: none/);
    const btn = HTML.slice(HTML.indexOf('id="chat-mic-btn"'), HTML.indexOf('id="chat-send-btn"'));
    assert.doesNotMatch(btn, /inbox-mic-stop hidden/);
  });

  it("switches the mic to a stop square while recording", () => {
    assert.match(CSS, /\.inbox-mic\.is-recording \.inbox-mic-stop \{\s*display: block/);
  });

  it("leaves the button content alone when recording starts", () => {
    // setRecordingUi toggles a class. If it rewrote the button it would wipe
    // the SVG and leave an empty circle.
    const fn = INBOX.slice(INBOX.indexOf("function setRecordingUi"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    assert.doesNotMatch(body, /innerHTML|textContent/);
  });
});
