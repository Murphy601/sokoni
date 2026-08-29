/**
 * Sokoni boda rider onboarding — multipart FormData to POST /api/riders/register.
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
  const MAX_BYTES = 5 * 1024 * 1024;

  if (!form) return;

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("text-red-600", Boolean(isError));
    statusEl.classList.toggle("dark:text-red-400", Boolean(isError));
  }

  function assertFileSize(file, label) {
    if (file && file.size > MAX_BYTES) {
      throw new Error(`${label} is over 5 MB`);
    }
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    setStatus("");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting…";
    }

    try {
      const idFile = document.getElementById("idDocument")?.files?.[0];
      const dlFile = document.getElementById("dlDocument")?.files?.[0];
      const stageFile = document.getElementById("stageLetter")?.files?.[0];
      if (!idFile || !dlFile || !stageFile) {
        throw new Error("Upload National ID, driving licence, and stage letter.");
      }
      assertFileSize(idFile, "National ID");
      assertFileSize(dlFile, "Driving licence");
      assertFileSize(stageFile, "Stage letter");

      const fd = new FormData();
      fd.append("fullName", String(document.getElementById("fullName")?.value || "").trim());
      fd.append("phone", String(document.getElementById("phone")?.value || "").trim());
      fd.append("nationalId", String(document.getElementById("nationalId")?.value || "").trim());
      fd.append("operatingTown", String(document.getElementById("operatingTown")?.value || "").trim());
      fd.append("stageLocation", String(document.getElementById("stageLocation")?.value || "").trim());
      fd.append("motorbikePlate", String(document.getElementById("motorbikePlate")?.value || "").trim());
      fd.append("guarantorName", String(document.getElementById("guarantorName")?.value || "").trim());
      fd.append("guarantorPhone", String(document.getElementById("guarantorPhone")?.value || "").trim());

      fd.append("idDocument", idFile);
      fd.append("dlDocument", dlFile);
      fd.append("stageLetter", stageFile);

      const optional = [
        ["idDocumentBack", "ID back"],
        ["logbookDocument", "Logbook"],
        ["goodConductDocument", "Good conduct"],
        ["ntsaBadgeDocument", "NTSA badge"],
      ];
      for (const [id, label] of optional) {
        const f = document.getElementById(id)?.files?.[0];
        if (!f) continue;
        assertFileSize(f, label);
        fd.append(id, f);
      }

      const res = await fetch(`${API_BASE}/api/riders/register`, {
        method: "POST",
        body: fd,
      });
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
      setStatus(err.message || "Something went wrong. Try again.", true);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit rider application";
      }
    }
  });
})();
