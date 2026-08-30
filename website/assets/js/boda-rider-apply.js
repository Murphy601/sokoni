/**
 * Sokoni boda rider onboarding — multipart FormData to POST /api/riders/register.
 * Phone photos are compressed client-side so nginx (~1m default) / multer limits
 * do not surface as a bare "Failed to fetch".
 */
(function () {
  const API_BASE =
    typeof location !== "undefined" && /localhost|127\.0\.0\.1/.test(location.hostname)
      ? "http://127.0.0.1:3001"
      : "https://bot.sokonimall.com";

  const form = document.getElementById("boda-apply-form");
  const statusEl = document.getElementById("form-status");
  const submitBtn = document.getElementById("submit-btn");
  const successBox = document.getElementById("success-box");
  /** Per-file cap before compress (matches multer). */
  const MAX_BYTES = 5 * 1024 * 1024;
  /** Soft total payload target — live nginx often sits near 1–25m. */
  const TARGET_TOTAL_BYTES = 8 * 1024 * 1024;

  if (!form) return;

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("text-red-600", Boolean(isError));
    statusEl.classList.toggle("dark:text-red-400", Boolean(isError));
  }

  function assertFileSize(file, label) {
    if (file && file.size > MAX_BYTES) {
      throw new Error(`${label} is over 5 MB — pick a smaller photo or PDF.`);
    }
  }

  /** Shrink phone photos so multi-doc FormData stays under reverse-proxy limits. */
  async function compressImageFile(file, maxDim = 1600, quality = 0.78) {
    if (!file?.type?.startsWith("image/")) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob || blob.size >= file.size * 0.95) return file;
      return new File([blob], (file.name || "photo").replace(/\.\w+$/, "") + ".jpg", {
        type: "image/jpeg",
      });
    } catch {
      return file;
    }
  }

  async function prepareUpload(file, label) {
    assertFileSize(file, label);
    if (!file.type?.startsWith("image/")) return file;
    let out = await compressImageFile(file, 1600, 0.78);
    if (out.size > 900 * 1024) {
      out = await compressImageFile(out, 1280, 0.7);
    }
    if (out.size > 900 * 1024) {
      out = await compressImageFile(out, 1024, 0.62);
    }
    assertFileSize(out, label);
    return out;
  }

  function friendlyNetworkError(err, status) {
    const raw = String(err?.message || err || "");
    if (status === 413 || /413|entity too large|request entity/i.test(raw)) {
      return "Those documents are too large for the server. Use clearer phone photos (not full gallery originals) and try again.";
    }
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
      return "Could not reach Sokoni — often the photos are too large. Use smaller phone photos (or PDF under 2 MB each) and try again. If it still fails, WhatsApp help.";
    }
    return raw || "Something went wrong. Try again.";
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    setStatus("");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Preparing photos…";
    }

    try {
      const idFile = document.getElementById("idDocument")?.files?.[0];
      const dlFile = document.getElementById("dlDocument")?.files?.[0];
      const stageFile = document.getElementById("stageLetter")?.files?.[0];
      if (!idFile || !dlFile || !stageFile) {
        throw new Error("Upload National ID, driving licence, and stage letter.");
      }

      const prepared = {
        idDocument: await prepareUpload(idFile, "National ID"),
        dlDocument: await prepareUpload(dlFile, "Driving licence"),
        stageLetter: await prepareUpload(stageFile, "Stage letter"),
      };

      const optional = [
        ["idDocumentBack", "ID back"],
        ["logbookDocument", "Logbook"],
        ["goodConductDocument", "Good conduct"],
        ["ntsaBadgeDocument", "NTSA badge"],
      ];
      for (const [id, label] of optional) {
        const f = document.getElementById(id)?.files?.[0];
        if (!f) continue;
        prepared[id] = await prepareUpload(f, label);
      }

      let total = 0;
      for (const f of Object.values(prepared)) total += f.size || 0;
      if (total > TARGET_TOTAL_BYTES) {
        throw new Error(
          "All documents together are still too large. Compress photos on your phone or upload PDFs under 2 MB each."
        );
      }

      if (submitBtn) submitBtn.textContent = "Submitting…";

      const fd = new FormData();
      fd.append("fullName", String(document.getElementById("fullName")?.value || "").trim());
      fd.append("phone", String(document.getElementById("phone")?.value || "").trim());
      fd.append("nationalId", String(document.getElementById("nationalId")?.value || "").trim());
      fd.append("operatingTown", String(document.getElementById("operatingTown")?.value || "").trim());
      fd.append("stageLocation", String(document.getElementById("stageLocation")?.value || "").trim());
      fd.append("motorbikePlate", String(document.getElementById("motorbikePlate")?.value || "").trim());
      fd.append("guarantorName", String(document.getElementById("guarantorName")?.value || "").trim());
      fd.append("guarantorPhone", String(document.getElementById("guarantorPhone")?.value || "").trim());

      for (const [field, file] of Object.entries(prepared)) {
        fd.append(field, file);
      }

      let res;
      try {
        res = await fetch(`${API_BASE}/api/riders/register`, {
          method: "POST",
          body: fd,
        });
      } catch (netErr) {
        throw new Error(friendlyNetworkError(netErr));
      }

      if (res.status === 413) {
        throw new Error(friendlyNetworkError(null, 413));
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.message || data.error || "Could not submit application");
      }

      form.classList.add("hidden");
      if (successBox) {
        successBox.classList.remove("hidden");
        const idEl = document.getElementById("application-id");
        if (idEl) idEl.textContent = String(data.riderId || data.rider?.id || "—");
      }
      setStatus("");
    } catch (err) {
      setStatus(friendlyNetworkError(err), true);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit rider application";
      }
    }
  });
})();
