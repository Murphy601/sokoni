import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = resolve(root, "website/assets/images");
const cursorAssets = "C:/Users/user/.cursor/projects/c-Users-user-Projects-sokoni/assets";
const srcIcon = existsSync(resolve(root, "assets/sokoni-icon-3d.png"))
  ? resolve(root, "assets/sokoni-icon-3d.png")
  : resolve(cursorAssets, "sokoni-icon-3d.png");
const srcLockup = existsSync(resolve(root, "assets/sokoni-lockup-3d.png"))
  ? resolve(root, "assets/sokoni-lockup-3d.png")
  : resolve(cursorAssets, "sokoni-lockup-3d.png");

if (!existsSync(srcIcon)) {
  console.error("Missing source icon:", srcIcon);
  process.exit(1);
}
if (!existsSync(assets)) mkdirSync(assets, { recursive: true });

const jobs = [
  [srcIcon, "logo-512.png", 512, 512],
  [srcIcon, "logo-icon-light.png", 512, 512],
  [srcIcon, "logo-apple-touch.png", 180, 180],
  [srcIcon, "favicon-180.png", 180, 180],
  [srcIcon, "favicon-32.png", 32, 32],
  [srcLockup, "logo-lockup-light.png", 960, 240],
  [srcLockup, "logo-og.png", 1200, 630],
];

for (const [src, out, w, h] of jobs) {
  await sharp(readFileSync(src))
    .resize(w, h, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toFile(resolve(assets, out));
  console.log("wrote", out);
}

await sharp(readFileSync(srcIcon))
  .resize(512, 512, { fit: "contain", background: { r: 27, g: 16, b: 53, alpha: 1 } })
  .png()
  .toFile(resolve(assets, "logo-icon-dark.png"));
console.log("wrote logo-icon-dark.png");

await sharp(readFileSync(srcLockup))
  .resize(960, 240, { fit: "contain", background: { r: 27, g: 16, b: 53, alpha: 1 } })
  .png()
  .toFile(resolve(assets, "logo-lockup-dark.png"));
console.log("wrote logo-lockup-dark.png");

await sharp(readFileSync(srcIcon))
  .resize(480, 480, { fit: "contain", background: { r: 37, g: 211, b: 102, alpha: 1 } })
  .extend({ top: 80, bottom: 80, left: 80, right: 80, background: { r: 37, g: 211, b: 102, alpha: 1 } })
  .png()
  .toFile(resolve(assets, "sokoni-whatsapp-profile.png"));
console.log("wrote sokoni-whatsapp-profile.png");

await sharp(readFileSync(resolve(assets, "favicon-32.png")))
  .resize(256, 256, { kernel: sharp.kernel.nearest })
  .png()
  .toFile(resolve(assets, "favicon-32-test-enlarged.png"));
console.log("Done.");
