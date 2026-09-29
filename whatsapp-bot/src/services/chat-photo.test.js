/**
 * Sending a photo inside a thread.
 *
 * "Send a photo of the back" is the most common message on a secondhand
 * marketplace. IMAGE was a defined message kind, the thread rendered images
 * that arrived from WhatsApp, and there was no route and no button to send
 * one from the site.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validatePhotoUpload,
  photoExtensionFor,
  basePhotoMimetype,
  MAX_PHOTO_BYTES,
  PHOTO_TTL_MS,
} from "./chat-photo-store.js";
import { localMediaFile } from "../routes/socialApi.js";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const STORE = src("./chat-photo-store.js");
const API = src("../routes/socialApi.js");
const SERVER = src("../server.js");
const INBOX = src("../../../website/assets/js/inbox.js");
const HTML = src("../../../website/inbox.html");

const ok = (n = 2048) => Buffer.alloc(n, 1);
const ROUTE = API.slice(API.indexOf('router.post("/chat/photo"'));

describe("what counts as a photo", () => {
  it("accepts what a phone actually sends", () => {
    for (const m of ["image/jpeg", "image/png", "image/webp", "image/jpeg; charset=binary"]) {
      assert.equal(validatePhotoUpload({ buffer: ok(), mimetype: m }).ok, true, m);
    }
  });

  it("strips parameters before matching", () => {
    assert.equal(basePhotoMimetype("image/jpeg; charset=binary"), "image/jpeg");
    assert.equal(photoExtensionFor("image/png"), "png");
  });

  it("refuses anything that is not an image", () => {
    for (const m of ["application/pdf", "text/html", "image/svg+xml", "", null]) {
      assert.equal(validatePhotoUpload({ buffer: ok(), mimetype: m }).ok, false, String(m));
    }
  });

  it("refuses SVG specifically", () => {
    // SVG is a document that can carry script. It renders in an <img> where
    // that is inert, but there is no reason to accept it at all.
    const r = validatePhotoUpload({ buffer: ok(), mimetype: "image/svg+xml" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "unsupported_image");
  });

  it("refuses an empty upload", () => {
    assert.equal(validatePhotoUpload({ buffer: Buffer.alloc(0), mimetype: "image/jpeg" }).ok, false);
    assert.equal(validatePhotoUpload({ mimetype: "image/jpeg" }).ok, false);
  });

  it("refuses one past the cap", () => {
    const r = validatePhotoUpload({ buffer: ok(MAX_PHOTO_BYTES + 1), mimetype: "image/jpeg" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "photo_too_large");
  });
});

describe("the upload route", () => {
  it("caps the body at the multer layer too", () => {
    // Otherwise the whole thing is received before anything checks it.
    assert.match(API, /fileSize: MAX_PHOTO_BYTES/);
    assert.match(ROUTE.slice(0, 5000), /LIMIT_FILE_SIZE/);
  });

  it("resolves who is sending before it trusts the body", () => {
    const head = ROUTE.slice(0, 2000);
    assert.match(head, /resolveAuthenticatedSellerSocialContext/);
    assert.match(head, /applyBuyerIdentityAuth/);
    assert.ok(
      head.indexOf("applyBuyerIdentityAuth") < ROUTE.indexOf("storeChatPhoto"),
      "identity has to be settled before anything is written"
    );
  });

  it("refuses a seller session that claims someone else's id", () => {
    assert.match(ROUTE.slice(0, 2000), /seller_session_mismatch/);
  });

  it("puts the caption through the ordinary message content", () => {
    // That is what runs it through the contact-details filter; a caption is
    // otherwise a clean way to pass a phone number.
    assert.match(ROUTE.slice(0, 4000), /content: caption/);
  });

  it("does not make the sender wait on WhatsApp", () => {
    assert.match(ROUTE.slice(0, 5000), /void \(async \(\) => \{/);
    assert.match(ROUTE.slice(0, 5000), /relayPhotoToWhatsApp/);
  });

  it("stores an expiry on the message", () => {
    assert.match(ROUTE.slice(0, 4000), /expiresAt: new Date\(Date\.now\(\) \+ PHOTO_TTL_MS\)/);
    assert.equal(PHOTO_TTL_MS, 14 * 24 * 60 * 60 * 1000);
  });
});

describe("the file on disk", () => {
  it("is named with a UUID, never from the upload", () => {
    assert.match(STORE, /randomUUID\(\)/);
    const fn = STORE.slice(STORE.indexOf("export async function storeChatPhoto"));
    assert.doesNotMatch(fn.slice(0, 700), /originalname|filename \|\|/);
  });

  it("is purged on a timer, not by a crontab someone must remember", () => {
    assert.match(STORE, /export async function purgeExpiredChatPhotos/);
    assert.match(SERVER, /startChatPhotoPurge/);
  });

  it("is served privately and with nosniff", () => {
    assert.match(SERVER, /assets\/chat-photos/);
    const mount = SERVER.slice(SERVER.indexOf('"/assets/chat-photos"'));
    assert.match(mount.slice(0, 600), /private, max-age=3600/);
    assert.match(mount.slice(0, 600), /X-Content-Type-Options/);
  });
});

describe("the path never leaves its folder", () => {
  it("resolves both media folders", () => {
    assert.equal(
      localMediaFile("https://bot.sokonimall.com/assets/chat-photos/a-1.jpg")?.name,
      "a-1.jpg"
    );
    assert.equal(
      localMediaFile("https://bot.sokonimall.com/assets/voice-notes/b-2.webm")?.name,
      "b-2.webm"
    );
  });

  it("refuses a traversal or a folder we do not serve", () => {
    for (const url of [
      "https://bot.sokonimall.com/assets/chat-photos/../../config.json",
      "https://bot.sokonimall.com/assets/chat-photos/sub/x.jpg",
      "https://bot.sokonimall.com/assets/boda-docs/id.jpg",
      "https://bot.sokonimall.com/assets/fit-checks/x.jpg",
      "",
      null,
    ]) {
      assert.equal(localMediaFile(url), null, String(url));
    }
  });
});

describe("the browser side", () => {
  const SEND = INBOX.slice(INBOX.indexOf("async function sendPhoto"), INBOX.indexOf("function wirePhotoButton"));

  it("shrinks the photo before uploading it", () => {
    // A 4MB camera shot on a metered bundle is a cost the buyer did not agree
    // to, and the seller only needs to see the stitching.
    assert.match(INBOX, /async function downscalePhoto/);
    assert.match(INBOX, /PHOTO_MAX_EDGE = 1280/);
    assert.match(SEND, /await downscalePhoto\(file\)/);
  });

  it("falls back to the original if downscaling fails", () => {
    // A slightly expensive upload beats no photo.
    const fn = INBOX.slice(INBOX.indexOf("async function downscalePhoto"));
    assert.match(fn.slice(0, 1600), /catch \{\s*return file;/);
  });

  it("does not upload a downscale that came out bigger", () => {
    const fn = INBOX.slice(INBOX.indexOf("async function downscalePhoto"));
    assert.match(fn.slice(0, 1600), /blob\.size >= file\.size/);
  });

  it("sends the caption from the normal text box", () => {
    assert.match(SEND, /form\.append\("caption", caption\)/);
  });

  it("carries the viewer's session", () => {
    assert.match(SEND, /withAuthBody\(\{\}\)/);
  });

  it("re-enables the button whatever happens", () => {
    assert.match(SEND, /finally \{/);
  });

  it("lets the same file be picked twice", () => {
    // Without clearing value the change event never fires again.
    const fn = INBOX.slice(INBOX.indexOf("function wirePhotoButton"));
    assert.match(fn.slice(0, 800), /input\.value = "";/);
  });

  it("renders an image message with its own bubble", () => {
    assert.match(INBOX, /if \(msg\.kind === "image"\) return imageBubble\(msg\)/);
    assert.match(INBOX, /function imageBubble/);
  });

  it("fetches through the media route, not the raw file URL", () => {
    // The raw path has no auth; the route checks the viewer is in the thread.
    const fn = INBOX.slice(INBOX.indexOf("function imageBubble"));
    assert.match(fn.slice(0, 1200), /chat\/media\/\$\{msg\.id\}/);
    assert.doesNotMatch(fn.slice(0, 1200), /payload\.mediaUrl/);
  });

  it("says a photo expired instead of showing a broken frame", () => {
    const fn = INBOX.slice(INBOX.indexOf("function imageBubble"));
    assert.match(fn.slice(0, 1200), /is-gone/);
  });

  it("has a button and a file input that only takes images", () => {
    assert.match(HTML, /id="chat-photo-btn"/);
    assert.match(HTML, /id="chat-photo-input"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
  });
});
