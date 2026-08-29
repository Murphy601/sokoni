/**
 * Sokoni boda rider onboarding — posts JSON + base64 docs to /api/riders/register.
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

  if (!form) return;

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("text-red-600", Boolean(isError));
    statusEl.classList.toggle("dark:text-red-400", Boolean(isError));
    statusEl.classList.toggle("text-brand-purple", !isError);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve("");
      if (file.size > 4 * 1024 * 1024) {
        reject(new Error(`${file.name || "File"} is over 4 MB`));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.readAsDataURL(file);
    });
  }

  async function optionalFile(id) {
    const file = document.getElementById(id)?.files?.[0];
    if (!file) return { data: "", name: "" };
    return { data: await fileToDataUrl(file), name: file.name || "" };
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

      const [idDocument, dlDocument, stageLetter, idBack, logbook, goodConduct, ntsa] =
        await Promise.all([
          fileToDataUrl(idFile),
          fileToDataUrl(dlFile),
          fileToDataUrl(stageFile),
          optionalFile("idDocumentBack"),
          optionalFile("logbookDocument"),
          optionalFile("goodConductDocument"),
          optionalFile("ntsaBadgeDocument"),
        ]);

      const payload = {
        fullName: String(document.getElementById("fullName")?.value || "").trim(),
        phone: String(document.getElementById("phone")?.value || "").trim(),
        nationalId: String(document.getElementById("nationalId")?.value || "").trim(),
        operatingTown: String(document.getElementById("operatingTown")?.value || "").trim(),
        stageLocation: String(document.getElementById("stageLocation")?.value || "").trim(),
        motorbikePlate: String(document.getElementById("motorbikePlate")?.value || "").trim(),
        guarantorName: String(document.getElementById("guarantorName")?.value || "").trim(),
        guarantorPhone: String(document.getElementById("guarantorPhone")?.value || "").trim(),
        idDocument,
        idDocumentName: idFile.name || "",
        idDocumentBack: idBack.data || undefined,
        idDocumentBackName: idBack.name || undefined,
        dlDocument,
        dlDocumentName: dlFile.name || "",
        stageLetter,
        stageLetterName: stageFile.name || "",
        logbookDocument: logbook.data || undefined,
        logbookDocumentName: logbook.name || undefined,
        goodConductDocument: goodConduct.data || undefined,
        goodConductDocumentName: goodConduct.name || undefined,
        ntsaBadgeDocument: ntsa.data || undefined,
        ntsaBadgeDocumentName: ntsa.name || undefined,
      };

      const res = await fetch(`${API_BASE}/api/riders/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.message || data.error || "Could not submit application");
      }

      form.classList.add("hidden");
      if (successBox) {
        successBox.classList.remove("hidden");
        const idEl = document.getElementById("application-id");
        if (idEl) idEl.textContent = String(data.riderId || "—");
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
